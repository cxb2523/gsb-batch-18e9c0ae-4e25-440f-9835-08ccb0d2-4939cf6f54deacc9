#!/usr/bin/env node
"use strict";

// Resolves the `{{GSDAW-VERSION}}` placeholders the same way the production
// build does: from the single `version` field of build-conf.json.
//
// Nothing in the sources hard-codes a release number, so `build-conf.json`
// stays the only place to bump a version. The service worker cache name is
// derived from that value (`daw-<version>`), which keeps it traceable and
// makes every release install a fresh cache.
//
// Usage:
//   node tools/build.mjs --out dist
//   node tools/build.mjs --out dist --version 2.60.3          # simulate a release bump
//   node tools/build.mjs --out dist --build-conf other-conf.json
//   node tools/build.mjs --out dist --print-version           # prints only the version

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLACEHOLDER = "{{GSDAW-VERSION}}";
const ROOT = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), ".." );

function parseArgs( argv ) {
	const args = {
		"build-conf": path.join( ROOT, "build-conf.json" ),
		"out": null,
		"version": null,
		"print-version": false,
	};
	for ( let i = 2; i < argv.length; ++i ) {
		const a = argv[ i ];
		if ( a === "--print-version" ) {
			args[ "print-version" ] = true;
		} else if ( a.startsWith( "--" ) ) {
			const key = a.slice( 2 );
			if ( !( key in args ) || typeof args[ key ] === "boolean" ) {
				throw new Error( `Unknown or incomplete option ${ a }` );
			}
			const val = argv[ ++i ];
			if ( val === undefined ) {
				throw new Error( `Missing value for ${ a }` );
			}
			args[ key ] = val;
		} else {
			throw new Error( `Unexpected argument ${ a }` );
		}
	}
	return args;
}

const args = parseArgs( process.argv );
const conf = JSON.parse( fs.readFileSync( path.resolve( args[ "build-conf" ] ), "utf8" ) );
const version = args.version || conf.version;

if ( !version || !/^\d+\.\d+\.\d+$/.test( version ) ) {
	throw new Error( `Invalid version: ${ JSON.stringify( version ) }` );
}

if ( args[ "print-version" ] ) {
	process.stdout.write( `${ version }\n` );
	process.exit( 0 );
}

if ( !args.out ) {
	throw new Error( "Missing --out <directory>" );
}

// Files that contain the placeholder, taken from build-conf.json itself so
// the list cannot drift from what the real build consumes.
const sources = [
	conf.serviceWorker,
	conf.splashScreen,
].filter( Boolean );

const outDir = path.resolve( args.out );

fs.mkdirSync( outDir, { recursive: true } );
for ( const rel of sources ) {
	const srcPath = path.resolve( ROOT, rel );
	const src = fs.readFileSync( srcPath, "utf8" );
	if ( !src.includes( PLACEHOLDER ) ) {
		throw new Error( `${ rel } does not contain ${ PLACEHOLDER }` );
	}
	const out = src.split( PLACEHOLDER ).join( version );
	const dest = path.join( outDir, path.basename( rel ) );

	fs.writeFileSync( dest, out );
	console.log( `${ rel } -> ${ path.relative( process.cwd(), dest ) } (v${ version })` );
}

// `/version` is a deploy artifact: the build derives it from the same single
// value, rather than the repository keeping a second hand-maintained copy.
fs.writeFileSync( path.join( outDir, "version" ), `${ version }\n` );
