const xhrMockClass = () => ({
  open            : jest.fn(),
  send            : jest.fn(),
  setRequestHeader: jest.fn(),
  abort           : jest.fn(),
});
XMLHttpRequest = jest.fn().mockImplementation(xhrMockClass);

const audioMockClass = () => ({
  addEventListener: jest.fn(),
  load: jest.fn(),
  pause: jest.fn(),
  play: jest.fn(() => Promise.resolve(jest.fn())),
});
Audio = jest.fn().mockImplementation(audioMockClass);

const audioContextMockClass = () => ({
  createGain: () => ({
    gain: { value: 1 },
    connect: jest.fn(),
  }),
});

window = {
  clearTimeout     : jest.fn(),
  setTimeout       : jest.fn(),
  AudioContext     : jest.fn().mockImplementation(audioContextMockClass),
};

const { Gapless5, LogLevel } = require('./gapless5.js');

/** test data **/

const TRACKS = [ '0.mp3', '1.mp3', '2.mp3', '3.mp3', '4.mp3' ];
const INIT_OPTIONS = {
  logLevel: LogLevel.None,
  useWebAudio: false,
  useHTML5Audio: false,
};

/** test suite **/

describe('Gapless-5 object', () => {
  let player = null;

  beforeEach(() => {
    player = new Gapless5(INIT_OPTIONS);
  });

  it('has correct initial state', () => {
    expect(player.getTracks()).toStrictEqual([]);
    expect(player.totalTracks()).toBe(0);
    expect(player.getIndex()).toBe(-1);
    expect(player.getPosition()).toBe(0);
    expect(player.canShuffle()).toBe(false);
    expect(player.initialized).toBe(true);
    expect(player.hasGUI).toBe(false);
  });

  it('can manipulate tracklist and position', () => {
    player.addTrack(TRACKS[1]);
    expect(player.getIndex()).toBe(0);
    player.insertTrack(0, TRACKS[0]);
    expect(player.getTracks()).toStrictEqual([ TRACKS[0], TRACKS[1] ]);
    expect(player.findTrack(TRACKS[1])).toBe(1);
    player.setPlaybackRate(0.1);
    player.setPosition(10);
    expect(player.getPosition()).toBe(10);

    player.removeTrack(0);
    expect(player.getTracks()).toStrictEqual([ TRACKS[1] ]);
    player.removeAllTracks();
    expect(player.getTracks()).toStrictEqual([]);
    player.setPosition(10);
    expect(player.getPosition()).toBe(0); // setPosition should do nothing without a track
  });
});

