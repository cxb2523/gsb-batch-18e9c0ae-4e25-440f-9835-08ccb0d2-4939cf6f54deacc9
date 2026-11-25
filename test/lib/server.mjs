"use strict";

// Tiny static file server for the browser checks. It can simulate a network
// outage (stop/start on the very same port, so the origin stays identical)
// and per-path failures (500 responses), and it records every request so the
// tests can tell cache hits from network hits.

import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".woff2": "font/woff2",
	".txt": "text/plain; charset=utf-8",
};

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

export async function createServer( { root, port = null } ) {
	let server = null;
	let truePort = port;
	const log = []; // { path, status, when }
	const failPaths = new Set();
	const delay = {};

	async function handle( req, res ) {
		const url = new URL( req.url, "http://127.0.0.1" );
		const pathname = url.pathname;
		const entry = { path: pathname, status: 200, when: Date.now() };

		log.push( entry );

		if ( delay[ pathname ] ) {
			await new Promise( r => setTimeout( r, delay[ pathname ] ) );
		}
		if ( failPaths.has( pathname ) ) {
			entry.status = 500;
			res.writeHead( 500, { "content-type": "text/plain", "cache-control": "no-store" } );
			res.end( "simulated failure" );
			return;
		}

		const rel = pathname === "/"
			? "index.html"
			: pathname.slice( 1 ).split( "/" ).map( decodeURIComponent ).join( path.sep );
		const file = path.join( root, rel );

		let body;
		try {
			body = fs.readFileSync( file );
		} catch {
			entry.status = 404;
			res.writeHead( 404, { "content-type": "text/plain", "cache-control": "no-store" } );
			res.end( "not found" );
			return;
		}
		const type = MIME[ path.extname( file ) ] || "application/octet-stream";

		// `no-store` keeps the HTTP cache out of the picture: what the tests
		// observe comes from the service worker cache, not from Chrome's own
		// HTTP cache, and service worker updates are always noticed.
		res.writeHead( 200, {
			"content-type": type,
			"cache-control": "no-store",
			"access-control-allow-origin": "*",
		} );
		res.end( body );
	}

	const api = {
		log,
		url: null,
		port: null,
		count( p, since = 0 ) { return log.filter( e => e.path === p && e.when >= since && e.status < 400 ).length; },
		failed( p ) { return log.filter( e => e.path === p && e.status >= 400 ); },
		failPaths( paths ) {
			failPaths.clear();
			for ( const p of paths ) {
				failPaths.add( p );
			}
		},
		delay( p, ms ) { delay[ p ] = ms; },
		clearLog() { log.length = 0; },
		async start() {
			if ( server ) {
				return api;
			}
			truePort = truePort || await freePort();
			server = http.createServer( handle );
			await new Promise( ( resolve, reject ) => {
				server.once( "error", reject );
				server.listen( truePort, "127.0.0.1", resolve );
			} );
			api.port = truePort;
			api.url = `http://127.0.0.1:${ truePort }`;
			return api;
		},
		async stop() {
			if ( !server ) {
				return;
			}
			const s = server;

			server = null;
			await new Promise( resolve => {
				s.close( resolve );
				s.closeAllConnections?.();
			} );
		},
		async close() {
			await api.stop();
		},
	};

	return api;
}
