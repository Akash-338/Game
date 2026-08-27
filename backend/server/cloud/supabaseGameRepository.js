import { createClient } from "@supabase/supabase-js";
import { buildCloudSnapshot } from "./cloudSnapshotModel.js";

const SUPABASE_REQUEST_TIMEOUT_MS = 12_000;
const SUPABASE_REQUEST_ATTEMPTS = 3;

function required(value, label) {
  if (!value) throw new Error(`${label} is required for the Supabase game repository.`);
  return value;
}

async function serverFetchWithRetry(input, init = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= SUPABASE_REQUEST_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SUPABASE_REQUEST_TIMEOUT_MS);
    const signals = [init.signal, controller.signal].filter(Boolean);
    try {
      return await fetch(input, { ...init, signal: signals.length > 1 ? AbortSignal.any(signals) : controller.signal });
    } catch (error) {
      lastError = error;
      if (attempt === SUPABASE_REQUEST_ATTEMPTS) break;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`Supabase Data API request failed after ${SUPABASE_REQUEST_ATTEMPTS} bounded attempts: ${lastError?.message || "unknown request error"}`);
}

export function createSupabaseGameRepository({ url, secretKey, clientFactory = createClient }) {
  const client = clientFactory(required(url, "SUPABASE_URL"), required(secretKey, "SUPABASE_SECRET_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: serverFetchWithRetry }
  });

  async function callRpc(name, parameters) {
    const { data, error } = await client.rpc(name, parameters);
    if (error) throw new Error(`Supabase ${name} RPC failed: ${error.message}`);
    return data;
  }

  async function selectOne(table, columns, column, value) {
    const { data, error } = await client.from(table).select(columns).eq(column, value).limit(1);
    if (error) throw new Error(`Supabase ${table} lookup failed: ${error.message}`);
    return data[0] || null;
  }

  return {
    async listRoomIds(limit = 1) {
      const { data, error } = await client.from("rooms").select("id").limit(limit);
      if (error) throw new Error(`Supabase rooms query failed: ${error.message}`);
      return data.map((room) => room.id);
    },
    async healthCheck() {
      await this.listRoomIds(1);
      return { provider: "supabase-data-api", ok: true };
    },
    async findRoomByCode(roomCode) {
      return selectOne(
        "rooms",
        "id,room_code,password_hash,host_user_id,host_token,status,game_phase,impostor_count,created_at,updated_at",
        "room_code",
        roomCode
      );
    },
    async findRoomByHostToken(hostToken) {
      return selectOne(
        "rooms",
        "id,room_code,password_hash,host_user_id,host_token,status,game_phase,impostor_count,created_at,updated_at",
        "host_token",
        hostToken
      );
    },
    async findPlayerForRecovery({ roomId, userId }) {
      const { data, error } = await client
        .from("players")
        .select("id,room_id,user_id,session_token,is_ghost,is_kicked,is_connected")
        .eq("room_id", roomId)
        .eq("user_id", userId)
        .limit(1);
      if (error) throw new Error(`Supabase player recovery lookup failed: ${error.message}`);
      return data[0] || null;
    },
    async findPlayerBySessionToken(sessionToken) {
      const { data, error } = await client
        .from("players")
        .select("id,room_id,user_id,session_token,is_ghost,is_kicked,is_connected")
        .eq("session_token", sessionToken)
        .limit(1);
      if (error) throw new Error(`Supabase player-session lookup failed: ${error.message}`);
      return data[0] || null;
    },
    async findWordPackEntryByChoice(choiceKey) {
      const normalizedChoice = String(choiceKey || "");
      const separator = normalizedChoice.lastIndexOf(":");
      if (separator < 1) return null;
      const packId = normalizedChoice.slice(0, separator);
      const entryId = Number(normalizedChoice.slice(separator + 1));
      if (!Number.isInteger(entryId)) return null;
      const { data, error } = await client
        .from("word_pack_entries")
        .select("pack_id,entry_id,category,word,impostor_hint")
        .eq("pack_id", packId)
        .eq("entry_id", entryId)
        .limit(1);
      if (error) throw new Error(`Supabase word-entry lookup failed: ${error.message}`);
      return data[0] || null;
    },
    async getAudienceSnapshot({ roomId, sessionToken = null, hostToken = null, peek = false }) {
      const { data: roomRows, error: roomError } = await client
        .from("rooms")
        .select("id,room_code,host_token,status,impostor_count,show_category_to_impostor,show_hint_to_impostor,selected_categories,selected_word_entry_id,current_turn_position,sound_muted,game_phase,clue_cycle_limit,vote_number,vote_candidates,winner,discussion_locked")
        .eq("id", roomId)
        .limit(1);
      if (roomError) throw new Error(`Supabase room snapshot query failed: ${roomError.message}`);
      const room = roomRows[0] || null;
      if (!room) return null;

      const { data: publicPlayers, error: playersError } = await client
        .from("players")
        .select("id,user_id,avatar_id,avatar_color,is_ghost,is_ready,is_connected,is_kicked,turn_position,joined_at,left_at")
        .eq("room_id", roomId);
      if (playersError) throw new Error(`Supabase player snapshot query failed: ${playersError.message}`);

      const { data: latestRounds, error: roundsError } = await client
        .from("rounds")
        .select("id,round_number,status,category,actual_word,impostor_hint,show_category_to_impostor,show_hint_to_impostor,started_at,revealed_at,finished_at")
        .eq("room_id", roomId)
        .order("round_number", { ascending: false })
        .limit(1);
      if (roundsError) throw new Error(`Supabase round snapshot query failed: ${roundsError.message}`);
      const round = latestRounds[0] || null;
      const verifiedHost = Boolean(hostToken && room.host_token === hostToken);

      let viewerPlayer = null;
      if (sessionToken) {
        const { data: viewerRows, error: viewerError } = await client
          .from("players")
          .select("id,role,is_ghost,is_kicked")
          .eq("room_id", roomId)
          .eq("session_token", sessionToken)
          .limit(1);
        if (viewerError) throw new Error(`Supabase viewer snapshot query failed: ${viewerError.message}`);
        viewerPlayer = viewerRows[0] || null;
      }

      const rolesAreVisible = Boolean(round && (room.status === "revealed" || viewerPlayer?.is_ghost || (verifiedHost && peek)));
      const roleRowsPromise = rolesAreVisible
        ? client.from("players").select("id,role").eq("room_id", roomId).eq("is_kicked", false)
        : Promise.resolve({ data: [], error: null });
      const directMessagesPromise = viewerPlayer
        ? Promise.all([
          client.from("direct_messages").select("id,sender_player_id,recipient_player_id,content,created_at").eq("room_id", roomId).eq("sender_player_id", viewerPlayer.id).is("deleted_at", null),
          client.from("direct_messages").select("id,sender_player_id,recipient_player_id,content,created_at").eq("room_id", roomId).eq("recipient_player_id", viewerPlayer.id).is("deleted_at", null)
        ])
        : Promise.resolve([]);
      const [hintsResponse, votesResponse, discussionResponse, eventsResponse, scoresResponse, scoreEventsResponse, roleResponse, directResponses] = await Promise.all([
        round ? client.from("hint_entries").select("id,round_id,player_id,cycle_number,content,created_at,edited_at,edited_by_host,memorable").eq("round_id", round.id).order("cycle_number").order("created_at") : Promise.resolve({ data: [], error: null }),
        round && ["voting", "runoff"].includes(room.game_phase) ? client.from("votes").select("id,round_id,vote_stage,voter_player_id,target_player_id,abstained,skipped,created_at").eq("room_id", roomId).eq("round_id", round.id) : Promise.resolve({ data: [], error: null }),
        client.from("discussion_messages").select("id,player_id,content,created_at").eq("room_id", roomId).is("deleted_at", null).order("created_at").limit(120),
        client.from("game_events").select("id,round_id,type,message,meta,created_at").eq("room_id", roomId).order("created_at").limit(120),
        client.from("player_scores").select("id,player_id,points,correct_votes,impostor_tally_survivals,votes_received,last_votes_received,memorable_clue_awards").eq("room_id", roomId),
        client.from("score_events").select("id,room_id,round_id,player_id,delta,reason,created_at").eq("room_id", roomId).order("created_at", { ascending: false }).limit(120),
        roleRowsPromise,
        directMessagesPromise
      ]);
      const responseErrors = [hintsResponse, votesResponse, discussionResponse, eventsResponse, scoresResponse, scoreEventsResponse, roleResponse].map((response) => response.error).filter(Boolean);
      const directErrors = directResponses.flatMap ? directResponses.map((response) => response.error).filter(Boolean) : [];
      if (responseErrors.length || directErrors.length) throw new Error(`Supabase cloud snapshot query failed: ${(responseErrors[0] || directErrors[0]).message}`);

      const playersWithVisibleRoles = publicPlayers.map((player) => ({ ...player, role: player.id === viewerPlayer?.id ? viewerPlayer.role : null }));
      (roleResponse.data || []).forEach((role) => {
        const player = playersWithVisibleRoles.find((entry) => entry.id === role.id);
        if (player) player.role = role.role;
      });

      let hostData = null;
      if (verifiedHost) {
        const [{ data: roomPacks, error: roomPacksError }, { data: usedWordRows, error: usedWordsError }] = await Promise.all([
          client.from("room_word_packs").select("pack_id,enabled").eq("room_id", roomId),
          client.from("used_word_entries").select("word_entry_id").eq("room_id", roomId)
        ]);
        if (roomPacksError || usedWordsError) throw new Error(`Supabase host snapshot query failed: ${(roomPacksError || usedWordsError).message}`);
        const packIds = (roomPacks || []).map((entry) => entry.pack_id);
        const enabledPackIds = (roomPacks || []).filter((entry) => entry.enabled).map((entry) => entry.pack_id);
        const [{ data: packRows, error: packsError }, { data: entryRows, error: entriesError }] = packIds.length
          ? await Promise.all([
            client.from("word_packs").select("pack_id,name,version,is_default").in("pack_id", packIds).order("is_default", { ascending: false }).order("name"),
            client.from("word_pack_entries").select("pack_id,entry_id,category,word").in("pack_id", packIds).order("entry_id")
          ])
          : [{ data: [], error: null }, { data: [], error: null }];
        if (packsError || entriesError) throw new Error(`Supabase host word snapshot query failed: ${(packsError || entriesError).message}`);
        const usedWordIds = new Set((usedWordRows || []).map((entry) => entry.word_entry_id));
        const selectedCategories = Array.isArray(room.selected_categories) ? room.selected_categories : [];
        hostData = {
          packs: (packRows || []).map((pack) => ({ packId: pack.pack_id, name: pack.name, version: Number(pack.version), isDefault: Boolean(pack.is_default), enabled: enabledPackIds.includes(pack.pack_id), entryCount: (entryRows || []).filter((entry) => entry.pack_id === pack.pack_id).length, categories: [...new Set((entryRows || []).filter((entry) => entry.pack_id === pack.pack_id).map((entry) => entry.category))] })),
          categories: [...new Set((entryRows || []).filter((entry) => enabledPackIds.includes(entry.pack_id)).map((entry) => entry.category))],
          wordChoices: (entryRows || []).filter((entry) => enabledPackIds.includes(entry.pack_id) && !usedWordIds.has(`${entry.pack_id}:${entry.entry_id}`) && (!selectedCategories.length || selectedCategories.includes(entry.category))).map((entry) => ({ id: `${entry.pack_id}:${entry.entry_id}`, entryId: Number(entry.entry_id), category: entry.category, word: entry.word, packId: entry.pack_id }))
        };
      }
      const directMessages = directResponses.flatMap ? [...new Map(directResponses.flatMap((response) => response.data || []).map((message) => [message.id, message])).values()] : [];
      return buildCloudSnapshot({ room, players: playersWithVisibleRoles, round, hints: hintsResponse.data || [], votes: votesResponse.data || [], directMessages, discussionMessages: discussionResponse.data || [], events: eventsResponse.data || [], scores: scoresResponse.data || [], scoreEvents: scoreEventsResponse.data || [], viewer: { playerId: viewerPlayer?.id || null, isHost: verifiedHost, peek: verifiedHost && Boolean(peek) }, hostData });
    },
    async seedWordPack({ id, packId, name, version, filePath, uploadedAt, isDefault, entries }) {
      if (!Array.isArray(entries) || !entries.length) throw new Error("Supabase word pack seed requires at least one entry.");
      return callRpc("word_impostor_seed_pack", {
        p_id: id,
        p_pack_id: packId,
        p_name: name,
        p_version: version,
        p_file_path: filePath,
        p_uploaded_at: uploadedAt,
        p_is_default: Boolean(isDefault),
        p_entries: entries.map(({ id: entryId, category, word, impostorHint }) => ({ id: entryId, category, word, impostorHint }))
      });
    },
    async createRoomAtomically({ operationId, room, creatorPlayer = null, eventId = null }) {
      return callRpc("word_impostor_create_room", {
        p_operation_id: operationId,
        p_room_id: room.id,
        p_room_code: room.roomCode,
        p_password_hash: room.passwordHash,
        p_host_user_id: room.hostUserId,
        p_host_token: room.hostToken,
        p_created_at: room.createdAt,
        p_creator_player_id: creatorPlayer?.id || null,
        p_creator_user_id: creatorPlayer?.userId || null,
        p_creator_session_token: creatorPlayer?.sessionToken || null,
        p_creator_avatar_id: creatorPlayer?.avatarId || null,
        p_creator_avatar_color: creatorPlayer?.avatarColor || null,
        p_creator_joined_at: creatorPlayer?.joinedAt || null,
        p_event_id: eventId
      });
    },
    async joinOrReclaimPlayerAtomically({ operationId, roomId, existingSessionToken = null, userId, isGhost, player }) {
      return callRpc("word_impostor_join_or_reclaim_player", {
        p_operation_id: operationId,
        p_room_id: roomId,
        p_existing_session_token: existingSessionToken || null,
        p_user_id: userId,
        p_is_ghost: Boolean(isGhost),
        p_new_player_id: player.id,
        p_new_session_token: player.sessionToken,
        p_avatar_id: player.avatarId,
        p_avatar_color: player.avatarColor,
        p_joined_at: player.joinedAt
      });
    },
    async purgeRoomSession(roomId) {
      return callRpc("word_impostor_purge_room_session", { p_room_id: roomId });
    },
    async leavePlayerAtomically({ operationId, roomId, sessionToken, createdAt }) {
      return callRpc("word_impostor_leave_player", { p_operation_id: operationId, p_room_id: roomId, p_session_token: sessionToken, p_created_at: createdAt });
    },
    async uploadWordPackAtomically({ operationId, roomId, hostToken, pack, createdAt }) {
      return callRpc("word_impostor_upload_word_pack", { p_operation_id: operationId, p_room_id: roomId, p_host_token: hostToken, p_pack: pack, p_created_at: createdAt });
    },
    async setWordPackEnabledAtomically({ operationId, roomId, hostToken, packId, enabled, createdAt }) {
      return callRpc("word_impostor_set_word_pack_enabled", { p_operation_id: operationId, p_room_id: roomId, p_host_token: hostToken, p_pack_id: packId, p_enabled: Boolean(enabled), p_created_at: createdAt });
    },
    async deleteWordPackAtomically({ operationId, roomId, hostToken, packId, createdAt }) {
      return callRpc("word_impostor_delete_word_pack", { p_operation_id: operationId, p_room_id: roomId, p_host_token: hostToken, p_pack_id: packId, p_created_at: createdAt });
    },
    async abstainDisconnectedVoterAtomically({ operationId, roomId, hostToken, playerId, voteId, createdAt }) { return callRpc("word_impostor_abstain_disconnected_voter", { p_operation_id: operationId, p_room_id: roomId, p_host_token: hostToken, p_player_id: playerId, p_vote_id: voteId, p_created_at: createdAt }); },
    async editHintAtomically({ operationId, roomId, hostToken, hintId, content, createdAt }) { return callRpc("word_impostor_edit_hint", { p_operation_id: operationId, p_room_id: roomId, p_host_token: hostToken, p_hint_id: hintId, p_content: content, p_created_at: createdAt }); },
    async removeDiscussionMessageAtomically({ operationId, roomId, hostToken, messageId, createdAt }) { return callRpc("word_impostor_remove_discussion_message", { p_operation_id: operationId, p_room_id: roomId, p_host_token: hostToken, p_message_id: messageId, p_created_at: createdAt }); },
    async markMemorableClueAtomically({ operationId, roomId, hostToken, hintId, createdAt }) { return callRpc("word_impostor_mark_memorable_clue", { p_operation_id: operationId, p_room_id: roomId, p_host_token: hostToken, p_hint_id: hintId, p_created_at: createdAt }); },
    async createAlertAtomically({ operationId, roomId, hostToken, alertId, message, targetPlayerId = null, type, createdAt }) { return callRpc("word_impostor_create_alert", { p_operation_id: operationId, p_room_id: roomId, p_host_token: hostToken, p_alert_id: alertId, p_message: message, p_target_player_id: targetPlayerId, p_type: type, p_created_at: createdAt }); },
    async startRoundAtomically({ operationId, roomId, round, wordChoiceKey, impostorPlayerIds, eventId }) {
      return callRpc("word_impostor_start_round", {
        p_operation_id: operationId,
        p_room_id: roomId,
        p_round: round,
        p_word_choice_key: wordChoiceKey,
        p_impostor_player_ids: impostorPlayerIds,
        p_event_id: eventId
      });
    },
    async submitHintAtomically({ operationId, roomId, sessionToken, hintId, content, createdAt }) {
      return callRpc("word_impostor_submit_hint", {
        p_operation_id: operationId,
        p_room_id: roomId,
        p_session_token: sessionToken,
        p_hint_id: hintId,
        p_content: content,
        p_created_at: createdAt
      });
    },
    async castVoteAtomically({ operationId, roomId, sessionToken, voteId, targetPlayerId = null, skipped = false, createdAt }) {
      return callRpc("word_impostor_cast_vote", {
        p_operation_id: operationId,
        p_room_id: roomId,
        p_session_token: sessionToken,
        p_vote_id: voteId,
        p_target_player_id: targetPlayerId,
        p_skipped: Boolean(skipped),
        p_created_at: createdAt
      });
    },
    async resolveVoteTallyAtomically({ operationId, roomId, createdAt }) {
      return callRpc("word_impostor_resolve_vote_tally", {
        p_operation_id: operationId,
        p_room_id: roomId,
        p_created_at: createdAt
      });
    },
    async continueRoundAtomically({ operationId, roomId, createdAt }) {
      return callRpc("word_impostor_continue_round", {
        p_operation_id: operationId,
        p_room_id: roomId,
        p_created_at: createdAt
      });
    },
    async sendDirectMessageAtomically({ operationId, roomId, sessionToken, messageId, recipientPlayerId, content, createdAt }) {
      return callRpc("word_impostor_send_direct_message", {
        p_operation_id: operationId,
        p_room_id: roomId,
        p_session_token: sessionToken,
        p_message_id: messageId,
        p_recipient_player_id: recipientPlayerId,
        p_content: content,
        p_created_at: createdAt
      });
    },
    async postDiscussionMessageAtomically({ operationId, roomId, sessionToken, messageId, content, createdAt }) {
      return callRpc("word_impostor_post_discussion_message", {
        p_operation_id: operationId,
        p_room_id: roomId,
        p_session_token: sessionToken,
        p_message_id: messageId,
        p_content: content,
        p_created_at: createdAt
      });
    },
    async setReadyAtomically({ operationId, roomId, sessionToken, ready, createdAt }) {
      return callRpc("word_impostor_set_ready", { p_operation_id: operationId, p_room_id: roomId, p_session_token: sessionToken, p_ready: Boolean(ready), p_created_at: createdAt });
    },
    async setPresenceAtomically({ operationId, roomId, sessionToken, connected, createdAt }) {
      return callRpc("word_impostor_set_presence", { p_operation_id: operationId, p_room_id: roomId, p_session_token: sessionToken, p_connected: Boolean(connected), p_created_at: createdAt });
    },
    async updateLobbySettingsAtomically({ operationId, roomId, hostToken, changes, createdAt }) {
      return callRpc("word_impostor_update_lobby_settings", { p_operation_id: operationId, p_room_id: roomId, p_host_token: hostToken, p_changes: changes, p_created_at: createdAt });
    },
    async reorderPlayersAtomically({ operationId, roomId, hostToken, playerIds, createdAt }) {
      return callRpc("word_impostor_reorder_players", { p_operation_id: operationId, p_room_id: roomId, p_host_token: hostToken, p_player_ids: playerIds, p_created_at: createdAt });
    },
    async nextTurnAtomically({ operationId, roomId, hostToken, createdAt }) {
      return callRpc("word_impostor_next_turn", { p_operation_id: operationId, p_room_id: roomId, p_host_token: hostToken, p_created_at: createdAt });
    },
    async setDiscussionLockedAtomically({ operationId, roomId, hostToken, locked, createdAt }) {
      return callRpc("word_impostor_set_discussion_locked", { p_operation_id: operationId, p_room_id: roomId, p_host_token: hostToken, p_locked: Boolean(locked), p_created_at: createdAt });
    },
    async revealRolesAtomically({ operationId, roomId, hostToken, eventId, createdAt }) {
      return callRpc("word_impostor_reveal_roles", { p_operation_id: operationId, p_room_id: roomId, p_host_token: hostToken, p_event_id: eventId, p_created_at: createdAt });
    },
    async kickPlayerAtomically({ operationId, roomId, hostToken, playerId, createdAt }) {
      return callRpc("word_impostor_kick_player", { p_operation_id: operationId, p_room_id: roomId, p_host_token: hostToken, p_player_id: playerId, p_created_at: createdAt });
    }
  };
}
