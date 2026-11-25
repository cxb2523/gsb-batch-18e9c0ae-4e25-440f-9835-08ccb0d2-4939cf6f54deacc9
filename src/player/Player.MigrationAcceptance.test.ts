import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Player } from "./Player.ts";
import { PlayerManager } from "./PlayerManager.ts";
import { Node } from "../node/Node.ts";
import { EventDispatcher } from "../ws/EventDispatcher.ts";
import { PlayerNotConnectedError } from "../errors/index.ts";
import { TesseractFilter } from "../filters/Filters.ts";
import type { YuKumo } from "../YuKumo.ts";
import type { TrackData } from "../types/protocol.ts";

/**
 * Migration tests use the same plain connected-node mock + real
 * EventDispatcher combination as Player.test.ts's makeLiveNode — no real
 * Lavalink/NodeLink server or WebSocket is involved.
 */
interface MockLiveNode {
  id: string;
  playerCount: number;
  state: "connected" | "disconnected";
  ws: { eventDispatcher: EventDispatcher };
  rest: {
    sessionId: string | null;
    updatePlayer: ReturnType<typeof vi.fn>;
    destroyPlayer: ReturnType<typeof vi.fn>;
  };
  supportsFilter?: ReturnType<typeof vi.fn>;
}

function makeLiveNode(id: string, sessionId: string | null = `session-${id}`): MockLiveNode {
  return {
    id,
    playerCount: 0,
    state: "connected",
    ws: { eventDispatcher: new EventDispatcher() },
    rest: {
      sessionId,
      updatePlayer: vi.fn().mockResolvedValue({}),
      destroyPlayer: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function makeMockKumo(): YuKumo {
  const kumo = {
    events: new EventDispatcher(),
    voice: { getVoiceState: () => null },
    sendGatewayPayload: vi.fn(),
  } as unknown as YuKumo;
  (kumo as { players: PlayerManager }).players = new PlayerManager(kumo);
  return kumo;
}

const VOICE_STATE = {
  sessionId: "voice-session",
  channelId: "vc-1",
  endpoint: "voice.discord.gg",
  token: "voice-token",
};

function makeTrack(id: string, length = 100_000): TrackData {
  return {
    encoded: `encoded-${id}`,
    info: {
      identifier: id,
      isSeekable: true,
      author: `author-${id}`,
      length,
      isStream: false,
      position: 0,
      title: `title-${id}`,
      uri: null,
      artworkUrl: null,
      isrc: null,
      sourceName: "test",
    },
    pluginInfo: {},
  };
}

async function flush(cycles = 12): Promise<void> {
  for (let i = 0; i < cycles; i++) await Promise.resolve();
}

/** Last REST player PATCH sent to a mock node. */
function lastPatch(node: MockLiveNode): Record<string, any> {
  const calls = node.rest.updatePlayer.mock.calls as Array<[string, string, Record<string, any>?]>;
  return calls.at(-1)?.[2] ?? {};
}

/** Every PATCH payload that carried voice credentials. */
function voicePatches(node: MockLiveNode): Array<Record<string, any>> {
  return (node.rest.updatePlayer.mock.calls as Array<[string, string, Record<string, any>?]>)
    .map((c) => c[2] ?? {})
    .filter((payload) => payload.voice != null);
}

describe("Player.setNode migration", () => {
  let kumo: YuKumo;
  let oldNode: MockLiveNode;

  beforeEach(() => {
    kumo = makeMockKumo();
    oldNode = makeLiveNode("node-a", "session-a");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createPlayingPlayer(guildId = "guild-1"): Player {
    const player = kumo.players.create({
      guildId,
      node: oldNode as unknown as Node,
      voiceChannelId: "vc-1",
    });
    player.setVoiceState(VOICE_STATE);
    return player;
  }

  async function startTrack(player: Player): Promise<void> {
    player.queue.enqueue(makeTrack("track-a"));
    await player.play();
  }

  it("resumes a playing track at the pre-migration interpolated position with volume and filters", async () => {
    vi.useFakeTimers();
    const target = makeLiveNode("node-b", "session-b");
    const player = createPlayingPlayer();
    await startTrack(player);

    // Simulate a 40s playerUpdate followed by 2s of interpolation → 42s.
    oldNode.ws.eventDispatcher.emit("playerUpdate", "guild-1", {
      time: 0,
      position: 40_000,
      connected: true,
      ping: 1,
    });
    vi.advanceTimersByTime(2_000);
    expect(player.position).toBe(42_000);

    await player.setVolume(150);
    player.filters.set8D(); // rotation is a standard Lavalink filter
    await player.setFilters();

    await player.setNode(target as unknown as Node);

    // New node received one consolidated rebuild PATCH with the resume point,
    // volume and supported filters.
    expect(target.rest.updatePlayer).toHaveBeenCalledTimes(1);
    const patch = lastPatch(target);
    expect(patch.track).toEqual({ encoded: "encoded-track-a" });
    expect(patch.position).toBe(42_000);
    expect(patch.paused).toBe(false);
    expect(patch.volume).toBe(150);
    expect(patch.filters?.rotation).toBeDefined();

    // Ownership moved; old node player destroyed; counts consistent.
    expect(player.node.id).toBe("node-b");
    expect(oldNode.rest.destroyPlayer).toHaveBeenCalledWith("session-a", "guild-1");
    expect(oldNode.playerCount).toBe(0);
    expect(target.playerCount).toBe(1);

    // Migration never advances the queue.
    expect(player.currentTrack?.encoded).toBe("encoded-track-a");
    expect(player.queue.size).toBe(1);
  });

  it("re-sends voice credentials exactly once on the new session", async () => {
    const target = makeLiveNode("node-b", "session-b");
    const player = createPlayingPlayer();
    await startTrack(player);

    await player.setNode(target as unknown as Node);

    const voiceCalls = voicePatches(target);
    expect(voiceCalls).toHaveLength(1);
    expect(voiceCalls[0]?.voice).toMatchObject({
      token: "voice-token",
      sessionId: "voice-session",
      endpoint: "voice.discord.gg",
    });

    // A follow-up playTrack must not push voice a second time: the migration
    // already marked credentials as sent on this session.
    target.rest.updatePlayer.mockClear();
    await player.playTrack(makeTrack("track-b"));
    expect(voicePatches(target)).toHaveLength(0);
  });

  it("keeps a paused player paused after migration and never auto-resumes it", async () => {
    vi.useFakeTimers();
    const target = makeLiveNode("node-b", "session-b");
    const player = createPlayingPlayer();
    await startTrack(player);

    await player.seek(33_000);
    await player.pause();
    vi.advanceTimersByTime(5_000);
    expect(player.position).toBe(33_000);

    await player.setNode(target as unknown as Node);

    const patch = lastPatch(target);
    expect(patch.track).toEqual({ encoded: "encoded-track-a" });
    expect(patch.position).toBe(33_000);
    expect(patch.paused).toBe(true);
    expect(player.paused).toBe(true);
    expect(player.status).toBe("paused");

    // Exactly one PATCH on the new node and nothing carrying paused:false.
    expect(target.rest.updatePlayer).toHaveBeenCalledTimes(1);
    const resumeCalls = (
      target.rest.updatePlayer.mock.calls as Array<[unknown, unknown, Record<string, any>]>
    ).filter((c) => c[2]?.paused === false);
    expect(resumeCalls).toHaveLength(0);
  });

  it("still completes migration when destroying the old node player fails", async () => {
    oldNode.rest.destroyPlayer.mockRejectedValueOnce(new Error("ECONNRESET"));
    const target = makeLiveNode("node-b", "session-b");
    const player = createPlayingPlayer();
    await startTrack(player);

    await expect(player.setNode(target as unknown as Node)).resolves.toBeUndefined();
    expect(player.node.id).toBe("node-b");
    expect(target.rest.updatePlayer).toHaveBeenCalledTimes(1);
  });

  it("rolls back to the old node when the target WebSocket is not connected", async () => {
    const target = makeLiveNode("node-b", "session-b");
    target.state = "disconnected";
    const player = createPlayingPlayer();
    await startTrack(player);
    const positionBefore = player.position;

    await expect(player.setNode(target as unknown as Node)).rejects.toBeInstanceOf(PlayerNotConnectedError);

    expect(player.node.id).toBe("node-a");
    expect(player.status).toBe("playing");
    expect(player.paused).toBe(false);
    expect(player.volume).toBe(100);
    expect(player.position).toBeGreaterThanOrEqual(positionBefore);

    // Old node was never torn down and counts were not moved.
    expect(oldNode.rest.destroyPlayer).not.toHaveBeenCalled();
    expect(oldNode.playerCount).toBe(1);
    expect(target.playerCount).toBe(0);

    // Old-node listeners were restored: player updates still apply.
    oldNode.ws.eventDispatcher.emit("playerUpdate", "guild-1", {
      time: 0,
      position: 70_000,
      connected: true,
      ping: 1,
    });
    expect((player as unknown as { _position: number })._position).toBe(70_000);
  });

  it("rolls back when the target has no session id", async () => {
    const target = makeLiveNode("node-b", null);
    const player = createPlayingPlayer();
    await startTrack(player);

    await expect(player.setNode(target as unknown as Node)).rejects.toMatchObject({
      code: "PLAYER_NOT_CONNECTED",
    });

    expect(player.node.id).toBe("node-a");
    expect(player.status).toBe("playing");
    expect(oldNode.rest.destroyPlayer).not.toHaveBeenCalled();
    expect(oldNode.playerCount).toBe(1);
    expect(target.playerCount).toBe(0);
  });

  it("rolls back and preserves filters/state when the target rebuild request fails", async () => {
    const target = makeLiveNode("node-b", "session-b");
    target.rest.updatePlayer.mockRejectedValueOnce(new Error("500 internal"));
    const player = createPlayingPlayer();
    await startTrack(player);
    player.filters.set8D();

    await expect(player.setNode(target as unknown as Node)).rejects.toThrow("500 internal");

    expect(player.node.id).toBe("node-a");
    expect(player.status).toBe("playing");
    expect(player.filters.has("rotation")).toBe(true);
    expect(oldNode.rest.destroyPlayer).not.toHaveBeenCalled();
    expect(oldNode.playerCount).toBe(1);
    expect(target.playerCount).toBe(0);

    // Source listeners work after rollback.
    oldNode.ws.eventDispatcher.emit("playerUpdate", "guild-1", {
      time: 0,
      position: 12_345,
      connected: true,
      ping: 1,
    });
    expect((player as unknown as { _position: number })._position).toBe(12_345);
  });

  it("serializes two concurrent setNode calls: only the last node holds the player", async () => {
    const nodeB = makeLiveNode("node-b", "session-b");
    const nodeC = makeLiveNode("node-c", "session-c");
    const player = createPlayingPlayer();
    await startTrack(player);

    await Promise.all([player.setNode(nodeB as unknown as Node), player.setNode(nodeC as unknown as Node)]);

    // Call order was B then C; serialized migration ends on C.
    expect(player.node.id).toBe("node-c");
    expect(nodeB.rest.updatePlayer).toHaveBeenCalled();
    expect(nodeC.rest.updatePlayer).toHaveBeenCalled();

    // Every previous holder had its player destroyed.
    expect(oldNode.rest.destroyPlayer).toHaveBeenCalledTimes(1);
    expect(oldNode.rest.destroyPlayer).toHaveBeenCalledWith("session-a", "guild-1");
    expect(nodeB.rest.destroyPlayer).toHaveBeenCalledTimes(1);
    expect(nodeC.rest.destroyPlayer).not.toHaveBeenCalled();

    // playerCount books are consistent: A=0, B=0, C=1.
    expect(oldNode.playerCount).toBe(0);
    expect(nodeB.playerCount).toBe(0);
    expect(nodeC.playerCount).toBe(1);
    expect(player.currentTrack?.encoded).toBe("encoded-track-a");
  });

  it("queues an overlapping second migration behind the in-flight one", async () => {
    const nodeB = makeLiveNode("node-b", "session-b");
    const nodeC = makeLiveNode("node-c", "session-c");
    const player = createPlayingPlayer();
    await startTrack(player);

    const pending: { resolve?: (value: unknown) => void } = {};
    nodeB.rest.updatePlayer.mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.resolve = resolve;
        }),
    );

    const first = player.setNode(nodeB as unknown as Node);
    await flush();
    expect(nodeB.rest.updatePlayer).toHaveBeenCalled();

    // Second migration is requested while B's rebuild is pending. It must not
    // interleave and hit C before B settles.
    const second = player.setNode(nodeC as unknown as Node);
    await flush();
    expect(nodeC.rest.updatePlayer).not.toHaveBeenCalled();

    pending.resolve?.({});
    await first;
    await second;

    expect(player.node.id).toBe("node-c");
    expect(nodeC.rest.updatePlayer).toHaveBeenCalledTimes(1);
    expect(nodeB.rest.destroyPlayer).toHaveBeenCalledTimes(1);
    expect(oldNode.rest.destroyPlayer).toHaveBeenCalledTimes(1);
    expect(nodeC.playerCount).toBe(1);
  });

  it("destroys players on both the old and target node when destroy() races migration", async () => {
    const target = makeLiveNode("node-b", "session-b");
    const player = createPlayingPlayer();
    await startTrack(player);

    const pending: { resolve?: (value: unknown) => void } = {};
    target.rest.updatePlayer.mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.resolve = resolve;
        }),
    );

    const migration = player.setNode(target as unknown as Node);
    await flush();
    expect(target.rest.updatePlayer).toHaveBeenCalled();

    // destroy() wins while the target rebuild is in flight (_node is still the
    // old node until the rebuild commits).
    const destruction = player.destroy();
    pending.resolve?.({});
    await Promise.allSettled([migration, destruction]);

    expect(player.destroyed).toBe(true);
    expect(kumo.players.has("guild-1")).toBe(false);

    // destroy() removed the old-node player...
    expect(oldNode.rest.destroyPlayer).toHaveBeenCalled();
    // ...and the migration checkpoint removed the player created on target.
    expect(target.rest.destroyPlayer).toHaveBeenCalled();

    // No node accounts for the destroyed player.
    expect(oldNode.playerCount).toBe(0);
    expect(target.playerCount).toBe(0);
  });

  it("rejects setNode called after the player is destroyed", async () => {
    const target = makeLiveNode("node-b", "session-b");
    const player = createPlayingPlayer();
    await startTrack(player);
    await player.destroy();

    await expect(player.setNode(target as unknown as Node)).rejects.toThrow("Player is destroyed");
  });

  it("is a no-op when migrating to the node that already owns the player", async () => {
    const player = createPlayingPlayer();
    await startTrack(player);
    oldNode.rest.updatePlayer.mockClear();

    await player.setNode(oldNode as unknown as Node);

    expect(oldNode.rest.updatePlayer).not.toHaveBeenCalled();
    expect(oldNode.rest.destroyPlayer).not.toHaveBeenCalled();
    expect(oldNode.playerCount).toBe(1);
  });

  it("keeps a track started paused (paused:true play option) silent after migration", async () => {
    const target = makeLiveNode("node-b", "session-b");
    const player = createPlayingPlayer();
    player.queue.enqueue(makeTrack("track-p"));
    await player.play(undefined, { paused: true });
    expect(player.paused).toBe(true);

    await player.setNode(target as unknown as Node);

    const patch = lastPatch(target);
    expect(patch.track?.encoded).toBe("encoded-track-p");
    expect(patch.paused).toBe(true);
    expect(player.paused).toBe(true);
    expect(player.status).toBe("paused");
  });

  it("rebuilds voice + volume on the target for an idle but voice-connected player", async () => {
    const target = makeLiveNode("node-b", "session-b");
    const player = createPlayingPlayer();
    await player.setVolume(80);

    await player.setNode(target as unknown as Node);

    expect(target.rest.updatePlayer).toHaveBeenCalledTimes(1);
    const patch = lastPatch(target);
    expect(patch.track).toBeUndefined();
    expect(patch.volume).toBe(80);
    expect(patch.voice?.token).toBe("voice-token");
  });
});

