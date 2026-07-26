export type CasingFormat = 
    | 'snake_case' 
    | 'SNAKE_CASE' 
    | 'camelCase' 
    | 'camelCaseID' 
    | 'PascalCase' 
    | 'PascalCaseID' 
    | 'kebab-case' 
    | 'dot.case';

export interface ConvertCasingOptions
{
    preserveEnds? : boolean
}

type SplitCamel<S extends string> = 
    S extends `${infer L}${infer R}`
        ? L extends Uppercase<L>
            ? L extends Lowercase<L> 
                ? `${L}${SplitCamel<R>}`
                : `_${Lowercase<L>}${SplitCamel<R>}`
            : `${L}${SplitCamel<R>}`
        : S;

type NormalizeCamelKebabDot<S extends string> = 
    S extends `${infer L}-${infer R}` ? `${NormalizeCamelKebabDot<L>}_${NormalizeCamelKebabDot<R>}` :
        S extends `${infer L}.${infer R}` ? `${NormalizeCamelKebabDot<L>}_${NormalizeCamelKebabDot<R>}` :
            SplitCamel<S> extends `_${infer T}` ? T : SplitCamel<S>;

type NormalizeString<S extends string> = 
    S extends Uppercase<S> 
        ? Lowercase<S> 
        : NormalizeCamelKebabDot<S>;

type CleanUnderscores<S extends string> = 
    S extends `${infer L}__${infer R}` 
        ? CleanUnderscores<`${L}_${R}`>
        : S extends `_${infer R}`
            ? CleanUnderscores<R>
            : S extends `${infer L}_`
                ? CleanUnderscores<L>
                : S;

type Normalized<S extends string> = CleanUnderscores<NormalizeString<S>>;

type SnakeToCamel<S extends string> = 
    S extends `${infer L}_${infer R}`
        ? `${L}${Capitalize<SnakeToCamel<R>>}`
        : S;

type SnakeToPascal<S extends string> = Capitalize<SnakeToCamel<S>>;

type SnakeToKebab<S extends string> = 
    S extends `${infer L}_${infer R}`
        ? `${L}-${SnakeToKebab<R>}`
        : S;

type SnakeToDot<S extends string> = 
    S extends `${infer L}_${infer R}`
        ? `${L}.${SnakeToDot<R>}`
        : S;

type SnakeToUpperSnake<S extends string> = Uppercase<S>;

type ReplaceId<S extends string> = 
    S extends `${infer L}Id` ? `${L}ID` : 
        S extends 'id' ? 'ID' : 
            S extends 'Id' ? 'ID' : 
                S;

type ToCamelCaseID<S extends string> = ReplaceId<SnakeToCamel<S>>;
type ToPascalCaseID<S extends string> = ReplaceId<SnakeToPascal<S>>;

type Leading<S extends string> = 
    S extends `_${infer R}` ? `_${Leading<R>}` : 
        S extends `-${infer R}` ? `-${Leading<R>}` : 
            S extends `.${infer R}` ? `.${Leading<R>}` : 
                S extends `$${infer R}` ? `$${Leading<R>}` : '';

type Trailing<S extends string> = 
    S extends `${infer L}_` ? `${Trailing<L>}_` : 
        S extends `${infer L}-` ? `${Trailing<L>}-` : 
            S extends `${infer L}.` ? `${Trailing<L>}.` : 
                S extends `${infer L}$` ? `${Trailing<L>}$` : '';

type StripLeading<S extends string> = 
    S extends `_${infer R}` ? StripLeading<R> : 
        S extends `-${infer R}` ? StripLeading<R> : 
            S extends `.${infer R}` ? StripLeading<R> : 
                S extends `$${infer R}` ? StripLeading<R> : S;

type StripTrailing<S extends string> = 
    S extends `${infer L}_` ? StripTrailing<L> : 
        S extends `${infer L}-` ? StripTrailing<L> : 
            S extends `${infer L}.` ? StripTrailing<L> : 
                S extends `${infer L}$` ? StripTrailing<L> : S;

type FormatCoreCasing<S extends string, Casing extends CasingFormat> =
    Casing extends 'snake_case' ? Normalized<S> :
        Casing extends 'SNAKE_CASE' ? SnakeToUpperSnake<Normalized<S>> :
            Casing extends 'camelCase' ? SnakeToCamel<Normalized<S>> :
                Casing extends 'PascalCase' ? SnakeToPascal<Normalized<S>> :
                    Casing extends 'kebab-case' ? SnakeToKebab<Normalized<S>> :
                        Casing extends 'dot.case' ? SnakeToDot<Normalized<S>> :
                            Casing extends 'camelCaseID' ? ToCamelCaseID<Normalized<S>> :
                                Casing extends 'PascalCaseID' ? ToPascalCaseID<Normalized<S>> :
                                    S;

