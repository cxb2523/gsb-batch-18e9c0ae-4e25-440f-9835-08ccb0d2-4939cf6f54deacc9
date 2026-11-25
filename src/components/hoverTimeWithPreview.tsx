import { useEffect, useRef } from 'react';
import { getHoverTimePosition } from '../utils/getHoverTimePosition';
import { timeToTimeString } from '../utils/timeToTimeString';
import { findThumbnail } from '../utils/findThumbnail';
import { PreviewThumbnail } from '../utils/parseThumbnailsVtt';
import { PreviewImage } from './previewImage';

interface Props {
  max: number;
  hoverTimeValue: number;
  trackWidth: number;
  seekHoverPosition: number;
  offset: number;
  isThumbActive: boolean;
  limitTimeTooltipBySides: boolean;
  label: string;
  secondsPrefix?: string;
  minutesPrefix?: string;
  getPreviewScreenUrl?: (hoverTimeValue: number) => string;
  previewThumbnails?: PreviewThumbnail[];
}

export const HoverTimeWithPreview: React.FC<Props> = ({
  max,
  hoverTimeValue,
  offset,
  trackWidth,
  seekHoverPosition,
  isThumbActive,
  limitTimeTooltipBySides,
  label,
  minutesPrefix,
  secondsPrefix,
  getPreviewScreenUrl,
  previewThumbnails,
}) => {
  const hoverTimeElement = useRef<HTMLDivElement>(null);
  /** Content keys of sprite collections that have already been warmed up. */
  const preloadedKeys = useRef<Set<string>>(new Set());
  const hoverTimeClassName = isThumbActive ? 'hover-time active' : 'hover-time';

  /**
   * Content signature of the distinct sprite URLs in the current collection.
   * Computed on every render (rather than memoized on the array reference) so
   * an in-place collection change is observed as well.
   */
  const preloadKey = previewThumbnails
    ? JSON.stringify([...new Set(previewThumbnails.map(({ url }) => url))])
    : undefined;

  /**
   * Warm up every sprite sheet once the preview is first needed, and warm up
   * collections whose URL content has changed. A given content key is only
   * warmed once, so rerenders with the same collection (including new array
   * identities) and hover toggles never create duplicate Images.
   */
  useEffect(() => {
    if (
      !isThumbActive ||
      !previewThumbnails ||
      preloadKey === undefined ||
      preloadedKeys.current.has(preloadKey)
    ) {
      return;
    }

    preloadedKeys.current.add(preloadKey);

    new Set(previewThumbnails.map(({ url }) => url)).forEach((url) => {
      new Image().src = url;
    });
  }, [isThumbActive, preloadKey, previewThumbnails]);

  const hoverTimePosition = getHoverTimePosition(
    seekHoverPosition,
    hoverTimeElement?.current,
    trackWidth,
    limitTimeTooltipBySides
  );

  const hoverTimeString = timeToTimeString(
    max,
    hoverTimeValue,
    offset,
    minutesPrefix,
    secondsPrefix
  );

  const thumbnail =
    previewThumbnails && findThumbnail(previewThumbnails, hoverTimeValue);
  const previewUrl =
    !thumbnail && getPreviewScreenUrl && isThumbActive
      ? getPreviewScreenUrl(hoverTimeValue)
      : undefined;

  return (
    <div
      className={hoverTimeClassName}
      style={hoverTimePosition}
      ref={hoverTimeElement}
      data-testid="hover-time"
    >
      {isThumbActive && thumbnail && <PreviewImage thumbnail={thumbnail} />}
      {previewUrl !== undefined && (
        <PreviewImage thumbnail={{ fromMs: 0, toMs: 0, url: previewUrl }} />
      )}
      {label && <div>{label}</div>}
      {hoverTimeString}
    </div>
  );
};
