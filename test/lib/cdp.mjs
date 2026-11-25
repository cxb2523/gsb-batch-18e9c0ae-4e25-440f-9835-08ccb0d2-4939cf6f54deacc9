"use strict";

// Minimal Chrome DevTools Protocol driver used by the browser checks.
// Node >= 22 provides a global WebSocket, so no dependency is needed.
//
// Note: headless Chrome refuses to start when a URL argument is passed
// together with remote debugging ("Multiple targets are not supported in
// headless mode"), so the browser is launched on about:blank and driven
// through Page.navigate.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

function existing( p ) {
	try {
		return p && fs.statSync( p ).isFile();
	} catch {
		return false;
	}
}

export function findBrowser() {
	if ( process.env.CHROME_PATH && existing( process.env.CHROME_PATH ) ) {
		return process.env.CHROME_PATH;
	}
	const candidates = [
		"C:/Program Files/Google/Chrome/Application/chrome.exe",
		"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
		path.join( os.homedir(), "AppData/Local/Google/Chrome/Application/chrome.exe" ),
		"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
		"C:/Program Files/Microsoft/Edge/Application/msedge.exe",
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/usr/bin/google-chrome",
		"/usr/bin/google-chrome-stable",
		"/usr/bin/chromium",
		"/usr/bin/chromium-browser",
	];

	return candidates.find( existing ) || null;
}

function freePort() {
	return new Promise( ( resolve, reject ) => {
		const srv = net.createServer();

		srv.once( "error", reject );
		srv.listen( 0, "127.0.0.1", () => {
			const port = srv.address().port;

			srv.close( () => resolve( port ) );
		} );
	} );
}

function killTree( child ) {
	try {
		if ( process.platform === "win32" ) {
			// A bare "taskkill" does not resolve from Node's spawn on every
			// Windows setup (UNKNOWN error); the absolute path always does.
			spawnSync( path.join( process.env.SystemRoot || "C:/Windows", "System32/taskkill.exe" ),
				[ "/PID", String( child.pid ), "/T", "/F" ], { stdio: "ignore", windowsHide: true } );
		} else {
			child.kill( "SIGKILL" );
		}
	} catch {
		// Best effort: the profile directory is temporary anyway.
	}
}

