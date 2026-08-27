import { io } from "socket.io-client";
import { resolveRealtimeUrl } from "../realtimeEndpointModel.js";

const realtimeUrl = resolveRealtimeUrl(import.meta.env.VITE_REALTIME_URL);
export const socket = io(realtimeUrl, { autoConnect: true, transports: ["websocket"] });

const storageKey = "word-impostor-session";

export const safeReadSession = () => {
  try {
    return JSON.parse(sessionStorage.getItem(storageKey) || "null");
  } catch {
    return null;
  }
};

export const saveSession = (payload) => sessionStorage.setItem(storageKey, JSON.stringify(payload));
export const clearSession = () => sessionStorage.removeItem(storageKey);

export function send(event, data = {}) {
  return new Promise((resolve, reject) => socket.emit(event, data, (response) => response?.ok
    ? resolve(response)
    : reject(new Error(response?.error || "Could not complete that action."))));
}
