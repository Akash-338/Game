import { motion } from "framer-motion";
import { Check, Sparkles, UsersRound } from "lucide-react";
import { send } from "../lib/gameSocket.js";
import { PrimaryButton } from "../components/buttons.jsx";
import { HostReconnectNotice, Roster, TopBar } from "../components/gameShell.jsx";

export function PlayerLobby({ game, identity, fail, onLeave, hostReconnectDeadline, onSwitchToHost }) {
  const me = game?.players?.find((player) => player.id === identity.playerId);
  const active = game?.players?.filter((player) => !player.isGhost) || [];
  const waiting = active.filter((player) => !player.isReady || !player.isConnected);
  const ready = async () => {
    try {
      await send("setReady", { sessionToken: identity.sessionToken, isReady: !me?.isReady });
    } catch (error) {
      fail(error.message);
    }
  };

  return <section className="player-layout"><TopBar game={game} player={me} onLeave={onLeave} host={identity.role === "host"} modeAction={onSwitchToHost ? { label: "Host view", onClick: onSwitchToHost } : null}/><div className="mobile-content"><HostReconnectNotice deadline={hostReconnectDeadline}/><motion.div className="lobby-hero" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}><div className="title-row"><p className="eyebrow">The room is gathering</p><Sparkles size={19}/></div><h2>{identity.isGhost ? "You are observing" : "Get ready to bluff."}</h2><p>{identity.isGhost ? "Ghosts can see the live game without joining the turn order." : waiting.length ? `${waiting.length} player${waiting.length > 1 ? "s are" : " is"} not ready yet.` : "Everyone is ready. The host can begin."}</p></motion.div><Roster players={game?.players || []} currentId={null} compact/><div className="lobby-status"><UsersRound size={18}/><span>{active.filter((player) => player.isReady).length} / {active.length} ready</span><div className="ready-meter"><span style={{ width: `${active.length ? active.filter((player) => player.isReady).length / active.length * 100 : 0}%` }}/></div></div></div>{!identity.isGhost && <div className="mobile-action"><PrimaryButton onClick={ready} disabled={Boolean(hostReconnectDeadline)} className={me?.isReady ? "ready-button is-ready" : "ready-button"}>{me?.isReady ? <><Check size={18}/> Ready — tap to undo</> : <><Sparkles size={18}/> I’m ready</>}</PrimaryButton></div>}</section>;
}
