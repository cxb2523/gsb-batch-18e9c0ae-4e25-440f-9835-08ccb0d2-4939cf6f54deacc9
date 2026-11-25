import {
  CardinalDirection,
  Direction,
  directionToChanges,
  Position,
} from '../../types';
import getShipSpeed from './shipSpeed';
import state from '../../state/state';
import { directionMap } from '../../input';
import updateInterface from '../../state/updateInterface';
import { calculateDestination } from './worldUtils';
import { getXWrapAround } from './sharedUtils';
import { getCaptain } from '../../state/selectors';

const createWorldPlayer = (
  startPosition: Position,
  startFrame: number,
  startDirection: CardinalDirection,
) => {
  let position = startPosition;
  let destination: Position | undefined;

  let { frameOffset } = directionToChanges[startDirection];
  let frameAlternate = 0;

  let heading: Direction | '' = '';
  let speed = 0;

  /*
    Speed depends on heading, wind, captain, crew and cargo. The signature
    lets updateSpeed skip the actual recalculation (and interface update)
    unless at least one of those inputs changed, preserving the time-sliced
    update cadence instead of recomputing every frame.
   */
  let lastSpeedSignature: string | undefined;

  updateInterface.playerFleetDirection(directionMap[heading]);

  const animate = () => {
    frameAlternate = frameAlternate === 0 ? 1 : 0;
  };

  return {
    move: (
      direction: Direction,
      collisionAt: (position: Position) => boolean,
    ) => {
      animate();

      const {
        xDelta,
        yDelta,
        frameOffset: newFrameOffset,
      } = directionToChanges[direction];
      frameOffset = newFrameOffset;

      const isDiagonal = Math.abs(xDelta) > 0 && Math.abs(yDelta) > 0;
      const multiplier = speed / 40 / (isDiagonal ? Math.SQRT2 : 1);

      if (!isDiagonal) {
        destination = calculateDestination(
          position,
          xDelta,
          yDelta,
          multiplier,
          collisionAt,
        );

        return;
      }

      const firstDestination = calculateDestination(
        position,
        xDelta,
        0,
        multiplier,
        collisionAt,
      );

      destination = calculateDestination(
        firstDestination,
        0,
        yDelta,
        multiplier,
        collisionAt,
      );
    },
    update: () => {
      if (destination) {
        position = {
          x: getXWrapAround(destination.x),
          y: destination.y,
        };
      }
    },
    position: (percentNextMove = 0) => {
      if (!destination) {
        return position;
      }

      return {
        x: getXWrapAround(
          position.x + (destination.x - position.x) * percentNextMove,
        ),
        y: position.y + (destination.y - position.y) * percentNextMove,
      };
    },
    destination: () => destination,
    setHeading: (newHeading: Direction | '') => {
      if (newHeading === heading) {
        return;
      }

      heading = newHeading;

      updateInterface.playerFleetDirection(directionMap[heading]);
    },
    heading: () => heading,
    speed: () => speed,
    updateSpeed: (force = false) => {
      const ship = state.fleets[1]?.ships[0];
      // a captain is only needed once there’s a heading to sail in
      const captain = heading ? getCaptain(0) : undefined;

      const speedSignature = JSON.stringify({
        heading,
        wind: state.wind ?? null,
        ship: ship
          ? {
              id: ship.id,
              crew: ship.crew,
              cargo: ship.cargo.map(({ type, quantity }) => ({
                type,
                quantity,
              })),
            }
          : null,
        captain: captain
          ? {
              navigationLevel: captain.navigationLevel,
              seamanship: captain.stats.seamanship,
            }
          : null,
      });

      if (!force && speedSignature === lastSpeedSignature) {
        return;
      }

      lastSpeedSignature = speedSignature;

      if (!heading) {
        speed = 0;
      } else {
        speed = getShipSpeed(ship, captain!, directionMap[heading], state.wind);
      }

      updateInterface.playerFleetSpeed(speed);
    },
    frame: () => startFrame + frameOffset + frameAlternate,
    width: 2,
    height: 2,
  };
};

export type WorldPlayer = ReturnType<typeof createWorldPlayer>;

export default createWorldPlayer;
