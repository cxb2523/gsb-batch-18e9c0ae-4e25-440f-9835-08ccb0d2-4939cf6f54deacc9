## Project setup
Requires [Node](https://nodejs.org/en/download/) and [Vue CLI](https://cli.vuejs.org/guide/installation.html)

```
npm install
```

### Compiles and hot-reloads for development
```
npm run serve
```

### Runs the server
```
npm run server
```

### Compiles and minifies for production
```
npm run build
```

### Lints and fixes files
```
npm run lint
```

### Runs the audio graph tests
```
npm test
```

These exercise the playback/recording graph lifecycle in
`src/components/noise.js` against a stubbed Tone.js: no AudioContext, speakers
or microphone are needed.

### Runs the browser verification
```
npm run test:browser
```

This drives the real component in headless Chrome/Edge with the real Tone.js
build and MediaRecorder (audio is generated, so no microphone or external
service is used). Set `CHROME_PATH` if the browser is in a non-standard
location. Each test builds its own component instance, so a failure in one does
not hide the others.

### Directory Summary

Here are some of the more important files and directories:

* `config/default.json`: Contains the default configuration file
* `server/*`: Where all of the node server related code is
* `server/app.js`: The main server file where server settings are set
* `server/db.js`: Where the database is created
* `server/logger.js`: Where the logger is created and configured
* `server/bin/www.js`: The entry point of the server application (what you run to start the server)
* `server/boot/*`: These are run on server startup
* `server/routes/*`: Where all of the server routes and logic are defined
* `src/*`: Contains all the frontend code
* `src/components/*`: Where all of the Vue components are defined, split into vue and js files for each component
* `src/router/index.js`: Where all the routing and route-protection logic is defined
* `src/views/*`: Contains all the views

### Customize configuration
See [Configuration Reference](https://cli.vuejs.org/config/).