export async function launch( { browser, extraArgs = [] } = {} ) {
	const exe = browser || findBrowser();
	if ( !exe ) {
		throw new Error( "No Chrome/Chromium/Edge binary found (set CHROME_PATH)" );
	}

	const userDataDir = fs.mkdtempSync( path.join( os.tmpdir(), "gsdaw-cdp-" ) );
	const port = await freePort();
	const child = spawn( exe, [
		"--headless=new",
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-gpu",
		"--disable-extensions",
		"--disable-background-networking",
		"--disable-sync",
		"--disable-dev-shm-usage",
		"--remote-debugging-port=" + port,
		"--user-data-dir=" + userDataDir,
		...extraArgs,
	], { stdio: [ "ignore", "pipe", "pipe" ], windowsHide: true } );

	let stderr = "";
	child.stderr.on( "data", d => stderr += d.toString() );
	const exitedPromise = new Promise( resolve => child.once( "exit", ( code, signal ) => resolve( { code, signal } ) ) );
	// Do not leave a browser behind if the driving process is interrupted.
	const onExit = () => killTree( child );

	process.once( "exit", onExit );
	process.once( "SIGINT", () => {
		onExit();
		process.exit( 130 );
	} );

	const deadline = Date.now() + 15000;
	let targets = null;
	let exited = null;

	exitedPromise.then( e => exited = e );
	while ( Date.now() < deadline ) {
		if ( exited ) {
			throw new Error( `Browser exited (${ JSON.stringify( exited ) }): ${ stderr.slice( -2000 ) }` );
		}
		try {
			targets = await ( await fetch( `http://127.0.0.1:${ port }/json/list` ) ).json();
			if ( targets.some( t => t.type === "page" ) ) {
				break;
			}
		} catch {
			// Not ready yet.
		}
		await new Promise( r => setTimeout( r, 100 ) );
		targets = targets || null;
	}
	if ( !targets ) {
		killTree( child );
		throw new Error( `Browser did not expose CDP within 15s: ${ stderr.slice( -2000 ) }` );
	}

	const page = targets.find( t => t.type === "page" );
	const ws = new WebSocket( page.webSocketDebuggerUrl );
	await new Promise( ( resolve, reject ) => {
		ws.addEventListener( "open", resolve, { once: true } );
		ws.addEventListener( "error", reject, { once: true } );
	} );

	let nextId = 0;
	const pending = new Map();
	const consoleLines = [];

	ws.addEventListener( "message", ev => {
		const msg = JSON.parse( ev.data );

		if ( msg.id && pending.has( msg.id ) ) {
			pending.get( msg.id )( msg );
			pending.delete( msg.id );
			return;
		}
		if ( msg.method === "Runtime.consoleAPICalled" ) {
			consoleLines.push( msg.params.args.map( a => a.value ?? a.description ?? "" ).join( " " ) );
		}
		if ( msg.method === "Log.entryAdded" ) {
			consoleLines.push( msg.params.entry.text );
		}
	} );

	ws.addEventListener( "close", () => {
		for ( const [, resolve ] of pending ) {
			resolve( { error: { message: "CDP socket closed" } } );
		}
		pending.clear();
	} );

	function send( method, params = {} ) {
		const id = ++nextId;
		return new Promise( resolve => {
			pending.set( id, resolve );
			ws.send( JSON.stringify( { id, method, params } ) );
		} );
	}

	const cdp = {
		send,
		consoleLines,
		close() {
			try {
				ws.close();
			} catch {}
			killTree( child );
			process.removeListener( "exit", onExit );
			// Windows keeps the profile locked for a moment after the browser
			// exits; retrying removes it, and a leftover temp dir is harmless.
			for ( let i = 0; i < 20; ++i ) {
				try {
					fs.rmSync( userDataDir, { recursive: true, force: true } );
					break;
				} catch {
					spawnSync( "cmd", [ "/c", "timeout", "/t", "1", "/nobreak" ], { stdio: "ignore" } );
				}
			}
		},
		async evaluate( expression, { awaitPromise = false } = {} ) {
			const res = await send( "Runtime.evaluate", {
				expression,
				awaitPromise,
				returnByValue: true,
				userGesture: true,
			} );
			if ( res.error ) {
				throw new Error( `CDP evaluate failed: ${ JSON.stringify( res.error ) }` );
			}
			const r = res.result;
			if ( r.exceptionDetails ) {
				throw new Error( `Evaluation threw: ${ r.exceptionDetails.exception?.description || r.exceptionDetails.text }\n${ expression }` );
			}
			return r.result.value;
		},
		async navigate( url ) {
			const res = await send( "Page.navigate", { url } );
			if ( res.error ) {
				throw new Error( `Navigation failed: ${ JSON.stringify( res.error ) }` );
			}
			return res.result;
		},
		async waitFor( expression, { timeout = 20000, interval = 100, label, awaitPromise = false } = {} ) {
			const deadline = Date.now() + timeout;
			let last;

			while ( Date.now() < deadline ) {
				try {
					last = await this.evaluate( expression, { awaitPromise } );
					if ( last ) {
						return last;
					}
				} catch ( err ) {
					last = err.message;
				}
				await new Promise( r => setTimeout( r, interval ) );
			}
			throw new Error( `Timed out after ${ timeout }ms waiting for: ${ label || expression }\nLast value: ${ JSON.stringify( last ) }\nConsole:\n${ consoleLines.slice( -20 ).join( "\n" ) }` );
		},
	};

	return cdp;
}
