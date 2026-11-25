import { yellow, white } from "./colors.js";
import { FONT, FONT_WEIGHT_BOLD } from "./constants.js";
import { levels as levelData, getLevelDataByNumber } from "./levelData.js";
import { drawTextRotate } from "./textRotate.js";
import { clampedProgress, transition } from "./helpers.js";
import { makeTextBlock } from "./textBlock.js";
import { easeOutExpo } from "./easings.js";
import { makeScoreDisplay } from "./scoreDisplay.js";
import { makeSpring } from "./spring.js";

export const makeLevelManager = (
  canvasManager,
  onInterstitial,
  onAdvance,
  previewData
) => {
  const CTX = canvasManager.getContext();
  const countdownDuration = 2400;
  const circleRadius = 112;
  // Pause before showing the interstitial so the player can watch the final
  // bubble pop. The timer is owned by the level manager so that it can be
  // cancelled whenever the level lifecycle is torn down (game over, restart,
  // preview switch) or when the interstitial is shown through another path.
  const interstitialDelay = 600;
  // A level transition moves through these phases. Advancing is only allowed
  // from "interstitial", and the phase changes synchronously, so repeated
  // pointer/keyboard input or a stale queued timer can never advance twice.
  const PHASE = {
    playing: "playing",
    settling: "settling",
    interstitial: "interstitial",
    advancing: "advancing",
    gameover: "gameover",
  };
  let scoreStore;
  let level;
  let previousLevelValue;
  let levelChangeStart;
  let hasCompletedInitialAdvance;
  let interstitialShowing;
  let interstitialStart;
  let gameOver;
  let hasShownPreviewInitialMessage;
  let levelStarted;
  let missedFirstBubble;
  let phase;
  let pendingInterstitialTimeout;

  const levelCountdownText = makeTextBlock(
    canvasManager,
    {
      xPos: () => canvasManager.getWidth() / 2,
      yPos: () => canvasManager.getHeight() / 2 - circleRadius + 3,
      textAlign: "center",
      verticalAlign: "center",
      fontSize: 32,
      lineHeight: 42,
    },
    [""]
  );

  const overallParLabel = makeTextBlock(
    canvasManager,
    {
      xPos: () => canvasManager.getWidth() / 2,
      yPos: () => canvasManager.getHeight() / 2 + circleRadius - 27,
      textAlign: "center",
      verticalAlign: "center",
      fontWeight: FONT_WEIGHT_BOLD,
      fontSize: 14,
      lineHeight: 22,
      fill: yellow,
      letterSpacing: "1px",
    },
    [""]
  );

  const overallParText = makeTextBlock(
    canvasManager,
    {
      xPos: () => canvasManager.getWidth() / 2,
      yPos: () => canvasManager.getHeight() / 2 + circleRadius,
      textAlign: "center",
      verticalAlign: "center",
      fontSize: 24,
      lineHeight: 32,
    },
    [""]
  );

  const levelNumberSpringPosition = makeSpring(24, {
    stiffness: 150,
    damping: 15,
    mass: 1,
    precision: 120,
  });

  const clearPendingInterstitial = () => {
    if (pendingInterstitialTimeout) {
      clearTimeout(pendingInterstitialTimeout);
      pendingInterstitialTimeout = false;
    }
  };

  const reset = () => {
    clearPendingInterstitial();
    level = previewData ? previewData.name : 1;
    previousLevelValue = false;
    hasCompletedInitialAdvance = false;
    interstitialShowing = false;
    interstitialStart = false;
    gameOver = false;
    hasShownPreviewInitialMessage = false;
    missedFirstBubble = false;
    levelStarted = false;
    phase = PHASE.playing;
  };
  reset();

  const getLevelData = () =>
    previewData ? previewData : getLevelDataByNumber(level);

  const isLastLevel = () => level >= levelData.length;

  const showLevelInterstitial = () => {
    // Showing is idempotent: a duplicate request (e.g. the queued pop timer
    // firing alongside an explicit miss) must not restart the screen or fire
    // the interstitial callback twice.
    if (interstitialShowing) return;
    clearPendingInterstitial();
    phase = PHASE.interstitial;
    interstitialShowing = true;
    interstitialStart = Date.now();
    onInterstitial(interstitialStart);
  };

  // Called when the final bubble of a level is popped. Schedules a single
  // interstitial after a short pause. Repeated calls while the level is
  // settling (or is already showing the interstitial) are ignored, so a
  // duplicate pop notification cannot queue a second timer.
  const scheduleLevelInterstitial = () => {
    if (phase !== PHASE.playing) return;

    phase = PHASE.settling;
    clearPendingInterstitial();
    pendingInterstitialTimeout = setTimeout(() => {
      pendingInterstitialTimeout = false;
      if (phase !== PHASE.settling) return;
      phase = PHASE.interstitial;
      showLevelInterstitial();
    }, interstitialDelay);
  };

  // Cancel the queued interstitial without tearing down the level. Used when
  // the game ends or the level lifecycle restarts before the timer fires.
  const cancelPendingInterstitial = () => {
    clearPendingInterstitial();
    if (phase === PHASE.settling) phase = PHASE.playing;
  };

  const levelCountingDown = () =>
    !!levelStarted && Date.now() - levelStarted < countdownDuration;

  const advanceLevelAndStart = () => {
    if (previewData) {
      hasShownPreviewInitialMessage = true;
      level = previewData.name;
    }

    // On the initial interstitial we want to show the "next" level, aka
    // "Level 1". However on subsequent interstitials we want to show the
    // completed level aka the previous level, and only transition the level
    // indicator once the player has advanced by hitting "Continue"
    else if (hasCompletedInitialAdvance) {
      previousLevelValue = level;
      level++;
      levelChangeStart = Date.now();
    } else {
      hasCompletedInitialAdvance = true;
    }

    levelCountdownText.updateLines([`Par of ${getLevelData().par}`]);

    overallParLabel.updateLines(["TOTAL"]);
    const score = scoreStore.overallScoreNumber(false);
    overallParText.updateLines([
      `${score > 0 || score < 0 ? `${Math.abs(score)} ` : ""}${
        score > 0 ? "over" : score < 0 ? "under" : "Even with"
      } par so far`,
    ]);

    levelStarted = Date.now();
    levelNumberSpringPosition.resetValue(
      canvasManager.getHeight() / 2 - circleRadius - 13
    );

    onAdvance();

    // The new level is live as soon as its bubbles exist, even though its
    // countdown overlay is still animating. Popping during the countdown is
    // still impossible because the bubbles aren't drawn until it ends.
    if (phase === PHASE.advancing) phase = PHASE.playing;
  };

  const dismissInterstitialAndAdvanceLevel = () => {
    // Only a shown interstitial may advance the level. This guard makes
    // repeat clicks, space/enter presses, and stale timers no-ops.
    if (phase !== PHASE.interstitial) return false;

    // Consume the interstitial before invoking the advance callback so a
    // synchronous re-entry can't advance a second time.
    phase = PHASE.advancing;
    interstitialShowing = false;
    interstitialStart = false;
    clearPendingInterstitial();
    advanceLevelAndStart();
    return true;
  };

  const onGameOver = () => {
    clearPendingInterstitial();
    phase = PHASE.gameover;
    interstitialShowing = true;
    interstitialStart = Date.now();
    gameOver = true;
    onInterstitial(interstitialStart);
  };

  const drawInterstitialMessage = ({
    previewInitialMessage,
    reachedEndOfGameMessage,
    endGameMessage,
    initialMessage,
    retryFirstLevelMessage,
    defaultMessage,
  }) => {
    if (interstitialShowing) {
      const msElapsed = Date.now() - interstitialStart;

      if (previewData && !hasShownPreviewInitialMessage) {
        previewInitialMessage(msElapsed);
      } else if (gameOver) {
        endGameMessage(msElapsed);
      } else if (isLastLevel()) {
        reachedEndOfGameMessage(msElapsed);
      } else if (level === 1 && !hasCompletedInitialAdvance && !previewData) {
        initialMessage(msElapsed);
      } else if (missedFirstBubble && !previewData) {
        retryFirstLevelMessage(msElapsed);
      } else {
        defaultMessage(msElapsed);
      }
    }
  };

  const drawLevelNumber = () => {
    CTX.save();
    CTX.font = `${FONT_WEIGHT_BOLD} 14px ${FONT}`;
    CTX.fillStyle = yellow;
    CTX.letterSpacing = "1px";
    CTX.textAlign = "center";
    CTX.translate(
      canvasManager.getWidth() / 2,
      levelNumberSpringPosition.getCurrentValue()
    );

    if (!previewData && previousLevelValue) {
      drawTextRotate(
        canvasManager,
        levelChangeStart,
        `LEVEL ${previousLevelValue}`,
        `LEVEL ${level}`
      );
    } else {
      CTX.fillText(previewData ? "PREVIEW" : `LEVEL ${level}`, 0, 0);
    }

    CTX.restore();
  };

  const drawLevelCountdown = (deltaTime) => {
    const timeRemaining = countdownDuration - (Date.now() - levelStarted);
    levelNumberSpringPosition.update(deltaTime);

    if (timeRemaining < 0) {
      levelCountdownText.hide();
      overallParLabel.hide();
      overallParText.hide();
      levelNumberSpringPosition.setEndValue(24);
    }

    levelCountdownText.draw(deltaTime);

    if (level > 1) {
      overallParLabel.draw(deltaTime, 120);
      overallParText.draw(deltaTime, 150);
    }

    if (timeRemaining > 0) {
      CTX.save();
      CTX.translate(
        canvasManager.getWidth() / 2,
        canvasManager.getHeight() / 2 - circleRadius
      );
      CTX.lineWidth = timeRemaining / 400;
      CTX.strokeStyle = white;
      CTX.rotate(-Math.PI / 2);
      CTX.beginPath();
      CTX.arc(
        0,
        0,
        circleRadius,
        0,
        transition(
          0,
          2 * Math.PI,
          clampedProgress(countdownDuration, 0, timeRemaining)
        ),
        true
      );
      CTX.stroke();
      CTX.restore();
    }
  };

  return {
    reset,
    setScoreStore: (s) => (scoreStore = s),
    getLevel: () => level,
    getLevelData,
    drawInterstitialMessage,
    isInterstitialShowing: () => interstitialShowing,
    drawLevelNumber,
    levelCountingDown,
    drawLevelCountdown,
    showLevelInterstitial,
    scheduleLevelInterstitial,
    cancelPendingInterstitial,
    dismissInterstitialAndAdvanceLevel,
    isSettling: () => phase === PHASE.settling,
    setMissedFirstBubble: () => (missedFirstBubble = true),
    missedFirstBubble: () => missedFirstBubble,
    isLastLevel,
    onGameOver,
    isGameOver: () => gameOver,
  };
};
