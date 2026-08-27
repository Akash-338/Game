import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { sameWordEntryId } from "../../backend/shared/wordEntryId.js";
import { buildPlayerHintCards } from "./hintBoardModel.js";
import { isDiscussionPinned } from "./discussionPanelModel.js";
import { shouldDismissRoomActivity } from "./activityDockModel.js";
import { getBackNavigation } from "./navigationModel.js";
import { formatPublicVoteResult } from "./voteResultModel.js";
import { clearSession, safeReadSession, saveSession, send, socket } from "./lib/gameSocket.js";
import { reconcilePlayerSessionMode } from "./playerSessionModel.js";
import { RoomActivityContext } from "./roomActivityContext.js";
import { shouldCloseRoomActivityOnGameTransition } from "./roomActivityTransitionModel.js";
import { GhostButton, PrimaryButton } from "./components/buttons.jsx";
import { Avatar, HostReconnectNotice, Presence, TopBar } from "./components/gameShell.jsx";
import { PlayerLobby } from "./views/PlayerLobby.jsx";
import { EntryPage } from "./views/EntryPage.jsx";
import { HostDashboard } from "./views/HostDashboard.jsx";
import { Decor } from "./components/Decor.jsx";
import { ErrorToast } from "./components/feedback.jsx";
import { GhostRoles, HintBoard, PlayerGame, Results, RoleEnvelope, VotingPanel } from "./views/GameplayViews.jsx";
import { RoomActivityPanel } from "./views/RoomActivityPanel.jsx";
import "./hint-history.css";
import "./host-recovery.css";
import "./host-reconnect-waiting.css";
import "./late-join.css";
import "./player-hint-cards.css";
import "./role-reveal.css";
import "./voting-discussion.css";
import "./back-navigation.css";
import "./entry-polish.css";
import {
  BellRing, Check, ChevronLeft, ChevronRight, CircleAlert, Crown, Dice5, DoorOpen, Eye, EyeOff, GripVertical,
  KeyRound, LogOut, MessageCircle, Mic2, Moon, PartyPopper, Plus, Radio, RefreshCcw, Send, ShieldQuestion, Sparkles,
  Timer, Trophy, UsersRound, Vote, Volume2, VolumeX, WandSparkles, X
} from "lucide-react";

