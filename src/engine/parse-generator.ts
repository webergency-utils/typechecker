import ts from 'typescript';
import { ValidationMode } from '../runtime/validators.js';
import
{
    BUFFER_LIKE,
    enumMemberTypes,
    getPropertyType,
    getTypeProps,
    isNativeEnumType,
    isTagKey,
    ParsedConstraint,
    peelTaggedIntersection,
    safePropAccess,
    stringIndexType,
    tryMergeObjectTypes,
    tryTaggedUnionTypes,
    typeHasDefaultTag,
    typeSymbolName
}
from './type-helpers.js';

export type ParseSource = 'json' | 'query';

export interface ParseGeneratorOptions
{
    mode? : ValidationMode;
    from? : ParseSource;
}

export function generateParseCode(
    type    : ts.Type,
    checker : ts.TypeChecker,
    options : ParseGeneratorOptions = {}
): string
{
    const mode = options.mode || 'strip';
    const from = options.from || 'json';

    if( from === 'query' )
    {
        const body = buildValidation( type, checker, mode, 'query', 'rawQuery', '""' );

        return `( function( input, path = "" ){ const rawQuery = ( typeof input === "string" ? __tcRuntime.parseQueryString( input ) : ( input && typeof input === "object" && typeof input.entries === "function" ? __tcRuntime.parseQueryString( input.toString() ) : input || {} ) ); return ${body}; })`;
    }

    const body = buildValidation( type, checker, mode, 'json', 'obj', '""' );

    return `( function( input, path = "" ){ let obj; try { obj = typeof input === "string" ? JSON.parse( input ) : input; } catch( e ){ throw new __tcRuntime.ParseError( path, "Invalid JSON: " + e.message ); } return ${body}; })`;
}

function wrapConstraints(
    innerFactory : ( varName: string, pathExpr: string ) => string,
    constraints  : ParsedConstraint[],
    varName      : string,
    pathExpr     : string,
    from         : ParseSource
): string
{
    if( constraints.length === 0 )
    {
        return innerFactory( varName, pathExpr );
    }

    const early = constraints.filter( c => c.type === 'default' || c.type === 'transform' || c.type === 'message' );
    const late = constraints.filter( c => c.type !== 'default' && c.type !== 'transform' && c.type !== 'message' );
    const inner = innerFactory( '__v', 'p' );

    return `( function( raw, p ){ let __v = __tcRuntime.applyParseConstraints( raw, p, ${JSON.stringify( early )}, ${JSON.stringify( from )} ); __v = ${inner}; return __tcRuntime.applyParseConstraints( __v, p, ${JSON.stringify( late )}, ${JSON.stringify( from )} ); })( ${varName}, ${pathExpr || '""'} )`;
}

function buildValidation(
    type     : ts.Type,
    checker  : ts.TypeChecker,
    mode     : ValidationMode,
    from     : ParseSource,
    varName  : string,
    pathExpr : string
): string
{
    let constraints: ParsedConstraint[] = [];
    let walkType = type;

    if( typeof type.isIntersection === 'function' && type.isIntersection())
    {
        const peeled = peelTaggedIntersection( type, checker );
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
                        ( vn, pe ) => buildObjectValidation( inner.props, inner.indexType, checker, mode, from, vn, pe ),
                        constraints,
                        varName,
                        pathExpr,
                        from
                    );
                }
            }
        }
        else if( merged )
        {
            return buildObjectValidation( merged.props, merged.indexType, checker, mode, from, varName, pathExpr );
        }
        else if( peeled )
        {
            walkType = peeled.base;
            constraints = peeled.constraints;
        }
    }

    return wrapConstraints(
        ( vn, pe ) => buildValidationCore( walkType, checker, mode, from, vn, pe ),
        constraints,
        varName,
        pathExpr,
        from
    );
}

