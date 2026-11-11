import ts from 'typescript';
import { ValidationMode, type UnionResolution } from '../runtime/validators.js';
import type { CasingFormat } from '../runtime/casing.js';
import type { BigIntWireFormat } from '../runtime/serializer-runtime.js';
import { resolveClassIdentity, type ICustomFunctionScope } from './customFns.js';
import
{
    assertNotTypeParameter,
    assertValidMapKeyType,
    bigIntLiteralText,
    BUFFER_LIKE,
    buildTemplateLiteralRegex,
    buildWirePropertyMap,
    classifyNullableUnion,
    constraintTagNames,
    enumMemberTypes,
    inspectTupleType,
    isNativeEnumType,
    peelTaggedIntersection,
    safePropAccess,
    stripUndefinedFromUnion,
    TemplateIndexInfo,
    tryMergeObjectTypes,
    tryTaggedUnionTypes,
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

export type SerializationMode = ValidationMode;
export type SerializeFormat = 'json' | 'query';

export interface SerializerGeneratorOptions
{
    mode?            : ValidationMode
    format?          : SerializeFormat
    to?              : SerializeFormat
    hoisted?         : string[]
    unionResolution? : UnionResolution
    propertyCasing?  : CasingFormat
    bigintAs?        : BigIntWireFormat
    scope?           : ICustomFunctionScope
}

interface SerContext
{
    mode            : ValidationMode
    unionResolution : UnionResolution
    propertyCasing? : CasingFormat
    bigintAs        : BigIntWireFormat
    scope           : ICustomFunctionScope
}

type RecSerDef =
    {
        fnName : string
        type   : ts.Type
        ctx    : SerContext
    };

interface ClassCheckInfo
{
    ctorExpr      : string
    expectedLabel : string
}

function resolveClassCheck( type: ts.Type, scope: ICustomFunctionScope ): ClassCheckInfo | undefined
{
    const classIdentity = resolveClassIdentity( type );

    if( !classIdentity ){ return undefined }

    const declaration = classIdentity.declaration;
    const fromAmbientGlobal = declaration !== undefined
        && declaration.getSourceFile().isDeclarationFile
        && !ts.isExternalModule( declaration.getSourceFile());
    const ctorExpr = ( fromAmbientGlobal || !declaration )
        ? `( globalThis[${JSON.stringify( classIdentity.name )}] )`
        : scope.bind( classIdentity );

    return {
        ctorExpr,
        expectedLabel : `Type<${classIdentity.name}>`
    };
}

function buildStringMappingCondition( varExpr: string, mappingName: string | undefined ): string
{
    if( mappingName === 'Uppercase' ){ return `typeof ${varExpr} === "string" && ${varExpr} === ${varExpr}.toUpperCase()` }

    if( mappingName === 'Lowercase' ){ return `typeof ${varExpr} === "string" && ${varExpr} === ${varExpr}.toLowerCase()` }

    if( mappingName === 'Capitalize' )
    {
        return `typeof ${varExpr} === "string" && ( ${varExpr}.length === 0 || ${varExpr}.charAt( 0 ) === ${varExpr}.charAt( 0 ).toUpperCase() )`;
    }

    if( mappingName === 'Uncapitalize' )
    {
        return `typeof ${varExpr} === "string" && ( ${varExpr}.length === 0 || ${varExpr}.charAt( 0 ) === ${varExpr}.charAt( 0 ).toLowerCase() )`;
    }

    return `typeof ${varExpr} === "string"`;
}

function bindTransformed(
    varName  : string,
    pathExpr : string,
    kind     : string,
    tags     : string[],
    body     : ( v: string ) => string
): string
{
    return `( function(){ const __sv = typeof transform !== "undefined" && transform ? __tcRuntime.applySerializeTransform( ${varName}, ${pathExpr}, transform, ${JSON.stringify( kind )}, ${JSON.stringify( tags )}, input ) : ${varName}; return ${body( '__sv' )}; })()`;
}

function bindTransformedStmt(
    varName  : string,
    pathExpr : string,
    kind     : string,
    tags     : string[],
    stmt     : ( v: string ) => string
): string
{
    return `{ const __sv = typeof transform !== "undefined" && transform ? __tcRuntime.applySerializeTransform( ${varName}, ${pathExpr}, transform, ${JSON.stringify( kind )}, ${JSON.stringify( tags )}, input ) : ${varName}; ${stmt( '__sv' )} }`;
}

export function generateSerializerCode(
    type        : ts.Type,
    checker     : ts.TypeChecker,
    options     : SerializerGeneratorOptions = {}
): string
{
    assertNotTypeParameter( type );

    const mode = options.mode || 'strip';
    const format = options.format || options.to || 'json';
    const unionResolution = options.unionResolution || 'specificity';
    const propertyCasing = options.propertyCasing;
    const bigintAs: BigIntWireFormat = options.bigintAs || 'string';
    const scope = options.scope || VERBATIM_CUSTOM_SCOPE;
    const ctx: SerContext = { mode, unionResolution, propertyCasing, bigintAs, scope };
    const hoisted = options.hoisted ?? [];
    const wrapLocal = !options.hoisted;

    if( format === 'query' )
    {
        const recQDefs = new Map<number, RecSerDef>();
        const body = buildQuerySerializer( type, checker, ctx, 'input', '""', new Set(), hoisted, 0, recQDefs );
        const generatedRecQFns = new Set<number>();

        while( generatedRecQFns.size < recQDefs.size )
        {
            for( const [ id, def ] of recQDefs.entries())
            {
                if( generatedRecQFns.has( id )){ continue }

                generatedRecQFns.add( id );
                const recVisited = new Set<number>();
                const recBody = buildQuerySerializer( def.type, checker, def.ctx, 'v', 'p', recVisited, hoisted, 1, recQDefs );
                hoisted.push( `function ${def.fnName}( v, p, transform, input, params ){ ${recBody} }` );
            }
        }

        const prefix = wrapLocal && hoisted.length > 0 ? `${hoisted.join( ' ' )} ` : '';

        return `( function(){ ${prefix}const params = []; ${body} return params.join( "&" ); })()`;
    }

    const recDefs = new Map<number, RecSerDef>();
    const body = buildJsonSerializer( type, checker, ctx, '""', 'input', new Set(), hoisted, 0, recDefs );
    const generatedRecFns = new Set<number>();

    while( generatedRecFns.size < recDefs.size )
    {
        for( const [ id, def ] of recDefs.entries())
        {
            if( generatedRecFns.has( id )){ continue }

            generatedRecFns.add( id );
            const recVisited = new Set<number>();
            const recBody = buildJsonSerializer( def.type, checker, def.ctx, 'p', 'v', recVisited, hoisted, 1, recDefs );
            hoisted.push( `function ${def.fnName}( v, p, transform, input ){ return ${recBody}; }` );
        }
    }

    if( wrapLocal && hoisted.length > 0 )
    {
        return `( function(){ ${hoisted.join( ' ' )} return ${body}; })()`;
    }

    return body;
}

function buildJsonSerializer(
    type     : ts.Type,
    checker  : ts.TypeChecker,
    ctx      : SerContext,
    pathExpr : string,
    varName  : string,
    visited  : Set<number> = new Set(),
    hoisted  : string[] = [],
    depth    : number = 0,
    recDefs  : Map<number, RecSerDef> = new Map()
): string
{
    assertNotTypeParameter( type );

    const { mode, unionResolution } = ctx;
    const typeId = ( type as any ).id;
    const sfx = depth === 0 ? '' : `_${depth}`;

    if( typeof typeId === 'number' )
    {
        if( visited.has( typeId ))
        {
            let def = recDefs.get( typeId );

            if( !def )
            {
                const fnName = `__rec_ser_${typeId}_${hoisted.length}`;
                def = { fnName, type, ctx };
                recDefs.set( typeId, def );
            }

            return `${def.fnName}( ${varName}, ${pathExpr}, typeof transform !== 'undefined' ? transform : undefined, typeof input !== 'undefined' ? input : undefined )`;
        }

        visited.add( typeId );
    }

    try
    {
        // Peel brands/tags — serialize ignores constraints, walks base; tags feed ctx.tags.
        let tags: string[] = [];

        if( typeof type.isIntersection === 'function' && type.isIntersection())
        {
            const origIntersection = type;
            const peeled = peelTaggedIntersection( type, checker, ctx.scope );

            if( peeled )
            {
                tags = constraintTagNames( peeled.constraints );
                type = peeled.base;
            }

            if( typeof type.isIntersection === 'function' && type.isIntersection())
            {
                const merged = tryMergeObjectTypes( type.types, checker, type === origIntersection ? origIntersection : type );

                if( merged )
                {
                    return buildObjectSerializer( merged.props, merged.indexType, merged.patternIndexInfos, checker, ctx, pathExpr, varName, visited, tags, hoisted, depth, recDefs );
                }
            }
        }

        const flags = typeof type.getFlags === 'function' ? type.getFlags() : ts.TypeFlags.Any;
        const pathLiteral = pathExpr;

        if( flags & ts.TypeFlags.Never )
        {
            return `( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, "Type<never>" ); })()`;
        }

        // Match validators.any / parse passthrough — emit JSON for whatever value is there.
        if( flags & ts.TypeFlags.Any || flags & ts.TypeFlags.Unknown )
        {
            return bindTransformed( varName, pathLiteral, 'Object', tags, v => `__tcRuntime.serializeAny( ${v}, ${pathLiteral} )` );
        }

        if( flags & ts.TypeFlags.NonPrimitive )
        {
            return bindTransformed( varName, pathLiteral, 'Object', tags, v =>
                `( function( obj ){ __tcRuntime.checkPlainObject( obj, ${pathLiteral} ); return __tcRuntime.serializeAny( obj, ${pathLiteral} ); })( ${v} )`
            );
        }

        if( typeof type.isStringLiteral === 'function' && type.isStringLiteral())
        {
            const strType = type as ts.StringLiteralType;
            const expected = JSON.stringify( strType.value );
            const litCode = `Literal<'${String( strType.value ).replace( /\\/g, '\\\\' ).replace( /'/g, "\\'" )}'>`;

            return bindTransformed( varName, pathLiteral, 'literal', tags, v =>
                `( ${v} === ${expected} ? ${JSON.stringify( JSON.stringify( strType.value ))} : ( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, ${JSON.stringify( litCode )} ); })() )`
            );
        }

        if( typeof type.isNumberLiteral === 'function' && type.isNumberLiteral())
        {
            const numType = type as ts.NumberLiteralType;
            const litCode = `Literal<${numType.value}>`;

            return bindTransformed( varName, pathLiteral, 'literal', tags, v =>
                `( ${v} === ${numType.value} ? ${JSON.stringify( String( numType.value ))} : ( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, ${JSON.stringify( litCode )} ); })() )`
            );
        }

        if( flags & ts.TypeFlags.BooleanLiteral )
        {
            const expected = ( type as any ).intrinsicName === 'true';
            const litCode = `Literal<${expected}>`;

            return bindTransformed( varName, pathLiteral, 'literal', tags, v =>
                `( ${v} === ${expected} ? ${JSON.stringify( String( expected ))} : ( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, ${JSON.stringify( litCode )} ); })() )`
            );
        }

        if( flags & ts.TypeFlags.BigIntLiteral )
        {
            const lit = bigIntLiteralText( type );
            const litCode = `Literal<${lit}n>`;
            const serializedLit = ctx.bigintAs === 'number'
                ? JSON.stringify( lit )
                : JSON.stringify( JSON.stringify( lit ));

            return bindTransformed( varName, pathLiteral, 'literal', tags, v =>
                `( ${v} === ${lit}n ? ${serializedLit} : ( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, ${JSON.stringify( litCode )} ); })() )`
            );
        }

        if( flags & ts.TypeFlags.TemplateLiteral )
        {
            const regexStr = buildTemplateLiteralRegex( type as ts.TemplateLiteralType );
            const expected = `Type<${checker.typeToString( type )}>`;
            const reVar = `__re_${hoisted.length}`;
            hoisted.push( `const ${reVar} = __tcRuntime.getCachedPattern( ${JSON.stringify( regexStr )} );` );

            return bindTransformed( varName, pathLiteral, 'string', tags, v =>
                `( typeof ${v} === "string" && ${reVar} && __tcRuntime.testRegex( ${reVar}, ${v} ) ? __tcRuntime.serializeString( ${v}, ${pathLiteral} ) : ( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, ${JSON.stringify( expected )} ); })() )`
            );
        }

        if( flags & ts.TypeFlags.StringMapping )
        {
            const mappingName = typeSymbolName( type );
            const expected = `Type<${checker.typeToString( type )}>`;

            return bindTransformed( varName, pathLiteral, 'string', tags, v =>
                `( ${buildStringMappingCondition( v, mappingName )} ? __tcRuntime.serializeString( ${v}, ${pathLiteral} ) : ( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, ${JSON.stringify( expected )} ); })() )`
            );
        }

        if( flags & ts.TypeFlags.String )
        {
            return bindTransformed( varName, pathLiteral, 'string', tags, v => `__tcRuntime.serializeString( ${v}, ${pathLiteral} )` );
        }

        if( flags & ts.TypeFlags.Number )
        {
            return bindTransformed( varName, pathLiteral, 'number', tags, v =>
                `( typeof ${v} === 'number' && Number.isFinite( ${v} ) ? String( ${v} ) : ( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, "Type<number>" ); })() )`
            );
        }

        if( flags & ts.TypeFlags.Boolean )
        {
            return bindTransformed( varName, pathLiteral, 'boolean', tags, v =>
                `( typeof ${v} === 'boolean' ? ( ${v} ? 'true' : 'false' ) : ( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, "Type<boolean>" ); })() )`
            );
        }

        if( flags & ts.TypeFlags.BigInt )
        {
            const emitExpr = ( v: string ): string => ctx.bigintAs === 'number'
                ? `String( ${v} )`
                : `'"' + String( ${v} ) + '"'`;

            return bindTransformed( varName, pathLiteral, 'bigint', tags, v =>
                `( typeof ${v} === 'bigint' ? ${emitExpr( v )} : ( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, "Type<bigint>" ); })() )`
            );
        }

        if( flags & ( ts.TypeFlags.Undefined | ts.TypeFlags.Void ))
        {
            return `( ${varName} === undefined ? 'null' : ( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, "Type<undefined>" ); })() )`;
        }

        if( flags & ts.TypeFlags.Null )
        {
            return `( ${varName} === null ? 'null' : ( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, "Type<null>" ); })() )`;
        }

        if( isNativeEnumType( type ))
        {
            const members = enumMemberTypes( type, checker );

            if( members.length > 0 )
            {
                return buildJsonSerializer(
                    { isUnion : () => true, types : members, getFlags : () => ts.TypeFlags.Union } as any,
                    checker,
                    ctx,
                    pathExpr,
                    varName,
                    visited,
                    hoisted,
                    depth,
                    recDefs
                );
            }

            return bindTransformed( varName, pathLiteral, 'number', tags, v =>
                `( typeof ${v} === 'number' && Number.isFinite( ${v} ) ? String( ${v} ) : ( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, "Type<number>" ); })() )`
            );
        }

        const symbolName = typeSymbolName( type );

        if( symbolName === 'Date' )
        {
            return bindTransformed( varName, pathLiteral, 'Date', tags, v => `__tcRuntime.serializeDate( ${v}, ${pathLiteral} )` );
        }

        if( symbolName === 'URL' )
        {
            return bindTransformed( varName, pathLiteral, 'URL', tags, v => `__tcRuntime.serializeUrl( ${v}, ${pathLiteral} )` );
        }

        if( symbolName === 'RegExp' )
        {
            return bindTransformed( varName, pathLiteral, 'RegExp', tags, v => `__tcRuntime.serializeRegExp( ${v}, ${pathLiteral} )` );
        }

        if( symbolName === 'File' || symbolName === 'Blob' )
        {
            return bindTransformed( varName, pathLiteral, 'instance', tags, v =>
                `( ( ${varName} instanceof ${symbolName} ) && ${v} !== ${varName} ? JSON.stringify( ${v} ) : ( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, ${JSON.stringify( `Type<${symbolName}>` )} ); })() )`
            );
        }

        if( symbolName && BUFFER_LIKE.has( symbolName ))
        {
            return bindTransformed( varName, pathLiteral, 'instance', tags, v => `__tcRuntime.serializeBuffer( ${v}, ${pathLiteral} )` );
        }

        if( typeof checker.isTupleType === 'function' && checker.isTupleType( type ))
        {
            const { typeArgs, elementFlags, hasRest, hasOptional, fixedCount, minItems, restType, suffixTypes } = inspectTupleType( type, checker );

            if( !hasRest && !hasOptional )
            {
                const slotVars = typeArgs.map(( _: ts.Type, i: number ) => `__t${sfx}_${i}` );
                const slotInits = typeArgs.map(( elem: ts.Type, i: number ) => 
                {
                    const childPath = pathExpr === '""' ? `"[" + ${i} + "]"` : `(${pathExpr}) + "[" + ${i} + "]"`;

                    return `const ${slotVars[i]} = ${buildJsonSerializer( elem, checker, ctx, childPath, `${varName}[${i}]`, visited, hoisted, depth + 1, recDefs )};`;
                }).join( ' ' );
                const joined = slotVars.length > 0 ? slotVars.join( ' + "," + ' ) : '""';

                return `( function(){ if( !Array.isArray( ${varName} ) || ${varName}.length !== ${typeArgs.length} ){ throw new __tcRuntime.SerializationError( ${pathLiteral}, "Tuple<${typeArgs.length}>" ); } ${slotInits} return "[" + ${joined} + "]"; })()`;
            }

            if( hasRest && restType )
            {
                const suffixLen = suffixTypes.length;
                const restEndVar = `__tre${sfx}`;
                const effPrefixEndVar = `__tpe${sfx}`;
                const minPrefix = minItems - suffixLen;
                const fixedStmts: string[] = [];

                for( let i = 0; i < fixedCount; i++ )
                {
                    const isOpt = ( elementFlags[i] & ts.ElementFlags.Optional ) !== 0;
                    const elemType = isOpt ? stripUndefinedFromUnion( typeArgs[i]) : typeArgs[i];
                    const childPath = pathExpr === '""' ? `"[" + ${i} + "]"` : `(${pathExpr}) + "[" + ${i} + "]"`;
                    const elemSer = buildJsonSerializer( elemType, checker, ctx, childPath, `${varName}[${i}]`, visited, hoisted, depth + 1, recDefs );

                    if( isOpt )
                    {
                        fixedStmts.push( `if( ${effPrefixEndVar} > ${i} ){ __tp.push( ${varName}[${i}] === undefined ? "null" : ${elemSer} ); }` );
                    }
                    else
                    {
                        fixedStmts.push( `__tp.push( ${elemSer} );` );
                    }
                }

                const idxVar = `__ti${sfx}`;
                const restPath = pathExpr === '""' ? `"[" + ${idxVar} + "]"` : `(${pathExpr}) + "[" + ${idxVar} + "]"`;
                const restSer = buildJsonSerializer( restType, checker, ctx, restPath, `${varName}[${idxVar}]`, visited, hoisted, depth + 1, recDefs );
                const suffixStmts = suffixTypes.map(( sType, j ) =>
                {
                    const sIdxVar = `__tsi${sfx}_${j}`;
                    const sPath = pathExpr === '""' ? `"[" + ${sIdxVar} + "]"` : `(${pathExpr}) + "[" + ${sIdxVar} + "]"`;
                    const sSer = buildJsonSerializer( sType, checker, ctx, sPath, `${varName}[${sIdxVar}]`, visited, hoisted, depth + 1, recDefs );

                    return `{ const ${sIdxVar} = ${restEndVar} + ${j}; __tp.push( ${sSer} ); }`;
                }).join( ' ' );
                const trimCode = hasOptional
                    ? `let ${effPrefixEndVar} = Math.min( ${restEndVar}, ${fixedCount} ); if( ${restEndVar} <= ${fixedCount} && ${suffixLen} === 0 ){ while( ${effPrefixEndVar} > ${minPrefix} && ${varName}[${effPrefixEndVar} - 1] === undefined ){ ${effPrefixEndVar}--; } }`
                    : `const ${effPrefixEndVar} = Math.min( ${restEndVar}, ${fixedCount} );`;

                return `( function(){ if( !Array.isArray( ${varName} ) || ${varName}.length < ${minItems} ){ throw new __tcRuntime.SerializationError( ${pathLiteral}, "Tuple<${minItems}+>" ); } const ${restEndVar} = ${varName}.length - ${suffixLen}; ${trimCode} const __tp = []; ${fixedStmts.join( ' ' )} for( let ${idxVar} = ${fixedCount}; ${idxVar} < ${restEndVar}; ${idxVar}++ ){ __tp.push( ${restSer} ); } ${suffixStmts} return "[" + __tp.join( "," ) + "]"; })()`;
            }

            const endVar = `__tend${sfx}`;
            const fixedStmts: string[] = [];

            for( let i = 0; i < fixedCount; i++ )
            {
                const isOpt = ( elementFlags[i] & ts.ElementFlags.Optional ) !== 0;
                const elemType = isOpt ? stripUndefinedFromUnion( typeArgs[i]) : typeArgs[i];
                const childPath = pathExpr === '""' ? `"[" + ${i} + "]"` : `(${pathExpr}) + "[" + ${i} + "]"`;
                const elemSer = buildJsonSerializer( elemType, checker, ctx, childPath, `${varName}[${i}]`, visited, hoisted, depth + 1, recDefs );

                if( isOpt )
                {
                    fixedStmts.push( `if( ${endVar} > ${i} ){ __tp.push( ${varName}[${i}] === undefined ? "null" : ${elemSer} ); }` );
                }
                else
                {
                    fixedStmts.push( `__tp.push( ${elemSer} );` );
                }
            }

            return `( function(){ if( !Array.isArray( ${varName} ) || ${varName}.length < ${minItems} || ${varName}.length > ${fixedCount} ){ throw new __tcRuntime.SerializationError( ${pathLiteral}, "Tuple<${minItems}..${fixedCount}>" ); } let ${endVar} = ${varName}.length; while( ${endVar} > ${minItems} && ${varName}[${endVar} - 1] === undefined ){ ${endVar}--; } const __tp = []; ${fixedStmts.join( ' ' )} return "[" + __tp.join( "," ) + "]"; })()`;
        }

        if( typeof checker.isArrayType === 'function' && checker.isArrayType( type ))
        {
            const typeArgs = typeof checker.getTypeArguments === 'function' ? checker.getTypeArguments( type as ts.TypeReference ) : [];
            const elemType = typeArgs[0] || ({ getFlags : () => ts.TypeFlags.Any } as any );
            const itemVar = `item${sfx}`;
            const idxVar = `i${sfx}`;
            const elemPath = pathExpr === '""' ? `"[" + ${idxVar} + "]"` : `(${pathExpr}) + "[" + ${idxVar} + "]"`;
            const elemSer = buildJsonSerializer( elemType, checker, ctx, elemPath, itemVar, visited, hoisted, depth + 1, recDefs );

            return `__tcRuntime.serializeArray( ${varName}, ( ${itemVar}, ${idxVar} ) => ${elemSer}, ${pathLiteral} )`;
        }

        if( symbolName === 'Set' || symbolName === 'ReadonlySet' )
        {
            const typeArgs = typeof checker.getTypeArguments === 'function'
                ? checker.getTypeArguments( type as ts.TypeReference )
                : ( type as ts.TypeReference ).typeArguments || [];
            const elemType = typeArgs[0] || ({ getFlags : () => ts.TypeFlags.Any } as any );
            const itemVar = `item${sfx}`;
            const idxVar = `i${sfx}`;
            const elemPath = pathExpr === '""' ? `"[" + ${idxVar} + "]"` : `(${pathExpr}) + "[" + ${idxVar} + "]"`;
            const elemSer = buildJsonSerializer( elemType, checker, ctx, elemPath, itemVar, visited, hoisted, depth + 1, recDefs );

            return bindTransformed( varName, pathLiteral, 'Set', tags, v =>
                `__tcRuntime.serializeSet( ${v}, ( ${itemVar}, ${idxVar} ) => ${elemSer}, ${pathLiteral} )`
            );
        }

        if( symbolName === 'Map' || symbolName === 'ReadonlyMap' )
        {
            const typeArgs = typeof checker.getTypeArguments === 'function'
                ? checker.getTypeArguments( type as ts.TypeReference )
                : ( type as ts.TypeReference ).typeArguments || [];
            const keyType = typeArgs[0] || ({ getFlags : () => ts.TypeFlags.Any } as any );
            const valueType = typeArgs[1] || ({ getFlags : () => ts.TypeFlags.Any } as any );
            assertValidMapKeyType( keyType, checker );
            const kVar = `k${sfx}`;
            const vVar = `v${sfx}`;
            const keyPath = pathExpr === '""' ? `".key(" + String( ${kVar} ) + ")"` : `(${pathExpr}) + ".key(" + String( ${kVar} ) + ")"`;
            const valPath = pathExpr === '""' ? `"[" + String( ${kVar} ) + "]"` : `(${pathExpr}) + "[" + String( ${kVar} ) + "]"`;
            const keyCtx: SerContext = { ...ctx, bigintAs : 'number' };
            const keySer = buildJsonSerializer( keyType, checker, keyCtx, keyPath, kVar, visited, hoisted, depth + 1, recDefs );
            const valSer = buildJsonSerializer( valueType, checker, ctx, valPath, vVar, visited, hoisted, depth + 1, recDefs );

            return bindTransformed( varName, pathLiteral, 'Map', tags, mv =>
                `__tcRuntime.serializeMap( ${mv}, ( ${kVar}, ${vVar} ) => [ ${keySer}, ${valSer} ], ${pathLiteral} )`
            );
        }

        if( typeof type.isUnion === 'function' && type.isUnion())
        {
            const { hasUndefined, hasNull, nonNullish } = classifyNullableUnion( type.types );

            if( nonNullish.length === 1 && ( hasUndefined || hasNull ))
            {
                const innerVar = `__nu${sfx}`;
                const inner = buildJsonSerializer( nonNullish[0], checker, ctx, pathExpr, innerVar, visited, hoisted, depth + 1, recDefs );

                if( hasUndefined && hasNull )
                {
                    return `( function( ${innerVar} ){ if( ${innerVar} === undefined || ${innerVar} === null ){ return 'null'; } return ${inner}; })( ${varName} )`;
                }

                if( hasUndefined )
                {
                    return `( function( ${innerVar} ){ if( ${innerVar} === undefined ){ return 'null'; } return ${inner}; })( ${varName} )`;
                }

                return `( function( ${innerVar} ){ if( ${innerVar} === null ){ return 'null'; } return ${inner}; })( ${varName} )`;
            }

            const label = unionExpectedLabel( type, checker );
            const tagged = tryTaggedUnionTypes( type.types, checker );

            if( tagged )
            {
                const cases = tagged.arms.map( arm =>
                    `case ${JSON.stringify( arm.tag )}: return ${buildJsonSerializer( arm.type, checker, ctx, pathExpr, varName, visited, hoisted, depth + 1, recDefs )};`
                ).join( ' ' );
                const discExpr = `( val && typeof val === "object" && Object.hasOwn( val, ${JSON.stringify( tagged.key )} ) ? val[${JSON.stringify( tagged.key )}] : undefined )`;

                return `( function( val ){ switch( ${discExpr} ){ ${cases} default: throw new __tcRuntime.SerializationError( ${pathLiteral}, ${JSON.stringify( label )} ); } })( ${varName} )`;
            }

            const sortedTypes = unionResolution === 'declaration-order'
                ? type.types.slice()
                : sortUnionArmsBySpecificity( type.types, checker );
            const valVar = `val${sfx}`;
            const armFns = sortedTypes.map( arm =>
                `( ${valVar} ) => ${buildJsonSerializer( arm, checker, ctx, pathExpr, valVar, visited, hoisted, depth + 1, recDefs )}`
            ).join( ', ' );
            const probeBestFit = mode === 'strip' && unionResolution !== 'declaration-order' && hasCompetingObjectArms( sortedTypes, checker );
            const exclusiveKeys = tryExclusiveKeyUnion( sortedTypes, checker );

            if( probeBestFit )
            {
                const fallbackFlags = sortedTypes.map( arm => isFallbackUnionArm( arm, checker ));
                const hasFallbacks = fallbackFlags.some( Boolean );
                const flagsArg = hasFallbacks
                    ? `, ${JSON.stringify( fallbackFlags )}`
                    : ( exclusiveKeys ? ', undefined' : '' );
                const keysArg = exclusiveKeys ? `, ${JSON.stringify( exclusiveKeys )}` : '';

                return `__tcRuntime.serializeUnion( ${varName}, ${pathLiteral}, ${JSON.stringify( label )}, [ ${armFns} ], true${flagsArg}${keysArg} )`;
            }

            if( exclusiveKeys )
            {
                return `__tcRuntime.serializeUnion( ${varName}, ${pathLiteral}, ${JSON.stringify( label )}, [ ${armFns} ], false, undefined, ${JSON.stringify( exclusiveKeys )} )`;
            }

            return `__tcRuntime.serializeUnion( ${varName}, ${pathLiteral}, ${JSON.stringify( label )}, [ ${armFns} ] )`;
        }

        const classCheck = resolveClassCheck( type, ctx.scope );
        const ir = resolveTypeIr( type, checker );

        if( ir.kind === 'function' || ir.kind === 'promise' || ir.kind === 'symbol' )
        {
            const expected = `Type<${ir.symbolName || ir.kind}>`;

            return `( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, ${JSON.stringify( expected )} ); })()`;
        }

        const indexType = ir.getStringIndexType();
        const props = ir.getProps();
        const patternInfos = ir.getTemplateIndexInfos();

        return buildObjectSerializer( props, indexType, patternInfos, checker, ctx, pathExpr, varName, visited, tags, hoisted, depth, recDefs, classCheck );
    }
    finally
    {
        if( typeof typeId === 'number' ){ visited.delete( typeId ) }
    }
}

function buildObjectSerializer(
    props             : { name : string, type : ts.Type, isOptional : boolean, isWriteOnly? : boolean, isSecret? : boolean }[],
    indexType         : ts.Type | undefined,
    patternIndexInfos : TemplateIndexInfo[] | undefined,
    checker           : ts.TypeChecker,
    ctx               : SerContext,
    pathExpr          : string,
    varName           : string,
    visited           : Set<number> = new Set(),
    tags              : string[] = [],
    hoisted           : string[] = [],
    depth             : number = 0,
    recDefs           : Map<number, RecSerDef> = new Map(),
    classCheck?       : ClassCheckInfo
): string
{
    const { mode, propertyCasing } = ctx;
    const pathLiteral = pathExpr;
    const kVar = depth === 0 ? 'k' : `k_${depth}`;
    const declaredPropNames = props.map( p => p.name );
    const wireMap = buildWirePropertyMap( declaredPropNames, propertyCasing );
    const statements: string[] = [];

    if( classCheck )
    {
        statements.push( `if( !( obj instanceof ${classCheck.ctorExpr} ) ){ throw new __tcRuntime.SerializationError( ${pathLiteral}, ${JSON.stringify( classCheck.expectedLabel )} ); }` );
    }
    else
    {
        statements.push( `if( !__tcRuntime.isPlainObject( obj ) ){ throw new __tcRuntime.SerializationError( ${pathLiteral}, "Type<Object>" ); }` );
    }

    statements.push( 'let parts = [];' );

    let keysVar = '__keys';
    const hasPatterns = Boolean( patternIndexInfos && patternIndexInfos.length > 0 );

    if( hasPatterns || indexType || mode === 'strict' || mode === 'relaxed' || ( mode === 'strip' && props.length > 0 ))
    {
        keysVar = hoisted.length === 0 ? '__keys' : `__keys_${hoisted.length}`;
        hoisted.push( `const ${keysVar} = new Set( ${JSON.stringify( declaredPropNames )} );` );
    }

    for( const prop of props )
    {
        if( prop.isWriteOnly || prop.isSecret ){ continue }

        const wireName = wireMap.get( prop.name )!;
        const rawAccess = safePropAccess( 'obj', prop.name );
        const valAccess = `( Object.hasOwn( obj, ${JSON.stringify( prop.name )} ) ? ${rawAccess} : undefined )`;
        const childPath = pathExpr === '""'
            ? JSON.stringify( prop.name )
            : `(${pathExpr}) + "." + ${JSON.stringify( prop.name )}`;
        const effectiveType = prop.isOptional ? stripUndefinedFromUnion( prop.type ) : prop.type;
        const propSer = buildJsonSerializer( effectiveType, checker, ctx, childPath, valAccess, visited, hoisted, depth + 1, recDefs );

        if( prop.isOptional )
        {
            statements.push( `if( ${valAccess} !== undefined ){ parts.push( ${JSON.stringify( JSON.stringify( wireName ) + ':' )} + ${propSer} ); }` );
        }
        else
        {
            statements.push( `parts.push( ${JSON.stringify( JSON.stringify( wireName ) + ':' )} + ${propSer} );` );
        }
    }

    if( hasPatterns )
    {
        const idxPath = pathExpr === '""' ? kVar : `(${pathExpr}) + "[" + ${kVar} + "]"`;
        const patternBranches = patternIndexInfos!.map( pInfo =>
        {
            const reVar = `__re_${hoisted.length}`;
            hoisted.push( `const ${reVar} = __tcRuntime.getCachedPattern( ${JSON.stringify( pInfo.pattern )} );` );
            const patSer = buildJsonSerializer( pInfo.valueType, checker, ctx, idxPath, `obj[${kVar}]`, visited, hoisted, depth + 1, recDefs );

            return `if( ${reVar} && __tcRuntime.testRegex( ${reVar}, ${kVar} ) ){ __pm = true; __ps = ${patSer}; }`;
        }).join( ' ' );

        let unmatchedCode = '';

        if( indexType )
        {
            const idxSer = buildJsonSerializer( indexType, checker, ctx, idxPath, `obj[${kVar}]`, visited, hoisted, depth + 1, recDefs );
            unmatchedCode = `${ mode === 'strip' ? '__mt++; ' : ''}parts.push( JSON.stringify( ${kVar} ) + ":" + ${idxSer} );`;
        }
        else if( mode === 'strict' )
        {
            unmatchedCode = `throw new __tcRuntime.SerializationError( ${pathLiteral}, "PropertyNotAllowed<" + ${kVar} + ">" );`;
        }
        else if( mode === 'relaxed' )
        {
            unmatchedCode = `parts.push( JSON.stringify( ${kVar} ) + ":" + JSON.stringify( obj[${kVar}] ) );`;
        }
        else if( mode === 'strip' )
        {
            unmatchedCode = '__st++;';
        }

        if( mode === 'strip' )
        {
            statements.push( `let __st = 0; let __mt = 0; for( const ${kVar} of Object.keys( obj ) ){ if( obj[${kVar}] === undefined ){ continue; } if( ${keysVar}.has( ${kVar} ) ){ __mt++; continue; } let __pm = false; let __ps = ""; ${patternBranches} if( __pm ){ __mt++; parts.push( JSON.stringify( ${kVar} ) + ":" + __ps ); } else { ${unmatchedCode} } } if( __tcRuntime.hasSerializerUnionProbe() ){ __tcRuntime.recordSerializerObjectStats( __st, __mt ); }` );
        }
        else
        {
            statements.push( `for( const ${kVar} of Object.keys( obj ) ){ if( obj[${kVar}] === undefined || ${keysVar}.has( ${kVar} ) ){ continue; } let __pm = false; let __ps = ""; ${patternBranches} if( __pm ){ parts.push( JSON.stringify( ${kVar} ) + ":" + __ps ); } else { ${unmatchedCode} } }` );
        }
    }
    else if( indexType )
    {
        const idxPath = pathExpr === '""' ? kVar : `(${pathExpr}) + "[" + ${kVar} + "]"`;
        const idxSer = buildJsonSerializer( indexType, checker, ctx, idxPath, `obj[${kVar}]`, visited, hoisted, depth + 1, recDefs );

        if( mode === 'strip' )
        {
            statements.push( `let __mt = 0; for( const ${kVar} of Object.keys( obj ) ){ if( obj[${kVar}] !== undefined ){ __mt++; if( !${keysVar}.has( ${kVar} ) ){ parts.push( JSON.stringify( ${kVar} ) + ":" + ${idxSer} ); } } } if( __tcRuntime.hasSerializerUnionProbe() ){ __tcRuntime.recordSerializerObjectStats( 0, __mt ); }` );
        }
        else
        {
            statements.push( `for( const ${kVar} of Object.keys( obj ) ){ if( !${keysVar}.has( ${kVar} ) && obj[${kVar}] !== undefined ){ parts.push( JSON.stringify( ${kVar} ) + ":" + ${idxSer} ); } }` );
        }
    }
    else if( mode === 'strict' )
    {
        statements.push( `for( const ${kVar} of Object.keys( obj ) ){ if( !${keysVar}.has( ${kVar} ) && obj[${kVar}] !== undefined ){ throw new __tcRuntime.SerializationError( ${pathLiteral}, "PropertyNotAllowed<" + ${kVar} + ">" ); } }` );
    }
    else if( mode === 'relaxed' )
    {
        statements.push( `for( const ${kVar} of Object.keys( obj ) ){ if( !${keysVar}.has( ${kVar} ) && obj[${kVar}] !== undefined ){ parts.push( JSON.stringify( ${kVar} ) + ":" + JSON.stringify( obj[${kVar}] ) ); } }` );
    }
    else if( mode === 'strip' )
    {
        if( props.length > 0 )
        {
            statements.push( `if( __tcRuntime.hasSerializerUnionProbe() ){ let __st = 0; let __mt = 0; for( const ${kVar} of Object.keys( obj ) ){ if( obj[${kVar}] !== undefined ){ if( ${keysVar}.has( ${kVar} ) ){ __mt++; } else { __st++; } } } __tcRuntime.recordSerializerObjectStats( __st, __mt ); }` );
        }
        else
        {
            statements.push( `if( __tcRuntime.hasSerializerUnionProbe() ){ let __st = 0; for( const ${kVar} of Object.keys( obj ) ){ if( obj[${kVar}] !== undefined ){ __st++; } } __tcRuntime.recordSerializerObjectStats( __st, 0 ); }` );
        }
    }

    statements.push( 'return \'{\' + parts.join( \',\' ) + \'}\';' );
    const body = ( v: string ) => `( function( obj ){ ${statements.join( ' ' )} })( ${v} )`;
    const kindLabel = classCheck ? 'instance' : 'Object';

    return tags.length > 0 ? bindTransformed( varName, pathLiteral, kindLabel, tags, body ) : body( varName );
}

function leafQueryEncode( expr: string ): string
{
    return `encodeURIComponent( ${expr} == null ? "" : ( ${expr} instanceof Date ? ${expr}.toISOString() : ( ${expr} instanceof URL ? ${expr}.href : ( typeof ${expr} === "bigint" ? String( ${expr} ) : String( ${expr} ) ) ) ) )`;
}

function buildQuerySerializer(
    type       : ts.Type,
    checker    : ts.TypeChecker,
    ctx        : SerContext,
    varName    : string,
    prefixExpr : string,
    visited    : Set<number> = new Set(),
    hoisted    : string[] = [],
    depth      : number = 0,
    recDefs    : Map<number, RecSerDef> = new Map()
): string
{
    assertNotTypeParameter( type );

    const { mode, unionResolution } = ctx;
    const typeId = ( type as any ).id;
    const sfx = depth === 0 ? '' : `_${depth}`;

    if( typeof typeId === 'number' )
    {
        if( visited.has( typeId ))
        {
            let def = recDefs.get( typeId );

            if( !def )
            {
                const fnName = `__rec_qser_${typeId}_${hoisted.length}`;
                def = { fnName, type, ctx };
                recDefs.set( typeId, def );
            }

            return `${def.fnName}( ${varName}, ${prefixExpr}, typeof transform !== 'undefined' ? transform : undefined, typeof input !== 'undefined' ? input : undefined, params );`;
        }

        visited.add( typeId );
    }

    try
    {
        let tags: string[] = [];

        if( typeof type.isIntersection === 'function' && type.isIntersection())
        {
            const origIntersection = type;
            const peeled = peelTaggedIntersection( type, checker, ctx.scope );

            if( peeled )
            {
                tags = constraintTagNames( peeled.constraints );
                type = peeled.base;
            }

            if( typeof type.isIntersection === 'function' && type.isIntersection())
            {
                const merged = tryMergeObjectTypes( type.types, checker, type === origIntersection ? origIntersection : type );

                if( merged )
                {
                    return buildQueryObject( merged.props, merged.indexType, merged.patternIndexInfos, checker, ctx, varName, prefixExpr, visited, tags, hoisted, depth, recDefs );
                }
            }
        }

        const flags = typeof type.getFlags === 'function' ? type.getFlags() : ts.TypeFlags.Any;

        if( flags & ts.TypeFlags.Never )
        {
            return `throw new __tcRuntime.SerializationError( ${prefixExpr}, "Type<never>" );`;
        }

        if( flags & ts.TypeFlags.Any || flags & ts.TypeFlags.Unknown )
        {
            return bindTransformedStmt( varName, prefixExpr, 'Object', tags, v => `__tcRuntime.appendQueryAny( params, ${v}, ${prefixExpr} );` );
        }

        if( flags & ts.TypeFlags.NonPrimitive )
        {
            return bindTransformedStmt( varName, prefixExpr, 'Object', tags, v =>
                `__tcRuntime.checkPlainObject( ${v}, ${prefixExpr} ); __tcRuntime.appendQueryAny( params, ${v}, ${prefixExpr} );`
            );
        }

        if( flags & ( ts.TypeFlags.Undefined | ts.TypeFlags.Void ))
        {
            return `if( ${varName} !== undefined ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Type<undefined>" ); }`;
        }

        if( flags & ts.TypeFlags.Null )
        {
            return `if( ${varName} !== null ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Type<null>" ); } params.push( encodeURIComponent( ${prefixExpr} ) + "=" );`;
        }

        if( typeof type.isStringLiteral === 'function' && type.isStringLiteral())
        {
            const strType = type as ts.StringLiteralType;
            const expected = JSON.stringify( strType.value );
            const litCode = `Literal<'${String( strType.value ).replace( /\\/g, '\\\\' ).replace( /'/g, "\\'" )}'>`;

            return bindTransformedStmt( varName, prefixExpr, 'literal', tags, v =>
                `if( ${v} !== ${expected} ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, ${JSON.stringify( litCode )} ); } params.push( encodeURIComponent( ${prefixExpr} ) + "=" + encodeURIComponent( ${v} ) );`
            );
        }

        if( typeof type.isNumberLiteral === 'function' && type.isNumberLiteral())
        {
            const numType = type as ts.NumberLiteralType;
            const litCode = `Literal<${numType.value}>`;

            return bindTransformedStmt( varName, prefixExpr, 'literal', tags, v =>
                `if( ${v} !== ${numType.value} ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, ${JSON.stringify( litCode )} ); } params.push( encodeURIComponent( ${prefixExpr} ) + "=" + encodeURIComponent( String( ${v} ) ) );`
            );
        }

        if( flags & ts.TypeFlags.BooleanLiteral )
        {
            const expected = ( type as any ).intrinsicName === 'true';
            const litCode = `Literal<${expected}>`;

            return bindTransformedStmt( varName, prefixExpr, 'literal', tags, v =>
                `if( ${v} !== ${expected} ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, ${JSON.stringify( litCode )} ); } params.push( encodeURIComponent( ${prefixExpr} ) + "=" + ( ${v} ? "true" : "false" ) );`
            );
        }

        if( flags & ts.TypeFlags.BigIntLiteral )
        {
            const lit = bigIntLiteralText( type );
            const litCode = `Literal<${lit}n>`;

            return bindTransformedStmt( varName, prefixExpr, 'literal', tags, v =>
                `if( ${v} !== ${lit}n ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, ${JSON.stringify( litCode )} ); } params.push( encodeURIComponent( ${prefixExpr} ) + "=" + encodeURIComponent( ${JSON.stringify( lit )} ) );`
            );
        }

        if( flags & ts.TypeFlags.TemplateLiteral )
        {
            const regexStr = buildTemplateLiteralRegex( type as ts.TemplateLiteralType );
            const expected = `Type<${checker.typeToString( type )}>`;
            const reVar = `__re_${hoisted.length}`;
            hoisted.push( `const ${reVar} = __tcRuntime.getCachedPattern( ${JSON.stringify( regexStr )} );` );

            return bindTransformedStmt( varName, prefixExpr, 'string', tags, v =>
                `if( typeof ${v} !== "string" || !${reVar} || !__tcRuntime.testRegex( ${reVar}, ${v} ) ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, ${JSON.stringify( expected )} ); } params.push( encodeURIComponent( ${prefixExpr} ) + "=" + encodeURIComponent( ${v} ) );`
            );
        }

        if( flags & ts.TypeFlags.StringMapping )
        {
            const mappingName = typeSymbolName( type );
            const expected = `Type<${checker.typeToString( type )}>`;

            return bindTransformedStmt( varName, prefixExpr, 'string', tags, v =>
                `if( !( ${buildStringMappingCondition( v, mappingName )} ) ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, ${JSON.stringify( expected )} ); } params.push( encodeURIComponent( ${prefixExpr} ) + "=" + encodeURIComponent( ${v} ) );`
            );
        }

        if( flags & ts.TypeFlags.String )
        {
            return bindTransformedStmt( varName, prefixExpr, 'string', tags, v =>
                `if( typeof ${v} !== "string" ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Type<string>" ); } params.push( encodeURIComponent( ${prefixExpr} ) + "=" + encodeURIComponent( ${v} ) );`
            );
        }

        if( flags & ts.TypeFlags.Number )
        {
            return bindTransformedStmt( varName, prefixExpr, 'number', tags, v =>
                `if( typeof ${v} !== "number" || !Number.isFinite( ${v} ) ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Type<number>" ); } params.push( encodeURIComponent( ${prefixExpr} ) + "=" + encodeURIComponent( String( ${v} ) ) );`
            );
        }

        if( flags & ts.TypeFlags.Boolean )
        {
            return bindTransformedStmt( varName, prefixExpr, 'boolean', tags, v =>
                `if( typeof ${v} !== "boolean" ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Type<boolean>" ); } params.push( encodeURIComponent( ${prefixExpr} ) + "=" + ( ${v} ? "true" : "false" ) );`
            );
        }

        if( flags & ts.TypeFlags.BigInt )
        {
            return bindTransformedStmt( varName, prefixExpr, 'bigint', tags, v =>
                `if( typeof ${v} !== "bigint" ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Type<bigint>" ); } params.push( encodeURIComponent( ${prefixExpr} ) + "=" + encodeURIComponent( String( ${v} ) ) );`
            );
        }

        if( isNativeEnumType( type ))
        {
            const members = enumMemberTypes( type, checker );

            if( members.length > 0 )
            {
                return buildQuerySerializer(
                    { isUnion : () => true, types : members, getFlags : () => ts.TypeFlags.Union } as any,
                    checker,
                    ctx,
                    varName,
                    prefixExpr,
                    visited,
                    hoisted,
                    depth,
                    recDefs
                );
            }

            return bindTransformedStmt( varName, prefixExpr, 'number', tags, v =>
                `if( typeof ${v} !== "number" || !Number.isFinite( ${v} ) ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Type<number>" ); } params.push( encodeURIComponent( ${prefixExpr} ) + "=" + encodeURIComponent( String( ${v} ) ) );`
            );
        }

        const symbolName = typeSymbolName( type );

        if( symbolName === 'Date' )
        {
            return bindTransformedStmt( varName, prefixExpr, 'Date', tags, v =>
                `if( !( ${v} instanceof Date ) || Number.isNaN( ${v}.getTime() ) ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Type<Date>" ); } params.push( encodeURIComponent( ${prefixExpr} ) + "=" + encodeURIComponent( ${v}.toISOString() ) );`
            );
        }

        if( symbolName === 'URL' )
        {
            return bindTransformedStmt( varName, prefixExpr, 'URL', tags, v =>
                `params.push( encodeURIComponent( ${prefixExpr} ) + "=" + __tcRuntime.serializeQueryUrl( ${v}, ${prefixExpr} ) );`
            );
        }

        if( symbolName === 'RegExp' )
        {
            return bindTransformedStmt( varName, prefixExpr, 'RegExp', tags, v =>
                `if( !( ${v} instanceof RegExp ) ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Type<RegExp>" ); } params.push( encodeURIComponent( ${prefixExpr} ) + "=" + encodeURIComponent( "/" + ${v}.source + "/" + ${v}.flags ) );`
            );
        }

        if( symbolName === 'File' || symbolName === 'Blob' )
        {
            return bindTransformedStmt( varName, prefixExpr, 'instance', tags, v =>
                `if( !( ${varName} instanceof ${symbolName} ) || ${v} === ${varName} ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, ${JSON.stringify( `Type<${symbolName}>` )} ); } params.push( encodeURIComponent( ${prefixExpr} ) + "=" + encodeURIComponent( String( ${v} ) ) );`
            );
        }

        if( symbolName && BUFFER_LIKE.has( symbolName ))
        {
            return bindTransformedStmt( varName, prefixExpr, 'instance', tags, v =>
                `const __b64 = __tcRuntime.serializeBuffer( ${v}, ${prefixExpr} ).slice( 1, -1 ); params.push( encodeURIComponent( ${prefixExpr} ) + "=" + encodeURIComponent( __b64 ) );`
            );
        }

        if( typeof checker.isTupleType === 'function' && checker.isTupleType( type ))
        {
            const { typeArgs, elementFlags, hasRest, hasOptional, fixedCount, minItems, restType, suffixTypes } = inspectTupleType( type, checker );

            if( !hasRest && !hasOptional )
            {
                const parts = typeArgs.map(( elem: ts.Type, i: number ) =>
                    buildQuerySerializer( elem, checker, ctx, `${varName}[${i}]`, `(${prefixExpr}) + "[${i}]"`, visited, hoisted, depth + 1, recDefs )
                );

                return `if( !Array.isArray( ${varName} ) || ${varName}.length !== ${typeArgs.length} ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Tuple<${typeArgs.length}>" ); } ${parts.join( ' ' )}`;
            }

            const suffixLen = suffixTypes.length;
            const restEndExpr = suffixLen > 0 ? `( ${varName}.length - ${suffixLen} )` : `${varName}.length`;
            const fixedStmts: string[] = [];

            for( let i = 0; i < fixedCount; i++ )
            {
                const isOpt = ( elementFlags[i] & ts.ElementFlags.Optional ) !== 0;
                const elemType = isOpt ? stripUndefinedFromUnion( typeArgs[i]) : typeArgs[i];
                const elemSer = buildQuerySerializer( elemType, checker, ctx, `${varName}[${i}]`, `(${prefixExpr}) + "[${i}]"`, visited, hoisted, depth + 1, recDefs );

                if( isOpt )
                {
                    fixedStmts.push( `if( ${restEndExpr} > ${i} && ${varName}[${i}] !== undefined ){ ${elemSer} }` );
                }
                else
                {
                    fixedStmts.push( `{ ${elemSer} }` );
                }
            }

            if( hasRest && restType )
            {
                const idxVar = `__qti${sfx}`;
                const restSer = buildQuerySerializer( restType, checker, ctx, `${varName}[${idxVar}]`, `(${prefixExpr}) + "[" + ${idxVar} + "]"`, visited, hoisted, depth + 1, recDefs );
                const suffixStmts = suffixTypes.map(( sType, j ) =>
                {
                    const sIdxVar = `__qtsi${sfx}_${j}`;
                    const sSer = buildQuerySerializer( sType, checker, ctx, `${varName}[${sIdxVar}]`, `(${prefixExpr}) + "[" + ${sIdxVar} + "]"`, visited, hoisted, depth + 1, recDefs );

                    return `{ const ${sIdxVar} = ${restEndExpr} + ${j}; ${sSer} }`;
                }).join( ' ' );

                return `if( !Array.isArray( ${varName} ) || ${varName}.length < ${minItems} ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Tuple<${minItems}+>" ); } ${fixedStmts.join( ' ' )} for( let ${idxVar} = ${fixedCount}; ${idxVar} < ${restEndExpr}; ${idxVar}++ ){ ${restSer} } ${suffixStmts}`;
            }

            return `if( !Array.isArray( ${varName} ) || ${varName}.length < ${minItems} || ${varName}.length > ${fixedCount} ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Tuple<${minItems}..${fixedCount}>" ); } ${fixedStmts.join( ' ' )}`;
        }

        if( typeof checker.isArrayType === 'function' && checker.isArrayType( type ))
        {
            const typeArgs = typeof checker.getTypeArguments === 'function' ? checker.getTypeArguments( type as ts.TypeReference ) : [];
            const elemType = typeArgs[0] || ({ getFlags : () => ts.TypeFlags.Any } as any );
            const itemVar = `item${sfx}`;
            const elemCode = buildQuerySerializer( elemType, checker, ctx, itemVar, `(${prefixExpr}) + "[]"`, visited, hoisted, depth + 1, recDefs );

            return `if( !Array.isArray( ${varName} ) ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Type<Array>" ); } for( const ${itemVar} of ${varName} ){ ${elemCode} }`;
        }

        if( symbolName === 'Set' || symbolName === 'ReadonlySet' )
        {
            const typeArgs = typeof checker.getTypeArguments === 'function'
                ? checker.getTypeArguments( type as ts.TypeReference )
                : ( type as ts.TypeReference ).typeArguments || [];
            const elemType = typeArgs[0] || ({ getFlags : () => ts.TypeFlags.Any } as any );
            const itemVar = `item${sfx}`;
            const elemCode = buildQuerySerializer( elemType, checker, ctx, itemVar, `(${prefixExpr}) + "[]"`, visited, hoisted, depth + 1, recDefs );

            return bindTransformedStmt( varName, prefixExpr, 'Set', tags, v =>
                `if( !( ${v} instanceof Set ) ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Type<Set>" ); } for( const ${itemVar} of ${v} ){ ${elemCode} }`
            );
        }

        if( symbolName === 'Map' || symbolName === 'ReadonlyMap' )
        {
            const typeArgs = typeof checker.getTypeArguments === 'function'
                ? checker.getTypeArguments( type as ts.TypeReference )
                : ( type as ts.TypeReference ).typeArguments || [];
            const keyType = typeArgs[0] || ({ getFlags : () => ts.TypeFlags.Any } as any );
            const valueType = typeArgs[1] || ({ getFlags : () => ts.TypeFlags.Any } as any );
            assertValidMapKeyType( keyType, checker );
            const mkVar = `__mk${sfx}`;
            const mvVar = `__mv${sfx}`;
            const kRawVar = `__kRaw${sfx}`;
            const kStrVar = `__kStr${sfx}`;
            const entryPrefixVar = `__entryPrefix${sfx}`;
            const keyPath = prefixExpr === '""' ? `".key(" + String( ${mkVar} ) + ")"` : `(${prefixExpr}) + ".key(" + String( ${mkVar} ) + ")"`;
            const keyCtx: SerContext = { ...ctx, bigintAs : 'number' };
            const keySer = buildJsonSerializer( keyType, checker, keyCtx, keyPath, mkVar, visited, hoisted, depth + 1, recDefs );
            const valCode = buildQuerySerializer( valueType, checker, ctx, mvVar, entryPrefixVar, visited, hoisted, depth + 1, recDefs );

            return bindTransformedStmt( varName, prefixExpr, 'Map', tags, v =>
                `if( !( ${v} instanceof Map ) ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Type<Map>" ); } for( const [ ${mkVar}, ${mvVar} ] of ${v}.entries() ){ const ${kRawVar} = ${keySer}; const ${kStrVar} = ${kRawVar}.charAt( 0 ) === '"' ? JSON.parse( ${kRawVar} ) : ${kRawVar}; const ${entryPrefixVar} = (${prefixExpr}) === "" ? ${kStrVar} : (${prefixExpr}) + "[" + ${kStrVar} + "]"; ${valCode} }`
            );
        }

        if( typeof type.isUnion === 'function' && type.isUnion())
        {
            const { hasUndefined, hasNull, nonNullish } = classifyNullableUnion( type.types );

            if( nonNullish.length === 1 && ( hasUndefined || hasNull ))
            {
                const inner = buildQuerySerializer( nonNullish[0], checker, ctx, varName, prefixExpr, visited, hoisted, depth + 1, recDefs );

                if( hasUndefined && hasNull )
                {
                    return `if( ${varName} === null ){ params.push( encodeURIComponent( ${prefixExpr} ) + "=" ); } else if( ${varName} !== undefined ){ ${inner} }`;
                }

                if( hasUndefined )
                {
                    return `if( ${varName} !== undefined ){ ${inner} }`;
                }

                return `if( ${varName} === null ){ params.push( encodeURIComponent( ${prefixExpr} ) + "=" ); } else { ${inner} }`;
            }

            const label = unionExpectedLabel( type, checker );
            const tagged = tryTaggedUnionTypes( type.types, checker );

            if( tagged )
            {
                const cases = tagged.arms.map( arm =>
                    `case ${JSON.stringify( arm.tag )}: { ${buildQuerySerializer( arm.type, checker, ctx, varName, prefixExpr, visited, hoisted, depth + 1, recDefs )} break; }`
                ).join( ' ' );
                const discExpr = `( ${varName} && typeof ${varName} === "object" && Object.hasOwn( ${varName}, ${JSON.stringify( tagged.key )} ) ? ${varName}[${JSON.stringify( tagged.key )}] : undefined )`;

                return `switch( ${discExpr} ){ ${cases} default: throw new __tcRuntime.SerializationError( ${prefixExpr}, ${JSON.stringify( label )} ); }`;
            }

            const sortedTypes = unionResolution === 'declaration-order'
                ? type.types.slice()
                : sortUnionArmsBySpecificity( type.types, checker );
            const armFns = sortedTypes.map( arm =>
                `() => { ${buildQuerySerializer( arm, checker, ctx, varName, prefixExpr, visited, hoisted, depth + 1, recDefs )} }`
            ).join( ', ' );
            const probeBestFit = mode === 'strip' && unionResolution !== 'declaration-order' && hasCompetingObjectArms( sortedTypes, checker );

            if( probeBestFit )
            {
                const fallbackFlags = sortedTypes.map( arm => isFallbackUnionArm( arm, checker ));
                const flagsArg = fallbackFlags.some( Boolean ) ? `, ${JSON.stringify( fallbackFlags )}` : '';

                return `__tcRuntime.serializeQueryUnion( params, ${prefixExpr}, ${JSON.stringify( label )}, [ ${armFns} ], true${flagsArg} );`;
            }

            return `__tcRuntime.serializeQueryUnion( params, ${prefixExpr}, ${JSON.stringify( label )}, [ ${armFns} ] );`;
        }

        const classCheck = resolveClassCheck( type, ctx.scope );
        const ir = resolveTypeIr( type, checker );

        if( ir.kind === 'function' || ir.kind === 'promise' || ir.kind === 'symbol' )
        {
            const expected = `Type<${ir.symbolName || ir.kind}>`;

            return `throw new __tcRuntime.SerializationError( ${prefixExpr}, ${JSON.stringify( expected )} );`;
        }

        const indexType = ir.getStringIndexType();
        const props = ir.getProps();
        const patternInfos = ir.getTemplateIndexInfos();

        return buildQueryObject( props, indexType, patternInfos, checker, ctx, varName, prefixExpr, visited, tags, hoisted, depth, recDefs, classCheck );
    }
    finally
    {
        if( typeof typeId === 'number' ){ visited.delete( typeId ) }
    }
}

function buildQueryObject(
    props             : { name : string, type : ts.Type, isOptional : boolean, isWriteOnly? : boolean, isSecret? : boolean }[],
    indexType         : ts.Type | undefined,
    patternIndexInfos : TemplateIndexInfo[] | undefined,
    checker           : ts.TypeChecker,
    ctx               : SerContext,
    varName           : string,
    prefixExpr        : string,
    visited           : Set<number> = new Set(),
    tags              : string[] = [],
    hoisted           : string[] = [],
    depth             : number = 0,
    recDefs           : Map<number, RecSerDef> = new Map(),
    classCheck?       : ClassCheckInfo
): string
{
    const { mode, propertyCasing } = ctx;
    const objVar = tags.length > 0 ? '__qobj' : varName;
    const kVar = 'k' + ( depth === 0 ? '' : '_' + depth );
    const declared = props.map( p => p.name );
    const wireMap = buildWirePropertyMap( declared, propertyCasing );
    const statements: string[] = [];

    if( classCheck )
    {
        statements.push( `if( !( ${objVar} instanceof ${classCheck.ctorExpr} ) ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, ${JSON.stringify( classCheck.expectedLabel )} ); }` );
    }
    else
    {
        statements.push( `if( !__tcRuntime.isPlainObject( ${objVar} ) ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Type<Object>" ); }` );
    }

    let keysVar = '__keys';
    const hasPatterns = Boolean( patternIndexInfos && patternIndexInfos.length > 0 );

    if( hasPatterns || indexType || mode === 'strict' || mode === 'relaxed' || ( mode === 'strip' && props.length > 0 ))
    {
        keysVar = hoisted.length === 0 ? '__keys' : `__keys_${hoisted.length}`;
        hoisted.push( `const ${keysVar} = new Set( ${JSON.stringify( declared )} );` );
    }

    for( const prop of props )
    {
        if( prop.isWriteOnly || prop.isSecret ){ continue }

        const wireName = wireMap.get( prop.name )!;
        const rawAccess = safePropAccess( objVar, prop.name );
        const access = `( Object.hasOwn( ${objVar}, ${JSON.stringify( prop.name )} ) ? ${rawAccess} : undefined )`;
        const childPrefix = `(${prefixExpr}) === "" ? ${JSON.stringify( wireName )} : (${prefixExpr}) + ${JSON.stringify( '[' + wireName + ']' )}`;
        const effectiveType = prop.isOptional ? stripUndefinedFromUnion( prop.type ) : prop.type;
        const body = buildQuerySerializer( effectiveType, checker, ctx, access, childPrefix, visited, hoisted, depth + 1, recDefs );

        if( prop.isOptional )
        {
            statements.push( `if( ${access} !== undefined ){ ${body} }` );
        }
        else
        {
            statements.push( `{ ${body} }` );
        }
    }

    if( hasPatterns )
    {
        const childKeyPrefix = `(${prefixExpr}) === "" ? ${kVar} : (${prefixExpr}) + "[" + ${kVar} + "]"`;
        const patternBranches = patternIndexInfos!.map( pInfo =>
        {
            const reVar = `__re_${hoisted.length}`;
            hoisted.push( `const ${reVar} = __tcRuntime.getCachedPattern( ${JSON.stringify( pInfo.pattern )} );` );
            const patBody = buildQuerySerializer( pInfo.valueType, checker, ctx, `${objVar}[${kVar}]`, childKeyPrefix, visited, hoisted, depth + 1, recDefs );

            return `if( ${reVar} && __tcRuntime.testRegex( ${reVar}, ${kVar} ) ){ __pm = true; ${patBody} }`;
        }).join( ' ' );

        let unmatchedCode = '';

        if( indexType )
        {
            const idxBody = buildQuerySerializer( indexType, checker, ctx, `${objVar}[${kVar}]`, childKeyPrefix, visited, hoisted, depth + 1, recDefs );
            unmatchedCode = `${ mode === 'strip' ? '__mt++; ' : ''}${idxBody}`;
        }
        else if( mode === 'strict' )
        {
            unmatchedCode = `throw new __tcRuntime.SerializationError( ${prefixExpr}, "PropertyNotAllowed<" + ${kVar} + ">" );`;
        }
        else if( mode === 'relaxed' )
        {
            unmatchedCode = `params.push( encodeURIComponent( ${childKeyPrefix} ) + "=" + ${leafQueryEncode( `${objVar}[${kVar}]` )} );`;
        }
        else if( mode === 'strip' )
        {
            unmatchedCode = '__st++;';
        }

        if( mode === 'strip' )
        {
            statements.push( `{ let __st = 0; let __mt = 0; for( const ${kVar} of Object.keys( ${objVar} ) ){ if( ${objVar}[${kVar}] === undefined ){ continue; } if( ${keysVar}.has( ${kVar} ) ){ __mt++; continue; } let __pm = false; ${patternBranches} if( __pm ){ __mt++; } else { ${unmatchedCode} } } if( __tcRuntime.hasSerializerUnionProbe() ){ __tcRuntime.recordSerializerObjectStats( __st, __mt ); } }` );
        }
        else
        {
            statements.push( `for( const ${kVar} of Object.keys( ${objVar} ) ){ if( ${objVar}[${kVar}] === undefined || ${keysVar}.has( ${kVar} ) ){ continue; } let __pm = false; ${patternBranches} if( !__pm ){ ${unmatchedCode} } }` );
        }
    }
    else if( indexType )
    {
        const idxBody = buildQuerySerializer( indexType, checker, ctx, `${objVar}[${kVar}]`, `(${prefixExpr}) === "" ? ${kVar} : (${prefixExpr}) + "[" + ${kVar} + "]"`, visited, hoisted, depth + 1, recDefs );

        if( mode === 'strip' )
        {
            statements.push( `{ let __mt = 0; for( const ${kVar} of Object.keys( ${objVar} ) ){ if( ${objVar}[${kVar}] !== undefined ){ __mt++; if( !${keysVar}.has( ${kVar} ) ){ ${idxBody} } } } if( __tcRuntime.hasSerializerUnionProbe() ){ __tcRuntime.recordSerializerObjectStats( 0, __mt ); } }` );
        }
        else
        {
            statements.push( `for( const ${kVar} of Object.keys( ${objVar} ) ){ if( !${keysVar}.has( ${kVar} ) && ${objVar}[${kVar}] !== undefined ){ ${idxBody} } }` );
        }
    }
    else if( mode === 'strict' )
    {
        statements.push( `for( const ${kVar} of Object.keys( ${objVar} ) ){ if( !${keysVar}.has( ${kVar} ) && ${objVar}[${kVar}] !== undefined ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "PropertyNotAllowed<" + ${kVar} + ">" ); } }` );
    }
    else if( mode === 'relaxed' )
    {
        statements.push( `for( const ${kVar} of Object.keys( ${objVar} ) ){ if( !${keysVar}.has( ${kVar} ) && ${objVar}[${kVar}] !== undefined ){ params.push( encodeURIComponent( (${prefixExpr}) === "" ? ${kVar} : (${prefixExpr}) + "[" + ${kVar} + "]" ) + "=" + ${leafQueryEncode( `${objVar}[${kVar}]` )} ); } }` );
    }
    else if( mode === 'strip' )
    {
        if( props.length > 0 )
        {
            statements.push( `if( __tcRuntime.hasSerializerUnionProbe() ){ let __st = 0; let __mt = 0; for( const ${kVar} of Object.keys( ${objVar} ) ){ if( ${objVar}[${kVar}] !== undefined ){ if( ${keysVar}.has( ${kVar} ) ){ __mt++; } else { __st++; } } } __tcRuntime.recordSerializerObjectStats( __st, __mt ); }` );
        }
        else
        {
            statements.push( `if( __tcRuntime.hasSerializerUnionProbe() ){ let __st = 0; for( const ${kVar} of Object.keys( ${objVar} ) ){ if( ${objVar}[${kVar}] !== undefined ){ __st++; } } __tcRuntime.recordSerializerObjectStats( __st, 0 ); }` );
        }
    }

    const code = statements.join( ' ' );
    const kindLabel = classCheck ? 'instance' : 'Object';

    return tags.length > 0 ? bindTransformedStmt( varName, prefixExpr, kindLabel, tags, v => `( function( __qobj ){ ${code} })( ${v} );` ) : code;
}
