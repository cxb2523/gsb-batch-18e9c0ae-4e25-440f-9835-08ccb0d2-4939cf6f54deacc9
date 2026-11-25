"use strict";

// Static checks on the offline-boot contract. No browser needed, runs in CI:
//   node --test test/

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { ROOT, readJSON, readLiteralArray } from "./lib/site.mjs";

const read = rel => fs.readFileSync( path.join( ROOT, rel ), "utf8" );
const bootLibs = () => readLiteralArray( path.join( ROOT, "src/run.js" ), "GSDAW_BOOT_LIBRARIES" );
const swLibs = () => readLiteralArray( path.join( ROOT, "serviceWorker.js" ), "BOOT_LIBRARIES" );
const conf = readJSON( path.join( ROOT, "build-conf.json" ) );

test( "the service worker precaches exactly the libraries run.js loads", () => {
	const runList = bootLibs();

	assert.ok( runList.length > 0 );
	assert.deepEqual( swLibs().map( p => p.replace( /^\//, "" ) ), runList );
} );

test( "the service worker does not precache stale library names", () => {
	const sw = read( "serviceWorker.js" );

	// The bug this change fixes: the manifest listed gswaPeriodicWavesList-v1.js
	// while the boot sequence loads gsuiWaveletList-v1.js.
	assert.ok( !sw.includes( "gswaPeriodicWavesList" ) );
	assert.ok( sw.includes( "gsuiWaveletList-v1.js" ) );
	assert.ok( sw.includes( "gsuiLibrarySamples-v1.js" ) );
} );

test( "the cache name is versioned from build-conf.json, never hard-coded", () => {
	const sw = read( "serviceWorker.js" );

	assert.match( sw, /const\s+GSDAW_VERSION\s*=\s*"\{\{GSDAW-VERSION\}\}"/ );
	assert.match( sw, /const\s+CACHE_NAME\s*=\s*`\$\{\s*CACHE_PREFIX\s*\}-\$\{\s*GSDAW_VERSION\s*\}`/ );
	assert.match( sw, /const\s+CACHE_PREFIX\s*=\s*"daw"/ );
	// A release number typed directly into the worker would drift from
	// build-conf.json; the placeholder keeps a single source of truth.
	assert.ok( !/\d+\.\d+\.\d+/.test( sw ), "serviceWorker.js must not hard-code a version" );

	assert.match( conf.version, /^\d+\.\d+\.\d+$/ );
	assert.match( read( "src/splashScreen.html" ), /\{\{GSDAW-VERSION\}\}/ );
	assert.match( read( "src/run.js" ), /GSDAW_BOOT_LIBRARIES/ );
} );

test( "build-conf.json is the only place holding a release number", () => {
	// The repository shipped a `version` file that had already drifted from
	// build-conf.json (2.60.0 vs 2.60.2). The deployable /version file is now
	// produced by tools/build.mjs from that single value.
	assert.equal( fs.existsSync( path.join( ROOT, "version" ) ), false, "do not keep a second version file in the repo" );

	const sources = [ "serviceWorker.js", "src/run.js", "src/splashScreen.html", "src/splashScreen.css", "manifest.json" ];

	for ( const rel of sources ) {
		assert.ok( !new RegExp( `"${ conf.version }"` ).test( read( rel ) ), `${ rel } must not duplicate the version` );
	}
} );

test( "install removes stale caches and keeps only the current one", () => {
	const sw = read( "serviceWorker.js" );

	assert.match( sw, /addEventListener\( "activate"/ );
	assert.match( sw, /caches\s*\.\s*keys\(\)/ );
	assert.match( sw, /caches\s*\.\s*delete\(/ );
	assert.match( sw, /name\s*!==\s*CACHE_NAME/ );
	assert.match( sw, /self\.clients\.claim\(\)/ );
} );

test( "fetch routing: libraries cache-first, navigations network-first", () => {
	const sw = read( "serviceWorker.js" );

	assert.match( sw, /e\.respondWith\( cacheFirst\( req \) \)/ );
	assert.match( sw, /e\.respondWith\( networkFirstNavigation\( req \) \)/ );
	// cacheFirst must be cache lookup first, and only then network.
	const cacheFirst = sw.slice( sw.indexOf( "function cacheFirst" ), sw.indexOf( "function networkFirstNavigation" ) );

	assert.match( cacheFirst, /cacheMatch\( req \)\.then\( hit => \{/ );
	assert.match( cacheFirst, /if \( hit \) \{\s*return hit;/ );
	// Navigation: network first, cache fallback (so online users get updates
	// and offline users can still boot).
	const nav = sw.slice( sw.indexOf( "function networkFirstNavigation" ), sw.indexOf( "function networkFirst( req )" ) );

	assert.match( nav, /resp = await fetchRevalidating\( req \)/, "navigation must try the network first" );
	assert.match( nav, /const hit = await matchFirstCached\( req \)/, "and fall back to the cache" );
	// A broken (non-OK) network response must not shadow a cached shell.
	assert.match( nav, /if \( resp && resp\.ok \)/ );
	// The cache fallback must await each candidate: a Promise is truthy, so
	// `cacheMatch(x) || cacheMatch(y)` would never reach the second candidate.
	const fallback = sw.slice( sw.indexOf( "async function matchFirstCached" ), sw.indexOf( "async function networkFirstNavigation" ) );

	assert.match( fallback, /for \( const candidate of/ );
	assert.match( fallback, /\[ req, "\/index\.html", "\/" \]/ );
	assert.match( fallback, /const hit = await cacheMatch\( candidate/ );
	assert.ok( !/\|\|\s*cacheMatch/.test( fallback ), "do not chain cacheMatch with ||" );
} );

test( "run.js reports and retries load failures instead of hanging", () => {
	const run = read( "src/run.js" );

	assert.match( run, /script\.onerror\s*=/ );
	assert.match( run, /\$addAttr\( "data-failed" \)/ );
	assert.match( run, /\$rmAttr\( "data-failed" \)/ );
	assert.match( run, /data-action=retry/ );
	// The retry must reuse the same boot function (and keep the loaded set),
	// not create a second chain.
	assert.match( run, /const start = \(\) =>/ );
	assert.match( run, /GSDAWloadedLibs\.has\( src \)/ );
	assert.match( run, /new GSDAW\(\)\.\$init\(\)/ );
} );

test( "boot order is unchanged: resume, then libraries, then DAW init", () => {
	const run = read( "src/run.js" );
	const boot = run.slice( run.indexOf( "async function GSDAWboot" ), run.indexOf( "{\n\tconst el =" ) );

	assert.match( boot, /await gswaContext\.\$resume\(\)/ );
	assert.match( boot, /await GSDAWloadJSFile\( src \)/ );
	assert.match( boot, /new GSDAW\(\)\.\$init\(\)/ );
	assert.ok( boot.indexOf( "$resume" ) < boot.indexOf( "GSDAWloadJSFile" ) );
	assert.ok( boot.indexOf( "GSDAWloadJSFile" ) < boot.indexOf( "$init" ) );
} );

test( "the precache manifest covers every boot library and nothing stale", () => {
	const sw = read( "serviceWorker.js" );
	const start = sw.indexOf( "const PRECACHE_FILES =" );
	const end = sw.indexOf( "];", start );
	const block = sw.slice( start, end );
	const literalUrls = [ ...block.matchAll( /"(\/[^"]*)"/g ) ].map( m => m[ 1 ] );
	// BOOT_LIBRARIES is spread into the list, so include it explicitly.
	const urls = [ ...literalUrls, ...swLibs() ];

	assert.ok( literalUrls.length >= 10, "precache list should not be nearly empty" );
	assert.ok( urls.every( u => u.startsWith( "/" ) ) );
	assert.match( block, /\.\.\.BOOT_LIBRARIES/ );

	const jsFiles = urls.filter( u => u.endsWith( ".js" ) ).sort();

	assert.deepEqual( jsFiles, bootLibs().map( p => "/" + p ).sort() );
} );
