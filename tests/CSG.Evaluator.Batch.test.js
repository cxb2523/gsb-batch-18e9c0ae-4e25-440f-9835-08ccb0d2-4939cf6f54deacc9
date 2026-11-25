import {
	ADDITION,
	Brush,
	DIFFERENCE,
	Evaluator,
	HOLLOW_INTERSECTION,
	INTERSECTION,
	Operation,
	SUBTRACTION,
	computeMeshVolume,
} from '../src';
import { BoxGeometry, BufferAttribute, Material, SphereGeometry } from 'three';

// create a box brush with controllable attribute set and TypedArray type
function makeBrush( { uv = true, uvType = Float32Array, offset = false } = {} ) {

	const geo = new BoxGeometry();
	if ( ! uv ) {

		geo.deleteAttribute( 'uv' );

	} else if ( uvType !== Float32Array ) {

		const len = geo.attributes.uv.array.length;
		geo.setAttribute( 'uv', new BufferAttribute( new uvType( len ), 2, true ) );

	}

	const brush = new Brush( geo );
	if ( offset ) {

		brush.position.set( 0.4, 0.4, 0.4 );

	}

	brush.updateMatrixWorld();
	return brush;

}

// verify every group references an in-range material and covers a valid index range
function expectGroupsAndMaterialsAligned( brush ) {

	const { geometry, material } = brush;
	const materials = Array.isArray( material ) ? material : [ material ];
	expect( materials.every( m => m ) ).toBe( true );

	let expectedStart = 0;
	for ( const group of geometry.groups ) {

		expect( group.start ).toBe( expectedStart );
		expect( group.count ).toBeGreaterThan( 0 );
		expect( group.materialIndex ).toBeGreaterThanOrEqual( 0 );
		expect( group.materialIndex ).toBeLessThan( materials.length );
		expectedStart += group.count;

	}

	expect( expectedStart ).toBe( geometry.drawRange.count );
	expect( expectedStart ).toBeLessThanOrEqual( geometry.index.count );

}

