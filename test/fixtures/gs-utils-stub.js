"use strict";

// Browser fixture standing in for the gs-utils bundle (a git submodule that
// is not vendored in this repository). It implements only the surface used
// by src/run.js, with the same semantics:
//   - `$( ... )` wraps matches in a chainable collection,
//   - every collection method is a no-op when nothing matched,
//   - `$disabled( true/false )` adds/removes the attribute,
//   - `$onclick( fn )` assigns the DOM `onclick` handler (single handler),
//   - `GSUsetTimeout( fn, sec )` runs `fn` immediately when `sec <= 0`.
// Keep those semantics when editing src/run.js; test/browser tests rely on
// them only through observable DOM state.

(() => {
	const NULL = {
		$query: () => NULL,
		$addAttr: () => NULL,
		$rmAttr: () => NULL,
		$disabled: () => NULL,
		$onclick: () => NULL,
		$css: () => NULL,
		$text: () => NULL,
		$each: () => NULL,
		$remove: () => NULL,
		$getAttr: () => null,
	};

	function wrap( elements ) {
		const coll = {
			$each( fn ) { elements.forEach( fn ); return coll; },
			$query( sel ) {
				const found = elements.flatMap( el => [ ...el.querySelectorAll( sel ) ] );
				return found.length ? wrap( found ) : NULL;
			},
			$addAttr( ...names ) {
				return coll.$each( el => names.forEach( n => el.setAttribute( n, "" ) ) );
			},
			$rmAttr( ...names ) {
				return coll.$each( el => names.forEach( n => el.removeAttribute( n ) ) );
			},
			$getAttr( k ) { return elements[ 0 ] ? elements[ 0 ].getAttribute( k ) : null; },
			$disabled( b ) {
				return coll.$each( el => {
					if ( b === false || b === null || b === undefined ) {
						el.removeAttribute( "disabled" );
					} else {
						el.setAttribute( "disabled", "" );
					}
				} );
			},
			$onclick( fn ) { return coll.$each( el => el.onclick = fn ); },
			$css( prop, val ) {
				return val === undefined
					? ( elements[ 0 ] && getComputedStyle( elements[ 0 ] )[ prop ] ) || ""
					: coll.$each( el => el.style.setProperty( prop, val ) );
			},
			$text( v ) { return coll.$each( el => el.textContent = v ); },
			$remove() { return coll.$each( el => el.remove() ); },
		};

		return coll;
	}

	window.$ = a => {
		if ( a instanceof Element ) {
			return wrap( [ a ] );
		}
		if ( typeof a === "string" && a.startsWith( "<" ) ) {
			const tag = a.slice( 1 ).replace( /[ >].*$/, "" );

			return wrap( [ document.createElement( tag ) ] );
		}
		const found = [ ...document.querySelectorAll( a ) ];

		return found.length ? wrap( found ) : NULL;
	};
	window.$head = $( document.head );
	window.$body = $( document.body );

	window.GSUonFirefox = navigator.userAgent.includes( "Firefox" );
	window.GSUsetTimeout = ( fn, sec ) => {
		const ms = sec * 1000 | 0;

		if ( ms > 0 ) {
			return setTimeout( fn, ms );
			}
		fn();
		return null;
	};
})();
