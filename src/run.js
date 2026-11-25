"use strict";

document.addEventListener( "gsui", ( { detail: d } ) => console.warn( `uncatched event: "${ d.$event }"`, d.$args, d.$target ) );

// The libraries the DAW cannot start without, in their loading order.
// Must match `BOOT_LIBRARIES` in serviceWorker.js, which precaches them
// for offline boot (that equality is enforced by test/offline-startup.test.mjs).
const GSDAW_BOOT_LIBRARIES = [
	"assets/gsuiLibrarySamples-v1.js",
	"assets/gsuiWaveletList-v1.js",
];

const GSDAW_BOOT_LOAD_TIMEOUT = 45; // seconds, per library

// Scripts that already ran. A library declares a top-level `const`, so
// evaluating it twice throws "already been declared": a retry must only
// fetch the libraries that did not make it the previous time.
const GSDAWloadedLibs = new Set();

// `GSUloadJSFile` resolves on the script `load` event and never rejects, so a
// failed download leaves its promise pending forever and the splash screen
// stuck on "starting...". Wrap it with error/abort/timeout handling so the
// boot chain can always settle.
function GSDAWloadJSFile( src, timeout = GSDAW_BOOT_LOAD_TIMEOUT ) {
	return new Promise( ( resolve, reject ) => {
		const script = document.createElement( "script" );
		let settled = false;
		const settle = ( fn, arg ) => {
			if ( !settled ) {
				settled = true;
				clearTimeout( timer );
				script.onload = script.onerror = null;
				fn( arg );
			}
		};
		const timer = setTimeout( () => {
			script.remove();
			settle( reject, new Error( `Timed out loading ${ src }` ) );
		}, timeout * 1000 );

		script.type = "text/javascript";
		script.async = true;
		script.onload = () => settle( resolve );
		script.onerror = () => {
			script.remove();
			settle( reject, new Error( `Unable to load ${ src }` ) );
		};
		script.src = src;
		document.head.append( script );
	} );
}

// The whole boot chain, unchanged in its order:
// audio context resume -> boot libraries -> DAW init.
async function GSDAWboot() {
	await gswaContext.$resume();
	for ( const src of GSDAW_BOOT_LIBRARIES ) {
		if ( !GSDAWloadedLibs.has( src ) ) {
			await GSDAWloadJSFile( src );
			GSDAWloadedLibs.add( src );
		}
	}
	new GSDAW().$init();
}

{
	const el = $( "#splashScreen" );
	const elStart = el.$query( "[data-action=start]" );
	const elFail = el.$query( "[data-alert=loadFail]" );
	const elRetry = elFail.$query( "[data-action=retry]" );
	let busy = false;
	let started = false;

	const showFailure = () => {
		busy = false;
		el.$rmAttr( "data-starting" )
			.$addAttr( "data-failed" );
	};
	const start = () => {
		if ( busy || started ) {
			return;
		}
		busy = true;
		el.$addAttr( "data-starting" )
			.$rmAttr( "data-failed" );
		// Keep the small delay of the original chain: the click handler must
		// return before the audio context is resumed and the libraries load.
		GSUsetTimeout( () => {
			GSDAWboot().then( () => {
				busy = false;
				started = true;
				el.$rmAttr( "data-starting" )
					.$addAttr( "data-started" );
				GSUsetTimeout( () => el.$remove(), .8 );
			}, err => {
				// Stay on the splash screen: retrying must not need a reload.
				console.warn( "GridSound boot failed:", err );
				showFailure();
			} );
		}, .1 );
	};

	GSUonFirefox
		? el.$query( "[data-alert=firefox]" ).$css( "display", "block" )
		: el.$query( "[data-alert=firefox]" ).$remove();
	el.$addAttr( "data-loaded" );
	elStart.$disabled( false )
		.$onclick( start );
	elRetry.$onclick( start );
}

// Exposed for the automated checks (test/*.mjs); harmless in production.
window.$gsdawBoot = {
	libraries: GSDAW_BOOT_LIBRARIES,
	loadJSFile: GSDAWloadJSFile,
	boot: GSDAWboot,
};
