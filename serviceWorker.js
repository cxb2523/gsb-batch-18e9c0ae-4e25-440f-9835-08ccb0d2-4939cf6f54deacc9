"use strict";

// `{{GSDAW-VERSION}}` is replaced at build time by the `version` field of
// build-conf.json, exactly like the placeholder in src/splashScreen.html.
// The version number therefore lives in a single place (build-conf.json):
// the cache is named after it so an update always installs a brand new cache
// and drops the previous ones, instead of serving a stale library.
const GSDAW_VERSION = "{{GSDAW-VERSION}}";
const CACHE_PREFIX = "daw";
const CACHE_NAME = `${ CACHE_PREFIX }-${ GSDAW_VERSION }`;

if ( GSDAW_VERSION.includes( "{{" ) ) {
	console.error( "serviceWorker: {{GSDAW-VERSION}} was not replaced by the build" );
}

// The libraries src/run.js loads before creating the DAW, in this order.
// Keep this list in sync with `GSDAW_BOOT_LIBRARIES` in src/run.js;
// test/offline-startup.test.mjs fails when the two lists diverge.
const BOOT_LIBRARIES = [
	"/assets/gsuiLibrarySamples-v1.js",
	"/assets/gsuiWaveletList-v1.js",
];

const PRECACHE_FILES = [
	"/",
	"/index.html",
	"/manifest.json",
	"/assets/ico.svg",
	"/assets/logo/gs-gs-logo.svg",
	"/assets/logo/gs-gridsound-logo-animated.svg",
	...BOOT_LIBRARIES,
	"/assets/fonts/fa-brands-400.woff2",
	"/assets/fonts/fa-duotone-900.woff2",
	"/assets/fonts/unica-one-400-latin.woff2",
	"/assets/fonts/montserrat-500-latin.woff2",
	"/assets/fonts/montserrat-700-latin.woff2",
	"/assets/fonts/inconsolata-400-latin.woff2",
];

const isLibraryRequest = url => BOOT_LIBRARIES.includes( url.pathname );
const isNavigationRequest = req => req.mode === "navigate" || req.destination === "document";
const isSameOrigin = url => url.origin === self.location.origin;

function openCache() {
	return caches.open( CACHE_NAME );
}

function cacheMatch( req, options ) {
	return openCache().then( cache => cache.match( req, options ) );
}

// `cache: "reload"` bypasses the HTTP cache: a new version must never
// precache library files that the browser still holds from a previous
// release (their names, e.g. `-v1`, do not change between releases).
// A navigation Request cannot be re-constructed (`mode: "navigate"` is
// reserved) and some Request combinations are not clonable, so a failed
// re-construction falls back to the request itself.
function fetchWithCacheMode( req, mode ) {
	if ( req.mode === "navigate" ) {
		return fetch( req.url, { cache: mode, credentials: req.credentials, redirect: "follow" } );
	}
	try {
		return fetch( new Request( req, { cache: mode } ) );
	} catch {
		return fetch( req );
	}
}

// Precache and library cache misses: never trust the HTTP cache.
const fetchFresh = req => fetchWithCacheMode( req, "reload" );
// Online-first paths: revalidate instead of using a stale HTTP-cached copy.
const fetchRevalidating = req => fetchWithCacheMode( req, "no-cache" );

function precache() {
	return openCache().then( cache => Promise.all(
		PRECACHE_FILES.map( file => fetchFresh( file ).then( resp => {
			if ( resp.ok ) {
				return cache.put( file, resp );
			}
			throw new Error( `${ resp.status } ${ resp.statusText }` );
		} ).catch( err => {
			// One missing/broken file must not abort the whole installation:
			// the boot sequence can retry it over the network once online.
			console.error( `serviceWorker: unable to precache ${ file }`, err );
		} )
	) ) );
}

function cacheFirst( req ) {
	return cacheMatch( req ).then( hit => {
		if ( hit ) {
			return hit;
		}
		return fetchFresh( req ).then( resp => {
			if ( resp.ok ) {
				return openCache()
					.then( cache => cache.put( req, resp.clone() ) )
					.then( () => resp );
			}
			return resp;
		} );
	} );
}

async function matchFirstCached( req ) {
	// `cacheMatch` always returns a Promise, so it cannot be used with `||`
	// directly: each candidate has to be awaited before trying the next one.
	for ( const candidate of [ req, "/index.html", "/" ] ) {
		const hit = await cacheMatch( candidate, { ignoreSearch: true } );

		if ( hit ) {
			return hit;
		}
	}
	return null;
}

async function networkFirstNavigation( req ) {
	// Network first, so an online user gets the freshly deployed shell.
	// A rejection (offline) and a non-OK status both fall back to the cache:
	// a broken response must never replace a usable cached shell.
	let networkError = null;
	let resp = null;

	try {
		resp = await fetchRevalidating( req );
	} catch ( err ) {
		networkError = err;
	}
	if ( resp && resp.ok ) {
		const cache = await openCache();

		await cache.put( req, resp.clone() ).catch( () => {} );
		return resp;
	}

	const hit = await matchFirstCached( req );

	if ( hit ) {
		return hit;
	}
	if ( resp ) {
		return resp;
	}
	throw networkError;
}

function networkFirst( req ) {
	return fetchRevalidating( req ).catch( err => cacheMatch( req, { ignoreSearch: true } )
		.then( hit => {
			if ( hit ) {
				return hit;
			}
			throw err;
		} ) );
}

self.addEventListener( "install", e => {
	e.waitUntil( precache().then( () => self.skipWaiting() ) );
} );

self.addEventListener( "activate", e => {
	e.waitUntil( ( async () => {
		// Drop every previous GridSound cache (including the legacy
		// unversioned `daw` cache) so outdated libraries do not pile up.
		const isOwnCache = name => name === CACHE_PREFIX || name.startsWith( `${ CACHE_PREFIX }-` );
		const stale = ( await caches.keys() )
			.filter( name => name !== CACHE_NAME && isOwnCache( name ) );

		await Promise.all( stale.map( name => caches.delete( name ) ) );
		await self.clients.claim();
	} )() );
} );

self.addEventListener( "fetch", e => {
	const req = e.request;

	if ( req.method !== "GET" ) {
		return;
	}
	const url = new URL( req.url );

	if ( !isSameOrigin( url ) ) {
		return;
	}
	if ( isLibraryRequest( url ) ) {
		e.respondWith( cacheFirst( req ) );
	} else if ( isNavigationRequest( req ) ) {
		e.respondWith( networkFirstNavigation( req ) );
	} else {
		e.respondWith( networkFirst( req ) );
	}
} );
