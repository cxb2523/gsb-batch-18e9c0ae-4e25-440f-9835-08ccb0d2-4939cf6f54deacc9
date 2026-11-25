# MMM-Videoplayer

This is a module for [MagicMirror²](https://magicmirror.builders/).

The module is a simple video player for your MagicMirror² setup.

### Screenshot

[![The video](screenshot.png)](http://www.youtube.com/watch?v=7Xp5lOZNERc "MMM-Videoplayer")

The "button" is from [MMM-Modulebar](https://github.com/Snille/MMM-Modulebar), only set up to show that the video pauses and resumes when the module is shown or hidden.

### Installation

In your terminal, go to your MagicMirror² `modules` folder:

```bash
cd ~/MagicMirror/modules
```

Clone this repository:

```bash
git clone https://github.com/Snille/MMM-Videoplayer.git
cd MMM-Videoplayer
```

### Update

In your terminal, go to the module folder and pull the latest changes:

```bash
cd ~/MagicMirror/modules/MMM-Videoplayer
git pull
```

### Configuration

Example config (single local video file):

```javascript
{
  module: 'MMM-Videoplayer',
  position: 'middle_center',
  config: {
    video: "/modules/MMM-Videoplayer/video/mov_bbb.mp4", // Can also be a URL to a mp4 file on the internet.
    loop: true, // Repeat the video.
    autoplay: true, // If set to true, sound (muted by default) has to be muted, otherwise the video will not auto play.
    notification: "VIDEOPLAYER1", // Unique notification string for this player (to be able to play, pause, restart and next from another modules).
  }
},
```

Example config (multi URLs to files on the Internet):

```javascript
{
  module: 'MMM-Videoplayer',
  position: 'middle_center',
  config: {
    videolist: ["https://your.site.com/videos/video1.mp4", "https://your.site.com/videos/video2.mp4", "https://your.site.com/videos/video3.mp4"], // Can also be set to files in the path.
    random: true, // Repeat the videos in random order forever.
    autoplay: true, // If set to true, sound (muted by default) has to be muted, otherwise the video will not auto play.
    notification: "VIDEOPLAYER1", // Unique notification string for this player (to be able to play and pause from another modules).
  }
},
```

Absolute minimum config (will only play the default video file):

```javascript
{
  module: 'MMM-Videoplayer',
  position: 'middle_center',
  config: {
  }
},
```

| Option | Default | Description |
|---|---|---| 
|`video`|`/modules/MMM-Videoplayer/video/mov_bbb.mp4`|The video file to play (may be a URL to a video file as well).|
|`videolist`|none|`Example: ['/modules/MMM-Videoplayer/video/video01.mp4', '/modules/MMM-Videoplayer/video/video02.mp4',... ]` List of video files to play (may be URLs to different video files as well).|
|`loop`|`true`|Loop the video or not. If the videolist is set, it will loop through all videos. With `false`, playback stops on the last video and does not repeat it.<br>Possible values: **true** or **false**|
|`random`|`false`|If set to true, all videos in the list will be played once per round in random order. A new random order is drawn when a round ends, so no video repeats within a round.<br>Possible values: **true** or **false**|
|`hideonstart`|false|If set to true, the player will hide it self when a clip is loaded (and just started playing (the clip will be paused when the module is hidden)). Then when the player is shown again it will continue play the clip and hide itself again when the next clip is loaded (and just starts playing) and so on.<br>Possible values: **true** or **false**|
|`showcontrols`|false|Show the controls or not.<br>Possible values: **true** or **false**|
|`preload`|auto|Preload the video or not see the html-[video](https://www.w3schools.com/tags/tag_video.asp)-tag for more information<br>Possible values: **auto**, **metadata** or **none**|
|`autoplay`|`true`|If set to true, sound (muted by default) has to be muted as well, otherwise the video will not auto play.<br>Possible values: **true** or **false**|
|`muted`|`true`|Mute the sound. If auto play is true, this needs to be true as well, otherwise the video will not auto play.<br>Possible values: **true** or **false**|
|`pauseonhide`|`true`|If true the module will pause the video when hidden. A pause caused this way is remembered separately from a user pause.<br>Possible values: **true** or **false**|
|`resumeonshow`|`true`|If true the module will resume a video that was paused because the module was hidden. A video paused with `TOGGLE` or the controls is not resumed automatically.<br>Possible values: **true** or **false**|
|`notification`|`VIDEOPLAYER1`|Unique notification string for this player. "payload" can be "TOGGLE" to start or stop the player, "REPLAY" to restart current video or "NEXT" to play the next video in the list when sending notifications.|

### CSS Tricks

If you want to change the size of the player, add the following to your `custom.css` and set the size there.

```css
.MMM-Videoplayer video {
    width: 560px;
    height: 315px;
}
```

If you want to rotate the player 90 degrees and set the size:

```css
.MMM-Videoplayer video {
    width: 560px;
    height: 315px;
    -moz-transform:rotate(90deg);
    -webkit-transform:rotate(90deg);
    -o-transform:rotate(90deg);
    -ms-transform:rotate(90deg);
    transform:rotate(90deg);
}
```

Normally you just need to add the line:

```css
    transform:rotate(90deg);
```

But for compatibility reasons, you can add all of them.

If you set the size to your screen size, the video player will not really fill the whole screen when you rotate it 90 degrees, for example in the `fullscreen_below` region. In that case, you can use:

```css
.MMM-Videoplayer video {
    position: absolute;
    transform:rotate(90deg);
    transform-origin: bottom left;
    width: 100vh;
    height: 100vw;
    margin-top: -100vw;
    object-fit: cover;
}
```

### Notes

Even if the player is hidden, you can still start and stop the video by sending notifications to it.

When the module is hidden the player never plays audio. A `TOGGLE`, `NEXT` or
`REPLAY` sent while hidden is applied to the player state right away, and the
next time the module is shown it continues according to how it was paused:

- Paused because the module was hidden → resumes when shown (`resumeonshow: true` required).
- Paused by you with `TOGGLE` or the native controls → stays paused when shown.

### Testing

The module ships with a dependency-free test suite that runs the state machine
against a fake `<video>` element in plain Node.js (no browser or MagicMirror²
instance required):

```bash
npm test
```

You can also run the file directly:

```bash
node tests/videoplayer.test.js
```

The tests cover hidden/shown resume behaviour, user pauses, `TOGGLE`/`NEXT`/
`REPLAY` while hidden, sequential and random list playback with `loop` on and
off, single-video lists, and configuration fallbacks.

Linting (optional, needs `npm install` once):

```bash
npm run lint
```
