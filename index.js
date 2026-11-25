import { makeCanvasManager } from "./canvas.js";
import { BLAST_MAX_DURATION, FONT, FONT_WEIGHT_BOLD } from "./constants.js";
import {
  animate,
  clampedProgress,
  findBallAtPoint,
  randomBetween,
  transition,
  getBoundedPosition,
} from "./helpers.js";
import { background } from "./colors.js";
import {
  checkParticleCollision,
  adjustParticlePositions,
  resolveParticleCollision,
} from "./particle.js";
import { makeRipple } from "./ripple.js";
import { makeAudioManager } from "./audio.js";
import { makeLifeManager } from "./lifeManager.js";
import { makeLevelManager } from "./level.js";
import { makeInterstitialButtonManager } from "./interstitialButton.js";
import { makeActivePointer } from "./activePointer.js";
import { makeTextBlock } from "./textBlock.js";
import { makeScoreDisplay } from "./scoreDisplay.js";
import { makeLevelBalls, decodeLevel } from "./levelData.js";
import { makeScoreStore } from "./scoreStore.js";
import { makeTutorialManager } from "./tutorial.js";
import { makeFirework } from "./firework.js";
import { makeShareImageManager } from "./shareImage.js";

function parsePreviewData(encodedLevel) {
  if (!encodedLevel) return false;

  try {
    const parsed = decodeLevel(encodedLevel);
    return Array.isArray(parsed?.balls) ? parsed : false;
  } catch (e) {
    return false;
  }
}

const URLParams = new URLSearchParams(window.location.search);
const previewData = parsePreviewData(URLParams.get("level"));
const previewDataPresent = !!previewData;

if (previewDataPresent) {
  const previewTitle = `Bubbles! - “${previewData.name}”`;
  const previewDesc = "Click to play this custom level preview";
  document.title = previewTitle;
  document
    .querySelector('meta[property="og:title"]')
    .setAttribute("content", previewTitle);
  document
    .querySelector('meta[name="description"]')
    .setAttribute("content", previewDesc);
  document
    .querySelector('meta[property="og:description"]')
    .setAttribute("content", previewDesc);
}

const canvasManager = makeCanvasManager({
  initialWidth: window.innerWidth,
  initialHeight: window.innerHeight,
  maxWidth: 800,
  attachNode: "#canvas",
});
const audioManager = makeAudioManager();
const lifeManager = makeLifeManager(canvasManager);
const levelManager = makeLevelManager(
  canvasManager,
  onInterstitial,
  previewDataPresent ? onPreviewAdvance : onLevelAdvance,
  previewData
);
const scoreStore = makeScoreStore(levelManager);
const scoreDisplay = makeScoreDisplay(canvasManager, scoreStore, levelManager);
const interstitialButtonManager = makeInterstitialButtonManager(canvasManager);
const interstitialText = makeTextBlock(
  canvasManager,
  {
    xPos: () => canvasManager.getWidth() / 2,
    yPos: () => canvasManager.getHeight() / 2,
    textAlign: "center",
    verticalAlign: "center",
  },
  []
);

const tutorialManager = makeTutorialManager(
  canvasManager,
  onTutorialStart,
  onTutorialAdvance,
  resetGame
);
const shareImageManager = makeShareImageManager(scoreStore, levelManager);
const CTX = canvasManager.getContext();

levelManager.setScoreStore(scoreStore);

// A level switch is a single, cancellable transition. These constants bound
// the "one-shot" wrap-up of the finished level's effects and debounce the
// interstitial input so a double click/key can't advance twice.
const LEVEL_WRAP_UP_DURATION = 1200;
const INTERSTITIAL_ACTION_DEBOUNCE = 320;

// These are all reset on game restart
let activePointers = [];
let pointerTriggerOutput = [];
let previousLevelBalls = [];
let balls = [];
let ripples = [];
let fireworks = [];
// True from the moment the final bubble is popped until the next level (or
// restart) begins. Guarantees the finish wrap-up runs at most once per level.
let levelFinishStarted;
// Debounces interstitial actions (pointer clicks, space/enter) across the
// restart path, where a fresh interstitial is shown immediately.
let lastInterstitialActionAt = 0;

