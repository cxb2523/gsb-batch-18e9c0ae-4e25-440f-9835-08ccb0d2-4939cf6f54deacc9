"use strict";

// End-to-end check of the offline startup chain, driven through a real
// browser over the DevTools protocol. Replaces the manual acceptance steps:
//
//   1. first online load, then the server goes away (same origin/port),
//      the page is reloaded and the DAW must still initialise from cache;
//   2. one boot library is made to fail: the splash screen must show the
//      retryable failure state and a click on "retry" must complete the
//      boot, without a page reload and without re-evaluating libraries that
//      already loaded;
//   3. a new version is published: the previous cache must be deleted and
//      only the new `daw-<version>` cache must survive;
//   4. routing: library requests are served cache-first, navigations go to
//      the network first and fall back to the cache when offline.
//
// Run: node test/browser/offline-startup.e2e.mjs
// Optional: CHROME_PATH=/path/to/chrome node test/browser/offline-startup.e2e.mjs

import assert from "node:assert/strict";

import { launch, findBrowser } from "../lib/cdp.mjs";
import { createServer } from "../lib/server.mjs";
import { buildSite, siteVersion } from "../lib/site.mjs";

const VERSION = siteVersion();
const results = [];

function step( name, fn ) {
	results.push( { name } );
	process.stdout.write( `\n• ${ name }\n` );

	return fn();
}

function ok( name ) {
	process.stdout.write( `  ✔ ${ name }\n` );
}

// Restores networking for the given page by going offline/online through
// Chrome's own network emulation (deterministic, no OS-level firewall).
async function setOffline( cdp, offline ) {
	const res = await cdp.send( "Network.emulateNetworkConditions", {
		offline,
		latency: 0,
		downloadThroughput: offline ? 0 : -1,
		uploadThroughput: offline ? 0 : -1,
	} );

	if ( res.error ) {
		throw new Error( `Network emulation failed: ${ JSON.stringify( res.error ) }` );
	}
}

async function navigateAndWait( cdp, url ) {
	await cdp.navigate( url );
	await cdp.waitFor( "document.readyState === 'complete'", { label: "page load" } );
}

const splashState = `(() => {
	const el = document.getElementById( "splashScreen" );
	if ( !el ) { return { removed: true }; }
	const start = el.querySelector( "[data-action=start]" );
	const retry = el.querySelector( "[data-action=retry]" );
	const alertFail = el.querySelector( "[data-alert=loadFail]" );
	const visible = node => !node ? false
		: node.checkVisibility ? node.checkVisibility( { visibilityProperty: true } )
		: getComputedStyle( node ).display !== "none";
	return {
		removed: false,
		loaded: el.hasAttribute( "data-loaded" ),
		starting: el.hasAttribute( "data-starting" ),
		failed: el.hasAttribute( "data-failed" ),
		started: el.hasAttribute( "data-started" ),
		startDisabled: !!start && start.hasAttribute( "disabled" ),
		retryVisible: visible( retry ) && visible( alertFail ),
		alertDisplay: alertFail ? getComputedStyle( alertFail ).display : null,
		startVisible: visible( start ),
		retryLabel: retry ? getComputedStyle( retry, "::before" ).content : null,
	};
})()`;

// Removes one entry from the current service worker cache, so the next
// request for it really has to go to the network.
async function purgeFromCache( cdp, pathname ) {
	const removed = await cdp.evaluate( `(async () => {
		const keys = await caches.keys();
		const name = keys.find( k => k.startsWith( "daw-" ) );
		return caches.open( name ).then( c => c.delete( ${ JSON.stringify( pathname ) } ) );
	})()`, { awaitPromise: true } );
	assert.equal( removed, true, `${ pathname } should have been in the cache before purging it` );
}

