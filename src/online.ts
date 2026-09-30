import PartySocket from "partysocket";
import type {
  ClientMessage,
  GameType,
  RoomView,
  ServerMessage,
} from "../shared/protocol";

export type OnlineHandlers = {
  onView: (view: RoomView) => void;
  onError: (message: string) => void;
  onClose: () => void;
};

const PLAYER_ID_KEY = "pokerflipper-player-id";

let socket: PartySocket | null = null;
let connectTimer: ReturnType<typeof setTimeout> | null = null;

function partyHost(): string {
  return import.meta.env.VITE_PARTYKIT_HOST || "127.0.0.1:1999";
}

/** Stable per-browser id used to reclaim the same seat after reconnect. */
export function getBrowserPlayerId(): string {
  try {
    const existing = localStorage.getItem(PLAYER_ID_KEY);
    if (existing && existing.length >= 8) return existing;
    const id =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `p_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    localStorage.setItem(PLAYER_ID_KEY, id);
    return id;
  } catch {
    // Private mode / blocked storage — ephemeral id for this page lifetime.
    return `ephemeral_${Math.random().toString(36).slice(2)}`;
  }
}

function clearConnectTimer() {
  if (connectTimer) {
    clearTimeout(connectTimer);
    connectTimer = null;
  }
}

export function randomRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  const bytes = new Uint32Array(4);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 4; i++) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
}

export function connectOnline(
  roomCode: string,
  gameType: GameType,
  handlers: OnlineHandlers,
): void {
  disconnectOnline();

  const host = partyHost();
  const playerId = getBrowserPlayerId();
  let opened = false;
  let gotView = false;

  socket = new PartySocket({
    host,
    party: "poker-room",
    room: roomCode.toUpperCase(),
    query: { playerId },
    maxRetries: 6,
  });

  connectTimer = setTimeout(() => {
    if (!opened || !gotView) {
      handlers.onError(
        `Still connecting to ${host}. Check VITE_PARTYKIT_HOST and run npm run deploy:party.`,
      );
    }
  }, 8000);

  socket.addEventListener("open", () => {
    opened = true;
    sendOnline({ type: "hello", gameType, playerId });
  });

  socket.addEventListener("message", (event) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(event.data)) as ServerMessage;
    } catch {
      handlers.onError("Bad server message");
      return;
    }
    if (msg.type === "error") {
      handlers.onError(msg.message);
      return;
    }
    gotView = true;
    clearConnectTimer();
    handlers.onView(msg);
  });

  socket.addEventListener("close", () => {
    clearConnectTimer();
    if (!gotView) {
      handlers.onError(`Could not connect to ${host}`);
    }
    handlers.onClose();
  });

  socket.addEventListener("error", () => {
    handlers.onError(`Could not connect to ${host}`);
  });
}

export function sendOnline(msg: ClientMessage): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(msg));
}

export function disconnectOnline(): void {
  clearConnectTimer();
  if (socket) {
    socket.close();
    socket = null;
  }
}

export function isOnlineConnected(): boolean {
  return socket !== null && socket.readyState === WebSocket.OPEN;
}