function releaseBalls(list) {
  list.forEach((ball) => ball.release());
}

function releaseFireworks(list) {
  list.forEach((firework) => firework.release());
}

// Tear down only the finished level's wrap-up (popping fragments + fireworks).
// Safe to call repeatedly; the arrays are emptied and release is idempotent.
function releaseWrapUp() {
  releaseBalls(previousLevelBalls);
  releaseFireworks(fireworks);
  previousLevelBalls = [];
  fireworks = [];
  levelFinishStarted = false;
}

function clearTransientEffects() {
  activePointers = [];
  pointerTriggerOutput = [];
  ripples = [];
}

// Called exactly once when the last bubble of a level is popped. The still-
// popping fragments are handed off to a bounded, one-shot wrap-up; everything
// else from the finished level (live/unplayed balls, trails, ripples) is dropped
// immediately so it can never bleed into the next level.
function beginLevelFinishing() {
  if (levelFinishStarted) return;
  levelFinishStarted = true;

  // Any pop-queued interstitial is superseded by this explicit wrap-up.
  levelManager.cancelPendingInterstitial();

  const deadline = Date.now() + LEVEL_WRAP_UP_DURATION;
  const popping = balls.filter((b) => b.isPopping());

  balls.forEach((b) => {
    if (!popping.includes(b)) b.release();
  });
  balls = [];

  // Never stack a wrap-up on top of an older one.
  releaseBalls(previousLevelBalls);
  previousLevelBalls = popping;
  popping.forEach((b) => b.finish(deadline));

  fireworks.forEach((f) => f.finish(deadline));

  clearTransientEffects();
}

function resetGame() {
  levelManager.cancelPendingInterstitial();
  releaseWrapUp();
  releaseBalls(balls);
  balls = [];
  clearTransientEffects();
  lifeManager.reset();
  levelManager.reset();
  tutorialManager.isTutorialComplete()
    ? levelManager.showLevelInterstitial()
    : tutorialManager.showTutorial();
  audioManager.resetPluckSequence();
  scoreStore.reset();
}
resetGame();

function resetLevelData() {
  // The previous level's wrap-up is intentionally kept here: it plays on as a
  // one-shot flourish over the interstitial and the next level's countdown,
  // then the draw loop releases it. Only transient input effects are cleared.
  clearTransientEffects();
  audioManager.resetPluckSequence();
}

function resetPreviewData() {
  levelManager.cancelPendingInterstitial();
  clearTransientEffects();
  audioManager.resetPluckSequence();
  lifeManager.reset();
  scoreStore.reset();
}

function resetOngoingVisuals() {
  clearTransientEffects();
}

// Bubbles are only hittable while they are actually being drawn. During the
// end-of-level settle pause and a new level's countdown the bubbles are gone or
// not drawn yet, so input must be ignored there too — otherwise a stray click
// (e.g. the tail of a Continue burst) could pop an invisible bubble and trigger
// a second advance.
function levelInteractionAllowed() {
  const tutorialComplete = tutorialManager.isTutorialComplete();

  if (!tutorialComplete) return true;

  return (
    !levelManager.isInterstitialShowing() &&
    !levelManager.isSettling() &&
    !levelManager.levelCountingDown() &&
    !levelManager.isGameOver()
  );
}

function advanceFromInterstitial() {
  if (!levelManager.isInterstitialShowing()) return;

  // Ignore a burst of clicks/keys (and the restart path's immediately
  // re-shown interstitial) within the same gesture.
  const now = Date.now();
  if (now - lastInterstitialActionAt < INTERSTITIAL_ACTION_DEBOUNCE) return;
  lastInterstitialActionAt = now;

  const shouldRestart =
    levelManager.isGameOver() ||
    levelManager.isLastLevel() ||
    levelManager.missedFirstBubble();

  if (shouldRestart) {
    // resetGame() clears the interstitial state, any queued timer, and the
    // leftover effects before showing a fresh screen.
    resetGame();
  } else {
    levelManager.dismissInterstitialAndAdvanceLevel();
  }
}