async function main() {
	const browser = findBrowser();
	if ( !browser ) {
		console.log( "SKIP: no Chrome/Chromium/Edge found (set CHROME_PATH)" );
		process.exitCode = 0;
		return;
	}
	console.log( `browser: ${ browser }` );
	console.log( `version: ${ VERSION }` );

	const siteDir = buildSite( { version: VERSION } );
	const server = await createServer( { root: siteDir } );
	await server.start();
	const origin = server.url;
	const cdp = await launch( { browser } );

	try {
		await cdp.send( "Page.enable" );
		await cdp.send( "Runtime.enable" );
		await cdp.send( "Network.enable" );
		await cdp.send( "Log.enable" );

		await step( "1. first online load activates the service worker", async () => {
			await navigateAndWait( cdp, origin + "/" );

			const cacheName = await cdp.waitFor( `(async () => {
				const keys = await caches.keys();
				return keys.find( k => k.startsWith( "daw-" ) ) || null;
			})()`, { awaitPromise: true, label: "versioned cache" } );

			assert.equal( cacheName, `daw-${ VERSION }` );

			// The cache is created before its entries are written: wait for the
			// precache to have completed instead of sampling it mid-install.
			const precached = await cdp.waitFor( `(async () => {
				const c = await caches.open( "${ cacheName }" );
				const keys = Array.from( ( await c.keys() ).map( r => new URL( r.url ).pathname ) ).sort();
				return keys.includes( "/assets/gsuiLibrarySamples-v1.js" ) && keys.includes( "/assets/gsuiWaveletList-v1.js" ) ? keys : null;
			})()`, { awaitPromise: true, label: "precache complete" } );

			assert.ok( precached.includes( "/assets/gsuiLibrarySamples-v1.js" ) );
			assert.ok( precached.includes( "/assets/gsuiWaveletList-v1.js" ) );
			assert.ok( !precached.includes( "/assets/gswaPeriodicWavesList-v1.js" ) );
			assert.ok( precached.includes( "/index.html" ) );
			assert.ok( precached.includes( "/manifest.json" ) );
			ok( `cache ${ cacheName } precaches the two boot libraries and no stale library` );
		} );

		await step( "2. boot from cache while the network is down", async () => {
			await cdp.waitFor( "navigator.serviceWorker.controller !== null", { label: "controlled page" } );

			await setOffline( cdp, true );
			await navigateAndWait( cdp, origin + "/" );
			await cdp.waitFor( "window.__swReady !== undefined", { label: "page script" } );

			const beforeClick = await cdp.evaluate( splashState );
			assert.equal( beforeClick.loaded, true );
			assert.equal( beforeClick.startDisabled, false );

			await cdp.evaluate( `document.querySelector( "#splashScreen [data-action=start]" ).click()` );
			await cdp.waitFor( "window.__dawInited === true", { timeout: 10000, label: "DAW init offline" } );

			const trace = await cdp.evaluate( "window.__bootTrace" );
			assert.deepEqual( trace, [ "resume", "init" ] );

			const after = await cdp.evaluate( splashState );
			assert.equal( after.failed, false );
			ok( "reload while offline reaches the DAW (resume -> libraries -> init)" );

			await setOffline( cdp, false );
		} );

		await step( "3. a failing library shows the retry state and retry recovers", async () => {
			const lib0 = await cdp.evaluate( "window.$gsdawBoot.libraries[0]" );

			// Library requests are cache-first, so a cached copy would hide the
			// failure; remove it to make this boot genuinely go to the network,
			// which then answers with a 500 for this path.
			await purgeFromCache( cdp, "/" + lib0 );
			server.failPaths( [ "/" + lib0 ] );
			await cdp.evaluate( "location.reload()" );
			await cdp.waitFor( "document.readyState === 'complete' && typeof window.$gsdawBoot === 'object'", { label: "reloaded page" } );
			await cdp.waitFor( "!!navigator.serviceWorker.controller", { label: "controlled page" } );

			await cdp.evaluate( `document.querySelector( "#splashScreen [data-action=start]" ).click()` );
			await cdp.waitFor( "document.getElementById('splashScreen')?.hasAttribute('data-failed')", { timeout: 20000, label: "failure state" } );

			const failed = await cdp.evaluate( splashState );
			assert.equal( failed.failed, true );
			assert.equal( failed.starting, false );
			assert.equal( failed.started, false );
			assert.equal( failed.retryVisible, true );
			assert.equal( failed.startVisible, false, "the start button is replaced by the retry button" );
			assert.notEqual( failed.alertDisplay, "none" );
			assert.match( failed.retryLabel || "", /retry/i );
			assert.equal( await cdp.evaluate( "window.__dawInited === true" ), false );
			assert.equal( await cdp.evaluate( "typeof window.$gsdawBoot" ), "object", "the page must not have reloaded on failure" );
			assert.ok( server.failed( "/" + lib0 ).length >= 1, "the failing library must have been requested" );
			ok( "splash screen shows a retry hint instead of hanging on 'starting...'" );

			// Repair the server, then click retry without reloading the page.
			server.failPaths( [] );
			assert.equal( await cdp.evaluate( "typeof gsuiLibrarySamples" ), "undefined", "the library never ran, so nothing should be declared yet" );
			await cdp.evaluate( `document.querySelector( "#splashScreen [data-action=retry]" ).click()` );
			await cdp.waitFor( "window.__dawInited === true", { timeout: 20000, label: "DAW init after retry" } );

			const afterRetry = await cdp.evaluate( splashState );
			assert.equal( afterRetry.failed, false );
			assert.equal( afterRetry.started, true );
			assert.equal( await cdp.evaluate( "typeof gsuiLibrarySamples" ), "object" );
			assert.equal( await cdp.evaluate( "typeof gsuiWaveletList" ), "object" );
			// Boot order stayed resume -> libraries -> init; the context resume
			// is idempotent and runs once per attempt, so the trace of the
			// failed attempt plus the retry is [resume, resume, init].
			const trace = await cdp.evaluate( "window.__bootTrace" );

			assert.equal( trace.at( -1 ), "init", "DAW init must run last" );
			assert.equal( trace.filter( t => t === "init" ).length, 1, "init must run only once" );
			assert.ok( trace.indexOf( "resume" ) < trace.lastIndexOf( "resume" ) );
			assert.ok( server.count( "/" + lib0 ) >= 2, "the retry must refetch the library that failed" );
			ok( "clicking retry boots the DAW without reloading the page" );
		} );

		await step( "4. library requests are cache-first, navigations network-first", async () => {
			// Both cases are exercised with the server stopped: a library request
			// must still be answered (cache-first), and a navigation must fall
			// back to the cached shell (network-first with a cache fallback).
			server.clearLog();
			const lib = await cdp.evaluate( "window.$gsdawBoot.libraries[1]" );
			await cdp.evaluate( `fetch( "${ lib }" ).then( r => r.status ).catch( e => "network: " + e.message )`, { awaitPromise: true } );
			await server.stop();

			const offlineLibStatus = await cdp.evaluate(
				`fetch( "${ lib }" ).then( r => r.status ).catch( e => "network: " + e.message )`,
				{ awaitPromise: true }
			);

			assert.equal( offlineLibStatus, 200, "library must come from the service worker cache" );
			assert.equal( server.count( "/" + lib ), 0, "the network was down, so nothing could have been requested" );
			ok( "library fetch answered from cache with the server stopped" );

			// `location.reload()` emits a navigation request (`mode: navigate`).
			// Offline it must be answered with the cached shell so the splash
			// screen and its retry button can still show up.
			await cdp.evaluate( "location.reload()" );
			await cdp.waitFor(
				"document.readyState === 'complete' && !!document.getElementById('splashScreen') && typeof $gsdawBoot === 'object'",
				{ timeout: 15000, label: "cached shell booted offline" }
			);
			assert.equal(
				await cdp.evaluate( "document.querySelector('#splashScreen').hasAttribute('data-loaded')" ),
				true
			);
			ok( "navigation falls back to the cached shell while offline" );

			await server.start();
			// A broken server (HTTP 500) is treated like an outage too: a cached
			// shell is preferable to an error page.
			server.failPaths( [ "/", "/index.html" ] );
			await cdp.evaluate( "location.reload()" );
			await cdp.waitFor(
				"document.readyState === 'complete' && !!document.getElementById('splashScreen')",
				{ timeout: 15000, label: "cached shell served when the navigation 500s" }
			);
			assert.equal(
				await cdp.evaluate( "document.querySelector('#splashScreen').hasAttribute('data-loaded')" ),
				true
			);
			ok( "navigation falls back to the cached shell on a 500 as well" );
			server.failPaths( [] );
			await navigateAndWait( cdp, origin + "/" );
		} );

		await step( "5. a new version replaces the old cache", async () => {
			const oldCache = `daw-${ VERSION }`;
			const nextVersion = bump( VERSION );
			const nextSite = buildSite( { version: nextVersion } );
			const server2 = await createServer( { root: nextSite, port: server.port } );

			await server.stop();
			await server2.start();
			// The origin is unchanged, so this is a plain "release deployed"
			// update for the same site.
			await setOffline( cdp, false );
			await navigateAndWait( cdp, origin + "/" );
			await cdp.waitFor( `navigator.serviceWorker.getRegistration().then( r => r && r.update() ).then( () => true )`, { awaitPromise: true } );
			// Installing creates the new cache; activating deletes the old one.
			// Waiting for both in one condition observes the end state, not the
			// intermediate one.
			await cdp.waitFor( `(async () => {
				const keys = await caches.keys();
				return keys.includes( "daw-${ nextVersion }" ) && !keys.includes( "daw-${ VERSION }" );
			})()`, { awaitPromise: true, timeout: 20000, label: "new cache installed and old cache deleted" } );
			await cdp.waitFor( "!!navigator.serviceWorker.controller", { label: "new worker controlling" } );

			const keys = await cdp.evaluate( "(async () => caches.keys())()", { awaitPromise: true } );

			assert.ok( keys.includes( `daw-${ nextVersion }` ) );
			assert.ok( !keys.includes( oldCache ), `stale cache ${ oldCache } should have been deleted: ${ keys.join( "," ) }` );
			ok( `old cache ${ oldCache } dropped, daw-${ nextVersion } installed` );

			// The new library file is served by the new worker from the new cache.
			const newCacheLibs = await cdp.evaluate( `(async () => {
				const c = await caches.open( "daw-${ nextVersion }" );
				return Array.from( ( await c.keys() ).map( r => new URL( r.url ).pathname ) );
			})()`, { awaitPromise: true } );

			assert.ok( newCacheLibs.includes( "/assets/gsuiLibrarySamples-v1.js" ) );
			assert.ok( newCacheLibs.includes( "/assets/gsuiWaveletList-v1.js" ) );

			await server2.close();
			await server.start();
		} );
	} finally {
		cdp.close();
		await server.close();
	}

	console.log( `\n${ results.length } steps passed, ${ results.length } assertions groups OK` );
}

function bump( v ) {
	const parts = v.split( "." ).map( Number );

	return [ parts[ 0 ], parts[ 1 ], parts[ 2 ] + 1 ].join( "." );
}

main().catch( err => {
	console.error( "\nFAILED:", err.message );
	process.exitCode = 1;
} );
