import ts from 'typescript';
import { ValidationMode, type CoercionKind, type UnionResolution } from '../runtime/validators.js';
import { type ICustomFunctionScope } from './customFns.js';
import
{
    assertValidMapKeyType,
    bigIntLiteralText,
    BUFFER_LIKE,
    buildTemplateLiteralRegex,
    constraintTagNames,
    enumMemberTypes,
    isNativeEnumType,
    mapStructuralProps,
    ParsedConstraint,
    peelTaggedIntersection,
    safePropAccess,
    stringIndexType,
    tryMergeObjectTypes,
    tryTaggedUnionTypes,
    typeHasDefaultTag,
    typeSymbolName,
    unionExpectedLabel,
    VERBATIM_CUSTOM_SCOPE
}
    from './type-helpers.js';
import
{
    hasCompetingObjectArms,
    isFallbackUnionArm,
    sortUnionArmsBySpecificity,
    tryExclusiveKeyUnion
}
    from './specificity.js';

export type ParseSource = 'json' | 'query' | 'string';

export interface ParseGeneratorOptions
{
    mode?            : ValidationMode
    from?            : ParseSource
    unionResolution? : UnionResolution
}

type RecParseDef =
    {
        fnName          : string
        type            : ts.Type
        mode            : ValidationMode
        from            : ParseSource
        unionResolution : UnionResolution
    };

/** Query-style coercions shared by `from: 'query'` and `from: 'string'`. */
function wantsQueryCoercion( from: ParseSource ): boolean
{
    return from === 'query' || from === 'string';
}

/**
 * Root types allowed for `from: 'string'` — single already-decoded scalars only
 * (no objects, arrays, bags, or querystring parsing).
 */
function isStringSourceCompatible( type: ts.Type, checker: ts.TypeChecker, scope: ICustomFunctionScope ): boolean
{
    let walk = type;

    if( typeof walk.isIntersection === 'function' && walk.isIntersection())
    {
        const peeled = peelTaggedIntersection( walk, checker, scope );

        if( peeled ){ walk = peeled.base }
    }

    if( typeof walk.isUnion === 'function' && walk.isUnion())
    {
        return walk.types.every( arm => isStringSourceCompatible( arm, checker, scope ));
    }

    const flags = typeof walk.getFlags === 'function' ? walk.getFlags() : ts.TypeFlags.Any;

    if( flags & ( ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never ))
    {
        return false;
    }

    if( flags & ( ts.TypeFlags.Undefined | ts.TypeFlags.Null ))
    {
        return true;
    }

    if( typeof walk.isStringLiteral === 'function' && walk.isStringLiteral()){ return true }

    if( typeof walk.isNumberLiteral === 'function' && walk.isNumberLiteral()){ return true }

    if( flags & ts.TypeFlags.BooleanLiteral ){ return true }

    if( flags & ts.TypeFlags.BigIntLiteral ){ return true }

    if( flags & ts.TypeFlags.String ){ return true }

    if( flags & ts.TypeFlags.Number ){ return true }

    if( flags & ts.TypeFlags.Boolean ){ return true }

    if( flags & ts.TypeFlags.BigInt ){ return true }

    if( flags & ts.TypeFlags.TemplateLiteral ){ return true }

    if( isNativeEnumType( walk ))
    {
        const members = enumMemberTypes( walk, checker );

        return members.length > 0 && members.every( m => isStringSourceCompatible( m, checker, scope ));
    }

    const symbolName = typeSymbolName( walk );

    if( symbolName === 'Date' || symbolName === 'RegExp' ){ return true }

    if( typeof checker.isArrayType === 'function' && checker.isArrayType( walk )){ return false }

    if( typeof checker.isTupleType === 'function' && checker.isTupleType( walk )){ return false }

    if( symbolName === 'Set' || symbolName === 'Map' ){ return false }

    if( symbolName && BUFFER_LIKE.has( symbolName )){ return false }

    // Object / class / index-signature shapes are not single-wire scalars.
    return false;
}

