import ts from 'typescript';
import { ValidationMode, toHeaderKebabKey, type CoercionKind, type UnionResolution } from '../runtime/validators.js';
import type { CasingFormat } from '../runtime/casing.js';
import { type ICustomFunctionScope } from './customFns.js';
import
{
    assertNotTypeParameter,
    assertValidMapKeyType,
    bigIntLiteralText,
    BUFFER_LIKE,
    buildTemplateLiteralRegex,
    buildWirePropertyMap,
    classifyNullableUnion,
    collectConstraintsFromProps,
    constraintTagNames,
    enumMemberTypes,
    extractTypeJsDocInfo,
    getPropertyType,
    getTypeProps,
    inspectTupleType,
    isIgnoredPropertySymbol,
    isNativeEnumType,
    isTagKey,
    mergeConstraintsWithJsDoc,
    MergedPropInfo,
    ParsedConstraint,
    peelTaggedIntersection,
    resolveWirePropertyName,
    safePropAccess,
    stripUndefinedFromUnion,
    TemplateIndexInfo,
    tryMergeObjectTypes,
    tryTaggedUnionTypes,
    typeHasDefaultTag,
    typeSymbolName,
    unionExpectedLabel,
    VERBATIM_CUSTOM_SCOPE
}
    from './type-helpers.js';
import { resolveTypeIr } from './type-ir.js';
import
{
    hasCompetingObjectArms,
    isFallbackUnionArm,
    sortUnionArmsBySpecificity,
    tryExclusiveKeyUnion
}
    from './specificity.js';

export type ParseSource = 'json' | 'query' | 'string' | 'formData' | 'headers';

export interface ParseGeneratorOptions
{
    mode?            : ValidationMode
    from?            : ParseSource
    unionResolution? : UnionResolution
    propertyCasing?  : CasingFormat
}

type RecParseDef =
    {
        fnName          : string
        type            : ts.Type
        mode            : ValidationMode
        from            : ParseSource
        unionResolution : UnionResolution
        propertyCasing? : CasingFormat
    };

type ParentRef =
    | { kind : 'root', textExpr : string }
    | { kind : 'prop', holderExpr : string, keyExpr : string };

/** Query-style coercions shared by non-JSON wire sources (`query`, `string`, `formData`, `headers`). */
function wantsQueryCoercion( from: ParseSource ): boolean
{
    return from !== 'json';
}

function typeContainsBigInt( type: ts.Type, checker: ts.TypeChecker, seen: Set<object> = new Set()): boolean
{
    if( !type || typeof type !== 'object' ){ return false }

    if( seen.has( type )){ return false }

    seen.add( type );
    const flags = typeof type.getFlags === 'function' ? type.getFlags() : 0;

    if( flags & ( ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral )){ return true }

    if( typeof type.isUnion === 'function' && type.isUnion())
    {
        return type.types.some( t => typeContainsBigInt( t, checker, seen ));
    }

    if( typeof type.isIntersection === 'function' && type.isIntersection())
    {
        return type.types.some( t => typeContainsBigInt( t, checker, seen ));
    }

    if( typeof checker.isTupleType === 'function' && checker.isTupleType( type ))
    {
        const { typeArgs } = inspectTupleType( type, checker );

        return typeArgs.some( t => typeContainsBigInt( t, checker, seen ));
    }

    if( typeof checker.isArrayType === 'function' && checker.isArrayType( type ))
    {
        const elem = ( checker as any ).getTypeArguments?.( type as ts.TypeReference )?.[0]
            || ( type as ts.TypeReference ).typeArguments?.[0];

        return elem ? typeContainsBigInt( elem, checker, seen ) : false;
    }

    const symName = typeSymbolName( type );

    if( symName === 'Set' || symName === 'ReadonlySet' )
    {
        const elem = ( checker as any ).getTypeArguments?.( type as ts.TypeReference )?.[0]
            || ( type as ts.TypeReference ).typeArguments?.[0];

        return elem ? typeContainsBigInt( elem, checker, seen ) : false;
    }

    if( symName === 'Map' || symName === 'ReadonlyMap' )
    {
        const args = ( checker as any ).getTypeArguments?.( type as ts.TypeReference )
            || ( type as ts.TypeReference ).typeArguments
            || [];

        return args.some(( t: ts.Type ) => typeContainsBigInt( t, checker, seen ));
    }

    if(
        ( flags & ts.TypeFlags.Object ) &&
        symName !== 'Date' && symName !== 'URL' && symName !== 'RegExp' && symName !== 'Promise' &&
        symName !== 'File' && symName !== 'Blob' &&
        ( !symName || !BUFFER_LIKE.has( symName ))
    )
    {
        for( const prop of getTypeProps( type, checker ))
        {
            if( isIgnoredPropertySymbol( prop )){ continue }

            if( typeContainsBigInt( getPropertyType( type, prop, checker ), checker, seen )){ return true }
        }

        if( typeof checker.getIndexInfoOfType === 'function' )
        {
            const strIdx = checker.getIndexInfoOfType( type, ts.IndexKind.String );

            if( strIdx && typeContainsBigInt( strIdx.type, checker, seen )){ return true }

            const numIdx = checker.getIndexInfoOfType( type, ts.IndexKind.Number );

            if( numIdx && typeContainsBigInt( numIdx.type, checker, seen )){ return true }
        }
    }

    return false;
}

function isTopType( type: ts.Type ): boolean
{
    const flags = typeof type.getFlags === 'function' ? type.getFlags() : 0;

    return ( flags & ( ts.TypeFlags.Any | ts.TypeFlags.Unknown )) !== 0;
}

/**
 * Root types allowed for `from: 'string'` — single already-decoded scalars only
 * (no objects, arrays, bags, or querystring parsing).
 */
