import ts from 'typescript';
import { ValidationMode } from '../runtime/validators.js';
import { type ICustomFunctionScope } from './customFns.js';
import
{
    BUFFER_LIKE,
    enumMemberTypes,
    getTypeProps,
    isNativeEnumType,
    isTagKey,
    mapStructuralProps,
    ParsedConstraint,
    peelTaggedIntersection,
    safePropAccess,
    stringIndexType,
    tryMergeObjectTypes,
    tryTaggedUnionTypes,
    typeHasDefaultTag,
    typeSymbolName,
    VERBATIM_CUSTOM_SCOPE
}
from './type-helpers.js';

export type ParseSource = 'json' | 'query';

export interface ParseGeneratorOptions
{
    mode? : ValidationMode;
    from? : ParseSource;
}

function minifyTypeString( str: string ): string
{
    return str
        .replace( /\{\s+/g, '{' )
        .replace( /\s+\}/g, '}' )
        .replace( /;\s*\}/g, '}' )
        .replace( /;\s+/g, ',' )
        .replace( /:\s+/g, ':' )
        .replace( /\s+\|\s+/g, '|' );
}

function unionExpectedLabel( type: ts.Type, checker: ts.TypeChecker ): string
{
    const aliasName = type.aliasSymbol && typeof type.aliasSymbol.getName === 'function'
        ? type.aliasSymbol.getName()
        : undefined;
    const name = aliasName || typeSymbolName( type );

    if( name && !name.startsWith( '__' ) && /^[A-Za-z_][A-Za-z0-9_]*$/.test( name ))
    {
        return `Type<${name}>`;
    }

    try
    {
        return `Type<${minifyTypeString( checker.typeToString( type ))}>`;
    }
    catch
    {
        return 'Type<Union>';
    }
}

/** Parenthesize path expressions so nested ternaries do not steal the appended segment. */
function joinPath( pathExpr: string, segment: string ): string
{
    if( !pathExpr || pathExpr === '""' )
    {
        return JSON.stringify( segment );
    }

    return `( ${pathExpr} ) ? ( ${pathExpr} ) + "." + ${JSON.stringify( segment )} : ${JSON.stringify( segment )}`;
}

export function generateParseCode(
    type    : ts.Type,
    checker : ts.TypeChecker,
    options : ParseGeneratorOptions = {},
    scope   : ICustomFunctionScope = VERBATIM_CUSTOM_SCOPE
): string
{
    const mode = options.mode || 'strip';
    const from = options.from || 'json';

    if( from === 'query' )
    {
        const body = buildValidation( type, checker, mode, 'query', 'rawQuery', 'path', 'rawQuery', scope );

        // Named query/param/cookie values are scalars (or already-parsed objects/arrays). Only
        // treat encoded query text and URLSearchParams as querystrings — bare values like "42"
        // or string[] must not go through parseQueryString (arrays also have .entries()).
        return `( function( input, path = "" ){ const rawQuery = ( typeof input === "string" ? ( /[=%&]/.test( input ) ? __tcRuntime.parseQueryString( input ) : input ) : ( typeof URLSearchParams !== "undefined" && input instanceof URLSearchParams ? __tcRuntime.parseQueryString( input.toString() ) : input ) ); return ${body}; })`;
    }

    const body = buildValidation( type, checker, mode, 'json', 'obj', 'path', 'obj', scope );

    // Body values are often already JSON-parsed by the host. Only JSON.parse strings that
    // look like JSON text; otherwise keep the string (already-decoded JSON string primitives).
    return `( function( input, path = "" ){ let obj; if( typeof input === "string" ){ const t = input.trim(); if( t.startsWith( "{" ) || t.startsWith( "[" ) || t.startsWith( "\\"" ) || t === "true" || t === "false" || t === "null" || /^-?\\d+(\\.\\d+)?([eE][+-]?\\d+)?$/.test( t ) ){ try { obj = JSON.parse( input ); } catch( e ){ throw new __tcRuntime.ParseError( path, "Invalid JSON: " + e.message ); } } else { obj = input; } } else { obj = input; } return ${body}; })`;
}

