import { describe, it, expect } from 'vitest';
import { validators, is, assert, assertGuard, validate, type ValidationContext } from '../src/runtime/validators.js';
import { emitAndImport } from './helpers/compile.js';

describe( 'Lossless Union Validation (U4)', () =>
{
    describe( 'Runtime Probe Helpers (validators.union)', () =>
    {
        const makeCtx = ( mode: 'strict' | 'relaxed' | 'strip' = 'strip', mutate = false, from?: 'json' | 'query' ): ValidationContext => ({
            success : true,
            errors  : [],
            mode,
            mutate,
            from
        });

        it( 'short-circuits immediately when strippedCount === 0 on non-fallback arm (R7)', () =>
        {
            // Arrange
            let secondArmCalled = false;
            const keys1 = new Set([ 'a' ]);
            const keys2 = new Set([ 'a', 'b' ]);
            const checks = [
                ( v: any, path: string, ctx: ValidationContext ) =>
                {
                    const obj = validators.object( v, path, ctx, keys1 );

                    if( obj === false ){ return v }

                    const data = validators.objectShell( obj, ctx, true );
                    validators.props( obj, data, path, ctx, [[ 'a', false, validators.string ]]);
                    validators.stripExtras( data, ctx, keys1 );

                    return data;
                },
                ( v: any, path: string, ctx: ValidationContext ) =>
                {
                    secondArmCalled = true;
                    const obj = validators.object( v, path, ctx, keys2 );

                    if( obj === false ){ return v }

                    const data = validators.objectShell( obj, ctx, true );
                    validators.props( obj, data, path, ctx, [[ 'a', false, validators.string ], [ 'b', false, validators.number ]]);
                    validators.stripExtras( data, ctx, keys2 );

                    return data;
                }
            ];
            const ctx = makeCtx( 'strip' );

            // Act
            const res = validators.union({ a : 'hello' }, '', ctx, checks, 'Type<Union>', true, [ false, false ]);

            // Assert
            expect( ctx.success ).toBe( true );
            expect( res ).toEqual({ a : 'hello' });
            expect( secondArmCalled ).toBe( false );
        });

        it( 'probes remaining arms when strippedCount > 0 and picks min stripped, then max matched (R8)', () =>
        {
            // Arrange
            const keys0 = new Set([ 'a' ]);
            const keys1 = new Set([ 'a', 'b' ]);
            const keys2 = new Set([ 'a', 'b', 'c' ]);
            const keys3 = new Set([ 'a', 'b', 'd' ]);
            const makeArm = ( keys: Set<string>, props: [string, boolean, Function][]) =>
                ( v: any, path: string, ctx: ValidationContext ) =>
                {
                    const obj = validators.object( v, path, ctx, keys );

                    if( obj === false ){ return v }

                    const data = validators.objectShell( obj, ctx, true );
                    validators.props( obj, data, path, ctx, props );
                    validators.stripExtras( data, ctx, keys );

                    return data;
                };
            const checks = [
                makeArm( keys0, [[ 'a', false, validators.string ]]),
                makeArm( keys1, [[ 'a', false, validators.string ], [ 'b', true, validators.number ]]),
                makeArm( keys2, [[ 'a', false, validators.string ], [ 'b', false, validators.number ], [ 'c', false, validators.boolean ]]),
                makeArm( keys3, [[ 'a', false, validators.string ], [ 'b', false, validators.number ], [ 'd', true, validators.boolean ]])
            ];
            const ctx = makeCtx( 'strip' );

            // Act: input has a, b, c, extra -> arm0 strips 3/matches 1; arm1 strips 2/matches 2; arm2 strips 1/matches 3; arm3 strips 2/matches 2
            const res = validators.union({ a : 'hello', b : 42, c : true, extra : 1 }, '', ctx, checks, 'Type<Union>', true, [ false, false, false, false ]);

            // Assert
            expect( ctx.success ).toBe( true );
            expect( res ).toEqual({ a : 'hello', b : 42, c : true });

            // Tie on strippedCount === 1: arm1 matches 1 ('a'), arm2 matches 2 ('a', 'b'), arm3 matches 2 ('a', 'b')
            const tieChecks = [
                makeArm( keys0, [[ 'a', false, validators.string ]]),
                makeArm( keys1, [[ 'a', false, validators.string ], [ 'b', false, validators.number ]]),
                makeArm( keys1, [[ 'a', false, validators.string ], [ 'b', false, validators.number ]])
            ];
            const tieCtx = makeCtx( 'strip' );
            const tieRes = validators.union(
                { a : 'hello', b : 42, extra : 1 },
                '',
                tieCtx,
                [
                    ( v: any, p: string, c: ValidationContext ) =>
                    {
                        if( c.unionProbe ){ c.unionProbe.stripped = 1; c.unionProbe.matched = 1 }

                        return { a : v.a };
                    },
                    ...tieChecks.slice( 1 )
                ],
                'Type<Union>',
                true,
                [ false, false, false ]
            );
            expect( tieRes ).toEqual({ a : 'hello', b : 42 });
        });

        it( 'treats fallback arms as last resort in strip mode across both Pass 1 and Pass 2 (R9, AE5)', () =>
        {
            // Arrange
            const keysA = new Set([ 'foo', 'count' ]);
            const checks = [
                ( v: any, path: string, ctx: ValidationContext ) =>
                {
                    const obj = validators.object( v, path, ctx, keysA );

                    if( obj === false ){ return v }

                    const data = validators.objectShell( obj, ctx, true );
                    validators.props( obj, data, path, ctx, [
                        [ 'foo', false, validators.string ],
                        [ 'count', true, validators.number ]
                    ]);
                    validators.stripExtras( data, ctx, keysA );

                    return data;
                },
                ( v: any, path: string, ctx: ValidationContext ) => validators.record( v, path, ctx, validators.any )
            ];

            // Act 1: Pass 2 coercion with strip mode and fallback arm (stripped > 0)
            const ctx1 = makeCtx( 'strip', false, 'query' );
            const res1 = validators.union({ foo : 'hi', count : '42', extra : 'drop' }, '', ctx1, checks, 'Type<Union>', true, [ false, true ]);

            // Act 1b: Pass 2 coercion short-circuits when stripped === 0
            const ctx1b = makeCtx( 'strip', false, 'query' );
            const res1b = validators.union({ foo : 'hi', count : '42', undefKey : undefined }, '', ctx1b, checks, 'Type<Union>', true, [ false, true ]);

            // Act 2: Fallback arm selected when structured arm fails both passes (with multiple fallback arms)
            const checksMultiFallback = [
                ...checks,
                ( v: any, path: string, ctx: ValidationContext ) => validators.record( v, path, ctx, validators.any )
            ];
            const ctx2 = makeCtx( 'strip', false, 'query' );
            const res2 = validators.union({ bar : 'keep', undefVal : undefined }, '', ctx2, checksMultiFallback, 'Type<Union>', true, [ false, true, true ]);

            // Act 3: All arms fail
            const ctx3 = makeCtx( 'strip', false, 'query' );
            validators.union( 'not-an-object', '', ctx3, checks, 'Type<Union>', true, [ false, true ]);

            // Act 4: Non-strip mode ('relaxed') with from: 'query' defers fallback arm in Pass 1 so Pass 2 coercion runs
            const ctx4 = makeCtx( 'relaxed', false, 'query' );
            const res4 = validators.union({ foo : 'hi', count : '42', extra : 'keep' }, '', ctx4, checksMultiFallback, 'Type<Union>', true, [ false, true, true ]);
            const ctx5 = makeCtx( 'relaxed', false, 'query' );
            const res5 = validators.union({ bar : 'fallback-in-relaxed' }, '', ctx5, checksMultiFallback, 'Type<Union>', true, [ false, true, true ]);
            const ctx6 = makeCtx( 'relaxed', false, 'query' );
            validators.union( 'not-an-object', '', ctx6, checksMultiFallback, 'Type<Union>', true, [ false, true, true ]);

            // Assert
            expect( ctx1.success ).toBe( true );
            expect( res1 ).toEqual({ foo : 'hi', count : 42 });
            expect( ctx1b.success ).toBe( true );
            expect( res1b ).toEqual({ foo : 'hi', count : 42 });
            expect( ctx2.success ).toBe( true );
            expect( res2 ).toEqual({ bar : 'keep', undefVal : undefined });
            expect( ctx3.success ).toBe( false );
            expect( ctx4.success ).toBe( true );
            expect( res4 ).toEqual({ foo : 'hi', count : 42, extra : 'keep' });
            expect( ctx5.success ).toBe( true );
            expect( res5 ).toEqual({ bar : 'fallback-in-relaxed' });
            expect( ctx6.success ).toBe( false );
        });

        it( 'propagates winning arm stats to parent ctx.unionProbe and counts additionalProps keys (AE4)', () =>
        {
            // Arrange
            const outerCtx = makeCtx( 'strip' );
            outerCtx.unionProbe = { stripped : 0, matched : 0 };
            const keysFixed = new Set([ 'fixed' ]);
            const checksWithStringIndex = [
                ( v: any, path: string, ctx: ValidationContext ) =>
                {
                    const obj = validators.object( v, path, ctx, keysFixed );

                    if( obj === false ){ return v }

                    const data = validators.objectShell( obj, ctx, true );
                    validators.props( obj, data, path, ctx, [[ 'fixed', false, validators.string ]]);
                    validators.stripExtras( data, ctx, keysFixed );

                    return data;
                },
                ( v: any, path: string, ctx: ValidationContext ) =>
                {
                    const obj = validators.object( v, path, ctx, undefined );

                    if( obj === false ){ return v }

                    const data = validators.objectShell( obj, ctx, true );
                    validators.props( obj, data, path, ctx, [[ 'fixed', false, validators.string ]]);
                    validators.additionalProps( obj, data, path, ctx, keysFixed, ( val: any, p: string, c: ValidationContext ) =>
                        validators.optional( val, p, c, validators.string )
                    );

                    return data;
                }
            ];

            // Act 1: Arm 0 strips 'extra', Arm 1 (with additionalProps) matches defined keys with 0 stripped and short-circuits!
            const res1 = validators.union({ fixed : 'a', extra : 'b', undefExtra : undefined }, '', outerCtx, checksWithStringIndex, 'Type<Union>', true, [ false, false ]);

            // Act 2: When Arm 1 fails on non-string extra, Arm 0 wins with stripped = 1 and propagates stripped + matched to outerCtx.unionProbe
            const outerCtx2 = makeCtx( 'strip' );
            outerCtx2.unionProbe = { stripped : 0, matched : 0 };
            const res2 = validators.union({ fixed : 'a', extra : 123 }, '', outerCtx2, checksWithStringIndex, 'Type<Union>', true, [ false, false ]);

            // Act 3: Non-probed union (probeBestFit = false) propagates winning arm stats to outerCtx3.unionProbe (#7)
            const outerCtx3 = makeCtx( 'strip' );
            outerCtx3.unionProbe = { stripped : 0, matched : 0 };
            const res3 = validators.union({ fixed : 'a', extra : 123 }, '', outerCtx3, checksWithStringIndex, 'Type<Union>', false );

            // Assert
            expect( res1 ).toEqual({ fixed : 'a', extra : 'b', undefExtra : undefined });
            expect( outerCtx.unionProbe ).toEqual({ stripped : 0, matched : 2 });
            expect( res2 ).toEqual({ fixed : 'a' });
            expect( outerCtx2.unionProbe ).toEqual({ stripped : 1, matched : 1 });
            expect( res3 ).toEqual({ fixed : 'a' });
            expect( outerCtx3.unionProbe ).toEqual({ stripped : 1, matched : 1 });
        });
    });

    describe( 'End-to-End validate / assert / assertGuard / is (AE1 - AE5)', () =>
    {
        it( 'preserves widest subtype arm in A | B | C (AE1) and handles disjoint extra keys (AE3)', async() =>
        {
            // Arrange
            const mod = await emitAndImport<{
                valStrip    : ( v: any ) => any
                valStrict   : ( v: any ) => any
                assertStrip : ( v: any ) => any
                guardStrip  : ( v: any ) => void
                isStrip     : ( v: any ) => boolean
                assertDisj  : ( v: any ) => any
            }>( `
                import { validate, assert, assertGuard, is } from '../src/index.js';
                type A = { foo: string };
                type B = { bar: number };
                type C = { foo: string; bar: number };
                type Result = A | B | C;

                type Arm1 = { a: string; b: number };
                type Arm2 = { c: boolean };
                type Disjoint = Arm1 | Arm2;

                export const valStrip = ( v: unknown ) => validate<Result>( v, 'strip' );
                export const valStrict = ( v: unknown ) => validate<Result>( v, 'strict' );
                export const assertStrip = ( v: unknown ) => assert<Result>( v, 'strip' );
                export const guardStrip = ( v: unknown ) => assertGuard<Result>( v, 'strip' );
                export const isStrip = ( v: unknown ) => is<Result>( v, 'strip' );
                export const assertDisj = ( v: unknown ) => assert<Disjoint>( v, 'strip' );
            `, 'temp_u4_ae1_ae3' );

            // Act & Assert — AE1
            expect( mod.valStrip({ foo : 'hi', bar : 42 })).toMatchObject({
                success : true,
                data    : { foo : 'hi', bar : 42 }
            });
            expect( mod.valStrict({ foo : 'hi', bar : 42 })).toMatchObject({
                success : true,
                data    : { foo : 'hi', bar : 42 }
            });
            expect( mod.valStrict({ foo : 'hi', bar : 42, extra : 1 }).success ).toBe( false );
            expect( mod.assertStrip({ foo : 'hi', bar : 42, extra : 1 })).toEqual({ foo : 'hi', bar : 42 });

            // In-place mutation via assertGuard and is in 'strip' mode
            const guardTarget: any = { foo : 'hi', bar : 42, extra : 1 };
            mod.guardStrip( guardTarget );
            expect( guardTarget ).toEqual({ foo : 'hi', bar : 42 });

            const isTarget: any = { foo : 'hi', bar : 42, extra : 1 };
            expect( mod.isStrip( isTarget )).toBe( true );
            expect( isTarget ).toEqual({ foo : 'hi', bar : 42 });

            // Act & Assert — AE3
            expect( mod.assertDisj({ a : 'x', b : 1, c : true, extra1 : 1, extra2 : 2 }))
                .toEqual({ a : 'x', b : 1 });
        });

        it( 'prevents optional-heavy arms from shadowing required properties and recovers when optional properties are present (AE2)', async() =>
        {
            // Arrange
            const mod = await emitAndImport<{
                assertStrip : ( v: any ) => any
            }>( `
                import { assert } from '../src/index.js';
                type OptHeavy = { a: string; b?: number; c?: boolean };
                type ReqPair = { a: string; d: string };
                type U = OptHeavy | ReqPair;
                export const assertStrip = ( v: unknown ) => assert<U>( v, 'strip' );
            `, 'temp_u4_ae2' );

            // Act & Assert
            expect( mod.assertStrip({ a : 'x', d : 'y' })).toEqual({ a : 'x', d : 'y' });
            expect( mod.assertStrip({ a : 'x', b : 1, c : true })).toEqual({ a : 'x', b : 1, c : true });
            expect( mod.assertStrip({ a : 'x', b : 1, c : true, d : 'y' })).toEqual({ a : 'x', b : 1, c : true });
        });

        it( 'resolves nested unions with wide vs thin arms without data loss (AE4)', async() =>
        {
            // Arrange
            const mod = await emitAndImport<{
                assertStrip : ( v: any ) => any
            }>( `
                import { assert } from '../src/index.js';
                type Thin = { k1: string };
                type Wide = { k1: string; k2: string; k3: string; k4: string };
                type Parent1 = { child: Thin | Wide };
                type Parent2 = { child: { k1: string; k2: string } };
                type Root = Parent1 | Parent2;
                export const assertStrip = ( v: unknown ) => assert<Root>( v, 'strip' );
            `, 'temp_u4_ae4' );

            // Act & Assert
            const wideObj = { child : { k1 : 'a', k2 : 'b', k3 : 'c', k4 : 'd' } };
            expect( mod.assertStrip( wideObj )).toEqual( wideObj );

            const pairObj = { child : { k1 : 'a', k2 : 'b' } };
            expect( mod.assertStrip( pairObj )).toEqual( pairObj );
        });

        it( 'treats bare object in A | object as last-resort fallback while preserving Date and BigInt coercion on A (AE5)', async() =>
        {
            // Arrange
            const mod = await emitAndImport<{
                assertStripJson : ( v: any ) => any
                assertRelaxed   : ( v: any ) => any
                assertStrict    : ( v: any ) => any
            }>( `
                import { assert } from '../src/index.js';
                type A = { foo: string; createdAt?: Date; count?: bigint };
                type Result = A | object;
                export const assertStripJson = ( v: unknown ) => assert<Result>( v, { mode: 'strip', from: 'json' } );
                export const assertRelaxed = ( v: unknown ) => assert<Result>( v, { mode: 'relaxed', from: 'json' } );
                export const assertStrict = ( v: unknown ) => assert<Result>( v, 'strict' );
            `, 'temp_u4_ae5' );

            // Act & Assert
            // 1. In strip mode with from: 'json', { foo: 'hi', createdAt: ISO, count: '99', extra: 1 } matches A, revives Date + BigInt, and strips extra
            const resA = mod.assertStripJson({
                foo       : 'hi',
                createdAt : '2026-05-01T12:00:00.000Z',
                count     : '99',
                extra     : 1
            });
            expect( resA.foo ).toBe( 'hi' );
            expect( resA.createdAt ).toBeInstanceOf( Date );
            expect( resA.count ).toBe( 99n );
            expect( 'extra' in resA ).toBe( false );

            // 2. When A fails (missing foo), falls back to bare object
            expect( mod.assertStripJson({ bar : 123 })).toEqual({ bar : 123 });

            // 3. In relaxed mode with from: 'json', A runs first (reviving Date) and retains extra
            const resRelaxed = mod.assertRelaxed({
                foo       : 'hi',
                createdAt : '2026-05-01T12:00:00.000Z',
                extra     : 1
            });
            expect( resRelaxed.createdAt ).toBeInstanceOf( Date );
            expect( resRelaxed.extra ).toBe( 1 );

            // 4. In strict mode, { foo: 'hi', extra: 1 } fails A's strict check and falls through to bare object
            expect( mod.assertStrict({ foo : 'hi', extra : 1 })).toEqual({ foo : 'hi', extra : 1 });
        });

        it( 'propagates probe stats through non-competing inner unions inside a competing outer union (#7)', async() =>
        {
            // Arrange
            const mod = await emitAndImport<{
                assertOuter     : ( v: unknown ) => any
                assertOuterWide : ( v: unknown ) => any
                assertTupleRoll : ( v: unknown ) => any
            }>( `
                import { assert } from '../src/index.js';
                type Outer =
                    | { payload: { a: string } | string; opt?: string }
                    | { payload: { a: string; b: number } | string };

                type OuterWide =
                    | { payload: { a: string } | string; opt?: string }
                    | { payload: { a: string; b: number; c: number } | string };

                type TupleRollback =
                    | { item: [{ a: string }, number] | [{ a: string; b: number }, string]; opt?: string }
                    | { item: [{ a: string }, string] };

                export const assertOuter = ( v: unknown ) => assert<Outer>( v, 'strip' );
                export const assertOuterWide = ( v: unknown ) => assert<OuterWide>( v, 'strip' );
                export const assertTupleRoll = ( v: unknown ) => assert<TupleRollback>( v, 'strip' );
            `, 'temp_u4_finding7' );

            // Act & Assert — first outer arm sorts first due to opt?: string, but inner { a: string } | string strips b: 1 -> second outer arm wins!
            expect( mod.assertOuter({ payload : { a : 'x', b : 1 } }))
                .toEqual({ payload : { a : 'x', b : 1 } });

            expect( mod.assertOuterWide({ payload : { a : 'x', b : 1, c : 2 }, opt : 'y' }))
                .toEqual({ payload : { a : 'x', b : 1, c : 2 } });

            expect( mod.assertTupleRoll({ item : [ { a : 'x', b : 1 }, 'hello' ], opt : 'y' }))
                .toEqual({ item : [ { a : 'x', b : 1 }, 'hello' ], opt : 'y' });
        });

        it( 'handles competing unions with index signatures, Record<string, number>, and empty {} arms in strip mode (#12)', async() =>
        {
            // Arrange
            const mod = await emitAndImport<{
                assertIdx   : ( v: unknown ) => any
                assertMixed : ( v: unknown ) => any
                assertEmpty : ( v: unknown ) => any
            }>( `
                import { assert } from '../src/index.js';
                type WithIndex = { fixed: string } | { fixed: string; [k: string]: string };
                type Mixed = { fixed: string; [k: string]: string } | Record<string, number> | {};
                type EmptyVsNamed = { a: string } | {};

                export const assertIdx = ( v: unknown ) => assert<WithIndex>( v, 'strip' );
                export const assertMixed = ( v: unknown ) => assert<Mixed>( v, 'strip' );
                export const assertEmpty = ( v: unknown ) => assert<EmptyVsNamed>( v, 'strip' );
            `, 'temp_u4_finding12' );

            // Act & Assert — { fixed: string } | { fixed: string; [k: string]: string }
            expect( mod.assertIdx({ fixed : 'a', dyn : 'b' })).toEqual({ fixed : 'a', dyn : 'b' });
            expect( mod.assertIdx({ fixed : 'a', dyn : 123 })).toEqual({ fixed : 'a' });

            // Act & Assert — { fixed: string; [k: string]: string } | Record<string, number> | {}
            expect( mod.assertMixed({ fixed : 'a', extra : 'b' })).toEqual({ fixed : 'a', extra : 'b' });
            expect( mod.assertMixed({ k1 : 10, k2 : 20 })).toEqual({ k1 : 10, k2 : 20 });
            expect( mod.assertMixed({ fixed : 'a', bad : 123 })).toEqual({});

            // Act & Assert — { a: string } | {} on input with extra keys
            expect( mod.assertEmpty({ a : 'hello', extra : 1 })).toEqual({ a : 'hello' });
            expect( mod.assertEmpty({ onlyExtra : 1 })).toEqual({});
        });

        it( 'ranks boolean vs true literal properties and optional boolean properties accurately (#2)', async() =>
        {
            // Arrange
            const mod = await emitAndImport<{
                assertOptBool        : ( v: unknown ) => any
                assertOptBoolRelaxed : ( v: unknown ) => any
                assertLitVsBool      : ( v: unknown ) => any
            }>( `
                import { assert } from '../src/index.js';
                type OptBoolHeavy = { a: string; b?: boolean; c?: boolean; d?: boolean };
                type ReqBoolPair = { a: string; b: boolean };
                type BoolUnion = OptBoolHeavy | ReqBoolPair;

                type LitVsBool =
                    | { a: string; b: boolean; opt?: string }
                    | { a: string; b: true; tag?: string };

                export const assertOptBool = ( v: unknown ) => assert<BoolUnion>( v, 'strip' );
                export const assertOptBoolRelaxed = ( v: unknown ) => assert<BoolUnion>( v, 'relaxed' );
                export const assertLitVsBool = ( v: unknown ) => assert<LitVsBool>( v, 'strip' );
            `, 'temp_u4_finding2' );

            // Act & Assert — { a: string; b: boolean } vs { a: string; b?: boolean; c?: boolean; d?: boolean }
            expect( mod.assertOptBool({ a : 'x', b : true })).toEqual({ a : 'x', b : true });
            expect( mod.assertOptBool({ a : 'x', b : true, c : false, d : true }))
                .toEqual({ a : 'x', b : true, c : false, d : true });
            expect( mod.assertOptBoolRelaxed({ a : 'x', b : false })).toEqual({ a : 'x', b : false });

            // Act & Assert — { a: string; b: true; tag?: string } outscores { a: string; b: boolean; opt?: string }
            // When b is true and both tag and opt are present (each arm strips 1 key and matches 3), the higher-scored true-literal arm wins!
            expect( mod.assertLitVsBool({ a : 'x', b : true, tag : 'T', opt : 'O' }))
                .toEqual({ a : 'x', b : true, tag : 'T' });
            expect( mod.assertLitVsBool({ a : 'x', b : false, opt : 'O' }))
                .toEqual({ a : 'x', b : false, opt : 'O' });
        });

        it( 'supports exclusiveKeys fast-path, collection unions, and unionResolution option (#2, #3, #5)', async() =>
        {
            // Arrange — Direct runtime tests on validators.union with exclusiveKeys and unionResolution
            const keysA = new Set([ 'a', 'opt' ]);
            const keysB = new Set([ 'b', 'count' ]);
            const armA = ( v: any, path: string, ctx: ValidationContext ) =>
            {
                const obj = validators.object( v, path, ctx, keysA );

                if( obj === false ){ return v }

                const data = validators.objectShell( obj, ctx, true );
                validators.props( obj, data, path, ctx, [[ 'a', false, validators.string ], [ 'opt', true, validators.number ]]);
                validators.stripExtras( data, ctx, keysA );

                return data;
            };
            const armB = ( v: any, path: string, ctx: ValidationContext ) =>
            {
                const obj = validators.object( v, path, ctx, keysB );

                if( obj === false ){ return v }

                const data = validators.objectShell( obj, ctx, true );
                validators.props( obj, data, path, ctx, [[ 'b', false, validators.number ], [ 'count', true, validators.number ]]);
                validators.stripExtras( data, ctx, keysB );

                return data;
            };
            const unionValidator = ( v: any, path: string, ctx: ValidationContext ) =>
                validators.union( v, path, ctx, [ armA, armB ], 'Type<ExclUnion>', true, undefined, [ 'a', 'b' ]);

            // Exclusive key Pass 1 (strip mode + outer probe propagation)
            const outerCtx: ValidationContext = {
                success    : true,
                errors     : [],
                mode       : 'strip',
                mutate     : false,
                unionProbe : { stripped : 0, matched : 0 }
            };
            const resExcl1 = unionValidator({ b : 10, extra : 'drop' }, '', outerCtx );
            expect( outerCtx.success ).toBe( true );
            expect( resExcl1 ).toEqual({ b : 10 });
            expect( outerCtx.unionProbe ).toEqual({ stripped : 1, matched : 1 });

            // Exclusive key Pass 2 coercion (from: 'query') in strip mode and relaxed mode
            const queryStripRes = assert( unionValidator, { b : 10, count : '99', extra : 'drop' }, { mode : 'strip', from : 'query' });
            expect( queryStripRes ).toEqual({ b : 10, count : 99 });

            const queryRelaxedRes = assert( unionValidator, { b : 10, count : '99', extra : 'keep' }, { mode : 'relaxed', from : 'query' });
            expect( queryRelaxedRes ).toEqual({ b : 10, count : 99, extra : 'keep' });

            // Exclusive key failure in Pass 1 + Pass 2 records error
            const failRes = validate( unionValidator, { b : 'not-a-num' }, { mode : 'strip', from : 'query' });
            expect( failRes.success ).toBe( false );

            // Direct runtime unionResolution: 'declaration-order' across is, assert, assertGuard, validate
            const guardTarget: any = { b : 10, extra : 'drop' };
            assertGuard( unionValidator, guardTarget, { mode : 'strip', unionResolution : 'declaration-order' });
            expect( guardTarget ).toEqual({ b : 10 });
            expect( is( unionValidator, { a : 'ok' }, { mode : 'strip', unionResolution : 'declaration-order' })).toBe( true );

            // End-to-End collection unions, exclusive keys, and unionResolution: 'declaration-order'
            const mod = await emitAndImport<{
                assertArrUnion : ( v: unknown ) => any
                assertExcl     : ( v: unknown ) => any
                assertSpec     : ( v: unknown ) => any
                assertDecl     : ( v: unknown ) => any
                stdDecl        : any
            }>( `
                import { assert, standardSchema } from '../src/index.js';
                type Narrow = { a: string };
                type Wide = { a: string; b: number };
                type ArrUnion = Narrow[] | Wide[];
                type ExclUnion = { kindA: string; count?: number } | { kindB: number; flag?: boolean };
                type OrderUnion = Narrow | Wide;

                export const assertArrUnion = ( v: unknown ) => assert<ArrUnion>( v, 'strip' );
                export const assertExcl = ( v: unknown ) => assert<ExclUnion>( v, 'strip' );
                export const assertSpec = ( v: unknown ) => assert<OrderUnion>( v, { mode: 'strip', unionResolution: 'specificity' } );
                export const assertDecl = ( v: unknown ) => assert<OrderUnion>( v, { mode: 'strip', unionResolution: 'declaration-order' } );
                export const stdDecl = standardSchema<OrderUnion>( { mode: 'strip', unionResolution: 'declaration-order' } );
            `, 'temp_u4_all5_features' );

            expect( mod.assertArrUnion([ { a : 'x', b : 1, extra : true } ]))
                .toEqual([ { a : 'x', b : 1 } ]);
            expect( mod.assertExcl({ kindB : 7, flag : true, extra : 'drop' }))
                .toEqual({ kindB : 7, flag : true });

            // With specificity, Wide wins and preserves b: 1; with declaration-order, Narrow wins first in Pass 2 strip without best-fit probing
            expect( mod.assertSpec({ a : 'x', b : 1, extra : true })).toEqual({ a : 'x', b : 1 });
            expect( mod.assertDecl({ a : 'x', b : 1, extra : true })).toEqual({ a : 'x' });
            expect( mod.stdDecl['~standard'].validate({ a : 'x', b : 1, extra : true })).toEqual({
                value : { a : 'x' }
            });
        });
    });
});