describe('Gapless-5 object with tracklist', () => {
  let player = null;

  beforeEach(() => {
    player = new Gapless5({
      ...INIT_OPTIONS,
      tracks: TRACKS,
    });
  });

  it('has correct initial state', () => {
    expect(player.getTracks()).toStrictEqual(TRACKS);
    expect(player.getIndex()).toBe(0);
    expect(player.getPosition()).toBe(0);
    expect(player.initialized).toBe(true);
    expect(player.hasGUI).toBe(false);
  });

  it('can shuffle and un-shuffle tracklist', () => {
    expect(player.canShuffle()).toBe(true);
    expect(player.isShuffled()).toBe(false);
    player.shuffle();
    expect(player.isShuffled()).toBe(true);

    // shouldn't actually shuffle until we change tracks
    expect(player.getTracks()).toStrictEqual(TRACKS);
    player.next();
    expect(player.getTracks()).not.toStrictEqual(TRACKS);
    expect(player.totalTracks()).toBe(TRACKS.length);

    // shouldn't actually unshuffle until we change tracks
    player.toggleShuffle();
    expect(player.isShuffled()).toBe(false);
    expect(player.getTracks()).not.toStrictEqual(TRACKS);
    player.next();
    expect(player.getTracks()).toStrictEqual(TRACKS);
  });

  it('can navigate the tracklist', () => {
    expect(player.getIndex()).toBe(0);
    player.next();
    expect(player.getIndex()).toBe(1);
    player.prev();
    expect(player.getIndex()).toBe(0);
    player.gotoTrack(2);
    expect(player.getIndex()).toBe(2);

    // should loop around
    player.loop = true;
    TRACKS.forEach(() => player.next());
    expect(player.getIndex()).toBe(2);

    // should not loop around
    player.loop = false;
    TRACKS.forEach(() => player.next());
    expect(player.getIndex()).toBe(TRACKS.length - 1);
  });

  it('triggers navigation callbacks', () => {
    player.onprev = jest.fn();
    player.onnext = jest.fn();
    player.onplayrequest = jest.fn();
    player.onpause = jest.fn();
    player.onstop = jest.fn();

    player.next();
    expect(player.onnext).toHaveBeenCalledWith(TRACKS[0], TRACKS[1]);
    player.prev();
    expect(player.onprev).toHaveBeenCalledWith(TRACKS[1], TRACKS[0]);
    player.play();
    expect(player.onplayrequest).toHaveBeenCalledWith(TRACKS[0]);
    player.pause();
    expect(player.onpause).toHaveBeenCalledWith(TRACKS[0]);
    player.stop();
    expect(player.onstop).toHaveBeenCalledWith(TRACKS[0]);
  });

  it('regression: maintains correct index when removing tracks that come after the currently playing track', () => {
    const testTracks = [ 'track1.mp3', 'track2.mp3', 'track3.mp3' ];
    const testPlayer = new Gapless5({
      ...INIT_OPTIONS,
      tracks: testTracks,
    });

    // Verify initial state
    expect(testPlayer.getIndex()).toBe(0);
    expect(testPlayer.getTracks()).toStrictEqual(testTracks);

    // Move to track 1
    testPlayer.gotoTrack(1);
    expect(testPlayer.getIndex()).toBe(1);

    // Remove track at index 2
    testPlayer.removeTrack(2);

    // Check index is still 1 and track list is updated
    expect(testPlayer.getIndex()).toBe(1);
    expect(testPlayer.getTracks()).toStrictEqual([ 'track1.mp3', 'track2.mp3' ]);
  });

  it('regression: maintains correct index when removing the currently playing track', () => {
    const testTracks = [ 'track1.mp3', 'track2.mp3', 'track3.mp3' ];
    const testPlayer = new Gapless5({
      ...INIT_OPTIONS,
      tracks: testTracks,
    });

    // Verify initial state
    expect(testPlayer.getIndex()).toBe(0);
    expect(testPlayer.getTracks()).toStrictEqual(testTracks);

    // Move to track 1
    testPlayer.gotoTrack(1);
    expect(testPlayer.getIndex()).toBe(1);
    testPlayer.play();

    // Remove the currently playing track
    testPlayer.removeTrack(1);

    // Check index is still 1 and track list is updated, therefore we move to the next available track
    expect(testPlayer.getIndex()).toBe(1);
    expect(testPlayer.getTracks()).toStrictEqual([ 'track1.mp3', 'track3.mp3' ]);

    testPlayer.play();

    // Remove the currently playing track
    testPlayer.removeTrack(1);

    // Check index is still 0 and track list is updated, therefore we move to the next available track
    expect(testPlayer.getIndex()).toBe(0);
    expect(testPlayer.getTracks()).toStrictEqual([ 'track1.mp3' ]);

    testPlayer.play();

    // Remove the only remaining track — list is empty, index resets to -1
    testPlayer.removeTrack(0);
    expect(testPlayer.getIndex()).toBe(-1);
    expect(testPlayer.getTracks()).toStrictEqual([]);
  });

  it('regression: removing a track does not wipe shuffledIndices', () => {
    const testTracks = [ 'track1.mp3', 'track2.mp3', 'track3.mp3', 'track4.mp3' ];
    const testPlayer = new Gapless5({
      ...INIT_OPTIONS,
      tracks: testTracks,
    });

    testPlayer.shuffle();
    testPlayer.next(); // commit the shuffle
    expect(testPlayer.isShuffled()).toBe(true);
    expect(testPlayer.playlist.shuffledIndices.length).toBe(testTracks.length);

    testPlayer.removeTrack(0);

    // Shuffle order should still be intact (one fewer entry, still shuffled)
    expect(testPlayer.isShuffled()).toBe(true);
    expect(testPlayer.playlist.shuffledIndices.length).toBe(testTracks.length - 1);
    expect(testPlayer.getTracks().length).toBe(testTracks.length - 1);
  });

  it('regression: removing currently-playing track repeatedly until empty does not crash', () => {
    const testTracks = [ 'track1.mp3', 'track2.mp3', 'track3.mp3' ];
    const testPlayer = new Gapless5({
      ...INIT_OPTIONS,
      tracks: testTracks,
    });

    // Walk the list down to zero by always removing the current track
    // This reproduces a crash in the pre-PR code where updateLoading()
    // would dereference an undefined source after the list went empty.
    while (testPlayer.getTracks().length > 0) {
      testPlayer.removeTrack(testPlayer.getIndex());
    }
    expect(testPlayer.getTracks()).toStrictEqual([]);
    expect(testPlayer.getIndex()).toBe(-1);
  });

  it('regression: removing current-at-tail with loop=true wraps to start and resumes', () => {
    const testTracks = [ 'track1.mp3', 'track2.mp3', 'track3.mp3' ];
    const testPlayer = new Gapless5({
      ...INIT_OPTIONS,
      tracks: testTracks,
      loop: true,
    });

    testPlayer.gotoTrack(2);
    expect(testPlayer.getIndex()).toBe(2);

    // Force the tail source to report as playing so removeTrack takes the
    // wasPlaying branch (the mock audio env never transitions real state).
    testPlayer.playlist.sources[2].inPlayState = () => true;

    testPlayer.onnext = jest.fn();
    testPlayer.onplayrequest = jest.fn();

    testPlayer.removeTrack(2);

    expect(testPlayer.getIndex()).toBe(0);
    expect(testPlayer.getTracks()).toStrictEqual([ 'track1.mp3', 'track2.mp3' ]);
    expect(testPlayer.onnext).toHaveBeenCalledWith('track3.mp3', 'track1.mp3');
    expect(testPlayer.onplayrequest).toHaveBeenCalledTimes(1);
    expect(testPlayer.onplayrequest).toHaveBeenCalledWith('track1.mp3');
  });

  it('regression: removing current-at-tail with loop=false clamps and always pauses', () => {
    const testTracks = [ 'track1.mp3', 'track2.mp3', 'track3.mp3' ];
    const testPlayer = new Gapless5({
      ...INIT_OPTIONS,
      tracks: testTracks,
      loop: false,
    });

    testPlayer.gotoTrack(2);
    expect(testPlayer.getIndex()).toBe(2);

    // Force the tail source to report as playing so removeTrack takes the
    // wasPlaying branch — this is the scenario where the old code would
    // have auto-resumed on the clamped-to-last track.
    testPlayer.playlist.sources[2].inPlayState = () => true;

    testPlayer.onnext = jest.fn();
    testPlayer.onplayrequest = jest.fn();

    testPlayer.removeTrack(2);

    expect(testPlayer.getIndex()).toBe(1);
    expect(testPlayer.getTracks()).toStrictEqual([ 'track1.mp3', 'track2.mp3' ]);
    expect(testPlayer.onnext).toHaveBeenCalledWith('track3.mp3', 'track2.mp3');
    expect(testPlayer.onplayrequest).not.toHaveBeenCalled();
  });

  it('regression: removing a track does not spuriously disable shuffle when never shuffled', () => {
    const testTracks = [ 'track1.mp3', 'track2.mp3', 'track3.mp3' ];
    const testPlayer = new Gapless5({
      ...INIT_OPTIONS,
      tracks: testTracks,
    });

    expect(testPlayer.isShuffled()).toBe(false);
    const setShuffleSpy = jest.spyOn(testPlayer.playlist, 'setShuffle');

    // Drop to 2 tracks — previously tripped the shuffle-disable path
    // because `this.isShuffled` (a function reference) was always truthy.
    testPlayer.removeTrack(0);

    expect(testPlayer.isShuffled()).toBe(false);
    expect(setShuffleSpy).not.toHaveBeenCalled();
    setShuffleSpy.mockRestore();
  });
});

