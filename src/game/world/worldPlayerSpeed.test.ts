import { beforeEach, describe, expect, test, vi } from 'vitest';
import createWorldPlayer from './worldPlayer';
import state from '../../state/state';

const mocks = vi.hoisted(() => ({
  getShipSpeed: vi.fn(),
  getCaptain: vi.fn(),
  playerFleetSpeed: vi.fn(),
  playerFleetDirection: vi.fn(),
}));

vi.mock('./shipSpeed', () => ({
  default: mocks.getShipSpeed,
}));

vi.mock('../../state/selectors', () => ({
  getCaptain: mocks.getCaptain,
}));

vi.mock('../../state/updateInterface', () => ({
  default: {
    playerFleetSpeed: mocks.playerFleetSpeed,
    playerFleetDirection: mocks.playerFleetDirection,
  },
}));

const captain = {
  navigationLevel: 3,
  stats: { seamanship: 80 },
};

const createShip = () => ({
  id: '1',
  name: 'Test ship',
  crew: 5,
  cargo: [] as { type: 'water' | 'food'; quantity: number }[],
  durability: 50,
});

describe('worldPlayer.updateSpeed', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    state.wind = { direction: 0, speed: 3 };
    state.fleets[1].ships[0] = createShip();
    mocks.getCaptain.mockReturnValue(captain);
    mocks.getShipSpeed.mockReturnValue(12);
  });

  test('is zero without a heading and updates the indicator', () => {
    const player = createWorldPlayer({ x: 0, y: 0 }, 0, 'n');

    player.updateSpeed();

    expect(player.heading()).toEqual('');
    expect(player.speed()).toEqual(0);
    expect(mocks.getShipSpeed).not.toHaveBeenCalled();
    expect(mocks.playerFleetSpeed).toHaveBeenCalledWith(0);
  });

  test('still returns zero without a heading when no wind has been generated', () => {
    state.wind = undefined as unknown as typeof state.wind;

    const player = createWorldPlayer({ x: 0, y: 0 }, 0, 'n');

    expect(() => player.updateSpeed()).not.toThrow();
    expect(player.speed()).toEqual(0);
    expect(mocks.playerFleetSpeed).toHaveBeenCalledWith(0);
  });

  test('does not recalculate when heading, wind, captain, crew and cargo are unchanged', () => {
    const player = createWorldPlayer({ x: 0, y: 0 }, 0, 'n');

    player.setHeading('n');
    player.updateSpeed();
    player.updateSpeed();
    player.updateSpeed();

    expect(mocks.getShipSpeed).toHaveBeenCalledTimes(1);
    expect(mocks.playerFleetSpeed).toHaveBeenCalledTimes(1);
  });

  test('recalculates when the heading changes', () => {
    const player = createWorldPlayer({ x: 0, y: 0 }, 0, 'n');

    player.setHeading('n');
    player.updateSpeed();

    player.setHeading('e');
    player.updateSpeed();

    expect(mocks.getShipSpeed).toHaveBeenCalledTimes(2);
    expect(mocks.getShipSpeed).toHaveBeenLastCalledWith(
      state.fleets[1].ships[0],
      captain,
      2, // directionMap.e
      state.wind,
    );
  });

  test('recalculates when the wind changes', () => {
    const player = createWorldPlayer({ x: 0, y: 0 }, 0, 'n');

    player.setHeading('n');
    player.updateSpeed();

    state.wind = { direction: 4, speed: 6 };
    player.updateSpeed();

    expect(mocks.getShipSpeed).toHaveBeenCalledTimes(2);
    expect(mocks.getShipSpeed).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      0,
      { direction: 4, speed: 6 },
    );
  });

  test('recalculates when the crew changes', () => {
    const player = createWorldPlayer({ x: 0, y: 0 }, 0, 'n');

    player.setHeading('n');
    player.updateSpeed();

    state.fleets[1].ships[0].crew = 20;
    player.updateSpeed();

    expect(mocks.getShipSpeed).toHaveBeenCalledTimes(2);
    expect(mocks.getShipSpeed.mock.lastCall?.[0]).toMatchObject({ crew: 20 });
  });

  test('recalculates when cargo is loaded or unloaded', () => {
    const player = createWorldPlayer({ x: 0, y: 0 }, 0, 'n');

    player.setHeading('n');
    player.updateSpeed();

    state.fleets[1].ships[0].cargo.push({ type: 'water', quantity: 40 });
    player.updateSpeed();

    expect(mocks.getShipSpeed).toHaveBeenCalledTimes(2);
    expect(mocks.getShipSpeed.mock.lastCall?.[0]).toMatchObject({
      cargo: [{ type: 'water', quantity: 40 }],
    });

    state.fleets[1].ships[0].cargo[0].quantity = 10;
    player.updateSpeed();

    expect(mocks.getShipSpeed).toHaveBeenCalledTimes(3);
  });

  test('recalculates when the captain changes', () => {
    const player = createWorldPlayer({ x: 0, y: 0 }, 0, 'n');

    player.setHeading('n');
    player.updateSpeed();

    const newCaptain = {
      navigationLevel: 9,
      stats: { seamanship: 95 },
    };
    mocks.getCaptain.mockReturnValue(newCaptain);
    player.updateSpeed();

    expect(mocks.getShipSpeed).toHaveBeenCalledTimes(2);
    expect(mocks.getShipSpeed.mock.lastCall?.[1]).toBe(newCaptain);
  });

  test('clearing the heading zeroes speed, and restoring it recomputes immediately', () => {
    const player = createWorldPlayer({ x: 0, y: 0 }, 0, 'n');

    player.setHeading('n');
    player.updateSpeed();
    expect(player.speed()).toEqual(12);

    player.setHeading('');
    player.updateSpeed();
    expect(player.speed()).toEqual(0);
    expect(mocks.playerFleetSpeed).toHaveBeenLastCalledWith(0);

    // crew and cargo change while adrift
    state.fleets[1].ships[0].crew = 40;
    state.fleets[1].ships[0].cargo.push({ type: 'food', quantity: 12 });
    player.updateSpeed();

    // no heading still means zero and no ship speed calculation
    expect(player.speed()).toEqual(0);
    expect(mocks.getShipSpeed).toHaveBeenCalledTimes(1);

    player.setHeading('s');
    player.updateSpeed();

    expect(mocks.getShipSpeed).toHaveBeenCalledTimes(2);
    expect(mocks.getShipSpeed.mock.lastCall?.[0]).toMatchObject({
      crew: 40,
      cargo: [{ type: 'food', quantity: 12 }],
    });
    expect(player.speed()).toEqual(12);
    expect(mocks.playerFleetSpeed).toHaveBeenLastCalledWith(12);
  });

  test('can be forced to refresh after returning to sea', () => {
    const player = createWorldPlayer({ x: 0, y: 0 }, 0, 'n');

    player.setHeading('n');
    player.updateSpeed();
    player.updateSpeed(true);

    expect(mocks.getShipSpeed).toHaveBeenCalledTimes(2);
  });
});
