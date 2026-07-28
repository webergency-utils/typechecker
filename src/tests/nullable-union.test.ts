import { describe, it, expect } from 'vitest';
import { validators, validate, ValidationContext } from '../runtime/validators.js';
import { compileAndTransform } from './helpers/compile.js';

function context( mode: ValidationContext['mode'] = 'strict' ): ValidationContext
{
    return { success : true, errors : [], mode, root : undefined };
}

describe( 'Nullable unions', () =>
{
    const compile = ( code: string ) => compileAndTransform( code, 'temp_nullable_union' );

    function compileType( type: string ): string
    {
        return compile( `
            import { validate } from './src/index.js';
            const input: unknown = null;
            const res = validate<${type}>( input );
        ` );
    }

    describe( 'emit', () =>
    {
        it( 'should emit optional for T | undefined', () =>
        {
            expect( compileType( 'number | undefined' )).toContain( 'validators.optional(v, path, ctx,' );
        });

        it( 'should emit nullable for T | null', () =>
        {
            expect( compileType( 'number | null' )).toContain( 'validators.nullable(v, path, ctx,' );
        });

        it( 'should emit nullish for T | null | undefined', () =>
        {
            expect( compileType( 'number | null | undefined' )).toContain( 'validators.nullish(v, path, ctx,' );
        });

        it( 'should keep the generic union for two real arms', () =>
        {
            const compiled = compileType( 'string | number' );

            expect( compiled ).toContain( 'validators.union(' );
            expect( compiled ).not.toContain( 'validators.optional(' );
        });

        it( 'should keep the generic union for boolean | undefined', () =>
        {
            // `boolean` reaches the resolver as `true | false`, leaving two real arms.
            const compiled = compileType( 'boolean | undefined' );

            expect( compiled ).toContain( 'validators.union(' );
        });

        it( 'should emit nullable for an object arm', () =>
        {
            const compiled = compileType( '{ a: string } | null' );

            expect( compiled ).toContain( 'validators.nullable(v, path, ctx,' );
        });
    });

    describe( 'runtime', () =>
    {
        it( 'should pass undefined through optional without touching the inner validator', () =>
        {
            const ctx = context();
            let called = false;
            const inner = () => { called = true };

            expect( validators.optional( undefined, 'x', ctx, inner )).toBe( undefined );
            expect( called ).toBe( false );
            expect( ctx.success ).toBe( true );
        });

        it( 'should delegate a present value to the inner validator', () =>
        {
            const ctx = context();

            expect( validators.optional( 5, 'x', ctx, validators.number )).toBe( 5 );
            expect( ctx.success ).toBe( true );
        });

        it( 'should report the inner type directly rather than a union summary', () =>
        {
            const ctx = context();

            validators.optional( 'nope', 'x', ctx, validators.number );

            expect( ctx.success ).toBe( false );
            expect( ctx.errors ).toEqual([{ path : 'x', error : 'Type<number>', value : 'nope' }]);
        });

        it( 'should pass null through nullable but reject undefined', () =>
        {
            const passing = context();
            expect( validators.nullable( null, 'x', passing, validators.number )).toBe( null );
            expect( passing.success ).toBe( true );

            const failing = context();
            validators.nullable( undefined, 'x', failing, validators.number );
            expect( failing.success ).toBe( false );
        });

        it( 'should pass both null and undefined through nullish', () =>
        {
            const ctx = context();

            expect( validators.nullish( null, 'x', ctx, validators.number )).toBe( null );
            expect( validators.nullish( undefined, 'x', ctx, validators.number )).toBe( undefined );
            expect( ctx.success ).toBe( true );
        });

        it( 'should still coerce through the inner validator when from is set', () =>
        {
            const result = validate(
                ( v: any, path: string, ctx: ValidationContext ) => validators.optional( v, path, ctx, validators.number ),
                '5',
                { from : 'query' }
            );

            expect( result.success ).toBe( true );
            expect( result.data ).toBe( 5 );
        });
    });
});
