import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { emitAndImport } from './helpers/compile.js';

describe( 'parse / stringify reviver, replacer, and transform', () =>
{
    beforeEach(() =>
    {
    });

    afterEach(() =>
    {
        vi.clearAllMocks();
    });

    it( 'should run a JSON reviver on text, including delete and root key', async() =>
    {
        // Arrange
        const mod = await emitAndImport<{
            fromText : ( json: string, reviver: ( key: string, value: any ) => any ) => { name : string }
        }>( `
            import { parse } from '../src/index.js';
            interface User { name : string }
            export const fromText = ( json: string, reviver: ( key: string, value: any ) => any ) =>
                parse<User>( json, { reviver } );
        `, 'temp_pt_json_reviver' );

        const seenText: string[] = [];

        // Act
        const fromText = mod.fromText( '{"name":"Ada","drop":1}', function( key, value )
        {
            seenText.push( key );

            if( key === 'drop' ){ return undefined }

            if( key === '' ){ expect( this ).toEqual({ '' : { name : 'Ada' } }) }

            return value;
        });

        // Assert
        expect( fromText ).toEqual({ name : 'Ada' });
        expect( seenText ).toContain( '' );
    });

    it( 'should run a reviver on query strings and reject a leading ?', async() =>
    {
        // Arrange
        const mod = await emitAndImport<{
            run : ( input: string, reviver: ( key: string, value: any ) => any ) => { q : string }
        }>( `
            import { parse } from '../src/index.js';
            interface Search { q : string }
            export const run = ( input: string, reviver: ( key: string, value: any ) => any ) =>
                parse<Search>( input, { from: 'query', reviver } );
        `, 'temp_pt_query_reviver' );
        const reviver = ( key: string, value: any ) =>
        {
            if( key === 'drop' ){ return undefined }

            if( key === 'q' && typeof value === 'string' ){ return value.toUpperCase() }

            return value;
        };

        // Act
        const fromString = mod.run( 'q=ada&drop=1', reviver );

        // Assert
        expect( fromString ).toEqual({ q : 'ADA' });
        expect(() => mod.run( '?q=cara&drop=1', reviver )).toThrow( /Invalid query/ );
    });

    it( 'should ignore reviver on from:string', async() =>
    {
        // Arrange
        const mod = await emitAndImport<{
            run : ( input: unknown, reviver: ( key: string, value: any ) => any ) => string
        }>( `
            import { parse } from '../src/index.js';
            export const run = ( input: string, reviver: ( key: string, value: any ) => any ) =>
                parse<string>( input, { from: 'string', reviver } );
        `, 'temp_pt_string_reviver' );

        // Act
        const result = mod.run( 'keep', () => 'nope' );

        // Assert
        expect( result ).toBe( 'keep' );
    });

    it( 'should offset Dates via transform on parse and stringify for json and query', async() =>
    {
        // Arrange
        const mod = await emitAndImport<{
            parseJson    : ( input: unknown, transform: ( value: unknown, ctx: { type : string } ) => unknown ) => { at : Date }
            parseQuery   : ( input: unknown, transform: ( value: unknown, ctx: { type : string } ) => unknown ) => { at : Date }
            stringifyJson  : ( input: { at : Date }, transform: ( value: unknown, ctx: { type : string } ) => unknown ) => string
            stringifyQuery : ( input: { at : Date }, transform: ( value: unknown, ctx: { type : string } ) => unknown ) => string
        }>( `
            import { parse, stringify } from '../src/index.js';
            interface Event { at : Date }
            export const parseJson = ( input: string, transform: any ) => parse<Event>( input, { transform } );
            export const parseQuery = ( input: string, transform: any ) => parse<Event>( input, { from: 'query', transform } );
            export const stringifyJson = ( input: Event, transform: any ) => stringify<Event>( input, { transform } );
            export const stringifyQuery = ( input: Event, transform: any ) => stringify<Event>( input, { format: 'query', transform } );
        `, 'temp_pt_date_offset' );
        const ms = 3_600_000;
        const shift = ( delta: number ) => ( value: unknown, ctx: { type : string } ) =>
        {
            if( ctx.type === 'Date' && value instanceof Date )
            {
                return new Date( value.getTime() + delta );
            }

            return value;
        };
        const iso = '2024-01-01T00:00:00.000Z';
        const shiftedIso = '2024-01-01T01:00:00.000Z';

        // Act
        const parsedJson = mod.parseJson( JSON.stringify({ at : iso }), shift( ms ));
        const parsedQuery = mod.parseQuery( 'at=' + encodeURIComponent( iso ), shift( ms ));
        const jsonOut = mod.stringifyJson({ at : parsedJson.at }, shift( -ms ));
        const queryOut = mod.stringifyQuery({ at : parsedQuery.at }, shift( -ms ));

        // Assert
        expect( parsedJson.at.toISOString()).toBe( shiftedIso );
        expect( parsedQuery.at.toISOString()).toBe( shiftedIso );
        expect( JSON.parse( jsonOut ).at ).toBe( iso );
        expect( queryOut ).toContain( encodeURIComponent( iso ));
    });

    it( 'should expose ctx.tags from tag bags and leave untagged fields empty', async() =>
    {
        // Arrange
        const mod = await emitAndImport<{
            run : ( input: unknown, transform: ( value: unknown, ctx: { tags : string[], path : string } ) => unknown ) => { body : string, title : string }
        }>( `
            import { parse, tag } from '../src/index.js';
            interface Article {
                title : string
                body : string & tag<'html' | 'basic'>
            }
            export const run = ( input: string, transform: any ) => parse<Article>( input, { transform } );
        `, 'temp_pt_tags' );
        const seen: Record<string, string[]> = {};

        // Act
        const result = mod.run( JSON.stringify({ title : 'Hi', body : '<p>x</p>' }), ( value, ctx ) =>
        {
            seen[ctx.path] = ctx.tags;

            return value;
        });

        // Assert
        expect( result ).toEqual({ title : 'Hi', body : '<p>x</p>' });
        expect( seen.title ).toEqual([]);
        expect( seen.body ).toEqual([ 'basic', 'html' ]);
    });

    it( 'should pipe transform arrays and wrap throws with path', async() =>
    {
        // Arrange
        const mod = await emitAndImport<{
            runParse     : ( input: unknown, transform: any ) => { name : string }
            runStringify : ( input: { name : string }, transform: any ) => string
        }>( `
            import { parse, stringify } from '../src/index.js';
            interface User { name : string }
            export const runParse = ( input: string, transform: any ) => parse<User>( input, { transform } );
            export const runStringify = ( input: User, transform: any ) => stringify<User>( input, { transform } );
        `, 'temp_pt_pipe_throw' );

        // Act
        const piped = mod.runParse( '{"name":"Ada"}', [
            ( value: unknown ) => String( value ) + 'x',
            ( value: unknown ) => String( value ) + 'y'
        ]);

        // Assert
        expect( piped ).toEqual({ name : 'Adaxy' });
        expect(() => mod.runParse( '{"name":"Ada"}', ( _value: unknown, ctx: { path : string } ) =>
        {
            throw new Error( 'nope' );
        })).toThrow( /Parse error at "name": nope/ );
        expect(() => mod.runStringify({ name : 'Ada' }, () => { throw new Error( 'ser' ) }))
            .toThrow( /Serialization error at "name": ser/ );
    });

    it( 'should close serializer options at create time and take stringify options per call', async() =>
    {
        // Arrange
        const mod = await emitAndImport<{
            closed : ( input: { name : string } ) => string
            open   : ( input: { name : string }, transform: any ) => string
        }>( `
            import { serializer, stringify } from '../src/index.js';
            interface User { name : string }
            const suffix = ( value: unknown ) => String( value ) + '!';
            export const closed = serializer<User>({ transform: suffix });
            export const open = ( input: User, transform: any ) => stringify<User>( input, { transform } );
        `, 'temp_pt_serializer_close' );

        // Act
        const a = mod.closed({ name : 'Ada' });
        const b = mod.open({ name : 'Ada' }, ( value: unknown ) => String( value ) + '?' );

        // Assert
        expect( JSON.parse( a ).name ).toBe( 'Ada!' );
        expect( JSON.parse( b ).name ).toBe( 'Ada?' );
    });

    it( 'should apply JSON replacer after encode so Dates are ISO strings', async() =>
    {
        // Arrange
        const mod = await emitAndImport<{
            run : ( input: { at : Date, name : string }, replacer: ( key: string, value: any ) => any ) => string
        }>( `
            import { stringify } from '../src/index.js';
            interface Event { at : Date, name : string }
            export const run = ( input: Event, replacer: any ) => stringify<Event>( input, { replacer } );
        `, 'temp_pt_replacer' );
        const at = new Date( '2024-01-01T00:00:00.000Z' );
        const seen: { key : string, value : unknown }[] = [];

        // Act
        const json = mod.run({ at, name : 'Ada' }, ( key, value ) =>
        {
            seen.push({ key, value });

            if( key === 'name' ){ return undefined }

            return value;
        });

        // Assert
        expect( JSON.parse( json )).toEqual({ at : '2024-01-01T00:00:00.000Z' });
        expect( seen.some( s => s.key === 'at' && typeof s.value === 'string' )).toBe( true );
    });

    it( 'should wrap a throwing JSON replacer as SerializationError', async() =>
    {
        // Arrange
        const mod = await emitAndImport<{
            run : ( input: { name : string }, replacer: ( key: string, value: any ) => any ) => string
        }>( `
            import { stringify } from '../src/index.js';
            interface User { name : string }
            export const run = ( input: User, replacer: any ) => stringify<User>( input, { replacer } );
        `, 'temp_pt_replacer_throw' );

        // Act / Assert
        expect(() => mod.run({ name : 'Ada' }, () => { throw new Error( 'repl' ) }))
            .toThrow( /repl/ );
    });

    it( 'should apply transform on assert/validate and leave is/assertGuard unchanged', async() =>
    {
        // Arrange
        const mod = await emitAndImport<{
            doAssert : ( input: unknown, transform: any ) => { n : number }
            doValidate : ( input: unknown, transform: any ) => { success : boolean, data? : { n : number } }
            doIs : ( input: unknown, transform: any ) => boolean
            doGuard : ( input: unknown, transform: any ) => { n : number }
        }>( `
            import { assert, validate, is, assertGuard } from '../src/index.js';
            interface Row { n : number }
            export const doAssert = ( input: unknown, transform: any ) => assert<Row>( input, { transform } );
            export const doValidate = ( input: unknown, transform: any ) => validate<Row>( input, { transform } );
            export const doIs = ( input: unknown, transform: any ) =>
            {
                const opts = { transform };
                return is<Row>( input, opts );
            };
            export const doGuard = ( input: unknown, transform: any ) =>
            {
                const value = input as { n : number };
                const opts = { transform };
                assertGuard<Row>( value, opts );
                return value;
            };
        `, 'temp_pt_assert_is' );
        const bump = ( value: unknown, ctx: { type : string } ) =>
            ctx.type === 'number' && typeof value === 'number' ? value + 1 : value;

        // Act
        const asserted = mod.doAssert({ n : 1 }, bump );
        const validated = mod.doValidate({ n : 1 }, bump );
        const input = { n : 1 };
        const guarded = mod.doIs( input, bump );
        const afterGuard = mod.doGuard({ n : 1 }, bump );

        // Assert
        expect( asserted.n ).toBe( 2 );
        expect( validated.data?.n ).toBe( 2 );
        expect( guarded ).toBe( true );
        expect( input.n ).toBe( 1 );
        expect( afterGuard.n ).toBe( 1 );
    });

    it( 'should still fill tag.Default when the node is undefined', async() =>
    {
        // Arrange
        const mod = await emitAndImport<{
            run : ( input: unknown, transform: any ) => { port : number, name : string }
        }>( `
            import { parse, tag } from '../src/index.js';
            interface Config {
                port? : number & tag.Default<8080>
                name : string
            }
            export const run = ( input: string, transform: any ) => parse<Config>( input, { transform } );
        `, 'temp_pt_default' );

        // Act
        const result = mod.run( '{"name":"x"}', ( value: unknown ) =>
        {
            if( value === undefined ){ return 0 }

            return value;
        });

        // Assert
        expect( result ).toEqual({ port : 8080, name : 'x' });
    });

    it( 'should keep transform.ToNumber before the option transform', async() =>
    {
        // Arrange
        const mod = await emitAndImport<{
            run : ( input: unknown, transform: any ) => { n : number }
        }>( `
            import { parse, transform } from '../src/index.js';
            interface Row { n : number & transform.ToNumber }
            export const run = ( input: string, transform: any ) => parse<Row>( input, { transform } );
        `, 'temp_pt_tonumber' );

        // Act
        const result = mod.run( '{"n":"42"}', ( value: unknown, ctx: { type : string } ) =>
            ctx.type === 'number' && typeof value === 'number' ? value + 1 : value
        );

        // Assert
        expect( result.n ).toBe( 43 );
    });
});