describe( 'Evaluator batch evaluation', () => {

	it( 'should produce multiple independent targets in a single call with correct volumes.', () => {

		const evaluator = new Evaluator();
		const a = makeBrush();
		const b = makeBrush( { offset: true } );

		const result1 = new Brush();
		const result2 = new Brush();
		const results = evaluator.evaluate(
			a,
			b,
			[ SUBTRACTION, INTERSECTION ],
			[ result1, result2 ],
		);

		expect( results ).toHaveLength( 2 );
		expect( results[ 0 ] ).toBe( result1 );
		expect( results[ 1 ] ).toBe( result2 );

		// subtraction and intersection partition the first brush volume
		const vol1 = computeMeshVolume( result1 );
		const vol2 = computeMeshVolume( result2 );
		expect( vol1 ).toBeGreaterThan( 0 );
		expect( vol2 ).toBeGreaterThan( 0 );
		expect( vol1 + vol2 ).toBeCloseTo( computeMeshVolume( a ), 7 );

		expectGroupsAndMaterialsAligned( result1 );
		expectGroupsAndMaterialsAligned( result2 );

	} );

	it( 'should keep a single operation and single target return value behavior.', () => {

		const evaluator = new Evaluator();
		const a = makeBrush();
		const b = makeBrush( { offset: true } );
		const target = new Brush();

		const result = evaluator.evaluate( a, b, SUBTRACTION, target );
		expect( result ).toBe( target );
		expect( Array.isArray( result ) ).toBe( false );
		expect( computeMeshVolume( result ) ).toBeGreaterThan( 0 );

		// default target argument still works
		const defaultResult = evaluator.evaluate( a, b, SUBTRACTION );
		expect( defaultResult ).toBeInstanceOf( Brush );
		expect( computeMeshVolume( defaultResult ) ).toBeGreaterThan( 0 );

	} );

	it( 'should produce different attribute sets per target without cross contamination.', () => {

		const evaluator = new Evaluator();
		const a = makeBrush();
		const b = makeBrush( { offset: true } );

		// the second target only has position and normal geometry (no uv) so it must not
		// receive a uv attribute even though the first target does
		const target2Geo = new BoxGeometry();
		target2Geo.deleteAttribute( 'uv' );

		const result1 = new Brush();
		const result2 = new Brush( target2Geo );

		evaluator.evaluate(
			a,
			b,
			[ SUBTRACTION, INTERSECTION ],
			[ result1, result2 ],
		);

		expect( Object.keys( result1.geometry.attributes ).sort() )
			.toEqual( [ 'normal', 'position', 'uv' ] );
		expect( Object.keys( result2.geometry.attributes ).sort() )
			.toEqual( [ 'normal', 'position' ] );
		expect( result2.geometry.attributes.uv ).toBeFalsy();

		// both results still have to form valid, non-empty meshes
		expect( computeMeshVolume( result1 ) ).toBeGreaterThan( 0 );
		expect( computeMeshVolume( result2 ) ).toBeGreaterThan( 0 );

	} );

	it( 'should honor per-target TypedArray attribute types in the same batch.', () => {

		const evaluator = new Evaluator();
		const a = makeBrush();
		const b = makeBrush( { offset: true } );

		const result1 = new Brush();

		const result2Geo = new BoxGeometry();
		result2Geo.setAttribute(
			'uv',
			new BufferAttribute( new Uint8Array( result2Geo.attributes.uv.array.length ), 2, true ),
		);
		const result2 = new Brush( result2Geo );

		evaluator.evaluate(
			a,
			b,
			[ SUBTRACTION, INTERSECTION ],
			[ result1, result2 ],
		);

		expect( result1.geometry.attributes.uv.array.constructor ).toBe( Float32Array );
		expect( result2.geometry.attributes.uv.array.constructor ).toBe( Uint8Array );
		expect( result2.geometry.attributes.uv.normalized ).toBe( true );
		expect( result1.geometry.attributes.position.array.constructor )
			.toBe( result2.geometry.attributes.position.array.constructor );

	} );

	it( 'should not retain stale attribute keys when reusing the evaluator across calls.', () => {

		const evaluator = new Evaluator();

		// first call generates the full default attribute set for three targets
		const a1 = makeBrush();
		const b1 = makeBrush( { offset: true } );
		evaluator.evaluate(
			a1,
			b1,
			[ SUBTRACTION, INTERSECTION, ADDITION ],
			[ new Brush(), new Brush(), new Brush() ],
		);
		expect( evaluator.geometryBuilders.length ).toBe( 3 );

		// second call is a single target on geometry without uv and a narrowed attribute list
		evaluator.attributes = [ 'position', 'normal' ];
		const a2 = makeBrush( { uv: false } );
		const b2 = makeBrush( { uv: false, offset: true } );
		const target = new Brush();

		expect( () => evaluator.evaluate( a2, b2, SUBTRACTION, target ) ).not.toThrow();
		expect( Object.keys( target.geometry.attributes ).sort() )
			.toEqual( [ 'normal', 'position' ] );
		expect( target.geometry.attributes.uv ).toBeFalsy();
		expect( computeMeshVolume( target ) ).toBeGreaterThan( 0 );

		// the dormant builders from the larger batch must not participate in the later
		// operation so their buffers remain cleared rather than containing stale data
		for ( let i = 1; i < evaluator.geometryBuilders.length; i ++ ) {

			const builder = evaluator.geometryBuilders[ i ];
			for ( const key in builder.attributeData ) {

				expect( builder.attributeData[ key ].length ).toBe( 0 );

			}

			builder.groupIndices.forEach( groupData => {

				expect( groupData.length ).toBe( 0 );

			} );

		}

		// widening the attribute set again restores uv output
		evaluator.attributes = [ 'position', 'uv', 'normal' ];
		const a3 = makeBrush();
		const b3 = makeBrush( { offset: true } );
		const target3 = evaluator.evaluate( a3, b3, SUBTRACTION );
		expect( target3.geometry.attributes.uv ).toBeTruthy();

	} );

	it( 'should not retain stale groups or material mappings between consecutive calls.', () => {

		const evaluator = new Evaluator();
		const a = makeBrush();
		const b = makeBrush( { offset: true } );

		// groups + materials on
		const r1 = evaluator.evaluate( a, b, SUBTRACTION );
		expectGroupsAndMaterialsAligned( r1 );
		expect( Array.isArray( r1.material ) ).toBe( true );

		// groups off on the reused evaluator
		evaluator.useGroups = false;
		const r2 = evaluator.evaluate( a, b, SUBTRACTION );
		expect( r2.geometry.groups ).toHaveLength( 1 );
		expect( Array.isArray( r2.material ) ).toBe( false );
		expectGroupsAndMaterialsAligned( r2 );

		// groups back on must restore the grouped result without leftover single-group state
		evaluator.useGroups = true;
		const r3 = evaluator.evaluate( a, b, SUBTRACTION );
		expect( r3.geometry.groups.length ).toBe( r3.material.length );
		expect( r3.geometry.groups.length ).toBeGreaterThan( 1 );
		expectGroupsAndMaterialsAligned( r3 );

	} );

	it( 'should align groups and materials for every target across the option combinations.', () => {

		const optionCombinations = [
			{ useGroups: true, consolidateGroups: true, removeUnusedMaterials: true },
			{ useGroups: true, consolidateGroups: false, removeUnusedMaterials: true },
			{ useGroups: true, consolidateGroups: true, removeUnusedMaterials: false },
			{ useGroups: false, consolidateGroups: true, removeUnusedMaterials: true },
			{ useGroups: false, consolidateGroups: false, removeUnusedMaterials: false },
		];

		for ( const options of optionCombinations ) {

			const evaluator = new Evaluator();
			Object.assign( evaluator, options );

			const a = makeBrush();
			const b = makeBrush( { offset: true } );
			const results = evaluator.evaluate(
				a,
				b,
				[ SUBTRACTION, DIFFERENCE ],
				[ new Brush(), new Brush() ],
			);

			for ( const result of results ) {

				expect( Array.isArray( result.material ) ).toBe( options.useGroups );
				expectGroupsAndMaterialsAligned( result );

			}

		}

	} );

	it( 'should handle operations that append no triangles to some builders.', () => {

		const evaluator = new Evaluator();
		const a = makeBrush();
		const b = makeBrush( { offset: true } );

		// hollow intersection skips the second geometry pass so its builder has fewer
		// group slots than the shared group order
		const result1 = new Brush();
		const result2 = new Brush();
		expect( () => {

			evaluator.evaluate(
				a,
				b,
				[ SUBTRACTION, HOLLOW_INTERSECTION ],
				[ result1, result2 ],
			);

		} ).not.toThrow();

		expectGroupsAndMaterialsAligned( result1 );
		expectGroupsAndMaterialsAligned( result2 );
		expect( computeMeshVolume( result2 ) ).toBeGreaterThan( 0 );

	} );

	it( 'should keep reusing existing target buffers when the attribute type matches.', () => {

		const evaluator = new Evaluator();
		const a = makeBrush();
		const b = makeBrush( { offset: true } );

		const target = new Brush();
		evaluator.evaluate( a, b, SUBTRACTION, target );

		const positionAttribute = target.geometry.attributes.position;
		const index = target.geometry.index;
		evaluator.evaluate( a, b, SUBTRACTION, target );

		// the buffers are large enough and of the same type so they must be reused rather
		// than reallocated on every call
		expect( target.geometry.attributes.position ).toBe( positionAttribute );
		expect( target.geometry.index ).toBe( index );
		expectGroupsAndMaterialsAligned( target );

	} );

	it( 'evaluateHierarchy should still produce a valid result.', () => {

		const root = new Operation( new BoxGeometry( 2, 2, 2 ) );
		root.updateMatrixWorld( true );

		const cut = new Operation( new SphereGeometry( 0.75, 32, 16 ) );
		cut.operation = SUBTRACTION;
		root.add( cut );

		const add = new Operation( new BoxGeometry( 1, 1, 1 ) );
		add.operation = ADDITION;
		add.position.set( 1.2, 0, 0 );
		add.updateMatrixWorld( true );
		root.add( add );

		const evaluator = new Evaluator();
		const target = new Brush();
		const result = evaluator.evaluateHierarchy( root, target );

		expect( result ).toBe( target );
		expect( result.geometry.attributes.position ).toBeTruthy();
		expect( result.geometry.index.count ).toBeGreaterThan( 0 );
		expect( computeMeshVolume( result ) ).toBeGreaterThan( 0 );

	} );

	it( 'should assign distinct material instances to groups from the two input brushes.', () => {

		const evaluator = new Evaluator();
		evaluator.consolidateGroups = false;
		evaluator.removeUnusedMaterials = false;

		const a = makeBrush();
		const b = makeBrush( { offset: true } );
		a.material = new Material();
		b.material = new Material();

		const results = evaluator.evaluate(
			a,
			b,
			[ SUBTRACTION, INTERSECTION ],
			[ new Brush(), new Brush() ],
		);

		for ( const result of results ) {

			expectGroupsAndMaterialsAligned( result );
			// both input brushes contribute six material slots each and unused materials
			// are retained because removeUnusedMaterials is false
			expect( result.material ).toHaveLength( 12 );
			// empty groups are dropped so the group count is at most the material count
			expect( result.geometry.groups.length ).toBeLessThanOrEqual( result.material.length );
			expect( result.geometry.groups.length ).toBeGreaterThan( 0 );

		}

	} );

} );
