import { describe, it, expect } from 'vitest';
import { compileAndTransform, emitAndImport } from './helpers/compile.js';

describe( 'Default tags with optionality', () =>
{
    const compile = ( code: string ) => compileAndTransform( code, 'temp_defaults_regression' );

    describe( 'emit', () =>
    {
        it( 'should not wrap an optional Default in validators.optional', () =>
        {
            const compiled = compile( `
                import { validate, tag } from './src/index.js';
                const res = validate<{ port?: number & tag.Default<8080> }>({});
            ` );

            expect( compiled ).toContain( 'v = 8080' );
            expect( compiled ).not.toContain( 'validators.optional(' );
            expect( compiled ).toMatch( /\["port", true, __val_[0-9a-f]+, true\]/ );
        });

        it( 'should mark a required Default with hasDefault and no optional wrap', () =>
        {
            const compiled = compile( `
                import { validate, tag } from './src/index.js';
                const res = validate<{ retries: number & tag.Default<5> }>({});
            ` );

            expect( compiled ).toContain( 'v = 5' );
            expect( compiled ).not.toContain( 'validators.optional(' );
            expect( compiled ).toMatch( /\["retries", false, __val_[0-9a-f]+, true\]/ );
        });

        it( 'should not keep a bare undefined arm beside a Defaulted boolean', () =>
        {
            const compiled = compile( `
                import { validate, tag } from './src/index.js';
                const res = validate<{ flag?: boolean & tag.Default<false> }>({});
            ` );

            expect( compiled ).toContain( 'v = false' );
            // The undefined arm must not remain — it would win the union before Default runs.
            expect( compiled ).not.toMatch( /validators\.union\([^)]*validators\.undefined/ );
        });

        it( 'should still emit optional for a plain T | undefined', () =>
        {
            const compiled = compile( `
                import { validate } from './src/index.js';
                const res = validate<{ port?: number }>({});
            ` );

            expect( compiled ).toContain( 'validators.optional(' );
            expect( compiled ).not.toContain( ', true]' );
        });

        it( 'should emit string and true boolean defaults', () =>
        {
            const compiled = compile( `
                import { validate, tag } from './src/index.js';
                const res = validate<{
                    host?: string & tag.Default<'localhost'>;
                    enabled?: boolean & tag.Default<true>;
                }>({});
            ` );

            expect( compiled ).toContain( 'v = "localhost"' );
            expect( compiled ).toContain( 'v = true' );
        });

        it( 'should keep constraints beside a Default on an optional prop', () =>
        {
            const compiled = compile( `
                import { validate, tag, Minimum, Range } from './src/index.js';
                const res = validate<{
                    delay?: number & Minimum<0> & tag.Default<1000>;
                    size?: number & Range<1, 99> & tag.Default<10>;
                }>({});
            ` );

            expect( compiled ).toContain( 'v = 1000' );
            expect( compiled ).toContain( 'validators.minimum(v, path, ctx, 0)' );
            expect( compiled ).toContain( 'v = 10' );
            expect( compiled ).toContain( 'validators.minimum(v, path, ctx, 1)' );
            expect( compiled ).toContain( 'validators.maximum(v, path, ctx, 99)' );
            expect( compiled ).not.toContain( 'validators.optional(' );
        });

        it( 'should emit nested object Defaults', () =>
        {
            const compiled = compile( `
                import { validate, tag } from './src/index.js';
                type Nested = { inner?: { port?: number & tag.Default<8080> } };
                const res = validate<Nested>({});
            ` );

            expect( compiled ).toContain( 'v = 8080' );
            expect( compiled ).toMatch( /\["port", true, __val_[0-9a-f]+, true\]/ );
        });
    });

    describe( 'runtime', () =>
    {
        it( 'should fill required and optional Defaults like AppConfig / PollerConfig', async() =>
        {
            const mod = await emitAndImport<{
                loadApp    : ( env: Record<string, unknown> ) => any
                loadPoller : ( config: Record<string, unknown> ) => any
            }>( `
                import { assert, tag, Minimum, Range } from '../src/index.js';
                type AppConfigSchema = {
                    TENANT_ID: string;
                    MAX_RETRIES: number & tag.Default<5>;
                };
                type PollerConfigSchema = {
                    MAILBOX_ADDRESS: string;
                    POLL_INTERVAL_MS?: number & Minimum<0> & tag.Default<60000>;
                    PAGE_SIZE?: number & Range<1, 999> & tag.Default<50>;
                    MARK_AS_READ?: boolean & tag.Default<false>;
                };
                export function loadApp( env: Record<string, unknown> ) {
                    return assert<AppConfigSchema>( env, { from: 'query', mode: 'strip' });
                }
                export function loadPoller( config: Record<string, unknown> ) {
                    return assert<PollerConfigSchema>( config, { from: 'query' });
                }
            `, 'temp_defaults_app_poller' );

            expect( mod.loadApp({ TENANT_ID : 't1' })).toEqual({ TENANT_ID : 't1', MAX_RETRIES : 5 });
            expect( mod.loadPoller({ MAILBOX_ADDRESS : 'a@b.com' })).toEqual({
                MAILBOX_ADDRESS  : 'a@b.com',
                POLL_INTERVAL_MS : 60000,
                PAGE_SIZE        : 50,
                MARK_AS_READ     : false
            });
        });

        it( 'should let a present value win over the Default', async() =>
        {
            const mod = await emitAndImport<{ run : ( input: unknown ) => any }>( `
                import { assert, tag } from '../src/index.js';
                type S = {
                    port?: number & tag.Default<8080>;
                    host?: string & tag.Default<'localhost'>;
                    on?: boolean & tag.Default<false>;
                };
                export const run = ( input: unknown ) => assert<S>( input );
            `, 'temp_defaults_present_wins' );

            expect( mod.run({ port : 3000, host : 'api', on : true })).toEqual({
                port : 3000,
                host : 'api',
                on   : true
            });
        });

        it( 'should fill a Default when the key is present as undefined', async() =>
        {
            const mod = await emitAndImport<{ run : ( input: unknown ) => any }>( `
                import { assert, tag } from '../src/index.js';
                type S = { port?: number & tag.Default<8080> };
                export const run = ( input: unknown ) => assert<S>( input );
            `, 'temp_defaults_explicit_undefined' );

            expect( mod.run({ port : undefined })).toEqual({ port : 8080 });
        });

        it( 'should leave a plain optional property absent', async() =>
        {
            const mod = await emitAndImport<{ run : ( input: unknown ) => any }>( `
                import { assert } from '../src/index.js';
                type S = { port?: number; name: string };
                export const run = ( input: unknown ) => assert<S>( input );
            `, 'temp_defaults_plain_optional' );

            expect( mod.run({ name : 'x' })).toEqual({ name : 'x' });
            expect( 'port' in mod.run({ name : 'x' })).toBe( false );
        });

        it( 'should fail a required property without a Default when absent', async() =>
        {
            const mod = await emitAndImport<{ run : ( input: unknown ) => any }>( `
                import { validate } from '../src/index.js';
                type S = { id: string; retries: number };
                export const run = ( input: unknown ) => validate<S>( input );
            `, 'temp_defaults_required_missing' );

            const res = mod.run({});

            expect( res.success ).toBe( false );
            expect( res.errors.some(( e: any ) => e.path === 'id' )).toBe( true );
            expect( res.errors.some(( e: any ) => e.path === 'retries' )).toBe( true );
        });

        it( 'should still reject an invalid present value (Default does not rescue it)', async() =>
        {
            const mod = await emitAndImport<{ run : ( input: unknown ) => any }>( `
                import { validate, tag, Range } from '../src/index.js';
                type S = { size?: number & Range<1, 99> & tag.Default<10> };
                export const run = ( input: unknown ) => validate<S>( input );
            `, 'temp_defaults_invalid_present' );

            const res = mod.run({ size : 0 });

            expect( res.success ).toBe( false );
            expect( res.errors.some(( e: any ) => e.path === 'size' )).toBe( true );
        });

        it( 'should apply constraints to the filled Default value', async() =>
        {
            const mod = await emitAndImport<{
                ok  : ( input: unknown ) => any
                bad : ( input: unknown ) => any
            }>( `
                import { validate, tag, Minimum } from '../src/index.js';
                type Ok  = { n?: number & Minimum<0> & tag.Default<1> };
                // Default below the minimum — filling it must still fail the constraint.
                type Bad = { n?: number & Minimum<10> & tag.Default<1> };
                export const ok  = ( input: unknown ) => validate<Ok>( input );
                export const bad = ( input: unknown ) => validate<Bad>( input );
            `, 'temp_defaults_constraint_on_default' );

            expect( mod.ok({}).success ).toBe( true );
            expect( mod.ok({}).data ).toEqual({ n : 1 });

            const failed = mod.bad({});
            expect( failed.success ).toBe( false );
            expect( failed.errors.some(( e: any ) => e.path === 'n' )).toBe( true );
        });

        it( 'should fill nested Defaults only when the parent object is present', async() =>
        {
            const mod = await emitAndImport<{ run : ( input: unknown ) => any }>( `
                import { assert, tag } from '../src/index.js';
                type S = {
                    name: string;
                    nested?: { port?: number & tag.Default<8080> };
                };
                export const run = ( input: unknown ) => assert<S>( input );
            `, 'temp_defaults_nested' );

            expect( mod.run({ name : 'x' })).toEqual({ name : 'x' });
            expect( mod.run({ name : 'x', nested : {} })).toEqual({ name : 'x', nested : { port : 8080 } });
        });

        it( 'should coerce provided query strings and still fill absent Defaults', async() =>
        {
            const mod = await emitAndImport<{ run : ( input: unknown ) => any }>( `
                import { assert, tag } from '../src/index.js';
                type S = {
                    retries: number & tag.Default<5>;
                    delay?: number & tag.Default<1000>;
                };
                export const run = ( input: unknown ) => assert<S>( input, { from: 'query' });
            `, 'temp_defaults_query_coerce' );

            expect( mod.run({ retries : '3' })).toEqual({ retries : 3, delay : 1000 });
            expect( mod.run({})).toEqual({ retries : 5, delay : 1000 });
        });

        it( 'should keep defaulted keys under mode strip', async() =>
        {
            const mod = await emitAndImport<{ run : ( input: unknown ) => any }>( `
                import { assert, tag } from '../src/index.js';
                type S = { id: string; retries: number & tag.Default<5> };
                export const run = ( input: unknown ) => assert<S>( input, { mode: 'strip' });
            `, 'temp_defaults_strip' );

            expect( mod.run({ id : 'a', extra : 1 })).toEqual({ id : 'a', retries : 5 });
        });

        it( 'should fill Defaults when asserting a ResolveDefaults type', async() =>
        {
            // Call sites often assert the resolved shape. Default tags must still be visible
            // to the resolver on those property types so absent keys get filled.
            const mod = await emitAndImport<{ run : ( input: unknown ) => any }>( `
                import { assert, tag, ResolveDefaults } from '../src/index.js';
                type Schema = {
                    mailbox: string;
                    interval?: number & tag.Default<60000>;
                    markAsRead?: boolean & tag.Default<false>;
                };
                type Resolved = ResolveDefaults<Schema>;
                export const run = ( input: unknown ) => assert<Resolved>( input );
            `, 'temp_defaults_resolve_defaults_assert' );

            expect( mod.run({ mailbox : 'a@b.com' })).toEqual({
                mailbox    : 'a@b.com',
                interval   : 60000,
                markAsRead : false
            });
        });

        it( 'should fill Defaults after ConvertPropertyCasing + ResolveDefaults', async() =>
        {
            const mod = await emitAndImport<{ run : ( input: unknown ) => any }>( `
                import { assert, tag, Minimum, ResolveDefaults, ConvertPropertyCasing } from '../src/index.js';
                type Schema = {
                    MAILBOX_ADDRESS: string;
                    POLL_INTERVAL_MS?: number & Minimum<0> & tag.Default<60000>;
                };
                type Resolved = ResolveDefaults<ConvertPropertyCasing<Schema, 'camelCase'>>;
                export const run = ( input: unknown ) => assert<Resolved>( input, { from: 'query' });
            `, 'temp_defaults_casing_resolve' );

            expect( mod.run({ mailboxAddress : 'a@b.com' })).toEqual({
                mailboxAddress : 'a@b.com',
                pollIntervalMs : 60000
            });
        });
    });
});
