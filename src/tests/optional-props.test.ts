import { describe, it, expect } from 'vitest';
import { validators, ValidationContext } from '../runtime/validators.js';
import { compileAndTransform } from './helpers/compile.js';

function context( mode: ValidationContext['mode'] = 'strict' ): ValidationContext
{
    return { success : true, errors : [], mode, root : undefined };
}

describe( 'Optional properties', () =>
{
    const compile = ( code: string ) => compileAndTransform( code, 'temp_optional_props' );

    describe( 'runtime', () =>
    {
        it( 'should leave an absent optional property off the result entirely', () =>
        {
            const ctx = context();
            const data: any = {};

            // `port?: number` resolves to `number | undefined` under strict, and the undefined arm used
            // to succeed and write the key back as an explicit undefined.
            validators.props({}, data, 'o', ctx, [
                ['port', true, ( v: any, p: string, c: ValidationContext ) =>
                    validators.union( v, p, c, [validators.number, validators.undefined])]
            ]);

            expect( ctx.success ).toBe( true );
            expect( Object.keys( data )).toEqual([]);
            expect( 'port' in data ).toBe( false );
        });

        it( 'should not record an error for an absent optional property', () =>
        {
            const ctx = context();
            const data: any = {};

            validators.props({}, data, 'o', ctx, [['email', true, validators.string]]);

            expect( ctx.success ).toBe( true );
            expect( ctx.errors ).toEqual([]);
        });

        it( 'should still run the validator for an absent optional property carrying a default', () =>
        {
            const ctx = context();
            const data: any = {};
            const withDefault = ( v: any ) => v === undefined ? 8080 : v;

            validators.props({}, data, 'o', ctx, [['port', true, withDefault, true]]);

            expect( data.port ).toBe( 8080 );
        });

        it( 'should still validate an optional property that is present', () =>
        {
            const ctx = context();
            const data: any = {};

            validators.props({ port : 'nope' }, data, 'o', ctx, [['port', true, validators.number]]);

            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0]).toEqual({ path : 'o.port', error : 'Type<number>', value : 'nope' });
        });
    });

    describe( 'emit', () =>
    {
        it( 'should not mark a plain optional property as having a default', () =>
        {
            const code = `
                import { validate } from './src/index.js';
                const res = validate<{ port?: number }>({});
            `;

            expect( compile( code )).toContain( '["port", true,' );
            expect( compile( code )).not.toContain( ', true]' );
        });

        it( 'should mark an optional property with a Default tag', () =>
        {
            const code = `
                import { validate, tag } from './src/index.js';
                const res = validate<{ port?: number & tag.Default<8080> }>({});
            `;

            expect( compile( code )).toMatch( /\["port", true, __val_[0-9a-f]+, true\]/ );
        });

        it( 'should mark a required property with a Default tag', () =>
        {
            const code = `
                import { validate, tag } from './src/index.js';
                const res = validate<{ retries: number & tag.Default<5> }>({});
            `;

            expect( compile( code )).toMatch( /\["retries", false, __val_[0-9a-f]+, true\]/ );
        });
    });

    describe( 'runtime mixed shapes', () =>
    {
        it( 'should skip plain optionals and fill Defaulted ones in the same object', () =>
        {
            const ctx = context();
            const data: any = {};
            const withDefault = ( v: any ) => ( v === undefined ? 8080 : v );

            validators.props({}, data, 'o', ctx, [
                ['host', true, validators.string],
                ['port', true, withDefault, true]
            ]);

            expect( ctx.success ).toBe( true );
            expect( data ).toEqual({ port : 8080 });
            expect( 'host' in data ).toBe( false );
        });

        it( 'should not roll back a Defaulted optional that fails its constraint', () =>
        {
            const ctx = context();
            const data: any = {};
            const failing = ( _v: any, path: string, c: ValidationContext ) =>
            {
                c.success = false;
                c.errors.push({ path, error : 'Minimum<10>', value : 1 });

                return 1;
            };

            validators.props({}, data, 'o', ctx, [['n', true, failing, true]]);

            expect( ctx.success ).toBe( false );
            expect( ctx.errors ).toHaveLength( 1 );
            expect( 'n' in data ).toBe( false );
        });
    });
});