function assertStringSourceCompatible( type: ts.Type, checker: ts.TypeChecker, scope: ICustomFunctionScope ): void
{
    if( isStringSourceCompatible( type, checker, scope )){ return }

    let label = 'unknown';

    try
    {
        label = checker.typeToString( type );
    }
    catch
    { /* ignore */ }

    throw new Error(
        '[Webergency] from: \'string\' only supports basic scalar types ' +
        `(string, number, boolean, bigint, Date, RegExp, literals, enums, and unions of these); got ${label}`
    );
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

function coercionKindOf( type: ts.Type, checker: ts.TypeChecker ): CoercionKind
{
    const flags = typeof type.getFlags === 'function' ? type.getFlags() : 0;

    if( flags & ( ts.TypeFlags.Any | ts.TypeFlags.Unknown )){ return 'Object' }

    if( flags & ts.TypeFlags.String || flags & ts.TypeFlags.TemplateLiteral ){ return 'string' }

    if( flags & ts.TypeFlags.Number ){ return 'number' }

    if( flags & ts.TypeFlags.BigIntLiteral ){ return 'literal' }

    if( flags & ts.TypeFlags.BigInt ){ return 'bigint' }

    if( flags & ts.TypeFlags.Boolean || flags & ts.TypeFlags.BooleanLiteral ){ return 'boolean' }

    if( flags & ts.TypeFlags.Null ){ return 'null' }

    if( flags & ts.TypeFlags.Undefined || flags & ts.TypeFlags.Void ){ return 'undefined' }

    if( typeof type.isStringLiteral === 'function' && type.isStringLiteral()){ return 'literal' }

    if( typeof type.isNumberLiteral === 'function' && type.isNumberLiteral()){ return 'literal' }

    const name = typeSymbolName( type );

    if( name === 'Date' ){ return 'Date' }

    if( name === 'RegExp' ){ return 'RegExp' }

    if( name === 'Set' ){ return 'Set' }

    if( name === 'Map' ){ return 'Map' }

    if( name && BUFFER_LIKE.has( name )){ return 'instance' }

    if( isNativeEnumType( type )){ return 'literal' }

    if( typeof checker.isArrayType === 'function' && checker.isArrayType( type )){ return 'Array' }

    if( typeof checker.isTupleType === 'function' && checker.isTupleType( type )){ return 'tuple' }

    return 'Object';
}

function shouldApplyParseTransform( type: ts.Type, checker: ts.TypeChecker ): boolean
{
    if( typeof type.isUnion === 'function' && type.isUnion()){ return false }

    if( typeof checker.isArrayType === 'function' && checker.isArrayType( type )){ return false }

    if( typeof checker.isTupleType === 'function' && checker.isTupleType( type )){ return false }

    const kind = coercionKindOf( type, checker );

    if( kind === 'Array' || kind === 'tuple' || kind === 'Set' || kind === 'Map' || kind === 'null' || kind === 'undefined' )
    {
        return false;
    }

    if( kind === 'Object' )
    {
        const flags = typeof type.getFlags === 'function' ? type.getFlags() : 0;

        return !!( flags & ( ts.TypeFlags.Any | ts.TypeFlags.Unknown ));
    }

    return true;
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
    const unionResolution = options.unionResolution || 'specificity';
    const hoisted: string[] = [];
    const recDefs = new Map<number, RecParseDef>();
    const wrapOuter = ( fnExpr: string ): string =>
    {
        const generatedRecFns = new Set<number>();

        while( generatedRecFns.size < recDefs.size )
        {
            for( const [ id, def ] of recDefs.entries())
            {
                if( generatedRecFns.has( id )){ continue }

                generatedRecFns.add( id );
                const recVisited = new Set<number>();
                const recBody = buildValidation( def.type, checker, def.mode, def.from, 'raw', 'p', 'root', scope, recVisited, hoisted, recDefs, def.unionResolution );
                hoisted.push( `function ${def.fnName}( raw, p, root, transform ){ return ${recBody}; }` );
            }
        }

        if( hoisted.length === 0 ){ return fnExpr }

        return `( function(){ ${hoisted.join( ' ' )} return ${fnExpr}; })()`;
    };

    if( from === 'string' )
    {
        assertStringSourceCompatible( type, checker, scope );
        const body = buildValidation( type, checker, mode, 'string', 'input', 'path', 'input', scope, new Set(), hoisted, recDefs, unionResolution );

        // Already-decoded scalar wire value — never parseQueryString / JSON.parse. Ignore reviver.
        return wrapOuter( `( function( raw, options ){ const path = ""; const transform = options && options.transform; const input = __tcRuntime.expectString( raw, path ); return ${body}; })` );
    }

    if( from === 'query' )
    {
        const body = buildValidation( type, checker, mode, 'query', 'rawQuery', 'path', 'rawQuery', scope, new Set(), hoisted, recDefs, unionResolution );

        // Query text only — never starts with `?` (`url.search.slice(1)` / form body). Flag-keys stay flag-keys.
        return wrapOuter( `( function( input, options ){ const path = ""; const reviver = options && options.reviver; const transform = options && options.transform; const text = __tcRuntime.expectString( input, path ); let rawQuery = __tcRuntime.parseQueryString( text ); if( reviver ){ rawQuery = __tcRuntime.reviveTree( rawQuery, reviver ); } return ${body}; })` );
    }

    const body = buildValidation( type, checker, mode, 'json', 'obj', 'path', 'obj', scope, new Set(), hoisted, recDefs, unionResolution );

    // JSON text only — always JSON.parse. Unquoted scalars belong on from:'string'.
    return wrapOuter( `( function( input, options ){ const path = ""; const reviver = options && options.reviver; const transform = options && options.transform; const text = __tcRuntime.expectString( input, path ); let obj; try { obj = JSON.parse( text ); } catch( e ){ throw new __tcRuntime.ParseError( path, "Invalid JSON: " + e.message ); } if( reviver ){ obj = __tcRuntime.reviveTree( obj, reviver ); } return ${body}; })` );
}

function serializeConstraintValue( v: any ): string
{
    if( typeof v === 'bigint' ){ return `${v}n` }

    return JSON.stringify( v );
}

function serializeConstraints( list: ParsedConstraint[], hoisted: string[]): string
{
    if( list.length === 0 ){ return '[]' }

    const items = list.map( c =>
    {
        const parts = [ `type: ${JSON.stringify( c.type )}` ];

        if( c.value !== undefined ){ parts.push( `value: ${serializeConstraintValue( c.value )}` ) }

        if( c.message !== undefined ){ parts.push( `message: ${JSON.stringify( c.message )}` ) }

        if( c.type === 'pattern' && typeof c.value === 'string' )
        {
            const reVar = `__re_${hoisted.length}`;
            hoisted.push( `const ${reVar} = __tcRuntime.getCachedPattern( ${JSON.stringify( c.value )} );` );
            parts.push( `regex: ${reVar}` );
        }

        return `{ ${parts.join( ', ' )} }`;
    });

    const cVar = `__c_${hoisted.length}`;
    hoisted.push( `const ${cVar} = [${items.join( ', ' )}];` );

    return cVar;
}

function wrapConstraints(
    innerFactory    : ( varName: string, pathExpr: string ) => string,
    constraints     : ParsedConstraint[],
    varName         : string,
    pathExpr        : string,
    from            : ParseSource,
    rootExpr        : string,
    checker         : ts.TypeChecker,
    mode            : ValidationMode,
    scope           : ICustomFunctionScope,
    kind            : CoercionKind,
    applyOption     : boolean,
    visited         : Set<number>,
    hoisted         : string[],
    recDefs         : Map<number, RecParseDef> = new Map(),
    unionResolution : UnionResolution = 'specificity'
): string
{
    const tags = constraintTagNames( constraints );

    if( constraints.length === 0 )
    {
        const inner = innerFactory( varName, pathExpr );

        if( !applyOption ){ return inner }

        return `__tcRuntime.applyParseTransform( ${inner}, ${pathExpr || '""'}, transform, ${JSON.stringify( kind )}, ${JSON.stringify( tags )}, ${rootExpr} )`;
    }

    const early = constraints.filter( c => c.type === 'default' || c.type === 'transform' || c.type === 'message' );
    const customTransforms = constraints.filter( c => c.type === 'transform_custom' );
    const late = constraints.filter( c =>
        c.type !== 'default' &&
        c.type !== 'transform' &&
        c.type !== 'transform_custom' &&
        c.type !== 'message' &&
        c.type !== 'tags' &&
        c.type !== 'custom' &&
        c.type !== 'contains' &&
        c.type !== 'propertyNames' &&
        c.type !== 'minContains' &&
        c.type !== 'maxContains'
    );
    const customConstraints = constraints.filter( c => c.type === 'custom' );
    const containsC = constraints.find( c => c.type === 'contains' );
    const propertyNamesC = constraints.find( c => c.type === 'propertyNames' );
    const minContains = constraints.find( c => c.type === 'minContains' )?.value as number | undefined;
    const maxContains = constraints.find( c => c.type === 'maxContains' )?.value as number | undefined;
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

    let nestedConstraintCode = '';

    if( containsC?.nestedType )
    {
        const itemBody = buildValidation(
            containsC.nestedType, checker, mode, from, 'item', 'itemP', rootExpr, scope, visited, hoisted, recDefs, unionResolution
        );
        const minStr = minContains !== undefined ? String( minContains ) : '1';
        const maxStr = maxContains !== undefined ? String( maxContains ) : 'undefined';
        const msgArg = containsC.message !== undefined ? `, ${JSON.stringify( containsC.message )}` : '';
        nestedConstraintCode +=
            `__v = __tcRuntime.applyContains(__v, p, (item, itemP) => ${itemBody}, ${minStr}, ${maxStr}${msgArg}); `;
    }

    if( propertyNamesC?.nestedType )
    {
        const keyBody = buildValidation(
            propertyNamesC.nestedType, checker, mode, from, 'key', 'keyP', rootExpr, scope, visited, hoisted, recDefs, unionResolution
        );
        const msgArg = propertyNamesC.message !== undefined
            ? `, ${JSON.stringify( propertyNamesC.message )}`
            : '';
        nestedConstraintCode +=
            `__v = __tcRuntime.applyPropertyNames(__v, p, (key, keyP) => ${keyBody}${msgArg}); `;
    }

    const earlyInit = early.length > 0
        ? `let __v = __tcRuntime.applyParseConstraints( raw, p, ${serializeConstraints( early, hoisted )}, ${JSON.stringify( from )}, root ); `
        : 'let __v = raw; ';
    const optionCode = ( applyOption || tags.length > 0 )
        ? `__v = __tcRuntime.applyParseTransform( __v, p, transform, ${JSON.stringify( kind )}, ${JSON.stringify( tags )}, root ); `
        : '';
    const lateCode = late.length > 0
        ? `__v = __tcRuntime.applyParseConstraints( __v, p, ${serializeConstraints( late, hoisted )}, ${JSON.stringify( from )}, root ); `
        : '';

    return `( function( raw, p, root ){ ${earlyInit}${customTransformCode}__v = ${inner}; ${optionCode}${lateCode}${nestedConstraintCode}${customConstraintCode}return __v; })( ${varName}, ${pathExpr || '""'}, ${rootExpr} )`;
}

function buildValidation(
    type            : ts.Type,
    checker         : ts.TypeChecker,
    mode            : ValidationMode,
    from            : ParseSource,
    varName         : string,
    pathExpr        : string,
    rootExpr        : string,
    scope           : ICustomFunctionScope,
    visited         : Set<number> = new Set(),
    hoisted         : string[] = [],
    recDefs         : Map<number, RecParseDef> = new Map(),
    unionResolution : UnionResolution = 'specificity'
): string
{
    const typeId = ( type as any ).id;

    if( typeof typeId === 'number' )
    {
        if( visited.has( typeId ))
        {
            let def = recDefs.get( typeId );

            if( !def )
            {
                const fnName = `__rec_parse_${typeId}_${hoisted.length}`;
                def = { fnName, type, mode, from, unionResolution };
                recDefs.set( typeId, def );
            }

            return `${def.fnName}( ${varName}, ${pathExpr || '""'}, ${rootExpr}, typeof transform !== 'undefined' ? transform : undefined )`;
        }

        visited.add( typeId );
    }

    try
    {
        let constraints: ParsedConstraint[] = [];
        let walkType = type;

        if( typeof type.isIntersection === 'function' && type.isIntersection())
        {
            const peeled = peelTaggedIntersection( type, checker, scope );

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
                            ( vn, pe ) => buildObjectValidation( inner.props, inner.indexType, checker, mode, from, vn, pe, rootExpr, scope, visited, hoisted, recDefs, unionResolution ),
                            constraints,
                            varName,
                            pathExpr,
                            from,
                            rootExpr,
                            checker,
                            mode,
                            scope,
                            'Object',
                            false,
                            visited,
                            hoisted,
                            recDefs,
                            unionResolution
                        );
                    }
                }
            }
            else
            {
                const merged = tryMergeObjectTypes( type.types, checker );

                if( merged )
                {
                    return buildObjectValidation( merged.props, merged.indexType, checker, mode, from, varName, pathExpr, rootExpr, scope, visited, hoisted, recDefs, unionResolution );
                }

                if( peeled )
                {
                    walkType = peeled.base;
                    constraints = peeled.constraints;
                }
            }
        }

        return wrapConstraints(
            ( vn, pe ) => buildValidationCore( walkType, checker, mode, from, vn, pe, rootExpr, scope, visited, hoisted, recDefs, unionResolution ),
            constraints,
            varName,
            pathExpr,
            from,
            rootExpr,
            checker,
            mode,
            scope,
            coercionKindOf( walkType, checker ),
            shouldApplyParseTransform( walkType, checker ),
            visited,
            hoisted,
            recDefs,
            unionResolution
        );
    }
    finally
    {
        if( typeof typeId === 'number' ){ visited.delete( typeId ) }
    }
}

