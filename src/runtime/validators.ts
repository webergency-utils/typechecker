export type ValidationMode = 'strict' | 'relaxed' | 'strip';

export interface IValidationError {
    path  : string
    value : any
    error : string
}

export interface ValidationContext {
    success     : boolean
    errors      : IValidationError[]
    mode        : ValidationMode
    tryConvert? : boolean
    wrapArrays? : boolean
    root?       : any
}


export interface ValidationOptions {
    mode?         : ValidationMode
    tryConvert?   : boolean
    wrapArrays?   : boolean
    schema?       : any
    errorFactory? : ( errors: IValidationError[] ) => Error
}


const report = ( ctx: ValidationContext, path: string, expected: string, value: any, message?: string ) => 
{
    ctx.success = false;
    ctx.errors.push( { path, value, error : message || expected } );
};

export const validators = {
    string : ( v: any, path: string, ctx: ValidationContext ) => 
    {
        if( typeof v !== 'string' ) 
        {
            report( ctx, path, 'Type<string>', v );
        }

        return v;
    },

    number : ( v: any, path: string, ctx: ValidationContext ) => 
    {
        if( typeof v !== 'number' ) 
        {
            if( ctx.tryConvert && typeof v === 'string' && v.trim() !== '' ) 
            {
                const parsed = parseFloat( v );

                if( !isNaN( parsed ) ) {return parsed}
            }
            report( ctx, path, 'Type<number>', v );
        }

        return v;
    },

    bigint : ( v: any, path: string, ctx: ValidationContext ) => 
    {
        if( typeof v !== 'bigint' ) 
        {
            if( ctx.tryConvert && typeof v === 'string' && v.trim() !== '' ) 
            {
                try 
                {
                    return BigInt( v );
                }
                catch ( e ) {/* ignore */}
            }
            report( ctx, path, 'Type<bigint>', v );
        }

        return v;
    },

    boolean : ( v: any, path: string, ctx: ValidationContext ) => 
    {
        if( typeof v !== 'boolean' ) 
        {
            if( ctx.tryConvert && ( v === undefined || v === null ) ) {return false}

            if( ctx.tryConvert && ( typeof v === 'string' || typeof v === 'number' ) ) 
            {
                const s = String( v ).toLowerCase();

                if( s === 'true' || s === '1' || s === 'yes' || s === 'on' ) {return true}

                if( s === 'false' || s === '0' || s === 'no' || s === 'off' ) {return false}
            }
            report( ctx, path, 'Type<boolean>', v );
        }

        return v;
    },

    date : ( v: any, path: string, ctx: ValidationContext ) => 
    {
        if( !( v instanceof Date ) || isNaN( v.getTime() ) ) 
        {
            if( ctx.tryConvert && typeof v === 'string' ) 
            {
                const parsed = new Date( v );

                if( !isNaN( parsed.getTime() ) ) {return parsed}
            }
            report( ctx, path, 'Type<Date>', v );
        }

        return v;
    },

    regexp : ( v: any, path: string, ctx: ValidationContext ) => 
    {
        if( !( v instanceof RegExp ) ) 
        {
            if( ctx.tryConvert && typeof v === 'string' ) 
            {
                const match = v.match( /^\/(.*)\/([gimuy]*)$/ );

                if( match ) 
                {
                    try 
                    {
                        return new RegExp( match[1], match[2] );
                    }
                    catch ( e ) { }
                }
                else 
                {
                    try 
                    {
                        return new RegExp( v );
                    }
                    catch ( e ) { }
                }
            }
            report( ctx, path, 'Type<RegExp>', v );
        }

        return v;
    },

    null : ( v: any, path: string, ctx: ValidationContext ) => 
    {
        if( v !== null ) 
        {
            report( ctx, path, 'Type<null>', v );
        }

        return null;
    },

    undefined : ( v: any, path: string, ctx: ValidationContext ) => 
    {
        if( v !== undefined ) 
        {
            report( ctx, path, 'Type<undefined>', v );
        }

        return undefined;
    },

    literal : ( v: any, path: string, ctx: ValidationContext, expected: any ) => 
    {
        if( v !== expected ) 
        {
            if( ctx.tryConvert && ( v === undefined || v === null ) ) 
            {
                if( typeof expected === 'boolean' ) 
                {
                    if( expected === false ) {return false}
                }
            }

            if( ctx.tryConvert && typeof v === 'string' ) 
            {
                if( typeof expected === 'number' ) 
                {
                    const p = parseFloat( v );

                    if( p === expected ) {return p}
                }

                if( typeof expected === 'boolean' ) 
                {
                    const s = v.toLowerCase();
                    let val: boolean | undefined;

                    if( s === 'true' || s === '1' || s === 'yes' || s === 'on' ) {val = true}
                    else if( s === 'false' || s === '0' || s === 'no' || s === 'off' ) {val = false}

                    if( val === expected ) {return val}
                }
            }
            const expStr = typeof expected === 'string' ? `'${expected}'` : expected;
            report( ctx, path, `Literal<${expStr}>`, v );
        }

        return v;
    },

    array : ( v: any, path: string, ctx: ValidationContext, childValidator: Function ) => 
    {
        if( !Array.isArray( v ) ) 
        {
            if( ctx.wrapArrays && v !== undefined && v !== null ) 
            {
                v = [v];
            }
            else 
            {
                report( ctx, path, 'Type<Array>', v );

                return v;
            }
        }
        const data = ctx.mode === 'strip' ? [] : v;

        for( let i = 0; i < v.length; i++ ) 
        {
            const val = childValidator( v[i], path + '[' + i + ']', ctx );

            if( ctx.mode === 'strip' ) {( data as any[] ).push( val )}
        }

        return data;
    },

    props : ( v: any, data: any, path: string, ctx: ValidationContext, props: [string, boolean, Function][] ) => 
    {
        for( const [key, isOptional, validator] of props ) 
        {
            const val = v[key];
            const oldErrors = ctx.errors.length;
            const result = validator( val, path + '.' + key, ctx );

            if( ctx.success ) 
            {
                data[key] = result;
            }
            else if( isOptional && val === undefined ) 
            {
                ctx.success = true;
                ctx.errors.length = oldErrors;
            }
        }
    },

    object : ( v: any, path: string, ctx: ValidationContext, allowedKeys?: string[], expected: string = 'Type<Object>' ) => 
    {
        if( !v || typeof v !== 'object' || Array.isArray( v ) ) 
        {
            report( ctx, path, expected, v );

            return false;
        }

        if( ctx.mode === 'strict' && allowedKeys ) 
        {
            for( const k of Object.keys( v ) ) 
            {
                if( !allowedKeys.includes( k ) ) 
                {
                    report( ctx, path, `PropertyNotAllowed<${k}>`, v[k] );
                }
            }
        }

        return true;
    },

    templateLiteral : ( v: any, path: string, ctx: ValidationContext, regex: RegExp, expected: string ) => 
    {
        if( typeof v !== 'string' || !regex.test( v ) ) 
        {
            report( ctx, path, expected, v );
        }

        return v;
    },

    minLength : ( v: string, path: string, ctx: ValidationContext, min: number, message?: string ) => 
    {
        if( v.length < min ) {report( ctx, path, `MinLength<${min}>`, v, message )}

        return v;
    },

    maxLength : ( v: string, path: string, ctx: ValidationContext, max: number, message?: string ) => 
    {
        if( v.length > max ) {report( ctx, path, `MaxLength<${max}>`, v, message )}

        return v;
    },

    minimum : ( v: number | bigint, path: string, ctx: ValidationContext, min: number | bigint, message?: string ) => 
    {
        if( v < min ) {report( ctx, path, `Minimum<${min}>`, v, message )}

        return v;
    },

    maximum : ( v: number | bigint, path: string, ctx: ValidationContext, max: number | bigint, message?: string ) => 
    {
        if( v > max ) {report( ctx, path, `Maximum<${max}>`, v, message )}

        return v;
    },

    exclusiveMinimum : ( v: number | bigint, path: string, ctx: ValidationContext, min: number | bigint, message?: string ) => 
    {
        if( v <= min ) {report( ctx, path, `ExclusiveMinimum<${min}>`, v, message )}

        return v;
    },

    exclusiveMaximum : ( v: number | bigint, path: string, ctx: ValidationContext, max: number | bigint, message?: string ) => 
    {
        if( v >= max ) {report( ctx, path, `ExclusiveMaximum<${max}>`, v, message )}

        return v;
    },

    multipleOf : ( v: number | bigint, path: string, ctx: ValidationContext, n: number | bigint, message?: string ) => 
    {
        if( typeof v === 'bigint' || typeof n === 'bigint' ) 
        {
            if( BigInt( v ) % BigInt( n ) !== 0n ) {report( ctx, path, `MultipleOf<${n}>`, v, message )}
        }
        else 
        {
            if( v % n !== 0 ) {report( ctx, path, `MultipleOf<${n}>`, v, message )}
        }

        return v;
    },

    pattern : ( v: string, path: string, ctx: ValidationContext, regex: RegExp, expected: string, message?: string ) => 
    {
        if( !regex.test( v ) ) {report( ctx, path, expected, v, message )}

        return v;
    },

    format : ( v: string, path: string, ctx: ValidationContext, format: string, message?: string ) => 
    {
        let regex: RegExp | undefined;
        let isValid = true;

        switch ( format ) 
        {
            case 'email': regex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/; break;
            case 'uuid': regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i; break;
            case 'url': regex = /^(?:https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i; break;
            case 'ipv4': regex = /^(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/; break;
            case 'ipv6': regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/; break;
            case 'date': regex = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/; break;
            case 'date-time': regex = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])[tT ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[zZ]|[+-]\d{2}:\d{2})$/; break;

            case 'byte': regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/; break;
            case 'password': break; // Anything is a password
            case 'regex': try {new RegExp( v )}
            catch{isValid = false}; break;
            case 'hostname': regex = /^(?=.{1,253}$)(?:(?!-)[A-Za-z0-9-]{1,63}(?<!-)\.)+[A-Za-z]{2,63}$/; break;
            case 'uri': regex = /^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s]*$/; break;
            case 'time': regex = /^\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[zZ]|[+-]\d{2}:\d{2})$/; break;
            case 'duration': regex = /^P(?!$)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+S)?)?$/; break;
            case 'objectId': regex = /^[0-9a-fA-F]{24}$/; break;
            default: break;
        }

        if( regex && !regex.test( v ) ) {isValid = false}

        if( !isValid ) {report( ctx, path, `Format<${format}>`, v, message )}

        return v;
    },

    minItems : ( v: any[], path: string, ctx: ValidationContext, min: number, message?: string ) => 
    {
        if( v.length < min ) {report( ctx, path, `MinItems<${min}>`, v, message )}

        return v;
    },

    maxItems : ( v: any[], path: string, ctx: ValidationContext, max: number, message?: string ) => 
    {
        if( v.length > max ) {report( ctx, path, `MaxItems<${max}>`, v, message )}

        return v;
    },

    uniqueItems : ( v: any[], path: string, ctx: ValidationContext, message?: string ) => 
    {
        const seen = new Set();

        for( let i = 0; i < v.length; i++ ) 
        {
            const item = v[i];
            const key = typeof item === 'object' && item !== null ? JSON.stringify( item ) : item;

            if( seen.has( key ) ) 
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
        const parentPath = path.includes( '.' ) ? path.substring( 0, path.lastIndexOf( '.' ) ) : '';
        const parent = getValueAtPath( ctx.root, parentPath );
        const indexMatch = path.match( /\[(\d+)\]$/ );
        const index = indexMatch ? parseInt( indexMatch[1], 10 ) : undefined;

        if( !fn( v, { parent, root : ctx.root, path, index } ) ) 
        {
            report( ctx, path, fn.name ? `Custom<${fn.name}>` : 'Custom', v, message );
        }

        return v;
    },


    union : ( v: any, path: string, ctx: ValidationContext, checks: Function[], expected: string = 'Type<Union>' ) => 
    {
        // Pass 1: No conversion
        for( const check of checks ) 
        {
            const subCtx = { ...ctx, success : true, errors : [], tryConvert : false };
            const val = check( v, path, subCtx );

            if( subCtx.success ) {return val}
        }

        // Pass 2: With conversion
        const unionErrors: IValidationError[] = [];

        for( const check of checks ) 
        {
            const subCtx = { ...ctx, success : true, errors : [], tryConvert : true };
            const val = check( v, path, subCtx );

            if( subCtx.success ) {return val}
            unionErrors.push( ...subCtx.errors );
        }

        ctx.success = false;
        ctx.errors.push( {
            path,
            value : v,
            error : expected
        } );
        ctx.errors.push( ...unionErrors );

        return v;
    },

    tuple : ( v: any, path: string, ctx: ValidationContext, checks: Function[] ) => 
    {
        if( !Array.isArray( v ) || v.length !== checks.length ) 
        {
            report( ctx, path, `Tuple<${checks.length}>`, v );

            return v;
        }
        const data = ctx.mode === 'strip' ? [] : v;

        for( let i = 0; i < checks.length; i++ ) 
        {
            const val = checks[i]( v[i], path + '[' + i + ']', ctx );

            if( ctx.mode === 'strip' ) {( data as any[] ).push( val )}
        }

        return data;
    },

    any : ( v: any ) => v,

    requires : ( v: any, path: string, ctx: ValidationContext, reqs: string[], message?: string ) => 
    {
        if( v === undefined || v === null ) {return v}

        for( const r of reqs ) 
        {
            const resolved = resolvePath( path, r );

            if( !hasPath( ctx.root, resolved ) ) 
            {
                report( ctx, path, `Requires<${r}>`, v, message );
            }
        }

        return v;
    },

    record : ( v: any, path: string, ctx: ValidationContext, childValidator: Function ) => 
    {
        if( !v || typeof v !== 'object' || Array.isArray( v ) ) 
        {
            report( ctx, path, 'Type<Object>', v );

            return v;
        }
        const data = ctx.mode === 'strip' ? {} : v;

        for( const key of Object.keys( v ) ) 
        {
            const val = childValidator( v[key], path + '.' + key, ctx );

            if( ctx.mode === 'strip' ) {( data as any )[key] = val}
        }

        return data;
    },

    set : ( v: any, path: string, ctx: ValidationContext, childValidator: Function, message?: string ) => 
    {
        if( !( v instanceof Set ) ) 
        {
            if( ctx.tryConvert && Array.isArray( v ) ) 
            {
                v = new Set( v );
            }
            else if( ctx.tryConvert && v !== undefined && v !== null ) 
            {
                v = new Set( [v] );
            }
            else 
            {
                report( ctx, path, 'Type<Set>', v, message );

                return v;
            }
        }
        const data = ctx.mode === 'strip' ? new Set() : v;
        let index = 0;

        for( const item of v ) 
        {
            const val = childValidator( item, `${path}[${index}]`, ctx );

            if( ctx.mode === 'strip' ) {data.add( val )}
            index++;
        }

        return data;
    },

    map : ( v: any, path: string, ctx: ValidationContext, keyValidator: Function, valueValidator: Function, message?: string ) => 
    {
        if( !( v instanceof Map ) ) 
        {
            if( ctx.tryConvert && typeof v === 'object' && v !== null && !Array.isArray( v ) ) 
            {
                v = new Map( Object.entries( v ) );
            }
            else 
            {
                report( ctx, path, 'Type<Map>', v, message );

                return v;
            }
        }
        const data = ctx.mode === 'strip' ? new Map() : v;

        for( const [key, val] of v.entries() ) 
        {
            const validatedKey = keyValidator( key, `${path}.key(${JSON.stringify( key )})`, ctx );
            const validatedVal = valueValidator( val, `${path}[${JSON.stringify( key )}]`, ctx );

            if( ctx.mode === 'strip' ) 
            {
                data.set( validatedKey, validatedVal );
            }
        }

        return data;
    }
};