function wrapConstraints(
    innerFactory : ( varName: string, pathExpr: string ) => string,
    constraints  : ParsedConstraint[],
    varName      : string,
    pathExpr     : string,
    from         : ParseSource,
    rootExpr     : string
): string
{
    if( constraints.length === 0 )
    {
        return innerFactory( varName, pathExpr );
    }

    const early = constraints.filter( c => c.type === 'default' || c.type === 'transform' || c.type === 'message' );
    const customTransforms = constraints.filter( c => c.type === 'transform_custom' );
    const late = constraints.filter( c =>
        c.type !== 'default' &&
        c.type !== 'transform' &&
        c.type !== 'transform_custom' &&
        c.type !== 'message' &&
        c.type !== 'custom'
    );
    const customConstraints = constraints.filter( c => c.type === 'custom' );
    const inner = innerFactory( '__v', 'p' );

    let customTransformCode = '';

    if( customTransforms.length > 0 )
    {
        const stmts = customTransforms.map( c => `__v = ${c.value}(__v);` ).join( ' ' );
        customTransformCode = `if( __v !== undefined && __v !== null ){ ${stmts} } `;
    }

    let customConstraintCode = '';

    if( customConstraints.length > 0 )
    {
        const stmts = customConstraints.map( c =>
        {
            const msgArg = c.message !== undefined ? `, ${JSON.stringify( c.message )}` : '';
            const fallback = c.message !== undefined ? JSON.stringify( c.message ) : '"Custom"';

            return `{ const _ctx = { success: true, errors: [], mode: "strict", from: ${JSON.stringify( from )}, root: root }; __tcRuntime.validators.custom(__v, p, _ctx, ${c.value}${msgArg}); if( !_ctx.success ){ throw new __tcRuntime.ParseError( p, (_ctx.errors[0] && _ctx.errors[0].error) || ${fallback} ); } }`;
        }).join( ' ' );
        customConstraintCode = `if( __v !== undefined && __v !== null ){ ${stmts} } `;
    }

    return `( function( raw, p, root ){ let __v = __tcRuntime.applyParseConstraints( raw, p, ${JSON.stringify( early )}, ${JSON.stringify( from )} ); ${customTransformCode}__v = ${inner}; __v = __tcRuntime.applyParseConstraints( __v, p, ${JSON.stringify( late )}, ${JSON.stringify( from )} ); ${customConstraintCode}return __v; })( ${varName}, ${pathExpr || '""'}, ${rootExpr} )`;
}

function buildValidation(
    type     : ts.Type,
    checker  : ts.TypeChecker,
    mode     : ValidationMode,
    from     : ParseSource,
    varName  : string,
    pathExpr : string,
    rootExpr : string,
    scope    : ICustomFunctionScope
): string
{
    let constraints: ParsedConstraint[] = [];
    let walkType = type;

    if( typeof type.isIntersection === 'function' && type.isIntersection())
    {
        const peeled = peelTaggedIntersection( type, checker, scope );
        const merged = tryMergeObjectTypes(
            type.types.filter( t =>
            {
                const props = getTypeProps( t, checker );

                return !( props.length > 0 && props.every( p => isTagKey( p.getName())));
            }),
            checker
        );

        if( peeled?.hasTags )
        {
            constraints = peeled.constraints;
            walkType = peeled.base;

            if( typeof walkType.isIntersection === 'function' && walkType.isIntersection())
            {
                const inner = tryMergeObjectTypes( walkType.types, checker );

                if( inner )
                {
                    return wrapConstraints(
                        ( vn, pe ) => buildObjectValidation( inner.props, inner.indexType, checker, mode, from, vn, pe, rootExpr, scope ),
                        constraints,
                        varName,
                        pathExpr,
                        from,
                        rootExpr
                    );
                }
            }
        }
        else if( merged )
        {
            return buildObjectValidation( merged.props, merged.indexType, checker, mode, from, varName, pathExpr, rootExpr, scope );
        }
        else if( peeled )
        {
            walkType = peeled.base;
            constraints = peeled.constraints;
        }
    }

    return wrapConstraints(
        ( vn, pe ) => buildValidationCore( walkType, checker, mode, from, vn, pe, rootExpr, scope ),
        constraints,
        varName,
        pathExpr,
        from,
        rootExpr
    );
}