canvasManager.getElement().addEventListener("pointerdown", (e) => {
  const { pointerId, offsetX: x, offsetY: y } = e;

  if (levelManager.isInterstitialShowing()) {
    interstitialButtonManager.handleClick(
      { x, y },
      advanceFromInterstitial,
      shareImageManager.share
    );
  } else if (!levelInteractionAllowed()) {
    // A new level is still counting down; bubbles aren't drawn yet, so ignore.
    e.preventDefault();
    return;
  } else {
    try {
      canvasManager.getElement().setPointerCapture(pointerId);
    } catch (e) {}

    activePointers.push(
      makeActivePointer(
        canvasManager,
        audioManager,
        scoreStore,
        tutorialManager,
        pointerId,
        { x, y },
        findBallAtPoint(
          balls.filter((b) => b.inPlay() && b.inViewport()),
          { x, y }
        ),
        onPointerTrigger,
        handleGameClick
      )
    );
  }

  e.preventDefault();
});

canvasManager.getElement().addEventListener("pointerup", (e) => {
  const { pointerId, offsetX: x, offsetY: y } = e;
  const releasedPointers = activePointers.filter(
    (pointer) => pointerId === pointer.getId()
  );

  activePointers = activePointers.filter(
    (pointer) => pointerId !== pointer.getId()
  );

  releasedPointers.forEach((pointer) => {
    pointer.setPosition({ x, y });
    if (!levelManager.isInterstitialShowing()) pointer.trigger();
  });

  e.preventDefault();
});

canvasManager.getElement().addEventListener("pointercancel", (e) => {
  activePointers = activePointers.filter(
    (pointer) => e.pointerId !== pointer.getId()
  );
});

canvasManager.getElement().addEventListener("pointermove", (e) => {
  const { pointerId, offsetX: x, offsetY: y } = e;

  activePointers.forEach((pointer) => {
    if (pointerId === pointer.getId()) pointer.setPosition({ x, y });
  });

  if (levelManager.isInterstitialShowing())
    interstitialButtonManager.handleHover({ x, y });

  e.preventDefault();
});

document.addEventListener("keydown", ({ key }) => {
  const validKey = key === " " || key === "Enter";

  if (
    validKey &&
    levelManager.isInterstitialShowing() &&
    interstitialButtonManager.hasDelayPassed()
  ) {
    document.body.classList.remove("buttonHover");
    advanceFromInterstitial();
  }
});

// Scale or translate the entire game
const cameraWrapper = (drawFunc) => {
  const cameraShake = (magnitudeProgress) => {
    const rotationAmount = transition(0, Math.PI / 90, magnitudeProgress);
    const shakeAmount = transition(0, 4, magnitudeProgress);

    // Translate to center and rotate randomly
    CTX.translate(canvasManager.getWidth() / 2, canvasManager.getHeight() / 2);
    CTX.rotate(randomBetween(-rotationAmount, rotationAmount));

    // Translate back to top left to reset w/o calling restore()
    CTX.translate(
      -canvasManager.getWidth() / 2,
      -canvasManager.getHeight() / 2
    );

    // Move canvas randomly
    CTX.translate(
      randomBetween(-shakeAmount, shakeAmount),
      randomBetween(-shakeAmount, shakeAmount)
    );
  };

  if (
    pointerTriggerOutput.filter((o) => !o.isGone() && o.causesShake()).length
  ) {
    CTX.save();
    cameraShake(0.5);
    drawFunc();
    CTX.restore();
  } else {
    drawFunc();
  }
};

const triggerTimedOutHoldBlasts = () => {
  const timedOut = activePointers.filter(
    (p) => p.isHoldBlast() && p.getDuration() >= BLAST_MAX_DURATION
  );

  if (timedOut.length) {
    activePointers = activePointers.filter((p) => !timedOut.includes(p));
    timedOut.forEach((p) => p.trigger());
  }
};