export type FormatCasing<S extends string, Casing extends CasingFormat, Options extends ConvertCasingOptions = Record<never, never>> = 
    Options['preserveEnds'] extends false 
        ? FormatCoreCasing<StripLeading<StripTrailing<S>>, Casing>
        : `${Leading<S>}${FormatCoreCasing<StripLeading<StripTrailing<S>>, Casing>}${Trailing<S>}`;

type ExtractArray<T> = T extends any[] ? T : never;

export type ConvertPropertyCasing<T, Casing extends CasingFormat, Options extends ConvertCasingOptions = Record<never, never>> = 
    T extends [infer F, ...infer R] ? [ConvertPropertyCasing<F, Casing, Options>, ...ExtractArray<ConvertPropertyCasing<R, Casing, Options>>] :
        T extends ( infer E )[] ? ConvertPropertyCasing<E, Casing, Options>[] :
            T extends string | number | boolean | symbol | bigint | null | undefined ? T :
                T extends Date | RegExp | Function | Map<any, any> | Set<any> | Promise<any> ? T :
                    T extends object ? 
                        {
                            [K in keyof T as K extends string ? FormatCasing<K, Casing, Options> : K]: ConvertPropertyCasing<T[K], Casing, Options>
                        } 
                        : T;

function normalizeString( str: string ): string
{
    if( /^[A-Z0-9_]+$/.test( str ))
    {
        str = str.toLowerCase();
    }

    str = str.replace( /[-.]/g, '_' );
    str = str.replace( /([a-z0-9])([A-Z])/g, '$1_$2' ).toLowerCase();
    
    return str.replace( /_+/g, '_' ).replace( /^_|_$/g, '' );
}

function formatCasing( str: string, casing: CasingFormat, options: ConvertCasingOptions = {}): string
{
    const preserveEnds = options.preserveEnds !== false;
    
    let leading = '';
    let trailing = '';
    let core = str;

    if( preserveEnds )
    {
        const match = str.match( /^([_\-.$]*)(.*?)([_\-.$]*)$/ );

        if( match )
        {
            leading = match[ 1 ];
            core = match[ 2 ];
            trailing = match[ 3 ];
        }
    }
    else 
    {
        core = str.replace( /^([_\-.$]*)/, '' ).replace( /([_\-.$]*)$/, '' );
    }

    const normalized = normalizeString( core );
    let formatted: string;

    if( casing === 'snake_case' ){ formatted = normalized }
    else if( casing === 'SNAKE_CASE' ){ formatted = normalized.toUpperCase() }
    else if( casing === 'kebab-case' ){ formatted = normalized.replace( /_/g, '-' ) }
    else if( casing === 'dot.case' ){ formatted = normalized.replace( /_/g, '.' ) }
    else
    {
        const camel = normalized.replace( /_([a-z0-9])/g, ( match, p1 ) => p1.toUpperCase());

        if( casing === 'camelCase' ){ formatted = camel }
        else if( casing === 'camelCaseID' ){ formatted = camel.replace( /Id$/, 'ID' ) }
        else
        {
            const pascal = camel.charAt( 0 ).toUpperCase() + camel.slice( 1 );

            if( casing === 'PascalCase' ){ formatted = pascal }
            else if( casing === 'PascalCaseID' ){ formatted = pascal.replace( /Id$/, 'ID' ) }
            else { formatted = core }
        }
    }

    return preserveEnds ? `${leading}${formatted}${trailing}` : formatted;
}

export function convertPropertyCasing<T, C extends CasingFormat>
(
    obj: T,
    casing: C,
    options?: ConvertCasingOptions
): ConvertPropertyCasing<T, C>
{
    if( !obj || typeof obj !== 'object' ){ return obj as any }

    if( obj instanceof Date || obj instanceof RegExp || obj instanceof Map || obj instanceof Set || typeof obj === 'function' ){ return obj as any }

    if( Array.isArray( obj ))
    {
        return obj.map(( item ) => convertPropertyCasing( item, casing, options )) as any;
    }

    const result: any = {};
    const sourceKeys = new Map<string, string>();

    for( const [ key, value ] of Object.entries( obj ))
    {
        const newKey = formatCasing( key, casing, options );
        const previousKey = sourceKeys.get( newKey );

        if( previousKey !== undefined )
        {
            throw new Error( `Casing conversion collision: ${previousKey} and ${key} both map to ${newKey}` );
        }

        sourceKeys.set( newKey, key );
        const nested = convertPropertyCasing( value, casing, options );

        if( newKey !== '__proto__' && newKey !== 'constructor' && newKey !== 'prototype' )
        {
            result[ newKey ] = nested;
        }
        else
        {
            Object.defineProperty( result, newKey, {
                value        : nested,
                enumerable   : true,
                configurable : true,
                writable     : true
            });
        }
    }

    return result;
}
