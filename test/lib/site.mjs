"use strict";

// Builds a runnable static site for the browser checks:
//   - the stamped service worker (`daw-<version>` cache name),
//   - the stamped splash screen, read and injected into index.html,
//   - src/run.js,
//   - the gs-utils stub and the DAW/audio-context stubs,
//   - placeholder assets and library stubs (the real `assets/` is a submodule).
//
// Everything is written into a fresh temporary directory per call so a
// simulated "new release" cannot leak files from a previous version.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), "../.." );

export function readJSON( file ) {
	return JSON.parse( fs.readFileSync( file, "utf8" ) );
}

export function siteVersion( { buildConf = path.join( ROOT, "build-conf.json" ) } = {} ) {
	return readJSON( buildConf ).version;
}

// Reads a simple top-level `const NAME = [ ... ];` array literal.
export function readLiteralArray( file, name ) {
	const source = fs.readFileSync( file, "utf8" );
	const start = source.indexOf( `const ${ name } =` );

	if ( start < 0 ) {
		throw new Error( `${ name } not found in ${ file }` );
	}
	const i = source.indexOf( "[", start );
	let depth = 0;
	let end = -1;

	for ( let j = i; j < source.length; ++j ) {
		if ( source[ j ] === "[" ) {
			++depth;
		} else if ( source[ j ] === "]" && --depth === 0 ) {
			end = j;
			break;
		}
	}
	if ( end < 0 ) {
		throw new Error( `Unterminated array for ${ name } in ${ file }` );
	}

	return JSON.parse( source.slice( i, end + 1 ).replace( /,\s*\]$/, "]" ) );
}

// The real libraries declare a top-level `const` (not a window property), so
// the stubs do the same: re-evaluating one must fail with "already declared",
// exactly like the real file would on a bad retry.
const LIBRARY_STUB = ( name, size ) => `"use strict";
const ${ name } = { __fake: true, length: ${ size } };
`;

// Stand-ins for the audio context and the DAW entry point.
const DAW_STUB = `"use strict";
window.__bootTrace = [];
window.gswaContext = {
	$resume() {
		window.__bootTrace.push( "resume" );
		return Promise.resolve();
	},
};
window.GSDAW = class GSDAW {
	$init() {
		window.__bootTrace.push( "init" );
		window.__dawInited = true;
	}
};
`;

const ASSETS = [
	"assets/ico.svg",
	"assets/logo/gs-gs-logo.svg",
	"assets/logo/gs-gridsound-logo-animated.svg",
	"assets/fonts/fa-brands-400.woff2",
	"assets/fonts/fa-duotone-900.woff2",
	"assets/fonts/unica-one-400-latin.woff2",
	"assets/fonts/montserrat-500-latin.woff2",
	"assets/fonts/montserrat-700-latin.woff2",
	"assets/fonts/inconsolata-400-latin.woff2",
];

export function buildSite( {
	version,
	outDir,
	srcDir = path.join( ROOT, "src" ),
	swPath = path.join( ROOT, "serviceWorker.js" ),
	cssPath = path.join( ROOT, "src/splashScreen.css" ),
	libraries = null,
} = {} ) {
	const siteDir = outDir || fs.mkdtempSync( path.join( os.tmpdir(), "gsdaw-site-" ) );
	const resolve = text => text.split( "{{GSDAW-VERSION}}" ).join( version );
	const prc = rel => resolve( fs.readFileSync( path.join( ROOT, rel ), "utf8" ) );

	const sw = prc( "serviceWorker.js" );
	const splash = resolve( fs.readFileSync( path.join( srcDir, "splashScreen.html" ), "utf8" ) );
	const run = fs.readFileSync( path.join( srcDir, "run.js" ), "utf8" );
	const utilsStub = fs.readFileSync( path.join( ROOT, "test/fixtures/gs-utils-stub.js" ), "utf8" );
	const css = fs.readFileSync( cssPath, "utf8" );
	const libs = libraries || readLiteralArray( path.join( srcDir, "run.js" ), "GSDAW_BOOT_LIBRARIES" );

	const files = {
		"serviceWorker.js": sw,
		"src/run.js": run,
		"index.html": `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>GridSound offline-startup harness</title>
<link rel="manifest" href="manifest.json"/>
<style>
${ css }
</style>
<script>
// Test transport recorded so the checks can attribute failures precisely.
window.__bootCalls = [];
</script>
</head>
<body>
${ splash }
<script>${ utilsStub }</script>
<script>${ DAW_STUB }</script>
<script>${ run }</script>
<script>
// Registered last, like the real build's inline bootstrap.
window.__swReady = navigator.serviceWorker.register( "serviceWorker.js" )
	.then( () => navigator.serviceWorker.ready )
	.then( () => "ready" );
Promise.resolve( window.__swReady ).catch( err => "error: " + err.message );
</script>
</body>
</html>
`,
		"manifest.json": prc( "manifest.json" ),
	};

	for ( const rel of ASSETS ) {
		files[ rel ] = `/* placeholder ${ rel } */`;
	}
	files[ libs[ 0 ] ] = LIBRARY_STUB( "gsuiLibrarySamples", 1 );
	files[ libs[ 1 ] ] = LIBRARY_STUB( "gsuiWaveletList", 1 );
	// Present in the deployed assets but not a startup dependency.
	files[ "assets/gswaPeriodicWavesList-v1.js" ] = LIBRARY_STUB( "gswaPeriodicWavesList", 1 );

	for ( const [ rel, content ] of Object.entries( files ) ) {
		const file = path.join( siteDir, rel );
		const dir = path.dirname( file );

			if ( !fs.existsSync( dir ) ) {
				fs.mkdirSync( dir, { recursive: true } );
			}
		fs.writeFileSync( file, content );
	}
	return siteDir;
}