const detectCollisionsForGameObjects = () => {
  // Run collision detection on bubbles and bounce bubbles off eachother
  // Run collision detection on blasts + slingshots and pop colliding bubbles
  const ballsInPlay = balls.filter((b) => b.inPlay());
  const outputsInPlay = pointerTriggerOutput.filter((p) => !p.isGone());

  ballsInPlay.forEach((ballA, indexA) => {
    for (let indexB = indexA + 1; indexB < ballsInPlay.length; indexB++) {
      const ballB = ballsInPlay[indexB];
      const collision = checkParticleCollision(ballA, ballB);
      if (collision[0]) {
        adjustParticlePositions(ballA, ballB, collision[1]);
        resolveParticleCollision(ballA, ballB);
      }
    }

    if (ballA.inViewport()) {
      outputsInPlay.forEach((output) => {
        if (ballA.isPopped()) return;

        const collision = checkParticleCollision(ballA, output);
        if (collision[0]) {
          output.isHoldBlast()
            ? ballA.pop(output.getRelativeVelocity(ballA.getPosition()))
            : ballA.pop(output.getVelocity());

          output.logCollision();

          audioManager.playSequentialPluck();
        }
      });
    }
  });
};

const drawComboMessages = (deltaTime) => {
  scoreStore
    .getCombos()
    .filter(({ hasShownCombo }) => !hasShownCombo)
    .forEach(({ popped, position, spring }) => {
      spring.update(deltaTime);

      const boundedPosition = getBoundedPosition(canvasManager, position, 100);
      const text = `x${popped}!`;
      const textHeight = 48;

      const fadeIn = transition(
        0,
        1,
        clampedProgress(0, 1, spring.getCurrentValue())
      );
      const slideUp = transition(
        boundedPosition.y + 100,
        boundedPosition.y + textHeight / 2,
        spring.getCurrentValue()
      );
      const rotateIn = transition(
        -Math.PI / 2,
        Math.PI / 80,
        spring.getCurrentValue()
      );
      const scaleIn = transition(0.01, 1, spring.getCurrentValue());

      CTX.save();
      CTX.globalAlpha = fadeIn;
      CTX.translate(boundedPosition.x, slideUp);
      CTX.rotate(rotateIn);
      CTX.scale(scaleIn, scaleIn);
      CTX.font = `${FONT_WEIGHT_BOLD} 64px ${FONT}`;

      // Shadow
      CTX.fillStyle = "#000";
      CTX.textAlign = "center";
      CTX.fillText(text, 0, 0);

      // Text
      CTX.translate(-2, -3);
      CTX.fillStyle = "#fff";
      CTX.fillText(text, 0, 0);

      CTX.restore();
    });
};

