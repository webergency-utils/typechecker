import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import * as path from 'path';
import * as fs from 'fs';
import { emitAndImport, emitAndRequire, compileAndTransform } from './helpers/compile.js';

const require = createRequire( import.meta.url );

describe( 'Built ESM and CJS Dual Artifact Testing', () =>
{
    it( 'should ensure built dist files exist for both ESM (.js) and CJS (.cjs)', () =>
    {
        const files = [
            'dist/index.js',
            'dist/index.cjs',
            'dist/index.d.ts',
            'dist/index.d.cts',
            'dist/plugin.js',
            'dist/plugin.cjs',
            'dist/plugin.d.ts',
            'dist/plugin.d.cts',
            'dist/transformer.js',
            'dist/transformer.cjs',
            'dist/transformer.d.ts',
            'dist/transformer.d.cts',
            'dist/runtime/index.js',
            'dist/runtime/index.cjs',
            'dist/runtime/validators.js',
            'dist/runtime/validators.cjs',
            'dist/runtime/parse-runtime.js',
            'dist/runtime/parse-runtime.cjs',
            'dist/runtime/serializer-runtime.js',
            'dist/runtime/serializer-runtime.cjs'
        ];

        for( const file of files )
        {
            const absPath = path.resolve( file );
            expect( fs.existsSync( absPath ), `Expected built artifact ${file} to exist` ).toBe( true );
        }
    });

    it( 'should require CommonJS dist/index.cjs successfully', () =>
    {
        const indexCjs = require( path.resolve( './dist/index.cjs' ));
        expect( indexCjs ).toBeDefined();
        expect( typeof indexCjs.validate ).toBe( 'function' );
        expect( typeof indexCjs.is ).toBe( 'function' );
        expect( typeof indexCjs.assert ).toBe( 'function' );
        expect( typeof indexCjs.validators ).toBe( 'object' );
    });

    it( 'should require CommonJS dist/transformer.cjs successfully', () =>
    {
        const transformerCjs = require( path.resolve( './dist/transformer.cjs' ));
        expect( transformerCjs ).toBeDefined();
        const tf = transformerCjs.default || transformerCjs;
        expect( typeof tf ).toBe( 'function' );
    });

    it( 'should require CommonJS dist/plugin.cjs successfully', () =>
    {
        const pluginCjs = require( path.resolve( './dist/plugin.cjs' ));
        expect( pluginCjs ).toBeDefined();
        const pluginInit = pluginCjs.default || pluginCjs;
        expect( typeof pluginInit ).toBe( 'function' );
    });

    it( 'should dynamically import ESM dist/index.js successfully', async () =>
    {
        const indexEsm = await import( path.resolve( './dist/index.js' ));
        expect( indexEsm ).toBeDefined();
        expect( typeof indexEsm.validate ).toBe( 'function' );
        expect( typeof indexEsm.is ).toBe( 'function' );
        expect( typeof indexEsm.assert ).toBe( 'function' );
        expect( typeof indexEsm.validators ).toBe( 'object' );
    });

    it( 'should transform and execute validation identically in ESM and CJS modes', async () =>
    {
        const code = `
            import { validate, constraint, format } from '../src/index.js';

            export interface User {
                id: string & format.UUID;
                name: string & constraint.MinLength<2>;
                age: number & constraint.Minimum<18>;
            }

            export function checkUser( input: unknown ) {
                return validate<User>( input );
            }
        `;

        const esmMod = await emitAndImport<{ checkUser : ( input: unknown ) => any }>( code, 'parity_esm' );
        const cjsMod = emitAndRequire<{ checkUser : ( input: unknown ) => any }>( code, 'parity_cjs' );

        const validUser = {
            id   : '550e8400-e29b-41d4-a716-446655440000',
            name : 'Alice',
            age  : 25
        };

        const invalidUser = {
            id   : 'not-a-uuid',
            name : 'A',
            age  : 15
        };

        // Test ESM output
        const esmValidResult = esmMod.checkUser( validUser );
        const esmInvalidResult = esmMod.checkUser( invalidUser );

        expect( esmValidResult.success ).toBe( true );
        expect( esmValidResult.data ).toEqual( validUser );
        expect( esmInvalidResult.success ).toBe( false );
        expect( esmInvalidResult.errors.length ).toBeGreaterThan( 0 );

        // Test CJS output
        const cjsValidResult = cjsMod.checkUser( validUser );
        const cjsInvalidResult = cjsMod.checkUser( invalidUser );

        expect( cjsValidResult.success ).toBe( true );
        expect( cjsValidResult.data ).toEqual( validUser );
        expect( cjsInvalidResult.success ).toBe( false );
        expect( cjsInvalidResult.errors.length ).toBeGreaterThan( 0 );

        // Verify ESM and CJS return identical structure
        expect( cjsValidResult ).toEqual( esmValidResult );
        expect( cjsInvalidResult.errors.length ).toBe( esmInvalidResult.errors.length );
    });

    it( 'should produce valid AST transformation output for both ESM and CJS targets', () =>
    {
        const snippet = `
            import { validate } from './src/index.js';
            interface Person { name: string; age: number; }
            const res = validate<Person>({ name: 'Bob', age: 30 });
        `;

        const esmAst = compileAndTransform( snippet, 'ast_esm_test', 'esm' );
        const cjsAst = compileAndTransform( snippet, 'ast_cjs_test', 'cjs' );

        expect( esmAst ).toContain( '__val_' );
        expect( cjsAst ).toContain( '__val_' );
    });
});
