import { describe, it, expect, expectTypeOf } from 'vitest';
import { tag, constraint, ResolveDefaults } from '../runtime/tags.js';
import type { ConvertPropertyCasing } from '../runtime/casing.js';
import { convertPropertyCasing } from '../runtime/casing.js';
import { compileAndTransform, emitAndImport } from './helpers/compile.js';

/**
 * Combinations of ConvertPropertyCasing, ResolveDefaults, and optionality/Default on the
 * *original* schema — the AppConfig / PollerConfig pattern.
 */
describe( 'Casing + Defaults + original optionality', () =>
{
    const compile = ( code: string ) => compileAndTransform( code, 'temp_casing_defaults' );

    describe( 'type level', () =>
    {
        type AppConfigSchema = {
            TENANT_ID : string
            CLIENT_ID : string
            MAX_RETRIES : number & tag.Default<5>
            BASE_RETRY_DELAY_MS : number & tag.Default<1000>
        };

        type PollerConfigSchema = {
            MAILBOX_ADDRESS : string
            POLL_INTERVAL_MS? : number & constraint.Minimum<0> & tag.Default<60000>
            PAGE_SIZE? : number & constraint.Range<1, 999> & tag.Default<50>
            MARK_AS_READ? : boolean & tag.Default<false>
            DEBUG_LABEL? : string
        };

        it( 'ConvertPropertyCasing alone preserves original optionality', () =>
        {
            type Cased = ConvertPropertyCasing<PollerConfigSchema, 'camelCase'>;

            expectTypeOf<Cased>().toMatchTypeOf<{
                mailboxAddress : string
                pollIntervalMs? : number
                pageSize? : number
                markAsRead? : boolean
                debugLabel? : string
            }>();
            expectTypeOf<Cased>().not.toMatchTypeOf<{ pollIntervalMs : number }>();
            expectTypeOf<Cased>().not.toMatchTypeOf<{ POLL_INTERVAL_MS? : number }>();
        });

        it( 'ResolveDefaults after camelCase makes only Defaulted keys required', () =>
        {
            type Resolved = ResolveDefaults<ConvertPropertyCasing<PollerConfigSchema, 'camelCase'>>;

            expectTypeOf<Resolved>().toMatchTypeOf<{
                mailboxAddress : string
                pollIntervalMs : number
                pageSize : number
                markAsRead : boolean
                debugLabel? : string
            }>();
            expectTypeOf<Resolved>().not.toMatchTypeOf<{ debugLabel : string }>();
            expectTypeOf<Resolved>().not.toMatchTypeOf<{ pollIntervalMs? : number }>();
        });

        it( 'required Defaults on the original stay required after casing + ResolveDefaults', () =>
        {
            type Resolved = ResolveDefaults<ConvertPropertyCasing<AppConfigSchema, 'camelCase'>>;

            expectTypeOf<Resolved>().toMatchTypeOf<{
                tenantId : string
                clientId : string
                maxRetries : number
                baseRetryDelayMs : number
            }>();
            expectTypeOf<Resolved>().not.toMatchTypeOf<{ maxRetries? : number }>();
        });

        it( 'ResolveDefaults before casing still yields camelCase required Defaults', () =>
        {
            type ResolvedThenCased = ConvertPropertyCasing<ResolveDefaults<PollerConfigSchema>, 'camelCase'>;

            expectTypeOf<ResolvedThenCased>().toMatchTypeOf<{
                mailboxAddress : string
                pollIntervalMs : number
                pageSize : number
                markAsRead : boolean
                debugLabel? : string
            }>();
        });

        it( 'works for snake_case and PascalCase targets', () =>
        {
            type Snake = ResolveDefaults<ConvertPropertyCasing<PollerConfigSchema, 'snake_case'>>;
            type Pascal = ResolveDefaults<ConvertPropertyCasing<PollerConfigSchema, 'PascalCase'>>;

            expectTypeOf<Snake>().toMatchTypeOf<{
                mailbox_address : string
                poll_interval_ms : number
                debug_label? : string
            }>();
            expectTypeOf<Pascal>().toMatchTypeOf<{
                MailboxAddress : string
                PollIntervalMs : number
                DebugLabel? : string
            }>();
        });

        it( 'preserves nested original optionality through casing', () =>
        {
            type Nested = {
                OUTER_NAME : string
                SETTINGS? : {
                    RETRY_MS? : number & tag.Default<100>
                    LABEL? : string
                }
            };
            type Resolved = ResolveDefaults<ConvertPropertyCasing<Nested, 'camelCase'>>;

            expectTypeOf<Resolved>().toMatchTypeOf<{
                outerName : string
                settings? : {
                    retryMs : number
                    label? : string
                }
            }>();
        });
    });

    describe( 'emit', () =>
    {
        it( 'should emit Defaults and hasDefault for ResolveDefaults<ConvertPropertyCasing<…>>', () =>
        {
            const compiled = compile( `
                import { assert, tag, Minimum, ResolveDefaults, ConvertPropertyCasing } from './src/index.js';
                type Schema = {
                    MAILBOX_ADDRESS: string;
                    POLL_INTERVAL_MS?: number & Minimum<0> & tag.Default<60000>;
                    DEBUG_LABEL?: string;
                };
                type Resolved = ResolveDefaults<ConvertPropertyCasing<Schema, 'camelCase'>>;
                export const run = ( input: unknown ) => assert<Resolved>( input );
            ` );

            expect( compiled ).toContain( 'v = 60000' );
            expect( compiled ).toContain( '"pollIntervalMs"' );
            expect( compiled ).toContain( '"mailboxAddress"' );
            expect( compiled ).toContain( '"debugLabel"' );
            expect( compiled ).toMatch( /\["pollIntervalMs", false, __val_[0-9a-f]+, true\]/ );
            // Plain optional from the original schema stays optional (no hasDefault).
            expect( compiled ).toMatch( /\["debugLabel", true,/ );
            expect( compiled ).not.toMatch( /\["debugLabel", true, __val_[0-9a-f]+, true\]/ );
            expect( compiled ).not.toContain( 'validators.any' );
        });

        it( 'should emit required Defaults from the original SCREAMING_SNAKE schema', () =>
        {
            const compiled = compile( `
                import { assert, tag } from './src/index.js';
                type AppConfigSchema = {
                    TENANT_ID: string;
                    MAX_RETRIES: number & tag.Default<5>;
                };
                export const run = ( input: unknown ) => assert<AppConfigSchema>( input, { from: 'query', mode: 'strip' });
            ` );

            expect( compiled ).toContain( 'v = 5' );
            expect( compiled ).toMatch( /\["MAX_RETRIES", false, __val_[0-9a-f]+, true\]/ );
            expect( compiled ).toMatch( /\["TENANT_ID", false,/ );
        });

        it( 'should keep original optional+Default when asserting ConvertPropertyCasing without ResolveDefaults', () =>
        {
            const compiled = compile( `
                import { assert, tag, ConvertPropertyCasing } from './src/index.js';
                type Schema = {
                    HOST_NAME: string;
                    PORT?: number & tag.Default<8080>;
                };
                type Cased = ConvertPropertyCasing<Schema, 'camelCase'>;
                export const run = ( input: unknown ) => assert<Cased>( input );
            ` );

            expect( compiled ).toContain( 'v = 8080' );
            expect( compiled ).toMatch( /\["port", true, __val_[0-9a-f]+, true\]/ );
            expect( compiled ).not.toContain( 'validators.optional(' );
        });
    });

    describe( 'runtime', () =>
    {
        it( 'should mirror loadConfig: assert original schema then convertPropertyCasing', async() =>
        {
            const mod = await emitAndImport<{
                load : ( env: Record<string, unknown> ) => any
            }>( `
                import { assert, tag, convertPropertyCasing } from '../src/index.js';
                type AppConfigSchema = {
                    TENANT_ID: string;
                    CLIENT_ID: string;
                    MAX_RETRIES: number & tag.Default<5>;
                    BASE_RETRY_DELAY_MS: number & tag.Default<1000>;
                    OPTIONAL_NOTE?: string;
                };
                export function load( env: Record<string, unknown> ) {
                    return convertPropertyCasing(
                        assert<AppConfigSchema>( env, { from: 'query', mode: 'strip' }),
                        'camelCase'
                    );
                }
            `, 'temp_casing_load_config' );

            expect( mod.load({
                TENANT_ID : 't1',
                CLIENT_ID : 'c1',
                EXTRA     : 'drop-me'
            })).toEqual({
                tenantId         : 't1',
                clientId         : 'c1',
                maxRetries       : 5,
                baseRetryDelayMs : 1000
            });

            expect( mod.load({
                TENANT_ID          : 't1',
                CLIENT_ID          : 'c1',
                MAX_RETRIES        : '9',
                BASE_RETRY_DELAY_MS: '250',
                OPTIONAL_NOTE      : 'hi'
            })).toEqual({
                tenantId         : 't1',
                clientId         : 'c1',
                maxRetries       : 9,
                baseRetryDelayMs : 250,
                optionalNote     : 'hi'
            });
        });

        it( 'should mirror loadPollerConfig: assert ResolveDefaults<ConvertPropertyCasing<…>>', async() =>
        {
            const mod = await emitAndImport<{
                load : ( config: Record<string, unknown> ) => any
            }>( `
                import {
                    assert, tag, Minimum, Range,
                    ResolveDefaults, ConvertPropertyCasing, convertPropertyCasing
                } from '../src/index.js';
                type PollerConfigSchema = {
                    MAILBOX_ADDRESS: string;
                    POLL_INTERVAL_MS?: number & Minimum<0> & tag.Default<60000>;
                    PAGE_SIZE?: number & Range<1, 999> & tag.Default<50>;
                    MARK_AS_READ?: boolean & tag.Default<false>;
                    DEBUG_LABEL?: string;
                };
                type PollerConfig = ResolveDefaults<ConvertPropertyCasing<PollerConfigSchema, 'camelCase'>>;
                export function load( config: Record<string, unknown> ) {
                    return convertPropertyCasing(
                        assert<PollerConfig>( config, { from: 'query' }),
                        'camelCase'
                    );
                }
            `, 'temp_casing_load_poller' );

            expect( mod.load({ mailboxAddress : 'a@b.com' })).toEqual({
                mailboxAddress : 'a@b.com',
                pollIntervalMs : 60000,
                pageSize       : 50,
                markAsRead     : false
            });

            expect( mod.load({
                mailboxAddress : 'a@b.com',
                pollIntervalMs : '120000',
                pageSize       : '10',
                markAsRead     : 'true',
                debugLabel     : 'dbg'
            })).toEqual({
                mailboxAddress : 'a@b.com',
                pollIntervalMs : 120000,
                pageSize       : 10,
                markAsRead     : true,
                debugLabel     : 'dbg'
            });
        });

        it( 'should fill optional Defaults when asserting ConvertPropertyCasing without ResolveDefaults', async() =>
        {
            const mod = await emitAndImport<{ run : ( input: unknown ) => any }>( `
                import { assert, tag, ConvertPropertyCasing } from '../src/index.js';
                type Schema = {
                    HOST_NAME: string;
                    PORT?: number & tag.Default<8080>;
                    LABEL?: string;
                };
                type Cased = ConvertPropertyCasing<Schema, 'camelCase'>;
                export const run = ( input: unknown ) => assert<Cased>( input );
            `, 'temp_casing_without_resolve' );

            expect( mod.run({ hostName : 'api' })).toEqual({ hostName : 'api', port : 8080 });
            expect( 'label' in mod.run({ hostName : 'api' })).toBe( false );
        });

        it( 'should fill Defaults for snake_case ResolveDefaults target keys', async() =>
        {
            const mod = await emitAndImport<{ run : ( input: unknown ) => any }>( `
                import { assert, tag, ResolveDefaults, ConvertPropertyCasing } from '../src/index.js';
                type Schema = {
                    MailboxAddress: string;
                    PollIntervalMs?: number & tag.Default<60000>;
                };
                type Resolved = ResolveDefaults<ConvertPropertyCasing<Schema, 'snake_case'>>;
                export const run = ( input: unknown ) => assert<Resolved>( input );
            `, 'temp_casing_snake_resolve' );

            expect( mod.run({ mailbox_address : 'a@b.com' })).toEqual({
                mailbox_address  : 'a@b.com',
                poll_interval_ms : 60000
            });
        });

        it( 'should fill nested Defaults after casing the original optional nested shape', async() =>
        {
            const mod = await emitAndImport<{ run : ( input: unknown ) => any }>( `
                import { assert, tag, ResolveDefaults, ConvertPropertyCasing } from '../src/index.js';
                type Schema = {
                    SERVICE_NAME: string;
                    SETTINGS?: {
                        RETRY_MS?: number & tag.Default<100>;
                        LABEL?: string;
                    };
                };
                type Resolved = ResolveDefaults<ConvertPropertyCasing<Schema, 'camelCase'>>;
                export const run = ( input: unknown ) => assert<Resolved>( input );
            `, 'temp_casing_nested_optional' );

            expect( mod.run({ serviceName : 'svc' })).toEqual({ serviceName : 'svc' });
            expect( mod.run({ serviceName : 'svc', settings : {} })).toEqual({
                serviceName : 'svc',
                settings    : { retryMs : 100 }
            });
            expect( mod.run({
                serviceName : 'svc',
                settings    : { retryMs : 5, label : 'x' }
            })).toEqual({
                serviceName : 'svc',
                settings    : { retryMs : 5, label : 'x' }
            });
        });

        it( 'should reject invalid optional Defaulted values on the cased ResolveDefaults type', async() =>
        {
            const mod = await emitAndImport<{ run : ( input: unknown ) => any }>( `
                import { validate, tag, Range, ResolveDefaults, ConvertPropertyCasing } from '../src/index.js';
                type Schema = {
                    NAME: string;
                    PAGE_SIZE?: number & Range<1, 99> & tag.Default<10>;
                };
                type Resolved = ResolveDefaults<ConvertPropertyCasing<Schema, 'camelCase'>>;
                export const run = ( input: unknown ) => validate<Resolved>( input );
            `, 'temp_casing_invalid_defaulted' );

            const res = mod.run({ name : 'x', pageSize : 0 });

            expect( res.success ).toBe( false );
            expect( res.errors.some(( e: any ) => e.path === 'pageSize' )).toBe( true );
        });

        it( 'should leave a plain original optional absent after casing + runtime convert', async() =>
        {
            const mod = await emitAndImport<{
                load : ( env: Record<string, unknown> ) => any
            }>( `
                import { assert, tag, convertPropertyCasing } from '../src/index.js';
                type Schema = {
                    TENANT_ID: string;
                    MAX_RETRIES: number & tag.Default<5>;
                    NOTE?: string;
                };
                export function load( env: Record<string, unknown> ) {
                    return convertPropertyCasing( assert<Schema>( env, { mode: 'strip' }), 'camelCase' );
                }
            `, 'temp_casing_plain_optional_absent' );

            const result = mod.load({ TENANT_ID : 't' });

            expect( result ).toEqual({ tenantId : 't', maxRetries : 5 });
            expect( 'note' in result ).toBe( false );
        });

        it( 'should round-trip runtime convertPropertyCasing with Default-filled keys', () =>
        {
            // Pure runtime check: filled SCREAMING_SNAKE keys convert cleanly.
            const filled = {
                TENANT_ID            : 't1',
                MAX_RETRIES          : 5,
                BASE_RETRY_DELAY_MS  : 1000,
                POLL_INTERVAL_MS     : 60000,
                MARK_AS_READ         : false
            };

            expect( convertPropertyCasing( filled, 'camelCase' )).toEqual({
                tenantId           : 't1',
                maxRetries         : 5,
                baseRetryDelayMs   : 1000,
                pollIntervalMs     : 60000,
                markAsRead         : false
            });

            expect( convertPropertyCasing(
                convertPropertyCasing( filled, 'camelCase' ),
                'SNAKE_CASE'
            )).toEqual( filled );
        });
    });
});
