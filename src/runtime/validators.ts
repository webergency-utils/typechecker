export type ValidationMode = 'strict' | 'relaxed' | 'strip';

export interface IValidationError {
    path     : string
    value    : any
    error    : string
    /** Nested failures (e.g. per-arm errors for a failed union). */
    issues?  : IValidationError[]
}

/** Internal expected-type labels for custom `from` callbacks. Not exported from the package. */
type BaseType =
    | 'string' | 'number' | 'boolean' | 'bigint' | 'function' | 'symbol' | 'never'
    | 'Date' | 'RegExp' | 'Set' | 'Map' | 'Array' | 'Object' | 'instance'
    | 'null' | 'undefined' | 'tuple' | 'literal';

type FromOption = 'json' | 'query' | (( key: string, value: any, type: BaseType ) => any );

export interface ValidationContext {
    success     : boolean
    errors      : IValidationError[]
    mode        : ValidationMode
    from?       : FromOption
    wrapArrays? : boolean
    mutate?     : boolean
    root?       : any
}


export interface ValidationOptions {
    mode?         : ValidationMode
    from?         : FromOption
    wrapArrays?   : boolean
    /** When true, write validated/coerced values onto the input. Default false: always return new containers. */
    mutate?       : boolean
    schema?       : any
    errorFactory? : ( errors: IValidationError[]) => Error
}


const report = ( ctx: ValidationContext, path: string, expected: string, value: any, message?: string ) => 
{
    ctx.success = false;
    ctx.errors.push({ path, value, error : message || expected });
};

function isPlainObject( v: any ): boolean 
{
    if( v === null || typeof v !== 'object' || Array.isArray( v )) { return false }

    if( v instanceof Date || v instanceof RegExp || v instanceof Map || v instanceof Set ) { return false }

    if( typeof Buffer !== 'undefined' && typeof Buffer.isBuffer === 'function' && Buffer.isBuffer( v )) { return false }

    if( ArrayBuffer.isView( v ) || v instanceof ArrayBuffer ) { return false }

    const proto = Object.getPrototypeOf( v );

    return proto === Object.prototype || proto === null;
}

function testRegex( regex: RegExp, value: string ): boolean 
{
    if( !regex.global && !regex.sticky ) { return regex.test( value ) }

    const copy = new RegExp( regex.source, regex.flags );

    return copy.test( value );
}

function isMultipleOfNumber( v: number, n: number ): boolean 
{
    if( n === 0 || !Number.isFinite( n )) { return false }

    if( !Number.isFinite( v )) { return true }

    const q = v / n;

    return Math.abs( q - Math.round( q )) <= 1e-8 * Math.max( 1, Math.abs( q ));
}

function shouldMutate( ctx: ValidationContext ): boolean 
{
    return ctx.mutate === true;
}

function wantsQuery( ctx: ValidationContext ): boolean
{
    return ctx.from === 'query';
}

function wantsJsonRevive( ctx: ValidationContext ): boolean
{
    return ctx.from === 'json' || ctx.from === 'query';
}

function pathKey( path: string ): string
{
    if( !path ){ return '' }

    const bracket = path.lastIndexOf( '[' );
    const dot = path.lastIndexOf( '.' );

    if( bracket > dot )
    {
        const end = path.lastIndexOf( ']' );

        if( end > bracket ){ return path.slice( bracket + 1, end ) }
    }

    if( dot >= 0 ){ return path.slice( dot + 1 ) }

    return path;
}

function fromCustom( ctx: ValidationContext, path: string, value: any, type: BaseType ): any
{
    if( typeof ctx.from !== 'function' ){ return value }

    return ctx.from( pathKey( path ), value, type );
}

/** Query-style number coercion — shared by `from: 'query'` and `transform.ToNumber`. */
export function coerceQueryNumber( v: any ): any
{
    if( typeof v === 'number' ){ return v }

    if( typeof v === 'string' && v.trim() !== '' )
    {
        const parsed = parseFloat( v );

        if( !Number.isNaN( parsed )){ return parsed }
    }

    return v;
}

/** Query-style boolean coercion — shared by `from: 'query'` and `transform.ToBoolean`. */
export function coerceQueryBoolean( v: any ): any
{
    if( typeof v === 'boolean' ){ return v }

    if( typeof v === 'string' || typeof v === 'number' )
    {
        const s = String( v ).toLowerCase();

        if( s === 'true' || s === '1' || s === 'yes' || s === 'on' ){ return true }

        if( s === 'false' || s === '0' || s === 'no' || s === 'off' ){ return false }
    }

    return v;
}

/** JSON-wire Date revival (ISO / date-parseable strings only). */
export function coerceJsonDate( v: any ): any
{
    if( v instanceof Date && !Number.isNaN( v.getTime())){ return v }

    if( typeof v === 'string' )
    {
        const parsed = new Date( v );

        if( !Number.isNaN( parsed.getTime())){ return parsed }
    }

    return v;
}

/** Query-style Date coercion — shared by `from: 'query'` and `transform.ToDate`. */
export function coerceQueryDate( v: any ): any
{
    const fromJson = coerceJsonDate( v );

    if( fromJson !== v ){ return fromJson }

    if( v instanceof Date && !Number.isNaN( v.getTime())){ return v }

    if( typeof v === 'number' && Number.isFinite( v ))
    {
        const parsed = new Date( v );

        if( !Number.isNaN( parsed.getTime())){ return parsed }
    }

    return v;
}