describe('Gapless-5 object with load limit', () => {
  it('obeys load limit', () => {
    const player = new Gapless5({
      ...INIT_OPTIONS,
      loadLimit: 2,
    });
    const loadedTracks = new Set([]);
    player.onloadstart = (audioPath) => {
      loadedTracks.add(audioPath);
    };
    player.onunload = (audioPath) => {
      loadedTracks.delete(audioPath);
    };

    TRACKS.forEach((track) => player.addTrack(track));
    expect(player.totalTracks()).toBe(TRACKS.length);
    expect(loadedTracks.size).toBe(2);
    player.next();
    expect(loadedTracks.size).toBe(2);
    player.next();
    expect(loadedTracks.size).toBe(2);
    player.removeAllTracks();
    expect(loadedTracks.size).toBe(0);
  });

  // A track's state is the source of truth for "is it loaded", independent of
  // which callbacks fired; use it to assert the actual retained resources.
  const loadedPaths = (player) => player.playlist.sources
    .filter((source) => source.getState() !== 0)
    .map((source) => source.audioPath);

  const makeLimitedPlayer = (options = {}) => new Gapless5({
    ...INIT_OPTIONS,
    ...options,
  });

  it('fills the load window to the limit on the starting track', () => {
    const player = makeLimitedPlayer({ tracks: TRACKS, loadLimit: 3 });
    expect(loadedPaths(player)).toStrictEqual([ '0.mp3', '1.mp3', '2.mp3' ]);

    // Jumping to the tail should pull the window back rather than shrink it.
    player.gotoTrack(TRACKS.length - 1);
    expect(loadedPaths(player)).toStrictEqual([ '2.mp3', '3.mp3', '4.mp3' ]);
  });

  it('keeps the playing track loaded when it moves outside the load window', () => {
    const player = makeLimitedPlayer({ tracks: TRACKS, loadLimit: 1 });
    player.gotoTrack(0);
    const playingSource = player.playlist.sources[0];
    // With both engines disabled, load() leaves the source in Loading; play()
    // then registers queuedState=Play, i.e. "about to play".
    playingSource.play();
    expect(playingSource.isPlayActive(true)).toBe(true);

    // Simulate a shuffle rebase that moves the current slot without stopping
    // playback (gotoTrack would stop everything; a shuffle/removal may not).
    player.playlist.trackNumber = 4;
    player.playlist.updateLoading();

    const loaded = loadedPaths(player);
    expect(loaded).toContain('0.mp3'); // the playing source is retained
    expect(loaded).toContain('4.mp3'); // the new current track is loaded
  });

  it('keeps queued tracks loaded until they are dequeued', () => {
    const player = makeLimitedPlayer({ tracks: TRACKS, loadLimit: 2 });
    expect(loadedPaths(player)).toStrictEqual([ '0.mp3', '1.mp3' ]);

    player.queueTrack(4);
    expect(player.queuedTrack).toBe(4);
    expect(loadedPaths(player)).toContain('4.mp3');

    player.next();
    expect(player.getTrack()).toBe('1.mp3');
    expect(loadedPaths(player)).toContain('4.mp3');

    // Dropping the queue should release the out-of-window track.
    player.queuedTrack = null;
    player.playlist.updateLoading();
    expect(loadedPaths(player)).not.toContain('4.mp3');
  });

  it('keeps fading tracks loaded until they finish fading out', () => {
    const player = makeLimitedPlayer({ tracks: TRACKS, loadLimit: 1 });
    player.gotoTrack(2);
    expect(loadedPaths(player)).toStrictEqual([ '2.mp3' ]);

    player.fadingTrack = 0;
    player.playlist.updateLoading();
    expect(loadedPaths(player)).toContain('0.mp3');

    player.gotoTrack(4);
    expect(loadedPaths(player)).toContain('0.mp3');
    expect(loadedPaths(player)).toContain('4.mp3');

    player.fadingTrack = null;
    player.playlist.updateLoading();
    expect(loadedPaths(player)).toStrictEqual([ '4.mp3' ]);
  });

  it('keeps the current track loaded after shuffle reorders the playlist (regression)', () => {
    const player = makeLimitedPlayer({ tracks: TRACKS, loadLimit: 2, shuffle: true });
    // Force a deterministic shuffled order so the test is reproducible.
    player.playlist.shuffledIndices = [ 4, 0, 1, 2, 3 ];
    player.next(); // commit the shuffle
    expect(player.isShuffled()).toBe(true);

    // Play straight through the shuffled order, checking at each step that the
    // now-playing track is still in the loaded set (old code could unload it
    // while it was playing).
    for (let i = 0; i < TRACKS.length; i++) {
      player.gotoTrack(i);
      const current = player.getTrack();
      const loaded = loadedPaths(player);
      expect(loaded).toContain(current);
      expect(loaded.length).toBeLessThanOrEqual(2);
    }
  });

  it('unloads a loaded track that is removed from the playlist', () => {
    const player = makeLimitedPlayer({ tracks: TRACKS, loadLimit: 3 });
    expect(loadedPaths(player)).toStrictEqual([ '0.mp3', '1.mp3', '2.mp3' ]);

    const onunload = jest.fn();
    player.onunload = onunload;
    player.removeTrack(2);

    expect(onunload).toHaveBeenCalledWith('2.mp3');
    expect(player.getTracks()).toStrictEqual([ '0.mp3', '1.mp3', '3.mp3', '4.mp3' ]);
    expect(loadedPaths(player)).not.toContain('2.mp3');
    expect(loadedPaths(player)).toContain('0.mp3');
  });

  it('reloads the correct current track after removing the current one (regression)', () => {
    const player = makeLimitedPlayer({ tracks: TRACKS, loadLimit: 2 });
    player.gotoTrack(2);
    expect(player.getTrack()).toBe('2.mp3');
    const onunload = jest.fn();
    player.onunload = onunload;

    player.removeTrack(2);

    expect(onunload).toHaveBeenCalledWith('2.mp3');
    expect(player.getIndex()).toBe(2);
    expect(player.getTrack()).toBe('3.mp3');
    expect(loadedPaths(player)).toContain('3.mp3');
  });

  it('does not spuriously unload the current track when removing an earlier track', () => {
    const player = makeLimitedPlayer({ tracks: TRACKS, loadLimit: 2 });
    player.gotoTrack(2);
    const currentSource = player.currentSource();
    expect(currentSource.audioPath).toBe('2.mp3');

    player.removeTrack(0);

    // Current track must still resolve to the same source object / path.
    expect(player.getIndex()).toBe(1);
    expect(player.currentSource()).toBe(currentSource);
    expect(player.getTrack()).toBe('2.mp3');
    expect(loadedPaths(player)).toContain('2.mp3');
  });

  it('does not leave stale load state after replacing a track', () => {
    const player = makeLimitedPlayer({ tracks: [ 'a.mp3', 'b.mp3', 'c.mp3' ], loadLimit: 2 });
    player.gotoTrack(1);
    expect(loadedPaths(player)).toStrictEqual([ 'b.mp3', 'c.mp3' ]);

    player.replaceTrack(1, 'replacement.mp3');

    expect(player.getTracks()).toContain('replacement.mp3');
    expect(player.getTracks()).not.toContain('b.mp3');
    const loaded = loadedPaths(player);
    expect(loaded).not.toContain('b.mp3');
    expect(loaded).toContain('replacement.mp3');
    expect(loaded.length).toBeLessThanOrEqual(2);
  });

  // Regression: when a track falls out of the window while still loading and
  // is later requested again, a fresh load must start (old code kept the stale
  // in-flight state and never re-issued the load).
  it('re-issues load when switching away from a loading track and back', () => {
    const player = makeLimitedPlayer({ tracks: [ 'a.mp3', 'b.mp3', 'c.mp3' ], loadLimit: 1 });
    const onloadstart = jest.fn();
    const onunload = jest.fn();
    player.onloadstart = onloadstart;
    player.onunload = onunload;

    onloadstart.mockClear();
    player.gotoTrack(1);
    expect(loadedPaths(player)).toStrictEqual([ 'b.mp3' ]);
    expect(onunload).toHaveBeenCalledWith('a.mp3');

    onloadstart.mockClear();
    player.gotoTrack(0);
    expect(loadedPaths(player)).toStrictEqual([ 'a.mp3' ]);
    expect(onloadstart).toHaveBeenCalledWith('a.mp3');
    expect(onunload).toHaveBeenCalledWith('b.mp3');
  });
});