function isStringSourceCompatible( type: ts.Type, checker: ts.TypeChecker, scope: ICustomFunctionScope ): boolean
{
    let walk = type;
    let hasSplit = false;

    if( typeof walk.isIntersection === 'function' && walk.isIntersection())
    {
        const peeled = peelTaggedIntersection( walk, checker, scope );

        if( peeled )
        {
            walk = peeled.base;
            hasSplit = peeled.constraints.some( c => c.type === 'transform_split' );
        }
    }

    if( hasSplit )
    {
        if( typeof checker.isArrayType === 'function' && checker.isArrayType( walk ))
        {
            const elem = ( checker as any ).getTypeArguments?.( walk as ts.TypeReference )?.[0]
                || ( walk as ts.TypeReference ).typeArguments?.[0];

            return elem ? isStringSourceCompatible( elem, checker, scope ) : false;
        }

        const splitSym = typeSymbolName( walk );

        if( splitSym === 'Set' || splitSym === 'ReadonlySet' )
        {
            const elem = ( checker as any ).getTypeArguments?.( walk as ts.TypeReference )?.[0]
                || ( walk as ts.TypeReference ).typeArguments?.[0];

            return elem ? isStringSourceCompatible( elem, checker, scope ) : false;
        }
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

    if( flags & ( ts.TypeFlags.Undefined | ts.TypeFlags.Void | ts.TypeFlags.Null ))
    {
        return true;
    }

    if( typeof walk.isStringLiteral === 'function' && walk.isStringLiteral()){ return true }

    if( typeof walk.isNumberLiteral === 'function' && walk.isNumberLiteral()){ return true }

    if( flags & ts.TypeFlags.BooleanLiteral ){ return true }

    if( flags & ts.TypeFlags.BigIntLiteral ){ return true }

    if( flags & ( ts.TypeFlags.String | ts.TypeFlags.StringMapping )){ return true }

    if( flags & ts.TypeFlags.Number ){ return true }

    if( flags & ts.TypeFlags.Boolean ){ return true }

    if( flags & ts.TypeFlags.BigInt ){ return true }

    if( flags & ts.TypeFlags.TemplateLiteral ){ return true }

    if( isNativeEnumType( walk ))
    {
        const members = enumMemberTypes( walk, checker );

        return members.length === 0 || members.every( m => isStringSourceCompatible( m, checker, scope ));
    }

    const symbolName = typeSymbolName( walk );

    if( symbolName === 'Date' || symbolName === 'URL' || symbolName === 'RegExp' ){ return true }

    if( typeof checker.isArrayType === 'function' && checker.isArrayType( walk )){ return false }

    if( typeof checker.isTupleType === 'function' && checker.isTupleType( walk )){ return false }

    if( symbolName === 'Set' || symbolName === 'ReadonlySet' || symbolName === 'Map' || symbolName === 'ReadonlyMap' ){ return false }

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

    if( flags & ( ts.TypeFlags.String | ts.TypeFlags.TemplateLiteral | ts.TypeFlags.StringMapping )){ return 'string' }

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

    if( name === 'URL' ){ return 'URL' }

    if( name === 'RegExp' ){ return 'RegExp' }

    if( name === 'Set' || name === 'ReadonlySet' ){ return 'Set' }

    if( name === 'Map' || name === 'ReadonlyMap' ){ return 'Map' }

    if( name === 'File' || name === 'Blob' || ( name && BUFFER_LIKE.has( name ))){ return 'instance' }

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
    assertNotTypeParameter( type );

    const mode = options.mode || 'strip';
    const from = options.from || 'json';
    const unionResolution = options.unionResolution || 'specificity';
    const propertyCasing = options.propertyCasing;
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
                const recParent: ParentRef | undefined = def.from === 'json'
                    ? { kind : 'prop', holderExpr : '__h', keyExpr : '__k' }
                    : undefined;
                const recBody = buildValidation(
                    def.type, checker, def.mode, def.from, 'raw', 'p', 'root',
                    scope, recVisited, hoisted, recDefs, def.unionResolution, def.propertyCasing, recParent
                );
                hoisted.push( `function ${def.fnName}( raw, p, root, transform, __h, __k ){ return ${recBody}; }` );
            }
        }

        if( hoisted.length === 0 ){ return fnExpr }

        return `( function(){ ${hoisted.join( ' ' )} return ${fnExpr}; })()`;
    };

    if( from === 'string' )
    {
        assertStringSourceCompatible( type, checker, scope );
        const body = buildValidation( type, checker, mode, 'string', 'input', 'path', 'input', scope, new Set(), hoisted, recDefs, unionResolution, propertyCasing );

        // Already-decoded scalar wire value — never parseQueryString / JSON.parse. Ignore reviver.
        return wrapOuter( `( function( raw, options ){ const path = ""; const transform = options && options.transform; const input = __tcRuntime.expectString( raw, path ); return ${body}; })` );
    }

    if( from === 'query' )
    {
        const body = buildValidation( type, checker, mode, 'query', 'rawQuery', 'path', 'rawQuery', scope, new Set(), hoisted, recDefs, unionResolution, propertyCasing );

        // Query text only — never starts with `?` (`url.search.slice(1)` / form body). Flag-keys stay flag-keys.
        return wrapOuter( `( function( input, options ){ const path = ""; const reviver = options && options.reviver; const transform = options && options.transform; const text = __tcRuntime.expectString( input, path ); let rawQuery = __tcRuntime.parseQueryString( text ); if( reviver ){ rawQuery = __tcRuntime.reviveTree( rawQuery, reviver ); } return ${body}; })` );
    }

    if( from === 'formData' )
    {
        const body = buildValidation( type, checker, mode, 'formData', 'rawForm', 'path', 'rawForm', scope, new Set(), hoisted, recDefs, unionResolution, propertyCasing );

        return wrapOuter( `( function( input, options ){ const path = ""; const reviver = options && options.reviver; const transform = options && options.transform; let rawForm = __tcRuntime.parseFormData( input ); if( reviver ){ rawForm = __tcRuntime.reviveTree( rawForm, reviver ); } return ${body}; })` );
    }

    if( from === 'headers' )
    {
        const body = buildValidation( type, checker, mode, 'headers', 'rawHeaders', 'path', 'rawHeaders', scope, new Set(), hoisted, recDefs, unionResolution, propertyCasing );

        return wrapOuter( `( function( input, options ){ const path = ""; const reviver = options && options.reviver; const transform = options && options.transform; let rawHeaders = __tcRuntime.parseHeaders( input ); if( reviver ){ rawHeaders = __tcRuntime.reviveTree( rawHeaders, reviver ); } return ${body}; })` );
    }

    const hasBigInt = typeContainsBigInt( type, checker );
    const rootParent: ParentRef | undefined = hasBigInt ? { kind : 'root', textExpr : 'text' } : undefined;
    const body = buildValidation( type, checker, mode, 'json', 'obj', 'path', 'obj', scope, new Set(), hoisted, recDefs, unionResolution, propertyCasing, rootParent );

    if( hasBigInt )
    {
        return wrapOuter( `( function( input, options ){ const path = ""; const reviver = options && options.reviver; const transform = options && options.transform; const text = __tcRuntime.expectString( input, path ); let obj = __tcRuntime.parseJson( text, true ); if( reviver ){ obj = __tcRuntime.reviveTree( obj, reviver ); } return ${body}; })` );
    }

    // JSON text only — always JSON.parse. Unquoted scalars belong on from:'string'.
    return wrapOuter( `( function( input, options ){ const path = ""; const reviver = options && options.reviver; const transform = options && options.transform; const text = __tcRuntime.expectString( input, path ); let obj; try { obj = JSON.parse( text ); } catch( e ){ throw new __tcRuntime.ParseError( path, "Invalid JSON: " + e.message ); } if( reviver ){ obj = __tcRuntime.reviveTree( obj, reviver ); } return ${body}; })` );
}