describe("Player.setNode with real Node mock instances", () => {
  function createConnectedRealNode(name: string): Node {
    const node = new Node({ host: "localhost", port: 2333, password: "pwd", name }, "user-1");
    Object.defineProperty(node.ws, "eventDispatcher", {
      value: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
      configurable: true,
    });
    Object.defineProperty(node.ws, "state", { value: "connected", configurable: true });
    Object.defineProperty(node.rest, "sessionId", {
      value: `session-${name}`,
      writable: true,
      configurable: true,
    });
    node.rest.updatePlayer = vi.fn().mockResolvedValue({ track: null });
    node.rest.destroyPlayer = vi.fn().mockResolvedValue(undefined);
    return node;
  }

  it("migrates a playing player between real Node instances with the connected state set", async () => {
    const source = createConnectedRealNode("real-a");
    const target = createConnectedRealNode("real-b");
    const kumo = makeMockKumo();
    const player = kumo.players.create({
      guildId: "guild-real",
      node: source,
      voiceChannelId: "vc-1",
    });
    player.setVoiceState(VOICE_STATE);
    player.queue.enqueue(makeTrack("track-real"));
    await player.play();
    await player.seek(12_000);

    await player.setNode(target);

    expect(player.node).toBe(target);
    const update = target.rest.updatePlayer as ReturnType<typeof vi.fn>;
    const patch = update.mock.calls.at(-1)?.[2] as Record<string, any>;
    expect(patch.track?.encoded).toBe("encoded-track-real");
    expect(patch.position).toBe(12_000);
    expect(patch.voice?.sessionId).toBe("voice-session");
    expect(source.rest.destroyPlayer).toHaveBeenCalledWith("session-real-a", "guild-real");
    expect(source.playerCount).toBe(0);
    expect(target.playerCount).toBe(1);
  });
});

