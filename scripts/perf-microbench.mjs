import { validators, getOrCompileSchema, is, validate } from '../dist/runtime/validators.js';

function objectSize( value )
{
    if( Array.isArray( value ))
    {
        return {
            kind       : 'array',
            length     : value.length,
            jsonBytes  : Buffer.byteLength( JSON.stringify( value ), 'utf8' )
        };
    }

    if( value !== null && typeof value === 'object' )
    {
        return {
            kind       : 'object',
            keys       : Object.keys( value ).length,
            jsonBytes  : Buffer.byteLength( JSON.stringify( value ), 'utf8' )
        };
    }

    return {
        kind      : typeof value,
        jsonBytes : Buffer.byteLength( JSON.stringify( value ), 'utf8' )
    };
}

function formatSize( size )
{
    if( size.kind === 'object' )
    {
        return `${size.keys} keys, ${size.jsonBytes} JSON bytes`;
    }

    if( size.kind === 'array' )
    {
        return `${size.length} items, ${size.jsonBytes} JSON bytes`;
    }

    return `${size.kind}, ${size.jsonBytes} JSON bytes`;
}

function bench( label, iterations, fn, sample )
{
    // Warmup
    for( let i = 0; i < Math.min( 50, iterations ); i++ ){ fn() }

    const start = performance.now();

    for( let i = 0; i < iterations; i++ ){ fn() }

    const ms = performance.now() - start;
    const usPerValidation = ( ms * 1000 ) / iterations;
    const opsPerSec = iterations / ( ms / 1000 );
    const size = sample === undefined ? undefined : objectSize( sample );
    const sizePart = size ? ` | size: ${formatSize( size )}` : '';

    console.log(
        `${label}: total ${ms.toFixed( 2 )}ms / ${iterations} iters` +
        ` | ${usPerValidation.toFixed( 3 )}µs per validation` +
        ` | ${opsPerSec.toFixed( 0 )} ops/s` +
        sizePart
    );
}

const wideKeys = Array.from({ length : 40 }, ( _, i ) => `k${i}` );
const wideObject = Object.fromEntries( wideKeys.map(( key, i ) => [key, i]));
const wideValidator = getOrCompileSchema({
    type                 : 'object',
    properties           : Object.fromEntries( wideKeys.map( key => [key, { type : 'number' }])),
    required             : wideKeys,
    additionalProperties : false
});

const nested = {
    a : { b : { c : { d : 1, e : 'x' } } },
    list : Array.from({ length : 20 }, ( _, i ) => ({ id : i, ok : true }))
};
const nestedValidator = getOrCompileSchema({
    type       : 'object',
    properties :
    {
        a :
        {
            type       : 'object',
            properties :
            {
                b :
                {
                    type       : 'object',
                    properties :
                    {
                        c :
                        {
                            type       : 'object',
                            properties :
                            {
                                d : { type : 'number' },
                                e : { type : 'string' }
                            },
                            required             : ['d', 'e'],
                            additionalProperties : false
                        }
                    },
                    required             : ['c'],
                    additionalProperties : false
                }
            },
            required             : ['b'],
            additionalProperties : false
        },
        list :
        {
            type  : 'array',
            items :
            {
                type                 : 'object',
                properties           : { id : { type : 'number' }, ok : { type : 'boolean' } },
                required             : ['id', 'ok'],
                additionalProperties : false
            }
        }
    },
    required             : ['a', 'list'],
    additionalProperties : false
});

const uniqueItems = Array.from({ length : 1000 }, ( _, i ) => ({ a : i, b : `v${i}` }));
const pattern = validators.safeRegExp( '^[a-z]{3,12}$' );
const patternValue = 'username';
const nestedPool = Array.from({ length : 32 }, () => structuredClone( nested ));
let nestedIdx = 0;

bench( 'wide object is() [reuse input]', 5000, () =>
{
    is( wideValidator, wideObject );
}, wideObject );

bench( 'nested validate() copy-out [no mutate]', 3000, () =>
{
    validate( nestedValidator, nested );
}, nested );

