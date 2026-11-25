import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  indicators: vi.fn(),
  general: vi.fn(),
  provisions: vi.fn(),
  dayAtSea: vi.fn(),
  playerFleetSpeed: vi.fn(),
  playerFleetDirection: vi.fn(),
  fade: vi.fn(),
}));

vi.mock('./updateInterface', () => ({
  default: {
    indicators: mocks.indicators,
    general: mocks.general,
    provisions: mocks.provisions,
    dayAtSea: mocks.dayAtSea,
    playerFleetSpeed: mocks.playerFleetSpeed,
    playerFleetDirection: mocks.playerFleetDirection,
    fade: mocks.fade,
  },
}));

vi.mock('../assets', () => ({
  default: {
    data: () => ({
      0: 0, // summer direction, sea area 0
      450: 3, // summer speed, sea area 0
      900: 6, // winter direction, sea area 0
      1350: 5, // winter speed, sea area 0
      1800: 2, // current direction, sea area 0
      2250: 4, // current speed, sea area 0
    }),
  },
}));

import state from './state';
import { updateWorldStatus, worldTimeTick } from './actionsWorld';
import { getIsSummer } from '../game/world/windCurrent';
import { START_DATE } from '../constants';

// first point on the 20-minute tick grid that lies in winter
const firstWinterTick = (() => {
  let timePassed = 190000;

  while (getIsSummer(START_DATE, timePassed)) {
    timePassed += 20;
  }

  return timePassed;
})();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('updateWorldStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.fleets[1].position = { x: 0, y: 0 };
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  test('generates summer wind and current from the sea area', () => {
    state.timePassed = 480; // 8 AM, May 17th: summer

    updateWorldStatus();

    expect(state.wind).toEqual({ direction: 0, speed: 4 });
    expect(state.current).toEqual({ direction: 2, speed: 4 });
    expect(mocks.indicators).toHaveBeenCalledWith({
      wind: state.wind,
      current: state.current,
    });
  });

  test('generates winter wind after the season changes', () => {
    state.timePassed = firstWinterTick;

    updateWorldStatus();

    expect(state.wind).toEqual({ direction: 6, speed: 6 });
    expect(mocks.indicators).toHaveBeenCalledWith({
      wind: state.wind,
      current: state.current,
    });
  });
});

describe('worldTimeTick season switch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.fleets[1].position = { x: 0, y: 0 };
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  test('keeps updating wind on the fixed 240-minute time slice', () => {
    state.timePassed = 460; // one 20-minute tick short of 480

    worldTimeTick();

    expect(state.timePassed).toEqual(480);
    expect(mocks.indicators).toHaveBeenCalledTimes(1);

    worldTimeTick(); // 500 is not on a slice
    expect(mocks.indicators).toHaveBeenCalledTimes(1);
  });

  test('triggers exactly one update when the season boundary tick is on the slice', () => {
    state.timePassed = firstWinterTick - 20;

    worldTimeTick(); // lands on the winter boundary, also a 240 multiple

    expect(getIsSummer(START_DATE, state.timePassed)).toEqual(false);
    expect(mocks.indicators).toHaveBeenCalledTimes(1);

    worldTimeTick(); // same season, off the slice
    expect(mocks.indicators).toHaveBeenCalledTimes(1);
  });

  test('triggers an update when crossing the season boundary off the time-slice grid', () => {
    // seven minutes before the boundary: a +20 tick straddles it but lands
    // on a value that isn’t a multiple of 240
    state.timePassed = firstWinterTick - 7;

    worldTimeTick();

    expect(getIsSummer(START_DATE, firstWinterTick - 7)).toEqual(true);
    expect(getIsSummer(START_DATE, state.timePassed)).toEqual(false);
    expect(state.timePassed % 240).not.toEqual(0);
    expect(mocks.indicators).toHaveBeenCalledTimes(1);

    worldTimeTick(); // still winter and off the slice: no duplicate update
    expect(mocks.indicators).toHaveBeenCalledTimes(1);
  });
});