function serializeConstraintValue( v: any ): string
{
    if( typeof v === 'bigint' ){ return `${v}n` }

    return JSON.stringify( v );
}

function convertRequiresPathCasing( pathVal: string, casing: CasingFormat ): string
{
    return pathVal
        .split( '.' )
        .map( part => ( part.startsWith( '[' ) ? part : resolveWirePropertyName( part, casing )))
        .join( '.' );
}

function serializeConstraints( list: ParsedConstraint[], hoisted: string[], propertyCasing?: CasingFormat ): string
{
    if( list.length === 0 ){ return '[]' }

    const items = list.map( c =>
    {
        const parts = [ `type: ${JSON.stringify( c.type )}` ];
        let val = c.value;

        if( c.type === 'requires' && propertyCasing && val !== undefined )
        {
            val = Array.isArray( val )
                ? val.map( p => convertRequiresPathCasing( String( p ), propertyCasing ))
                : convertRequiresPathCasing( String( val ), propertyCasing );
        }

        if( val !== undefined ){ parts.push( `value: ${serializeConstraintValue( val )}` ) }

        if( c.message !== undefined ){ parts.push( `message: ${JSON.stringify( c.message )}` ) }

        if( c.type === 'pattern' && typeof val === 'string' )
        {
            const reVar = `__re_${hoisted.length}`;
            hoisted.push( `const ${reVar} = __tcRuntime.getCachedPattern( ${JSON.stringify( val )} );` );
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
    unionResolution : UnionResolution = 'specificity',
    propertyCasing? : CasingFormat
): string
{
    const tags = constraintTagNames( constraints );

    if( constraints.length === 0 )
    {
        const inner = innerFactory( varName, pathExpr );

        if( !applyOption ){ return inner }

        return `__tcRuntime.applyParseTransform( ${inner}, ${pathExpr || '""'}, transform, ${JSON.stringify( kind )}, ${JSON.stringify( tags )}, ${rootExpr} )`;
    }

    const hasSecret = constraints.some( c => c.type === 'secret' );
    const messageC = constraints.find( c => c.type === 'message' );
    const earlyReal = constraints.filter( c => c.type === 'default' || c.type === 'transform' || c.type === 'transform_split' );
    const early = earlyReal.length > 0 && messageC ? [ ...earlyReal, messageC ] : earlyReal;
    const customTransforms = constraints.filter( c => c.type === 'transform_custom' );
    const lateReal = constraints.filter( c =>
        c.type !== 'default' &&
        c.type !== 'transform' &&
        c.type !== 'transform_split' &&
        c.type !== 'transform_custom' &&
        c.type !== 'message' &&
        c.type !== 'tags' &&
        c.type !== 'custom' &&
        c.type !== 'contains' &&
        c.type !== 'propertyNames' &&
        c.type !== 'minContains' &&
        c.type !== 'maxContains' &&
        c.type !== 'readOnly' &&
        c.type !== 'writeOnly' &&
        c.type !== 'secret'
    );
    const late = lateReal.length > 0 && messageC ? [ ...lateReal, messageC ] : lateReal;
    const customConstraints = constraints.filter( c => c.type === 'custom' );
    const containsList = constraints.filter( c => c.type === 'contains' );
    const propertyNamesList = constraints.filter( c => c.type === 'propertyNames' );
    const minContains = constraints.find( c => c.type === 'minContains' )?.value as number | undefined;
    const maxContains = constraints.find( c => c.type === 'maxContains' )?.value as number | undefined;
    const fallbackMessage = typeof messageC?.value === 'string' ? messageC.value : undefined;
    const inner = innerFactory( '__v', 'p' );
    const innerAssign = fallbackMessage !== undefined
        ? `try { __v = ${inner}; } catch( _e ){ if( _e instanceof __tcRuntime.ParseError && _e.path === p ){ throw new __tcRuntime.ParseError( p, __tcRuntime.formatParseMessage( ${JSON.stringify( fallbackMessage )}, p, __v ) ); } throw _e; }`
        : `__v = ${inner};`;

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
            const activeMsg = c.message !== undefined ? c.message : fallbackMessage;
            const msgArg = activeMsg !== undefined ? `, ${JSON.stringify( activeMsg )}` : '';
            const fallback = activeMsg !== undefined ? JSON.stringify( activeMsg ) : '"Custom"';
            const secField = hasSecret ? ', secretDepth: 1' : '';

            return `{ const _ctx = { success: true, errors: [], mode: "strict", from: ${JSON.stringify( from )}, root: root${secField} }; __tcRuntime.validators.custom(__v, p, _ctx, ${c.value}${msgArg}); if( !_ctx.success ){ throw new __tcRuntime.ParseError( p, (_ctx.errors[0] && _ctx.errors[0].error) || ${fallback} ); } }`;
        }).join( ' ' );
        customConstraintCode = `if( __v !== undefined && __v !== null ){ ${stmts} } `;
    }

    let nestedConstraintCode = '';

    for( const containsC of containsList )
    {
        if( !containsC.nestedType ){ continue }

        const itemBody = buildValidation(
            containsC.nestedType, checker, mode, from, 'item', 'itemP', rootExpr, scope, visited, hoisted, recDefs, unionResolution, propertyCasing
        );
        const minStr = minContains !== undefined ? String( minContains ) : '1';
        const maxStr = maxContains !== undefined ? String( maxContains ) : 'undefined';
        const activeMsg = containsC.message !== undefined ? containsC.message : fallbackMessage;
        const msgArg = activeMsg !== undefined ? `, ${JSON.stringify( activeMsg )}` : '';
        nestedConstraintCode +=
            `__v = __tcRuntime.applyContains(__v, p, (item, itemP) => ${itemBody}, ${minStr}, ${maxStr}${msgArg}); `;
    }

    for( const propertyNamesC of propertyNamesList )
    {
        if( !propertyNamesC.nestedType ){ continue }

        const keyBody = buildValidation(
            propertyNamesC.nestedType, checker, mode, 'string', 'key', 'keyP', rootExpr, scope, visited, hoisted, recDefs, unionResolution, propertyCasing
        );
        const activeMsg = propertyNamesC.message !== undefined ? propertyNamesC.message : fallbackMessage;
        const msgArg = activeMsg !== undefined
            ? `, ${JSON.stringify( activeMsg )}`
            : '';
        nestedConstraintCode +=
            `__v = __tcRuntime.applyPropertyNames(__v, p, (key, keyP) => ${keyBody}${msgArg}); `;
    }

    const earlyInit = early.length > 0
        ? `let __v = __tcRuntime.applyParseConstraints( raw, p, ${serializeConstraints( early, hoisted, propertyCasing )}, ${JSON.stringify( from )}, root ); `
        : 'let __v = raw; ';
    const optionCode = ( applyOption || tags.length > 0 )
        ? `if( transform ){ __v = __tcRuntime.applyParseTransform( __v, p, transform, ${JSON.stringify( kind )}, ${JSON.stringify( tags )}, root ); } `
        : '';
    const lateCode = late.length > 0
        ? `__v = __tcRuntime.applyParseConstraints( __v, p, ${serializeConstraints( late, hoisted, propertyCasing )}, ${JSON.stringify( from )}, root ); `
        : '';

    const tailBody = `${lateCode}${nestedConstraintCode}${customConstraintCode}return __v;`;
    const wrappedTail = hasSecret
        ? `return __tcRuntime.redactParseSecret( () => { ${tailBody} }, __v, p );`
        : tailBody;
    const coreExpr = `( function( raw, p, root ){ ${earlyInit}${customTransformCode}${innerAssign} ${optionCode}${wrappedTail} })( ${varName}, ${pathExpr || '""'}, ${rootExpr} )`;

    return hasSecret ? `__tcRuntime.redactParseSecret( () => ${coreExpr}, ${varName}, ${pathExpr || '""'} )` : coreExpr;
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
    unionResolution : UnionResolution = 'specificity',
    propertyCasing? : CasingFormat,
    parentRef?      : ParentRef
): string
{
    assertNotTypeParameter( type );

    const typeId = ( type as any ).id;

    if( typeof typeId === 'number' )
    {
        if( visited.has( typeId ))
        {
            let def = recDefs.get( typeId );

            if( !def )
            {
                const fnName = `__rec_parse_${typeId}_${hoisted.length}`;
                def = { fnName, type, mode, from, unionResolution, propertyCasing };
                recDefs.set( typeId, def );
            }

            const parentArgs = parentRef?.kind === 'prop'
                ? `, ${parentRef.holderExpr}, ${parentRef.keyExpr}`
                : '';

            return `${def.fnName}( ${varName}, ${pathExpr || '""'}, ${rootExpr}, typeof transform !== 'undefined' ? transform : undefined${parentArgs} )`;
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
                    const inner = tryMergeObjectTypes( walkType.types, checker, walkType );

                    if( inner )
                    {
                        const typeJsDoc = extractTypeJsDocInfo( type, checker );
                        const mergedC = mergeConstraintsWithJsDoc( constraints, typeJsDoc.constraints );

                        return wrapConstraints(
                            ( vn, pe ) => buildObjectValidation( inner.props, inner.indexType, inner.patternIndexInfos, checker, mode, from, vn, pe, rootExpr, scope, visited, hoisted, recDefs, unionResolution, propertyCasing ),
                            mergedC,
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
                            unionResolution,
                            propertyCasing
                        );
                    }
                }
            }
            else
            {
                const merged = tryMergeObjectTypes( type.types, checker, type );

                if( merged )
                {
                    const typeJsDoc = extractTypeJsDocInfo( type, checker );

                    if( typeJsDoc.constraints.length > 0 )
                    {
                        return wrapConstraints(
                            ( vn, pe ) => buildObjectValidation( merged.props, merged.indexType, merged.patternIndexInfos, checker, mode, from, vn, pe, rootExpr, scope, visited, hoisted, recDefs, unionResolution, propertyCasing ),
                            typeJsDoc.constraints,
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
                            unionResolution,
                            propertyCasing
                        );
                    }

                    return buildObjectValidation( merged.props, merged.indexType, merged.patternIndexInfos, checker, mode, from, varName, pathExpr, rootExpr, scope, visited, hoisted, recDefs, unionResolution, propertyCasing );
                }

                if( peeled )
                {
                    walkType = peeled.base;
                    constraints = peeled.constraints;
                }
            }
        }

        const isUnionWalk = typeof walkType.isUnion === 'function' && walkType.isUnion();

        if( constraints.length === 0 && !isUnionWalk )
        {
            const rawProps = getTypeProps( walkType, checker );

            if( rawProps.some( p => isTagKey( p.getName())))
            {
                constraints = collectConstraintsFromProps( rawProps, checker, scope );
            }
        }

        if( !isUnionWalk )
        {
            const outerJsDoc = extractTypeJsDocInfo( type, checker );
            constraints = mergeConstraintsWithJsDoc( constraints, outerJsDoc.constraints );

            if( walkType !== type )
            {
                const innerJsDoc = extractTypeJsDocInfo( walkType, checker );
                constraints = mergeConstraintsWithJsDoc( constraints, innerJsDoc.constraints );
            }
        }

        return wrapConstraints(
            ( vn, pe ) => buildValidationCore( walkType, checker, mode, from, vn, pe, rootExpr, scope, visited, hoisted, recDefs, unionResolution, propertyCasing, parentRef ),
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
            unionResolution,
            propertyCasing
        );
    }
    finally
    {
        if( typeof typeId === 'number' ){ visited.delete( typeId ) }
    }
}

