import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Eye, EyeOff, KeyRound, Mic2, PartyPopper, ShieldQuestion, Trophy, Vote } from "lucide-react";
import { buildPlayerHintCards } from "../hintBoardModel.js";
import { getRoleRevealState } from "../roleRevealModel.js";
import { formatPublicVoteResult } from "../voteResultModel.js";
import { send } from "../lib/gameSocket.js";
import { PrimaryButton } from "../components/buttons.jsx";
import { Avatar, HostReconnectNotice, Presence, TopBar } from "../components/gameShell.jsx";

export function RoleEnvelope({ role }) {
  const [open, setOpen] = useState(false);
  const reveal = getRoleRevealState(role, open);
  if (!reveal) return <div className="role-placeholder"><ShieldQuestion size={31}/><p>Your private card will arrive when the host begins.</p></div>;

  return <motion.button type="button" className={`role-vault ${open ? "open" : "sealed"} ${reveal.isImposter ? "imposter" : "civilian"}`} onClick={() => setOpen((wasOpen) => !wasOpen)} aria-expanded={open} aria-label={open ? "Hide your private role card" : "Reveal your private role card"} whileTap={{ scale: .985 }}>
    <span className="role-vault-surface">
      <span className="role-vault-pattern" aria-hidden="true"/>
      <span className="role-vault-status" aria-hidden="true">{open ? <EyeOff size={16}/> : <KeyRound size={16}/>} {open ? "Private view" : "Sealed"}</span>
      <AnimatePresence initial={false} mode="wait">
        {open ? <motion.span key="revealed" className="role-vault-secret" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: .18 }}>
          <small>{reveal.label}</small><strong>{reveal.title}</strong>{reveal.detail && <span className="role-vault-detail">{reveal.detail}</span>}<em><EyeOff size={14}/> {reveal.action}</em>
        </motion.span> : <motion.span key="sealed" className="role-vault-cover" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: .18 }}>
          <small>{reveal.label}</small><strong>{reveal.action}</strong><span>{reveal.message}</span><em><KeyRound size={14}/> Reveal only when ready</em>
        </motion.span>}
      </AnimatePresence>
    </span>
  </motion.button>;
}

export function HintBoard({ players, hints, hostToken, fail, onMarkMemorable }) {
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");
  const cards = useMemo(() => buildPlayerHintCards(players, hints), [players, hints]);
  const update = async () => {
    try {
      await send("editHint", { hostToken, hintId: editing.id, content: draft });
      setEditing(null);
    } catch (error) {
      fail?.(error.message);
    }
  };
  if (!cards.length) return <div className="hint-board player-hint-board"><div className="empty-hints"><Mic2 size={24}/><p>Hints will gather here.</p></div></div>;
  return <div className="hint-board player-hint-board">{cards.map(({ player, hints: playerHints }) => {
    const connected = Boolean(player.isConnected);
    return <motion.article key={player.id} className={`player-hint-card ${connected ? "" : "is-offline"}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <header className="player-hint-card-header">
        <Avatar player={player} size="small"/>
        <div className="player-hint-card-name"><strong>{player.userId}</strong><span className="player-hint-status"><Presence connected={connected}/>{connected ? "Connected" : "Offline"}</span></div>
      </header>
      <div className="player-hint-card-content">
        {playerHints.length ? <table className="player-hint-table">
          <thead><tr><th scope="col">No.</th><th scope="col">Round</th><th scope="col">Hint</th></tr></thead>
          <tbody>{playerHints.map((hint, index) => <tr key={hint.id}>
            <td className="player-hint-sequence">{index + 1}</td>
            <td className="player-hint-round">{hint.cycleNumber || 1}</td>
            <td className="player-hint-content">{editing?.id === hint.id ? <div className="edit-hint"><input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength="80" autoFocus aria-label={`Edit ${player.userId}'s hint`}/><button onClick={update} aria-label="Save host hint edit"><Check size={15}/></button></div> : <><span>{hint.content}</span>{hint.editedByHost && <small>Host corrected</small>}{hint.memorable && <small className="memorable-clue"><Trophy size={12}/> Memorable clue</small>}{hostToken && <button className="hint-edit" onClick={() => { setEditing(hint); setDraft(hint.content); }}>Edit</button>}{onMarkMemorable && <button className="hint-edit memorable-toggle" onClick={() => onMarkMemorable(hint.id)}>{hint.memorable ? "Remove award" : "Award +1"}</button>}</>}</td>
          </tr>)}</tbody>
        </table> : <div className="player-hint-empty">{connected ? "No clues yet." : "Offline — no clues recorded."}</div>}
      </div>
    </motion.article>;
  })}</div>;
}