function buildValidationCore(
    type     : ts.Type,
    checker  : ts.TypeChecker,
    mode     : ValidationMode,
    from     : ParseSource,
    varName  : string,
    pathExpr : string,
    rootExpr : string,
    scope    : ICustomFunctionScope
): string
{
    const flags = typeof type.getFlags === 'function' ? type.getFlags() : ts.TypeFlags.Any;
    const p = pathExpr || '""';

    // Match validators.any — accept and return the value as-is (still behind the json/query preamble).
    if( flags & ts.TypeFlags.Any || flags & ts.TypeFlags.Unknown )
    {
        return varName;
    }

    if( flags & ts.TypeFlags.Undefined )
    {
        return `( function( v, path ){ if( v !== undefined ){ throw new __tcRuntime.ParseError( path, "Type<undefined>" ); } return v; })( ${varName}, ${p} )`;
    }

    if( flags & ts.TypeFlags.Null )
    {
        return `( function( v, path ){ if( v !== null ){ throw new __tcRuntime.ParseError( path, "Type<null>" ); } return v; })( ${varName}, ${p} )`;
    }

    if( typeof type.isStringLiteral === 'function' && type.isStringLiteral())
    {
        const expected = JSON.stringify( type.value );
        const litCode = `Literal<'${String( type.value ).replace( /\\/g, '\\\\' ).replace( /'/g, "\\'" )}'>`;

        if( from === 'query' )
        {
            return `( function( v, path ){ if( typeof v !== "string" ){ throw new __tcRuntime.ParseError( path, ${JSON.stringify( litCode )} ); } if( v !== ${expected} ){ throw new __tcRuntime.ParseError( path, ${JSON.stringify( litCode )} ); } return v; })( ${varName}, ${p} )`;
        }

        return `( function( v, path ){ if( v !== ${expected} ){ throw new __tcRuntime.ParseError( path, ${JSON.stringify( litCode )} ); } return v; })( ${varName}, ${p} )`;
    }

    if( typeof type.isNumberLiteral === 'function' && type.isNumberLiteral())
    {
        const expected = type.value;
        const litCode = `Literal<${expected}>`;

        if( from === 'query' )
        {
            return `( function( v, path ){ const n = __tcRuntime.coerceNumber( v, path ); if( n !== ${expected} ){ throw new __tcRuntime.ParseError( path, ${JSON.stringify( litCode )} ); } return n; })( ${varName}, ${p} )`;
        }

        return `( function( v, path ){ if( v !== ${expected} ){ throw new __tcRuntime.ParseError( path, ${JSON.stringify( litCode )} ); } return v; })( ${varName}, ${p} )`;
    }

    if( flags & ts.TypeFlags.BooleanLiteral )
    {
        const expected = ( type as any ).intrinsicName === 'true';
        const litCode = `Literal<${expected}>`;

        if( from === 'query' )
        {
            return `( function( v, path ){ const b = __tcRuntime.coerceBoolean( v, path ); if( b !== ${expected} ){ throw new __tcRuntime.ParseError( path, ${JSON.stringify( litCode )} ); } return b; })( ${varName}, ${p} )`;
        }

        return `( function( v, path ){ if( v !== ${expected} ){ throw new __tcRuntime.ParseError( path, ${JSON.stringify( litCode )} ); } return v; })( ${varName}, ${p} )`;
    }

    if( flags & ts.TypeFlags.String )
    {
        return `__tcRuntime.expectString( ${varName}, ${p} )`;
    }

    if( flags & ts.TypeFlags.Number )
    {
        if( from === 'query' )
        {
            return `__tcRuntime.coerceNumber( ${varName}, ${p} )`;
        }

        return `__tcRuntime.expectNumber( ${varName}, ${p} )`;
    }

    if( flags & ts.TypeFlags.Boolean )
    {
        if( from === 'query' )
        {
            return `__tcRuntime.coerceBoolean( ${varName}, ${p} )`;
        }

        return `__tcRuntime.expectBoolean( ${varName}, ${p} )`;
    }

    if( flags & ts.TypeFlags.BigInt || flags & ts.TypeFlags.BigIntLiteral )
    {
        return `__tcRuntime.coerceBigInt( ${varName}, ${p} )`;
    }

    if( isNativeEnumType( type ))
    {
        const members = enumMemberTypes( type, checker );

        if( members.length > 0 )
        {
            return buildValidationCore(
                { isUnion : () => true, types : members, getFlags : () => ts.TypeFlags.Union } as any,
                checker,
                mode,
                from,
                varName,
                pathExpr,
                rootExpr,
                scope
            );
        }
    }

    const symbolName = typeSymbolName( type );

    if( symbolName === 'Date' )
    {
        return `__tcRuntime.coerceDate( ${varName}, ${p} )`;
    }

    if( symbolName === 'RegExp' )
    {
        return `( function( v, path ){ if( v instanceof RegExp ){ return v } if( typeof v === "string" ){ const match = v.match( /^\\/(.*)\\/([gimuy]*)$/ ); if( match ){ try { return new RegExp( match[1], match[2] ); } catch( e ){} } ${from === 'query' ? 'try { return new RegExp( v ); } catch( e ){}' : ''} } if( v && typeof v === "object" && typeof v.source === "string" ){ try { return new RegExp( v.source, typeof v.flags === "string" ? v.flags : "" ); } catch( e ){} } throw new __tcRuntime.ParseError( path, "Type<RegExp>" ); })( ${varName}, ${p} )`;
    }

    if( flags & ts.TypeFlags.TemplateLiteral )
    {
        const templateType = type as ts.TemplateLiteralType;
        let regexStr = '^';

        for( let i = 0; i < templateType.texts.length; i++ )
        {
            regexStr += templateType.texts[i].replace( /[.*+?^${}()|[\]\\]/g, '\\$&' );

            if( i < templateType.types.length )
            {
                const subType = templateType.types[i];
                const subFlags = subType.getFlags();

                if( subFlags & ts.TypeFlags.String ){ regexStr += '.*' }
                else if( subFlags & ts.TypeFlags.Number ){ regexStr += '[0-9]+(\\.[0-9]+)?' }
                else if( subFlags & ts.TypeFlags.BigInt ){ regexStr += '[0-9]+' }
                else if( subFlags & ts.TypeFlags.Boolean ){ regexStr += '(true|false)' }
                else { regexStr += '.*' }
            }
        }
        regexStr += '$';
        const expected = checker.typeToString( type );

        return `( function( v, path ){ if( typeof v !== "string" || !( new RegExp( ${JSON.stringify( regexStr )} ) ).test( v ) ){ throw new __tcRuntime.ParseError( path, ${JSON.stringify( expected )} ); } return v; })( ${varName}, ${p} )`;
    }

    if( symbolName && BUFFER_LIKE.has( symbolName ))
    {
        return `__tcRuntime.coerceBuffer( ${varName}, ${p} )`;
    }

    if( typeof checker.isTupleType === 'function' && checker.isTupleType( type ))
    {
        const typeArgs = ( type as ts.TupleTypeReference ).typeArguments || [];
        const slots = typeArgs.map(( elem, i ) =>
            buildValidation( elem, checker, mode, from, `arr[${i}]`, `p + "[${i}]"`, rootExpr, scope )
        ).join( ', ' );

        return `( function( arr, p ){ if( !Array.isArray( arr ) || arr.length !== ${typeArgs.length} ){ throw new __tcRuntime.ParseError( p, "Tuple<${typeArgs.length}>" ); } return [${slots}]; })( ${varName}, ${p} )`;
    }

    if( typeof checker.isArrayType === 'function' && checker.isArrayType( type ))
    {
        const elemType = ( checker as any ).getTypeArguments?.( type as ts.TypeReference )?.[0] || { getFlags : () => ts.TypeFlags.Any };
        const elemCode = buildValidation( elemType, checker, mode, from, 'item', 'itemP', rootExpr, scope );

        if( from === 'query' )
        {
            return `__tcRuntime.coerceArray( ${varName}, ${p}, ( item, itemP ) => ${elemCode} )`;
        }

        return `( function( arr, p ){ __tcRuntime.expectArray( arr, p ); return arr.map( ( item, i ) => { const itemP = ( p ? p + "[" + i + "]" : "[" + i + "]" ); return ${elemCode}; } ); })( ${varName}, ${p} )`;
    }

    if( typeof type.isUnion === 'function' && type.isUnion())
    {
        // Drop undefined arms when a sibling has Default (parity with validators)
        let arms = type.types;

        if( arms.some( m => typeHasDefaultTag( m, checker )))
        {
            arms = arms.filter( m => !( m.getFlags() & ts.TypeFlags.Undefined ));
        }

        const label = unionExpectedLabel( type, checker );
        const tagged = tryTaggedUnionTypes( arms, checker );

        if( tagged )
        {
            const cases = tagged.arms.map( arm =>
                `case ${JSON.stringify( arm.tag )}: return ${buildValidation( arm.type, checker, mode, from, 'v', 'p', rootExpr, scope )};`
            ).join( ' ' );

            return `( function( v, p ){ switch( v && v[${JSON.stringify( tagged.key )}] ){ ${cases} default: throw new __tcRuntime.ParseError( p, ${JSON.stringify( label )} ); } })( ${varName}, ${p} )`;
        }

        const armFns = arms.map( arm =>
            `( v, p ) => ${buildValidation( arm, checker, mode, from, 'v', 'p', rootExpr, scope )}`
        ).join( ', ' );

        return `__tcRuntime.parseUnion( ${varName}, ${p}, ${JSON.stringify( label )}, [ ${armFns} ] )`;
    }

    const indexType = stringIndexType( type, checker );
    const props = mapStructuralProps( type, checker );

    return buildObjectValidation( props, indexType, checker, mode, from, varName, pathExpr, rootExpr, scope );
}

