import { routePartykitRequest, Server, type Connection } from "partyserver";
import {
  HOLE_COUNT,
  MAX_ONLINE_PLAYERS,
  type ClientMessage,
  type GameType,
  type RoomView,
  type ServerMessage,
  type Street,
  type WireCard,
} from "../shared/protocol";

type Seat = {
  connectionId: string | null;
  holes: WireCard[];
};

export type Env = {
  PokerRoom: DurableObjectNamespace<PokerRoom>;
};

function fullDeck(): number[] {
  return Array.from({ length: 52 }, (_, i) => i);
}

/** Cryptographically shuffled deck (runs on Cloudflare Workers). */
function secureShuffle(deck: number[]): number[] {
  const cards = deck.slice();
  const rand = new Uint32Array(1);
  for (let i = cards.length - 1; i > 0; i--) {
    crypto.getRandomValues(rand);
    const j = rand[0] % (i + 1);
    const tmp = cards[i];
    cards[i] = cards[j];
    cards[j] = tmp;
  }
  return cards;
}

function emptyBoard(): WireCard[] {
  return [null, null, null, null, null];
}

function emptyHoles(n: number): WireCard[] {
  return Array.from({ length: n }, () => null);
}

export class PokerRoom extends Server<Env> {
  gameType: GameType = "holdem";
  street: Street = "predeal";
  deck: number[] = [];
  board: WireCard[] = emptyBoard();
  seats: Seat[] = [];
  hostId: string | null = null;
  private seatsReady = false;

  private holes(): number {
    return HOLE_COUNT[this.gameType];
  }

  private ensureSeats() {
    if (this.seatsReady) return;
    this.seats = Array.from({ length: MAX_ONLINE_PLAYERS }, () => ({
      connectionId: null,
      holes: emptyHoles(this.holes()),
    }));
    this.seatsReady = true;
  }

  private newRoundKeepSeats() {
    this.street = "predeal";
    this.board = emptyBoard();
    this.deck = [];
    for (const seat of this.seats) {
      seat.holes = emptyHoles(this.holes());
    }
  }

  private draw(n: number): number[] {
    if (n > this.deck.length) {
      throw new Error("Deck exhausted");
    }
    return this.deck.splice(0, n);
  }

  onStart() {
    this.ensureSeats();
  }

  onConnect(conn: Connection) {
    this.ensureSeats();
    let seatIndex = this.seats.findIndex((s) => s.connectionId === null);
    if (seatIndex === -1) {
      this.send(conn, {
        type: "error",
        message: "Room is full (2 players).",
      });
      conn.close(4000, "Room full");
      return;
    }

    this.seats[seatIndex].connectionId = conn.id;
    if (!this.hostId) this.hostId = conn.id;

    this.broadcastViews();
  }

  onClose(conn: Connection) {
    this.ensureSeats();
    for (const seat of this.seats) {
      if (seat.connectionId === conn.id) {
        seat.connectionId = null;
      }
    }
    if (this.hostId === conn.id) {
      const next = this.seats.find((s) => s.connectionId);
      this.hostId = next?.connectionId ?? null;
    }
    this.broadcastViews();
  }