function resolvePath( currentPath: string, targetPath: string ): string 
{
    if( !targetPath.startsWith( '.' ) ) 
    {
        return targetPath;
    }
    const dotsMatch = targetPath.match( /^\.+/ );
    const dots = dotsMatch ? dotsMatch[0].length : 0;
    const targetClean = targetPath.substring( dots );

    const cleanCurrentPath = currentPath.startsWith( '.' ) ? currentPath.substring( 1 ) : currentPath;
    const currentParts = cleanCurrentPath ? cleanCurrentPath.split( '.' ) : [];
    const baseParts = currentParts.slice( 0, currentParts.length - dots );

    if( targetClean ) 
    {
        baseParts.push( targetClean );
    }

    return baseParts.join( '.' );
}

function getValueAtPath( obj: any, path: string ): any 
{
    if( !obj || typeof obj !== 'object' ) {return undefined}
    const cleanPath = path.startsWith( '.' ) ? path.substring( 1 ) : path;

    if( !cleanPath ) {return obj}
    const parts = cleanPath.split( '.' );
    let current = obj;

    for( const part of parts ) 
    {
        if( current === null || current === undefined || typeof current !== 'object' ) 
        {
            return undefined;
        }
        const cleanPart = part.replace( /\[\d+\]/g, '' );
        current = current[cleanPart];
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

        if( !val ) {throw new Error( `Validator not found for hash: ${hash}` )}

        return val;
    }

    registerSchema( hash: string, schema: any ) 
    {
        this.schemas.set( hash, schema );
    }

    getSchema( hash: string ): any 
    {
        const schema = this.schemas.get( hash );

        if( !schema ) {throw new Error( `Schema not found for hash: ${hash}` )}

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
        const tryConvert = typeof opt === 'object' ? opt?.tryConvert : undefined;
        const wrapArrays = typeof opt === 'object' ? opt?.wrapArrays : undefined;
        const ctx: ValidationContext = { success : true, errors : [], mode, tryConvert, wrapArrays, root : value };
        validator( value, '', ctx );

        return ctx.success;
    }

    assert( validator: Function, value: any, options?: ValidationMode | ValidationOptions ): any 
    {
        const opt = options;
        const mode = typeof opt === 'string' ? opt : ( opt?.mode || 'strict' );
        const tryConvert = typeof opt === 'object' ? opt?.tryConvert : undefined;
        const wrapArrays = typeof opt === 'object' ? opt?.wrapArrays : undefined;
        const ctx: ValidationContext = { success : true, errors : [], mode, tryConvert, wrapArrays, root : value };
        const res = validator( value, '', ctx );

        if( !ctx.success ) 
        {
            if( typeof opt === 'object' && opt?.errorFactory ) 
            {
                throw opt.errorFactory( ctx.errors );
            }
            throw new Error( 'Validation Error: ' + ctx.errors.map( e => e.path ? `${e.path}: ${e.error}` : e.error ).join( ', ' ) );
        }

        return res;
    }

    validate( validator: Function, value: any, options?: ValidationMode | ValidationOptions ): { success : boolean, errors : IValidationError[], data : any } 
    {
        const opt = options;
        const mode = typeof opt === 'string' ? opt : ( opt?.mode || 'strict' );
        const tryConvert = typeof opt === 'object' ? opt?.tryConvert : undefined;
        const wrapArrays = typeof opt === 'object' ? opt?.wrapArrays : undefined;
        const ctx: ValidationContext = { success : true, errors : [], mode, tryConvert, wrapArrays, root : value };
        const res = validator( value, '', ctx );

        return { success : ctx.success, errors : ctx.errors, data : res };
    }
}

