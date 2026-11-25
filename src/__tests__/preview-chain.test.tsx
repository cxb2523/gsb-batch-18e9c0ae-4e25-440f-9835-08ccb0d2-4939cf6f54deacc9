import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Props, VideoSeekSlider } from '..';
import { PreviewThumbnail } from '../utils/parseThumbnailsVtt';

const TRACK_WIDTH = 100;

const getWrapper = (overrides: Partial<Props> = {}): any => (
  <VideoSeekSlider
    max={100000}
    currentTime={500}
    onChange={() => undefined}
    {...overrides}
  />
);

/** One cue covering 0..100000ms whose sprite is `sprite`. */
const vttWith = (sprite: string): string =>
  `WEBVTT\n\n00:00:00.000 --> 00:01:40.000\n${sprite}#xywh=0,0,160,90\n`;

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

const getTrack = (): HTMLElement => screen.getByTestId('main-track');

/** Background image actually shown, following the nested sprite element. */
const shownBackground = (): string => {
  const preview = screen.getByTestId('preview-screen');
  const sprite = preview.firstElementChild as HTMLElement | null;

  return sprite?.classList.contains('preview-sprite')
    ? sprite.style.backgroundImage
    : preview.style.backgroundImage;
};

const thumbSetA: PreviewThumbnail[] = [
  { fromMs: 0, toMs: 100000, url: 'a-sprite.jpg' },
];

