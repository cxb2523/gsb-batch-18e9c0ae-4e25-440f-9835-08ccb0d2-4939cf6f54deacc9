/* MagicMirror²
 * Module: MMM-Videoplayer
 *
 * By Erik Pettersson
 * Assisted by Timo Pettersson
 * Based on the MMM-videoPlay Module by Sungje KIM
 *
 * MIT Licensed.
 */
Module.register("MMM-Videoplayer", {
	defaults: {
		defaultvideo: "/modules/MMM-Videoplayer/video/mov_bbb.mp4",
		//video: "/modules/MMM-Videoplayer/video/mov_bbb.mp4", // This can also be a link to a mp4 file on the internet.
		//videolist: ["/modules/MMM-Videoplayer/video/test01.mp4", "/modules/MMM-Videoplayer/video/test02.mp4", "/modules/MMM-Videoplayer/video/test03.mp4"], // Can also be links to a mp4 files on the internet.
		random: false, // Play the videos randomly.
		loop: true, // Repeat the video list.
		hideonstart: false, // If set to true, the player will hide it self when a clip is loaded (and just started playing). Then when the player is shown again it will continue play the clip and hide itself again when the next clip is loaded (and just starts playing) and so on.
		fadeSpeed: 1000, // The speed to hide the module (milliseconds).
		showcontrols: false, // Set to true if you want the video controls to show.
		preload: "auto", // Can be set to: "auto", "metadata", "none".
		autoplay: true, // If set to true, sound (muted below) has to be true, otherwise the video will not auto play.
		muted: true, // Mute the sound. If auto play is true, this needs to be true as well, otherwise the video will not auto play.
		pauseonhide: true, // If true the module will pause the video when hidden.
		resumeonshow: true, // If true the module will resume the video when shown.
		notification: "VIDEOPLAYER1" // Unique notification string for this player.
	},

	// Loading the CSS
	getStyles: function () {
		return ["MMM-Videoplayer.css"];
	},

	// Sets up the state that lets us tell the different pause reasons apart.
	// MagicMirror² may call suspend() before getDom() has run, so every entry
	// point makes sure the state exists.
	//
	// State model:
	//   isHidden     - whether the module is currently hidden.
	//   playIntent   - "should this video be playing while visible?".
	//   pauseReason  - null | "hidden" | "user" | "ended"; why playback is
	//                  currently paused. Only "hidden" may be undone by resume().
	//   pendingPauses- pause events caused by our own programmatic pause() calls,
	//                  which must not be mistaken for a user pause.
	ensureState: function () {
		if (this.stateInitialized) {
			return;
		}
		this.stateInitialized = true;
		this.isHidden = false;
		this.playIntent = true;
		this.pauseReason = null;
		this.pendingPauses = 0;
		this.currentVideo = null;
		this.currentVideoIndex = -1;
		this.videoList = [];
		this.videoArray = [];
		this.playedVideoArray = [];
	},

	// Pause, play, replay and next video control via notifications using "TOGGLE", "REPLAY" or "NEXT".
	notificationReceived: function (notification, payload) {
		if (notification !== this.config.notification) {
			return;
		}
		this.ensureState();
		if (payload === "TOGGLE") {
			this.togglePlayback();
		} else if (payload === "NEXT") {
			this.nextVideo();
		} else if (payload === "REPLAY") {
			this.replayVideo();
		}
	},

	// Pauses the video on our own initiative, remembering why. Only an actual
	// state change queues a pause event, so the counter never drifts.
	pauseVideo: function (reason) {
		if (!this.video || this.video.paused) {
			return false;
		}
		this.pauseReason = reason;
		this.pendingPauses += 1;
		this.video.pause();
		return true;
	},

	// What happens when the module is hidden.
	suspend: function () {
		this.ensureState();
		this.isHidden = true;
		if (!this.config.pauseonhide) {
			return;
		}
		// Remember that the module being hidden caused this pause. Only such a
		// pause may be undone automatically by resume().
		this.pauseVideo("hidden");
	},

	// What happens when the module is shown.
	resume: function () {
		this.ensureState();
		this.isHidden = false;
		if (!this.video || !this.video.paused || !this.playIntent) {
			// Nothing to do: no element yet, already playing, or the user
			// explicitly paused it.
			return;
		}
		if (this.pauseReason === "user" || this.pauseReason === "ended") {
			return;
		}
		if (this.config.resumeonshow) {
			this.playVideo();
		}
	},

	// Toggles playback. While visible it follows the real playback state, so a
	// paused video starts and a playing one pauses. While hidden it toggles the
	// recorded intent instead: a video that was paused by hiding counts as
	// "wants to play", so a TOGGLE turns that into an explicit user pause.
	// Playback itself is always deferred while hidden, so a hidden player never
	// makes noise.
	togglePlayback: function () {
		this.ensureState();
		if (!this.video) {
			return;
		}
		if (this.isHidden) {
			if (this.playIntent) {
				this.playIntent = false;
				this.pauseReason = "user";
				this.pauseVideo("user");
			} else {
				this.playIntent = true;
				this.pauseReason = "hidden";
			}
			return;
		}
		if (!this.video.paused) {
			this.playIntent = false;
			this.pauseVideo("user");
			return;
		}
		this.playIntent = true;
		this.pauseReason = null;
		this.playVideo();
	},

	// Restarts the current video from the beginning. It deliberately does not
	// use playedVideoArray, because that array is cleared whenever a new loop
	// round starts (and may therefore no longer hold the current clip).
	replayVideo: function () {
		this.ensureState();
		if (!this.video) {
			return;
		}
		var src = this.currentVideo
			|| this.video.getAttribute("src")
			|| this.video.src
			|| null;
		if (!src) {
			return;
		}
		this.loadVideo(src);
		this.playIntent = true;
		if (this.isHidden) {
			// Rewound silently; resume() decides whether to play it later.
			this.pauseReason = "hidden";
			return;
		}
		this.playVideo();
	},

	// Plays the next video in queue.
	nextVideo: function () {
		this.ensureState();
		if (!this.video) {
			return;
		}

		// The current round is exhausted.
		if (this.videoArray.length === 0) {
			if (!this.config.loop) {
				// Stay on the last clip. If it has already ended, record that
				// so a later resume() does not restart it; if it is still
				// playing, NEXT simply has nothing to do.
				if (this.video.ended) {
					this.playIntent = false;
					this.pauseReason = "ended";
				}
				return;
			}
			this.startNewRound();
			if (this.videoArray.length === 0) {
				return;
			}
		}

		var src = this.videoArray.shift();
		this.playedVideoArray.push(src);

		// If set to true, the player will hide it self when a clip is loaded
		// (and just started playing).
		if (this.config.hideonstart) {
			this.hide(this.config.fadeSpeed);
		}

		this.loadVideo(src);
		this.playIntent = true;
		if (this.isHidden) {
			// The clip is queued and rewound, but stays silent until resume()
			// decides whether to play it.
			this.pauseReason = "hidden";
			return;
		}
		this.playVideo();
	},

	// Rebuilds the queue for a new round. The master list is always the source
	// of truth, so no entries can be lost, and random mode reshuffles the full
	// list only at the start of a round (never within one).
	startNewRound: function () {
		this.playedVideoArray = [];
		this.videoArray = this.videoList.slice();
		if (this.config.random) {
			this.shuffle(this.videoArray);
		}
	},

	// In-place Fisher-Yates shuffle.
	shuffle: function (items) {
		for (var i = items.length - 1; i > 0; i--) {
			var j = Math.floor(Math.random() * (i + 1));
			var tmp = items[i];
			items[i] = items[j];
			items[j] = tmp;
		}
		return items;
	},

	// Builds the master video list from the configuration.
	initVideoList: function () {
		var list = [];
		if (this.config.videolist) {
			list = this.config.videolist.slice();
		}
		if (this.config.video) {
			list.unshift(this.config.video);
		}
		if (list.length === 0) {
			list = [this.config.defaultvideo];
		}
		this.videoList = list;
		this.currentVideo = null;
		this.currentVideoIndex = -1;
		this.startNewRound();
	},

	// Loads a clip and rewinds it. Pausing before changing the source records
	// the pending pause event so it is not mistaken for a user pause. While
	// hidden, autoplay is disabled so a freshly loaded clip cannot start on its
	// own.
	loadVideo: function (src) {
		if (!this.video) {
			return;
		}
		this.currentVideo = src;
		this.currentVideoIndex = this.videoList.indexOf(src);
		this.pauseVideo(null);
		this.video.autoplay = this.isHidden ? false : this.config.autoplay;
		this.video.setAttribute("src", src);
		this.video.load();
		try {
			this.video.currentTime = 0;
		} catch {
			// Some browsers refuse seeking before metadata is available.
		}
	},

	// Starts playback unless the module is hidden. resume() is responsible for
	// starting a video that was deferred while hidden.
	playVideo: function () {
		if (!this.video || this.isHidden) {
			return;
		}
		this.pauseReason = null;
		var self = this;
		var result;
		try {
			result = this.video.play();
		} catch {
			return;
		}
		if (result && typeof result.catch === "function") {
			result.catch(function () {
				// Autoplay may be blocked by the browser. Keep the "wants to
				// play" intent so a later show/toggle can retry, but do not
				// let an unhandled rejection escape.
				self.playIntent = true;
			});
		}
	},

	// A native "play" event means playback actually started.
	handlePlay: function () {
		this.ensureState();
		if (this.video.paused) {
			// Stale event queued before a pause() we already applied.
			return;
		}
		// A successful play supersedes any pending programmatic pause events
		// (some browsers drop the pause event when load() swaps the source), so
		// the counter cannot drift and swallow a later real user pause.
		this.pendingPauses = 0;
		this.playIntent = true;
		if (this.isHidden && this.config.pauseonhide) {
			// A hidden player that should pause on hide must not keep making
			// sound, whatever triggered the play.
			this.pauseVideo("hidden");
			return;
		}
		this.pauseReason = null;
	},

	// A native "pause" event that we did not cause ourselves is a user pause
	// (for example through the native video controls).
	handlePause: function () {
		this.ensureState();
		if (this.pendingPauses > 0) {
			this.pendingPauses -= 1;
			return;
		}
		if (!this.video.paused || this.video.ended) {
			// Stale event, or the pause that end-of-media causes.
			return;
		}
		if (this.pauseReason === "hidden" && this.isHidden) {
			return;
		}
		if (!this.playIntent) {
			return;
		}
		this.playIntent = false;
		this.pauseReason = "user";
	},

	// The current clip ended; let nextVideo() decide what comes next.
	handleEnded: function () {
		this.ensureState();
		this.nextVideo();
	},

	// Send the module. :)
	getDom: function () {
		this.ensureState();
		this.initVideoList();

		// Build the player.
		var wrapper = document.createElement("div");

		// Adds the video
		this.video = document.createElement("video");

		// Track playback so pause reasons can be distinguished.
		this.video.addEventListener("ended", this.handleEnded.bind(this), false);
		this.video.addEventListener("play", this.handlePlay.bind(this), false);
		this.video.addEventListener("pause", this.handlePause.bind(this), false);

		// Adds the rest of the player video tag settings.
		this.video.muted = this.config.muted;
		this.video.autoplay = this.isHidden ? false : this.config.autoplay;
		this.video.loop = false;
		this.video.controls = this.config.showcontrols;
		this.video.preload = this.config.preload;
		this.video.id = this.identifier + "_video";

		// Loads the first video.
		this.nextVideo();

		// Wrap it up.
		wrapper.appendChild(this.video);

		//Sends it back to the dom.
		return wrapper;
	}
});