function buildObjectValidation(
    props     : { name: string, type: ts.Type, isOptional: boolean, hasDefault: boolean }[],
    indexType : ts.Type | undefined,
    checker   : ts.TypeChecker,
    mode      : ValidationMode,
    from      : ParseSource,
    varName   : string,
    pathExpr  : string,
    rootExpr  : string,
    scope     : ICustomFunctionScope
): string
{
    const propNames = props.map( p => p.name );
    const propAssignments: string[] = [];

    for( const prop of props )
    {
        const valAccess = safePropAccess( 'o', prop.name );
        const subPathExpr = joinPath( pathExpr, prop.name );
        const subValCode = buildValidation( prop.type, checker, mode, from, valAccess, subPathExpr, rootExpr, scope );

        if( prop.hasDefault )
        {
            // Always run so __default can fill missing values (optional or required).
            propAssignments.push( `${JSON.stringify( prop.name )}: ${subValCode}` );
        }
        else if( prop.isOptional )
        {
            propAssignments.push( `${JSON.stringify( prop.name )}: ${valAccess} === undefined ? undefined : ${subValCode}` );
        }
        else
        {
            // Required: same as assert — run the field validator on undefined (Type<*>), not a Missing shorthand.
            propAssignments.push( `${JSON.stringify( prop.name )}: ${subValCode}` );
        }
    }

    let extraHandling = '';
    let keysInit = '';

    if( indexType || mode === 'strict' || mode === 'relaxed' )
    {
        keysInit = `const __keys = new Set( ${JSON.stringify( propNames )} ); `;

        if( indexType )
        {
            const idxCode = buildValidation( indexType, checker, mode, from, 'o[k]', '( p ? p + "." + k : k )', rootExpr, scope );
            extraHandling = `for( const k in o ){ if( !__keys.has( k ) ){ res[k] = ${idxCode}; } }`;
        }
        else if( mode === 'strict' )
        {
            extraHandling = `for( const k in o ){ if( !__keys.has( k ) ){ throw new __tcRuntime.ParseError( p, "PropertyNotAllowed<" + k + ">" ); } }`;
        }
        else
        {
            extraHandling = `for( const k in o ){ if( !__keys.has( k ) ){ res[k] = o[k]; } }`;
        }
    }

    return `( function( o, p ){ o = __tcRuntime.expectObject( o, p ); ${keysInit}const res = { ${propAssignments.join( ', ' )} }; ${extraHandling} return res; })( ${varName}, ${pathExpr || '""'} )`;
}