function buildValidationCore(
    type            : ts.Type,
    checker         : ts.TypeChecker,
    mode            : ValidationMode,
    from            : ParseSource,
    varName         : string,
    pathExpr        : string,
    rootExpr        : string,
    scope           : ICustomFunctionScope,
    visited         : Set<number> = new Set(),
    hoisted         : string[] = [],
    recDefs         : Map<number, RecParseDef> = new Map(),
    unionResolution : UnionResolution = 'specificity'
): string
{
    const flags = typeof type.getFlags === 'function' ? type.getFlags() : ts.TypeFlags.Any;
    const p = pathExpr || '""';

    // Match validators.any — accept and return the value as-is (still behind the json/query preamble).
    if( flags & ts.TypeFlags.Any || flags & ts.TypeFlags.Unknown )
    {
        return varName;
    }

    if( flags & ts.TypeFlags.NonPrimitive )
    {
        return `__tcRuntime.expectObject( ${varName}, ${p} )`;
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

        if( wantsQueryCoercion( from ))
        {
            return `( function( v, path ){ if( typeof v !== "string" ){ throw new __tcRuntime.ParseError( path, ${JSON.stringify( litCode )} ); } if( v !== ${expected} ){ throw new __tcRuntime.ParseError( path, ${JSON.stringify( litCode )} ); } return v; })( ${varName}, ${p} )`;
        }

        return `( function( v, path ){ if( v !== ${expected} ){ throw new __tcRuntime.ParseError( path, ${JSON.stringify( litCode )} ); } return v; })( ${varName}, ${p} )`;
    }

    if( typeof type.isNumberLiteral === 'function' && type.isNumberLiteral())
    {
        const expected = type.value;
        const litCode = `Literal<${expected}>`;

        if( wantsQueryCoercion( from ))
        {
            return `( function( v, path ){ const n = __tcRuntime.coerceNumber( v, path ); if( n !== ${expected} ){ throw new __tcRuntime.ParseError( path, ${JSON.stringify( litCode )} ); } return n; })( ${varName}, ${p} )`;
        }

        return `( function( v, path ){ if( v !== ${expected} ){ throw new __tcRuntime.ParseError( path, ${JSON.stringify( litCode )} ); } return v; })( ${varName}, ${p} )`;
    }

    if( flags & ts.TypeFlags.BooleanLiteral )
    {
        const expected = ( type as any ).intrinsicName === 'true';
        const litCode = `Literal<${expected}>`;

        if( wantsQueryCoercion( from ))
        {
            return `( function( v, path ){ const b = __tcRuntime.coerceBoolean( v, path ); if( b !== ${expected} ){ throw new __tcRuntime.ParseError( path, ${JSON.stringify( litCode )} ); } return b; })( ${varName}, ${p} )`;
        }

        return `( function( v, path ){ if( v !== ${expected} ){ throw new __tcRuntime.ParseError( path, ${JSON.stringify( litCode )} ); } return v; })( ${varName}, ${p} )`;
    }

    if( flags & ts.TypeFlags.BigIntLiteral )
    {
        const lit = bigIntLiteralText( type );
        const litCode = `Literal<${lit}n>`;

        return `( function( v, path ){ const b = __tcRuntime.coerceBigInt( v, path ); if( b !== ${lit}n ){ throw new __tcRuntime.ParseError( path, ${JSON.stringify( litCode )} ); } return b; })( ${varName}, ${p} )`;
    }

    if( flags & ts.TypeFlags.String )
    {
        return `__tcRuntime.expectString( ${varName}, ${p} )`;
    }

    if( flags & ts.TypeFlags.Number )
    {
        if( wantsQueryCoercion( from ))
        {
            return `__tcRuntime.coerceNumber( ${varName}, ${p} )`;
        }

        return `__tcRuntime.expectNumber( ${varName}, ${p} )`;
    }

    if( flags & ts.TypeFlags.Boolean )
    {
        if( wantsQueryCoercion( from ))
        {
            return `__tcRuntime.coerceBoolean( ${varName}, ${p} )`;
        }

        return `__tcRuntime.expectBoolean( ${varName}, ${p} )`;
    }

    if( flags & ts.TypeFlags.BigInt )
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
                scope,
                visited,
                hoisted,
                recDefs,
                unionResolution
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
        return `( function( v, path ){ if( v instanceof RegExp ){ return v } if( typeof v === "string" ){ const match = v.match( /^\\/(.*)\\/([gimuy]*)$/ ); if( match ){ try { return new RegExp( match[1], match[2] ); } catch( e ){} } ${wantsQueryCoercion( from ) ? 'try { return new RegExp( v ); } catch( e ){}' : ''} } if( v && typeof v === "object" && typeof v.source === "string" ){ try { return new RegExp( v.source, typeof v.flags === "string" ? v.flags : "" ); } catch( e ){} } throw new __tcRuntime.ParseError( path, "Type<RegExp>" ); })( ${varName}, ${p} )`;
    }

    if( flags & ts.TypeFlags.TemplateLiteral )
    {
        const regexStr = buildTemplateLiteralRegex( type as ts.TemplateLiteralType );
        const expected = checker.typeToString( type );
        const reVar = `__re_${hoisted.length}`;
        hoisted.push( `const ${reVar} = __tcRuntime.getCachedPattern( ${JSON.stringify( regexStr )} );` );

        return `( function( v, path ){ if( !${reVar} ){ throw new __tcRuntime.ParseError( path, "UnsafePattern" ); } if( typeof v !== "string" || !__tcRuntime.testRegex( ${reVar}, v ) ){ throw new __tcRuntime.ParseError( path, ${JSON.stringify( expected )} ); } return v; })( ${varName}, ${p} )`;
    }

    if( symbolName && BUFFER_LIKE.has( symbolName ))
    {
        return `__tcRuntime.coerceBuffer( ${varName}, ${p} )`;
    }

    if( typeof checker.isTupleType === 'function' && checker.isTupleType( type ))
    {
        const typeArgs = ( type as ts.TupleTypeReference ).typeArguments || [];
        const slots = typeArgs.map(( elem, i ) =>
            buildValidation( elem, checker, mode, from, `arr[${i}]`, `p + "[${i}]"`, rootExpr, scope, visited, hoisted, recDefs, unionResolution )
        ).join( ', ' );

        return `( function( arr, p ){ if( !Array.isArray( arr ) || arr.length !== ${typeArgs.length} ){ throw new __tcRuntime.ParseError( p, "Tuple<${typeArgs.length}>" ); } return [${slots}]; })( ${varName}, ${p} )`;
    }

    if( typeof checker.isArrayType === 'function' && checker.isArrayType( type ))
    {
        const elemType = ( checker as any ).getTypeArguments?.( type as ts.TypeReference )?.[0] || { getFlags : () => ts.TypeFlags.Any };
        const elemCode = buildValidation( elemType, checker, mode, from, 'item', 'itemP', rootExpr, scope, visited, hoisted, recDefs, unionResolution );

        if( wantsQueryCoercion( from ))
        {
            return `__tcRuntime.coerceArray( ${varName}, ${p}, ( item, itemP ) => ${elemCode} )`;
        }

        return `( function( arr, p ){ __tcRuntime.expectArray( arr, p ); return arr.map( ( item, i ) => { const itemP = ( p ? p + "[" + i + "]" : "[" + i + "]" ); return ${elemCode}; } ); })( ${varName}, ${p} )`;
    }

    if( symbolName === 'Set' )
    {
        const elemType = ( checker as any ).getTypeArguments?.( type as ts.TypeReference )?.[0]
            || ( type as ts.TypeReference ).typeArguments?.[0]
            || ({ getFlags : () => ts.TypeFlags.Any } as any );
        const elemCode = buildValidation( elemType, checker, mode, from, 'item', 'itemP', rootExpr, scope, visited, hoisted, recDefs, unionResolution );

        return `__tcRuntime.parseSet( ${varName}, ${p}, ${JSON.stringify( from )}, ( item, itemP ) => ${elemCode} )`;
    }

    if( symbolName === 'Map' )
    {
        const typeArgs = ( checker as any ).getTypeArguments?.( type as ts.TypeReference )
            || ( type as ts.TypeReference ).typeArguments
            || [];
        const keyType = typeArgs[0] || ({ getFlags : () => ts.TypeFlags.Any } as any );
        const valueType = typeArgs[1] || ({ getFlags : () => ts.TypeFlags.Any } as any );
        assertValidMapKeyType( keyType, checker );
        const keyCode = buildValidation( keyType, checker, mode, 'string', 'k', 'keyP', rootExpr, scope, visited, hoisted, recDefs, unionResolution );
        const valCode = buildValidation( valueType, checker, mode, from, 'val', 'valP', rootExpr, scope, visited, hoisted, recDefs, unionResolution );

        return `__tcRuntime.parseMap( ${varName}, ${p}, ${JSON.stringify( from )}, ( k, keyP ) => ${keyCode}, ( val, valP ) => ${valCode} )`;
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
            const hasBooleanTag = tagged.arms.some( a => typeof a.tag === 'boolean' );
            const hasNumberTag = tagged.arms.some( a => typeof a.tag === 'number' );
            let discExpr = `v && v[${JSON.stringify( tagged.key )}]`;

            if( wantsQueryCoercion( from ))
            {
                if( hasBooleanTag )
                {
                    discExpr = `__tcRuntime.coerceBoolean( ${discExpr}, p )`;
                }
                else if( hasNumberTag )
                {
                    discExpr = `__tcRuntime.coerceNumber( ${discExpr}, p )`;
                }
            }

            const cases = tagged.arms.map( arm =>
                `case ${JSON.stringify( arm.tag )}: return ${buildValidation( arm.type, checker, mode, from, 'v', 'p', rootExpr, scope, visited, hoisted, recDefs, unionResolution )};`
            ).join( ' ' );

            return `( function( v, p ){ switch( ${discExpr} ){ ${cases} default: throw new __tcRuntime.ParseError( p, ${JSON.stringify( label )} ); } })( ${varName}, ${p} )`;
        }

        const sortedArms = unionResolution === 'declaration-order'
            ? arms.slice()
            : sortUnionArmsBySpecificity( arms, checker );
        const armFns = sortedArms.map( arm =>
            `( v, p ) => ${buildValidation( arm, checker, mode, from, 'v', 'p', rootExpr, scope, visited, hoisted, recDefs, unionResolution )}`
        ).join( ', ' );
        const probeBestFit = mode === 'strip' && unionResolution !== 'declaration-order' && hasCompetingObjectArms( sortedArms, checker );
        const exclusiveKeys = tryExclusiveKeyUnion( sortedArms, checker );

        if( probeBestFit )
        {
            const fallbackFlags = sortedArms.map( arm => isFallbackUnionArm( arm, checker ));
            const hasFallbacks = fallbackFlags.some( Boolean );
            const flagsArg = hasFallbacks
                ? `, ${JSON.stringify( fallbackFlags )}`
                : ( exclusiveKeys ? ', undefined' : '' );
            const keysArg = exclusiveKeys ? `, ${JSON.stringify( exclusiveKeys )}` : '';

            return `__tcRuntime.parseUnion( ${varName}, ${p}, ${JSON.stringify( label )}, [ ${armFns} ], true${flagsArg}${keysArg} )`;
        }

        if( exclusiveKeys )
        {
            return `__tcRuntime.parseUnion( ${varName}, ${p}, ${JSON.stringify( label )}, [ ${armFns} ], false, undefined, ${JSON.stringify( exclusiveKeys )} )`;
        }

        return `__tcRuntime.parseUnion( ${varName}, ${p}, ${JSON.stringify( label )}, [ ${armFns} ] )`;
    }

    const indexType = stringIndexType( type, checker );
    const props = mapStructuralProps( type, checker );

    return buildObjectValidation( props, indexType, checker, mode, from, varName, pathExpr, rootExpr, scope, visited, hoisted, recDefs, unionResolution );
}