function buildBigIntCoerceCall( varExpr: string, pathExpr: string, from: ParseSource, parentRef?: ParentRef ): string
{
    if( from === 'json' && parentRef )
    {
        if( parentRef.kind === 'root' )
        {
            return `__tcRuntime.coerceBigIntRoot( ${parentRef.textExpr}, ${varExpr}, ${pathExpr} )`;
        }

        return `__tcRuntime.coerceBigIntProp( ${parentRef.holderExpr}, ${parentRef.keyExpr}, ${varExpr}, ${pathExpr} )`;
    }

    return `__tcRuntime.coerceBigInt( ${varExpr}, ${pathExpr} )`;
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
    unionResolution : UnionResolution = 'specificity',
    propertyCasing? : CasingFormat,
    parentRef?      : ParentRef
): string
{
    const flags = typeof type.getFlags === 'function' ? type.getFlags() : ts.TypeFlags.Any;
    const p = pathExpr || '""';

    if( flags & ts.TypeFlags.Never )
    {
        return `( function( v, path ){ throw new __tcRuntime.ParseError( path, "Type<never>" ); })( ${varName}, ${p} )`;
    }

    // Match validators.any — accept and return the value as-is (still behind the json/query preamble).
    if( flags & ts.TypeFlags.Any || flags & ts.TypeFlags.Unknown )
    {
        return varName;
    }

    if( flags & ts.TypeFlags.NonPrimitive )
    {
        return `__tcRuntime.expectObject( ${varName}, ${p} )`;
    }

    if( flags & ( ts.TypeFlags.Undefined | ts.TypeFlags.Void ))
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
        const coerceCall = buildBigIntCoerceCall( 'v', 'path', from, parentRef );

        return `( function( v, path ){ const b = ${coerceCall}; if( b !== ${lit}n ){ throw new __tcRuntime.ParseError( path, ${JSON.stringify( litCode )} ); } return b; })( ${varName}, ${p} )`;
    }

    if( flags & ts.TypeFlags.StringMapping )
    {
        const mappingName = typeSymbolName( type );
        const expected = `Type<${checker.typeToString( type )}>`;
        let cond = 'typeof v === "string"';

        if( mappingName === 'Uppercase' ){ cond = 'typeof v === "string" && v === v.toUpperCase()' }
        else if( mappingName === 'Lowercase' ){ cond = 'typeof v === "string" && v === v.toLowerCase()' }
        else if( mappingName === 'Capitalize' ){ cond = 'typeof v === "string" && ( v.length === 0 || v.charAt( 0 ) === v.charAt( 0 ).toUpperCase() )' }
        else if( mappingName === 'Uncapitalize' ){ cond = 'typeof v === "string" && ( v.length === 0 || v.charAt( 0 ) === v.charAt( 0 ).toLowerCase() )' }

        return `( function( v, path ){ if( !( ${cond} ) ){ throw new __tcRuntime.ParseError( path, ${JSON.stringify( expected )} ); } return v; })( ${varName}, ${p} )`;
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
        return buildBigIntCoerceCall( varName, p, from, parentRef );
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
                unionResolution,
                propertyCasing,
                parentRef
            );
        }

        if( wantsQueryCoercion( from ))
        {
            return `__tcRuntime.coerceNumber( ${varName}, ${p} )`;
        }

        return `__tcRuntime.expectNumber( ${varName}, ${p} )`;
    }

    const symbolName = typeSymbolName( type );

    if( symbolName === 'Date' )
    {
        return `__tcRuntime.coerceDate( ${varName}, ${p} )`;
    }

    if( symbolName === 'URL' )
    {
        return `__tcRuntime.coerceUrl( ${varName}, ${p} )`;
    }

    if( symbolName === 'RegExp' )
    {
        return `( function( v, path ){ if( v instanceof RegExp ){ return v } if( typeof v === "string" ){ const match = v.match( /^\\/(.*)\\/([dgimsuvy]*)$/ ); if( match ){ try { return new RegExp( match[1], match[2] ); } catch( e ){} } ${wantsQueryCoercion( from ) ? 'try { return new RegExp( v ); } catch( e ){}' : ''} } if( v && typeof v === "object" && typeof v.source === "string" ){ try { return new RegExp( v.source, typeof v.flags === "string" ? v.flags : "" ); } catch( e ){} } throw new __tcRuntime.ParseError( path, "Type<RegExp>" ); })( ${varName}, ${p} )`;
    }

    if( symbolName === 'File' )
    {
        return `__tcRuntime.expectFile( ${varName}, ${p} )`;
    }

    if( symbolName === 'Blob' )
    {
        return `__tcRuntime.expectBlob( ${varName}, ${p} )`;
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
        if( symbolName === 'Buffer' )
        {
            return `__tcRuntime.coerceBuffer( ${varName}, ${p} )`;
        }

        return `__tcRuntime.coerceTypedArray( ${varName}, ${p}, ${JSON.stringify( symbolName )} )`;
    }

    if( typeof checker.isTupleType === 'function' && checker.isTupleType( type ))
    {
        const { typeArgs, elementFlags, hasRest, hasOptional, fixedCount, minItems, restType, suffixTypes } = inspectTupleType( type, checker );

        if( !hasRest && !hasOptional )
        {
            const slots = typeArgs.map(( elem: ts.Type, i: number ) =>
                buildValidation(
                    elem, checker, mode, from, `arr[${i}]`, `p + "[${i}]"`, rootExpr,
                    scope, visited, hoisted, recDefs, unionResolution, propertyCasing,
                    { kind : 'prop', holderExpr : 'arr', keyExpr : String( i ) }
                )
            ).join( ', ' );

            return `( function( arr, p ){ if( !Array.isArray( arr ) || arr.length !== ${typeArgs.length} ){ throw new __tcRuntime.ParseError( p, "Tuple<${typeArgs.length}>" ); } return [${slots}]; })( ${varName}, ${p} )`;
        }

        const fixedStmts: string[] = [];
        const suffixLen = suffixTypes.length;
        const restEndExpr = suffixLen > 0 ? `arr.length - ${suffixLen}` : 'arr.length';

        for( let i = 0; i < fixedCount; i++ )
        {
            const isOpt = ( elementFlags[i] & ts.ElementFlags.Optional ) !== 0;
            const elemType = isOpt ? stripUndefinedFromUnion( typeArgs[i]) : typeArgs[i];
            const elemCode = buildValidation(
                elemType, checker, mode, from, `arr[${i}]`, `p + "[${i}]"`, rootExpr,
                scope, visited, hoisted, recDefs, unionResolution, propertyCasing,
                { kind : 'prop', holderExpr : 'arr', keyExpr : String( i ) }
            );

            if( isOpt )
            {
                fixedStmts.push( `if( ${restEndExpr} > ${i} ){ out.push( arr[${i}] === undefined ? undefined : ${elemCode} ); }` );
            }
            else
            {
                fixedStmts.push( `out.push( ${elemCode} );` );
            }
        }

        if( hasRest && restType )
        {
            const restElemCode = buildValidation(
                restType, checker, mode, from, 'arr[i]', 'p + "[" + i + "]"', rootExpr,
                scope, visited, hoisted, recDefs, unionResolution, propertyCasing,
                { kind : 'prop', holderExpr : 'arr', keyExpr : 'i' }
            );
            const suffixStmts = suffixTypes.map(( sType, j ) =>
            {
                const sCode = buildValidation(
                    sType, checker, mode, from, 'arr[__si]', 'p + "[" + __si + "]"', rootExpr,
                    scope, visited, hoisted, recDefs, unionResolution, propertyCasing,
                    { kind : 'prop', holderExpr : 'arr', keyExpr : '__si' }
                );

                return `{ const __si = ${restEndExpr} + ${j}; out.push( ${sCode} ); }`;
            }).join( ' ' );

            return `( function( arr, p ){ if( !Array.isArray( arr ) || arr.length < ${minItems} ){ throw new __tcRuntime.ParseError( p, "Tuple<${minItems}+>" ); } const out = []; ${fixedStmts.join( ' ' )} for( let i = ${fixedCount}; i < ${restEndExpr}; i++ ){ out.push( ${restElemCode} ); } ${suffixStmts} return out; })( ${varName}, ${p} )`;
        }

        return `( function( arr, p ){ if( !Array.isArray( arr ) || arr.length < ${minItems} || arr.length > ${fixedCount} ){ throw new __tcRuntime.ParseError( p, "Tuple<${minItems}..${fixedCount}>" ); } const out = []; ${fixedStmts.join( ' ' )} return out; })( ${varName}, ${p} )`;
    }

    if( typeof checker.isArrayType === 'function' && checker.isArrayType( type ))
    {
        const elemType = ( checker as any ).getTypeArguments?.( type as ts.TypeReference )?.[0] || { getFlags : () => ts.TypeFlags.Any };

        if( from === 'headers' )
        {
            const elemCode = buildValidation( elemType, checker, mode, from, 'item', 'itemP', rootExpr, scope, visited, hoisted, recDefs, unionResolution, propertyCasing );

            return `__tcRuntime.coerceHeaderArray( ${varName}, ${p}, ( item, itemP ) => ${elemCode} )`;
        }

        if( wantsQueryCoercion( from ))
        {
            const elemCode = buildValidation( elemType, checker, mode, from, 'item', 'itemP', rootExpr, scope, visited, hoisted, recDefs, unionResolution, propertyCasing );

            return `__tcRuntime.coerceArray( ${varName}, ${p}, ( item, itemP ) => ${elemCode} )`;
        }

        const elemCode = buildValidation(
            elemType, checker, mode, from, 'item', 'itemP', rootExpr,
            scope, visited, hoisted, recDefs, unionResolution, propertyCasing,
            { kind : 'prop', holderExpr : 'arr', keyExpr : 'i' }
        );

        return `( function( arr, p ){ __tcRuntime.expectArray( arr, p ); const out = new Array( arr.length ); for( let i = 0; i < arr.length; i++ ){ const item = arr[i]; const itemP = ( p ? p + "[" + i + "]" : "[" + i + "]" ); out[i] = ${elemCode}; } return out; })( ${varName}, ${p} )`;
    }

    if( symbolName === 'Set' || symbolName === 'ReadonlySet' )
    {
        const elemType = ( checker as any ).getTypeArguments?.( type as ts.TypeReference )?.[0]
            || ( type as ts.TypeReference ).typeArguments?.[0]
            || ({ getFlags : () => ts.TypeFlags.Any } as any );
        const elemCode = buildValidation(
            elemType, checker, mode, from, 'item', 'itemP', rootExpr,
            scope, visited, hoisted, recDefs, unionResolution, propertyCasing,
            { kind : 'prop', holderExpr : '__items', keyExpr : '__idx' }
        );

        return `__tcRuntime.parseSet( ${varName}, ${p}, ${JSON.stringify( from )}, ( item, itemP, __idx, __items ) => ${elemCode} )`;
    }

    if( symbolName === 'Map' || symbolName === 'ReadonlyMap' )
    {
        const typeArgs = ( checker as any ).getTypeArguments?.( type as ts.TypeReference )
            || ( type as ts.TypeReference ).typeArguments
            || [];
        const keyType = typeArgs[0] || ({ getFlags : () => ts.TypeFlags.Any } as any );
        const valueType = typeArgs[1] || ({ getFlags : () => ts.TypeFlags.Any } as any );
        assertValidMapKeyType( keyType, checker );
        const keyCode = buildValidation( keyType, checker, mode, 'string', 'k', 'keyP', rootExpr, scope, visited, hoisted, recDefs, unionResolution, propertyCasing );
        const valCode = buildValidation(
            valueType, checker, mode, from, 'val', 'valP', rootExpr,
            scope, visited, hoisted, recDefs, unionResolution, propertyCasing,
            { kind : 'prop', holderExpr : '__mh', keyExpr : '__mk' }
        );

        return `__tcRuntime.parseMap( ${varName}, ${p}, ${JSON.stringify( from )}, ( k, keyP ) => ${keyCode}, ( val, valP, __mk, __mh ) => ${valCode} )`;
    }

    if( typeof type.isUnion === 'function' && type.isUnion())
    {
        // Drop undefined arms when a sibling has Default (parity with validators)
        let arms = type.types;

        if( arms.some( m => typeHasDefaultTag( m, checker )))
        {
            arms = arms.filter( m => !( m.getFlags() & ts.TypeFlags.Undefined ));
        }

        const { hasUndefined, hasNull, nonNullish } = classifyNullableUnion( arms );

        if( nonNullish.length === 1 && ( hasUndefined || hasNull ))
        {
            const inner = buildValidation( nonNullish[0], checker, mode, from, 'v', 'p', rootExpr, scope, visited, hoisted, recDefs, unionResolution, propertyCasing, parentRef );

            if( hasUndefined && hasNull )
            {
                return `( function( v, p ){ if( v === undefined || v === null ){ return v; } return ${inner}; })( ${varName}, ${p} )`;
            }

            if( hasUndefined )
            {
                return `( function( v, p ){ if( v === undefined ){ return undefined; } return ${inner}; })( ${varName}, ${p} )`;
            }

            return `( function( v, p ){ if( v === null ){ return null; } return ${inner}; })( ${varName}, ${p} )`;
        }

        const label = unionExpectedLabel( type, checker );
        const tagged = tryTaggedUnionTypes( arms, checker );

        if( tagged )
        {
            const wireDiscKey = resolveWirePropertyName( tagged.key, propertyCasing );
            const discKebab = toHeaderKebabKey( wireDiscKey );
            const discLower = wireDiscKey.toLowerCase();
            const discExpr = from === 'headers'
                ? `( v && typeof v === "object" ? ( Object.hasOwn( v, ${JSON.stringify( discKebab )} ) ? v[${JSON.stringify( discKebab )}] : ( Object.hasOwn( v, ${JSON.stringify( discLower )} ) ? v[${JSON.stringify( discLower )}] : undefined ) ) : undefined )`
                : `( v && typeof v === "object" && Object.hasOwn( v, ${JSON.stringify( wireDiscKey )} ) ? v[${JSON.stringify( wireDiscKey )}] : undefined )`;
            const stringTags = new Set( tagged.arms.filter( a => typeof a.tag === 'string' ).map( a => a.tag as string ));
            const cases = tagged.arms.map( arm =>
            {
                const caseLabels = [ `case ${JSON.stringify( arm.tag )}:` ];

                if( wantsQueryCoercion( from ))
                {
                    if( typeof arm.tag === 'number' )
                    {
                        const asStr = String( arm.tag );

                        if( !stringTags.has( asStr ))
                        {
                            caseLabels.push( `case ${JSON.stringify( asStr )}:` );
                        }
                    }
                    else if( typeof arm.tag === 'boolean' )
                    {
                        const candidates = arm.tag ? [ 'true', '1' ] : [ 'false', '0' ];

                        for( const c of candidates )
                        {
                            if( !stringTags.has( c ))
                            {
                                caseLabels.push( `case ${JSON.stringify( c )}:` );
                            }
                        }
                    }
                }

                return `${caseLabels.join( ' ' )} return ${buildValidation( arm.type, checker, mode, from, 'v', 'p', rootExpr, scope, visited, hoisted, recDefs, unionResolution, propertyCasing, parentRef )};`;
            }).join( ' ' );

            return `( function( v, p ){ switch( ${discExpr} ){ ${cases} default: throw new __tcRuntime.ParseError( p, ${JSON.stringify( label )} ); } })( ${varName}, ${p} )`;
        }

        const sortedArms = unionResolution === 'declaration-order'
            ? arms.slice()
            : sortUnionArmsBySpecificity( arms, checker );
        const armFns = sortedArms.map( arm =>
            `( v, p ) => ${buildValidation( arm, checker, mode, from, 'v', 'p', rootExpr, scope, visited, hoisted, recDefs, unionResolution, propertyCasing, parentRef )}`
        ).join( ', ' );
        const probeBestFit = mode === 'strip' && unionResolution !== 'declaration-order' && hasCompetingObjectArms( sortedArms, checker );
        const rawExclusiveKeys = tryExclusiveKeyUnion( sortedArms, checker );
        const exclusiveKeys = rawExclusiveKeys && propertyCasing
            ? rawExclusiveKeys.map( k => resolveWirePropertyName( k, propertyCasing ))
            : rawExclusiveKeys;

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

    const ir = resolveTypeIr( type, checker );
    const indexType = ir.getStringIndexType();
    const props = ir.getProps();
    const patternInfos = ir.getTemplateIndexInfos();

    return buildObjectValidation( props, indexType, patternInfos, checker, mode, from, varName, pathExpr, rootExpr, scope, visited, hoisted, recDefs, unionResolution, propertyCasing );
}