const EMAIL_LOCAL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
const EMAIL_DOMAIN_RE = /^(?=.{1,253}$)(?:(?!-)[A-Za-z0-9-]{1,63}(?<!-)\.)+[A-Za-z]{2,63}$/i;
const IDN_EMAIL_LOCAL_RE = /^[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+$/u;
const IDN_EMAIL_DOMAIN_RE = /^(?=.{1,253}$)(?:(?!-)[\p{L}\p{N}-]{1,63}(?<!-)\.)+[\p{L}]{2,63}$/u;
const HOSTNAME_RE = /^(?=.{1,253}$)(?:localhost|(?:(?!-)[A-Za-z0-9-]{1,63}(?<!-)\.)+[A-Za-z]{2,63})$/i;
const IDN_HOSTNAME_RE = /^(?=.{1,253}$)(?:localhost|(?:(?!-)[\p{L}\p{N}-]{1,63}(?<!-)\.)+[\p{L}]{2,63})$/iu;
const URI_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s<>"{}|\\^`]*$/;
const IRI_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\S+$/u;
const URI_TEMPLATE_RE = /^(?:[^{}\s]|\{[+#./;?&=,!@|]?(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2})(?:\.?(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2}))*(?::[1-9]\d{0,3}|\*)?(?:,(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2})(?:\.?(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2}))*(?::[1-9]\d{0,3}|\*)?)*\})+$/;

function isEmail( value: string ): boolean 
{
    if( value.length > 254 ){ return false }

    const at = value.lastIndexOf( '@' );

    if( at < 1 || at !== value.indexOf( '@' ) || at === value.length - 1 ){ return false }

    const local = value.slice( 0, at );
    const domain = value.slice( at + 1 );

    if( local.length > 64 ){ return false }

    if( local.startsWith( '.' ) || local.endsWith( '.' ) || local.includes( '..' )){ return false }

    if( !EMAIL_LOCAL_RE.test( local )){ return false }

    if( !EMAIL_DOMAIN_RE.test( domain )){ return false }

    return true;
}

function isIdnEmail( value: string ): boolean 
{
    if( value.length > 254 ){ return false }

    const at = value.lastIndexOf( '@' );

    if( at < 1 || at !== value.indexOf( '@' ) || at === value.length - 1 ){ return false }

    const local = value.slice( 0, at );
    const domain = value.slice( at + 1 );

    if( local.length > 64 ){ return false }

    if( local.startsWith( '.' ) || local.endsWith( '.' ) || local.includes( '..' )){ return false }

    if( !IDN_EMAIL_LOCAL_RE.test( local )){ return false }

    if( !IDN_EMAIL_DOMAIN_RE.test( domain )){ return false }

    return true;
}

function isHostname( value: string ): boolean 
{
    return HOSTNAME_RE.test( value );
}

function isIdnHostname( value: string ): boolean 
{
    return IDN_HOSTNAME_RE.test( value );
}

function isUri( value: string ): boolean 
{
    if( !URI_RE.test( value )){ return false }

    try 
    {
        // eslint-disable-next-line no-new
        new URL( value );

        return true;
    }
    catch 
    {
        // mailto:, urn:, and some other schemes are valid URIs but may throw in URL()
        return /^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s<>"{}|\\^`]+$/.test( value );
    }
}

function isUriReference( value: string ): boolean 
{
    if( value === '' ){ return true }

    if( isUri( value )){ return true }

    if( /[\s<>"{}|\\^`]/.test( value )){ return false }

    try 
    {
        // eslint-disable-next-line no-new
        new URL( value, 'http://example.com' );

        return true;
    }
    catch 
    {
        return false;
    }
}

function isIri( value: string ): boolean 
{
    if( !IRI_RE.test( value )){ return false }

    if( /[\u0000-\u001F\u007F]/.test( value )){ return false }

    try 
    {
        // eslint-disable-next-line no-new
        new URL( value );

        return true;
    }
    catch 
    {
        return /^[a-zA-Z][a-zA-Z0-9+.-]*:\S+$/u.test( value );
    }
}

function isIriReference( value: string ): boolean 
{
    if( value === '' ){ return true }

    if( isIri( value )){ return true }

    if( /\s|[\u0000-\u001F\u007F]/.test( value )){ return false }

    try 
    {
        // eslint-disable-next-line no-new
        new URL( value, 'http://example.com' );

        return true;
    }
    catch 
    {
        return /^[^<>"{}|\\^`]+$/u.test( value );
    }
}

function isUriTemplate( value: string ): boolean 
{
    if( !value || /\s/.test( value )){ return false }

    let depth = 0;

    for( const ch of value ) 
    {
        if( ch === '{' ){ depth++ }
        else if( ch === '}' ) 
        {
            if( depth === 0 ){ return false }
            depth--;
        }
    }

    if( depth !== 0 ){ return false }

    return URI_TEMPLATE_RE.test( value );
}

function parseFormatDate( value: string ): Date | undefined 
{
    if( typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test( value )){ return undefined }

    const parsed = new Date( value );

    if( Number.isNaN( parsed.getTime())){ return undefined }

    return parsed;
}

function parseFormatDateTime( value: string ): Date | undefined 
{
    if( typeof value !== 'string' ){ return undefined }

    const parsed = new Date( value );

    if( Number.isNaN( parsed.getTime())){ return undefined }

    return parsed;
}

function stableStringify( value: any, seen: WeakSet<object> = new WeakSet()): string | undefined 
{
    if( value === null || typeof value !== 'object' ) 
    {
        return JSON.stringify( value );
    }

    if( seen.has( value )) { return undefined }

    seen.add( value );

    if( Array.isArray( value )) 
    {
        const parts = value.map( item => 
        {
            const s = stableStringify( item, seen );

            return s === undefined ? '"[Circular]"' : s;
        });

        return `[${parts.join( ',' )}]`;
    }

    const keys = Object.keys( value ).sort();
    const parts = keys.map( key => `${JSON.stringify( key )}:${stableStringify( value[key], seen ) ?? '"[Circular]"'}` );

    return `{${parts.join( ',' )}}`;
}

export const validators = {
    coerceQueryNumber,
    coerceQueryBoolean,
    coerceQueryDate,
    coerceJsonDate,

    string : ( v: any, path: string, ctx: ValidationContext ) => 
    {
        if( typeof v === 'string' ){ return v }

        if( typeof ctx.from === 'function' )
        {
            const converted = fromCustom( ctx, path, v, 'string' );

            if( typeof converted === 'string' ){ return converted }
        }

        report( ctx, path, 'Type<string>', v );

        return v;
    },

    number : ( v: any, path: string, ctx: ValidationContext ) => 
    {
        if( wantsQuery( ctx )){ v = coerceQueryNumber( v ) }

        if( typeof v === 'number' ) 
        {
            if( Number.isNaN( v )) 
            {
                report( ctx, path, 'Type<number>', v );
            }

            return v;
        }

        if( typeof ctx.from === 'function' )
        {
            const converted = fromCustom( ctx, path, v, 'number' );

            if( typeof converted === 'number' && !Number.isNaN( converted )){ return converted }
        }

        report( ctx, path, 'Type<number>', v );

        return v;
    },

    bigint : ( v: any, path: string, ctx: ValidationContext ) => 
    {
        if( typeof v === 'bigint' ){ return v }

        if( wantsJsonRevive( ctx ) && typeof v === 'string' && v.trim() !== '' ) 
        {
            try 
            {
                return BigInt( v );
            }
            catch ( e ) { /* ignore */ }
        }

        if( wantsQuery( ctx ) && typeof v === 'number' && Number.isFinite( v ) && Number.isInteger( v )) 
        {
            try 
            {
                return BigInt( v );
            }
            catch ( e ) { /* ignore */ }
        }

        if( typeof ctx.from === 'function' )
        {
            const converted = fromCustom( ctx, path, v, 'bigint' );

            if( typeof converted === 'bigint' ){ return converted }
        }

        report( ctx, path, 'Type<bigint>', v );

        return v;
    },

    boolean : ( v: any, path: string, ctx: ValidationContext ) => 
    {
        if( wantsQuery( ctx )){ v = coerceQueryBoolean( v ) }

        if( typeof v === 'boolean' ){ return v }

        if( typeof ctx.from === 'function' )
        {
            const converted = fromCustom( ctx, path, v, 'boolean' );

            if( typeof converted === 'boolean' ){ return converted }
        }

        report( ctx, path, 'Type<boolean>', v );

        return v;
    },

    function : ( v: any, path: string, ctx: ValidationContext ) => 
    {
        if( typeof v === 'function' ){ return v }

        if( typeof ctx.from === 'function' )
        {
            const converted = fromCustom( ctx, path, v, 'function' );

            if( typeof converted === 'function' ){ return converted }
        }

        report( ctx, path, 'Type<function>', v );

        return v;
    },

    date : ( v: any, path: string, ctx: ValidationContext ) => 
    {
        if( wantsQuery( ctx )){ v = coerceQueryDate( v ) }
        else if( ctx.from === 'json' ){ v = coerceJsonDate( v ) }

        if( v instanceof Date && !Number.isNaN( v.getTime())) { return v }

        if( typeof ctx.from === 'function' )
        {
            const converted = fromCustom( ctx, path, v, 'Date' );

            if( converted instanceof Date && !Number.isNaN( converted.getTime())){ return converted }
        }

        report( ctx, path, 'Type<Date>', v );

        return v;
    },

    regexp : ( v: any, path: string, ctx: ValidationContext ) => 
    {
        if( v instanceof RegExp ) { return v }

        if( wantsJsonRevive( ctx ))
        {
            if( typeof v === 'string' ) 
            {
                const match = v.match( /^\/(.*)\/([gimuy]*)$/ );

                if( match ) 
                {
                    try 
                    {
                        return new RegExp( match[1], match[2]);
                    }
                    catch ( e ) { /* fall through */ }
                }
                else if( wantsQuery( ctx )) 
                {
                    try 
                    {
                        return new RegExp( v );
                    }
                    catch ( e ) { /* fall through */ }
                }
            }

            if( v && typeof v === 'object' && typeof v.source === 'string' ) 
            {
                try 
                {
                    return new RegExp( v.source, typeof v.flags === 'string' ? v.flags : '' );
                }
                catch ( e ) { /* fall through */ }
            }
        }

        if( typeof ctx.from === 'function' )
        {
            const converted = fromCustom( ctx, path, v, 'RegExp' );

            if( converted instanceof RegExp ){ return converted }
        }

        report( ctx, path, 'Type<RegExp>', v );

        return v;
    },

    null : ( v: any, path: string, ctx: ValidationContext ) => 
    {
        if( v === null ){ return null }

        if( typeof ctx.from === 'function' )
        {
            const converted = fromCustom( ctx, path, v, 'null' );

            if( converted === null ){ return null }
        }

        report( ctx, path, 'Type<null>', v );

        return null;
    },

    undefined : ( v: any, path: string, ctx: ValidationContext ) => 
    {
        if( v === undefined ){ return undefined }

        if( typeof ctx.from === 'function' )
        {
            const converted = fromCustom( ctx, path, v, 'undefined' );

            if( converted === undefined ){ return undefined }
        }

        report( ctx, path, 'Type<undefined>', v );

        return undefined;
    },

    literal : ( v: any, path: string, ctx: ValidationContext, expected: any ) => 
    {
        if( v === expected ){ return v }

        if( wantsQuery( ctx )) 
        {
            if( typeof expected === 'number' ) 
            {
                const p = coerceQueryNumber( v );

                if( p === expected ) { return p }
            }

            if( typeof expected === 'boolean' ) 
            {
                const val = coerceQueryBoolean( v );

                if( val === expected ) { return val }
            }
        }

        if( typeof ctx.from === 'function' )
        {
            const converted = fromCustom( ctx, path, v, 'literal' );

            if( converted === expected ){ return converted }
        }

        const expStr = typeof expected === 'string' ? `'${expected}'` : expected;
        report( ctx, path, `Literal<${expStr}>`, v );

        return v;
    },

    array : ( v: any, path: string, ctx: ValidationContext, childValidator: Function ) => 
    {
        if( !Array.isArray( v )) 
        {
            if( ctx.wrapArrays && v !== undefined && v !== null ) 
            {
                v = [v];
            }
            else if( typeof ctx.from === 'function' )
            {
                const converted = fromCustom( ctx, path, v, 'Array' );

                if( Array.isArray( converted )){ v = converted }
                else 
                {
                    report( ctx, path, 'Type<Array>', v );

                    return v;
                }
            }
            else 
            {
                report( ctx, path, 'Type<Array>', v );

                return v;
            }
        }
        const mutate = shouldMutate( ctx );
        const data = mutate ? v : [];

        for( let i = 0; i < v.length; i++ ) 
        {
            const val = childValidator( v[i], path + '[' + i + ']', ctx );
            data[i] = val;
        }

        return data;
    },

    props : ( v: any, data: any, path: string, ctx: ValidationContext, props: [string, boolean, Function][]) => 
    {
        for( const [key, isOptional, validator] of props ) 
        {
            const val = v[key];
            const oldErrors = ctx.errors.length;
            const wasSuccess = ctx.success;
            const result = validator( val, path + '.' + key, ctx );

            if( ctx.success ) 
            {
                data[key] = result;
            }
            else if( isOptional && val === undefined ) 
            {
                ctx.errors.length = oldErrors;
                ctx.success = wasSuccess;
            }
        }
    },

    objectShell : ( v: any, ctx: ValidationContext ) => 
    {
        if( shouldMutate( ctx )) { return v }

        if( !isPlainObject( v )) { return v }

        if( ctx.mode === 'strip' ) { return {} }

        return { ...v };
    },

    stripExtras : ( data: any, ctx: ValidationContext, allowedKeys?: string[]) => 
    {
        if( !shouldMutate( ctx ) || ctx.mode !== 'strip' || !allowedKeys || !data || typeof data !== 'object' ) { return data }

        for( const k of Object.keys( data )) 
        {
            if( !allowedKeys.includes( k )) { delete data[k] }
        }

        return data;
    },

    additionalProps : ( v: any, data: any, path: string, ctx: ValidationContext, knownKeys: string[], childValidator: Function ) => 
    {
        if( !isPlainObject( v )){ return }

        for( const key of Object.keys( v )) 
        {
            if( knownKeys.includes( key )){ continue }

            data[key] = childValidator( v[key], path + '.' + key, ctx );
        }
    },

    object : ( v: any, path: string, ctx: ValidationContext, allowedKeys?: string[], expected: string = 'Type<Object>' ) => 
    {
        if( !isPlainObject( v )) 
        {
            if( typeof ctx.from === 'function' )
            {
                const converted = fromCustom( ctx, path, v, 'Object' );

                if( isPlainObject( converted )){ v = converted }
                else 
                {
                    report( ctx, path, expected, v );

                    return false;
                }
            }
            else 
            {
                report( ctx, path, expected, v );

                return false;
            }
        }

        if( ctx.mode === 'strict' && allowedKeys ) 
        {
            for( const k of Object.keys( v )) 
            {
                if( !allowedKeys.includes( k )) 
                {
                    report( ctx, path, `PropertyNotAllowed<${k}>`, v[k]);
                }
            }
        }

        return v;
    },

    templateLiteral : ( v: any, path: string, ctx: ValidationContext, regex: RegExp, expected: string ) => 
    {
        if( typeof v !== 'string' || !testRegex( regex, v )) 
        {
            report( ctx, path, expected, v );
        }

        return v;
    },

    minLength : ( v: string, path: string, ctx: ValidationContext, min: number, message?: string ) => 
    {
        if( v.length < min ) { report( ctx, path, `MinLength<${min}>`, v, message ) }

        return v;
    },

    maxLength : ( v: string, path: string, ctx: ValidationContext, max: number, message?: string ) => 
    {
        if( v.length > max ) { report( ctx, path, `MaxLength<${max}>`, v, message ) }

        return v;
    },

    minimum : ( v: number | bigint, path: string, ctx: ValidationContext, min: number | bigint, message?: string ) => 
    {
        if( v < min ) { report( ctx, path, `Minimum<${min}>`, v, message ) }

        return v;
    },

    maximum : ( v: number | bigint, path: string, ctx: ValidationContext, max: number | bigint, message?: string ) => 
    {
        if( v > max ) { report( ctx, path, `Maximum<${max}>`, v, message ) }

        return v;
    },

    exclusiveMinimum : ( v: number | bigint, path: string, ctx: ValidationContext, min: number | bigint, message?: string ) => 
    {
        if( v <= min ) { report( ctx, path, `ExclusiveMinimum<${min}>`, v, message ) }

        return v;
    },

    exclusiveMaximum : ( v: number | bigint, path: string, ctx: ValidationContext, max: number | bigint, message?: string ) => 
    {
        if( v >= max ) { report( ctx, path, `ExclusiveMaximum<${max}>`, v, message ) }

        return v;
    },

    multipleOf : ( v: number | bigint, path: string, ctx: ValidationContext, n: number | bigint, message?: string ) => 
    {
        if( typeof v === 'bigint' || typeof n === 'bigint' ) 
        {
            if( BigInt( v ) % BigInt( n ) !== 0n ) { report( ctx, path, `MultipleOf<${n}>`, v, message ) }
        }
        else if( !isMultipleOfNumber( v, n )) 
        {
            report( ctx, path, `MultipleOf<${n}>`, v, message );
        }

        return v;
    },

    pattern : ( v: string, path: string, ctx: ValidationContext, regex: RegExp, expected: string, message?: string ) => 
    {
        if( !testRegex( regex, v )) { report( ctx, path, expected, v, message ) }

        return v;
    },

    format : ( v: string, path: string, ctx: ValidationContext, format: string, message?: string ) => 
    {
        let regex: RegExp | undefined;
        let isValid = true;
        let result: any = v;

        switch ( format ) 
        {
            case 'email': isValid = isEmail( v ); break;
            case 'idn-email': isValid = isIdnEmail( v ); break;
            case 'uuid': regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i; break;
            case 'url': regex = /^(?:https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i; break;
            case 'ipv4': regex = /^(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/; break;
            case 'ipv6': regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/; break;
            case 'date': 
            {
                const parsed = parseFormatDate( v );

                if( !parsed ){ isValid = false }
                else if( wantsQuery( ctx )){ result = parsed }
                break;
            }
            case 'date-time': 
            {
                const parsed = parseFormatDateTime( v );

                if( !parsed ){ isValid = false }
                else if( wantsQuery( ctx )){ result = parsed }
                break;
            }

            case 'byte': regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/; break;
            case 'password': break; // Anything is a password
            case 'regex': try { new RegExp( v ) }
            catch{ isValid = false }; break;
            case 'hostname': isValid = isHostname( v ); break;
            case 'idn-hostname': isValid = isIdnHostname( v ); break;
            case 'uri': isValid = isUri( v ); break;
            case 'uri-reference': isValid = isUriReference( v ); break;
            case 'iri': isValid = isIri( v ); break;
            case 'iri-reference': isValid = isIriReference( v ); break;
            case 'uri-template': isValid = isUriTemplate( v ); break;
            case 'time': regex = /^\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[zZ]|[+-]\d{2}:\d{2})$/; break;
            case 'duration': regex = /^P(?!$)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+S)?)?$/; break;
            case 'objectId': regex = /^[0-9a-fA-F]{24}$/; break;
            default: isValid = false; break;
        }

        if( regex && !testRegex( regex, v )) { isValid = false }

        if( !isValid ) { report( ctx, path, `Format<${format}>`, v, message ) }

        return result;
    },

    minItems : ( v: any[], path: string, ctx: ValidationContext, min: number, message?: string ) => 
    {
        if( v.length < min ) { report( ctx, path, `MinItems<${min}>`, v, message ) }

        return v;
    },

    maxItems : ( v: any[], path: string, ctx: ValidationContext, max: number, message?: string ) => 
    {
        if( v.length > max ) { report( ctx, path, `MaxItems<${max}>`, v, message ) }

        return v;
    },

    uniqueItems : ( v: any[], path: string, ctx: ValidationContext, message?: string ) => 
    {
        const seen = new Set<any>();

        for( let i = 0; i < v.length; i++ ) 
        {
            const item = v[i];
            const key = typeof item === 'object' && item !== null
                ? stableStringify( item ) ?? item
                : item;

            if( seen.has( key )) 
            {
                report( ctx, path, 'UniqueItems', v, message );
                break;
            }
            seen.add( key );
        }

        return v;
    },

    custom : ( v: any, path: string, ctx: ValidationContext, fn: Function, message?: string ) => 
    {
        const pathParts = tokenizePath( path );
        const parentPath = joinPathSegments( pathParts.slice( 0, -1 ));
        const parent = getValueAtPath( ctx.root, parentPath );
        const last = pathParts[pathParts.length - 1];
        const index = last && last.startsWith( '[' ) ? parseInt( last.slice( 1, -1 ), 10 ) : undefined;

        if( !fn( v, { parent, root : ctx.root, path, index : Number.isNaN( index as number ) ? undefined : index })) 
        {
            report( ctx, path, fn.name ? `Custom<${fn.name}>` : 'Custom', v, message );
        }

        return v;
    },


    union : ( v: any, path: string, ctx: ValidationContext, checks: Function[], expected: string = 'Type<Union>' ) => 
    {
        const unionErrors: IValidationError[] = [];

        // Pass 1: No conversion
        for( const check of checks ) 
        {
            const subCtx = { ...ctx, success : true, errors : [], from : undefined };
            const val = check( v, path, subCtx );

            if( subCtx.success ) { return val }
            unionErrors.push( ...subCtx.errors );
        }

        // Pass 2: With conversion (only when caller opted in)
        if( ctx.from ) 
        {
            unionErrors.length = 0;

            for( const check of checks ) 
            {
                const subCtx = { ...ctx, success : true, errors : [] };
                const val = check( v, path, subCtx );

                if( subCtx.success ) { return val }
                unionErrors.push( ...subCtx.errors );
            }
        }

        ctx.success = false;
        ctx.errors.push({
            path,
            value  : v,
            error  : expected,
            issues : unionErrors.length > 0 ? unionErrors : undefined
        });

        return v;
    },

    tuple : ( v: any, path: string, ctx: ValidationContext, checks: Function[]) => 
    {
        if( !Array.isArray( v ) || v.length !== checks.length ) 
        {
            if( typeof ctx.from === 'function' )
            {
                const converted = fromCustom( ctx, path, v, 'tuple' );

                if( Array.isArray( converted ) && converted.length === checks.length )
                {
                    v = converted;
                }
                else 
                {
                    report( ctx, path, `Tuple<${checks.length}>`, v );

                    return v;
                }
            }
            else 
            {
                report( ctx, path, `Tuple<${checks.length}>`, v );

                return v;
            }
        }
        const mutate = shouldMutate( ctx );
        const data = mutate ? v : [];

        for( let i = 0; i < checks.length; i++ ) 
        {
            data[i] = checks[i]( v[i], path + '[' + i + ']', ctx );
        }

        return data;
    },

    any : ( v: any ) => v,

    never : ( v: any, path: string, ctx: ValidationContext ) => 
    {
        if( typeof ctx.from === 'function' )
        {
            fromCustom( ctx, path, v, 'never' );
        }

        report( ctx, path, 'Type<never>', v );

        return v;
    },

    symbol : ( v: any, path: string, ctx: ValidationContext ) => 
    {
        if( typeof v === 'symbol' ){ return v }

        if( typeof ctx.from === 'function' )
        {
            const converted = fromCustom( ctx, path, v, 'symbol' );

            if( typeof converted === 'symbol' ){ return converted }
        }

        report( ctx, path, 'Type<symbol>', v );

        return v;
    },

    instanceOf : ( v: any, path: string, ctx: ValidationContext, typeName: string ) => 
    {
        const ctor = ( globalThis as any )[typeName];

        if( ctor && v instanceof ctor ){ return v }

        if( typeof ctx.from === 'function' )
        {
            const converted = fromCustom( ctx, path, v, 'instance' );

            if( ctor && converted instanceof ctor ){ return converted }
        }

        report( ctx, path, `Type<${typeName}>`, v );

        return v;
    },

    requires : ( v: any, path: string, ctx: ValidationContext, reqs: string[], message?: string ) => 
    {
        if( v === undefined || v === null ) { return v }

        for( const r of reqs ) 
        {
            const resolved = resolvePath( path, r );

            if( !hasPath( ctx.root, resolved )) 
            {
                report( ctx, path, `Requires<${r}>`, v, message );
            }
        }

        return v;
    },

    record : ( v: any, path: string, ctx: ValidationContext, childValidator: Function ) => 
    {
        if( !isPlainObject( v )) 
        {
            if( typeof ctx.from === 'function' )
            {
                const converted = fromCustom( ctx, path, v, 'Object' );

                if( isPlainObject( converted )){ v = converted }
                else 
                {
                    report( ctx, path, 'Type<Object>', v );

                    return v;
                }
            }
            else 
            {
                report( ctx, path, 'Type<Object>', v );

                return v;
            }
        }
        const mutate = shouldMutate( ctx );
        const data = mutate ? v : {};

        for( const key of Object.keys( v )) 
        {
            data[key] = childValidator( v[key], path + '.' + key, ctx );
        }

        return data;
    },

    set : ( v: any, path: string, ctx: ValidationContext, childValidator: Function, message?: string ) => 
    {
        if( !( v instanceof Set )) 
        {
            if( wantsJsonRevive( ctx ) && Array.isArray( v )) 
            {
                v = new Set( v );
            }
            else if( wantsQuery( ctx ) && v !== undefined && v !== null ) 
            {
                v = new Set([v]);
            }
            else if( typeof ctx.from === 'function' )
            {
                const converted = fromCustom( ctx, path, v, 'Set' );

                if( converted instanceof Set ){ v = converted }
                else 
                {
                    report( ctx, path, 'Type<Set>', v, message );

                    return v;
                }
            }
            else 
            {
                report( ctx, path, 'Type<Set>', v, message );

                return v;
            }
        }
        const mutate = shouldMutate( ctx );
        const source = [...v];

        if( mutate ) { v.clear() }
        const data = mutate ? v : new Set();
        let index = 0;

        for( const item of source ) 
        {
            data.add( childValidator( item, `${path}[${index}]`, ctx ));
            index++;
        }

        return data;
    },

    map : ( v: any, path: string, ctx: ValidationContext, keyValidator: Function, valueValidator: Function, message?: string ) => 
    {
        if( !( v instanceof Map )) 
        {
            if( wantsJsonRevive( ctx ) && isPlainObject( v )) 
            {
                v = new Map( Object.entries( v ));
            }
            else if( typeof ctx.from === 'function' )
            {
                const converted = fromCustom( ctx, path, v, 'Map' );

                if( converted instanceof Map ){ v = converted }
                else 
                {
                    report( ctx, path, 'Type<Map>', v, message );

                    return v;
                }
            }
            else 
            {
                report( ctx, path, 'Type<Map>', v, message );

                return v;
            }
        }
        const mutate = shouldMutate( ctx );
        const source = [...v.entries()];

        if( mutate ) { v.clear() }
        const data = mutate ? v : new Map();

        for( const [key, val] of source ) 
        {
            const validatedKey = keyValidator( key, `${path}.key(${JSON.stringify( key )})`, ctx );
            const validatedVal = valueValidator( val, `${path}[${JSON.stringify( key )}]`, ctx );
            data.set( validatedKey, validatedVal );
        }

        return data;
    }
};

function tokenizePath( path: string ): string[] 
{
    const cleanPath = path.startsWith( '.' ) ? path.substring( 1 ) : path;

    if( !cleanPath ) { return [] }

    const segments: string[] = [];
    let buf = '';

    for( let i = 0; i < cleanPath.length; i++ ) 
    {
        const ch = cleanPath[i];

        if( ch === '.' ) 
        {
            if( buf ) 
            {
                segments.push( buf );
                buf = '';
            }
        }
        else if( ch === '[' ) 
        {
            if( buf ) 
            {
                segments.push( buf );
                buf = '';
            }

            const end = cleanPath.indexOf( ']', i );

            if( end === -1 ) 
            {
                buf += cleanPath.substring( i );
                break;
            }
            segments.push( cleanPath.substring( i, end + 1 ));
            i = end;
        }
        else 
        {
            buf += ch;
        }
    }

    if( buf ) { segments.push( buf ) }

    return segments;
}

function joinPathSegments( segments: string[]): string 
{
    let result = '';

    for( const seg of segments ) 
    {
        if( seg.startsWith( '[' )) 
        {
            result += seg;
        }
        else if( result ) 
        {
            result += '.' + seg;
        }
        else 
        {
            result = seg;
        }
    }

    return result;
}

function resolvePath( currentPath: string, targetPath: string ): string 
{
    if( !targetPath.startsWith( '.' )) 
    {
        return targetPath;
    }
    const dotsMatch = targetPath.match( /^\.+/ );
    const dots = dotsMatch ? dotsMatch[0].length : 0;
    const targetClean = targetPath.substring( dots );

    const currentParts = tokenizePath( currentPath );
    const baseParts = currentParts.slice( 0, Math.max( 0, currentParts.length - dots ));

    if( targetClean ) 
    {
        baseParts.push( ...tokenizePath( targetClean ));
    }

    return joinPathSegments( baseParts );
}

function getValueAtPath( obj: any, path: string ): any 
{
    if( !obj || typeof obj !== 'object' ) { return undefined }

    const parts = tokenizePath( path );

    if( parts.length === 0 ) { return obj }
    let current = obj;

    for( const part of parts ) 
    {
        if( current === null || current === undefined || typeof current !== 'object' ) 
        {
            return undefined;
        }

        if( part.startsWith( '[' ) && part.endsWith( ']' )) 
        {
            const idx = parseInt( part.slice( 1, -1 ), 10 );
            current = current[idx];
        }
        else 
        {
            current = current[part];
        }
    }

    return current;
}

function hasPath( obj: any, path: string ): boolean 
{
    const val = getValueAtPath( obj, path );

    return val !== undefined && val !== null;
}

export class MetadataStoreClass 
{
    private validators = new Map<string, Function>();
    private schemas = new Map<string, any>();
    private compiledSchemas = new WeakMap<object, Function>();

    registerValidator( hash: string, validator: Function ) 
    {
        this.validators.set( hash, validator );
    }

    getValidator( hash: string ): Function 
    {
        const val = this.validators.get( hash );

        if( !val ) { throw new Error( `Validator not found for hash: ${hash}` ) }

        return val;
    }

    registerSchema( hash: string, schema: any ) 
    {
        this.schemas.set( hash, schema );
    }

    getSchema( hash: string ): any 
    {
        const schema = this.schemas.get( hash );

        if( !schema ) { throw new Error( `Schema not found for hash: ${hash}` ) }

        return schema;
    }

    getOrCompileSchema( schema: any ): Function 
    {
        if( typeof schema !== 'object' || schema === null ) 
        {
            throw new Error( 'Invalid JSON Schema: must be a non-null object' );
        }
        let compiled = this.compiledSchemas.get( schema );

        if( !compiled ) 
        {
            compiled = compileSchema( schema );
            this.compiledSchemas.set( schema, compiled );
        }

        return compiled;
    }

    is( validator: Function, value: any, options?: ValidationMode | ValidationOptions ): boolean 
    {
        const opt = options;
        const mode = typeof opt === 'string' ? opt : ( opt?.mode || 'strict' );
        // Type predicates require the value already match T — never coerce.
        const wrapArrays = typeof opt === 'object' ? opt?.wrapArrays : undefined;
        const mutate = typeof opt === 'object' ? opt?.mutate === true : false;
        const ctx: ValidationContext = { success : true, errors : [], mode, wrapArrays, mutate, root : value };
        validator( value, '', ctx );

        return ctx.success;
    }

    assert( validator: Function, value: any, options?: ValidationMode | ValidationOptions ): any 
    {
        const opt = options;
        const mode = typeof opt === 'string' ? opt : ( opt?.mode || 'strict' );
        const from = typeof opt === 'object' ? opt?.from : undefined;
        const wrapArrays = typeof opt === 'object' ? opt?.wrapArrays : undefined;
        const mutate = typeof opt === 'object' ? opt?.mutate === true : false;
        const ctx: ValidationContext = { success : true, errors : [], mode, from, wrapArrays, mutate, root : value };
        const res = validator( value, '', ctx );

        if( !ctx.success ) 
        {
            if( typeof opt === 'object' && opt?.errorFactory ) 
            {
                throw opt.errorFactory( ctx.errors );
            }
            throw new Error( 'Validation Error: ' + ctx.errors.map( e => e.path ? `${e.path}: ${e.error}` : e.error ).join( ', ' ));
        }

        return res;
    }

    assertGuard( validator: Function, value: any, options?: ValidationMode | ValidationOptions ): void 
    {
        const opt = options;
        const mode = typeof opt === 'string' ? opt : ( opt?.mode || 'strict' );
        // Assertion predicates require the value already match T — never coerce.
        const wrapArrays = typeof opt === 'object' ? opt?.wrapArrays : undefined;
        const mutate = typeof opt === 'object' ? opt?.mutate === true : false;
        const ctx: ValidationContext = { success : true, errors : [], mode, wrapArrays, mutate, root : value };
        validator( value, '', ctx );

        if( !ctx.success ) 
        {
            if( typeof opt === 'object' && opt?.errorFactory ) 
            {
                throw opt.errorFactory( ctx.errors );
            }
            throw new Error( 'Validation Error: ' + ctx.errors.map( e => e.path ? `${e.path}: ${e.error}` : e.error ).join( ', ' ));
        }
    }

    validate( validator: Function, value: any, options?: ValidationMode | ValidationOptions ): { success : boolean, errors : IValidationError[], data : any } 
    {
        const opt = options;
        const mode = typeof opt === 'string' ? opt : ( opt?.mode || 'strict' );
        const from = typeof opt === 'object' ? opt?.from : undefined;
        const wrapArrays = typeof opt === 'object' ? opt?.wrapArrays : undefined;
        const mutate = typeof opt === 'object' ? opt?.mutate === true : false;
        const ctx: ValidationContext = { success : true, errors : [], mode, from, wrapArrays, mutate, root : value };
        const res = validator( value, '', ctx );

        return { success : ctx.success, errors : ctx.errors, data : res };
    }
}

export function groupErrorsByPath( errors: IValidationError[]): Record<string, { value : any, errors : string[] }> 
{
    const grouped: Record<string, { value : any, errors : string[] }> = {};

    const visit = ( list: IValidationError[]) => 
    {
        for( const err of list ) 
        {
            if( !grouped[err.path]) 
            {
                grouped[err.path] = { value : err.value, errors : [] };
            }

            if( !grouped[err.path].errors.includes( err.error )) 
            {
                grouped[err.path].errors.push( err.error );
            }

            if( err.issues?.length ){ visit( err.issues ) }
        }
    };

    visit( errors );

    return grouped;
}

export const MetadataStore = new MetadataStoreClass();

export function compileSchema( schema: any ): ( v: any, path: string, ctx: any ) => any 
{
    const rootDefs = schema.$defs || schema.definitions || {};
    const compiledDefs = new Map<string, any>();

    function build( subSchema: any ): ( v: any, path: string, ctx: any ) => any 
    {
        if( !subSchema || typeof subSchema !== 'object' ) 
        {
            return ( v ) => v;
        }

        if( subSchema.$ref ) 
        {
            const refPath = subSchema.$ref;

            if( compiledDefs.has( refPath )) 
            {
                return ( v, path, ctx ) => compiledDefs.get( refPath )( v, path, ctx );
            }

            const parts = refPath.split( '/' );
            const defName = parts[parts.length - 1];
            const targetSchema = rootDefs[defName];

            if( !targetSchema ) 
            {
                throw new Error( `Schema reference not found: ${refPath}` );
            }

            let resolved: any = null;
            const proxy = ( v: any, path: string, ctx: any ) => 
            {
                if( !resolved ) 
                {
                    resolved = build( targetSchema );
                }

                return resolved( v, path, ctx );
            };

            compiledDefs.set( refPath, proxy );

            return proxy;
        }

        if( subSchema['x-typescript-type'] === 'Date' ) 
        {
            return ( v, path, ctx ) => validators.date( v, path, ctx );
        }

        if( subSchema['x-typescript-type'] === 'RegExp' ) 
        {
            return ( v, path, ctx ) => validators.regexp( v, path, ctx );
        }

        if( subSchema['x-typescript-type'] === 'bigint' ) 
        {
            return ( v, path, ctx ) => validators.bigint( v, path, ctx );
        }

        if( subSchema['x-typescript-type'] === 'undefined' ) 
        {
            return ( v, path, ctx ) => validators.undefined( v, path, ctx );
        }

        if( subSchema['x-typescript-type'] === 'Set' ) 
        {
            const child = build( subSchema.items || {});

            return ( v, path, ctx ) => validators.set( v, path, ctx, child );
        }

        if( subSchema['x-typescript-type'] === 'Map' ) 
        {
            const keyCheck = build( subSchema.key || { type : 'string' });
            const valueCheck = build( subSchema.value || {});

            return ( v, path, ctx ) => validators.map( v, path, ctx, keyCheck, valueCheck );
        }

        if( subSchema['x-typescript-type'] === 'Promise' ) 
        {
            return ( v, path, ctx ) => 
            {
                if( !( v instanceof Promise )) 
                {
                    report( ctx, path, 'Type<Promise>', v );
                }

                return v;
            };
        }

        if( typeof subSchema['x-typescript-type'] === 'string' &&
            ['Uint8Array', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array', 'Float32Array', 'Float64Array', 'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Buffer'].includes( subSchema['x-typescript-type'])) 
        {
            const typeName = subSchema['x-typescript-type'] as string;

            return ( v, path, ctx ) => 
            {
                const ctor = ( globalThis as any )[typeName];

                if( !ctor || !( v instanceof ctor )) 
                {
                    report( ctx, path, `Type<${typeName}>`, v );
                }

                return v;
            };
        }

        if( subSchema.allOf ) 
        {
            const checks = subSchema.allOf.map(( s: any ) => build( s ));

            return ( v, path, ctx ) => 
            {
                const prevMode = ctx.mode;

                if( ctx.mode !== 'strip' ){ ctx.mode = 'relaxed' }
                let data = validators.objectShell( v, ctx );

                for( const check of checks ) 
                {
                    const val = check( v, path, ctx );

                    if( isPlainObject( val ) && isPlainObject( data )) 
                    {
                        Object.assign( data, val );
                    }
                    else 
                    {
                        data = val;
                    }
                }

                ctx.mode = prevMode;

                return data;
            };
        }

        if( subSchema.type === 'string' ) 
        {
            const minLength = subSchema.minLength;
            const maxLength = subSchema.maxLength;
            const pattern = subSchema.pattern ? new RegExp( subSchema.pattern ) : undefined;
            const patternStr = subSchema.pattern;
            const format = subSchema.format;

            return ( v, path, ctx ) => 
            {
                v = validators.string( v, path, ctx );

                if( v === undefined || v === null ) { return v }

                if( minLength !== undefined ) { validators.minLength( v, path, ctx, minLength ) }

                if( maxLength !== undefined ) { validators.maxLength( v, path, ctx, maxLength ) }

                if( pattern !== undefined ) { validators.pattern( v, path, ctx, pattern, patternStr ) }

                if( format !== undefined ) { v = validators.format( v, path, ctx, format ) }

                return v;
            };
        }

        if( subSchema.type === 'number' || subSchema.type === 'integer' ) 
        {
            const isInt = subSchema.type === 'integer';
            const minimum = subSchema.minimum;
            const maximum = subSchema.maximum;
            const exclusiveMinimum = subSchema.exclusiveMinimum;
            const exclusiveMaximum = subSchema.exclusiveMaximum;
            const multipleOf = subSchema.multipleOf;

            return ( v, path, ctx ) => 
            {
                v = validators.number( v, path, ctx );

                if( v === undefined || v === null ) { return v }

                if( isInt && typeof v === 'number' && !Number.isInteger( v )) 
                {
                    report( ctx, path, 'Type<integer>', v );
                }

                if( minimum !== undefined ) { validators.minimum( v, path, ctx, minimum ) }

                if( maximum !== undefined ) { validators.maximum( v, path, ctx, maximum ) }

                if( exclusiveMinimum !== undefined ) { validators.exclusiveMinimum( v, path, ctx, exclusiveMinimum ) }

                if( exclusiveMaximum !== undefined ) { validators.exclusiveMaximum( v, path, ctx, exclusiveMaximum ) }

                if( multipleOf !== undefined ) { validators.multipleOf( v, path, ctx, multipleOf ) }

                return v;
            };
        }

        if( subSchema.type === 'boolean' ) 
        {
            return ( v, path, ctx ) => validators.boolean( v, path, ctx );
        }

        if( subSchema.type === 'null' ) 
        {
            return ( v, path, ctx ) => validators.null( v, path, ctx );
        }

        if( subSchema.anyOf ) 
        {
            const checks = subSchema.anyOf.map(( s: any ) => build( s ));

            return ( v, path, ctx ) => validators.union( v, path, ctx, checks );
        }

        if( subSchema.type === 'array' ) 
        {
            if( Array.isArray( subSchema.items )) 
            {
                const checks = subSchema.items.map(( s: any ) => build( s ));

                return ( v, path, ctx ) => validators.tuple( v, path, ctx, checks );
            }
            else 
            {
                const check = build( subSchema.items );
                const minItems = subSchema.minItems;
                const maxItems = subSchema.maxItems;
                const uniqueItems = subSchema.uniqueItems;

                return ( v, path, ctx ) => 
                {
                    v = validators.array( v, path, ctx, check );

                    if( Array.isArray( v )) 
                    {
                        if( minItems !== undefined ) { validators.minItems( v, path, ctx, minItems ) }

                        if( maxItems !== undefined ) { validators.maxItems( v, path, ctx, maxItems ) }

                        if( uniqueItems ) { validators.uniqueItems( v, path, ctx ) }
                    }

                    return v;
                };
            }
        }

        if( subSchema.type === 'object' ) 
        {
            const props = Object.entries( subSchema.properties || {});
            const required = subSchema.required || [];
            const propVals = props.map(([key, s]: [string, any]) => 
            {
                const isOptional = !required.includes( key );
                const check = build( s );

                return [key, isOptional, check] as [string, boolean, any];
            });

            const knownKeys = Object.keys( subSchema.properties || {});
            const additional = 'additionalProperties' in subSchema
                ? subSchema.additionalProperties
                : false;
            const strictKeys = additional === false ? knownKeys : undefined;
            const additionalCheck = additional && typeof additional === 'object' ? build( additional ) : undefined;

            return ( v, path, ctx ) => 
            {
                const obj = validators.object( v, path, ctx, strictKeys, 'Object' );

                if( obj === false ){ return v }
                const data = validators.objectShell( obj, ctx );
                validators.props( obj, data, path, ctx, propVals );

                if( additionalCheck ) 
                {
                    validators.additionalProps( obj, data, path, ctx, knownKeys, additionalCheck );
                }
                else if( additional === false ) 
                {
                    validators.stripExtras( data, ctx, knownKeys );
                }

                return data;
            };
        }

        if( subSchema.const !== undefined ) 
        {
            const expected = subSchema.const;

            return ( v, path, ctx ) => 
            {
                if( v !== expected ) 
                {
                    report( ctx, path, `Const<${JSON.stringify( expected )}>`, v );
                }

                return v;
            };
        }

        return ( v ) => v;
    }

    return build( schema );
}

export function toZodIssues( errors: IValidationError[])
{
    const issues: any[] = [];

    const visit = ( list: IValidationError[]) => 
    {
        for( const err of list ) 
        {
            const zodPath = err.path
                .split( /\.|\[|\]/ )
                .filter( Boolean )
                .map(( segment ) => 
                {
                    if( isNaN( Number( segment ))){ return segment }

                    return Number( segment );
                });

            issues.push({
                code     : 'custom',
                path     : zodPath,
                message  : err.error,
                received : err.value
            });

            if( err.issues?.length ){ visit( err.issues ) }
        }
    };

    visit( errors );

    return issues;
}

export class ZodLikeError extends Error
{
    public issues : any[];

    constructor( errors: IValidationError[])
    {
        super( 'Validation failed' );
        this.name = 'ZodError';
        this.issues = toZodIssues( errors );
    }
}

( globalThis as any ).__WEBERGENCY_TYPECHECKER_METADATA_STORE__ = MetadataStore;
( globalThis as any ).__WEBERGENCY_TYPECHECKER_VALIDATORS__ = validators;