  onMessage(sender: Connection, message: string | ArrayBuffer) {
    this.ensureSeats();
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(message)) as ClientMessage;
    } catch {
      this.send(sender, { type: "error", message: "Bad message" });
      return;
    }

    try {
      this.handle(msg, sender);
    } catch (err) {
      this.send(sender, {
        type: "error",
        message: err instanceof Error ? err.message : "Server error",
      });
    }
  }

  private handle(msg: ClientMessage, sender: Connection) {
    const isHost = sender.id === this.hostId;

    switch (msg.type) {
      case "hello": {
        if (isHost && this.street === "predeal") {
          this.gameType = msg.gameType;
          for (const seat of this.seats) {
            if (seat.holes.length !== this.holes()) {
              seat.holes = emptyHoles(this.holes());
            }
          }
        }
        this.broadcastViews();
        return;
      }
      case "deal_hands": {
        if (!isHost) throw new Error("Only the host can deal");
        if (!this.bothSeated()) throw new Error("Need 2 players");
        this.deck = secureShuffle(fullDeck());
        this.board = emptyBoard();
        const n = this.holes();
        for (const seat of this.seats) {
          seat.holes = emptyHoles(n);
        }
        for (let h = 0; h < n; h++) {
          for (let p = 0; p < MAX_ONLINE_PLAYERS; p++) {
            seatAssign(this.seats[p], h, this.draw(1)[0]);
          }
        }
        this.street = "holes";
        this.broadcastViews();
        return;
      }
      case "deal_flop": {
        if (!isHost) throw new Error("Only the host can deal");
        if (this.street !== "holes") throw new Error("Deal hands first");
        this.draw(1); // burn
        const flop = this.draw(3);
        this.board[0] = flop[0];
        this.board[1] = flop[1];
        this.board[2] = flop[2];
        this.street = "flop";
        this.broadcastViews();
        return;
      }
      case "deal_turn": {
        if (!isHost) throw new Error("Only the host can deal");
        if (this.street !== "flop") throw new Error("Deal flop first");
        this.draw(1);
        this.board[3] = this.draw(1)[0];
        this.street = "turn";
        this.broadcastViews();
        return;
      }
      case "deal_river": {
        if (!isHost) throw new Error("Only the host can deal");
        if (this.street !== "turn") throw new Error("Deal turn first");
        this.draw(1);
        this.board[4] = this.draw(1)[0];
        this.street = "river";
        this.broadcastViews();
        return;
      }
      case "new_round": {
        if (!isHost) throw new Error("Only the host can start a new round");
        this.newRoundKeepSeats();
        this.broadcastViews();
        return;
      }
      default:
        throw new Error("Unknown message");
    }
  }

  private bothSeated(): boolean {
    return this.seats.every((s) => s.connectionId !== null);
  }

  private send(conn: Connection, msg: ServerMessage) {
    conn.send(JSON.stringify(msg));
  }

  private broadcastViews() {
    for (const conn of this.getConnections()) {
      this.send(conn, this.viewFor(conn.id));
    }
  }

  private viewFor(connectionId: string): RoomView {
    const yourSeat = this.seats.findIndex((s) => s.connectionId === connectionId);
    const revealed = this.street === "river";
    const n = this.holes();

    let yourHoles: WireCard[] = emptyHoles(n);
    let opponentHidden: boolean[] = Array.from({ length: n }, () => false);
    let opponentHoles: WireCard[] | null = null;

    if (yourSeat >= 0) {
      yourHoles = this.seats[yourSeat].holes.slice();
      const opp = this.seats[1 - yourSeat];
      const oppDealt = opp.holes.every((c) => c !== null);
      if (revealed) {
        opponentHoles = opp.holes.slice();
        opponentHidden = Array.from({ length: n }, () => false);
      } else if (oppDealt || this.street !== "predeal") {
        opponentHidden = opp.holes.map((c) => c !== null);
      }
    }

    const waiting = !this.bothSeated();
    let status: string;
    if (waiting) {
      status = `Room ${this.name} — waiting for opponent…`;
    } else if (this.street === "predeal") {
      status =
        connectionId === this.hostId
          ? "Both players ready. Deal hands when you want."
          : "Waiting for host to deal.";
    } else if (revealed) {
      status = "River is out — hands revealed.";
    } else {
      status =
        connectionId === this.hostId
          ? "You are dealing. Opponent cannot see your hole cards."
          : "Host is dealing. Your hole cards are private.";
    }

    return {
      type: "state",
      roomId: this.name,
      gameType: this.gameType,
      street: this.street,
      yourSeat: yourSeat >= 0 ? yourSeat : null,
      youAreHost: connectionId === this.hostId,
      seats: this.seats.map((s) => ({
        filled: s.connectionId !== null,
        connected: s.connectionId !== null,
      })),
      board: this.board.slice(),
      yourHoles,
      opponentHidden,
      opponentHoles,
      revealed,
      status,
    };
  }
}

function seatAssign(seat: Seat, slot: number, card: number) {
  seat.holes[slot] = card;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(request, env)) ||
      new Response("Not Found", { status: 404 })
    );
  },
};