function buildValidationCore(
    type     : ts.Type,
    checker  : ts.TypeChecker,
    mode     : ValidationMode,
    from     : ParseSource,
    varName  : string,
    pathExpr : string
): string
{
    const flags = typeof type.getFlags === 'function' ? type.getFlags() : ts.TypeFlags.Any;
    const p = pathExpr || '""';

    if( typeof type.isStringLiteral === 'function' && type.isStringLiteral())
    {
        const expected = JSON.stringify( type.value );

        if( from === 'query' )
        {
            return `( function( v, path ){ if( typeof v !== "string" ){ throw new __tcRuntime.ParseError( path, "Expected string literal " + ${expected} ); } if( v !== ${expected} ){ throw new __tcRuntime.ParseError( path, "Expected " + ${expected} ); } return v; })( ${varName}, ${p} )`;
        }

        return `( function( v, path ){ if( v !== ${expected} ){ throw new __tcRuntime.ParseError( path, "Expected " + ${expected} ); } return v; })( ${varName}, ${p} )`;
    }

    if( typeof type.isNumberLiteral === 'function' && type.isNumberLiteral())
    {
        const expected = type.value;

        if( from === 'query' )
        {
            return `( function( v, path ){ const n = __tcRuntime.coerceNumber( v, path ); if( n !== ${expected} ){ throw new __tcRuntime.ParseError( path, "Expected ${expected}" ); } return n; })( ${varName}, ${p} )`;
        }

        return `( function( v, path ){ if( v !== ${expected} ){ throw new __tcRuntime.ParseError( path, "Expected ${expected}" ); } return v; })( ${varName}, ${p} )`;
    }

    if( flags & ts.TypeFlags.BooleanLiteral )
    {
        const expected = ( type as any ).intrinsicName === 'true';

        if( from === 'query' )
        {
            return `( function( v, path ){ const b = __tcRuntime.coerceBoolean( v, path ); if( b !== ${expected} ){ throw new __tcRuntime.ParseError( path, "Expected ${expected}" ); } return b; })( ${varName}, ${p} )`;
        }

        return `( function( v, path ){ if( v !== ${expected} ){ throw new __tcRuntime.ParseError( path, "Expected ${expected}" ); } return v; })( ${varName}, ${p} )`;
    }

    if( flags & ts.TypeFlags.String )
    {
        return `( function( v, path ){ if( typeof v !== "string" ){ throw new __tcRuntime.ParseError( path, "Expected string" ); } return v; })( ${varName}, ${p} )`;
    }

    if( flags & ts.TypeFlags.Number )
    {
        if( from === 'query' )
        {
            return `__tcRuntime.coerceNumber( ${varName}, ${p} )`;
        }

        return `( function( v, path ){ if( typeof v !== "number" || Number.isNaN( v ) ){ throw new __tcRuntime.ParseError( path, "Expected number" ); } return v; })( ${varName}, ${p} )`;
    }

    if( flags & ts.TypeFlags.Boolean )
    {
        if( from === 'query' )
        {
            return `__tcRuntime.coerceBoolean( ${varName}, ${p} )`;
        }

        return `( function( v, path ){ if( typeof v !== "boolean" ){ throw new __tcRuntime.ParseError( path, "Expected boolean" ); } return v; })( ${varName}, ${p} )`;
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
                pathExpr
            );
        }
    }

    const symbolName = typeSymbolName( type );

    if( symbolName === 'Date' )
    {
        return `__tcRuntime.coerceDate( ${varName}, ${p} )`;
    }

    if( symbolName && BUFFER_LIKE.has( symbolName ))
    {
        return `__tcRuntime.coerceBuffer( ${varName}, ${p} )`;
    }

    if( typeof checker.isTupleType === 'function' && checker.isTupleType( type ))
    {
        const typeArgs = ( type as ts.TupleTypeReference ).typeArguments || [];
        const slots = typeArgs.map(( elem, i ) =>
            buildValidation( elem, checker, mode, from, `arr[${i}]`, `p + "[${i}]"` )
        ).join( ', ' );

        return `( function( arr, p ){ if( !Array.isArray( arr ) || arr.length !== ${typeArgs.length} ){ throw new __tcRuntime.ParseError( p, "Expected tuple of length ${typeArgs.length}" ); } return [${slots}]; })( ${varName}, ${p} )`;
    }

    if( typeof checker.isArrayType === 'function' && checker.isArrayType( type ))
    {
        const elemType = ( checker as any ).getTypeArguments?.( type as ts.TypeReference )?.[0] || { getFlags : () => ts.TypeFlags.Any };
        const elemCode = buildValidation( elemType, checker, mode, from, 'item', 'itemP' );

        if( from === 'query' )
        {
            return `__tcRuntime.coerceArray( ${varName}, ${p}, ( item, itemP ) => ${elemCode} )`;
        }

        return `( function( arr, p ){ if( !Array.isArray( arr )){ throw new __tcRuntime.ParseError( p, "Expected array" ); } return arr.map( ( item, i ) => { const itemP = ( p ? p + "[" + i + "]" : "[" + i + "]" ); return ${elemCode}; } ); })( ${varName}, ${p} )`;
    }

    if( typeof type.isUnion === 'function' && type.isUnion())
    {
        // Drop undefined arms when a sibling has Default (parity with validators)
        let arms = type.types;

        if( arms.some( m => typeHasDefaultTag( m, checker )))
        {
            arms = arms.filter( m => !( m.getFlags() & ts.TypeFlags.Undefined ));
        }

        const tagged = tryTaggedUnionTypes( arms, checker );

        if( tagged )
        {
            const cases = tagged.arms.map( arm =>
                `case ${JSON.stringify( arm.tag )}: return ${buildValidation( arm.type, checker, mode, from, 'v', 'p' )};`
            ).join( ' ' );

            return `( function( v, p ){ switch( v && v[${JSON.stringify( tagged.key )}] ){ ${cases} default: throw new __tcRuntime.ParseError( p, "Value does not match tagged union" ); } })( ${varName}, ${p} )`;
        }

        const armCodes = arms.map( arm => buildValidation( arm, checker, mode, from, 'v', 'p' ));

        return `( function( v, p ){ ${armCodes.map(( code, i ) => `try { return ${code}; } catch( _e${i} ) {}`).join( ' ' )} throw new __tcRuntime.ParseError( p, "Value does not match union type" ); })( ${varName}, ${p} )`;
    }

    const indexType = stringIndexType( type, checker );
    const props = getTypeProps( type, checker )
        .filter( p => !isTagKey( p.getName()))
        .map( prop => ({
            name       : prop.getName(),
            symbol     : prop,
            type       : getPropertyType( type, prop, checker ),
            isOptional : Boolean( prop.flags & ts.SymbolFlags.Optional ),
            hasDefault : typeHasDefaultTag( getPropertyType( type, prop, checker ), checker )
        }));

    return buildObjectValidation( props, indexType, checker, mode, from, varName, pathExpr );
}

