import { makeBall } from "./ball.js";
import { randomColor } from "./colors.js";
import { randomBetween } from "./helpers.js";

export const makeFirework = (canvasManager, audioManager) => {
  const baseBall = makeBall(
    canvasManager,
    {
      startPosition: {
        x: randomBetween(0, canvasManager.getWidth()),
        y: canvasManager.getHeight(),
      },
      startVelocity: { x: randomBetween(-1, 1), y: randomBetween(-8, -10) },
      radius: randomBetween(6, 14),
      fill: randomColor(),
      delay: randomBetween(0, 1200),
    },
    () => {},
    () => {}
  );

  // Once a level transition starts we stop launching new firework pops and
  // collapse any in-flight explosion into a single bounded wrap-up, so the
  // effect can't carry over into the next level or accumulate forever.
  let finished = false;
  let released = false;

  const draw = (deltaTime) => {
    if (released) return;

    if (!finished && !baseBall.isPopped() && baseBall.getVelocity().y > 1) {
      // Give fireworks pops a downwards trajectory
      baseBall.pop({ x: 0, y: 2 });
      audioManager.playSequentialPluck();
    }

    baseBall.draw(deltaTime);
  };

  const finish = (deadline) => {
    if (released) return;
    finished = true;

    if (baseBall.isPopped()) baseBall.finish(deadline);
    else baseBall.release();
  };

  const release = () => {
    released = true;
    baseBall.release();
  };

  return {
    draw,
    finish,
    release,
  };
};
