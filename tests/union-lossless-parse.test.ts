import { describe, it, expect } from 'vitest';
import
{
    ParseError,
    createParseProbeContext,
    runWithParseProbeContext,
    hasParseUnionProbe,
    recordParseObjectStats,
    parseUnion
}
    from '../src/runtime/parse-runtime.js';
import { emitAndImport } from './helpers/compile.js';

describe( 'Lossless Union Parsing (U3)', () =>
{
    describe( 'Runtime Probe Helpers (parseUnion)', () =>
    {
        it( 'fast-paths when probeBestFit is false or omitted', () =>
        {
            // Arrange
            let calls = 0;

            // Act
            const res = parseUnion(
                { a : 'x' },
                '',
                'Type<Union>',
                [
                    ( v ) =>
                    {
                        calls++;
                        recordParseObjectStats( 2, 1 );

                        return v;
                    },
                    ( v ) =>
                    {
                        calls++;

                        return v;
                    }
                ],
                false
            );

            // Inner non-probed union inside outer probed union rolls back failed arm stats
            const outerParsed = parseUnion(
                { a : 'x' },
                '',
                'Type<Outer>',
                [
                    ( v, p ) => parseUnion(
                        v,
                        p,
                        'Type<Inner>',
                        [
                            () =>
                            {
                                recordParseObjectStats( 5, 5 );
                                throw new ParseError( p, 'Type<string>' );
                            },
                            ( iv ) =>
                            {
                                recordParseObjectStats( 0, 2 );

                                return iv;
                            }
                        ],
                        false
                    ),
                    () => ({ fallback : true })
                ],
                true,
                [ false, false ]
            );

            // Assert
            expect( res ).toEqual({ a : 'x' });
            expect( outerParsed ).toEqual({ a : 'x' });
            expect( calls ).toBe( 1 );
            expect( hasParseUnionProbe()).toBe( false );
        });

        it( 'short-circuits immediately when strippedCount === 0 on non-fallback arm (R7)', () =>
        {
            // Arrange
            let secondArmCalled = false;

            // Act
            const res = parseUnion(
                { a : 'x' },
                '',
                'Type<Union>',
                [
                    ( v ) =>
                    {
                        expect( hasParseUnionProbe()).toBe( true );
                        recordParseObjectStats( 0, 1 );

                        return { ...v, arm : 1 };
                    },
                    ( v ) =>
                    {
                        secondArmCalled = true;
                        recordParseObjectStats( 0, 2 );

                        return { ...v, arm : 2 };
                    }
                ],
                true,
                [ false, false ]
            );

            // Assert
            expect( res ).toEqual({ a : 'x', arm : 1 });
            expect( secondArmCalled ).toBe( false );
            expect( hasParseUnionProbe()).toBe( false );
        });

        it( 'probes remaining arms when strippedCount > 0 and picks min stripped, then max matched (R8)', () =>
        {
            // Arrange
            const arms = [
                () =>
                {
                    recordParseObjectStats( 2, 1 );

                    return { arm : 1 };
                },
                () =>
                {
                    recordParseObjectStats( 1, 1 );

                    return { arm : 2 };
                },
                () =>
                {
                    recordParseObjectStats( 1, 3 );

                    return { arm : 3 };
                }
            ];

            // Act
            const res = parseUnion({}, '', 'Type<Union>', arms, true, [ false, false, false ]);

            // Assert
            expect( res ).toEqual({ arm : 3 });
        });

        it( 'treats fallback arms as last resort in strip mode and handles errors (R9, AE5)', () =>
        {
            // Arrange
            const structuredVsFallback = [
                () =>
                {
                    recordParseObjectStats( 1, 1 );

                    return { foo : 'hello' };
                },
                ( v: any ) => v
            ];

            const onlyFallback = [
                () =>
                {
                    throw new ParseError( 'foo', 'Type<string>' );
                },
                ( v: any ) => ({ ...v, fb : 1 }),
                ( v: any ) => ({ ...v, fb : 2 })
            ];

            // Act
            const res1 = parseUnion({ foo : 'hello', extra : 1 }, '', 'Type<Union>', structuredVsFallback, true, [ false, true ]);
            const res2 = parseUnion({ bar : 1 }, '', 'Type<Union>', onlyFallback, true, [ false, true, true ]);

            // Assert
            expect( res1 ).toEqual({ foo : 'hello' });
            expect( res2 ).toEqual({ bar : 1, fb : 1 });

            expect(() => parseUnion(
                {},
                'root',
                'Type<Union>',
                [
                    () => { throw new ParseError( 'root', 'Type<Union>' ) }
                ],
                true,
                [ false ]
            )).toThrow( 'Parse error at "root": Type<Union>' );

            expect(() => parseUnion(
                {},
                'root',
                'Type<Union>',
                [
                    () => { throw new ParseError( 'root.a', 'Type<string>' ) }
                ],
                true,
                [ false ]
            )).toThrow( 'Parse error at "root": Type<Union>' );

            expect(() => parseUnion(
                {},
                'root',
                'Type<Union>',
                [
                    () => { throw new TypeError( 'unexpected' ) }
                ],
                true,
                [ false ]
            )).toThrow( TypeError );
        });

        it( 'propagates winning arm stats to parent union probe on nested unions (AE4)', () =>
        {
            // Arrange & Act
            const res = parseUnion(
                {},
                '',
                'Type<Outer>',
                [
                    () =>
                    {
                        recordParseObjectStats( 0, 1 );
                        const inner = parseUnion(
                            {},
                            'child',
                            'Type<Inner>',
                            [
                                () =>
                                {
                                    recordParseObjectStats( 3, 1 );

                                    return { inner : 1 };
                                },
                                () =>
                                {
                                    recordParseObjectStats( 1, 2 );

                                    return { inner : 2 };
                                }
                            ],
                            true,
                            [ false, false ]
                        );

                        return { outer : 1, child : inner };
                    },
                    () =>
                    {
                        recordParseObjectStats( 0, 2 );

                        return { outer : 2 };
                    }
                ],
                true,
                [ false, false ]
            );

            // Assert
            expect( res ).toEqual({ outer : 2 });
        });
    });

    describe( 'End-to-End JSON and Query Parsing (AE1 - AE5)', () =>
    {
        it( 'preserves widest subtype arm in A | B | C (AE1) and handles disjoint extra keys (AE3)', async() =>
        {
            // Arrange
            const mod = await emitAndImport<{
                parseJson        : ( s: string ) => any
                parseJsonStrict  : ( s: string ) => any
                parseQuery       : ( s: string ) => any
                parseDisjoint    : ( s: string ) => any
                parseDisjointQry : ( s: string ) => any
            }>( `
                import { parse } from '../src/index.js';
                type A = { foo: string };
                type B = { bar: number };
                type C = { foo: string; bar: number };
                type Result = A | B | C;

                type Arm1 = { a: string; b: number };
                type Arm2 = { c: boolean };
                type Disjoint = Arm1 | Arm2;

                export const parseJson = ( s: string ) => parse<Result>( s );
                export const parseJsonStrict = ( s: string ) => parse<Result>( s, 'strict' );
                export const parseQuery = ( s: string ) => parse<Result>( s, { from: 'query' } );
                export const parseDisjoint = ( s: string ) => parse<Disjoint>( s );
                export const parseDisjointQry = ( s: string ) => parse<Disjoint>( s, { from: 'query' } );
            `, 'temp_u3_ae1_ae3' );

            // Act & Assert — AE1
            expect( mod.parseJson( '{"foo":"hi","bar":42}' )).toEqual({ foo : 'hi', bar : 42 });
            expect( mod.parseJsonStrict( '{"foo":"hi","bar":42}' )).toEqual({ foo : 'hi', bar : 42 });
            expect(() => mod.parseJsonStrict( '{"foo":"hi","bar":42,"extra":true}' )).toThrow( /Type<Result>/ );
            expect( mod.parseQuery( 'foo=hi&bar=42' )).toEqual({ foo : 'hi', bar : 42 });

            // Act & Assert — AE3
            expect( mod.parseDisjoint( '{"a":"x","b":1,"c":true,"extra1":1,"extra2":2}' ))
                .toEqual({ a : 'x', b : 1 });
            expect( mod.parseDisjointQry( 'a=x&b=1&c=true&extra1=1&extra2=2' ))
                .toEqual({ a : 'x', b : 1 });
        });

        it( 'prevents optional-heavy arms from shadowing required properties and recovers when optional properties are present (AE2)', async() =>
        {
            // Arrange
            const mod = await emitAndImport<{
                parseJson  : ( s: string ) => any
                parseQuery : ( s: string ) => any
            }>( `
                import { parse } from '../src/index.js';
                type OptHeavy = { a: string; b?: number; c?: boolean };
                type ReqPair = { a: string; d: string };
                type U = OptHeavy | ReqPair;
                export const parseJson = ( s: string ) => parse<U>( s );
                export const parseQuery = ( s: string ) => parse<U>( s, { from: 'query' } );
            `, 'temp_u3_ae2' );

            // Act & Assert
            expect( mod.parseJson( '{"a":"x","d":"y"}' )).toEqual({ a : 'x', d : 'y' });
            expect( mod.parseQuery( 'a=x&d=y' )).toEqual({ a : 'x', d : 'y' });

            expect( mod.parseJson( '{"a":"x","b":1,"c":true}' )).toEqual({ a : 'x', b : 1, c : true });
            expect( mod.parseQuery( 'a=x&b=1&c=true' )).toEqual({ a : 'x', b : 1, c : true });

            expect( mod.parseJson( '{"a":"x","b":1,"c":true,"d":"y"}' )).toEqual({ a : 'x', b : 1, c : true });
            expect( mod.parseQuery( 'a=x&b=1&c=true&d=y' )).toEqual({ a : 'x', b : 1, c : true });
        });

        it( 'resolves nested unions with wide vs thin arms without data loss (AE4)', async() =>
        {
            // Arrange
            const mod = await emitAndImport<{
                parseJson  : ( s: string ) => any
                parseQuery : ( s: string ) => any
            }>( `
                import { parse } from '../src/index.js';
                type Thin = { k1: string };
                type Wide = { k1: string; k2: string; k3: string; k4: string };
                type Parent1 = { child: Thin | Wide };
                type Parent2 = { child: { k1: string; k2: string } };
                type Root = Parent1 | Parent2;
                export const parseJson = ( s: string ) => parse<Root>( s );
                export const parseQuery = ( s: string ) => parse<Root>( s, { from: 'query' } );
            `, 'temp_u3_ae4' );

            // Act & Assert
            const wideObj = { child : { k1 : 'a', k2 : 'b', k3 : 'c', k4 : 'd' } };
            expect( mod.parseJson( JSON.stringify( wideObj ))).toEqual( wideObj );
            expect( mod.parseQuery( 'child[k1]=a&child[k2]=b&child[k3]=c&child[k4]=d' )).toEqual( wideObj );

            const pairObj = { child : { k1 : 'a', k2 : 'b' } };
            expect( mod.parseJson( JSON.stringify( pairObj ))).toEqual( pairObj );
            expect( mod.parseQuery( 'child[k1]=a&child[k2]=b' )).toEqual( pairObj );
        });

        it( 'treats bare object in A | object as last-resort fallback while preserving Date and BigInt coercion on A (AE5)', async() =>
        {
            // Arrange
            const mod = await emitAndImport<{
                parseJson    : ( s: string ) => any
                parseRelaxed : ( s: string ) => any
                parseQuery   : ( s: string ) => any
            }>( `
                import { parse } from '../src/index.js';
                type A = { foo: string; createdAt?: Date; count?: bigint };
                type Result = A | object;
                export const parseJson = ( s: string ) => parse<Result>( s );
                export const parseRelaxed = ( s: string ) => parse<Result>( s, 'relaxed' );
                export const parseQuery = ( s: string ) => parse<Result>( s, { from: 'query' } );
            `, 'temp_u3_ae5' );

            // Act & Assert
            // 1. In strip mode, {"foo":"hi","createdAt":"2026-05-01T12:00:00.000Z","count":"99","extra":1} matches A, strips extra, and revives Date + BigInt!
            const parsedA = mod.parseJson( '{"foo":"hi","createdAt":"2026-05-01T12:00:00.000Z","count":"99","extra":1}' );
            expect( parsedA.foo ).toBe( 'hi' );
            expect( parsedA.createdAt ).toBeInstanceOf( Date );
            expect( parsedA.createdAt.toISOString()).toBe( '2026-05-01T12:00:00.000Z' );
            expect( parsedA.count ).toBe( 99n );
            expect( 'extra' in parsedA ).toBe( false );

            // 2. When A fails (missing foo), falls back to bare object
            expect( mod.parseJson( '{"bar":123}' )).toEqual({ bar : 123 });

            // 3. In relaxed mode, A is evaluated first (revives Date/BigInt) and retains extra
            const relaxedA = mod.parseRelaxed( '{"foo":"hi","createdAt":"2026-05-01T12:00:00.000Z","extra":1}' );
            expect( relaxedA.createdAt ).toBeInstanceOf( Date );
            expect( relaxedA.extra ).toBe( 1 );

            // 4. In query strip mode, matches A (coerces Date/BigInt) and strips extra
            const queryA = mod.parseQuery( 'foo=hi&count=42&extra=1' );
            expect( queryA ).toEqual({ foo : 'hi', count : 42n });
        });

        it( 'handles competing unions with index signatures, Record<string, number>, and empty {} arms in strip mode (#12)', async() =>
        {
            // Arrange
            const mod = await emitAndImport<{
                parseIdx        : ( s: string ) => any
                parseIdxQuery   : ( s: string ) => any
                parseMixed      : ( s: string ) => any
                parseMixedQuery : ( s: string ) => any
                parseEmpty      : ( s: string ) => any
                parseEmptyQuery : ( s: string ) => any
            }>( `
                import { parse } from '../src/index.js';
                type WithIndex = { fixed: string } | { fixed: string; [k: string]: string };
                type Mixed = { fixed: string; [k: string]: string } | Record<string, number> | {};
                type EmptyVsNamed = { a: string } | {};

                export const parseIdx = ( s: string ) => parse<WithIndex>( s );
                export const parseIdxQuery = ( s: string ) => parse<WithIndex>( s, { from: 'query' } );
                export const parseMixed = ( s: string ) => parse<Mixed>( s );
                export const parseMixedQuery = ( s: string ) => parse<Mixed>( s, { from: 'query' } );
                export const parseEmpty = ( s: string ) => parse<EmptyVsNamed>( s );
                export const parseEmptyQuery = ( s: string ) => parse<EmptyVsNamed>( s, { from: 'query' } );
            `, 'temp_u3_index_and_empty' );

            // Act & Assert — { fixed: string } | { fixed: string; [k: string]: string }
            expect( mod.parseIdx( '{"fixed":"a","dyn":"b"}' )).toEqual({ fixed : 'a', dyn : 'b' });
            expect( mod.parseIdx( '{"fixed":"a","dyn":123}' )).toEqual({ fixed : 'a' });
            expect( mod.parseIdxQuery( 'fixed=a&dyn=b' )).toEqual({ fixed : 'a', dyn : 'b' });

            // Act & Assert — { fixed: string; [k: string]: string } | Record<string, number> | {}
            expect( mod.parseMixed( '{"fixed":"a","extra":"b"}' )).toEqual({ fixed : 'a', extra : 'b' });
            expect( mod.parseMixed( '{"k1":10,"k2":20}' )).toEqual({ k1 : 10, k2 : 20 });
            expect( mod.parseMixed( '{"fixed":"a","bad":123}' )).toEqual({});

            expect( mod.parseMixedQuery( 'fixed=a&extra=b' )).toEqual({ fixed : 'a', extra : 'b' });
            expect( mod.parseMixedQuery( 'k1=10&k2=20' )).toEqual({ k1 : 10, k2 : 20 });
            expect( mod.parseMixedQuery( 'k1=10&bad=not-a-num' )).toEqual({});

            // Act & Assert — { a: string } | {} on input with extra keys
            expect( mod.parseEmpty( '{"a":"hello","extra":1}' )).toEqual({ a : 'hello' });
            expect( mod.parseEmpty( '{"onlyExtra":1}' )).toEqual({});
            expect( mod.parseEmptyQuery( 'a=hello&extra=1' )).toEqual({ a : 'hello' });
            expect( mod.parseEmptyQuery( 'onlyExtra=1' )).toEqual({});
        });

        it( 'propagates and rolls back probe stats across non-competing inner unions inside a competing outer union (#4)', async() =>
        {
            // Arrange
            const mod = await emitAndImport<{
                parseOuter        : ( s: string ) => any
                parseOuterQuery   : ( s: string ) => any
                parseTupleProp    : ( s: string ) => any
                parseTuplePropQry : ( s: string ) => any
                parseTupleRoll    : ( s: string ) => any
                parseTupleRollQry : ( s: string ) => any
            }>( `
                import { parse } from '../src/index.js';
                type Outer =
                    | { payload: { a: string } | string; tag?: string }
                    | { payload: { a: string; b: number } | string };

                type TuplePropagate =
                    | { item: [{ a: string }, number] | [{ a: string }, string]; tag?: string }
                    | { item: [{ a: string; b: number }, string] };

                type TupleRollback =
                    | { item: [{ a: string }, number] | [{ a: string; b: number }, string]; tag?: string }
                    | { item: [{ a: string }, string] };

                export const parseOuter = ( s: string ) => parse<Outer>( s );
                export const parseOuterQuery = ( s: string ) => parse<Outer>( s, { from: 'query' } );
                export const parseTupleProp = ( s: string ) => parse<TuplePropagate>( s );
                export const parseTuplePropQry = ( s: string ) => parse<TuplePropagate>( s, { from: 'query' } );
                export const parseTupleRoll = ( s: string ) => parse<TupleRollback>( s );
                export const parseTupleRollQry = ( s: string ) => parse<TupleRollback>( s, { from: 'query' } );
            `, 'temp_u3_finding4' );

            // Act & Assert — non-competing inner union { a: string } | string vs { a: string; b: number } | string
            expect( mod.parseOuter( '{"payload":{"a":"x","b":42}}' ))
                .toEqual({ payload : { a : 'x', b : 42 } });
            expect( mod.parseOuterQuery( 'payload[a]=x&payload[b]=42' ))
                .toEqual({ payload : { a : 'x', b : 42 } });

            // Act & Assert — nested tuple union [{ a: string }, number] | [{ a: string }, string] where arm 0 strips on elem 0 and fails on elem 1
            expect( mod.parseTupleProp( '{"item":[{"a":"x","b":42},"hello"]}' ))
                .toEqual({ item : [ { a : 'x', b : 42 }, 'hello' ] });
            expect( mod.parseTuplePropQry( 'item[0][a]=x&item[0][b]=42&item[1]=hello' ))
                .toEqual({ item : [ { a : 'x', b : 42 }, 'hello' ] });

            // Act & Assert — rollback of failed first tuple arm's stripped count so second tuple arm succeeds with stripped === 0
            expect( mod.parseTupleRoll( '{"item":[{"a":"x","b":42},"hello"],"tag":"keep"}' ))
                .toEqual({ item : [ { a : 'x', b : 42 }, 'hello' ], tag : 'keep' });
            expect( mod.parseTupleRollQry( 'item[0][a]=x&item[0][b]=42&item[1]=hello&tag=keep' ))
                .toEqual({ item : [ { a : 'x', b : 42 }, 'hello' ], tag : 'keep' });
        });

        it( 'revives Date and Set<string> ahead of bare object in parse (#3)', async() =>
        {
            // Arrange
            const mod = await emitAndImport<{
                parseDateOrObj : ( s: string ) => any
                parseSetOrObj  : ( s: string ) => any
            }>( `
                import { parse } from '../src/index.js';
                type DateOrObj = Date | object;
                type SetOrObj = Set<string> | object;

                export const parseDateOrObj = ( s: string ) => parse<DateOrObj>( s );
                export const parseSetOrObj = ( s: string ) => parse<SetOrObj>( s );
            `, 'temp_u3_finding3' );

            // Act & Assert
            const revivedDate = mod.parseDateOrObj( '"2026-05-01T12:00:00.000Z"' );
            expect( revivedDate ).toBeInstanceOf( Date );
            expect( revivedDate.toISOString()).toBe( '2026-05-01T12:00:00.000Z' );
            expect( mod.parseDateOrObj( '{"plain":1}' )).toEqual({ plain : 1 });

            const revivedSet = mod.parseSetOrObj( '["a","b"]' );
            expect( revivedSet ).toBeInstanceOf( Set );
            expect([ ...revivedSet ]).toEqual([ 'a', 'b' ]);
            expect( mod.parseSetOrObj( '{"plain":1}' )).toEqual({ plain : 1 });
        });

        it( 'supports context-encapsulated probe state, exclusiveKeys fast-path, collection unions, and unionResolution option (#2, #3, #4, #5)', async() =>
        {
            // Arrange — Direct runtime tests for createParseProbeContext, runWithParseProbeContext, and exclusiveKeys
            const customCtx = createParseProbeContext();
            expect( hasParseUnionProbe( customCtx )).toBe( false );

            const ctxResult = runWithParseProbeContext( customCtx, () =>
                parseUnion(
                    { a : 'ok', b : 42 },
                    '',
                    'Type<Competing>',
                    [
                        () =>
                        {
                            expect( hasParseUnionProbe( customCtx )).toBe( true );
                            recordParseObjectStats( 1, 1, customCtx );

                            return { a : 'ok' };
                        },
                        ( v ) =>
                        {
                            expect( hasParseUnionProbe( customCtx )).toBe( true );
                            recordParseObjectStats( 0, 2, customCtx );

                            return v;
                        }
                    ],
                    true
                )
            );
            expect( ctxResult ).toEqual({ a : 'ok', b : 42 });
            expect( hasParseUnionProbe( customCtx )).toBe( false );

            // Outer probe receives stats when inner union uses exclusiveKeys fast-path
            const outerWithExcl = parseUnion(
                { b : 42 },
                '',
                'Type<Outer>',
                [
                    ( v, p ) => parseUnion(
                        v,
                        p,
                        'Type<Inner>',
                        [
                            () => ({ a : 'x' }),
                            ( iv ) =>
                            {
                                recordParseObjectStats( 0, 2 );

                                return iv;
                            }
                        ],
                        true,
                        undefined,
                        [ 'a', 'b' ]
                    ),
                    () => ({ fallback : true })
                ],
                true
            );
            expect( outerWithExcl ).toEqual({ b : 42 });

            // Exclusive key fast-path in non-probed mode (probeBestFit = false) + error propagation
            let arm0Called = false;
            const fastExcl = parseUnion(
                { b : 10 },
                '',
                'Type<ExclFast>',
                [
                    () =>
                    {
                        arm0Called = true;

                        return { a : 1 };
                    },
                    ( v ) => v
                ],
                false,
                undefined,
                [ 'a', 'b' ]
            );
            expect( fastExcl ).toEqual({ b : 10 });
            expect( arm0Called ).toBe( false );

            expect(() => parseUnion(
                { b : 'bad' },
                'root',
                'Type<ExclFast>',
                [
                    () => ({ a : 1 }),
                    () => { throw new ParseError( 'root.b', 'Type<number>' ) }
                ],
                false,
                undefined,
                [ 'a', 'b' ]
            )).toThrow( 'Parse error at "root": Type<ExclFast>' );

            expect(() => parseUnion(
                { b : 'bad' },
                'root',
                'Type<ExclFast>',
                [
                    () => ({ a : 1 }),
                    () => { throw new ParseError( 'root', 'Type<ExclFast>' ) }
                ],
                true,
                undefined,
                [ 'a', 'b' ]
            )).toThrow( 'Parse error at "root": Type<ExclFast>' );

            expect(() => parseUnion(
                { b : 'bad' },
                'root',
                'Type<ExclFast>',
                [
                    () => ({ a : 1 }),
                    () => { throw new TypeError( 'boom' ) }
                ],
                true,
                undefined,
                [ 'a', 'b' ]
            )).toThrow( TypeError );

            // When 0 or >=2 exclusive keys are present, falls back to probing all arms
            const multiExcl = parseUnion(
                { a : 'x', b : 10, extra : true },
                '',
                'Type<ExclMulti>',
                [
                    () =>
                    {
                        recordParseObjectStats( 2, 1 );

                        return { a : 'x' };
                    },
                    () =>
                    {
                        recordParseObjectStats( 1, 2 );

                        return { b : 10, extra : true };
                    }
                ],
                true,
                undefined,
                [ 'a', 'b' ]
            );
            expect( multiExcl ).toEqual({ b : 10, extra : true });

            // End-to-End collection unions, exclusive keys, and unionResolution: 'declaration-order'
            const mod = await emitAndImport<{
                parseArrUnion : ( s: string ) => any
                parseExcl     : ( s: string ) => any
                parseSpec     : ( s: string ) => any
                parseDecl     : ( s: string ) => any
                parseDeclQry  : ( s: string ) => any
            }>( `
                import { parse } from '../src/index.js';
                type Narrow = { a: string; createdAt?: string };
                type Wide = { a: string; createdAt?: Date; extraNum: number };
                type ArrUnion = Narrow[] | Wide[];
                type ExclUnion = { kindA: string; count?: number } | { kindB: number; flag?: boolean };
                type OrderUnion = Narrow | Wide;

                export const parseArrUnion = ( s: string ) => parse<ArrUnion>( s );
                export const parseExcl = ( s: string ) => parse<ExclUnion>( s );
                export const parseSpec = ( s: string ) => parse<OrderUnion>( s, { mode: 'relaxed', unionResolution: 'specificity' } );
                export const parseDecl = ( s: string ) => parse<OrderUnion>( s, { mode: 'relaxed', unionResolution: 'declaration-order' } );
                export const parseDeclQry = ( s: string ) => parse<OrderUnion>( s, { from: 'query', unionResolution: 'declaration-order' } );
            `, 'temp_u3_all5_features' );

            const arrRes = mod.parseArrUnion( '[{"a":"x","extraNum":5,"extra":"drop"}]' );
            expect( arrRes ).toEqual([ { a : 'x', extraNum : 5 } ]);
            expect( mod.parseExcl( '{"kindB":7,"flag":true,"extra":"drop"}' ))
                .toEqual({ kindB : 7, flag : true });

            // With specificity, Wide is evaluated first (so createdAt is revived to Date); with declaration-order, Narrow is evaluated first (createdAt stays string)
            const specRes = mod.parseSpec( '{"a":"x","createdAt":"2026-05-01T12:00:00.000Z","extraNum":5}' );
            expect( specRes.createdAt ).toBeInstanceOf( Date );
            const declRes = mod.parseDecl( '{"a":"x","createdAt":"2026-05-01T12:00:00.000Z","extraNum":5}' );
            expect( typeof declRes.createdAt ).toBe( 'string' );
            expect( mod.parseDeclQry( 'a=x' )).toEqual({ a : 'x' });
        });
    });
});
