import { describe, it, expect } from 'vitest';
import { validators, getOrCompileSchema, validate, ValidationContext } from '../src/runtime/validators.js';

function context( mode: ValidationContext['mode'] = 'strict' ): ValidationContext
{
    return { success : true, errors : [], mode, root : undefined };
}

/** Mirrors what the transformer emits for a closed object shape. */
function closedObject( keys: string[], props: [string, boolean, Function][])
{
    return ( v: any, path: string, ctx: ValidationContext ) =>
    {
        const obj = validators.object( v, path, ctx, keys );

        if( obj === false ){ return v }

        const data = validators.objectShell( obj, ctx, true );
        validators.props( obj, data, path, ctx, props );
        validators.stripExtras( data, ctx, keys );

        return data;
    };
}

describe( 'objectShell', () =>
{
    it( 'should not copy the input for a closed shape in strict mode', () =>
    {
        const input = { a : 1, extra : 'x' };

        expect( validators.objectShell( input, context( 'strict' ), true )).toEqual({});
    });

    it( 'should copy the input for a closed shape in relaxed mode', () =>
    {
        const input = { a : 1, extra : 'x' };
        const shell = validators.objectShell( input, context( 'relaxed' ), true );

        expect( shell ).toEqual( input );
        expect( shell ).not.toBe( input );
    });

    it( 'should still copy the input for an open shape', () =>
    {
        const input = { a : 1, extra : 'x' };

        expect( validators.objectShell( input, context( 'strict' ))).toEqual( input );
    });

    it( 'should return the input itself when mutating', () =>
    {
        const input = { a : 1 };
        const ctx = { ...context( 'strict' ), mutate : true };

        expect( validators.objectShell( input, ctx, true )).toBe( input );
    });

    it( 'should keep unknown keys of a closed shape in relaxed mode end to end', () =>
    {
        const check = closedObject(['a'], [['a', false, validators.number]]);
        const result = validate( check, { a : 1, extra : 'x' }, 'relaxed' );

        expect( result.success ).toBe( true );
        expect( result.data ).toEqual({ a : 1, extra : 'x' });
    });

    it( 'should reject unknown keys of a closed shape in strict mode', () =>
    {
        const check = closedObject(['a'], [['a', false, validators.number]]);
        const result = validate( check, { a : 1, extra : 'x' });

        expect( result.success ).toBe( false );
        expect( result.errors[0].error ).toBe( 'PropertyNotAllowed<extra>' );
    });

    it( 'should carry unknown keys through a schema that allows additional properties', () =>
    {
        const check = getOrCompileSchema({
            type                 : 'object',
            properties           : { a : { type : 'number' }},
            additionalProperties : true
        });

        const result = validate( check, { a : 1, extra : 'x' });

        expect( result.success ).toBe( true );
        expect( result.data ).toEqual({ a : 1, extra : 'x' });
    });

    it( 'should validate unknown keys through a schema with an additionalProperties schema', () =>
    {
        const check = getOrCompileSchema({
            type                 : 'object',
            properties           : { a : { type : 'number' }},
            additionalProperties : { type : 'string' }
        });

        expect( validate( check, { a : 1, extra : 'x' }).data ).toEqual({ a : 1, extra : 'x' });
        expect( validate( check, { a : 1, extra : 2 }).success ).toBe( false );
    });
});
