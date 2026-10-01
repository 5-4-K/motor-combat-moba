import { beforeEach, describe, expect, it } from "vitest";
import { ServerError } from "@colyseus/core";
import {
  ArenaState,
  CLOSE_CODES,
  DEFAULT_GAME_MODE,
  PROTOCOL_VERSION,
  PlaygroundState,
  defaultPracticeSetup,
  installMode,
  modeConfigOf,
} from "@motor-combat-moba/shared";
import { ArenaRoom } from "./ArenaRoom.js";
import { PracticeRoom, newPracticeState } from "./PracticeRoom.js";
import { PlaygroundRoom } from "./PlaygroundRoom.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

/** White-box, like `room-cadence.test.ts`: a room with its state set and no transport. */
interface JoinHarness {
  setState(state: unknown): void;
  onJoin(client: unknown, options?: unknown): void;
  onCreate?(options?: unknown): Promise<void>;
  state: { players: { size: number } };
}

function fakeClient(sessionId: string) {
  return { sessionId, raw() {}, send() {}, leave() {} };
}

const ROOMS: { name: string; make: () => JoinHarness; options: () => Record<string, unknown> }[] = [
  {
    name: "ArenaRoom",
    make: () => {
      const room = new ArenaRoom() as unknown as JoinHarness;
      room.setState(new ArenaState());
      return room;
    },
    options: () => ({ name: "Ada" }),
  },
  {
    name: "PracticeRoom",
    make: () => {
      const room = new PracticeRoom() as unknown as JoinHarness;
      room.setState(newPracticeState());
      return room;
    },
    options: () => ({ ...defaultPracticeSetup(), name: "Ada" }),
  },
  {
    name: "PlaygroundRoom",
    make: () => {
      const room = new PlaygroundRoom() as unknown as JoinHarness;
      room.setState(new PlaygroundState());
      return room;
    },
    options: () => ({ name: "Dev" }),
  },
];

const refusal = (client: number | string) =>
  `Client and server are different versions (client protocol ${client}, server ${PROTOCOL_VERSION}). Refresh the page.`;

function thrownBy(fn: () => void): ServerError | undefined {
  try {
    fn();
  } catch (e) {
    return e as ServerError;
  }
  return undefined;
}

describe.each(ROOMS)("$name protocol version (NR55)", ({ make, options }) => {
  it("refuses a join from the previous protocol with the readable message and its own code", () => {
    const room = make();
    const err = thrownBy(() => room.onJoin(fakeClient("s1"), { ...options(), protocol: PROTOCOL_VERSION - 1 }));
    expect(err).toBeInstanceOf(ServerError);
    expect(err?.message).toBe(refusal(PROTOCOL_VERSION - 1));
    expect(err?.code).toBe(CLOSE_CODES.PROTOCOL_MISMATCH);
    expect(room.state.players.size).toBe(0);
  });

  it("refuses a pre-D5 client that sends no protocol at all", () => {
    const room = make();
    const err = thrownBy(() => room.onJoin(fakeClient("s1"), options()));
    expect(err?.message).toBe(refusal("none"));
  });

  it("does not refuse a join from this build", () => {
    const room = make();
    const err = thrownBy(() => room.onJoin(fakeClient("s1"), { ...options(), protocol: PROTOCOL_VERSION }));
    expect(err?.message ?? "").not.toMatch(/different versions/);
  });
});

describe("PracticeRoom.onCreate (NR55)", () => {
  it("tells an old client to refresh rather than that its setup is invalid", async () => {
    const room = new PracticeRoom() as unknown as JoinHarness;
    await expect(room.onCreate!({ ...defaultPracticeSetup(), protocol: PROTOCOL_VERSION - 1 })).rejects.toThrow(
      refusal(PROTOCOL_VERSION - 1),
    );
  });
});
