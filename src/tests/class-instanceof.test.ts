import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import * as esbuild from 'esbuild';
import { compileAndTransform, emitAndImport, emitWithTransformer } from './helpers/compile.js';

describe( 'Nominal class types', () =>
{
    const compile = ( code: string ) => compileAndTransform( code, 'temp_class_instanceof' );

    describe( 'emit', () =>
    {
        it( 'should emit instanceof against a same-file class', () =>
        {
            const compiled = compile( `
                import { validate } from './src/index.js';
                class Mailer { send() {} }
                const res = validate<Mailer>( null as any );
            ` );

            expect( compiled ).toContain( 'validators.instanceOf(v, path, ctx, Mailer)' );
            expect( compiled ).not.toContain( 'validators.object(' );
        });

        it( 'should emit instanceof for a class property', () =>
        {
            const compiled = compile( `
                import { validate } from './src/index.js';
                class Mailer { send() {} }
                type Payload = { mailer: Mailer };
                const res = validate<Payload>({ mailer: null as any });
            ` );

            expect( compiled ).toContain( 'validators.instanceOf(v, path, ctx, Mailer)' );
        });

        it( 'should keep interfaces structural', () =>
        {
            const compiled = compile( `
                import { validate } from './src/index.js';
                interface User { id: string }
                const res = validate<User>({ id: 'a' });
            ` );

            expect( compiled ).toContain( 'validators.object(' );
            expect( compiled ).not.toContain( 'validators.instanceOf(' );
        });

        it( 'should keep type literals structural', () =>
        {
            const compiled = compile( `
                import { validate } from './src/index.js';
                type User = { id: string };
                const res = validate<User>({ id: 'a' });
            ` );

            expect( compiled ).toContain( 'validators.object(' );
            expect( compiled ).not.toContain( 'validators.instanceOf(' );
        });

        it( 'should emit distinct instanceof targets for two different classes', () =>
        {
            const compiled = compile( `
                import { validate } from './src/index.js';
                class Mailer { send() {} }
                class Logger { log() {} }
                const a = validate<Mailer>( null as any );
                const b = validate<Logger>( null as any );
            ` );

            expect( compiled ).toContain( 'validators.instanceOf(v, path, ctx, Mailer)' );
            expect( compiled ).toContain( 'validators.instanceOf(v, path, ctx, Logger)' );

            const ids = [...compiled.matchAll( /const (__val_[0-9a-f]+) = \(v, path, ctx\) => validators\.instanceOf\(v, path, ctx, (Mailer|Logger)\)/g )];
            expect( ids ).toHaveLength( 2 );
            expect( ids[0][1]).not.toBe( ids[1][1]);
            expect( new Set( ids.map( m => m[2]))).toEqual( new Set([ 'Mailer', 'Logger' ]));
        });

        it( 'should reject a class declared outside module scope', () =>
        {
            expect(() => emitWithTransformer({
                'main.ts' : `
                    import { validate } from '../src/index.js';
                    export function check( input: unknown )
                    {
                        class Mailer { send() {} }

                        return validate<Mailer>( input );
                    }
                `
            }, 'temp_class_nested_scope' )).toThrow( /must be declared at module scope/ );
        });

        it( 'should re-import an imported class used only as a type', () =>
        {
            const output = emitWithTransformer({
                'mailer.ts' : 'export class Mailer { send() { return true } }',
                'main.ts'   : `
                    import { validate } from '../src/index.js';
                    import { Mailer } from './mailer.js';
                    export const res = validate<{ mailer: Mailer }>({ mailer: null as any });
                `
            }, 'temp_class_import_emit' );

            expect( output ).toMatch( /Mailer as __tc_fn_Mailer/ );
            expect( output ).toContain( 'validators.instanceOf(v, path, ctx, __tc_fn_Mailer)' );
        });
    });

    describe( 'runtime', () =>
    {
        it( 'should accept instances and reject duck-typed plain objects', async() =>
        {
            const mod = await emitAndImport<{
                check : ( input: unknown ) => any
                make  : () => any
            }>( `
                import { validate } from '../src/index.js';
                class Mailer { send() { return true } }
                export const make  = () => new Mailer();
                export const check = ( input: unknown ) => validate<Mailer>( input );
            `, 'temp_class_runtime_factory' );

            const good = mod.check( mod.make());
            expect( good.success ).toBe( true );

            const failed = mod.check({ send : () => true });
            expect( failed.success ).toBe( false );
            expect( failed.errors.some(( e: any ) => String( e.error ).includes( 'Mailer' ))).toBe( true );
        });

        it( 'should accept a subclass instance when validating the base class', async() =>
        {
            const mod = await emitAndImport<{
                check : ( input: unknown ) => any
                make  : () => any
            }>( `
                import { validate } from '../src/index.js';
                class Mailer { send() { return true } }
                class SmtpMailer extends Mailer {}
                export const make  = () => new SmtpMailer();
                export const check = ( input: unknown ) => validate<Mailer>( input );
            `, 'temp_class_subclass' );

            expect( mod.check( mod.make()).success ).toBe( true );
        });

        it( 'should accept a class instance as input to an interface-shaped schema', async() =>
        {
            const mod = await emitAndImport<{
                check : ( input: unknown ) => any
                make  : () => any
            }>( `
                import { assert } from '../src/index.js';
                interface Bag { id: string }
                class Row { id = 'x'; save() { return this.id } }
                export const make  = () => new Row();
                export const check = ( input: unknown ) => assert<Bag>( input, { mode: 'strip' });
            `, 'temp_class_as_bag' );

            expect( mod.check( mod.make())).toEqual({ id : 'x' });
        });

        it( 'should assert process.env with strip and Defaults without mutating env', async() =>
        {
            const keys = {
                TENANT_ID : '__TC_ENV_TENANT_ID',
                CLIENT_ID : '__TC_ENV_CLIENT_ID',
                EXTRA     : '__TC_ENV_EXTRA'
            } as const;

            process.env[keys.TENANT_ID] = 't1';
            process.env[keys.CLIENT_ID] = 'c1';
            process.env[keys.EXTRA] = 'drop-me';

            try
            {
                const mod = await emitAndImport<{
                    load : ( env: NodeJS.ProcessEnv ) => any
                }>( `
                    import { assert, tag } from '../src/index.js';
                    type AppConfigSchema = {
                        ${keys.TENANT_ID}: string;
                        ${keys.CLIENT_ID}: string;
                        MAX_RETRIES: number & tag.Default<5>;
                    };
                    export const load = ( env: NodeJS.ProcessEnv ) =>
                        assert<AppConfigSchema>( env, { from: 'query', mode: 'strip' });
                `, 'temp_env_strip_defaults' );

                const result = mod.load( process.env );

                expect( result ).toEqual({
                    [keys.TENANT_ID] : 't1',
                    [keys.CLIENT_ID] : 'c1',
                    MAX_RETRIES      : 5
                });
                expect( result ).not.toBe( process.env );
                expect( keys.EXTRA in result ).toBe( false );
                expect( process.env[keys.EXTRA]).toBe( 'drop-me' );
                expect( process.env.MAX_RETRIES ).toBeUndefined();
            }
            finally
            {
                delete process.env[keys.TENANT_ID];
                delete process.env[keys.CLIENT_ID];
                delete process.env[keys.EXTRA];
            }
        });

        it( 'should instanceof an imported class after emit', async() =>
        {
            const dir = join( process.cwd(), 'temp_class_import_pkg' );
            mkdirSync( dir, { recursive : true });

            try
            {
                writeFileSync( join( dir, 'mailer.ts' ), `
                    export class Mailer { send() { return 'ok' } }
                    export const makeMailer = () => new Mailer();
                ` );

                const output = emitWithTransformer({
                    'mailer.ts' : `
                        export class Mailer { send() { return 'ok' } }
                        export const makeMailer = () => new Mailer();
                    `,
                    'main.ts' : `
                        import { validate } from '../src/index.js';
                        import { Mailer, makeMailer } from './mailer.js';
                        export const make  = () => makeMailer();
                        export const check = ( input: unknown ) => validate<{ mailer: Mailer }>( input );
                    `
                }, 'temp_class_import_runtime_src' );

                writeFileSync( join( dir, 'main.js' ), output );

                const bundled = await esbuild.build({
                    absWorkingDir : process.cwd(),
                    stdin         : {
                        contents   : output,
                        resolveDir : dir,
                        sourcefile : 'main.js',
                        loader     : 'js'
                    },
                    bundle        : true,
                    write         : false,
                    format        : 'esm',
                    platform      : 'node',
                    packages      : 'external',
                    plugins       : [
                        {
                            name  : 'tc-class-test',
                            setup : ( build ) =>
                            {
                                build.onResolve({ filter : /^@webergency-utils\/typechecker\/runtime$/ }, () =>
                                    ({ path : join( process.cwd(), 'dist/runtime/validators.js' ) }));
                                build.onResolve({ filter : /^\.\.\/src\/index\.js$/ }, () =>
                                    ({ path : join( process.cwd(), 'dist/index.js' ) }));
                                build.onResolve({ filter : /^\.\/mailer\.js$/ }, () =>
                                    ({ path : join( dir, 'mailer.ts' ) }));
                            }
                        }
                    ]
                });

                const file = join( dir, 'bundle.js' );
                writeFileSync( file, bundled.outputFiles![0].text );
                const mod = await import( pathToFileURL( file ).href + '?t=' + Date.now()) as {
                    check : ( input: unknown ) => any
                    make  : () => any
                };

                expect( mod.check({ mailer : mod.make() }).success ).toBe( true );
                expect( mod.check({ mailer : { send : () => 'ok' } }).success ).toBe( false );
            }
            finally
            {
                rmSync( dir, { recursive : true, force : true });
            }
        });
    });
});