describe("cross-family filter migration", () => {
  function createRealNode(name: string, type: "lavalink" | "nodelink"): Node {
    const node = new Node({ host: "localhost", port: 2333, password: "pwd", name, type }, "user-1");
    Object.defineProperty(node.ws, "eventDispatcher", {
      value: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
      configurable: true,
    });
    Object.defineProperty(node.ws, "state", { value: "connected", configurable: true });
    Object.defineProperty(node.rest, "sessionId", {
      value: `session-${name}`,
      writable: true,
      configurable: true,
    });
    node.rest.updatePlayer = vi.fn().mockResolvedValue({});
    node.rest.destroyPlayer = vi.fn().mockResolvedValue(undefined);
    return node;
  }

  it("drops NodeLink-only DSP filters on Lavalink while keeping other filters and volume", async () => {
    const nodelink = createRealNode("nl-source", "nodelink");
    const lavalink = createRealNode("ll-target", "lavalink");

    const player = new Player({
      guildId: "guild-x",
      node: nodelink,
      voiceChannelId: "vc-1",
      kumo: {} as unknown as YuKumo,
    });
    player.setVoiceState(VOICE_STATE);

    await player.setEcho({ delay: 200, feedback: 0.4 });
    player.filters.set8D(); // rotation — standard on both families
    await player.setFilters();
    await player.setVolume(65);
    expect(player.filters.has("echo")).toBe(true);

    const debug = vi.fn();
    player.on("debug", debug);

    await player.setNode(lavalink);

    // Unsupported filter permanently dropped with the existing debug policy.
    expect(player.filters.has("echo")).toBe(false);
    expect(player.filters.has("rotation")).toBe(true);
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('Dropped filter "echo"'));

    // Target PATCH omits echo but carries rotation, volume and voice.
    const llUpdate = lavalink.rest.updatePlayer as ReturnType<typeof vi.fn>;
    const migrationCall = llUpdate.mock.calls.find(
      (call) => (call[2] as Record<string, unknown>)?.voice != null,
    );
    expect(migrationCall).toBeDefined();
    const payload = migrationCall?.[2] as Record<string, any>;
    expect(payload.filters?.echo).toBeUndefined();
    expect(payload.filters?.rotation).toBeDefined();
    expect(payload.volume).toBe(65);
    expect(payload.voice?.token).toBe("voice-token");
  });

  it("honours supportsFilter() decisions on plain mock nodes", async () => {
    const source = makeLiveNode("src", "s-src");
    const target = makeLiveNode("dst", "s-dst");
    target.supportsFilter = vi.fn((name: string) => name !== "tesseract");

    const player = new Player({
      guildId: "guild-y",
      node: source as unknown as Node,
      voiceChannelId: "vc-1",
      kumo: makeMockKumo(),
    });
    player.setVoiceState(VOICE_STATE);
    player.filters.add(new TesseractFilter({}));
    player.filters.set8D();

    await player.setNode(target as unknown as Node);

    expect(target.supportsFilter).toHaveBeenCalledWith("tesseract");
    expect(player.filters.has("tesseract")).toBe(false);
    expect(player.filters.has("rotation")).toBe(true);
    const patch = lastPatch(target);
    expect(patch.filters?.tesseract).toBeUndefined();
    expect(patch.filters?.rotation).toBeDefined();
  });

  it("falls back to node.type capabilities for plain mocks without supportsFilter", async () => {
    const source = makeLiveNode("src2", "s-src2");
    const target = { ...makeLiveNode("dst2", "s-dst2"), type: "lavalink" as const };

    const player = new Player({
      guildId: "guild-z",
      node: source as unknown as Node,
      voiceChannelId: "vc-1",
      kumo: makeMockKumo(),
    });
    player.setVoiceState(VOICE_STATE);
    await player.setEcho({ delay: 100 });

    await player.setNode(target as unknown as Node);

    expect(player.filters.has("echo")).toBe(false);
    const calls = target.rest.updatePlayer.mock.calls as Array<[string, string, Record<string, any>?]>;
    expect(calls.at(-1)?.[2]?.filters?.echo).toBeUndefined();
  });
});