export function VotingPanel({ game, identity, isGhost, fail }) {
  const [target, setTarget] = useState("");
  const ballot = game?.ballot;
  useEffect(() => { setTarget(""); }, [ballot?.voteNumber, ballot?.phase]);
  if (!ballot?.open) return null;
  const castVote = async (event) => {
    event.preventDefault();
    try { await send("submitVote", { sessionToken: identity.sessionToken, targetPlayerId: target }); setTarget(""); }
    catch (error) { fail(error.message); }
  };
  const skipVote = async () => {
    try { await send("submitSkipVote", { sessionToken: identity.sessionToken }); setTarget(""); }
    catch (error) { fail(error.message); }
  };
  return <section className="vote-panel" aria-live="polite"><div className="vote-panel-heading"><Vote size={21}/><div><small>{ballot.isRunoff ? "LIVE PUBLIC RE-VOTE" : `LIVE PUBLIC VOTE ${ballot.voteNumber}`}</small><h3>{ballot.isRunoff ? "Choose from the tied players" : "Who should leave the table?"}</h3></div></div><p className="vote-progress"><strong>{ballot.submittedCount}/{ballot.eligibleCount}</strong> active players have voted. Each confirmed choice is shown live below.</p><div className="live-vote-feed" aria-label="Live public votes"><small>LIVE VOTE FEED</small>{ballot.liveVotes?.length ? ballot.liveVotes.map((entry) => <article key={entry.id}><Avatar player={entry.voter} size="small"/><p><strong>{entry.voter.userId}</strong> {entry.abstained ? "was recorded absent from this vote." : entry.skipped ? "skipped this vote." : <>voted for <strong>{entry.target?.userId || "an unavailable player"}</strong>.</>}</p><time dateTime={new Date(entry.createdAt).toISOString()}>{new Date(entry.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></article>) : <p className="live-vote-empty">Votes will appear here as players confirm them.</p>}</div>{isGhost ? <p className="vote-read-only"><Eye size={15}/> Ghosts can watch the public vote but cannot cast a ballot.</p> : ballot.hasSubmitted ? <p className="vote-locked"><Check size={16}/> Your vote is public and locked. Waiting for the others.</p> : <form className="vote-options" onSubmit={castVote}>{ballot.candidates.map((player) => <label key={player.id} className={`vote-option ${player.id === identity.playerId ? "self" : ""}`}><input type="radio" name="vote-target" value={player.id} checked={target === player.id} disabled={player.id === identity.playerId} onChange={(event) => setTarget(event.target.value)}/><Avatar player={player} size="small"/><span>{player.userId}</span>{player.id === identity.playerId && <small>You</small>}</label>)}<div className="vote-actions"><PrimaryButton type="submit" disabled={!target}>Cast my public vote <Vote size={17}/></PrimaryButton><button type="button" className="skip-vote-button" onClick={skipVote}>Skip this vote</button></div></form>}</section>;
}

export function VoteResolutionCard({ voteResult, winner }) {
  const message = formatPublicVoteResult({ eliminated: voteResult?.eliminated, winner });
  if (!message) return null;
  return <motion.section className="vote-resolution-card" role="status" aria-live="polite" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}><Vote size={20}/><div><small>VOTE RESOLUTION</small><strong>{message}</strong></div></motion.section>;
}

export function PlayerGame({ game, identity, fail, onLeave, hostReconnectDeadline, onSwitchToHost }) {
  const me = game?.players?.find((player) => player.id === identity.playerId); const current = game?.players?.find((player) => player.id === game?.currentTurnPlayerId); const [hint, setHint] = useState(""); const cycleNumber = game?.round?.currentHintCycle || 1; const alreadySubmitted = game?.hints?.some((item) => item.playerId === identity.playerId && item.cycleNumber === cycleNumber); const isMyTurn = current?.id === identity.playerId; const isGhost = Boolean(me?.isGhost); const hostWaiting = Boolean(hostReconnectDeadline); const submit = async (event) => { event.preventDefault(); try { await send("submitHint", { sessionToken: identity.sessionToken, content: hint }); setHint(""); } catch (error) { fail(error.message); } };
  const placeholder = hostWaiting ? "Waiting for the host to return" : isMyTurn ? alreadySubmitted ? "Your clue is saved" : "Write one subtle hint…" : current ? `Waiting for ${current.userId}` : "Waiting for the next turn";
  return <section className="player-layout game-view"><TopBar game={game} player={me} onLeave={onLeave} host={identity.role === "host"} modeAction={onSwitchToHost ? { label: "Host view", onClick: onSwitchToHost } : null}/><AnimatePresence><HostReconnectNotice deadline={hostReconnectDeadline}/></AnimatePresence><div className="turn-banner"><span className="turn-pulse"/><span>{hostWaiting ? "The room is paused for the host" : isGhost ? "You are now watching as a Ghost" : game?.ballot?.open ? "Voting is open — choose carefully" : isMyTurn ? "Your turn — give one careful clue" : current ? `${current.userId} is giving a clue` : "The round is beginning"}</span></div><div className="mobile-content game-content"><RoleEnvelope role={game?.ownRole}/><VoteResolutionCard voteResult={game?.voteResult} winner={game?.room?.winner}/>{isGhost && <GhostRoles roles={game?.roles}/>}<VotingPanel game={game} identity={identity} isGhost={isGhost} fail={fail}/><section><div className="section-head"><div><small>THE TABLE IS SAYING</small><h3>Clue notes</h3></div><span className="hint-count">{game?.hints?.length || 0}</span></div><HintBoard players={game?.players} hints={game?.hints}/></section></div>{!isGhost && !game?.ballot?.open && <form className="hint-composer" onSubmit={submit}><input value={hint} onChange={(event) => setHint(event.target.value)} disabled={hostWaiting || !isMyTurn || alreadySubmitted} placeholder={placeholder} maxLength="80" aria-label="Your current-round clue"/><PrimaryButton disabled={hostWaiting || !hint.trim() || !isMyTurn || alreadySubmitted} type="submit" aria-label="Submit your clue">{alreadySubmitted ? <Check size={18}/> : <ChevronRight size={18}/>}</PrimaryButton></form>}</section>;
}

export function GhostRoles({ roles }) { return <section className="ghost-roles"><div><Eye size={16}/><strong>Ghost role view</strong></div>{roles?.map((role) => <span key={role.playerId}>{role.userId}: <b>{role.role}</b></span>)}</section>; }

export function RoundScoreboard({ game }) {
  const roundId = game?.round?.id;
  const changes = (game?.scoreEvents || []).filter((event) => event.roundId === roundId).reduce((totals, event) => ({ ...totals, [event.playerId]: (totals[event.playerId] || 0) + Number(event.delta || 0) }), {});
  const rows = [...(game?.scores || [])].sort((left, right) => Number(right.points) - Number(left.points) || left.userId.localeCompare(right.userId));
  return <section className="round-scoreboard" aria-label="Cumulative score results"><div className="round-score-heading"><div><small>ROUND SCOREBOARD</small><h3>Totals carry through this game</h3></div><Trophy size={20}/></div>{rows.length ? <div className="round-score-list">{rows.map((score, index) => { const delta = Number(changes[score.playerId] || 0); return <article key={score.playerId} className={score.isGhost ? "ghost-score" : ""}><span className="round-score-rank">{index + 1}</span><Avatar player={score} size="small"/><div><strong>{score.userId}</strong><small>{delta ? `${delta > 0 ? "+" : ""}${delta} this round` : "No score change this round"}</small></div><b>{score.points} <em>pts</em></b></article>; })}</div> : <p className="activity-empty">Scores will appear once a round awards points.</p>}</section>;
}

export function Results({ game, identity, onLeave, hostReconnectDeadline, onSwitchToHost }) { const me = game?.players?.find((player) => player.id === identity.playerId); const impostors = game?.roles?.filter((role) => role.role === "impostor") || []; const title = impostors.length === 1 ? "The impostor was…" : impostors.length > 1 ? "The impostors were…" : "Revealing the impostors…"; return <section className="player-layout results-view"><TopBar game={game} player={me} onLeave={onLeave} host={identity.role === "host"} modeAction={onSwitchToHost ? { label: "Host view", onClick: onSwitchToHost } : null}/><div className="mobile-content"><HostReconnectNotice deadline={hostReconnectDeadline}/><motion.div className="results-hero" initial={{ opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }}><PartyPopper size={32}/><p className="eyebrow">The secret is out</p><h2>{title}</h2><div className="impostor-reveal">{impostors.map((person) => <div key={person.playerId}><Avatar player={person}/><strong>{person.userId}</strong></div>)}</div><VoteResolutionCard voteResult={game?.voteResult} winner={game?.room?.winner}/><div className="answer-reveal"><small>THE WORD</small><strong>{game?.round?.actualWord}</strong><span>{game?.round?.category}</span></div></motion.div><RoundScoreboard game={game}/><section><div className="section-head"><div><small>ROUND RECAP</small><h3>All clues</h3></div></div><HintBoard players={game?.players} hints={game?.hints}/></section></div></section>; }
