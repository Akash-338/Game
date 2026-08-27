import { useContext, useEffect, useRef, useState } from "react";
import { Eye, MessageCircle, Send } from "lucide-react";
import { shouldDismissRoomActivity } from "../activityDockModel.js";
import { send } from "../lib/gameSocket.js";
import { RoomActivityContext } from "../roomActivityContext.js";
import { Avatar } from "../components/gameShell.jsx";

function participantFor(message, identity) {
  const isSender = message.senderPlayerId === identity.playerId;
  return isSender
    ? { id: message.recipientPlayerId, userId: message.recipientUserId, avatarId: message.recipientAvatarId, avatarColor: message.recipientAvatarColor, direction: "To" }
    : { id: message.senderPlayerId, userId: message.senderUserId, avatarId: message.senderAvatarId, avatarColor: message.senderAvatarColor, direction: "From" };
}

export function RoomActivityPanel({ game, identity, fail }) {
  const roomActivity = useContext(RoomActivityContext);
  const open = roomActivity?.open || false;
  const setOpen = roomActivity?.setOpen || (() => {});
  const panelRef = useRef(null);
  const [message, setMessage] = useState("");
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const isParticipant = Boolean(identity.playerId);
  const me = isParticipant ? game?.players?.find((player) => player.id === identity.playerId) : null;
  const remainingSeconds = Math.max(0, Math.ceil((cooldownUntil - clock) / 1000));
  const canMessage = isParticipant && !me?.isGhost && !remainingSeconds;
  const recipients = (game?.players || []).filter((player) => player.id !== identity.playerId && !player.isGhost && !player.isKicked);

  useEffect(() => {
    if (!open) return undefined;
    const dismiss = (event, interaction) => {
      const target = event.target;
      const clickedInsidePanel = target instanceof Node && Boolean(panelRef.current?.contains(target));
      const clickedTrigger = target instanceof Element && Boolean(target.closest(".room-activity-button"));
      if (shouldDismissRoomActivity({ clickedInsidePanel, clickedTrigger, key: event.key, interaction, scrolledInsidePanel: interaction === "scroll" && clickedInsidePanel })) setOpen(false);
    };
    const pointer = (event) => dismiss(event, "pointer");
    const focus = (event) => dismiss(event, "focus");
    const scroll = (event) => dismiss(event, "scroll");
    const keyboard = (event) => dismiss(event, "keyboard");
    document.addEventListener("pointerdown", pointer); document.addEventListener("focusin", focus); document.addEventListener("scroll", scroll, true); document.addEventListener("keydown", keyboard);
    return () => { document.removeEventListener("pointerdown", pointer); document.removeEventListener("focusin", focus); document.removeEventListener("scroll", scroll, true); document.removeEventListener("keydown", keyboard); };
  }, [open, setOpen]);

  useEffect(() => {
    if (!cooldownUntil || remainingSeconds <= 0) return undefined;
    const timer = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [cooldownUntil, remainingSeconds]);

  const post = async (event) => {
    event.preventDefault();
    try {
      await send("postDirectMessage", { sessionToken: identity.sessionToken, content: message });
      setMessage(""); setCooldownUntil(Date.now() + 3000); setClock(Date.now());
    } catch (error) { fail(error.message); }
  };

  return <aside className={`activity-dock ${open ? "open" : ""}`} aria-label="Private messages">
    {open && <div ref={panelRef} className="activity-panel private-message-panel">
      <header className="private-message-header"><span className="private-message-icon"><MessageCircle size={16}/></span><div><strong>Private messages</strong><small>Only you and the tagged player can read each message.</small></div></header>
      {isParticipant ? <>
        <div className="private-message-list">{game?.directMessages?.length ? game.directMessages.map((entry) => {
          const participant = participantFor(entry, identity);
          return <article key={entry.id} className={`private-message ${entry.senderPlayerId === identity.playerId ? "sent" : "received"}`}><Avatar player={participant} size="small"/><div><header><span>{participant.direction} <strong>{participant.userId}</strong></span><time dateTime={new Date(entry.createdAt).toISOString()}>{new Date(entry.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></header><p>{entry.content}</p></div></article>;
        }) : <p className="activity-empty">Send a private note with <strong>@name message</strong>. It is never shown to the full room.</p>}</div>
        {canMessage ? <form className="private-message-composer" onSubmit={post}><div className="private-recipient-chips">{recipients.length ? recipients.map((player) => <button type="button" key={player.id} onClick={() => setMessage((current) => current.startsWith(`@${player.userId} `) ? current : `@${player.userId} ${current.replace(/^@[^\s]+\s*/, "")}`)}><Avatar player={player} size="small"/>@{player.userId}</button>) : <span>No active recipients available.</span>}</div><div className="private-input-row"><input value={message} onChange={(event) => setMessage(event.target.value)} maxLength="180" placeholder="@player your private message…" aria-label="Tagged private message" autoComplete="off"/><button disabled={!message.trim()} aria-label="Send private message"><Send size={16}/></button></div></form> : <p className="discussion-read-only"><Eye size={14}/>{me?.isGhost ? "Ghosts can read only their existing private messages." : remainingSeconds ? `Wait ${remainingSeconds}s before sending again.` : "Private messaging is unavailable."}</p>}
      </> : <p className="discussion-read-only"><Eye size={14}/>Private messages belong only to the players in the conversation.</p>}
    </div>}
  </aside>;
}
