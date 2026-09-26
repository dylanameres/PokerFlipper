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

let socket: PartySocket | null = null;

function partyHost(): string {
  return import.meta.env.VITE_PARTYKIT_HOST || "127.0.0.1:1999";
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
  socket = new PartySocket({
    host,
    room: roomCode.toUpperCase(),
  });

  socket.addEventListener("open", () => {
    sendOnline({ type: "hello", gameType });
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
    handlers.onView(msg);
  });

  socket.addEventListener("close", () => {
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
  if (socket) {
    socket.close();
    socket = null;
  }
}

export function isOnlineConnected(): boolean {
  return socket !== null && socket.readyState === WebSocket.OPEN;
}