function playTone(kind = "tap") {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContext(); const oscillator = context.createOscillator(); const gain = context.createGain();
    oscillator.frequency.value = kind === "reveal" ? 330 : kind === "alert" ? 220 : 520;
    gain.gain.setValueAtTime(0.05, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.17);
    oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.18);
  } catch {}
}
function vibrate(pattern) { if (navigator.vibrate) navigator.vibrate(pattern); }
function App() {
  const [screen, setScreen] = useState("entry");
  const [identity, setIdentity] = useState(safeReadSession());
  const [game, setGame] = useState(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState(null);
  const [peekOpen, setPeekOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [hostReconnectDeadline, setHostReconnectDeadline] = useState(null);
  const [roomActivityOpen, setRoomActivityOpen] = useState(false);
  const previousRoom = useRef(null);

  const setFailure = (message) => { setError(message); window.setTimeout(() => setError(""), 4200); };
  const refreshView = (data) => {
    const nextIdentity = reconcilePlayerSessionMode(identity, data?.players);
    if (nextIdentity !== identity) { saveSession(nextIdentity); setIdentity(nextIdentity); }
    setGame(data);
    if (nextIdentity?.role === "host" && nextIdentity?.viewMode !== "player") setScreen("host"); else setScreen(data?.room?.status === "revealed" ? "results" : data?.room?.status === "playing" ? "game" : "lobby");
  };

  useEffect(() => {
    const onSnapshot = (data) => refreshView(data);
    const onAssigned = () => { vibrate([35, 35, 45]); if (soundEnabled && !game?.room?.soundMuted) playTone("tap"); };
    const onTurn = ({ playerId }) => { if (playerId === identity?.playerId) { vibrate([55, 35, 55]); if (soundEnabled && !game?.room?.soundMuted) playTone("tap"); } };
    const onFlash = (event) => { setFlash(event); vibrate([90, 50, 90]); if (soundEnabled && !game?.room?.soundMuted) playTone("alert"); window.setTimeout(() => setFlash(null), 4000); };
    const onNudge = (event) => { setFlash({ ...event, message: "The host nudged you — your turn is waiting." }); vibrate([120, 50, 120, 50, 120]); window.setTimeout(() => setFlash(null), 3500); };
    const onVoteResolved = (event) => {
      const message = formatPublicVoteResult(event);
      if (!message) return;
      setFlash({ type: "vote-result", message });
      vibrate([100, 55, 100]);
      if (soundEnabled && !game?.room?.soundMuted) playTone("alert");
      window.setTimeout(() => setFlash(null), 5200);
    };
    const onKicked = () => { setHostReconnectDeadline(null); clearSession(); setIdentity(null); setGame(null); setScreen("entry"); setFailure("The host removed you from this room."); };
    const onRestarted = () => { setHostReconnectDeadline(null); clearSession(); setIdentity(null); setGame(null); setScreen("entry"); };
    const onRoomEnded = ({ message } = {}) => { setHostReconnectDeadline(null); clearSession(); setIdentity(null); setGame(null); setScreen("entry"); setFailure(message || "The host ended this room."); };
    const onHostReconnectWaiting = ({ deadline } = {}) => setHostReconnectDeadline(Number(deadline) || Date.now() + 20_000);
    const onHostReconnected = () => setHostReconnectDeadline(null);
    socket.on("roomSnapshot", onSnapshot); socket.on("roleAssigned", onAssigned); socket.on("turnChanged", onTurn); socket.on("flashAlert", onFlash); socket.on("nudge", onNudge); socket.on("voteResolved", onVoteResolved); socket.on("kicked", onKicked); socket.on("sessionRestarted", onRestarted); socket.on("roomEnded", onRoomEnded); socket.on("hostReconnectWaiting", onHostReconnectWaiting); socket.on("hostReconnected", onHostReconnected);
    return () => { socket.off("roomSnapshot", onSnapshot); socket.off("roleAssigned", onAssigned); socket.off("turnChanged", onTurn); socket.off("flashAlert", onFlash); socket.off("nudge", onNudge); socket.off("voteResolved", onVoteResolved); socket.off("kicked", onKicked); socket.off("sessionRestarted", onRestarted); socket.off("roomEnded", onRoomEnded); socket.off("hostReconnectWaiting", onHostReconnectWaiting); socket.off("hostReconnected", onHostReconnected); };
  }, [identity?.playerId, identity?.role, identity?.isGhost, soundEnabled, game?.room?.soundMuted]);

  useEffect(() => {
    const currentRoom = game?.room ? { status: game.room.status, gamePhase: game.room.gamePhase } : null;
    if (shouldCloseRoomActivityOnGameTransition(previousRoom.current, currentRoom)) {
      setRoomActivityOpen(false);
    }
    previousRoom.current = currentRoom;
  }, [game?.room?.status, game?.room?.gamePhase]);

  useEffect(() => {
    const saved = safeReadSession(); if (!saved) return;
    const resume = async () => {
      try {
        if (saved.role === "host") {
          const response = await send("resumeHost", { hostToken: saved.hostToken, sessionToken: saved.sessionToken }); const next = { ...saved, playerId: response.playerId || saved.playerId, sessionToken: response.sessionToken || saved.sessionToken, userId: response.userId || saved.userId, isGhost: response.isGhost ?? saved.isGhost }; saveSession(next); setIdentity(next); refreshView(response.snapshot); if (next.viewMode === "player" && next.playerId) await send("setHostViewMode", { hostToken: next.hostToken, mode: "player" });
        } else if (saved.roomCode && saved.password) {
          const response = await send("joinRoom", { roomCode: saved.roomCode, password: saved.password, userId: saved.userId, isGhost: saved.isGhost, sessionToken: saved.sessionToken });
          const next = { ...saved, playerId: response.playerId, sessionToken: response.sessionToken, isGhost: Boolean(response.isGhost) }; saveSession(next); setIdentity(next); refreshView(response.snapshot);
        }
      } catch { clearSession(); setIdentity(null); }
    };
    if (socket.connected) resume(); else socket.once("connect", resume);
  }, []);

  const setHostSession = (response, password = "") => {
    const next = { role: "host", hostToken: response.hostToken, viewMode: "host", roomCode: response.roomCode, password, playerId: response.playerId || null, sessionToken: response.sessionToken || null, userId: response.userId || null, isGhost: Boolean(response.isGhost) };
    saveSession(next); setIdentity(next); refreshView(response.snapshot);
  };
  const enterCreate = async ({ userId, roomCode, password }) => { try { const response = await send("createRoom", { userId, hostUserId: userId, roomCode, password }); setHostSession(response, password); if (soundEnabled) playTone("tap"); } catch (err) { setFailure(err.message); } };
  const enterRecover = async ({ roomCode, password }) => { try { const response = await send("recoverHost", { roomCode, password }); setHostSession(response, password); } catch (err) { setFailure(err.message); } };
  const enterPlayer = async ({ userId, roomCode, password, isGhost }) => {
    try {
      const response = await send("joinRoom", { userId, roomCode, password, isGhost });
      const next = { role: "player", userId, roomCode: response.roomCode, password, sessionToken: response.sessionToken, playerId: response.playerId, isGhost: response.isGhost };
      saveSession(next); setIdentity(next); refreshView(response.snapshot); if (soundEnabled) playTone("tap");
    } catch (err) { setFailure(err.message); }
  };
  const leave = () => { if (identity?.role === "player" && identity.sessionToken && socket.connected) socket.emit("leaveRoom", { sessionToken: identity.sessionToken }); clearSession(); setIdentity(null); setGame(null); setScreen("entry"); setPeekOpen(false); setRoomActivityOpen(false); };
  const endHostedRoom = async () => { try { if (identity?.hostToken) await send("endRoom", { hostToken: identity.hostToken }); } catch (error) { setFailure(error.message); } finally { leave(); } };
  const switchHostView = async (viewMode) => { try { await send("setHostViewMode", { hostToken: identity.hostToken, mode: viewMode }); const next = { ...identity, viewMode }; saveSession(next); setIdentity(next); setScreen(viewMode === "host" ? "host" : game?.room?.status === "revealed" ? "results" : game?.room?.status === "playing" ? "game" : "lobby"); } catch (error) { setFailure(error.message); } };

  return <RoomActivityContext.Provider value={{ open: roomActivityOpen, setOpen: setRoomActivityOpen }}><main className="app-shell">
    <Decor />
    <ErrorToast error={error} onClose={() => setError("")} />
    <AnimatePresence>{flash && <motion.div className="flash-alert" role="status" aria-live="polite" initial={{ opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .96 }}><BellRing size={30}/><strong>{flash.message}</strong></motion.div>}</AnimatePresence>
    {!identity || screen === "entry" ? <EntryPage onCreate={enterCreate} onJoin={enterPlayer} onRecover={enterRecover} /> : identity.role === "host" && identity.viewMode !== "player" ? <HostDashboard game={game} hostToken={identity.hostToken} onHostSession={setHostSession} onLeave={endHostedRoom} onSwitchToPlayer={identity.playerId ? () => switchHostView("player") : null} peekOpen={peekOpen} setPeekOpen={setPeekOpen} soundEnabled={soundEnabled} setSoundEnabled={setSoundEnabled} fail={setFailure} /> : screen === "lobby" ? <PlayerLobby game={game} identity={identity} fail={setFailure} onLeave={identity.role === "host" ? endHostedRoom : leave} hostReconnectDeadline={hostReconnectDeadline} onSwitchToHost={identity.role === "host" ? () => switchHostView("host") : null} /> : screen === "results" ? <Results game={game} identity={identity} onLeave={identity.role === "host" ? endHostedRoom : leave} hostReconnectDeadline={hostReconnectDeadline} onSwitchToHost={identity.role === "host" ? () => switchHostView("host") : null} /> : <PlayerGame game={game} identity={identity} fail={setFailure} onLeave={identity.role === "host" ? endHostedRoom : leave} hostReconnectDeadline={hostReconnectDeadline} onSwitchToHost={identity.role === "host" ? () => switchHostView("host") : null} />}
    {identity && game && <RoomActivityPanel game={game} identity={identity} fail={setFailure}/>} 
  </main></RoomActivityContext.Provider>;
}


export default App;
