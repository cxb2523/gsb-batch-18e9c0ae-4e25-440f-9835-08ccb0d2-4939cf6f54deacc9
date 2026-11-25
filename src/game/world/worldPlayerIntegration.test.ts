import { beforeEach, describe, expect, test, vi } from 'vitest';
import createWorldPlayer from './worldPlayer';
import state from '../../state/state';

const ui = vi.hoisted(() => ({
  playerFleetSpeed: vi.fn(),
  playerFleetDirection: vi.fn(),
}));

vi.mock('../../state/updateInterface', () => ({
  default: {
    playerFleetSpeed: ui.playerFleetSpeed,
    playerFleetDirection: ui.playerFleetDirection,
  },
}));

/*
  End-to-end through the real getShipSpeed formula and real getCaptain
  selector, proving crew, cargo and captain changes produce new speeds.
 */
describe('worldPlayer speed recalculation (real ship formula)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    state.wind = { direction: 0, speed: 3 };
    state.mates = [{ sailorId: '1', role: 0 }]; // João Franco
    state.fleets[1].ships[0] = {
      id: '22', // La Reale: minimumCrew 30, capacity 450
      name: 'La Reale',
      crew: 30,
      cargo: [],
      durability: 60,
    };
  });

  const sailingPlayer = () => {
    const player = createWorldPlayer({ x: 0, y: 0 }, 0, 'n');
    player.setHeading('n');
    player.updateSpeed();
    return player;
  };

  test('no heading means zero speed', () => {
    const player = createWorldPlayer({ x: 0, y: 0 }, 0, 'n');

    player.updateSpeed();

    expect(player.speed()).toEqual(0);
    expect(ui.playerFleetSpeed).toHaveBeenLastCalledWith(0);
  });

  test('increasing an under-strength crew raises the speed', () => {
    state.fleets[1].ships[0].crew = 5;
    const player = sailingPlayer();
    const underCrewed = player.speed();

    state.fleets[1].ships[0].crew = 30;
    player.updateSpeed();

    expect(player.speed()).toBeGreaterThan(underCrewed);
  });

  test('loading cargo lowers the speed', () => {
    const player = sailingPlayer();
    const lightLoad = player.speed();

    state.fleets[1].ships[0].cargo.push({ type: 'water', quantity: 300 });
    player.updateSpeed();

    expect(player.speed()).toBeLessThan(lightLoad);
  });

  test('assigning a more skilled captain raises the speed', () => {
    const player = sailingPlayer();
    const joaoSpeed = player.speed();

    state.mates[0].sailorId = '32'; // Rocco Alemkel: navigationLevel 30
    player.updateSpeed();

    expect(player.speed()).toBeGreaterThan(joaoSpeed);
  });

  test('clearing and restoring the heading zeroes then restores the speed', () => {
    const player = sailingPlayer();
    const fullSpeed = player.speed();
    expect(fullSpeed).toBeGreaterThan(0);

    player.setHeading('');
    player.updateSpeed();
    expect(player.speed()).toEqual(0);

    player.setHeading('n');
    player.updateSpeed();
    expect(player.speed()).toEqual(fullSpeed);
  });

  test('does not publish a new speed while every input is unchanged', () => {
    const player = sailingPlayer();
    expect(ui.playerFleetSpeed).toHaveBeenCalledTimes(1);

    player.updateSpeed();
    player.updateSpeed();

    expect(ui.playerFleetSpeed).toHaveBeenCalledTimes(1);
  });
});
