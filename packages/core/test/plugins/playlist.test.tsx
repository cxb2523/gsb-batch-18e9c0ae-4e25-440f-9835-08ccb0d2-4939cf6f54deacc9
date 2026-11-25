import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { definePlugin } from "../../src/core/plugin";
import { createPlayer } from "../../src/core/player";
import type { LoadRequest, PlayerOptions } from "../../src/core/types";
import { playlist, UpNext } from "../../src/plugins/playlist/index";
import { Root } from "../../src/react/root";
import { advance } from "../helpers/fake-media";

const settle = async () => {
  await act(async () => {
    for (let round = 0; round < 3; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
};

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function mounted(options: PlayerOptions) {
  const player = createPlayer(options);
  const root = document.createElement("div");
  const video = document.createElement("video");
  root.append(video);
  document.body.append(root);
  cleanups.push(() => root.remove());
  cleanups.push(player.mount(root));
  cleanups.push(player.attach(video));
  await settle();
  return {
    player,
    root,
    video,
    state: () => player.plugin(playlist).state(),
    media: () => player.getState().media,
  };
}

const queue = [
  { src: "/one.mp4", title: "One" },
  { src: "/two.mp4", title: "Two" },
  { src: "/three.mp4", title: "Three" },
];

const finish = async (video: HTMLVideoElement) => {
  act(() => advance(video, 60));
  await settle();
};

describe("playlist countdown and switching races", () => {
  it("counts down after an episode ends and advances through the same path as a manual switch", async () => {
    const { player, video, state, media } = await mounted({
      plugins: [playlist({ items: queue, countdown: 2 })],
    });
    await act(() => player.commands.play());
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await finish(video);

    expect(state()).toMatchObject({ index: 0, upNext: true, remaining: 2 });

    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(state().remaining).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    await settle();

    // The zero path goes through select, so the countdown state is cleared and
    // exactly one switch lands on the next episode, already playing.
    expect(state()).toMatchObject({ index: 1, upNext: false, remaining: null });
    expect(media().source?.src).toBe("/two.mp4");
    expect(media().paused).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops the timer for good when next is pressed mid-countdown, switching only once", async () => {
    const { player, video, state, media } = await mounted({
      plugins: [playlist({ items: queue, countdown: 3 })],
    });
    await act(() => player.commands.play());
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await finish(video);
    expect(state().upNext).toBe(true);

    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(state().remaining).toBe(2);

    act(() => player.plugin(playlist).commands.next());
    await settle();

    expect(state()).toMatchObject({ index: 1, upNext: false, remaining: null });
    expect(media().source?.src).toBe("/two.mp4");
    expect(vi.getTimerCount()).toBe(0);

    // The old interval must never fire another select.
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    await settle();
    expect(state().index).toBe(1);
    expect(media().source?.src).toBe("/two.mp4");
  });

  it("stops the timer for good when a specific item is selected mid-countdown", async () => {
    const { player, video, state, media } = await mounted({
      plugins: [playlist({ items: queue, countdown: 3 })],
    });
    await act(() => player.commands.play());
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await finish(video);

    act(() => player.plugin(playlist).commands.select(2));
    await settle();
    expect(state()).toMatchObject({ index: 2, upNext: false, remaining: null });
    expect(media().source?.src).toBe("/three.mp4");
    expect(vi.getTimerCount()).toBe(0);

    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(state().index).toBe(2);
  });

  it("never switches again after cancel", async () => {
    const { player, video, state, media } = await mounted({
      plugins: [playlist({ items: queue, countdown: 2 })],
    });
    await act(() => player.commands.play());
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await finish(video);
    expect(state().upNext).toBe(true);

    act(() => player.plugin(playlist).commands.cancel());
    expect(state()).toMatchObject({ upNext: false, remaining: null });
    expect(vi.getTimerCount()).toBe(0);

    await act(() => vi.advanceTimersByTimeAsync(10_000));
    await settle();
    expect(state().index).toBe(0);
    expect(media().source?.src).toBe("/one.mp4");
  });

  it("a non-playing select cancels a play parked by an earlier select, so it never autostarts", async () => {
    // play strategy: the first play parks its promise rather than loading, the
    // exact suspended path that used to leak onto whatever entry came next.
    const { player, state, media } = await mounted({
      src: "/start.mp4",
      load: "play",
      plugins: [playlist({ items: queue })],
    });

    act(() => player.plugin(playlist).commands.select(0));
    // Switching without asking to play must leave the parked play behind.
    act(() => player.plugin(playlist).commands.select(1, false));
    await settle();

    expect(state().index).toBe(1);
    expect(media().source?.src).toBe("/two.mp4");
    expect(media().paused).toBe(true);

    // Give any late, suspended play a chance to flush: the entry still must not start.
    await settle();
    expect(media().paused).toBe(true);
    expect(state().index).toBe(1);
  });

  it("rapid selects leave the last index and source in charge, never playing an older entry", async () => {
    const { player, video, state, media } = await mounted({
      src: "/start.mp4",
      load: "play",
      plugins: [playlist({ items: queue, countdown: 5 })],
    });
    // Record the source on the element each time play() runs, so a late play
    // against an older entry would show up as its source here.
    const played: string[] = [];
    vi.spyOn(video, "play").mockImplementation(function (this: HTMLVideoElement) {
      played.push(this.src);
      return Promise.resolve();
    });

    act(() => player.plugin(playlist).commands.select(0));
    act(() => player.plugin(playlist).commands.select(1));
    act(() => player.plugin(playlist).commands.select(2));
    await settle();

    expect(state().index).toBe(2);
    expect(media().source?.src).toBe("/three.mp4");
    // The two parked plays were cancelled by the intervening pause() calls, so an
    // older episode's source is never handed to play(); only the winning entry plays.
    expect(played).not.toContain("/one.mp4");
    expect(played).not.toContain("/two.mp4");
    expect(played.at(-1)).toBe("/three.mp4");

    await settle();
    expect(state().index).toBe(2);
    expect(media().source?.src).toBe("/three.mp4");
  });

  it("an interrupted play from a superseded select can't start the old episode", async () => {
    // A load gate holds each load until released, so a select can genuinely be
    // "still loading" when the next one starts.
    const gates: (() => void)[] = [];
    const gate = definePlugin("gate", () => ({
      gates: {
        load: (request: LoadRequest, next: (request: LoadRequest) => void | Promise<void>) => {
          new Promise<void>((resolve) => gates.push(resolve)).then(() => next(request));
        },
      },
    }));
    const { player, state, media } = await mounted({
      plugins: [gate(), playlist({ items: queue })],
    });
    await act(() => gates.shift()?.());
    await settle();
    await act(() => player.commands.play());

    // First switch: its load stays unfinished while we immediately switch again.
    act(() => player.plugin(playlist).commands.select(1));
    await settle();
    act(() => player.plugin(playlist).commands.select(2));
    await settle();

    // The newest entry owns the queue and the source even though neither later
    // load has been allowed to finish.
    expect(state().index).toBe(2);
    expect(media().source?.src).toBe("/three.mp4");

    // Letting the older load finish late must not move the queue back or start it.
    await act(async () => {
      gates.shift()?.();
      gates.shift()?.();
    });
    await settle();
    expect(state().index).toBe(2);
    expect(media().source?.src).toBe("/three.mp4");
  });

  it("leaves no interval behind after unmount", async () => {
    const player = createPlayer({ plugins: [playlist({ items: queue, countdown: 2 })] });
    const root = document.createElement("div");
    const video = document.createElement("video");
    root.append(video);
    document.body.append(root);
    const unmount = player.mount(root);
    const detach = player.attach(video);
    await settle();
    await act(() => player.commands.play());

    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await finish(video);
    expect(player.plugin(playlist).state().upNext).toBe(true);
    expect(vi.getTimerCount()).toBe(1);

    act(() => detach());
    act(() => unmount());
    root.remove();
    expect(vi.getTimerCount()).toBe(0);

    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(player.plugin(playlist).state().index).toBe(0);
  });

  it("clears a running countdown when the source changes outside the queue", async () => {
    const { player, video, state, media } = await mounted({
      plugins: [playlist({ items: queue, countdown: 3 })],
    });
    await act(() => player.commands.play());
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await finish(video);
    expect(state().upNext).toBe(true);

    act(() => player.commands.setSource("/external.mp4"));
    await settle();
    expect(vi.getTimerCount()).toBe(0);
    expect(state().remaining).toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(media().source?.src).toBe("/external.mp4");
    expect(state().index).toBe(0);
  });

  it("keeps the up-next card's cancel button wired to the same teardown", async () => {
    const { player, video } = await mounted({
      plugins: [playlist({ items: queue, countdown: 2 })],
    });
    render(
      <Root player={player}>
        <UpNext />
      </Root>
    );
    await settle();
    await act(() => player.commands.play());

    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await finish(video);
    expect(screen.getByRole("group", { name: "Up next" })).toBeTruthy();

    await act(() => vi.advanceTimersByTimeAsync(1000));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    expect(player.plugin(playlist).state()).toMatchObject({ upNext: false, remaining: null });
    expect(vi.getTimerCount()).toBe(0);

    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(player.plugin(playlist).state().index).toBe(0);
  });
});