describe('preview thumbnail source switching', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(
      TRACK_WIDTH
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: TRACK_WIDTH,
    } as DOMRect);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('A1: shows only the B frames after switching A -> B, even when A resolves last', async () => {
    const requestA = deferred<Response>();
    const requestB = deferred<Response>();
    const signals: AbortSignal[] = [];
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input, init) => {
        signals.push(init?.signal as AbortSignal);
        return String(input).includes('a.vtt')
          ? requestA.promise
          : requestB.promise;
      });

    const { rerender } = render(
      getWrapper({ previewThumbnails: '/media/a.vtt' })
    );
    fireEvent.pointerMove(getTrack(), { clientX: 30 });

    rerender(getWrapper({ previewThumbnails: '/media/b.vtt' }));
    fireEvent.pointerMove(getTrack(), { clientX: 30 });

    // Switching sources cancels the previous request.
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);

    await act(async () => {
      requestB.resolve(new Response(vttWith('b-sheet.jpg')));
    });
    await waitFor(() => expect(shownBackground()).toContain('b-sheet.jpg'));

    // The cancelled/stale A response arrives late (mock ignores the signal).
    await act(async () => {
      requestA.resolve(new Response(vttWith('a-sheet.jpg')));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(screen.getAllByTestId('preview-screen')).toHaveLength(1);
    expect(shownBackground()).toContain('b-sheet.jpg');
    expect(shownBackground()).not.toContain('a-sheet.jpg');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('A2: aborts the in-flight request on unmount without state-update warnings', async () => {
    const request = deferred<Response>();
    let signal: AbortSignal | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      signal = init?.signal ?? undefined;
      return request.promise;
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = render(
      getWrapper({ previewThumbnails: '/media/unmount.vtt' })
    );

    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);

    // A late resolution after unmount must not write React state.
    await act(async () => {
      request.resolve(new Response(vttWith('late.jpg')));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    const stateWarnings = errorSpy.mock.calls
      .flat()
      .map(String)
      .filter((message) =>
        /not wrapped in act|state update on an unmounted/i.test(message)
      );

    expect(stateWarnings).toEqual([]);
    errorSpy.mockRestore();
  });

  it('does not request again when rerendered with the same source', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(vttWith('same-sheet.jpg')));

    const { rerender } = render(
      getWrapper({ previewThumbnails: '/media/same.vtt', currentTime: 1 })
    );
    fireEvent.pointerMove(getTrack(), { clientX: 30 });
    await screen.findByTestId('preview-screen');

    rerender(
      getWrapper({ previewThumbnails: '/media/same.vtt', currentTime: 2 })
    );
    rerender(getWrapper({ previewThumbnails: '/media/same.vtt' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('A3: switching A -> B -> A displays the A frames again', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input) =>
        Promise.resolve(
          new Response(
            vttWith(
              String(input).includes('a.vtt') ? 'a-sheet.jpg' : 'b-sheet.jpg'
            )
          )
        )
      );

    const { rerender } = render(
      getWrapper({ previewThumbnails: '/media/a.vtt' })
    );
    fireEvent.pointerMove(getTrack(), { clientX: 30 });
    await waitFor(() => expect(shownBackground()).toContain('a-sheet.jpg'));

    rerender(getWrapper({ previewThumbnails: '/media/b.vtt' }));
    fireEvent.pointerMove(getTrack(), { clientX: 30 });
    await waitFor(() => expect(shownBackground()).toContain('b-sheet.jpg'));

    rerender(getWrapper({ previewThumbnails: '/media/a.vtt' }));
    fireEvent.pointerMove(getTrack(), { clientX: 30 });
    await waitFor(() => expect(shownBackground()).toContain('a-sheet.jpg'));

    // A was already loaded in this instance: no duplicate request for it.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the loaded VTT source correct through VTT -> parsed array -> VTT', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(vttWith('roundtrip.jpg')));
    const parsed: PreviewThumbnail[] = [
      { fromMs: 0, toMs: 100000, url: 'parsed-array.jpg' },
    ];

    const { rerender } = render(
      getWrapper({ previewThumbnails: '/media/roundtrip.vtt' })
    );
    fireEvent.pointerMove(getTrack(), { clientX: 30 });
    await waitFor(() => expect(shownBackground()).toContain('roundtrip.jpg'));

    // Switch to a parsed array: it is rendered directly, no fetch involved.
    rerender(getWrapper({ previewThumbnails: parsed }));
    expect(shownBackground()).toContain('parsed-array.jpg');

    // Switch back to the already loaded VTT source.
    rerender(getWrapper({ previewThumbnails: '/media/roundtrip.vtt' }));
    expect(shownBackground()).toContain('roundtrip.jpg');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('A5: falls back to getPreviewScreenUrl while a new source is loading', async () => {
    const requestB = deferred<Response>();
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) =>
      String(input).includes('a.vtt')
        ? Promise.resolve(new Response(vttWith('a-sheet.jpg')))
        : requestB.promise
    );

    const getPreviewScreenUrl = vi.fn(() => 'fallback.jpg');
    const { rerender } = render(
      getWrapper({
        previewThumbnails: '/media/a.vtt',
        getPreviewScreenUrl,
      })
    );
    fireEvent.pointerMove(getTrack(), { clientX: 30 });
    await waitFor(() => expect(shownBackground()).toContain('a-sheet.jpg'));

    rerender(
      getWrapper({
        previewThumbnails: '/media/b.vtt',
        getPreviewScreenUrl,
      })
    );
    fireEvent.pointerMove(getTrack(), { clientX: 30 });

    // No stale A frame: the fallback takes over until B arrives.
    await waitFor(() =>
      expect(screen.getByTestId('preview-screen').style.backgroundImage).toBe(
        'url("fallback.jpg")'
      )
    );
    expect(shownBackground()).toBe('url("fallback.jpg")');

    await act(async () => {
      requestB.resolve(new Response(vttWith('b-sheet.jpg')));
    });
    await waitFor(() => expect(shownBackground()).toContain('b-sheet.jpg'));
  });

  it('keeps the existing thumbnail priority over getPreviewScreenUrl', () => {
    render(
      getWrapper({
        max: 200000,
        previewThumbnails: thumbSetA,
        getPreviewScreenUrl: () => 'fallback.jpg',
      })
    );

    // clientX 80 -> 160000ms, outside the single 0..100000 cue.
    fireEvent.pointerMove(getTrack(), { clientX: 80 });

    expect(screen.getByTestId('preview-screen').style.backgroundImage).toBe(
      'url("fallback.jpg")'
    );
  });
});

describe('preview sprite preloading', () => {
  let warmedUrls: string[];

  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(
      TRACK_WIDTH
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: TRACK_WIDTH,
    } as DOMRect);

    warmedUrls = [];

    class FakeImage {
      private source = '';

      set src(value: string) {
        this.source = value;
        warmedUrls.push(value);
      }

      get src(): string {
        return this.source;
      }
    }

    vi.stubGlobal('Image', FakeImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('A4: warms new sprite URLs when the collection changes and never duplicates URLs', () => {
    const first: PreviewThumbnail[] = [
      { fromMs: 0, toMs: 100000, url: 'one.jpg' },
    ];
    const second: PreviewThumbnail[] = [
      { fromMs: 0, toMs: 50000, url: 'two.jpg', width: 160, height: 90 },
      { fromMs: 50000, toMs: 100000, url: 'three.jpg', width: 160, height: 90 },
    ];

    const { rerender } = render(getWrapper({ previewThumbnails: first }));

    // Preloading stays hover-gated.
    expect(warmedUrls).toEqual([]);

    fireEvent.pointerMove(getTrack(), { clientX: 30 });
    expect(warmedUrls).toEqual(['one.jpg']);

    // Collection changes while the preview is active.
    rerender(getWrapper({ previewThumbnails: second }));
    expect(warmedUrls).toEqual(['one.jpg', 'two.jpg', 'three.jpg']);

    // Same content, brand new array/object identities: no fresh Images.
    rerender(
      getWrapper({ previewThumbnails: second.map((item) => ({ ...item })) })
    );
    expect(warmedUrls).toEqual(['one.jpg', 'two.jpg', 'three.jpg']);

    // Hover out and back in: still no duplicates.
    fireEvent.pointerLeave(getTrack());
    fireEvent.pointerMove(getTrack(), { clientX: 30 });
    expect(warmedUrls).toEqual(['one.jpg', 'two.jpg', 'three.jpg']);
  });

  it('rewarms when the same array instance is mutated in place with new URLs', () => {
    const collection: PreviewThumbnail[] = [
      { fromMs: 0, toMs: 50000, url: 'a.jpg' },
    ];

    const { rerender } = render(getWrapper({ previewThumbnails: collection }));
    fireEvent.pointerMove(getTrack(), { clientX: 30 });
    expect(warmedUrls).toEqual(['a.jpg']);

    collection.push({ fromMs: 50000, toMs: 100000, url: 'b.jpg' });
    rerender(getWrapper({ previewThumbnails: collection }));

    // The changed collection is warmed as a whole, including the new URL.
    expect(warmedUrls).toContain('b.jpg');
    expect(warmedUrls.filter((url) => url === 'b.jpg')).toHaveLength(1);
  });
});
