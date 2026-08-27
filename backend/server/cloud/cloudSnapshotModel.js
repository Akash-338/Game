const OPEN_VOTE_PHASES = new Set(["voting", "runoff"]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function publicPlayer(player) {
  return {
    id: player.id,
    userId: player.user_id,
    avatarId: player.avatar_id,
    avatarColor: player.avatar_color,
    isGhost: Boolean(player.is_ghost),
    isReady: Boolean(player.is_ready),
    isConnected: Boolean(player.is_connected),
    isKicked: Boolean(player.is_kicked),
    turnPosition: Number(player.turn_position),
    joinedAt: Number(player.joined_at),
    leftAt: player.left_at ?? null
  };
}

function safeEvent(event) {
  const base = { id: event.id, roundId: event.round_id ?? null, type: event.type, message: event.message, createdAt: Number(event.created_at) };
  const meta = event.meta && typeof event.meta === "object" ? event.meta : {};
  if (event.type === "players_eliminated" && Array.isArray(meta.eliminated)) return { ...base, meta: { eliminated: meta.eliminated } };
  if (event.type === "score_changed" && meta.playerId && Number.isFinite(meta.delta) && typeof meta.reason === "string") return { ...base, meta: { playerId: meta.playerId, delta: meta.delta, reason: meta.reason } };
  return { ...base, meta: {} };
}

function currentHintCycle(hints, activePlayerCount) {
  const highestCycle = hints.reduce((highest, hint) => Math.max(highest, Number(hint.cycle_number || 0)), 0);
  if (!highestCycle) return 1;
  const submitted = hints.filter((hint) => Number(hint.cycle_number) === highestCycle).length;
  return submitted >= activePlayerCount ? highestCycle + 1 : highestCycle;
}

function roleForPlayer(player, round) {
  if (!round) return null;
  return player.role === "impostor"
    ? { role: "impostor", category: round.show_category_to_impostor ? round.category : null, impostorHint: round.show_hint_to_impostor ? round.impostor_hint : null }
    : { role: "civilian", category: round.category, actualWord: round.actual_word };
}

function publicRole(player) {
  return { playerId: player.id, userId: player.user_id, avatarId: player.avatar_id, avatarColor: player.avatar_color, role: player.role };
}

export function buildCloudSnapshot({ room, players, round = null, hints = [], votes = [], directMessages = [], discussionMessages = [], events = [], scores = [], scoreEvents = [], viewer, hostData = null }) {
  if (!room) return null;
  const orderedPlayers = [...players].filter((player) => !player.is_kicked).sort((left, right) => Number(left.is_ghost) - Number(right.is_ghost) || Number(left.turn_position) - Number(right.turn_position) || Number(left.joined_at) - Number(right.joined_at));
  const playerById = new Map(orderedPlayers.map((player) => [player.id, player]));
  const viewerPlayer = viewer.playerId ? playerById.get(viewer.playerId) || null : null;
  const spectator = Boolean(viewerPlayer?.is_ghost);
  const activePlayers = orderedPlayers.filter((player) => !player.is_ghost);
  const publicPlayers = orderedPlayers.map(publicPlayer);
  const voteOpen = OPEN_VOTE_PHASES.has(room.game_phase);
  const voteCandidates = asArray(room.vote_candidates).map((id) => playerById.get(id)).filter(Boolean).map(publicPlayer);
  const activeVoteStage = Number(room.vote_number || 0) * 10 + (room.game_phase === "runoff" ? 1 : 0);
  const currentVotes = voteOpen ? votes.filter((vote) => vote.round_id === round?.id && Number(vote.vote_stage) === activeVoteStage) : [];
  const currentHints = hints.filter((hint) => hint.round_id === round?.id).sort((left, right) => Number(left.cycle_number) - Number(right.cycle_number) || Number(left.created_at) - Number(right.created_at));
  const visibleDirectMessages = viewerPlayer
    ? directMessages.filter((message) => message.sender_player_id === viewerPlayer.id || message.recipient_player_id === viewerPlayer.id)
    : [];
  const revealed = room.status === "revealed" && round;
  const canRevealRoles = Boolean(revealed || spectator || (viewer.isHost && viewer.peek));
  const publicEvents = events.map(safeEvent);
  const latestElimination = [...publicEvents].reverse().find((event) => event.type === "players_eliminated") || null;

  const snapshot = {
    room: {
      roomCode: room.room_code,
      status: room.status,
      gamePhase: room.game_phase || "lobby",
      winner: room.winner || null,
      impostorCount: Number(room.impostor_count),
      showCategoryToImpostor: Boolean(room.show_category_to_impostor),
      showHintToImpostor: Boolean(room.show_hint_to_impostor),
      selectedCategories: asArray(room.selected_categories),
      selectedWordEntryId: viewer.isHost ? room.selected_word_entry_id || null : null,
      currentTurnPosition: Number(room.current_turn_position),
      soundMuted: Boolean(room.sound_muted),
      clueCycleLimit: Number(room.clue_cycle_limit || 2),
      voteNumber: Number(room.vote_number || 0),
      discussionLocked: Boolean(room.discussion_locked),
      discussionCooldownMs: 15000
    },
    players: publicPlayers,
    canStart: activePlayers.length >= 3 && activePlayers.length > Number(room.impostor_count) && activePlayers.every((player) => player.is_ready && player.is_connected),
    currentTurnPlayerId: activePlayers[Number(room.current_turn_position)]?.id || null,
    packs: viewer.isHost ? hostData?.packs || [] : [],
    categories: viewer.isHost ? hostData?.categories || [] : [],
    wordChoices: viewer.isHost ? hostData?.wordChoices || [] : [],
    hints: currentHints.map((hint) => {
      const player = playerById.get(hint.player_id);
      return {
        id: hint.id,
        playerId: hint.player_id,
        userId: player?.user_id || "Unknown",
        avatarId: player?.avatar_id || "",
        avatarColor: player?.avatar_color || "",
        isConnected: Boolean(player?.is_connected),
        cycleNumber: Number(hint.cycle_number),
        content: hint.content,
        memorable: Boolean(hint.memorable),
        createdAt: Number(hint.created_at),
        editedAt: hint.edited_at ?? null,
        editedByHost: Boolean(hint.edited_by_host)
      };
    }),
    round: round ? {
      id: round.id,
      roundNumber: Number(round.round_number),
      status: round.status,
      currentHintCycle: currentHintCycle(currentHints, activePlayers.length),
      ...(revealed ? { category: round.category, actualWord: round.actual_word } : {}),
      startedAt: Number(round.started_at),
      revealedAt: round.revealed_at ?? null,
      finishedAt: round.finished_at ?? null
    } : null,
    ballot: {
      open: voteOpen,
      phase: room.game_phase,
      voteNumber: Number(room.vote_number || 0),
      isRunoff: room.game_phase === "runoff",
      candidates: voteCandidates,
      liveVotes: currentVotes.map((vote) => ({
        id: vote.id,
        voter: publicPlayer(playerById.get(vote.voter_player_id)),
        target: vote.target_player_id ? publicPlayer(playerById.get(vote.target_player_id)) : null,
        abstained: Boolean(vote.abstained),
        skipped: Boolean(vote.skipped),
        createdAt: Number(vote.created_at)
      })),
      submittedCount: currentVotes.length,
      eligibleCount: activePlayers.length,
      hasSubmitted: Boolean(viewerPlayer && currentVotes.some((vote) => vote.voter_player_id === viewerPlayer.id))
    },
    voteResult: latestElimination ? { eliminated: latestElimination.meta.eliminated, createdAt: latestElimination.createdAt, message: latestElimination.message } : null,
    directMessages: visibleDirectMessages.map((message) => {
      const sender = playerById.get(message.sender_player_id);
      const recipient = playerById.get(message.recipient_player_id);
      return {
        id: message.id,
        senderPlayerId: message.sender_player_id,
        recipientPlayerId: message.recipient_player_id,
        content: message.content,
        createdAt: Number(message.created_at),
        senderUserId: sender?.user_id || "Unknown",
        senderAvatarId: sender?.avatar_id || "",
        senderAvatarColor: sender?.avatar_color || "",
        recipientUserId: recipient?.user_id || "Unknown",
        recipientAvatarId: recipient?.avatar_id || "",
        recipientAvatarColor: recipient?.avatar_color || ""
      };
    }),
    discussionMessages: asArray(discussionMessages).map((message) => {
      const sender = playerById.get(message.player_id);
      return {
        id: message.id,
        playerId: message.player_id,
        userId: sender?.user_id || "Unknown",
        avatarId: sender?.avatar_id || "",
        avatarColor: sender?.avatar_color || "",
        content: message.content,
        createdAt: Number(message.created_at)
      };
    }),
    gameLog: publicEvents,
    scores: scores.map((score) => {
      const player = playerById.get(score.player_id);
      return { id: score.id, playerId: score.player_id, points: Number(score.points), correctVotes: Number(score.correct_votes), impostorTallySurvivals: Number(score.impostor_tally_survivals), votesReceived: Number(score.votes_received), lastVotesReceived: Number(score.last_votes_received), memorableClueAwards: Number(score.memorable_clue_awards), userId: player?.user_id || "Unknown", avatarId: player?.avatar_id || "", avatarColor: player?.avatar_color || "", isGhost: Boolean(player?.is_ghost) };
    }),
    scoreEvents: scoreEvents.map((event) => {
      const player = playerById.get(event.player_id);
      return { id: event.id, roomId: event.room_id, roundId: event.round_id ?? null, playerId: event.player_id, delta: Number(event.delta), reason: event.reason, createdAt: Number(event.created_at), userId: player?.user_id || "Unknown", avatarId: player?.avatar_id || "", avatarColor: player?.avatar_color || "" };
    }),
    ownRole: viewerPlayer && !spectator ? roleForPlayer(viewerPlayer, round) : null,
    roles: canRevealRoles ? orderedPlayers.map(publicRole) : []
  };
  return snapshot;
}