bench( 'nested mutate:true validate() [pooled clone]', 3000, () =>
{
    const input = nestedPool[nestedIdx++ % nestedPool.length];
    validate( nestedValidator, input, { mutate : true });
}, nested );

{
    const iterations = 1000;
    // Warmup
    for( let i = 0; i < 50; i++ )
    {
        const ctx = { success : true, errors : [], mode : 'strict' };
        validators.uniqueItems( uniqueItems, 'items', ctx );
    }

    const start = performance.now();

    for( let i = 0; i < iterations; i++ )
    {
        const ctx = { success : true, errors : [], mode : 'strict' };
        validators.uniqueItems( uniqueItems, 'items', ctx );
    }

    const ms = performance.now() - start;
    const usPerValidation = ( ms * 1000 ) / iterations;
    const usPerItem = ( ms * 1000 ) / ( iterations * uniqueItems.length );
    const size = objectSize( uniqueItems );

    console.log(
        `uniqueItems: total ${ms.toFixed( 2 )}ms / ${iterations} iters` +
        ` | ${usPerValidation.toFixed( 3 )}µs per validation` +
        ` | ${usPerItem.toFixed( 3 )}µs per item` +
        ` | size: ${formatSize( size )}`
    );
}

bench( 'pattern string validate', 50000, () =>
{
    const ctx = { success : true, errors : [], mode : 'strict' };
    validators.pattern( patternValue, 'v', ctx, pattern, 'Pattern' );
}, patternValue );

// Optional-heavy shape: 4 of 40 declared properties are actually present, which is what a wide
// settings/patch payload looks like in practice.
const optionalKeys = Array.from({ length : 40 }, ( _, i ) => `o${i}` );
const sparseObject = Object.fromEntries( optionalKeys.slice( 0, 4 ).map(( key, i ) => [key, i]));
const optionalValidator = getOrCompileSchema({
    type                 : 'object',
    properties           : Object.fromEntries( optionalKeys.map( key => [key, { type : 'number' }])),
    required             : [],
    additionalProperties : false
});

bench( 'optional-heavy object is() [4 of 40 present]', 20000, () =>
{
    is( optionalValidator, sparseObject );
}, sparseObject );

const numberOrUndefinedUnion = ( v, path, ctx ) =>
    validators.union( v, path, ctx, [validators.number, validators.undefined], 'Type<number|undefined>' );
const numberOrUndefinedFast = ( v, path, ctx ) => validators.optional( v, path, ctx, validators.number );

bench( 'nullable union via union()', 100000, () =>
{
    const ctx = { success : true, errors : [], mode : 'strict' };
    numberOrUndefinedUnion( 42, 'v', ctx );
}, 42 );

bench( 'nullable union via optional()', 100000, () =>
{
    const ctx = { success : true, errors : [], mode : 'strict' };
    numberOrUndefinedFast( 42, 'v', ctx );
}, 42 );

// Eight tagged arms, matching the last one — the case sequential arm-trying handles worst.
const taggedArms = Array.from({ length : 8 }, ( _, i ) =>
{
    const keys = ['kind', 'value'];

    return ( v, path, ctx ) =>
    {
        const obj = validators.object( v, path, ctx, keys );

        if( obj === false ){ return v }

        const data = validators.objectShell( obj, ctx, true );
        validators.props( obj, data, path, ctx, [
            ['kind', false, ( val, p, c ) => validators.literal( val, p, c, `t${i}` )],
            ['value', false, validators.number]
        ]);

        return data;
    };
});

const taggedMap = new Map( taggedArms.map(( arm, i ) => [`t${i}`, arm]));
const taggedValue = { kind : 't7', value : 1 };

bench( 'discriminated union via union() [8 arms, last match]', 20000, () =>
{
    const ctx = { success : true, errors : [], mode : 'strict' };
    validators.union( taggedValue, 'v', ctx, taggedArms, 'Type<Tagged>' );
}, taggedValue );

bench( 'discriminated union via taggedUnion() [8 arms]', 20000, () =>
{
    const ctx = { success : true, errors : [], mode : 'strict' };
    validators.taggedUnion( taggedValue, 'v', ctx, 'kind', taggedMap, 'Type<Tagged>' );
}, taggedValue );
