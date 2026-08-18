import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import
{
    reviveTree as walkRevive,
    applyNodeTransform,
    makeTransformContext,
    TransformWalkError
}
    from '../src/runtime/transform.js';
import
{
    reviveTree,
    applyParseTransform,
    ParseError
}
    from '../src/runtime/parse-runtime.js';
import { applySerializeTransform, SerializationError } from '../src/runtime/serializer-runtime.js';
import { validators, assert, validate, is, assertGuard } from '../src/runtime/validators.js';
import type { TransformFn, TransformContext } from '../src/runtime/transform.js';

describe( 'transform runtime', () =>
{
    beforeEach(() =>
    {
    });

    afterEach(() =>
    {
        vi.clearAllMocks();
    });

    describe( 'reviveTree', () =>
    {
        it( 'should walk JSON text-equivalent trees bottom-up with root key ""', () =>
        {
            // Arrange
            const seen: { key : string, value : unknown, self : unknown }[] = [];
            const input = { a : 1, nested : { b : 2 } };

            // Act
            const result = walkRevive( input, function( key, value )
            {
                seen.push({ key, value, self : this });

                return value;
            });

            // Assert
            expect( result ).toEqual({ a : 1, nested : { b : 2 } });
            expect( seen[0]).toMatchObject({ key : 'a', value : 1 });
            expect( seen[1]).toMatchObject({ key : 'b', value : 2 });
            expect( seen[2]).toMatchObject({ key : 'nested' });
            expect( seen[3]?.key ).toBe( '' );
            expect( seen[3]?.self ).toEqual({ '' : input });
        });

        it( 'should delete properties when the reviver returns undefined', () =>
        {
            // Arrange
            const input = { keep : 1, drop : 2, items : [ 'a', 'b', 'c' ] };

            // Act
            const result = walkRevive( input, ( key, value ) =>
            {
                if( key === 'drop' || key === '1' ){ return undefined }

                return value;
            });

            // Assert
            expect( result ).toEqual({ keep : 1, items : [ 'a', , 'c' ] });
            expect( 1 in result.items ).toBe( false );
        });

        it( 'should walk empty arrays and assign transformed object keys', () =>
        {
            // Arrange / Act
            const empty = walkRevive([], ( key, value ) => value );
            const renamed = walkRevive({ a : 1 }, ( key, value ) => key === 'a' ? 2 : value );

            // Assert
            expect( empty ).toEqual([]);
            expect( renamed ).toEqual({ a : 2 });
        });

        it( 'should wrap generic reviver throws as TransformWalkError with path', () =>
        {
            // Arrange
            const input = { user : { name : 'Ada' } };

            // Act / Assert
            expect(() => walkRevive( input, ( key, value ) =>
            {
                if( key === 'name' ){ throw new Error( 'bad' ) }

                return value;
            })).toThrow( TransformWalkError );

            try
            {
                walkRevive( input, ( key, value ) =>
                {
                    if( key === 'name' ){ throw 'nope' }

                    return value;
                });
            }
            catch( e )
            {
                expect( e ).toBeInstanceOf( TransformWalkError );
                expect(( e as TransformWalkError ).path ).toBe( 'user.name' );
                expect(( e as TransformWalkError ).message ).toBe( 'nope' );
            }
        });

        it( 'should rethrow TransformWalkError and path-bearing errors from the reviver', () =>
        {
            // Arrange
            const walkErr = new TransformWalkError( 'x', 'inner' );
            const pathErr = { path : 'named', message : 'kept' };

            // Act / Assert
            expect(() => walkRevive( 1, () => { throw walkErr } )).toThrow( walkErr );
            expect(() => walkRevive( 1, () => { throw pathErr } )).toThrow( pathErr );
        });

        it( 'should wrap TransformWalkError as ParseError in the parse helper', () =>
        {
            // Arrange / Act / Assert
            expect(() => reviveTree({ a : 1 }, ( key, value ) =>
            {
                if( key === 'a' ){ throw new Error( 'boom' ) }

                return value;
            })).toThrow( 'Parse error at "a": boom' );
        });

        it( 'should rethrow ParseError from the parse helper', () =>
        {
            // Arrange
            const err = new ParseError( 'z', 'Type<string>' );

            // Act / Assert
            expect(() => reviveTree( 'x', () => { throw err } )).toThrow( err );
        });
    });

    describe( 'applyNodeTransform', () =>
    {
        it( 'should skip when transform is missing or the value is nullish', () =>
        {
            // Arrange
            const fn: TransformFn = () => 'nope';

            // Act / Assert
            expect( applyNodeTransform( 1, '', undefined, 'number', [], 1 )).toBe( 1 );
            expect( applyNodeTransform( undefined, '', fn, 'number', [], {} )).toBeUndefined();
            expect( applyNodeTransform( null, '', fn, 'number', [], {} )).toBeNull();
            expect( applyNodeTransform( 1, '', [], 'number', [], 1 )).toBe( 1 );
        });

        it( 'should pipe transform arrays left to right', () =>
        {
            // Arrange
            const seen: string[] = [];
            const a: TransformFn = ( value ) =>
            {
                seen.push( 'a' );

                return String( value ) + 'a';
            };
            const b: TransformFn = ( value ) =>
            {
                seen.push( 'b' );

                return String( value ) + 'b';
            };

            // Act
            const result = applyNodeTransform( 'x', 'name', [a, b], 'string', ['html'], { name : 'x' });

            // Assert
            expect( result ).toBe( 'xab' );
            expect( seen ).toEqual([ 'a', 'b' ]);
        });
    });

    describe( 'makeTransformContext', () =>
    {
        it( 'should describe root, dotted, index, and broken paths', () =>
        {
            // Arrange
            const root = { items : [ { n : 1 } ], name : 'Ada' };

            // Act
            const rootCtx = makeTransformContext( '', 'Object', [], root );
            const named = makeTransformContext( 'name', 'string', ['html'], root );
            const dotted = makeTransformContext( '.name', 'string', [], root );
            const leadingDotOnly = makeTransformContext( '.', 'string', [], root );
            const indexed = makeTransformContext( 'items[0].n', 'number', [], root );
            const rootIndex = makeTransformContext( '[0]', 'string', [], [ 'a' ]);
            const nanIndex = makeTransformContext( '[nope]', 'string', [], [] );
            const unclosed = makeTransformContext( 'foo[bar', 'string', [], { 'foo[bar' : 1 } );
            const missing = makeTransformContext( 'a.b.c', 'string', [], { a : 1 } );

            const dottedDots = makeTransformContext( 'a..b', 'string', [], { a : { b : 1 } } );
            const indexThenName = makeTransformContext( '[0].n', 'number', [], [ { n : 1 } ]);
            const brokenMid = makeTransformContext( 'gone.child.x', 'string', [], { gone : null } );
            const scalarRoot = makeTransformContext( 'a.b', 'string', [], 5 );

            // Assert
            expect( rootCtx ).toEqual({ key : '', path : '', parent : undefined, root, tags : [], type : 'Object' });
            expect( named ).toMatchObject({ key : 'name', path : 'name', parent : root, tags : ['html'], type : 'string' });
            expect( dotted.key ).toBe( 'name' );
            expect( leadingDotOnly.key ).toBe( '' );
            expect( leadingDotOnly.parent ).toBe( root );
            expect( indexed ).toMatchObject({ key : 'n', path : 'items[0].n', parent : root.items[0] });
            expect( makeTransformContext( 'items[0]', 'Object', [], root )).toMatchObject({
                key    : 'items',
                path   : 'items[0]',
                index  : 0,
                parent : root.items
            });
            expect( rootIndex ).toMatchObject({ key : '', path : '[0]', index : 0, parent : [ 'a' ] });
            expect( nanIndex.index ).toBeUndefined();
            expect( unclosed.key ).toBe( '[bar' );
            expect( missing.parent ).toBeUndefined();
            expect( dottedDots.key ).toBe( 'b' );
            expect( indexThenName ).toMatchObject({ key : 'n', parent : { n : 1 } });
            expect( brokenMid.parent ).toBeUndefined();
            expect( scalarRoot.parent ).toBeUndefined();
        });
    });

    describe( 'parse and serialize wrappers', () =>
    {
        it( 'should wrap transform throws as ParseError and SerializationError', () =>
        {
            // Arrange
            const boom: TransformFn = () => { throw new Error( 'bad' ) };
            const asString: TransformFn = () => { throw 'raw' };

            // Act / Assert
            expect(() => applyParseTransform( 1, 'age', boom, 'number', [], { age : 1 }))
                .toThrow( 'Parse error at "age": bad' );
            expect(() => applyParseTransform( 1, 'age', asString, 'number', [], { age : 1 }))
                .toThrow( 'Parse error at "age": raw' );
            expect(() => applySerializeTransform( 1, 'age', boom, 'number', [], { age : 1 }))
                .toThrow( 'Serialization error at "age": bad' );
            expect(() => applySerializeTransform( 1, 'age', asString, 'number', [], { age : 1 }))
                .toThrow( 'Serialization error at "age": raw' );
        });

        it( 'should rethrow ParseError and SerializationError from the transform', () =>
        {
            // Arrange
            const parseErr = new ParseError( 'p', 'Type<number>' );
            const serErr = new SerializationError( 's', 'Type<string>' );

            // Act / Assert
            expect(() => applyParseTransform( 1, 'p', () => { throw parseErr }, 'number', [], {} )).toThrow( parseErr );
            expect(() => applySerializeTransform( 1, 's', () => { throw serErr }, 'number', [], {} )).toThrow( serErr );
        });
    });

    describe( 'validators.applyOptionTransform', () =>
    {
        it( 'should skip when transform is unset or the value is nullish', () =>
        {
            // Arrange
            const ctx = { success : true, errors : [], mode : 'strict' as const, root : {} };

            // Act / Assert
            expect( validators.applyOptionTransform( 1, '', ctx, [], 'number' )).toBe( 1 );
            expect( validators.applyOptionTransform( undefined, '', { ...ctx, transform : () => 2 }, [], 'number' )).toBeUndefined();
            expect( validators.applyOptionTransform( null, '', { ...ctx, transform : () => 2 }, [], 'number' )).toBeNull();
        });

        it( 'should apply a transform and report thrown errors', () =>
        {
            // Arrange
            const okCtx = {
                success   : true,
                errors    : [] as { path : string, error : string, value : any }[],
                mode      : 'strict' as const,
                root      : { n : 1 },
                transform : (( value ) => Number( value ) + 1 ) as TransformFn
            };
            const errCtx = {
                success   : true,
                errors    : [] as { path : string, error : string, value : any }[],
                mode      : 'strict' as const,
                root      : { n : 1 },
                transform : (() => { throw new Error( 'nope' ) }) as TransformFn
            };
            const rawCtx = {
                success   : true,
                errors    : [] as { path : string, error : string, value : any }[],
                mode      : 'strict' as const,
                root      : { n : 1 },
                transform : (() => { throw 'raw' }) as TransformFn
            };

            // Act
            const shifted = validators.applyOptionTransform( 1, 'n', okCtx, ['html'], 'number' );
            const failed = validators.applyOptionTransform( 1, 'n', errCtx, [], 'number' );
            const raw = validators.applyOptionTransform( 1, 'n', rawCtx, [], 'number' );

            // Assert
            expect( shifted ).toBe( 2 );
            expect( failed ).toBe( 1 );
            expect( errCtx.success ).toBe( false );
            expect( errCtx.errors[0]?.error ).toBe( 'nope' );
            expect( rawCtx.errors[0]?.error ).toBe( 'raw' );
            expect( raw ).toBe( 1 );
        });
    });

    describe( 'assert / validate / is / assertGuard', () =>
    {
        const identity = ( v: any ) => v;
        const bump: TransformFn = ( value, ctx: TransformContext ) =>
        {
            if( ctx.type === 'number' && typeof value === 'number' ){ return value + 1 }

            return value;
        };
        const numberCheck = ( v: any, path: string, ctx: any ) =>
        {
            v = validators.number( v, path, ctx );

            if( ctx.success ){ v = validators.applyOptionTransform( v, path, ctx, [], 'number' ) }

            return v;
        };

        it( 'should apply transform on assert and validate but not is or assertGuard', () =>
        {
            // Arrange
            const opts = { transform : bump };

            // Act
            const asserted = assert( numberCheck, 1, opts );
            const validated = validate( numberCheck, 1, opts );
            const guarded = is( numberCheck, 1, opts as any );

            // Assert
            expect( asserted ).toBe( 2 );
            expect( validated.data ).toBe( 2 );
            expect( guarded ).toBe( true );
            expect(() => assertGuard( numberCheck, 1, opts as any )).not.toThrow();
        });

        it( 'should keep identity validators working without a transform', () =>
        {
            // Act / Assert
            expect( assert( identity, 7 )).toBe( 7 );
            expect( validate( identity, 7 ).data ).toBe( 7 );
        });
    });
});