describe('Gapless-5 load lifecycle with late async callbacks', () => {
  // Controllable HTML5 Audio mock: lets a test fire load/error events manually
  // and assert which audio objects receive calls.
  const makeControllableAudio = () => {
    const listeners = {};
    const instance = {
      currentTime: 0,
      duration: 10,
      loop: false,
      playbackRate: 1,
      volume: 1,
      src: '',
      seekable: [],
      addEventListener: (event, cb) => {
        listeners[event] = cb;
      },
      load: jest.fn(),
      pause: jest.fn(),
      play: jest.fn(() => Promise.resolve()),
      fire: (event) => listeners[event] && listeners[event](),
    };
    return instance;
  };

  // Controllable WebAudio decode: resolve(es) are recorded so tests can
  // deliver a decoded buffer after the source has already been unloaded.
  const makeControllableContext = () => {
    const decoders = [];
    const context = {
      destination: {},
      baseLatency: 0,
      createGain: () => ({ gain: { value: 1 }, connect: jest.fn(), disconnect: jest.fn() }),
      createBufferSource: () => ({
        buffer: null, playbackRate: { value: 1 }, loop: false,
        connect: jest.fn(), disconnect: jest.fn(), start: jest.fn(), stop: jest.fn(),
      }),
      decodeAudioData: jest.fn(() => new Promise((resolve) => decoders.push(resolve))),
      resume: jest.fn(() => Promise.resolve()),
    };
    return { context: context, decoders: decoders };
  };

  const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

  let savedGlobals = null;

  beforeEach(() => {
    savedGlobals = {
      Audio: global.Audio,
      XMLHttpRequest: global.XMLHttpRequest,
      window: global.window,
      gapless5Players: window.gapless5Players,
    };
  });

  afterEach(() => {
    global.Audio = savedGlobals.Audio;
    global.XMLHttpRequest = savedGlobals.XMLHttpRequest;
    global.window = savedGlobals.window;
    window.gapless5Players = savedGlobals.gapless5Players || {};
  });

  it('ignores an HTML5 canplaythrough event that arrives after the track was unloaded', () => {
    const audios = [];
    global.Audio = jest.fn().mockImplementation(() => {
      const audioInstance = makeControllableAudio();
      audios.push(audioInstance);
      return audioInstance;
    });

    const player = new Gapless5({
      ...INIT_OPTIONS,
      useHTML5Audio: true,
      useWebAudio: false,
      tracks: [ 'a.mp3', 'b.mp3' ],
      loadLimit: 1,
    });
    const onload = jest.fn();
    const onunload = jest.fn();
    player.onload = onload;
    player.onunload = onunload;

    // Only a.mp3 should be loading in the window of size 1.
    expect(player.playlist.sources[0].getState()).not.toBe(0);

    // Move the window so a.mp3 is unloaded while its load is still in flight.
    player.gotoTrack(1);
    expect(onunload).toHaveBeenCalledWith('a.mp3');

    // A late canplaythrough from the abandoned audio object must be ignored.
    audios[0].fire('canplaythrough');
    expect(onload).not.toHaveBeenCalledWith('a.mp3', false);
    expect(player.playlist.sources[0].getState()).toBe(0);
  });

  it('ignores a decoded WebAudio buffer that arrives after the track was unloaded', async() => {
    const { context, decoders } = makeControllableContext();
    global.window = {
      clearTimeout: jest.fn(),
      setTimeout: jest.fn(),
      AudioContext: jest.fn().mockImplementation(() => context),
      gapless5Players: {},
    };

    const xhrs = [];
    global.XMLHttpRequest = jest.fn().mockImplementation(() => {
      const xhr = {
        status: 0,
        open: jest.fn(),
        send: jest.fn(),
        abort: jest.fn(),
      };
      xhrs.push(xhr);
      return xhr;
    });

    const player = new Gapless5({
      ...INIT_OPTIONS,
      useHTML5Audio: false,
      useWebAudio: true,
      tracks: [ 'a.mp3', 'b.mp3' ],
      loadLimit: 1,
    });
    const onload = jest.fn();
    player.onload = onload;

    const xhrA = xhrs[0];
    // Deliver the network response, kicking off decode for a.mp3.
    xhrA.status = 200;
    xhrA.response = { data: true };
    xhrA.onload();

    // Unload a.mp3 before decode resolves.
    player.gotoTrack(1);
    expect(player.playlist.sources[0].getState()).toBe(0);

    decoders.forEach((resolve) => resolve({ duration: 10 }));
    await flushPromises();
    await flushPromises();

    // Late buffer must not resurrect a.mp3 as loaded nor start playback.
    expect(onload).not.toHaveBeenCalledWith('a.mp3', true);
    expect(player.playlist.sources[0].getState()).toBe(0);
  });

  it('does not play an unloaded source when its load callback lands late', async() => {
    const { context, decoders } = makeControllableContext();
    global.window = {
      clearTimeout: jest.fn(),
      setTimeout: jest.fn(),
      AudioContext: jest.fn().mockImplementation(() => context),
      gapless5Players: {},
    };

    const xhrs = [];
    global.XMLHttpRequest = jest.fn().mockImplementation(() => {
      const xhr = { status: 0, open: jest.fn(), send: jest.fn(), abort: jest.fn() };
      xhrs.push(xhr);
      return xhr;
    });

    const player = new Gapless5({
      ...INIT_OPTIONS,
      useHTML5Audio: false,
      useWebAudio: true,
      tracks: [ 'a.mp3' ],
      loadLimit: 1,
    });
    const onplayrequest = jest.fn();
    const onplay = jest.fn();
    player.onplayrequest = onplayrequest;
    player.onplay = onplay;

    const xhrA = xhrs[0];
    xhrA.status = 200;
    xhrA.response = { data: true };
    xhrA.onload();

    // Request playback while the track is still loading (queuedState=Play).
    player.play();
    expect(onplayrequest).toHaveBeenCalledWith('a.mp3');

    // Track is removed/unloaded before the decode resolves.
    player.removeAllTracks();
    decoders.forEach((resolve) => resolve({ duration: 10 }));
    await flushPromises();
    await flushPromises();

    expect(onplay).not.toHaveBeenCalled();
  });
});

