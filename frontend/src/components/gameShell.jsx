import { useContext, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { BellRing, Check, Crown, LogOut, MessageCircle, Timer, X } from "lucide-react";
import { getAvatarInitials } from "../avatarModel.js";
import { socket } from "../lib/gameSocket.js";
import { RoomActivityContext } from "../roomActivityContext.js";
import { subscribeToConnectionStatus } from "../socketConnectionModel.js";

const formatTime = (milliseconds) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};

export function Avatar({ player, size = "normal" }) {
  return <span className={`avatar avatar-${size}`} style={{ "--avatar": player.avatarColor }} aria-label={`${player.userId}'s avatar`}><span>{getAvatarInitials(player.userId)}</span></span>;
}

export function Presence({ connected }) {
  return <span className={`presence ${connected ? "online" : "offline"}`} role="img" aria-label={connected ? "Connected" : "Disconnected"} title={connected ? "Connected" : "Disconnected"} />;
}

export function TopBar({ game, player, onLeave, host = false, modeAction = null }) {
  const roomActivity = useContext(RoomActivityContext);
  const activityCount = game?.directMessages?.length || 0;
  const [connected, setConnected] = useState(() => Boolean(socket.connected));

  useEffect(() => subscribeToConnectionStatus(socket, setConnected), []);

  return <header className="topbar"><div className="room-badge"><span className="room-candle"/><span><small>ROOM</small><strong>{game?.room?.roomCode || "—"}</strong></span></div><div className="topbar-right">{roomActivity && <button className={`icon-button room-activity-button ${roomActivity.open ? "active" : ""}`} onClick={() => roomActivity.setOpen(!roomActivity.open)} title="Open private messages" aria-label="Open private messages" aria-expanded={roomActivity.open}><MessageCircle size={18}/>{activityCount > 0 && <b className="activity-count" aria-label={`${activityCount} private messages`}>{activityCount > 9 ? "9+" : activityCount}</b>}</button>}{modeAction && <button className="mode-switch-button" onClick={modeAction.onClick}>{modeAction.label}</button>}{player && <><Avatar player={player} size="small"/><span className="user-label">{player.userId}</span></>}<span className="connection-label"><Presence connected={connected}/>{connected ? "Live" : "Offline"}</span>{host && <span className="host-pill"><Crown size={13}/> Host</span>}<button className="icon-button" onClick={onLeave} title={host ? "End room" : "Leave room"} aria-label={host ? "End this room" : "Leave this room and remove yourself from the table"}><LogOut size={18}/></button></div></header>;
}

export function HostReconnectNotice({ deadline }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, Number(deadline || 0) - Date.now()));

  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, Number(deadline || 0) - Date.now()));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [deadline]);

  if (!deadline) return null;
  return <motion.section className="host-reconnect-notice" role="status" aria-live="polite" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}><Timer size={20}/><div><strong>Waiting for the Host to Join</strong><span>The room is paused. The host has {formatTime(remaining)} to return.</span></div></motion.section>;
}

export function Roster({ players, currentId, compact = false, onNudge, onKick }) {
  return <div className={`roster ${compact ? "compact" : ""}`}>{players.map((player) => <motion.div className={`player-row ${player.id === currentId ? "current" : ""} ${player.isGhost ? "ghost-player" : ""}`} key={player.id} layout><Avatar player={player}/><div className="player-copy"><strong>{player.userId}</strong><small>{player.isGhost ? "Ghost observer" : player.id === currentId ? "Giving a hint now" : player.isReady ? "Ready at the table" : "Not ready"}</small></div><div className="player-traits"><Presence connected={player.isConnected}/>{player.isReady && !player.isGhost && <span className="ready-tag"><Check size={12}/> Ready</span>}{onNudge && !player.isGhost && <button className="mini-action" onClick={() => onNudge(player)} title="Nudge"><BellRing size={15}/></button>}{onKick && !player.isGhost && <button className="mini-action danger" onClick={() => onKick(player)} title="Kick"><X size={16}/></button>}</div></motion.div>)}</div>;
}
