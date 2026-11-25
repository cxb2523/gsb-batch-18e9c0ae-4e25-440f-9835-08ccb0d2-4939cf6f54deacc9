# audio_x

![NPM Version](https://img.shields.io/npm/v/audio_x) ![NPM Downloads](https://img.shields.io/npm/dm/audio_x)

A powerful, lightweight (8kb gzip) audio player for modern web applications with zero dependencies.

## Why audio_x?

- 🎯 **Universal Format Support** - Play MP3, AAC, MP4, HLS (m3u8), and [more](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Audio_codecs)
- 🎨 **UI Freedom** - No built-in UI, giving you complete control over the player's appearance
- 📱 **Mobile-Ready** - MediaSession support for notifications and lock-screen controls
- 🎵 **Advanced Audio Features** - Built-in equalizer and queue management
- 📊 **Analytics Ready** - Track actual playtime with built-in playlog
- 🔒 **Type-Safe** - Full TypeScript support out of the box
- ⚛️ **React Compatible** - Works seamlessly with React, no additional packages needed

## Quick Start

```js
npm install audio_x
```

```js
import { AudioX } from "audio_x";

// Create and initialize player
const audio = new AudioX();
audio.init({
  autoPlay: false,
  useDefaultEventListeners: true,
  showNotificationActions: true
});

// Play your first track
audio.addMedia({
  source: "https://example.com/stream.mp3",
  title: "My Awesome Song",
  artist: "Amazing Artist"
});
audio.play();
```

## Supported Formats

| Format      | Support |
| ----------- | ------- |
| .mp3        | [✓]     |
| .aac        | [✓]     |
| .mp4        | [✓]     |
| .m3u8 (hls) | [✓]     |

## Feature Roadmap

✅ **Released**

- Equalizer
- Queue support
- Enhanced developer experience APIs

🚧 **Coming Soon**

- Casting support
- DASH media playback
- DRM
- Ads support

## Comprehensive Guide

### Full Configuration

```js
import { AUDIO_STATE, AudioState, AudioX, MediaTrack } from "audio_x";

const audio = new AudioX();

audio.init({
  autoPlay: false,                // Enable/disable autoplay
  useDefaultEventListeners: true, // Use built-in event handlers
  showNotificationActions: true,  // Enable mobile notifications
  preloadStrategy: "auto",       // Control preloading behavior
  playbackRate: 1,               // Set playback speed
  enablePlayLog: true,           // Track actual playtime
  enableHls: true,               // Enable HLS support
  hlsConfig: { backBufferLength: 2000 } // HLS configuration
});
```

### Creating a Track

```js
const track: MediaTrack = {
  id: 1,
  artwork: [
    {
      src: "https://example.com/image.png",
      name: "image-name",
      sizes: "512x512",
    },
  ],
  source: "https://example.com/stream.mp3",
  title: "My Awesome Song",
  album: "Awesome Album",
  artist: "Amazing Artist",
  comment: "",
  duration: 309,
  genre: "Pop",
  year: 2023,
};

audio.addMedia(track);
```

### Playback Control

```js
// Basic controls
audio.play();
audio.pause();
audio.seek(30);      // Seek to 30 seconds
audio.seekBy(5);     // Seek forward 5 seconds

// Queue management
audio.playNext();
audio.playPrevious();
audio.toggleShuffle();
audio.loop("SINGLE"); // Options: "SINGLE" | "QUEUE" | "OFF"
```

### Player State Management

```js
audio.subscribe("AUDIO_X_STATE", (audioState: AudioState) => {
  console.log(audioState);
});

// Sample state object
{
  "playbackState": "paused",
  "duration": null,
  "bufferedDuration": 0,
  "progress": 35.003483,
  "volume": 50,
  "playbackRate": 1,
  "error": {
    "code": null,
    "message": "",
    "readable": ""
  },
  "currentTrack": {
    // Track details here
  },
  "currentTrackPlayTime": 35.003483,
  "previousTrackPlayTime": 35.003483
}
```

### Custom Event Handling

#### Method 1: Event Map

```js
const eventListenerMap: EventListenerCallbackMap = {
  CAN_PLAY_THROUGH: (e, audioInstance, isPlayLogEnabled) => {
    console.log(e, audioInstance, isPlayLogEnabled);
  },
  PLAY: (e, audioInstance, isPlayLogEnabled) => {
    console.log(e, audioInstance, isPlayLogEnabled);
  },
};

audio.init({
  useDefaultEventListeners: false,
  customEventListeners: eventListenerMap,
  // ... other options
});
```

> **NOTE:** Custom event listeners take priority over default ones. When using custom listeners, you'll need to handle all events manually.

#### Method 2: Direct Event Listeners

```js
audio.addEventListener("pause", (data: any) => {
  console.log(data);
});
```

### Equalizer Features

```js
// Get preset equalizer settings
const presets = audio.getPresets();

// Apply a preset
audio.setPreset('preset_default');

// Custom equalizer settings
const gainsValue = preset[0].gains;   // Default: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
gainsValue[0] = 2.5;                  // Modify first band
audio.setCustomEQ(gainsValue);
```

### Queue Management

```js
// Add multiple tracks
const tracks = [track1, track2, track3];
audio.addQueue(tracks, "DEFAULT");  // Playback types: "DEFAULT" | "REVERSE" | "SHUFFLE"

// Dynamic source loading
audio.addMediaAndPlay(null, async (currentTrack: MediaTrack) => {
  const res = await fetch('url');
  currentTrack.source = res.data.url;
});

// Queue operations
audio.addToQueue(track);           // Add single track
audio.addToQueue([track1, track2]); // Add multiple tracks
audio.clearQueue();                // Clear queue
audio.isShuffledEnabled();         // Check shuffle status
audio.getLoopMode();               // Get current loop mode
```

### Advanced Access

```js
const instance = AudioX.getAudioInstance();  // Get raw audio element
```

## Testing

The test suite runs on [Vitest](https://vitest.dev/) with a [jsdom](https://github.com/jsdom/jsdom)
environment. jsdom has no Web Audio implementation, so `test/setup/` provides
instrumented fakes for `AudioContext`, its nodes and the HLS client.

```bash
npm test          # single run
npm run test:watch
npm run typecheck # type-check source and tests
```

The lifecycle suite (`test/audiox.lifecycle.test.ts`) covers the three
critical paths:

1. **Repeated `play()` / track changes / pause-resume** — the equalizer graph is
   built exactly once and `setPreset` / `setCustomEQ` / `setBassBoost` stay
   usable. With `enableEQ` off those methods only log an error and never throw.
2. **HLS ⇄ regular source switching** — hls.js is attached for `.m3u8`, detached
   when returning to a regular source, and the equalizer keeps working on the
   shared audio element throughout.
3. **`destroy()` then re-`init()`** — the `AudioContext` is closed, every node is
   disconnected, the singletons and `eqStatus` reset, and a fresh graph is built
   against a new audio element on the next `play()`.

### How "nodes wire only once" is verified

A media element can be passed to `createMediaElementSource()` only once in its
lifetime; a second call throws `InvalidStateError` and kills the equalizer. The
mock in `test/setup/webAudioMock.ts` reproduces that invariant and records
every call:

- `MockAudioContext.createdContexts` — how many contexts were created.
- `context.createMediaElementSource` (spy) — wiring calls on one context; the
  suite asserts `toHaveBeenCalledTimes(1)` after many `play()`/track changes.
- `MockAudioContext.totalMediaElementSourceCalls` /
  `globallyRoutedElements` — browser-wide counters proving each element enters a
  graph exactly once, including across a `destroy()` → rebuild cycle.
- `context.connectedNodes` — the full connect list, asserting the chain
  `mediaElementSource → biquad filters → bass boost → compressor → destination`.

Because the mock throws on a second routing of the same element, any regression
that re-runs `createMediaElementSource` fails the test the same way it would fail
in a real browser.

## Contributing

Found a bug? Want to add a feature? Contributions are welcome! Please raise an issue or submit a PR.

## Author

Ashish Kumar - [afkcodes](https://afk.codes)