animate((deltaTime) => {
  CTX.save();
  CTX.fillStyle = background;
  CTX.fillRect(0, 0, canvasManager.getWidth(), canvasManager.getHeight());
  CTX.restore();

  cameraWrapper(() => {
    // Trigger holdBlasts that have been held down past the max time
    if (!levelManager.isInterstitialShowing()) {
      triggerTimedOutHoldBlasts();
    }

    // Skip collision pops while the new level is counting down: its bubbles
    // exist but aren't drawn yet, so a lingering blast/slingshot must not pop
    // them invisibly.
    if (
      !levelManager.isInterstitialShowing() &&
      !levelManager.levelCountingDown()
    ) {
      detectCollisionsForGameObjects();
    }

    // Draw text elements (level, life, interstitial) underneath bubbles
    levelManager.drawInterstitialMessage({
      previewInitialMessage: (msElapsed) => {
        const text = `Preview of “${previewData.name}”`;
        if (interstitialText.getLines()[0] !== text)
          interstitialText.updateLines([text]);

        interstitialText.draw(deltaTime);

        interstitialButtonManager.draw(deltaTime, msElapsed, {
          delay: 80,
          text: "Play Preview",
        });
      },
      initialMessage: (msElapsed) => {
        const text = tutorialManager.isTutorialCompletedThisSession()
          ? "Bubbles fall from the top"
          : "Pop the bubble";
        if (interstitialText.getLines()[0] !== text)
          interstitialText.updateLines([text]);

        interstitialText.draw(deltaTime);

        interstitialButtonManager.draw(deltaTime, msElapsed, {
          delay: 80,
          text: "Play",
        });
      },
      retryFirstLevelMessage: (msElapsed) => {
        const textArray = ["Whoops, try to get", "that bubble"];
        if (interstitialText.getLines()[0] !== textArray[0])
          interstitialText.updateLines(textArray);

        interstitialText.draw(deltaTime);

        interstitialButtonManager.draw(deltaTime, msElapsed, {
          delay: 80,
          text: "Try Again",
        });
      },
      defaultMessage: (msElapsed) => {
        scoreDisplay.draw(deltaTime);
        shareImageManager.draw(deltaTime, msElapsed);
        interstitialButtonManager.draw(deltaTime, msElapsed, {
          delay: 960,
          isSharable: true,
        });
      },
      endGameMessage: (msElapsed) => {
        scoreDisplay.draw(deltaTime);
        shareImageManager.draw(deltaTime, msElapsed);
        interstitialButtonManager.draw(deltaTime, msElapsed, {
          delay: 1920,
          text: "Try Again",
          isSharable: true,
        });
      },
      reachedEndOfGameMessage: (msElapsed) => {
        scoreDisplay.draw(deltaTime);
        shareImageManager.draw(deltaTime, msElapsed);
        interstitialButtonManager.draw(deltaTime, msElapsed, {
          delay: 1920,
          text: "Play Again",
          isSharable: true,
        });
      },
    });

    if (tutorialManager.isTutorialComplete()) {
      levelManager.drawLevelNumber();

      if (!levelManager.isInterstitialShowing() && !levelManager.isGameOver()) {
        lifeManager.draw();
      }
    } else {
      tutorialManager.draw(deltaTime);
    }

    // Draw main game elements
    ripples.forEach((r) => r.draw());

    // The finished level's wrap-up (popping fragments + fireworks) is a single
    // one-shot flourish: it plays through the end-of-level pause and the
    // interstitial, then is released the moment the next level's countdown
    // begins, so it can never be painted on top of the new bubbles or
    // accumulate. During the tutorial there is no level transition, so the
    // popping hand-off keeps its original behaviour.
    const tutorialComplete = tutorialManager.isTutorialComplete();
    const countdownVisible = levelManager.levelCountingDown();

    if (!tutorialComplete) {
      previousLevelBalls.forEach((b) => b.draw(deltaTime));
    } else {
      const wrapUpVisible =
        levelManager.isSettling() || levelManager.isInterstitialShowing();
      if (wrapUpVisible) {
        previousLevelBalls.forEach((b) => b.draw(deltaTime));
        fireworks.forEach((f) => f.draw(deltaTime));
      } else if (previousLevelBalls.length || fireworks.length) {
        releaseWrapUp();
      }
    }

    levelManager.drawLevelCountdown(deltaTime);
    if (!countdownVisible) {
      balls.forEach((b) => b.draw(deltaTime));
    }

    pointerTriggerOutput.forEach((b) => b.draw(deltaTime));
    activePointers.forEach((p) => p.draw());

    // Draw combo messages over everything
    if (tutorialManager.isTutorialComplete()) {
      drawComboMessages(deltaTime);
    }
  });
});

function handleGameClick(currentTapPosition, ballAtPointOfInitialTap) {
  // In case of an active tutorial, the ball pop may be the first interaction
  // Subsequent calls are ignored.
  audioManager.initialize();

  // Taps are delayed until pointerup so that we can determine whether a tap
  // is a slingshot, blast, or tap, and not trigger two events from one gesture.
  // So that taps don't feel slow, and the game isn't frustrating, we detect
  // what ball the user would have popped on pointerdown as well as pointerup
  // and let them have the pop in either case.
  const collisionOnPointerUp = findBallAtPoint(
    balls.filter((b) => b.inPlay() && b.inViewport()),
    currentTapPosition
  );
  const collidingBall =
    ballAtPointOfInitialTap && ballAtPointOfInitialTap.inPlay()
      ? ballAtPointOfInitialTap
      : collisionOnPointerUp;

  if (collidingBall) {
    scoreStore.recordTap(currentTapPosition, 1, collidingBall.getFill());
    collidingBall.pop();
    audioManager.playSequentialPluck();
  } else {
    scoreStore.recordTap(currentTapPosition, 0);
    ripples.push(makeRipple(canvasManager, currentTapPosition));
    audioManager.playMiss();
  }
}

