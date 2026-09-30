import { routePartykitRequest, Server, type Connection } from "partyserver";
import type { ClientMessage, ServerMessage } from "../shared/protocol";
import { PokerTable } from "./room/table";

export type Env = {
  PokerRoom: DurableObjectNamespace<PokerRoom>;
};

/**
 * Thin PartyServer wrapper around {@link PokerTable}.
 * Transport / connection lifecycle only — game rules live in `party/room/`.
 */
export class PokerRoom extends Server<Env> {
  private table = new PokerTable(() => this.broadcastViews());

  onStart() {
    this.table.ensureSeats();
  }

  onConnect(conn: Connection) {
    const seated = this.table.seatPlayer(conn.id);
    if (!seated.ok) {
      this.send(conn, { type: "error", message: seated.message });
      conn.close(4000, "Room full");
      return;
    }
    this.broadcastViews();
  }

  onClose(conn: Connection) {
    this.table.unseatPlayer(conn.id);
    this.broadcastViews();
  }

  onMessage(sender: Connection, message: string | ArrayBuffer) {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(message)) as ClientMessage;
    } catch {
      this.send(sender, { type: "error", message: "Bad message" });
      return;
    }

    try {
      this.table.handle(msg, sender.id);
    } catch (err) {
      this.send(sender, {
        type: "error",
        message: err instanceof Error ? err.message : "Server error",
      });
    }
  }

  private send(conn: Connection, msg: ServerMessage) {
    conn.send(JSON.stringify(msg));
  }

  private roomId(): string {
    try {
      return this.name;
    } catch {
      return "";
    }
  }

  private broadcastViews() {
    const roomId = this.roomId();
    for (const conn of this.getConnections()) {
      this.send(conn, this.table.viewFor(conn.id, roomId));
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(request, env)) ||
      new Response("Not Found", { status: 404 })
    );
  },
};
