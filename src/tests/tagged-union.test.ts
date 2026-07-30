import { describe, it, expect } from 'vitest';
import { validators, validate, ValidationContext } from '../runtime/validators.js';
import { compileAndTransform } from './helpers/compile.js';

function context( mode: ValidationContext['mode'] = 'strict' ): ValidationContext
{
    return { success : true, errors : [], mode, root : undefined };
}

describe( 'Tagged unions', () =>
{
    const compile = ( code: string ) => compileAndTransform( code, 'temp_tagged_union' );

    function compileType( declarations: string, type: string ): string
    {
        return compile( `
            import { validate } from './src/index.js';
            ${declarations}
            const input: unknown = null;
            const res = validate<${type}>( input );
        ` );
    }

    describe( 'emit', () =>
    {
        it( 'should dispatch on a shared string discriminant', () =>
        {
            const compiled = compileType(
                `interface Circle { kind: 'circle'; r: number }
                 interface Square { kind: 'square'; s: number }`,
                'Circle | Square'
            );

            expect( compiled ).toContain( 'validators.taggedUnion(v, path, ctx, "kind", byTag' );
            expect( compiled ).toContain( '"circle"' );
            expect( compiled ).toContain( '"square"' );
        });

        it( 'should build the lookup table once outside the validating arrow', () =>
        {
            const compiled = compileType(
                `interface A { kind: 'a'; x: number }
                 interface B { kind: 'b'; y: number }`,
                'A | B'
            );

            // The Map is applied to the outer arrow rather than constructed inside the validating one.
            expect( compiled ).toMatch( /\(byTag => \(v, path, ctx\) => validators\.taggedUnion/ );
            expect( compiled ).toMatch( /\)\)\(new Map\(/ );
        });

        it( 'should dispatch on a numeric discriminant', () =>
        {
            const compiled = compileType(
                `interface One { code: 1; x: number }
                 interface Two { code: 2; y: number }`,
                'One | Two'
            );

            expect( compiled ).toContain( 'validators.taggedUnion(v, path, ctx, "code", byTag' );
        });

        it( 'should fall back to a plain union without a shared discriminant', () =>
        {
            const compiled = compileType(
                `interface A { a: string }
                 interface B { b: string }`,
                'A | B'
            );

            expect( compiled ).toContain( 'validators.union(' );
            expect( compiled ).not.toContain( 'taggedUnion' );
        });

        it( 'should fall back to a plain union when the literal is shared by both arms', () =>
        {
            const compiled = compileType(
                `interface A { kind: 'same'; x: number }
                 interface B { kind: 'same'; y: string }`,
                'A | B'
            );

            expect( compiled ).not.toContain( 'taggedUnion' );
        });

        it( 'should fall back to a plain union when an arm is not an object', () =>
        {
            const compiled = compileType(
                "interface A { kind: 'a'; x: number }",
                'A | string'
            );

            expect( compiled ).not.toContain( 'taggedUnion' );
        });
    });

    describe( 'runtime', () =>
    {
        const circle = ( v: any, path: string, ctx: ValidationContext ) =>
        {
            const obj = validators.object( v, path, ctx, ['kind', 'r']);

            if( obj === false ){ return v }

            const data = validators.objectShell( obj, ctx, true );
            validators.props( obj, data, path, ctx, [
                ['kind', false, ( val: any, p: string, c: ValidationContext ) => validators.literal( val, p, c, 'circle' )],
                ['r', false, validators.number]
            ]);

            return data;
        };

        const square = ( v: any, path: string, ctx: ValidationContext ) =>
        {
            const obj = validators.object( v, path, ctx, ['kind', 's']);

            if( obj === false ){ return v }

            const data = validators.objectShell( obj, ctx, true );
            validators.props( obj, data, path, ctx, [
                ['kind', false, ( val: any, p: string, c: ValidationContext ) => validators.literal( val, p, c, 'square' )],
                ['s', false, validators.string]
            ]);

            return data;
        };

        const byTag = new Map<any, Function>([['circle', circle], ['square', square]]);
        const shape = ( v: any, path: string, ctx: ValidationContext ) =>
            validators.taggedUnion( v, path, ctx, 'kind', byTag, 'Type<Shape>' );

        it( 'should validate the arm the tag selects', () =>
        {
            const result = validate( shape, { kind : 'square', s : 'wide' });

            expect( result.success ).toBe( true );
            expect( result.data ).toEqual({ kind : 'square', s : 'wide' });
        });

        it( 'should report the selected arm errors rather than a union summary', () =>
        {
            const ctx = context();

            shape({ kind : 'circle', r : 'nope' }, '', ctx );

            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0].error ).toBe( 'Type<number>' );
            expect( ctx.errors[0].path ).toBe( 'r' );
        });

        it( 'should fall back to the union for an unknown tag', () =>
        {
            const ctx = context();

            shape({ kind : 'hexagon', r : 1 }, '', ctx );

            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0].error ).toBe( 'Type<Shape>' );
            expect( ctx.errors[0].issues?.length ).toBeGreaterThan( 0 );
        });

        it( 'should fall back to the union for a non-object value', () =>
        {
            const ctx = context();

            shape( 'circle', '', ctx );

            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0].error ).toBe( 'Type<Shape>' );
        });

        it( 'should still resolve a numeric tag arriving as a query string', () =>
        {
            const one = ( v: any, path: string, ctx: ValidationContext ) =>
            {
                const obj = validators.object( v, path, ctx, ['code']);

                if( obj === false ){ return v }

                const data = validators.objectShell( obj, ctx, true );
                validators.props( obj, data, path, ctx, [
                    ['code', false, ( val: any, p: string, c: ValidationContext ) => validators.literal( val, p, c, 1 )]
                ]);

                return data;
            };

            const numeric = new Map<any, Function>([[1, one]]);
            const check = ( v: any, path: string, ctx: ValidationContext ) =>
                validators.taggedUnion( v, path, ctx, 'code', numeric, 'Type<Coded>' );

            // The tag is still the string "1" at dispatch time, so this leans on the union fallback.
            const result = validate( check, { code : '1' }, { from : 'query' });

            expect( result.success ).toBe( true );
            expect( result.data ).toEqual({ code : 1 });
        });
    });
});
