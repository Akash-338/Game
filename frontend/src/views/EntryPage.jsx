import { motion } from "framer-motion";
import { useState } from "react";
import { Check, DoorOpen, Eye, KeyRound, Plus, Radio, ShieldQuestion, Sparkles } from "lucide-react";
import { PrimaryButton } from "../components/buttons.jsx";

const modeCopy = {
  join: { label: "Join room", title: "Pull up a chair", copy: "Enter the private table your friend created.", action: "Join the room" },
  create: { label: "Create room", title: "Set the table", copy: "Create a room, then switch between host controls and your own player view.", action: "Create room" },
  recover: { label: "Recover", title: "Return to the table", copy: "Recover the host controls for a room you already created.", action: "Recover room" }
};

export function EntryPage({ onCreate, onJoin, onRecover }) {
  const [mode, setMode] = useState("join");
  const [userId, setUserId] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [password, setPassword] = useState("");
  const [isGhost, setGhost] = useState(false);
  const [joining, setJoining] = useState(false);
  const config = modeCopy[mode];
  const submit = async (event) => {
    event.preventDefault(); setJoining(true);
    try {
      if (mode === "create") await onCreate({ userId: userId.trim(), roomCode, password });
      else if (mode === "recover") await onRecover({ roomCode, password });
      else await onJoin({ userId: userId.trim(), roomCode, password, isGhost });
    } finally { setJoining(false); }
  };
  const switchMode = (next) => { setMode(next); setGhost(false); };
  return <section className="entry-page"><motion.div className="entry-story" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .35 }}><div className="brand-mark"><ShieldQuestion size={25}/></div><p className="eyebrow">A tabletop mystery for friends</p><h1>The Word<br/><em>Impostor</em></h1><p className="story-copy">Everyone knows the word. Someone only has a hint. Find them before they find you.</p><div className="card-stack" aria-hidden="true"><span>?</span><span>?</span><span><Sparkles size={28}/></span></div></motion.div><motion.form className="entry-card entry-card-professional" onSubmit={submit} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .08, duration: .35 }}><div className="entry-card-top"><span className="chip"><Radio size={13}/> Live private room</span><span className="mini-dot"/></div><div className="entry-mode-tabs" role="tablist" aria-label="Room access"><button type="button" role="tab" aria-selected={mode === "join"} className={mode === "join" ? "active" : ""} onClick={() => switchMode("join")}><DoorOpen size={15}/> Join</button><button type="button" role="tab" aria-selected={mode === "create"} className={mode === "create" ? "active" : ""} onClick={() => switchMode("create")}><Plus size={15}/> Create</button></div><h2>{config.title}</h2><p>{config.copy}</p>{mode !== "recover" && <label>{mode === "create" ? "Your player name" : "Player name"}<input value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="e.g. Maya" maxLength="20" autoComplete="nickname" /></label>}<label>Room ID<input value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="e.g. ROSE7" maxLength="12" autoComplete="off" /></label><label>Room password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 4 characters" autoComplete={mode === "create" ? "new-password" : "current-password"} /></label>{mode === "join" && <button type="button" className={`ghost-choice ${isGhost ? "selected" : ""}`} onClick={() => setGhost(!isGhost)}><Eye size={17}/><span><strong>Join as a Ghost</strong><small>Watch the current round without playing</small></span><span className="check-circle">{isGhost && <Check size={14}/>}</span></button>}{mode === "create" && <p className="entry-host-note"><KeyRound size={15}/> You will receive both <b>Host controls</b> and a <b>player seat</b>. Switch views any time from the top bar.</p>}<PrimaryButton type="submit" disabled={!roomCode || password.length < 4 || (mode !== "recover" && !userId.trim()) || joining}>{joining ? "Opening room…" : config.action}{mode === "create" ? <Plus size={17}/> : <DoorOpen size={17}/>}</PrimaryButton>{mode !== "recover" ? <button type="button" className="recover-room-link" onClick={() => switchMode("recover")}>Already created this room? Recover host access</button> : <button type="button" className="recover-room-link" onClick={() => switchMode("join")}>Back to Join room</button>}</motion.form></section>;
}