function onPointerTrigger(output) {
  pointerTriggerOutput.push(output);
}

function onPop() {
  if (balls.filter((b) => b.inPlay()).length === 0) {
    // The pop that empties the level immediately folds the leftovers into a
    // one-shot wrap-up (so they can't bleed into the next level), then asks
    // the level manager to queue the single delayed interstitial. Both calls
    // are idempotent, so duplicate pop notifications are harmless.
    beginLevelFinishing();
    levelManager.scheduleLevelInterstitial();
  }
}

function onMiss() {
  if (!levelManager.isGameOver()) {
    scoreStore.recordMiss();
    lifeManager.subtract();
    audioManager.playRandomFireworks();

    if (lifeManager.getLives() <= 0) {
      onGameEnd();
    } else if (balls.filter((b) => b.inPlay()).length === 0) {
      if (levelManager.getLevel() === 1) {
        levelManager.setMissedFirstBubble();
      }
      // A miss that clears the level skips the celebration wait; fold any
      // in-flight pops into the same one-shot wrap-up (so they can't bleed
      // into the next level) and show the interstitial immediately. Both
      // helpers are idempotent, so a pop/miss race stays safe.
      beginLevelFinishing();
      levelManager.showLevelInterstitial();
    }
  }
}

function onTutorialPop() {
  if (balls.filter((b) => b.inPlay()).length === 0) {
    tutorialManager.advance();
  }
}

function onGameEnd() {
  // Drop any queued level-complete interstitial and release the finished
  // level's leftover fragments before the game-over screen takes over.
  levelManager.cancelPendingInterstitial();
  releaseWrapUp();
  releaseBalls(balls);
  balls = [];
  clearTransientEffects();
  audioManager.playLose();
  levelManager.onGameOver();
}

function onInterstitial() {
  scoreDisplay.update();
  shareImageManager.update();
  resetOngoingVisuals();

  if (!levelManager.isGameOver() && levelManager.isLastLevel()) {
    // Starting a fresh set of fireworks replaces (and releases) any that were
    // still playing so they never accumulate across interstitials.
    releaseFireworks(fireworks);
    fireworks = new Array(8)
      .fill()
      .map(() => makeFirework(canvasManager, audioManager));
  }
}

function onLevelAdvance() {
  // resetLevelData() deliberately keeps the previous level's wrap-up so it can
  // finish its one-shot flourish over the new level's countdown.
  resetLevelData();

  // The finish wrap-up is already held in previousLevelBalls (handed off by
  // beginLevelFinishing); anything still popping in `balls` shouldn't exist.
  balls = makeLevelBalls(
    canvasManager,
    levelManager.getLevelData(),
    onPop,
    onMiss
  );
  // A brand-new level is live, so its own finish wrap-up may begin once its
  // bubbles are popped. (The previous wrap-up is still drawn until the
  // countdown ends, then released.)
  levelFinishStarted = false;

  // Call on first interaction. Subsequent calls are ignored.
  audioManager.initialize();
  audioManager.playRandomLevel();
}

function onPreviewAdvance() {
  resetPreviewData();

  balls = makeLevelBalls(canvasManager, previewData, onPop, onMiss);
  levelFinishStarted = false;

  // Call on first interaction. Subsequent calls are ignored.
  audioManager.initialize();
  audioManager.playRandomLevel();
}

function onTutorialStart() {
  balls = tutorialManager.generateBalls(onTutorialPop, () => {});
}

function onTutorialAdvance() {
  previousLevelBalls = balls.filter((b) => b.isPopping());
  balls = tutorialManager.generateBalls(onTutorialPop, () => {});
}
