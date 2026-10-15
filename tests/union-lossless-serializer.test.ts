import { describe, it, expect } from 'vitest';
import
{
    SerializationError,
    checkPlainObject,
    createSerializerProbeContext,
    runWithSerializerProbeContext,
    hasSerializerUnionProbe,
    recordSerializerObjectStats,
    serializeUnion,
    serializeQueryUnion
}
    from '../src/runtime/serializer-runtime.js';
import { emitAndImport } from './helpers/compile.js';

describe( 'Lossless Union Serialization (U2)', () =>
{
    describe( 'Runtime Probe Helpers (serializeUnion & serializeQueryUnion)', () =>
    {
        it( 'fast-paths when probeBestFit is false or omitted and rolls back outer probe on inner arm failure', () =>
        {
            // Arrange
            let calls = 0;
            checkPlainObject({ a : 1 });
            expect(() => checkPlainObject( new Date(), 'root' )).toThrow( 'Serialization error at "root": Type<Object>' );

            // Act
            const res = serializeUnion(
                { a : 'x' },
                '',
                'Type<Union>',
                [
                    () =>
                    {
                        calls++;
                        recordSerializerObjectStats( 3, 1 );

                        return '{"a":"x"}';
                    },
                    () =>
                    {
                        calls++;

                        return '{"a":"x","b":1}';
                    }
                ],
                false
            );

            // Inner non-probed union inside outer probed union rolls back failed arm stats
            const outerJson = serializeUnion(
                {},
                '',
                'Type<Outer>',
                [
                    () => serializeUnion(
                        {},
                        'inner',
                        'Type<Inner>',
                        [
                            () =>
                            {
                                recordSerializerObjectStats( 5, 5 );
                                throw new SerializationError( 'inner', 'Type<string>' );
                            },
                            () =>
                            {
                                recordSerializerObjectStats( 0, 2 );

                                return '{"ok":1}';
                            }
                        ],
                        false
                    ),
                    () => '{"fallback":2}'
                ],
                true,
                [ false, false ]
            );

            const qParams: string[] = [];
            serializeQueryUnion(
                qParams,
                '',
                'Type<Outer>',
                [
                    () => serializeQueryUnion(
                        qParams,
                        'inner',
                        'Type<Inner>',
                        [
                            () =>
                            {
                                recordSerializerObjectStats( 5, 5 );
                                throw new SerializationError( 'inner', 'Type<string>' );
                            },
                            () =>
                            {
                                recordSerializerObjectStats( 0, 2 );
                                qParams.push( 'ok=1' );
                            }
                        ],
                        false
                    ),
                    () =>
                    {
                        qParams.push( 'fallback=2' );
                    }
                ],
                true,
                [ false, false ]
            );

            // Assert
            expect( res ).toBe( '{"a":"x"}' );
            expect( outerJson ).toBe( '{"ok":1}' );
            expect( qParams ).toEqual([ 'ok=1' ]);
            expect( calls ).toBe( 1 );
            expect( hasSerializerUnionProbe()).toBe( false );
        });

        it( 'short-circuits immediately on strippedCount === 0 for non-fallback arm (R7)', () =>
        {
            // Arrange
            let secondArmCalled = false;

            // Act
            const res = serializeUnion(
                { a : 'x' },
                '',
                'Type<Union>',
                [
                    () =>
                    {
                        expect( hasSerializerUnionProbe()).toBe( true );
                        recordSerializerObjectStats( 0, 1 );

                        return '{"a":"x"}';
                    },
                    () =>
                    {
                        secondArmCalled = true;
                        recordSerializerObjectStats( 0, 2 );

                        return '{"a":"x","b":1}';
                    }
                ],
                true,
                [ false, false ]
            );

            // Assert
            expect( res ).toBe( '{"a":"x"}' );
            expect( secondArmCalled ).toBe( false );
            expect( hasSerializerUnionProbe()).toBe( false );
        });

        it( 'probes remaining arms when strippedCount > 0 and picks min stripped, then max matched (R8)', () =>
        {
            // Arrange
            const arms = [
                () =>
                {
                    recordSerializerObjectStats( 2, 1 );

                    return '{"arm":1}';
                },
                () =>
                {
                    recordSerializerObjectStats( 1, 1 );

                    return '{"arm":2}';
                },
                () =>
                {
                    recordSerializerObjectStats( 1, 3 );

                    return '{"arm":3}';
                }
            ];

            // Act
            const res = serializeUnion({}, '', 'Type<Union>', arms, true, [ false, false, false ]);

            // Assert
            expect( res ).toBe( '{"arm":3}' );
        });

        it( 'treats fallback arms as last resort in strip mode (R9, AE5)', () =>
        {
            // Arrange
            const armsWithStructuredMatch = [
                () =>
                {
                    recordSerializerObjectStats( 1, 1 );

                    return '{"foo":"hello"}';
                },
                () => '{"foo":"hello","extra":123}'
            ];

            const armsOnlyFallbackMatches = [
                () =>
                {
                    throw new SerializationError( 'foo', 'Type<string>' );
                },
                () => '{"bar":123}'
            ];

            // Act
            const structuredRes = serializeUnion(
                { foo : 'hello', extra : 123 },
                '',
                'Type<Union>',
                armsWithStructuredMatch,
                true,
                [ false, true ]
            );
            const fallbackRes = serializeUnion(
                { bar : 123 },
                '',
                'Type<Union>',
                armsOnlyFallbackMatches,
                true,
                [ false, true ]
            );

            // Assert
            expect( structuredRes ).toBe( '{"foo":"hello"}' );
            expect( fallbackRes ).toBe( '{"bar":123}' );

            // Multiple fallback arms keep first fallback; error branches in probeBestFit mode
            const multiFallbackRes = serializeUnion(
                { bar : 123 },
                '',
                'Type<Union>',
                [
                    () => { throw new SerializationError( 'foo', 'Type<string>' ) },
                    () => '{"fallback":1}',
                    () => '{"fallback":2}'
                ],
                true,
                [ false, true, true ]
            );
            expect( multiFallbackRes ).toBe( '{"fallback":1}' );

            expect(() => serializeUnion(
                {},
                'root',
                'Type<Union>',
                [
                    () => { throw new SerializationError( 'root.a', 'Type<string>' ) }
                ],
                true,
                [ false ]
            )).toThrow( 'Serialization error at "root": Type<Union>' );

            expect(() => serializeUnion(
                {},
                'root',
                'Type<Union>',
                [
                    () => { throw new SerializationError( 'root', 'Type<Union>' ) }
                ],
                true,
                [ false ]
            )).toThrow( 'Serialization error at "root": Type<Union>' );

            expect(() => serializeUnion(
                {},
                'root',
                'Type<Union>',
                [
                    () => { throw new TypeError( 'boom' ) }
                ],
                true,
                [ false ]
            )).toThrow( TypeError );
        });

        it( 'propagates winning arm stats to parent union probe on nested unions (AE4)', () =>
        {
            // Arrange & Act
            const outerSelected = serializeUnion(
                {},
                '',
                'Type<Outer>',
                [
                    () =>
                    {
                        recordSerializerObjectStats( 0, 1 );
                        const inner = serializeUnion(
                            {},
                            'child',
                            'Type<Inner>',
                            [
                                () =>
                                {
                                    recordSerializerObjectStats( 3, 1 );

                                    return '{"inner":1}';
                                },
                                () =>
                                {
                                    recordSerializerObjectStats( 1, 2 );

                                    return '{"inner":2}';
                                }
                            ],
                            true,
                            [ false, false ]
                        );

                        return `{"outer":1,"child":${inner}}`;
                    },
                    () =>
                    {
                        recordSerializerObjectStats( 0, 2 );

                        return '{"outer":2}';
                    }
                ],
                true,
                [ false, false ]
            );

            // Assert
            expect( outerSelected ).toBe( '{"outer":2}' );
        });

        it( 'handles query union best-fit selection, fallback arms, and rollback on failure', () =>
        {
            // Arrange
            const params1: string[] = [];
            const paramsBest: string[] = [];
            const params2: string[] = [];
            const params3: string[] = [];

            // Act 1: short-circuit on stripped === 0
            serializeQueryUnion(
                params1,
                '',
                'Type<QueryUnion>',
                [
                    () =>
                    {
                        params1.push( 'a=1' );
                        recordSerializerObjectStats( 2, 1 );
                    },
                    () =>
                    {
                        params1.push( 'a=1', 'b=2' );
                        recordSerializerObjectStats( 0, 2 );
                    }
                ],
                true,
                [ false, false ]
            );

            // Act 2: bestParams when all valid arms have stripped > 0 (including tie-breaker)
            serializeQueryUnion(
                paramsBest,
                '',
                'Type<QueryUnion>',
                [
                    () =>
                    {
                        paramsBest.push( 'arm=1' );
                        recordSerializerObjectStats( 2, 1 );
                    },
                    () =>
                    {
                        paramsBest.push( 'arm=2' );
                        recordSerializerObjectStats( 1, 1 );
                    },
                    () =>
                    {
                        paramsBest.push( 'arm=3' );
                        recordSerializerObjectStats( 1, 3 );
                    },
                    () =>
                    {
                        paramsBest.push( 'arm=4' );
                        recordSerializerObjectStats( 1, 2 );
                    }
                ],
                true,
                [ false, false, false, false ]
            );

            // Act 3: fallback arms (multiple fallbacks keep first)
            serializeQueryUnion(
                params2,
                '',
                'Type<QueryUnion>',
                [
                    () =>
                    {
                        params2.push( 'dirty=1' );
                        throw new SerializationError( 'a', 'Type<string>' );
                    },
                    () =>
                    {
                        params2.push( 'fallback=1' );
                    },
                    () =>
                    {
                        params2.push( 'fallback=2' );
                    }
                ],
                true,
                [ false, true, true ]
            );

            // Assert
            expect( params1 ).toEqual([ 'a=1', 'b=2' ]);
            expect( paramsBest ).toEqual([ 'arm=3' ]);
            expect( params2 ).toEqual([ 'fallback=1' ]);
            expect(() => serializeQueryUnion(
                params3,
                'root',
                'Type<QueryUnion>',
                [
                    () =>
                    {
                        throw new SerializationError( 'root', 'Type<string>' );
                    }
                ],
                true,
                [ false ]
            )).toThrow( SerializationError );

            expect(() => serializeQueryUnion(
                [],
                'root',
                'Type<QueryUnion>',
                [
                    () =>
                    {
                        throw new SerializationError( 'root', 'Type<QueryUnion>' );
                    }
                ],
                true,
                [ false ]
            )).toThrow( 'Serialization error at "root": Type<QueryUnion>' );

            // Fast-path (probeBestFit = false) + error branches
            const fastParams: string[] = [];
            serializeQueryUnion(
                fastParams,
                '',
                'Type<QueryUnion>',
                [
                    () =>
                    {
                        fastParams.push( 'dirty=1' );
                        throw new SerializationError( 'a', 'Type<string>' );
                    },
                    () =>
                    {
                        fastParams.push( 'clean=2' );
                    }
                ],
                false
            );
            expect( fastParams ).toEqual([ 'clean=2' ]);

            expect(() => serializeQueryUnion(
                [],
                'root',
                'Type<QueryUnion>',
                [
                    () => { throw new SerializationError( 'root', 'Type<QueryUnion>' ) }
                ],
                false
            )).toThrow( 'Serialization error at "root": Type<QueryUnion>' );

            expect(() => serializeQueryUnion(
                [],
                'root',
                'Type<QueryUnion>',
                [
                    () => { throw new SerializationError( 'root.a', 'Type<string>' ) }
                ],
                false
            )).toThrow( 'Serialization error at "root": Type<QueryUnion>' );

            expect(() => serializeQueryUnion(
                [],
                'root',
                'Type<QueryUnion>',
                [
                    () => { throw new TypeError( 'boom' ) }
                ],
                false
            )).toThrow( TypeError );

            expect(() => serializeQueryUnion(
                [],
                'root',
                'Type<QueryUnion>',
                [
                    () => { throw new TypeError( 'boom' ) }
                ],
                true,
                [ false ]
            )).toThrow( TypeError );
        });
    });

    describe( 'End-to-End JSON and Query Serialization (AE1 - AE5)', () =>
    {
        it( 'preserves widest subtype arm in A | B | C (AE1) and handles disjoint extra keys (AE3)', async() =>
        {
            // Arrange
            const mod = await emitAndImport<{
                serJson        : ( v: any ) => string
                serJsonStrict  : ( v: any ) => string
                serQuery       : ( v: any ) => string
                serDisjoint    : ( v: any ) => string
                serDisjointQry : ( v: any ) => string
            }>( `
                import { stringify } from '../src/index.js';
                type A = { foo: string };
                type B = { bar: number };
                type C = { foo: string; bar: number };
                type Result = A | B | C;

                type Arm1 = { a: string; b: number };
                type Arm2 = { c: boolean };
                type Disjoint = Arm1 | Arm2;

                export const serJson = ( v: Result ) => stringify<Result>( v );
                export const serJsonStrict = ( v: Result ) => stringify<Result>( v, 'strict' );
                export const serQuery = ( v: Result ) => stringify<Result>( v, { format: 'query' } );
                export const serDisjoint = ( v: Disjoint ) => stringify<Disjoint>( v );
                export const serDisjointQry = ( v: Disjoint ) => stringify<Disjoint>( v, { format: 'query' } );
            `, 'temp_u2_ae1_ae3' );

            // Act & Assert — AE1
            expect( JSON.parse( mod.serJson({ foo : 'hi', bar : 42 }))).toEqual({ foo : 'hi', bar : 42 });
            expect( JSON.parse( mod.serJsonStrict({ foo : 'hi', bar : 42 }))).toEqual({ foo : 'hi', bar : 42 });
            expect(() => mod.serJsonStrict({ foo : 'hi', bar : 42, extra : true } as any )).toThrow( /Type<Result>/ );

            const qParams = new URLSearchParams( mod.serQuery({ foo : 'hi', bar : 42 }));
            expect( qParams.get( 'foo' )).toBe( 'hi' );
            expect( qParams.get( 'bar' )).toBe( '42' );

            // Act & Assert — AE3: { c: true, extra1: 1, extra2: 2 } matches Arm2 with 2 stripped keys,
            // while { a: 'x', b: 1, c: true, extra1: 1, extra2: 2 } matches Arm1 (3 stripped, 2 matched) vs Arm2 (4 stripped, 1 matched) -> Arm1 wins!
            expect( JSON.parse( mod.serDisjoint({ a : 'x', b : 1, c : true, extra1 : 1, extra2 : 2 } as any )))
                .toEqual({ a : 'x', b : 1 });

            const dParams = new URLSearchParams( mod.serDisjointQry({ a : 'x', b : 1, c : true, extra1 : 1, extra2 : 2 } as any ));
            expect( dParams.get( 'a' )).toBe( 'x' );
            expect( dParams.get( 'b' )).toBe( '1' );
            expect( dParams.has( 'c' )).toBe( false );
        });

        it( 'prevents optional-heavy arms from shadowing required properties and recovers when optional properties are present (AE2)', async() =>
        {
            // Arrange
            const mod = await emitAndImport<{
                ser      : ( v: any ) => string
                serQuery : ( v: any ) => string
            }>( `
                import { stringify } from '../src/index.js';
                type OptHeavy = { a: string; b?: number; c?: boolean };
                type ReqPair = { a: string; d: string };
                type U = OptHeavy | ReqPair;
                export const ser = ( v: U ) => stringify<U>( v );
                export const serQuery = ( v: U ) => stringify<U>( v, { format: 'query' } );
            `, 'temp_u2_ae2' );

            // Act & Assert
            // 1. Input { a: 'x', d: 'y' }: ReqPair ranked first at compile time and has 0 stripped keys -> short-circuits!
            expect( JSON.parse( mod.ser({ a : 'x', d : 'y' }))).toEqual({ a : 'x', d : 'y' });
            const q1 = new URLSearchParams( mod.serQuery({ a : 'x', d : 'y' }));
            expect( q1.get( 'a' )).toBe( 'x' );
            expect( q1.get( 'd' )).toBe( 'y' );

            // 2. Input { a: 'x', b: 1, c: true }: ReqPair fails (missing d), OptHeavy succeeds with 0 stripped keys!
            expect( JSON.parse( mod.ser({ a : 'x', b : 1, c : true }))).toEqual({ a : 'x', b : 1, c : true });
            const q2 = new URLSearchParams( mod.serQuery({ a : 'x', b : 1, c : true }));
            expect( q2.get( 'a' )).toBe( 'x' );
            expect( q2.get( 'b' )).toBe( '1' );
            expect( q2.get( 'c' )).toBe( 'true' );

            // 3. Input { a: 'x', b: 1, c: true, d: 'y' }: ReqPair strips 2 keys (b, c), OptHeavy strips 1 key (d) -> OptHeavy wins!
            expect( JSON.parse( mod.ser({ a : 'x', b : 1, c : true, d : 'y' } as any )))
                .toEqual({ a : 'x', b : 1, c : true });
            const q3 = new URLSearchParams( mod.serQuery({ a : 'x', b : 1, c : true, d : 'y' } as any ));
            expect( q3.get( 'a' )).toBe( 'x' );
            expect( q3.get( 'b' )).toBe( '1' );
            expect( q3.get( 'c' )).toBe( 'true' );
            expect( q3.has( 'd' )).toBe( false );
        });

        it( 'resolves nested unions with wide vs thin arms without data loss (AE4)', async() =>
        {
            // Arrange
            const mod = await emitAndImport<{
                ser      : ( v: any ) => string
                serQuery : ( v: any ) => string
            }>( `
                import { stringify } from '../src/index.js';
                type Thin = { k1: string };
                type Wide = { k1: string; k2: string; k3: string; k4: string };
                type Parent1 = { child: Thin | Wide };
                type Parent2 = { child: { k1: string; k2: string } };
                type Root = Parent1 | Parent2;
                export const ser = ( v: Root ) => stringify<Root>( v );
                export const serQuery = ( v: Root ) => stringify<Root>( v, { format: 'query' } );
            `, 'temp_u2_ae4' );

            // Act & Assert
            // Input with k1..k4 matches Parent1 -> Wide with 0 stripped keys (whereas Parent2 strips k3, k4)
            const wideInput = { child : { k1 : 'a', k2 : 'b', k3 : 'c', k4 : 'd' } };
            expect( JSON.parse( mod.ser( wideInput ))).toEqual( wideInput );
            const qWide = new URLSearchParams( mod.serQuery( wideInput ));
            expect( qWide.get( 'child[k1]' )).toBe( 'a' );
            expect( qWide.get( 'child[k2]' )).toBe( 'b' );
            expect( qWide.get( 'child[k3]' )).toBe( 'c' );
            expect( qWide.get( 'child[k4]' )).toBe( 'd' );

            // Input with k1, k2 matches Parent2 with 0 stripped keys (short-circuits immediately!)
            const pairInput = { child : { k1 : 'a', k2 : 'b' } };
            expect( JSON.parse( mod.ser( pairInput ))).toEqual( pairInput );
            const qPair = new URLSearchParams( mod.serQuery( pairInput ));
            expect( qPair.get( 'child[k1]' )).toBe( 'a' );
            expect( qPair.get( 'child[k2]' )).toBe( 'b' );
            expect( qPair.has( 'child[k3]' )).toBe( false );
        });

        it( 'treats bare object in A | object as last-resort fallback while preserving Date serialization on A (AE5)', async() =>
        {
            // Arrange
            const mod = await emitAndImport<{
                serJson    : ( v: any ) => string
                serRelaxed : ( v: any ) => string
                serQuery   : ( v: any ) => string
            }>( `
                import { stringify } from '../src/index.js';
                type A = { foo: string; createdAt?: Date };
                type Result = A | object;
                export const serJson = ( v: Result ) => stringify<Result>( v );
                export const serRelaxed = ( v: Result ) => stringify<Result>( v, 'relaxed' );
                export const serQuery = ( v: Result ) => stringify<Result>( v, { format: 'query' } );
            `, 'temp_u2_ae5' );

            // Act & Assert
            const d = new Date( '2026-05-01T12:00:00.000Z' );

            // In strip mode, { foo: 'hi', createdAt: d, extra: 1 } matches A (strips extra, serializes Date) rather than falling back to bare object
            expect( JSON.parse( mod.serJson({ foo : 'hi', createdAt : d, extra : 1 } as any )))
                .toEqual({ foo : 'hi', createdAt : '2026-05-01T12:00:00.000Z' });

            // In strip mode, { bar: 123 } fails A and falls back to bare object
            expect( JSON.parse( mod.serJson({ bar : 123 }))).toEqual({ bar : 123 });

            // In relaxed mode, { foo: 'hi', extra: 1 } matches A first and retains extra
            expect( JSON.parse( mod.serRelaxed({ foo : 'hi', extra : 1 } as any )))
                .toEqual({ foo : 'hi', extra : 1 });

            // In query strip mode, { foo: 'hi', extra: 1 } matches A and strips extra
            const qParams = new URLSearchParams( mod.serQuery({ foo : 'hi', extra : 1 } as any ));
            expect( qParams.get( 'foo' )).toBe( 'hi' );
            expect( qParams.has( 'extra' )).toBe( false );
        });

        it( 'handles competing unions with index signatures, Record<string, number>, and empty {} arms in strip mode (#12)', async() =>
        {
            // Arrange
            const mod = await emitAndImport<{
                serIdx        : ( v: any ) => string
                serIdxQuery   : ( v: any ) => string
                serMixed      : ( v: any ) => string
                serMixedQuery : ( v: any ) => string
                serEmpty      : ( v: any ) => string
                serEmptyQuery : ( v: any ) => string
            }>( `
                import { stringify } from '../src/index.js';
                type WithIndex = { fixed: string } | { fixed: string; [k: string]: string };
                type Mixed = { fixed: string; [k: string]: string } | Record<string, number> | {};
                type EmptyVsNamed = { a: string } | {};

                export const serIdx = ( v: WithIndex ) => stringify<WithIndex>( v );
                export const serIdxQuery = ( v: WithIndex ) => stringify<WithIndex>( v, { format: 'query' } );
                export const serMixed = ( v: Mixed ) => stringify<Mixed>( v );
                export const serMixedQuery = ( v: Mixed ) => stringify<Mixed>( v, { format: 'query' } );
                export const serEmpty = ( v: EmptyVsNamed ) => stringify<EmptyVsNamed>( v );
                export const serEmptyQuery = ( v: EmptyVsNamed ) => stringify<EmptyVsNamed>( v, { format: 'query' } );
            `, 'temp_u2_index_and_empty' );

            // Act & Assert — { fixed: string } | { fixed: string; [k: string]: string }
            expect( JSON.parse( mod.serIdx({ fixed : 'a', dyn : 'b' }))).toEqual({ fixed : 'a', dyn : 'b' });
            expect( JSON.parse( mod.serIdx({ fixed : 'a', dyn : 123 } as any ))).toEqual({ fixed : 'a' });

            const qIdx1 = new URLSearchParams( mod.serIdxQuery({ fixed : 'a', dyn : 'b' }));
            expect( qIdx1.get( 'fixed' )).toBe( 'a' );
            expect( qIdx1.get( 'dyn' )).toBe( 'b' );

            const qIdx2 = new URLSearchParams( mod.serIdxQuery({ fixed : 'a', dyn : 123 } as any ));
            expect( qIdx2.get( 'fixed' )).toBe( 'a' );
            expect( qIdx2.has( 'dyn' )).toBe( false );

            // Act & Assert — { fixed: string; [k: string]: string } | Record<string, number> | {}
            expect( JSON.parse( mod.serMixed({ fixed : 'a', extra : 'b' }))).toEqual({ fixed : 'a', extra : 'b' });
            expect( JSON.parse( mod.serMixed({ k1 : 10, k2 : 20 }))).toEqual({ k1 : 10, k2 : 20 });
            expect( JSON.parse( mod.serMixed({ fixed : 'a', bad : 123 } as any ))).toEqual({});

            const qMix1 = new URLSearchParams( mod.serMixedQuery({ fixed : 'a', extra : 'b' }));
            expect( qMix1.get( 'fixed' )).toBe( 'a' );
            expect( qMix1.get( 'extra' )).toBe( 'b' );

            const qMix2 = new URLSearchParams( mod.serMixedQuery({ k1 : 10, k2 : 20 }));
            expect( qMix2.get( 'k1' )).toBe( '10' );
            expect( qMix2.get( 'k2' )).toBe( '20' );

            expect( mod.serMixedQuery({ fixed : 'a', bad : 123 } as any )).toBe( '' );

            // Act & Assert — { a: string } | {} on input with extra keys
            expect( JSON.parse( mod.serEmpty({ a : 'hello', extra : 1 } as any ))).toEqual({ a : 'hello' });
            expect( JSON.parse( mod.serEmpty({ onlyExtra : 1 } as any ))).toEqual({});

            const qEmp1 = new URLSearchParams( mod.serEmptyQuery({ a : 'hello', extra : 1 } as any ));
            expect( qEmp1.get( 'a' )).toBe( 'hello' );
            expect( qEmp1.has( 'extra' )).toBe( false );
            expect( mod.serEmptyQuery({ onlyExtra : 1 } as any )).toBe( '' );
        });

        it( 'serializes nested Record of competing union and tuple of Records inside a competing union without variable collisions (#1)', async() =>
        {
            // Arrange
            const mod = await emitAndImport<{
                serRecJson    : ( v: any ) => string
                serRecQuery   : ( v: any ) => string
                serTupleJson  : ( v: any ) => string
                serTupleQuery : ( v: any ) => string
            }>( `
                import { stringify } from '../src/index.js';
                type NestedRec = Record<string, { a: string } | { a: string; b: number }>;
                type TupleUnion =
                    | { pair: [Record<string, string>, Record<string, string>]; tag: string }
                    | { pair: [Record<string, string>, Record<string, string>] };

                export const serRecJson = ( v: NestedRec ) => stringify<NestedRec>( v );
                export const serRecQuery = ( v: NestedRec ) => stringify<NestedRec>( v, { format: 'query' } );
                export const serTupleJson = ( v: TupleUnion ) => stringify<TupleUnion>( v );
                export const serTupleQuery = ( v: TupleUnion ) => stringify<TupleUnion>( v, { format: 'query' } );
            `, 'temp_u2_finding1' );

            // Act & Assert — nested Record of competing union
            const recInput = {
                first  : { a : 'x', b : 1, extra : 'drop' },
                second : { a : 'y', extra : 'drop' }
            };
            expect( JSON.parse( mod.serRecJson( recInput ))).toEqual({
                first  : { a : 'x', b : 1 },
                second : { a : 'y' }
            });

            const qRec = new URLSearchParams( mod.serRecQuery( recInput ));
            expect( qRec.get( 'first[a]' )).toBe( 'x' );
            expect( qRec.get( 'first[b]' )).toBe( '1' );
            expect( qRec.has( 'first[extra]' )).toBe( false );
            expect( qRec.get( 'second[a]' )).toBe( 'y' );
            expect( qRec.has( 'second[extra]' )).toBe( false );

            // Act & Assert — tuple [Record<string, string>, Record<string, string>] inside a competing union
            const tupleInput = {
                pair  : [ { k1 : 'v1' }, { k2 : 'v2' } ],
                tag   : 'ok',
                extra : 99
            };
            expect( JSON.parse( mod.serTupleJson( tupleInput ))).toEqual({
                pair : [ { k1 : 'v1' }, { k2 : 'v2' } ],
                tag  : 'ok'
            });

            const qTuple = new URLSearchParams( mod.serTupleQuery( tupleInput ));
            expect( qTuple.get( 'pair[0][k1]' )).toBe( 'v1' );
            expect( qTuple.get( 'pair[1][k2]' )).toBe( 'v2' );
            expect( qTuple.get( 'tag' )).toBe( 'ok' );
            expect( qTuple.has( 'extra' )).toBe( false );
        });

        it( 'propagates and rolls back probe stats across non-competing inner unions inside a competing outer union (#4, #10)', async() =>
        {
            // Arrange
            const mod = await emitAndImport<{
                serOuter        : ( v: any ) => string
                serOuterQuery   : ( v: any ) => string
                serTupleProp    : ( v: any ) => string
                serTuplePropQry : ( v: any ) => string
                serTupleRoll    : ( v: any ) => string
                serTupleRollQry : ( v: any ) => string
            }>( `
                import { stringify } from '../src/index.js';
                type Outer =
                    | { payload: { a: string } | string; tag?: string }
                    | { payload: { a: string; b: number } | string };

                type TuplePropagate =
                    | { item: [{ a: string }, number] | [{ a: string }, string]; tag?: string }
                    | { item: [{ a: string; b: number }, string] };

                type TupleRollback =
                    | { item: [{ a: string }, number] | [{ a: string; b: number }, string]; tag?: string }
                    | { item: [{ a: string }, string] };

                export const serOuter = ( v: Outer ) => stringify<Outer>( v );
                export const serOuterQuery = ( v: Outer ) => stringify<Outer>( v, { format: 'query' } );
                export const serTupleProp = ( v: TuplePropagate ) => stringify<TuplePropagate>( v );
                export const serTuplePropQry = ( v: TuplePropagate ) => stringify<TuplePropagate>( v, { format: 'query' } );
                export const serTupleRoll = ( v: TupleRollback ) => stringify<TupleRollback>( v );
                export const serTupleRollQry = ( v: TupleRollback ) => stringify<TupleRollback>( v, { format: 'query' } );
            `, 'temp_u2_finding4_10' );

            // Act & Assert — non-competing inner union { a: string } | string vs { a: string; b: number } | string
            expect( JSON.parse( mod.serOuter({ payload : { a : 'x', b : 42 } })))
                .toEqual({ payload : { a : 'x', b : 42 } });

            const qOuter = new URLSearchParams( mod.serOuterQuery({ payload : { a : 'x', b : 42 } }));
            expect( qOuter.get( 'payload[a]' )).toBe( 'x' );
            expect( qOuter.get( 'payload[b]' )).toBe( '42' );

            // Act & Assert — nested tuple union [{ a: string }, number] | [{ a: string }, string] where arm 0 strips on elem 0 and fails on elem 1
            expect( JSON.parse( mod.serTupleProp({ item : [ { a : 'x', b : 42 }, 'hello' ] })))
                .toEqual({ item : [ { a : 'x', b : 42 }, 'hello' ] });

            const qTupleProp = new URLSearchParams( mod.serTuplePropQry({ item : [ { a : 'x', b : 42 }, 'hello' ] }));
            expect( qTupleProp.get( 'item[0][a]' )).toBe( 'x' );
            expect( qTupleProp.get( 'item[0][b]' )).toBe( '42' );
            expect( qTupleProp.get( 'item[1]' )).toBe( 'hello' );

            // Act & Assert — rollback of failed first tuple arm's stripped count so second tuple arm succeeds with stripped === 0
            expect( JSON.parse( mod.serTupleRoll({ item : [ { a : 'x', b : 42 }, 'hello' ], tag : 'keep' })))
                .toEqual({ item : [ { a : 'x', b : 42 }, 'hello' ], tag : 'keep' });

            const qTupleRoll = new URLSearchParams( mod.serTupleRollQry({ item : [ { a : 'x', b : 42 }, 'hello' ], tag : 'keep' }));
            expect( qTupleRoll.get( 'item[0][a]' )).toBe( 'x' );
            expect( qTupleRoll.get( 'item[0][b]' )).toBe( '42' );
            expect( qTupleRoll.get( 'item[1]' )).toBe( 'hello' );
            expect( qTupleRoll.get( 'tag' )).toBe( 'keep' );
        });

        it( 'prioritizes Date and Set<string> arms ahead of bare object in JSON stringify (#3)', async() =>
        {
            // Arrange
            const mod = await emitAndImport<{
                serDateOrObj : ( v: any ) => string
                serSetOrObj  : ( v: any ) => string
            }>( `
                import { stringify } from '../src/index.js';
                type DateOrObj = Date | object;
                type SetOrObj = Set<string> | object;

                export const serDateOrObj = ( v: DateOrObj ) => stringify<DateOrObj>( v );
                export const serSetOrObj = ( v: SetOrObj ) => stringify<SetOrObj>( v );
            `, 'temp_u2_finding3' );

            // Act & Assert
            const d = new Date( '2026-05-01T12:00:00.000Z' );
            expect( mod.serDateOrObj( d )).toBe( '"2026-05-01T12:00:00.000Z"' );
            expect( JSON.parse( mod.serDateOrObj({ plain : 1 }))).toEqual({ plain : 1 });

            expect( JSON.parse( mod.serSetOrObj( new Set([ 'a', 'b' ])))).toEqual([ 'a', 'b' ]);
            expect( JSON.parse( mod.serSetOrObj({ plain : 1 }))).toEqual({ plain : 1 });
        });

        it( 'supports context-encapsulated probe state, exclusiveKeys fast-path, collection unions, and unionResolution option (#2, #3, #4, #5)', async() =>
        {
            // Arrange — Direct runtime tests for createSerializerProbeContext, runWithSerializerProbeContext, and exclusiveKeys
            const customCtx = createSerializerProbeContext();
            expect( hasSerializerUnionProbe( customCtx )).toBe( false );

            const ctxResult = runWithSerializerProbeContext( customCtx, () =>
                serializeUnion(
                    { a : 'ok', b : 42 },
                    '',
                    'Type<Competing>',
                    [
                        () =>
                        {
                            expect( hasSerializerUnionProbe( customCtx )).toBe( true );
                            recordSerializerObjectStats( 1, 1, customCtx );

                            return '{"a":"ok"}';
                        },
                        () =>
                        {
                            expect( hasSerializerUnionProbe( customCtx )).toBe( true );
                            recordSerializerObjectStats( 0, 2, customCtx );

                            return '{"a":"ok","b":42}';
                        }
                    ],
                    true
                )
            );
            expect( ctxResult ).toBe( '{"a":"ok","b":42}' );
            expect( hasSerializerUnionProbe( customCtx )).toBe( false );

            // Outer probe receives stats when inner union uses exclusiveKeys fast-path
            const outerWithExcl = serializeUnion(
                { b : 42 },
                '',
                'Type<Outer>',
                [
                    () => serializeUnion(
                        { b : 42 },
                        'child',
                        'Type<Inner>',
                        [
                            () => '{"a":"x"}',
                            () =>
                            {
                                recordSerializerObjectStats( 0, 2 );

                                return '{"b":42}';
                            }
                        ],
                        true,
                        undefined,
                        [ 'a', 'b' ]
                    ),
                    () => '{"fallback":true}'
                ],
                true
            );
            expect( outerWithExcl ).toBe( '{"b":42}' );

            // Exclusive key fast-path in non-probed mode (probeBestFit = false) + error propagation
            let arm0Called = false;
            const fastExcl = serializeUnion(
                { b : 10 },
                '',
                'Type<ExclFast>',
                [
                    () =>
                    {
                        arm0Called = true;

                        return '{"a":1}';
                    },
                    () => '{"b":10}'
                ],
                false,
                undefined,
                [ 'a', 'b' ]
            );
            expect( fastExcl ).toBe( '{"b":10}' );
            expect( arm0Called ).toBe( false );

            expect(() => serializeUnion(
                { b : 'bad' },
                'root',
                'Type<ExclFast>',
                [
                    () => '{"a":1}',
                    () => { throw new SerializationError( 'root.b', 'Type<number>' ) }
                ],
                false,
                undefined,
                [ 'a', 'b' ]
            )).toThrow( 'Serialization error at "root": Type<ExclFast>' );

            expect(() => serializeUnion(
                { b : 'bad' },
                'root',
                'Type<ExclFast>',
                [
                    () => '{"a":1}',
                    () => { throw new SerializationError( 'root', 'Type<ExclFast>' ) }
                ],
                true,
                undefined,
                [ 'a', 'b' ]
            )).toThrow( 'Serialization error at "root": Type<ExclFast>' );

            expect(() => serializeUnion(
                { b : 'bad' },
                'root',
                'Type<ExclFast>',
                [
                    () => '{"a":1}',
                    () => { throw new TypeError( 'boom' ) }
                ],
                true,
                undefined,
                [ 'a', 'b' ]
            )).toThrow( TypeError );

            // When 0 or >=2 exclusive keys are present, falls back to probing all arms
            const multiExcl = serializeUnion(
                { a : 'x', b : 10, extra : true },
                '',
                'Type<ExclMulti>',
                [
                    () =>
                    {
                        recordSerializerObjectStats( 2, 1 );

                        return '{"a":"x"}';
                    },
                    () =>
                    {
                        recordSerializerObjectStats( 1, 2 );

                        return '{"b":10,"extra":true}';
                    }
                ],
                true,
                undefined,
                [ 'a', 'b' ]
            );
            expect( multiExcl ).toBe( '{"b":10,"extra":true}' );

            // End-to-End collection unions, exclusive keys, and unionResolution: 'declaration-order'
            const mod = await emitAndImport<{
                serArrUnion : ( v: any ) => string
                serExcl     : ( v: any ) => string
                serSpec     : ( v: any ) => string
                serDecl     : ( v: any ) => string
                serDeclQry  : ( v: any ) => string
            }>( `
                import { stringify, serializer } from '../src/index.js';
                type Narrow = { a: string };
                type Wide = { a: string; b: number };
                type ArrUnion = Narrow[] | Wide[];
                type ExclUnion = { kindA: string; count?: number } | { kindB: number; flag?: boolean };
                type OrderUnion = Narrow | Wide;

                export const serArrUnion = serializer<ArrUnion>();
                export const serExcl = ( v: ExclUnion ) => stringify<ExclUnion>( v );
                export const serSpec = ( v: OrderUnion ) => stringify<OrderUnion>( v, { mode: 'relaxed', unionResolution: 'specificity' } );
                export const serDecl = ( v: OrderUnion ) => stringify<OrderUnion>( v, { mode: 'relaxed', unionResolution: 'declaration-order' } );
                export const serDeclQry = ( v: OrderUnion ) => stringify<OrderUnion>( v, { format: 'query', unionResolution: 'declaration-order' } );
            `, 'temp_u2_all5_features' );

            expect( JSON.parse( mod.serArrUnion([ { a : 'x', b : 1, extra : true } as any ])))
                .toEqual([ { a : 'x', b : 1 } ]);
            expect( JSON.parse( mod.serExcl({ kindB : 7, flag : true, extra : 'drop' } as any )))
                .toEqual({ kindB : 7, flag : true });
            expect( JSON.parse( mod.serSpec({ a : 'x', b : 1 }))).toEqual({ a : 'x', b : 1 });
            expect( JSON.parse( mod.serDecl({ a : 'x', b : 1 }))).toEqual({ a : 'x', b : 1 });
            expect( new URLSearchParams( mod.serDeclQry({ a : 'x', b : 1 })).get( 'a' )).toBe( 'x' );
        });
    });
});
