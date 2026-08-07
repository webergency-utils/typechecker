const { FuzzedDataProvider } = require( '@jazzer.js/core' );
const runtime = require( '../dist-fuzz/runtime.cjs' );

function createFuzzedInput( provider, depth = 0, maxDepth = 3 )
{
    if( depth >= maxDepth )
    {
        const leaf = provider.consumeIntegralInRange( 0, 6 );

        if( leaf === 0 ){ return provider.consumeString( 32 ) }

        if( leaf === 1 ){ return provider.consumeNumber() }

        if( leaf === 2 ){ return provider.consumeBoolean() }

        if( leaf === 3 ){ return null }

        if( leaf === 4 ){ return undefined }

        if( leaf === 5 ){ return provider.consumeIntegralInRange( -1000, 1000 ) }

        return Buffer.from( provider.consumeBytes( 8 ));
    }

    const kind = provider.consumeIntegralInRange( 0, 8 );

    if( kind === 0 ){ return provider.consumeString( 48 ) }

    if( kind === 1 ){ return provider.consumeNumber() }

    if( kind === 2 ){ return provider.consumeBoolean() }

    if( kind === 3 ){ return null }

    if( kind === 4 )
    {
        const len = provider.consumeIntegralInRange( 0, 4 );
        const arr = [];

        for( let i = 0; i < len; i++ )
        {
            arr.push( createFuzzedInput( provider, depth + 1, maxDepth ));
        }

        return arr;
    }

    if( kind === 5 )
    {
        const len = provider.consumeIntegralInRange( 0, 4 );
        const obj = {};

        for( let i = 0; i < len; i++ )
        {
            obj[provider.consumeString( 8 ) || `k${i}`] = createFuzzedInput( provider, depth + 1, maxDepth );
        }

        return obj;
    }

    if( kind === 6 ){ return new Date( provider.consumeNumber()) }

    if( kind === 7 )
    {
        try
        {
            return new RegExp( provider.consumeString( 12 ));
        }
        catch
        {
            return /./;
        }
    }

    return new Set([ createFuzzedInput( provider, depth + 1, maxDepth )]);
}

function pickMode( provider )
{
    return provider.pickValue([ 'strict', 'relaxed', 'strip' ]);
}

function pickFrom( provider )
{
    const choice = provider.consumeIntegralInRange( 0, 3 );

    if( choice === 0 ){ return undefined }

    if( choice === 1 ){ return 'json' }

    if( choice === 2 ){ return 'query' }

    return ( _key, value ) => value;
}

module.exports.fuzz = function( data )
{
    try
    {
        const provider = new FuzzedDataProvider( data );
        const input = createFuzzedInput( provider );
        const mode = pickMode( provider );
        const from = pickFrom( provider );
        const {
            validators,
            compileSchema,
            coerceQueryNumber,
            coerceQueryBoolean,
            coerceQueryDate,
            coerceJsonDate,
            groupErrorsByPath,
            toZodIssues,
            ZodLikeError,
            convertPropertyCasing,
            validate,
            is,
            parseQueryString,
            serializeString,
            serializeDate,
            serializeBuffer,
            serializeArray,
            coerceNumber,
            coerceBoolean,
            coerceDate,
            coerceBigInt,
            applyParseConstraints,
            ParseError,
            SerializationError
        } = runtime;

        coerceQueryNumber( input );
        coerceQueryBoolean( input );
        coerceQueryDate( input );
        coerceJsonDate( input );

        // Serialize / parse runtime helpers (expected errors swallowed)
        try
        {
            if( typeof input === 'string' )
            {
                serializeString( input );
                parseQueryString( input );
                coerceNumber( input, 'n' );
                coerceBoolean( input, 'b' );
                coerceBigInt( input, 'bi' );
            }

            if( input instanceof Date ){ serializeDate( input ) }

            if( Buffer.isBuffer( input )){ serializeBuffer( input ) }

            if( Array.isArray( input ))
            {
                serializeArray( input, v => ( typeof v === 'string' ? serializeString( v ) : String( v )));
            }

            coerceDate( input, 'd' );
            applyParseConstraints( input, 'c', [{ type : 'minLength', value : 0 }], 'json' );
        }
        catch( e )
        {
            if( !( e instanceof ParseError ) && !( e instanceof SerializationError ) &&
                !( e instanceof RangeError ) && !( e instanceof TypeError ))
            {
                throw e;
            }
        }

        const ctx = { success : true, errors : [], mode, from, mutate : provider.consumeBoolean() };
        validators.string( input, 's', ctx );
        validators.number( input, 'n', ctx );
        validators.boolean( input, 'b', ctx );
        validators.array( Array.isArray( input ) ? input : [input], 'a', ctx, validators.any );
        validators.object( input && typeof input === 'object' ? input : {}, 'o', ctx, undefined );

        const schema = provider.pickValue([
            { type : 'string' },
            { type : 'number' },
            { type : 'boolean' },
            { type : 'array', items : { type : 'string' } },
            { type : 'object', properties : { a : { type : 'string' } }, additionalProperties : true },
            { anyOf : [{ type : 'string' }, { type : 'number' }] }
        ]);
        const compiled = compileSchema( schema );
        compiled( input, '', { success : true, errors : [], mode, from });

        validate( validators.any, input, { mode, from });
        is( validators.any, input, mode );

        if( input && typeof input === 'object' && !Array.isArray( input ))
        {
            convertPropertyCasing( input, provider.pickValue([
                'snake_case', 'camelCase', 'PascalCase', 'kebab-case', 'dot.case'
            ]));
        }

        if( ctx.errors.length )
        {
            groupErrorsByPath( ctx.errors );
            toZodIssues( ctx.errors );
            // Construct but do not throw
            void new ZodLikeError( ctx.errors );
        }
    }
    catch( e )
    {
        if( e instanceof RangeError || e instanceof TypeError ||
            ( runtime.ParseError && e instanceof runtime.ParseError ) ||
            ( runtime.SerializationError && e instanceof runtime.SerializationError ))
        {
            return;
        }

        throw e;
    }
};