function buildObjectValidation(
    props           : { name : string, type : ts.Type, isOptional : boolean, hasDefault : boolean }[],
    indexType       : ts.Type | undefined,
    checker         : ts.TypeChecker,
    mode            : ValidationMode,
    from            : ParseSource,
    varName         : string,
    pathExpr        : string,
    rootExpr        : string,
    scope           : ICustomFunctionScope,
    visited         : Set<number> = new Set(),
    hoisted         : string[] = [],
    recDefs         : Map<number, RecParseDef> = new Map(),
    unionResolution : UnionResolution = 'specificity'
): string
{
    const propNames = props.map( p => p.name );
    const initialProps: string[] = [];
    const optionalAssignments: string[] = [];

    for( const prop of props )
    {
        const valAccess = safePropAccess( 'o', prop.name );
        const subPathExpr = joinPath( pathExpr, prop.name );
        const subValCode = buildValidation( prop.type, checker, mode, from, valAccess, subPathExpr, rootExpr, scope, visited, hoisted, recDefs, unionResolution );

        if( prop.hasDefault )
        {
            // Always run so __default can fill missing values (optional or required).
            initialProps.push( `${JSON.stringify( prop.name )}: ${subValCode}` );
        }
        else if( prop.isOptional )
        {
            optionalAssignments.push( `if( ${valAccess} !== undefined ){ res[${JSON.stringify( prop.name )}] = ${subValCode}; }` );
        }
        else
        {
            // Required: same as assert — run the field validator on undefined (Type<*>), not a Missing shorthand.
            initialProps.push( `${JSON.stringify( prop.name )}: ${subValCode}` );
        }
    }

    let extraHandling = '';

    if( indexType || mode === 'strict' || mode === 'relaxed' || ( mode === 'strip' && props.length > 0 ))
    {
        const keysVar = hoisted.length === 0 ? '__keys' : `__keys_${hoisted.length}`;
        hoisted.push( `const ${keysVar} = new Set( ${JSON.stringify( propNames )} );` );

        if( indexType )
        {
            const idxCode = buildValidation( indexType, checker, mode, from, 'o[k]', '( p ? p + "." + k : k )', rootExpr, scope, visited, hoisted, recDefs, unionResolution );

            if( mode === 'strip' )
            {
                extraHandling = `let __mt = 0; for( const k of Object.keys( o ) ){ if( o[k] !== undefined ){ __mt++; } if( !${keysVar}.has( k ) ){ const __iv = ${idxCode}; if( k === "__proto__" || k === "constructor" || k === "prototype" ){ Object.defineProperty( res, k, { value: __iv, enumerable: true, configurable: true, writable: true } ); } else { res[k] = __iv; } } } if( __tcRuntime.hasParseUnionProbe() ){ __tcRuntime.recordParseObjectStats( 0, __mt ); }`;
            }
            else
            {
                extraHandling = `for( const k of Object.keys( o ) ){ if( !${keysVar}.has( k ) ){ const __iv = ${idxCode}; if( k === "__proto__" || k === "constructor" || k === "prototype" ){ Object.defineProperty( res, k, { value: __iv, enumerable: true, configurable: true, writable: true } ); } else { res[k] = __iv; } } }`;
            }
        }
        else if( mode === 'strict' )
        {
            extraHandling = `for( const k of Object.keys( o ) ){ if( !${keysVar}.has( k ) ){ throw new __tcRuntime.ParseError( p, "PropertyNotAllowed<" + k + ">" ); } }`;
        }
        else if( mode === 'relaxed' )
        {
            extraHandling = `for( const k of Object.keys( o ) ){ if( !${keysVar}.has( k ) ){ if( k === "__proto__" || k === "constructor" || k === "prototype" ){ Object.defineProperty( res, k, { value: o[k], enumerable: true, configurable: true, writable: true } ); } else { res[k] = o[k]; } } }`;
        }
        else if( mode === 'strip' )
        {
            extraHandling = `if( __tcRuntime.hasParseUnionProbe() ){ let __st = 0; let __mt = 0; for( const k of Object.keys( o ) ){ if( o[k] !== undefined ){ if( ${keysVar}.has( k ) ){ __mt++; } else { __st++; } } } __tcRuntime.recordParseObjectStats( __st, __mt ); }`;
        }
    }
    else if( mode === 'strip' )
    {
        extraHandling = 'if( __tcRuntime.hasParseUnionProbe() ){ let __st = 0; for( const k of Object.keys( o ) ){ if( o[k] !== undefined ){ __st++; } } __tcRuntime.recordParseObjectStats( __st, 0 ); }';
    }

    const optCode = optionalAssignments.length > 0 ? optionalAssignments.join( ' ' ) + ' ' : '';

    return `( function( o, p ){ o = __tcRuntime.expectObject( o, p ); const res = { ${initialProps.join( ', ' )} }; ${optCode}${extraHandling} return res; })( ${varName}, ${pathExpr || '""'} )`;
}