function buildObjectValidation(
    props             : Pick<MergedPropInfo, 'name' | 'type' | 'isOptional' | 'hasDefault' | 'isReadOnly' | 'isSecret' | 'jsdocConstraints'>[],
    indexType         : ts.Type | undefined,
    patternIndexInfos : TemplateIndexInfo[] | undefined,
    checker           : ts.TypeChecker,
    mode              : ValidationMode,
    from              : ParseSource,
    varName           : string,
    pathExpr          : string,
    rootExpr          : string,
    scope             : ICustomFunctionScope,
    visited           : Set<number> = new Set(),
    hoisted           : string[] = [],
    recDefs           : Map<number, RecParseDef> = new Map(),
    unionResolution   : UnionResolution = 'specificity',
    propertyCasing?   : CasingFormat
): string
{
    const propNames = props.map( p => p.name );
    const wireMap = buildWirePropertyMap( propNames, propertyCasing );
    const hasPatterns = Boolean( patternIndexInfos && patternIndexInfos.length > 0 );
    const allowedKeySet = new Set<string>();

    for( const p of props )
    {
        if( p.isReadOnly && mode === 'strip' && !indexType && !hasPatterns ){ continue }

        const wn = wireMap.get( p.name )!;
        allowedKeySet.add( wn );

        if( from === 'headers' )
        {
            allowedKeySet.add( toHeaderKebabKey( wn ));
            allowedKeySet.add( wn.toLowerCase());
        }
    }

    const wireNames = [ ...allowedKeySet ];
    const preChecks: string[] = [];
    const probeAdjustments: string[] = [];
    const initialProps: string[] = [];
    const postInitAssignments: string[] = [];
    const optionalAssignments: string[] = [];

    for( const prop of props )
    {
        const wireName = wireMap.get( prop.name )!;
        let hasOwnExpr: string;
        let valAccess: string;

        if( from === 'headers' )
        {
            const candidates = [ ...new Set([ toHeaderKebabKey( wireName ), wireName.toLowerCase(), wireName ]) ];

            if( candidates.length === 1 )
            {
                hasOwnExpr = `Object.hasOwn( o, ${JSON.stringify( candidates[0])} )`;
                valAccess = `( ${hasOwnExpr} ? ${safePropAccess( 'o', candidates[0])} : undefined )`;
            }
            else
            {
                hasOwnExpr = `( ${candidates.map( c => `Object.hasOwn( o, ${JSON.stringify( c )} )` ).join( ' || ' )} )`;
                let expr = 'undefined';

                for( let ci = candidates.length - 1; ci >= 0; ci-- )
                {
                    const c = candidates[ci];
                    expr = `( Object.hasOwn( o, ${JSON.stringify( c )} ) ? ${safePropAccess( 'o', c )} : ${expr} )`;
                }

                valAccess = expr;
            }
        }
        else
        {
            const rawAccess = safePropAccess( 'o', wireName );
            hasOwnExpr = `Object.hasOwn( o, ${JSON.stringify( wireName )} )`;
            valAccess = `( ${hasOwnExpr} ? ${rawAccess} : undefined )`;
        }

        const subPathExpr = joinPath( pathExpr, wireName );
        const effectiveType = prop.isOptional && !prop.hasDefault ? stripUndefinedFromUnion( prop.type ) : prop.type;
        const propParent: ParentRef = { kind : 'prop', holderExpr : 'o', keyExpr : JSON.stringify( wireName ) };

        if( prop.isReadOnly )
        {
            if( mode === 'strict' )
            {
                preChecks.push( `if( ${valAccess} !== undefined ){ throw new __tcRuntime.ParseError( ${subPathExpr}, ${JSON.stringify( `ReadOnly<${wireName}>` )} ); }` );
            }
            else if( mode === 'strip' && ( indexType || hasPatterns ))
            {
                probeAdjustments.push( `if( ${valAccess} !== undefined ){ __st++; __mt--; }` );
            }

            if( !prop.hasDefault ){ continue }
        }

        const inputExpr = prop.isReadOnly ? 'undefined' : valAccess;
        let subValCode = buildValidation( effectiveType, checker, mode, from, inputExpr, subPathExpr, rootExpr, scope, visited, hoisted, recDefs, unionResolution, propertyCasing, propParent );

        if( prop.jsdocConstraints && prop.jsdocConstraints.length > 0 )
        {
            let existingTagTypes = new Set<string>();

            if( typeof effectiveType.isIntersection === 'function' && effectiveType.isIntersection())
            {
                const peeled = peelTaggedIntersection( effectiveType, checker, scope );

                if( peeled ){ existingTagTypes = new Set( peeled.constraints.map( c => c.type )) }
            }

            const extraJsDoc = prop.jsdocConstraints.filter( c => !existingTagTypes.has( c.type ));

            if( extraJsDoc.length > 0 )
            {
                subValCode = wrapConstraints(
                    () => buildValidation( effectiveType, checker, mode, from, '__v', 'p', rootExpr, scope, visited, hoisted, recDefs, unionResolution, propertyCasing, propParent ),
                    extraJsDoc,
                    inputExpr,
                    subPathExpr,
                    from,
                    rootExpr,
                    checker,
                    mode,
                    scope,
                    coercionKindOf( effectiveType, checker ),
                    false,
                    visited,
                    hoisted,
                    recDefs,
                    unionResolution,
                    propertyCasing
                );
            }
        }

        if( prop.isSecret && !prop.isReadOnly )
        {
            subValCode = `__tcRuntime.redactParseSecret( () => ${subValCode}, ${valAccess}, ${subPathExpr} )`;
        }

        const assignKnownProp = ( codeExpr: string ): void =>
        {
            if( prop.name === '__proto__' )
            {
                postInitAssignments.push( `Object.defineProperty( res, "__proto__", { value: ${codeExpr}, enumerable: true, configurable: true, writable: true } );` );
            }
            else
            {
                initialProps.push( `${JSON.stringify( prop.name )}: ${codeExpr}` );
            }
        };

        if( prop.hasDefault )
        {
            // Always run so __default / @default can fill missing values (optional or required).
            assignKnownProp( subValCode );
        }
        else if( prop.isOptional )
        {
            if( prop.name === '__proto__' )
            {
                optionalAssignments.push( `if( ${valAccess} !== undefined ){ Object.defineProperty( res, "__proto__", { value: ${subValCode}, enumerable: true, configurable: true, writable: true } ); }` );
            }
            else
            {
                optionalAssignments.push( `if( ${valAccess} !== undefined ){ res[${JSON.stringify( prop.name )}] = ${subValCode}; }` );
            }
        }
        else
        {
            const guardedReqCode = isTopType( effectiveType )
                ? `( !${hasOwnExpr} ? ( function(){ throw new __tcRuntime.ParseError( ${subPathExpr}, ${JSON.stringify( `Required<${wireName}>` )} ); })() : ${subValCode} )`
                : subValCode;
            assignKnownProp( guardedReqCode );
        }
    }

    let extraHandling = '';
    const dynParent: ParentRef = { kind : 'prop', holderExpr : 'o', keyExpr : 'k' };
    const probeAdjCode = probeAdjustments.length > 0 ? probeAdjustments.join( ' ' ) + ' ' : '';

    if( hasPatterns )
    {
        const keysVar = hoisted.length === 0 ? '__keys' : `__keys_${hoisted.length}`;
        hoisted.push( `const ${keysVar} = new Set( ${JSON.stringify( wireNames )} );` );

        const patternBranches = patternIndexInfos!.map( pInfo =>
        {
            const reVar = `__re_${hoisted.length}`;
            hoisted.push( `const ${reVar} = __tcRuntime.getCachedPattern( ${JSON.stringify( pInfo.pattern )} );` );
            const patValCode = buildValidation( pInfo.valueType, checker, mode, from, '__pv', '( p ? p + "." + k : k )', rootExpr, scope, visited, hoisted, recDefs, unionResolution, propertyCasing, dynParent );

            return `if( ${reVar} && __tcRuntime.testRegex( ${reVar}, k ) ){ __pm = true; __pv = ${patValCode}; }`;
        }).join( ' ' );

        const assignProp = ( valExpr: string ) =>
            `if( k === "__proto__" || k === "constructor" || k === "prototype" ){ Object.defineProperty( res, k, { value: ${valExpr}, enumerable: true, configurable: true, writable: true } ); } else { res[k] = ${valExpr}; }`;

        let unmatchedCode = '';

        if( indexType )
        {
            const idxCode = buildValidation( indexType, checker, mode, from, 'o[k]', '( p ? p + "." + k : k )', rootExpr, scope, visited, hoisted, recDefs, unionResolution, propertyCasing, dynParent );
            unmatchedCode = `${ mode === 'strip' ? 'if( o[k] !== undefined ){ __mt++; } ' : ''}const __iv = ${idxCode}; ${assignProp( '__iv' )}`;
        }
        else if( mode === 'strict' )
        {
            unmatchedCode = 'throw new __tcRuntime.ParseError( p, "PropertyNotAllowed<" + k + ">" );';
        }
        else if( mode === 'relaxed' )
        {
            unmatchedCode = assignProp( 'o[k]' );
        }
        else if( mode === 'strip' )
        {
            unmatchedCode = 'if( o[k] !== undefined ){ __st++; }';
        }

        if( mode === 'strip' )
        {
            extraHandling = `let __st = 0; let __mt = 0; for( const k of Object.keys( o ) ){ if( ${keysVar}.has( k ) ){ if( o[k] !== undefined ){ __mt++; } continue; } let __pm = false; let __pv = o[k]; ${patternBranches} if( __pm ){ if( o[k] !== undefined ){ __mt++; } ${assignProp( '__pv' )} } else { ${unmatchedCode} } } ${probeAdjCode}if( __tcRuntime.hasParseUnionProbe() ){ __tcRuntime.recordParseObjectStats( __st, __mt ); }`;
        }
        else
        {
            extraHandling = `for( const k of Object.keys( o ) ){ if( ${keysVar}.has( k ) ){ continue; } let __pm = false; let __pv = o[k]; ${patternBranches} if( __pm ){ ${assignProp( '__pv' )} } else { ${unmatchedCode} } }`;
        }
    }
    else if( indexType || mode === 'strict' || mode === 'relaxed' || ( mode === 'strip' && wireNames.length > 0 ))
    {
        const keysVar = hoisted.length === 0 ? '__keys' : `__keys_${hoisted.length}`;
        hoisted.push( `const ${keysVar} = new Set( ${JSON.stringify( wireNames )} );` );

        if( indexType )
        {
            const idxCode = buildValidation( indexType, checker, mode, from, 'o[k]', '( p ? p + "." + k : k )', rootExpr, scope, visited, hoisted, recDefs, unionResolution, propertyCasing, dynParent );

            if( mode === 'strip' )
            {
                extraHandling = `let __st = 0; let __mt = 0; for( const k of Object.keys( o ) ){ if( o[k] !== undefined ){ __mt++; } if( !${keysVar}.has( k ) ){ const __iv = ${idxCode}; if( k === "__proto__" || k === "constructor" || k === "prototype" ){ Object.defineProperty( res, k, { value: __iv, enumerable: true, configurable: true, writable: true } ); } else { res[k] = __iv; } } } ${probeAdjCode}if( __tcRuntime.hasParseUnionProbe() ){ __tcRuntime.recordParseObjectStats( __st, __mt ); }`;
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

    const preCheckCode = preChecks.length > 0 ? preChecks.join( ' ' ) + ' ' : '';
    const postInitCode = postInitAssignments.length > 0 ? postInitAssignments.join( ' ' ) + ' ' : '';
    const optCode = optionalAssignments.length > 0 ? optionalAssignments.join( ' ' ) + ' ' : '';

    return `( function( o, p ){ o = __tcRuntime.expectObject( o, p ); ${preCheckCode}const res = { ${initialProps.join( ', ' )} }; ${postInitCode}${optCode}${extraHandling} return res; })( ${varName}, ${pathExpr || '""'} )`;
}