export function groupErrorsByPath( errors: IValidationError[] ): Record<string, { value : any, errors : string[] }> 
{
    const grouped: Record<string, { value : any, errors : string[] }> = {};

    for( const err of errors ) 
    {
        if( !grouped[err.path] ) 
        {
            grouped[err.path] = { value : err.value, errors : [] };
        }

        if( !grouped[err.path].errors.includes( err.error ) ) 
        {
            grouped[err.path].errors.push( err.error );
        }
    }

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

            if( compiledDefs.has( refPath ) ) 
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

                if( v === undefined || v === null ) {return v}

                if( minLength !== undefined ) {validators.minLength( v, path, ctx, minLength )}

                if( maxLength !== undefined ) {validators.maxLength( v, path, ctx, maxLength )}

                if( pattern !== undefined ) {validators.pattern( v, path, ctx, pattern, patternStr )}

                if( format !== undefined ) {validators.format( v, path, ctx, format )}

                return v;
            };
        }

        if( subSchema.type === 'number' || subSchema.type === 'integer' ) 
        {
            const isInt = subSchema.type === 'integer';
            const minimum = subSchema.minimum;
            const maximum = subSchema.maximum;
            const multipleOf = subSchema.multipleOf;

            return ( v, path, ctx ) => 
            {
                v = validators.number( v, path, ctx );

                if( v === undefined || v === null ) {return v}

                if( isInt && typeof v === 'number' && !Number.isInteger( v ) ) 
                {
                    report( ctx, path, 'Type<integer>', v );
                }

                if( minimum !== undefined ) {validators.minimum( v, path, ctx, minimum )}

                if( maximum !== undefined ) {validators.maximum( v, path, ctx, maximum )}

                if( multipleOf !== undefined ) {validators.multipleOf( v, path, ctx, multipleOf )}

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
            const checks = subSchema.anyOf.map( ( s: any ) => build( s ) );

            return ( v, path, ctx ) => validators.union( v, path, ctx, checks );
        }

        if( subSchema.type === 'array' ) 
        {
            if( Array.isArray( subSchema.items ) ) 
            {
                const checks = subSchema.items.map( ( s: any ) => build( s ) );

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

                    if( Array.isArray( v ) ) 
                    {
                        if( minItems !== undefined ) {validators.minItems( v, path, ctx, minItems )}

                        if( maxItems !== undefined ) {validators.maxItems( v, path, ctx, maxItems )}

                        if( uniqueItems ) {validators.uniqueItems( v, path, ctx )}
                    }

                    return v;
                };
            }
        }

        if( subSchema.type === 'object' ) 
        {
            const props = Object.entries( subSchema.properties || {} );
            const required = subSchema.required || [];
            const propVals = props.map( ( [key, s]: [string, any] ) => 
            {
                const isOptional = !required.includes( key );
                const check = build( s );

                return [key, isOptional, check] as [string, boolean, any];
            } );

            const allowedKeys = Object.keys( subSchema.properties || {} );

            return ( v, path, ctx ) => 
            {
                if( !validators.object( v, path, ctx, allowedKeys, 'Object' ) ) {return v}
                let data = v;

                if( ctx.mode === 'strip' ) 
                {
                    let hasAdditional = false;
                    const keys = Object.keys( v );

                    if( keys.length > allowedKeys.length ) 
                    {
                        hasAdditional = true;
                    }
                    else 
                    {
                        for( let i = 0; i < keys.length; i++ ) 
                        {
                            if( !allowedKeys.includes( keys[i] ) ) 
                            {
                                hasAdditional = true;
                                break;
                            }
                        }
                    }

                    if( hasAdditional ) {data = {}}
                }
                validators.props( v, data, path, ctx, propVals );

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

( globalThis as any ).__WEBERGENCY_TYPECHECKER_METADATA_STORE__ = MetadataStore;
( globalThis as any ).__WEBERGENCY_TYPECHECKER_VALIDATORS__ = validators;