function buildObjectValidation(
    props     : { name: string, type: ts.Type, isOptional: boolean, hasDefault: boolean }[],
    indexType : ts.Type | undefined,
    checker   : ts.TypeChecker,
    mode      : ValidationMode,
    from      : ParseSource,
    varName   : string,
    pathExpr  : string
): string
{
    const propNames = props.map( p => p.name );
    const propAssignments: string[] = [];

    for( const prop of props )
    {
        const valAccess = safePropAccess( 'o', prop.name );
        const subPathExpr = pathExpr
            ? `${pathExpr} ? ${pathExpr} + "." + ${JSON.stringify( prop.name )} : ${JSON.stringify( prop.name )}`
            : JSON.stringify( prop.name );
        const subValCode = buildValidation( prop.type, checker, mode, from, valAccess, subPathExpr );

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
            propAssignments.push( `${JSON.stringify( prop.name )}: ( function(){ if( ${valAccess} === undefined ){ throw new __tcRuntime.ParseError( ${subPathExpr}, "Missing required property " + ${JSON.stringify( prop.name )} ); } return ${subValCode}; })()` );
        }
    }

    let extraHandling = '';

    if( indexType )
    {
        const idxCode = buildValidation( indexType, checker, mode, from, 'o[k]', '( p ? p + "." + k : k )' );
        extraHandling = `for( const k in o ){ if( ${JSON.stringify( propNames )}.indexOf( k ) === -1 ){ res[k] = ${idxCode}; } }`;
    }
    else if( mode === 'strict' )
    {
        extraHandling = `for( const k in o ){ if( ${JSON.stringify( propNames )}.indexOf( k ) === -1 ){ throw new __tcRuntime.ParseError( ( p ? p + "." + k : k ), "Unexpected extra property " + k + " in strict mode" ); } }`;
    }
    else if( mode === 'relaxed' )
    {
        extraHandling = `for( const k in o ){ if( ${JSON.stringify( propNames )}.indexOf( k ) === -1 ){ res[k] = o[k]; } }`;
    }

    return `( function( o, p ){ if( typeof o !== "object" || o === null || Array.isArray( o )){ throw new __tcRuntime.ParseError( p, "Expected object" ); } const res = { ${propAssignments.join( ', ' )} }; ${extraHandling} return res; })( ${varName}, ${pathExpr || '""'} )`;
}
