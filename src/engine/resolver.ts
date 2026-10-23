import ts from 'typescript';
import type { JsonSchema, UnionResolution } from '../runtime/validators.js';
import {
    createPrimitiveCheck,
    createLiteralCheck,
    createArrayCheck,
    createNullableCheck,
    createTaggedUnionCheck,
    createUnionCheck,
    NullableKind,
    createObjectCheck,
    createDateCheck,
    createUrlCheck,
    createNullCheck,
    createUndefinedCheck,
    createIntersectionCheck,
    createTupleCheck,
    createRecordCheck,
    createRegExpCheck,
    createTemplateLiteralCheck,
    createConstrainedPrimitiveCheck,
    wrapOptionTransform,
    createSetCheck,
    createMapCheck,
    createInstanceOfCheck,
    templateToAst
} from './generators.js';
import {
    ICustomFunctionScope,
    declarationSite,
    resolveClassIdentity,
    resolveFunctionIdentity
} from './customFns.js';
import {
    BUFFER_LIKE,
    buildTemplateLiteralRegex,
    collectConstraintsFromProps,
    enumMemberTypes,
    getPropertyType,
    getTemplateIndexInfos,
    getTypeProps,
    inspectTupleType,
    isBrandOnlyType,
    isConstraintOnlyType,
    isNativeEnumType,
    isTagKey,
    mapStructuralProps,
    minifyTypeString,
    peelTaggedIntersection,
    stripUndefinedFromUnion,
    tryMergeObjectTypes,
    tryTaggedUnionTypes,
    typeHasDefaultTag,
    typeSymbolName,
    VERBATIM_CUSTOM_SCOPE,
    type ParsedConstraint
} from './type-helpers.js';
import { resolveTypeIr } from './type-ir.js';
import
{
    hasCompetingObjectArms,
    isFallbackUnionArm,
    sortUnionArmsBySpecificity,
    tryExclusiveKeyUnion
}
    from './specificity.js';
import { createHash } from 'crypto';

/** Map peeled tag constraints onto JSON Schema / x-extension fields. */
function applyConstraintsToJsonSchema(
    target      : Record<string, any>,
    constraints : ParsedConstraint[],
    checker?    : ts.TypeChecker,
    defs?       : Record<string, any>,
    visited?    : Map<number, string>,
    counts?     : Map<string, number>,
    circularHashes?: Set<string>
): void
{
    for( const c of constraints )
    {
        if( c.type === 'default' ){ target.default = typeof c.value === 'bigint' ? Number( c.value ) : c.value }
        else if( c.type === 'requires' ){ target.requires = c.value }
        else if(
            c.type === 'minLength' || c.type === 'maxLength' ||
            c.type === 'minimum' || c.type === 'maximum' ||
            c.type === 'exclusiveMinimum' || c.type === 'exclusiveMaximum' ||
            c.type === 'multipleOf' || c.type === 'pattern' || c.type === 'format' ||
            c.type === 'minItems' || c.type === 'maxItems' ||
            c.type === 'minProperties' || c.type === 'maxProperties' ||
            c.type === 'minContains' || c.type === 'maxContains'
        )
        {
            if( c.value !== undefined )
            {
                target[c.type] = typeof c.value === 'bigint' ? Number( c.value ) : c.value;
            }
        }
        else if( c.type === 'uniqueItems' ){ target.uniqueItems = true }
        else if( c.type === 'contains' && c.nestedType && checker && defs && visited && counts && circularHashes )
        {
            target.contains = buildJsonSchemaInternal(
                c.nestedType, checker, defs, visited, counts, circularHashes
            );
        }
        else if( c.type === 'propertyNames' && c.nestedType && checker && defs && visited && counts && circularHashes )
        {
            target.propertyNames = buildJsonSchemaInternal(
                c.nestedType, checker, defs, visited, counts, circularHashes
            );
        }
        else if( c.type === 'tags' && Array.isArray( c.value ))
        {
            const prev = Array.isArray( target['x-tags']) ? target['x-tags'] as string[] : [];
            const merged = new Set<string>([ ...prev, ...c.value.filter(( n ): n is string => typeof n === 'string' ) ]);

            target['x-tags'] = [ ...merged ].sort();
        }
    }
}

function attachNestedConstraintChecks(
    constraints     : ParsedConstraint[],
    checker         : ts.TypeChecker,
    validatorsMap   : Map<string, ts.Expression>,
    scope           : ICustomFunctionScope,
    unionResolution : UnionResolution = 'specificity'
): ParsedConstraint[]
{
    return constraints.map( c =>
    {
        if(( c.type === 'contains' || c.type === 'propertyNames' ) && c.nestedType )
        {
            return {
                ...c,
                nestedCheck : buildValidatorScoped( c.nestedType, checker, validatorsMap, scope, undefined, unionResolution )
            };
        }

        return c;
    });
}

function buildEnumValidator(
    type            : ts.Type,
    checker         : ts.TypeChecker,
    validatorsMap   : Map<string, ts.Expression>,
    scope           : ICustomFunctionScope,
    unionResolution : UnionResolution = 'specificity'
): ts.Expression
{
    const members = enumMemberTypes( type, checker );
    const checks = members.map( t => buildValidatorScoped( t, checker, validatorsMap, scope, undefined, unionResolution ));

    if( checks.length === 0 && type.isUnion())
    {
        const unionChecks = ( type as ts.UnionType ).types.map( t => buildValidatorScoped( t, checker, validatorsMap, scope, undefined, unionResolution ));

        return createUnionCheck( unionChecks, `Type<${minifyTypeString( checker.typeToString( type ))}>` );
    }

    if( checks.length === 0 )
    {
        return wrapOptionTransform( createPrimitiveCheck( 'any' ), 'Object' );
    }

    if( checks.length === 1 ){ return checks[0] }

    return createUnionCheck( checks, `Type<${minifyTypeString( checker.typeToString( type ))}>` );
}

function tryMergeObjectIntersection(
    types           : readonly ts.Type[],
    checker         : ts.TypeChecker,
    validatorsMap   : Map<string, ts.Expression>,
    expected        : string,
    scope           : ICustomFunctionScope,
    unionResolution : UnionResolution = 'specificity'
): ts.Expression | undefined
{
    const merged = tryMergeObjectTypes( types, checker );

    if( !merged ){ return undefined }

    const props = merged.props.map( prop => ({
        name       : prop.name,
        isOptional : prop.isOptional,
        validator  : buildValidatorScoped( prop.type, checker, validatorsMap, scope, undefined, unionResolution ),
        hasDefault : prop.hasDefault
    }));
    const indexValidator = merged.indexType
        ? buildValidatorScoped( merged.indexType, checker, validatorsMap, scope, undefined, unionResolution )
        : undefined;
    const patternChecks = merged.patternIndexInfos?.map( pInfo => ({
        pattern   : pInfo.pattern,
        validator : buildValidatorScoped( pInfo.valueType, checker, validatorsMap, scope, undefined, unionResolution )
    }));

    return createObjectCheck( props, expected, indexValidator, patternChecks );
}

/**
 * `T | undefined`, `T | null` and `T | null | undefined` do not need an arm-by-arm search. A null check
 * delegating to the single remaining arm skips the union's speculative context entirely.
 *
 * Deliberately conservative: `boolean | undefined` arrives as `true | false | undefined` and keeps the
 * generic union.
 */
function tryNullableUnion(
    members         : readonly ts.Type[],
    checker         : ts.TypeChecker,
    validatorsMap   : Map<string, ts.Expression>,
    scope           : ICustomFunctionScope,
    unionResolution : UnionResolution = 'specificity'
): ts.Expression | undefined
{
    let hasUndefined = false;
    let hasNull = false;
    const rest: ts.Type[] = [];

    for( const member of members )
    {
        const memberFlags = member.getFlags();

        if( memberFlags & ts.TypeFlags.Undefined ){ hasUndefined = true }
        else if( memberFlags & ts.TypeFlags.Null ){ hasNull = true }
        else { rest.push( member ) }
    }

    if( rest.length !== 1 || ( !hasUndefined && !hasNull )){ return undefined }

    const kind: NullableKind = hasUndefined && hasNull ? 'nullish' : ( hasUndefined ? 'optional' : 'nullable' );

    return createNullableCheck( kind, buildValidatorScoped( rest[0], checker, validatorsMap, scope, undefined, unionResolution ));
}

/** Classify a peeled base for constrained-primitive emit. */
function constrainedBaseKind( type: ts.Type, checker: ts.TypeChecker ): { baseName : string, baseType? : ts.Type } | undefined
{
    const flags = typeof type.getFlags === 'function' ? type.getFlags() : 0;

    if( flags & ts.TypeFlags.String || flags & ts.TypeFlags.TemplateLiteral )
    {
        return { baseName : 'string', baseType : type };
    }

    if( flags & ts.TypeFlags.Number ){ return { baseName : 'number' } }

    if( flags & ts.TypeFlags.BigInt ){ return { baseName : 'bigint' } }

    if( flags & ts.TypeFlags.Boolean || ( type as any ).intrinsicName === 'boolean' )
    {
        return { baseName : 'boolean', baseType : type };
    }

    if( typeSymbolName( type ) === 'Date' )
    {
        return { baseName : 'date', baseType : type };
    }

    if( typeSymbolName( type ) === 'URL' )
    {
        return { baseName : 'urlInstance', baseType : type };
    }

    if( typeSymbolName( type ) === 'Set' || typeSymbolName( type ) === 'ReadonlySet' )
    {
        return { baseName : 'set', baseType : type };
    }

    if( typeSymbolName( type ) === 'Map' || typeSymbolName( type ) === 'ReadonlyMap' )
    {
        return { baseName : 'map', baseType : type };
    }

    if( typeof checker.isArrayType === 'function' && checker.isArrayType( type ))
    {
        return { baseName : 'array', baseType : type };
    }

    return undefined;
}

export function buildValidator(
    type            : ts.Type,
    checker         : ts.TypeChecker,
    validatorsMap   : Map<string, ts.Expression>,
    hash?           : string,
    scope           : ICustomFunctionScope = VERBATIM_CUSTOM_SCOPE,
    unionResolution : UnionResolution = 'specificity'
): ts.Expression
{
    return buildValidatorScoped( type, checker, validatorsMap, scope, hash, unionResolution );
}

function buildValidatorScoped(
    type            : ts.Type,
    checker         : ts.TypeChecker,
    validatorsMap   : Map<string, ts.Expression>,
    scope           : ICustomFunctionScope,
    hash?           : string,
    unionResolution : UnionResolution = 'specificity'
): ts.Expression 
{
    const baseHash = hash ?? generateHash( type, checker );
    const resolvedHash = unionResolution === 'declaration-order' && !baseHash.endsWith( '_decl' )
        ? `${baseHash}_decl`
        : baseHash;

    const existing = validatorsMap.get( resolvedHash );

    if( existing ) 
    {
        if( ts.isIdentifier( existing ) && existing.text === `PENDING_${resolvedHash}` )
        {
            return templateToAst( `(v, path, ctx) => __val_${resolvedHash}(v, path, ctx)` );
        }

        return ts.factory.createIdentifier( `__val_${resolvedHash}` );
    }

    // Set placeholder to handle circularity
    validatorsMap.set( resolvedHash, ts.factory.createIdentifier( `PENDING_${resolvedHash}` ));

    let result: ts.Expression;
    const flags = type.getFlags();

    const isUnion = !( flags & ts.TypeFlags.Boolean ) && ((( flags & ts.TypeFlags.Union ) !== 0 || type.isUnion()) && ( type as any ).types ) ? true : false;
    const isIntersection = ((( flags & ts.TypeFlags.Intersection ) !== 0 || type.isIntersection()) && ( type as any ).types ) ? true : false;

    if( isUnion ) 
    {
        const rawMembers = ( type as ts.UnionType ).types;
        const expected = `Type<${minifyTypeString( checker.typeToString( type ))}>`;

        // A Default tag treats missing as "fill me in". A bare `undefined` arm would win first
        // (or, after the optional fast-path, short-circuit before the default runs) and leave the
        // property unset. Drop that arm whenever a sibling can supply the value.
        const members = rawMembers.some( m => typeHasDefaultTag( m, checker ))
            ? rawMembers.filter( m => !( m.getFlags() & ts.TypeFlags.Undefined ))
            : rawMembers;

        if( members.length === 1 )
        {
            result = buildValidatorScoped( members[0], checker, validatorsMap, scope, undefined, unionResolution );
        }
        else
        {
            const nullable = tryNullableUnion( members, checker, validatorsMap, scope, unionResolution );

            if( nullable ){ result = nullable }
            else
            {
                const taggedInfo = tryTaggedUnionTypes( members, checker );

                if( taggedInfo )
                {
                    const checks = members.map( t => buildValidatorScoped( t, checker, validatorsMap, scope, undefined, unionResolution ));
                    result = createTaggedUnionCheck(
                        taggedInfo.key,
                        taggedInfo.arms.map(( arm, i ) => [arm.tag, checks[i]]),
                        expected
                    );
                }
                else
                {
                    const sortedMembers = unionResolution === 'declaration-order'
                        ? members.slice()
                        : sortUnionArmsBySpecificity( members, checker );
                    const checks = sortedMembers.map( t => buildValidatorScoped( t, checker, validatorsMap, scope, undefined, unionResolution ));
                    const fallbackFlags = unionResolution !== 'declaration-order' && hasCompetingObjectArms( sortedMembers, checker )
                        ? sortedMembers.map( arm => isFallbackUnionArm( arm, checker ))
                        : undefined;
                    const exclusiveKeys = tryExclusiveKeyUnion( sortedMembers, checker );

                    result = createUnionCheck( checks, expected, fallbackFlags, exclusiveKeys );
                }
            }
        }
    }
    else if( isIntersection )
    {
        const types = ( type as ts.IntersectionType ).types;
        const peeled = peelTaggedIntersection( type, checker, scope );
        const expected = minifyTypeString( checker.typeToString( type ));

        if( peeled?.hasTags )
        {
            const constraints = attachNestedConstraintChecks(
                peeled.constraints,
                checker,
                validatorsMap,
                scope,
                unionResolution
            );
            const walkBase = peeled.base;
            let kind = constrainedBaseKind( walkBase, checker );

            if( !kind && typeof walkBase.isIntersection === 'function' && walkBase.isIntersection())
            {
                for( const sub of walkBase.types )
                {
                    kind = constrainedBaseKind( sub, checker );

                    if( kind ){ break }
                }
            }

            if( kind )
            {
                if(( kind.baseName === 'array' || kind.baseName === 'set' || kind.baseName === 'map' ) && kind.baseType )
                {
                    const baseValidator = buildValidatorScoped( kind.baseType, checker, validatorsMap, scope, undefined, unionResolution );
                    result = createConstrainedPrimitiveCheck( kind.baseName, constraints, baseValidator );
                }
                else if( kind.baseType && ( kind.baseType.getFlags() & ts.TypeFlags.TemplateLiteral ))
                {
                    const regexStr = buildTemplateLiteralRegex( kind.baseType as ts.TemplateLiteralType );
                    const baseValidator = createTemplateLiteralCheck( regexStr, checker.typeToString( kind.baseType ));
                    result = createConstrainedPrimitiveCheck( kind.baseName, constraints, baseValidator );
                }
                else
                {
                    result = createConstrainedPrimitiveCheck( kind.baseName, constraints );
                }
            }
            else
            {
                const nonConstraintTypes = types.filter( t => !isConstraintOnlyType( t, checker ));
                let baseValidator: ts.Expression | undefined;

                if( nonConstraintTypes.length === 1 )
                {
                    baseValidator = buildValidatorScoped( nonConstraintTypes[0], checker, validatorsMap, scope, undefined, unionResolution );
                }
                else if( nonConstraintTypes.length > 1 )
                {
                    const merged = tryMergeObjectIntersection(
                        nonConstraintTypes,
                        checker,
                        validatorsMap,
                        expected,
                        scope,
                        unionResolution
                    );
                    baseValidator = merged || createIntersectionCheck(
                        nonConstraintTypes.map( t => buildValidatorScoped( t, checker, validatorsMap, scope, undefined, unionResolution ))
                    );
                }

                if( baseValidator )
                {
                    result = createConstrainedPrimitiveCheck( 'any', constraints, baseValidator );
                }
                else
                {
                    const merged = tryMergeObjectIntersection( types, checker, validatorsMap, expected, scope, unionResolution );
                    result = merged || createIntersectionCheck(
                        types.map( t => buildValidatorScoped( t, checker, validatorsMap, scope, undefined, unionResolution ))
                    );
                }
            }
        }
        else if( peeled )
        {
            // Brand-only (or other tagless) peels — walk the effective base, not the full intersection.
            result = buildValidatorScoped( peeled.base, checker, validatorsMap, scope, undefined, unionResolution );
        }
        else
        {
            const merged = tryMergeObjectIntersection( types, checker, validatorsMap, expected, scope, unionResolution );

            if( merged )
            {
                result = merged;
            }
            else
            {
                const checks = types.map( t => buildValidatorScoped( t, checker, validatorsMap, scope, undefined, unionResolution ));
                result = createIntersectionCheck( checks );
            }
        }
    }
    else if( type.getSymbol()?.name === 'Date' ) 
    {
        result = wrapOptionTransform( createDateCheck(), 'Date' );
    }
    else if( type.getSymbol()?.name === 'URL' )
    {
        result = wrapOptionTransform( createUrlCheck(), 'URL' );
    }
    else if( type.getSymbol()?.name === 'RegExp' ) 
    {
        result = wrapOptionTransform( createRegExpCheck(), 'RegExp' );
    }
    else if( type.getSymbol()?.name === 'Set' || type.getSymbol()?.name === 'ReadonlySet' ) 
    {
        const elementType = ( type as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();
        result = createSetCheck( buildValidatorScoped( elementType, checker, validatorsMap, scope, undefined, unionResolution ));
    }
    else if( type.getSymbol()?.name === 'Map' || type.getSymbol()?.name === 'ReadonlyMap' ) 
    {
        const keyType = ( type as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();
        const valueType = ( type as ts.TypeReference ).typeArguments?.[1] || checker.getAnyType();
        result = createMapCheck(
            buildValidatorScoped( keyType, checker, validatorsMap, scope, undefined, unionResolution ),
            buildValidatorScoped( valueType, checker, validatorsMap, scope, undefined, unionResolution )
        );
    }
    else if( type.getSymbol()?.name === 'Promise' ) 
    {
        result = wrapOptionTransform( createInstanceOfCheck( 'Promise' ), 'instance' );
    }
    else if( type.getSymbol()?.name && BUFFER_LIKE.has( type.getSymbol()!.name )) 
    {
        result = wrapOptionTransform( createInstanceOfCheck( type.getSymbol()!.name ), 'instance' );
    }
    else if( flags & ts.TypeFlags.Null ) 
    {
        result = createNullCheck();
    }
    else if( flags & ts.TypeFlags.Undefined || flags & ts.TypeFlags.Void ) 
    {
        result = createUndefinedCheck();
    }
    else if( flags & ts.TypeFlags.String ) 
    {
        result = wrapOptionTransform( createPrimitiveCheck( 'string' ), 'string' );
    }
    else if( flags & ts.TypeFlags.Number ) 
    {
        result = wrapOptionTransform( createPrimitiveCheck( 'number' ), 'number' );
    }
    else if( flags & ts.TypeFlags.BigInt ) 
    {
        result = wrapOptionTransform( createPrimitiveCheck( 'bigint' ), 'bigint' );
    }
    else if( flags & ts.TypeFlags.Boolean ) 
    {
        result = wrapOptionTransform( createPrimitiveCheck( 'boolean' ), 'boolean' );
    }
    else if( flags & ts.TypeFlags.Never ) 
    {
        result = wrapOptionTransform( createPrimitiveCheck( 'never' ), 'never' );
    }
    else if( flags & ts.TypeFlags.ESSymbol || flags & ts.TypeFlags.UniqueESSymbol || ( type as any ).intrinsicName === 'symbol' ) 
    {
        result = wrapOptionTransform( createPrimitiveCheck( 'symbol' ), 'symbol' );
    }
    else if( flags & ts.TypeFlags.TemplateLiteral ) 
    {
        const regexStr = buildTemplateLiteralRegex( type as ts.TemplateLiteralType );
        result = wrapOptionTransform( createTemplateLiteralCheck( regexStr, checker.typeToString( type )), 'string' );
    }
    else if( type.isStringLiteral()) 
    {
        result = wrapOptionTransform( createLiteralCheck( type.value ), 'literal' );
    }
    else if( type.isNumberLiteral()) 
    {
        result = wrapOptionTransform( createLiteralCheck( type.value ), 'literal' );
    }
    else if( flags & ts.TypeFlags.BooleanLiteral ) 
    {
        result = wrapOptionTransform( createLiteralCheck(( type as any ).intrinsicName === 'true' ), 'literal' );
    }
    else if( flags & ts.TypeFlags.BigIntLiteral ) 
    {
        result = wrapOptionTransform( createLiteralCheck(( type as ts.BigIntLiteralType ).value ), 'literal' );
    }
    else if( checker.isTupleType( type )) 
    {
        const { typeArgs, elementFlags, hasRest, hasOptional, fixedCount, minItems } = inspectTupleType( type, checker );

        if( hasRest && typeArgs.length > 0 )
        {
            const fixedArgs = typeArgs.slice( 0, fixedCount );
            const restType = typeArgs[typeArgs.length - 1];
            const checks = fixedArgs.map(( t, i ) =>
                buildValidatorScoped(
                    ( elementFlags[i] & ts.ElementFlags.Optional ) ? stripUndefinedFromUnion( t ) : t,
                    checker,
                    validatorsMap,
                    scope,
                    undefined,
                    unionResolution
                )
            );
            const restValidator = buildValidatorScoped( restType, checker, validatorsMap, scope, undefined, unionResolution );
            result = createTupleCheck( checks, minItems, restValidator );
        }
        else if( hasOptional )
        {
            const checks = typeArgs.map(( t, i ) =>
                buildValidatorScoped(
                    ( elementFlags[i] & ts.ElementFlags.Optional ) ? stripUndefinedFromUnion( t ) : t,
                    checker,
                    validatorsMap,
                    scope,
                    undefined,
                    unionResolution
                )
            );
            result = createTupleCheck( checks, minItems );
        }
        else
        {
            result = createTupleCheck( typeArgs.map( t => buildValidatorScoped( t, checker, validatorsMap, scope, undefined, unionResolution )));
        }
    }
    else if( checker.isArrayType( type )) 
    {
        const elementType = ( type as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();
        result = createArrayCheck( buildValidatorScoped( elementType, checker, validatorsMap, scope, undefined, unionResolution ));
    }
    else if( type.getCallSignatures().length > 0 && type.getConstructSignatures().length === 0 ) 
    {
        result = wrapOptionTransform( createPrimitiveCheck( 'function' ), 'function' );
    }
    else if( isNativeEnumType( type )) 
    {
        result = buildEnumValidator( type, checker, validatorsMap, scope, unionResolution );
    }
    else
    {
        const classIdentity = resolveClassIdentity( type );

        if( classIdentity )
        {
            const declaration = classIdentity.declaration;
            const fromAmbientGlobal = declaration !== undefined
                && declaration.getSourceFile().isDeclarationFile
                && !ts.isExternalModule( declaration.getSourceFile());

            if( fromAmbientGlobal || !declaration )
            {
                result = wrapOptionTransform( createInstanceOfCheck( classIdentity.name ), 'instance' );
            }
            else
            {
                const localName = scope.bind( classIdentity );

                result = wrapOptionTransform( createInstanceOfCheck( ts.factory.createIdentifier( localName )), 'instance' );
            }
        }
        else
        {
            const ir = resolveTypeIr( type, checker );
            const stringIndexInfo = checker.getIndexInfoOfType( type, ts.IndexKind.String );
            const patternInfos = ir.getTemplateIndexInfos();
            const rawProps = checker.getPropertiesOfType( type );
            const hasInterfaceTags = rawProps.some( p => isTagKey( p.getName()));
            const props = ir.getProps().map( p => ({
                name       : p.name,
                isOptional : p.isOptional,
                validator  : buildValidatorScoped( p.type, checker, validatorsMap, scope, undefined, unionResolution ),
                hasDefault : p.hasDefault
            }));
            const patternChecks = patternInfos.length > 0
                ? patternInfos.map( pInfo => ({
                    pattern   : pInfo.pattern,
                    validator : buildValidatorScoped( pInfo.valueType, checker, validatorsMap, scope, undefined, unionResolution )
                }))
                : undefined;

            if( stringIndexInfo && props.length === 0 && !patternChecks )
            {
                result = createRecordCheck( buildValidatorScoped( stringIndexInfo.type, checker, validatorsMap, scope, undefined, unionResolution ));
            }
            else if( flags & ts.TypeFlags.NonPrimitive )
            {
                result = wrapOptionTransform( createRecordCheck( createPrimitiveCheck( 'any' )), 'Object' );
            }
            else if( flags & ts.TypeFlags.Object || type.isClassOrInterface() || type.isTypeParameter() || stringIndexInfo || patternChecks )
            {
                const typeName = checker.typeToString( type );
                const indexValidator = stringIndexInfo
                    ? buildValidatorScoped( stringIndexInfo.type, checker, validatorsMap, scope, undefined, unionResolution )
                    : undefined;
                result = createObjectCheck( props, typeName, indexValidator, patternChecks );
            }
            else
            {
                result = wrapOptionTransform( createPrimitiveCheck( 'any' ), 'Object' );
            }

            if( hasInterfaceTags )
            {
                const rawConstraints = collectConstraintsFromProps( rawProps, checker, scope );

                if( rawConstraints.length > 0 )
                {
                    const attached = attachNestedConstraintChecks(
                        rawConstraints,
                        checker,
                        validatorsMap,
                        scope,
                        unionResolution
                    );
                    result = createConstrainedPrimitiveCheck( 'any', attached, result );
                }
            }
        }
    }

    validatorsMap.delete( resolvedHash );
    validatorsMap.set( resolvedHash, result );

    return ts.factory.createIdentifier( `__val_${resolvedHash}` );
}

const signatureByType = new WeakMap<object, string>();

function buildStructuralSignature( type: ts.Type, checker: ts.TypeChecker, visited: Set<number> = new Set()): string
{
    const typeId = ( type as any ).id;

    if( typeId && visited.has( typeId )) { return `[Circular:${typeId}]` }

    const memo = signatureByType.get( type as object );

    if( memo !== undefined ){ return memo }

    if( typeId ){ visited.add( typeId ) }

    try
    {
        const signature = signatureOf( type, checker, visited );

        // A circular marker is only meaningful relative to the ancestors that were on the stack when it
        // was produced, so such a signature cannot be reused elsewhere.
        if( !signature.includes( '[Circular:' )){ signatureByType.set( type as object, signature ) }

        return signature;
    }
    finally
    {
        // Unwind, so a type appearing as two siblings is not mistaken for a cycle on the second visit.
        if( typeId ){ visited.delete( typeId ) }
    }
}

function signatureOf( type: ts.Type, checker: ts.TypeChecker, visited: Set<number> ): string 
{
    const flags = type.getFlags();

    if(( flags & ts.TypeFlags.Union ) && ( type as any ).types ) 
    {
        return `Union<${( type as ts.UnionType ).types.map( t => buildStructuralSignature( t, checker, visited )).sort().join( ',' )}>`;
    }

    if(( flags & ts.TypeFlags.Intersection ) && ( type as any ).types ) 
    {
        return `Intersection<${( type as ts.IntersectionType ).types.map( t => buildStructuralSignature( t, checker, visited )).sort().join( ',' )}>`;
    }

    if( type.isStringLiteral()) { return `S:"${type.value}"` }

    if( type.isNumberLiteral()) { return `N:${type.value}` }

    if( flags & ts.TypeFlags.BigIntLiteral ) { return `B:${checker.typeToString( type )}` }

    if( flags & ts.TypeFlags.BooleanLiteral ) { return `L:${( type as any ).intrinsicName}` }

    if( flags & ts.TypeFlags.String ) { return 'string' }

    if( flags & ts.TypeFlags.Number ) { return 'number' }

    if( flags & ts.TypeFlags.Boolean || ( type as any ).intrinsicName === 'boolean' ) { return 'boolean' }

    if( flags & ts.TypeFlags.BigInt ) { return 'bigint' }

    if( flags & ts.TypeFlags.Null ) { return 'null' }

    if( flags & ts.TypeFlags.Undefined || flags & ts.TypeFlags.Void ) { return 'undefined' }

    if( flags & ts.TypeFlags.Never ) { return 'never' }

    if( flags & ts.TypeFlags.Unknown ) { return 'unknown' }

    if( flags & ts.TypeFlags.Any ) { return 'any' }

    if( flags & ts.TypeFlags.NonPrimitive ) { return 'object' }

    if( flags & ts.TypeFlags.ESSymbol || flags & ts.TypeFlags.UniqueESSymbol || ( type as any ).intrinsicName === 'symbol' ) { return 'symbol' }

    if( type.getCallSignatures().length > 0 && type.getConstructSignatures().length === 0 )
    {
        // `Custom<typeof isEven>` and `Custom<typeof isOdd>` are structurally identical, so without the
        // binding they compile to one shared validator that calls whichever function was seen first.
        const identity = resolveFunctionIdentity( type, checker );

        if( !identity ){ return 'function' }

        return `function<${identity.name}${declarationSite( identity.declaration )}>`;
    }

    if( isNativeEnumType( type ))
    {
        const symbol = type.getSymbol();
        const members: string[] = [];

        if( symbol?.exports )
        {
            symbol.exports.forEach( member =>
            {
                if( !( member.flags & ts.SymbolFlags.EnumMember )){ return }

                const declaration = member.valueDeclaration || member.declarations?.[0];

                if( !declaration ){ return }

                members.push( buildStructuralSignature( checker.getTypeOfSymbolAtLocation( member, declaration ), checker, visited ));
            });
        }

        return `Enum<${symbol?.name || 'anonymous'}:${members.sort().join( ',' )}>`;
    }

    if( flags & ts.TypeFlags.TemplateLiteral ) 
    {
        const templateType = type as ts.TemplateLiteralType;

        return `TemplateLiteral<${templateType.texts.join( ',' )}|${templateType.types.map( t => buildStructuralSignature( t, checker, visited )).join( ',' )}>`;
    }

    if( checker.isTupleType( type ))
    {
        const target = ( type as ts.TupleTypeReference ).target || ( type as unknown as ts.TupleType );
        const elementFlags = target?.elementFlags || [];
        const typeArgs = ( type as ts.TupleTypeReference ).typeArguments || [];
        const parts = typeArgs.map(( t, i ) =>
        {
            const flag = elementFlags[i] || ts.ElementFlags.Required;
            const prefix = ( flag & ts.ElementFlags.Rest ) ? '...' : '';
            const suffix = ( flag & ts.ElementFlags.Optional ) ? '?' : '';

            return `${prefix}${buildStructuralSignature( t, checker, visited )}${suffix}`;
        });

        return `Tuple<${parts.join( ',' )}>`;
    }

    if( checker.isArrayType( type )) 
    {
        const elementType = ( type as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();

        return `Array<${buildStructuralSignature( elementType, checker, visited )}>`;
    }

    const typeSymbolName = type.getSymbol()?.name || type.aliasSymbol?.getName();

    if( typeSymbolName === 'Date' ) { return 'Date' }

    if( typeSymbolName === 'URL' ) { return 'URL' }

    if( typeSymbolName === 'RegExp' ) { return 'RegExp' }

    if( typeSymbolName === 'Promise' ) 
    {
        const valueType = ( type as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();

        return `Promise<${buildStructuralSignature( valueType, checker, visited )}>`;
    }

    if( typeSymbolName === 'Set' || typeSymbolName === 'ReadonlySet' ) 
    {
        const elementType = ( type as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();

        return `Set<${buildStructuralSignature( elementType, checker, visited )}>`;
    }

    if( typeSymbolName === 'Map' || typeSymbolName === 'ReadonlyMap' ) 
    {
        const keyType = ( type as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();
        const valueType = ( type as ts.TypeReference ).typeArguments?.[1] || checker.getAnyType();

        return `Map<${buildStructuralSignature( keyType, checker, visited )},${buildStructuralSignature( valueType, checker, visited )}>`;
    }

    if( typeSymbolName && BUFFER_LIKE.has( typeSymbolName )) 
    {
        return typeSymbolName;
    }

    const classIdentity = resolveClassIdentity( type );

    if( classIdentity )
    {
        return `Class<${classIdentity.name}${declarationSite( classIdentity.declaration )}>`;
    }

    if( flags & ts.TypeFlags.Object || type.isClassOrInterface()) 
    {
        const props = checker.getPropertiesOfType( type );
        const stringIndexInfo = checker.getIndexInfoOfType( type, ts.IndexKind.String );
        const patternInfos = getTemplateIndexInfos( type, checker );

        if( props.length === 0 && patternInfos.length === 0 ) 
        {
            // Handle Record or empty object
            if( stringIndexInfo ) { return `Record<${buildStructuralSignature( stringIndexInfo.type, checker, visited )}>` }
        }
        const propSigs = props.map( prop =>
        {
            const propType = getPropertyType( type, prop, checker );
            const isOptional = ( prop.getFlags() & ts.SymbolFlags.Optional ) !== 0;

            return `${prop.getName()}${isOptional ? '?' : ''}:${buildStructuralSignature( propType, checker, visited )}`;
        }).sort();
        const patternSig = patternInfos.length > 0
            ? patternInfos.map( p => `;[${p.pattern}]:${buildStructuralSignature( p.valueType, checker, visited )}` ).sort().join( '' )
            : '';
        const indexSig = stringIndexInfo
            ? `;[string]:${buildStructuralSignature( stringIndexInfo.type, checker, visited )}`
            : '';

        return `Object{${propSigs.join( ';' )}${patternSig}${indexSig}}`;
    }

    return 'any';
}

const hashByType = new WeakMap<object, string>();

export function generateHash( type: ts.Type, checker: ts.TypeChecker ): string 
{
    const cached = hashByType.get( type as object );

    if( cached ){ return cached }

    const structuralSig = buildStructuralSignature( type, checker );
    const hash = createHash( 'sha256' ).update( structuralSig ).digest( 'hex' ).substring( 0, 16 );
    hashByType.set( type as object, hash );

    return hash;
}

export function objectToAst( val: any ): ts.Expression 
{
    if( val === null ) { return ts.factory.createNull() }

    if( val === undefined ) { return ts.factory.createIdentifier( 'undefined' ) }

    if( typeof val === 'string' ) { return ts.factory.createStringLiteral( val ) }

    if( typeof val === 'number' ) { return ts.factory.createNumericLiteral( val.toString()) }

    if( typeof val === 'boolean' ) { return val ? ts.factory.createTrue() : ts.factory.createFalse() }

    if( typeof val === 'bigint' )
    {
        return val < 0n
            ? ts.factory.createPrefixUnaryExpression( ts.SyntaxKind.MinusToken, ts.factory.createBigIntLiteral(( -val ).toString() + 'n' ))
            : ts.factory.createBigIntLiteral( val.toString() + 'n' );
    }

    if( Array.isArray( val )) 
    {
        return ts.factory.createArrayLiteralExpression( val.map( objectToAst ));
    }

    if( typeof val === 'object' ) 
    {
        const properties = Object.entries( val ).map(([k, v]) =>
            ts.factory.createPropertyAssignment( ts.factory.createStringLiteral( k ), objectToAst( v ))
        );

        return ts.factory.createObjectLiteralExpression( properties, true );
    }

    return ts.factory.createIdentifier( 'undefined' );
}

interface IComplexityWalk
{
    visited      : Set<number>
    /** Counted rather than flagged, so one cyclic subtree does not block caching of later siblings. */
    circularHits : number
}

const complexityByType = new WeakMap<object, number>();

export function getTypeComplexity(
    type: ts.Type,
    checker: ts.TypeChecker,
    visited: Set<number>
): number 
{
    return complexityOf( type, checker, { visited, circularHits : 0 });
}

function complexityOf( type: ts.Type, checker: ts.TypeChecker, walk: IComplexityWalk ): number
{
    const typeId = ( type as any ).id;

    if( typeId && walk.visited.has( typeId )) 
    {
        walk.circularHits++;

        return 1;
    }

    const memo = complexityByType.get( type as object );

    if( memo !== undefined ){ return memo }

    if( typeId ) { walk.visited.add( typeId ) }

    const hits = walk.circularHits;

    try
    {
        const flags = type.getFlags();
        let complexity = 1;

        const isUnion = !( flags & ts.TypeFlags.Boolean ) && ((( flags & ts.TypeFlags.Union ) !== 0 || type.isUnion()) && ( type as any ).types ) ? true : false;
        const isIntersection = ((( flags & ts.TypeFlags.Intersection ) !== 0 || type.isIntersection()) && ( type as any ).types ) ? true : false;

        if( isUnion ) 
        {
            for( const t of ( type as ts.UnionType ).types ) 
            {
                complexity += complexityOf( t, checker, walk );
            }
        }
        else if( isIntersection ) 
        {
            for( const t of ( type as ts.IntersectionType ).types ) 
            {
                complexity += complexityOf( t, checker, walk );
            }
        }
        else if( checker.isArrayType( type )) 
        {
            const elementType = ( type as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();
            complexity += complexityOf( elementType, checker, walk );
        }
        else if( checker.isTupleType( type )) 
        {
            const elementTypes = ( type as ts.TypeReference ).typeArguments || [];

            for( const t of elementTypes ) 
            {
                complexity += complexityOf( t, checker, walk );
            }
        }
        else if( flags & ts.TypeFlags.Object || type.isClassOrInterface()) 
        {
            const name = type.getSymbol()?.name;

            if( name !== 'Date' && name !== 'URL' && name !== 'Set' && name !== 'ReadonlySet' && name !== 'Map' && name !== 'ReadonlyMap' && name !== 'RegExp' ) 
            {
                const props = checker.getPropertiesOfType( type );

                for( const prop of props ) 
                {
                    if( isTagKey( prop.getName())){ continue }

                    const propType = getPropertyType( type, prop, checker );
                    complexity += complexityOf( propType, checker, walk );
                }
            }
        }

        // Only an acyclic subtree has a complexity independent of the path that reached it.
        if( typeId && walk.circularHits === hits ) { complexityByType.set( type as object, complexity ) }

        return complexity;
    }
    finally
    {
        if( typeId ) { walk.visited.delete( typeId ) }
    }
}

export function preScanType(
    type: ts.Type,
    checker: ts.TypeChecker,
    counts: Map<string, number>,
    circularHashes: Set<string>,
    visited: Set<number>
) 
{
    const flags = type.getFlags();
    const typeId = ( type as any ).id;

    if( !typeId ) { return }

    if( visited.has( typeId )) 
    {
        const hash = generateHash( type, checker );
        circularHashes.add( hash );

        return;
    }
    visited.add( typeId );

    const isUnion = !( flags & ts.TypeFlags.Boolean ) && ((( flags & ts.TypeFlags.Union ) !== 0 || type.isUnion()) && ( type as any ).types ) ? true : false;
    const isIntersection = ((( flags & ts.TypeFlags.Intersection ) !== 0 || type.isIntersection()) && ( type as any ).types ) ? true : false;

    if( isUnion ) 
    {
        for( const t of ( type as ts.UnionType ).types ) 
        {
            preScanType( t, checker, counts, circularHashes, visited );
        }
    }
    else if( isIntersection ) 
    {
        for( const t of ( type as ts.IntersectionType ).types ) 
        {
            preScanType( t, checker, counts, circularHashes, visited );
        }
    }
    else if( checker.isArrayType( type )) 
    {
        const elementType = ( type as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();
        preScanType( elementType, checker, counts, circularHashes, visited );
    }
    else if( checker.isTupleType( type )) 
    {
        const elementTypes = ( type as ts.TypeReference ).typeArguments || [];

        for( const t of elementTypes ) 
        {
            preScanType( t, checker, counts, circularHashes, visited );
        }
    }
    else if( flags & ts.TypeFlags.Object || type.isClassOrInterface()) 
    {
        const name = type.getSymbol()?.name;

        if( name === 'Set' || name === 'ReadonlySet' )
        {
            const elementType = ( type as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();
            preScanType( elementType, checker, counts, circularHashes, visited );
        }
        else if( name === 'Map' || name === 'ReadonlyMap' )
        {
            const keyType = ( type as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();
            const valueType = ( type as ts.TypeReference ).typeArguments?.[1] || checker.getAnyType();
            preScanType( keyType, checker, counts, circularHashes, visited );
            preScanType( valueType, checker, counts, circularHashes, visited );
        }
        else if( name !== 'Date' && name !== 'URL' && name !== 'RegExp' && name !== 'Promise' && ( !name || !BUFFER_LIKE.has( name ))) 
        {
            const hash = generateHash( type, checker );
            counts.set( hash, ( counts.get( hash ) || 0 ) + 1 );

            const props = checker.getPropertiesOfType( type );

            for( const prop of props ) 
            {
                if( isTagKey( prop.getName())){ continue }

                const propType = getPropertyType( type, prop, checker );
                preScanType( propType, checker, counts, circularHashes, visited );
            }

            const stringIndexInfo = checker.getIndexInfoOfType( type, ts.IndexKind.String );

            if( stringIndexInfo )
            {
                preScanType( stringIndexInfo.type, checker, counts, circularHashes, visited );
            }

            for( const pInfo of getTemplateIndexInfos( type, checker ))
            {
                preScanType( pInfo.valueType, checker, counts, circularHashes, visited );
            }
        }
    }

    visited.delete( typeId );
}

export type JsonSchemaTarget = 'draft-07' | 'draft-2020-12' | 'openapi-3.0' | 'openapi-3.1';

export interface JsonSchemaOptions
{
    target? : JsonSchemaTarget
}

function transformSchemaNodeForTarget( node: any, target: JsonSchemaTarget ): any
{
    if( node === null || typeof node !== 'object' ){ return node }

    if( Array.isArray( node ))
    {
        return node.map( item => transformSchemaNodeForTarget( item, target ));
    }

    const out: Record<string, any> = {};

    for( const [ k, v ] of Object.entries( node ))
    {
        out[k] = transformSchemaNodeForTarget( v, target );
    }

    if( target === 'draft-2020-12' || target === 'openapi-3.1' )
    {
        if( out.type === 'array' && Array.isArray( out.items ))
        {
            out.prefixItems = out.items;

            if( out.additionalItems !== undefined )
            {
                out.items = out.additionalItems;
                delete out.additionalItems;
            }
            else
            {
                out.items = false;
            }
        }
    }
    else if( target === 'openapi-3.0' )
    {
        if( typeof out.$ref === 'string' && out.$ref.startsWith( '#/$defs/' ))
        {
            out.$ref = `#/components/schemas/${out.$ref.slice( '#/$defs/'.length )}`;
        }

        if( out.const !== undefined )
        {
            out.enum = [ out.const ];
            delete out.const;
        }

        if( Array.isArray( out.anyOf ) && out.anyOf.length === 2 )
        {
            const nullIdx = out.anyOf.findIndex(( arm: any ) => arm && typeof arm === 'object' && arm.type === 'null' && Object.keys( arm ).length === 1 );

            if( nullIdx !== -1 )
            {
                const other = out.anyOf[1 - nullIdx];

                if( other && typeof other === 'object' && !other.$ref )
                {
                    delete out.anyOf;
                    Object.assign( out, other, { nullable : true });
                }
            }
        }
    }

    return out;
}

function applyJsonSchemaTarget( root: any, target: JsonSchemaTarget | undefined ): JsonSchema
{
    if( !target || target === 'draft-07' ){ return root }

    const transformed = transformSchemaNodeForTarget( root, target );

    if( target === 'draft-2020-12' )
    {
        return {
            $schema : 'https://json-schema.org/draft/2020-12/schema',
            ...transformed
        };
    }

    if( target === 'openapi-3.1' )
    {
        return {
            $schema : 'https://spec.openapis.org/oas/3.1/dialect/base',
            ...transformed
        };
    }

    if( target === 'openapi-3.0' )
    {
        if( transformed.$defs )
        {
            const schemas = transformed.$defs;
            delete transformed.$defs;
            transformed.components = { schemas };
        }

        return transformed;
    }

    return transformed;
}

export function buildJsonSchema( type: ts.Type, checker: ts.TypeChecker, options?: JsonSchemaOptions ): JsonSchema
{
    const defs: Record<string, any> = {};
    const visited = new Map<number, string>();
    const counts = new Map<string, number>();
    const circularHashes = new Set<string>();
    preScanType( type, checker, counts, circularHashes, new Set<number>());

    const rootSchema = buildJsonSchemaInternal( type, checker, defs, visited, counts, circularHashes );
    let result: JsonSchema;

    if( Object.keys( defs ).length > 0 ) 
    {
        const rootSymbol = type.getSymbol() || type.aliasSymbol;
        const rootName = rootSymbol ? rootSymbol.getName() : 'Root';
        const rootHash = generateHash( type, checker );
        const rootDefName = `${rootName}_${rootHash}`;

        if( defs[rootDefName]) 
        {
            result = {
                $ref  : `#/$defs/${rootDefName}`,
                $defs : defs
            };
        }
        else 
        {
            result = {
                ...rootSchema,
                $defs : defs
            };
        }
    }
    else
    {
        result = rootSchema;
    }

    return applyJsonSchemaTarget( result, options?.target );
}

function buildJsonSchemaInternal(
    type: ts.Type,
    checker: ts.TypeChecker,
    defs: Record<string, any>,
    visited: Map<number, string>,
    counts: Map<string, number>,
    circularHashes: Set<string>
): any 
{
    const flags = type.getFlags();
    const typeId = ( type as any ).id;

    if( typeId && visited.has( typeId )) 
    {
        return { $ref : `#/$defs/${visited.get( typeId )}` };
    }

    const isUnion = !( flags & ts.TypeFlags.Boolean ) && ((( flags & ts.TypeFlags.Union ) !== 0 || type.isUnion()) && ( type as any ).types ) ? true : false;
    const isIntersection = ((( flags & ts.TypeFlags.Intersection ) !== 0 || type.isIntersection()) && ( type as any ).types ) ? true : false;

    if( isUnion ) 
    {
        const typeHash = circularHashes.size > 0 ? generateHash( type, checker ) : '';
        const isCircularUnion = typeHash !== '' && circularHashes.has( typeHash );
        const unionSymbol = type.aliasSymbol || type.getSymbol();
        const unionDefName = `${unionSymbol ? unionSymbol.getName() : 'Union'}_${typeHash}`;

        if( isCircularUnion )
        {
            if( defs[unionDefName])
            {
                return { $ref : `#/$defs/${unionDefName}` };
            }

            if( typeId ){ visited.set( typeId, unionDefName ) }
        }

        const types = ( type as ts.UnionType ).types;
        const isBoolUnion = types.length === 2 &&
            types.every( t => ( t.getFlags() & ts.TypeFlags.BooleanLiteral ) !== 0 );

        let unionSchema: any;

        if( isBoolUnion ) 
        {
            unionSchema = { type : 'boolean' };
        }
        else
        {
            const boolLiterals = types.filter( t => ( t.getFlags() & ts.TypeFlags.BooleanLiteral ) !== 0 );

            if( boolLiterals.length === 2 )
            {
                const nonBoolTypes = types.filter( t => ( t.getFlags() & ts.TypeFlags.BooleanLiteral ) === 0 );
                unionSchema = {
                    anyOf : [
                        ...nonBoolTypes.map( t => buildJsonSchemaInternal( t, checker, defs, visited, counts, circularHashes )),
                        { type : 'boolean' }
                    ]
                };
            }
            else
            {
                unionSchema = {
                    anyOf : types.map( t => buildJsonSchemaInternal( t, checker, defs, visited, counts, circularHashes ))
                };
            }
        }

        if( isCircularUnion )
        {
            if( typeId ){ visited.delete( typeId ) }

            defs[unionDefName] = unionSchema;

            return { $ref : `#/$defs/${unionDefName}` };
        }

        return unionSchema;
    }

    if( isIntersection ) 
    {
        const types = ( type as ts.IntersectionType ).types;
        let baseSchema: any = {};
        const constraints: Record<string, any> = {};
        const memberSchemas: any[] = [];

        for( const sub of types ) 
        {
            const sFlags = sub.getFlags();

            if( isConstraintOnlyType( sub, checker )) 
            {
                applyConstraintsToJsonSchema(
                    constraints,
                    collectConstraintsFromProps( getTypeProps( sub, checker ), checker ),
                    checker,
                    defs,
                    visited,
                    counts,
                    circularHashes
                );
                continue;
            }

            if( isBrandOnlyType( sub, checker ))
            {
                continue;
            }

            if( sFlags & ts.TypeFlags.TemplateLiteral )
            {
                baseSchema = {
                    type    : 'string',
                    pattern : buildTemplateLiteralRegex( sub as ts.TemplateLiteralType )
                };
            }
            else if( sFlags & ts.TypeFlags.String ) 
            {
                baseSchema = { type : 'string' };
            }
            else if( sFlags & ts.TypeFlags.Number ) 
            {
                baseSchema = { type : 'number' };
            }
            else if( sFlags & ts.TypeFlags.BigInt ) 
            {
                baseSchema = { 'x-typescript-type' : 'bigint' };
            }
            else if( sFlags & ts.TypeFlags.Boolean || ( sub as any ).intrinsicName === 'boolean' ) 
            {
                baseSchema = { type : 'boolean' };
            }
            else if( sub.getSymbol()?.name === 'Date' ) 
            {
                baseSchema = { 'x-typescript-type' : 'Date' };
            }
            else if( sub.getSymbol()?.name === 'URL' )
            {
                baseSchema = { type : 'string', format : 'uri', 'x-typescript-type' : 'URL' };
            }
            else if( sub.getSymbol()?.name === 'RegExp' ) 
            {
                baseSchema = { 'x-typescript-type' : 'RegExp' };
            }
            else if( sub.getSymbol()?.name === 'Set' || sub.getSymbol()?.name === 'ReadonlySet' ) 
            {
                const elementType = ( sub as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();
                baseSchema = {
                    'x-typescript-type' : 'Set',
                    items               : buildJsonSchemaInternal( elementType, checker, defs, visited, counts, circularHashes )
                };
            }
            else if( sub.getSymbol()?.name === 'Map' || sub.getSymbol()?.name === 'ReadonlyMap' ) 
            {
                const keyType = ( sub as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();
                const valueType = ( sub as ts.TypeReference ).typeArguments?.[1] || checker.getAnyType();
                baseSchema = {
                    'x-typescript-type' : 'Map',
                    key                 : buildJsonSchemaInternal( keyType, checker, defs, visited, counts, circularHashes ),
                    value               : buildJsonSchemaInternal( valueType, checker, defs, visited, counts, circularHashes )
                };
            }
            else if( checker.isArrayType( sub )) 
            {
                const elementType = ( sub as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();
                baseSchema = { type : 'array', items : buildJsonSchemaInternal( elementType, checker, defs, visited, counts, circularHashes ) };
            }
            else if(( sFlags & ts.TypeFlags.Object ) || sub.isClassOrInterface()) 
            {
                memberSchemas.push( buildJsonSchemaInternal( sub, checker, defs, visited, counts, circularHashes ));
            }
        }

        if( memberSchemas.length > 1 ) 
        {
            return { allOf : memberSchemas, ...constraints };
        }

        if( memberSchemas.length === 1 ) 
        {
            return { ...memberSchemas[0], ...constraints };
        }

        return { ...baseSchema, ...constraints };
    }

    if( type.getSymbol()?.name === 'Date' ) 
    {
        return { 'x-typescript-type' : 'Date' };
    }

    if( type.getSymbol()?.name === 'URL' )
    {
        return { type : 'string', format : 'uri', 'x-typescript-type' : 'URL' };
    }

    if( type.getSymbol()?.name === 'RegExp' ) 
    {
        return { 'x-typescript-type' : 'RegExp' };
    }

    if( type.getSymbol()?.name === 'Promise' ) 
    {
        return { 'x-typescript-type' : 'Promise' };
    }

    {
        const typedName = type.getSymbol()?.name;

        if( typedName && BUFFER_LIKE.has( typedName )) 
        {
            return { 'x-typescript-type' : typedName };
        }
    }

    if( type.getSymbol()?.name === 'Set' || type.getSymbol()?.name === 'ReadonlySet' ) 
    {
        const elementType = ( type as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();

        return {
            'x-typescript-type' : 'Set',
            items               : buildJsonSchemaInternal( elementType, checker, defs, visited, counts, circularHashes )
        };
    }

    if( type.getSymbol()?.name === 'Map' || type.getSymbol()?.name === 'ReadonlyMap' ) 
    {
        const keyType = ( type as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();
        const valueType = ( type as ts.TypeReference ).typeArguments?.[1] || checker.getAnyType();

        return {
            'x-typescript-type' : 'Map',
            key                 : buildJsonSchemaInternal( keyType, checker, defs, visited, counts, circularHashes ),
            value               : buildJsonSchemaInternal( valueType, checker, defs, visited, counts, circularHashes )
        };
    }

    if( flags & ts.TypeFlags.Null ) 
    {
        return { type : 'null' };
    }

    if( flags & ts.TypeFlags.Undefined || flags & ts.TypeFlags.Void ) 
    {
        return { 'x-typescript-type' : 'undefined' };
    }

    if( flags & ts.TypeFlags.Never )
    {
        return { not : {} };
    }

    if( flags & ts.TypeFlags.TemplateLiteral )
    {
        return {
            type    : 'string',
            pattern : buildTemplateLiteralRegex( type as ts.TemplateLiteralType )
        };
    }

    if( flags & ts.TypeFlags.String ) 
    {
        return { type : 'string' };
    }

    if( flags & ts.TypeFlags.Number ) 
    {
        return { type : 'number' };
    }

    if( flags & ts.TypeFlags.BigInt ) 
    {
        return { 'x-typescript-type' : 'bigint' };
    }

    if( flags & ts.TypeFlags.Boolean || ( type as any ).intrinsicName === 'boolean' ) 
    {
        return { type : 'boolean' };
    }

    if( type.isStringLiteral()) 
    {
        return { type : 'string', const : type.value };
    }

    if( type.isNumberLiteral()) 
    {
        return { type : 'number', const : type.value };
    }

    if( flags & ts.TypeFlags.BigIntLiteral ) 
    {
        return { type : 'integer', const : ( type as any ).value };
    }

    if( flags & ts.TypeFlags.BooleanLiteral ) 
    {
        return { type : 'boolean', const : ( type as any ).intrinsicName === 'true' };
    }

    if( checker.isArrayType( type )) 
    {
        const elementType = ( type as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();

        return {
            type  : 'array',
            items : buildJsonSchemaInternal( elementType, checker, defs, visited, counts, circularHashes )
        };
    }

    if( checker.isTupleType( type )) 
    {
        const typeHash = circularHashes.size > 0 ? generateHash( type, checker ) : '';
        const isCircularTuple = typeHash !== '' && circularHashes.has( typeHash );
        const tupleSymbol = type.aliasSymbol || type.getSymbol();
        const tupleDefName = `${tupleSymbol ? tupleSymbol.getName() : 'Tuple'}_${typeHash}`;

        if( isCircularTuple )
        {
            if( defs[tupleDefName])
            {
                return { $ref : `#/$defs/${tupleDefName}` };
            }

            if( typeId ){ visited.set( typeId, tupleDefName ) }
        }

        const { typeArgs : elementTypes, elementFlags, hasRest, fixedCount, minItems } = inspectTupleType( type, checker );

        let tupleSchema: any;

        if( hasRest && elementTypes.length > 0 )
        {
            const fixedTypes = elementTypes.slice( 0, fixedCount );
            const restType = elementTypes[elementTypes.length - 1];
            tupleSchema = {
                minItems,
                type  : 'array',
                items : fixedTypes.map(( t, i ) =>
                    buildJsonSchemaInternal(
                        ( elementFlags[i] & ts.ElementFlags.Optional ) ? stripUndefinedFromUnion( t ) : t,
                        checker,
                        defs,
                        visited,
                        counts,
                        circularHashes
                    )
                ),
                additionalItems : buildJsonSchemaInternal( restType, checker, defs, visited, counts, circularHashes )
            };
        }
        else
        {
            tupleSchema = {
                minItems,
                maxItems : elementTypes.length,
                type     : 'array',
                items    : elementTypes.map(( t, i ) =>
                    buildJsonSchemaInternal(
                        ( elementFlags[i] & ts.ElementFlags.Optional ) ? stripUndefinedFromUnion( t ) : t,
                        checker,
                        defs,
                        visited,
                        counts,
                        circularHashes
                    )
                )
            };
        }

        if( isCircularTuple )
        {
            if( typeId ){ visited.delete( typeId ) }

            defs[tupleDefName] = tupleSchema;

            return { $ref : `#/$defs/${tupleDefName}` };
        }

        return tupleSchema;
    }

    if( flags & ts.TypeFlags.NonPrimitive )
    {
        return { type : 'object' };
    }

    // Object types
    if( flags & ts.TypeFlags.Object || type.isClassOrInterface()) 
    {
        const stringIndexInfo = checker.getIndexInfoOfType( type, ts.IndexKind.String );
        const symbol = type.getSymbol() || type.aliasSymbol;
        const name = symbol ? symbol.getName() : 'Object';
        const typeHash = generateHash( type, checker );
        const defName = `${name}_${typeHash}`;

        if( defs[defName]) 
        {
            return { $ref : `#/$defs/${defName}` };
        }

        if( typeId && visited.has( typeId )) 
        {
            return { $ref : `#/$defs/${defName}` };
        }

        if( typeId ) { visited.set( typeId, defName ) }

        const properties: Record<string, any> = {};
        const required: string[] = [];
        const props = checker.getPropertiesOfType( type );
        let hasInterfaceTags = false;

        for( const prop of props )
        {
            const pName = prop.getName();

            if( isTagKey( pName ))
            {
                hasInterfaceTags = true;
                continue;
            }

            const isOptional = ( prop.flags & ts.SymbolFlags.Optional ) !== 0;
            const propType = getPropertyType( type, prop, checker );
            const effectivePropType = isOptional ? stripUndefinedFromUnion( propType ) : propType;

            properties[pName] = buildJsonSchemaInternal( effectivePropType, checker, defs, visited, counts, circularHashes );

            if( !isOptional ) 
            {
                required.push( pName );
            }
        }

        const schemaObj: any = {
            type : 'object',
            properties
        };

        const patternInfos = getTemplateIndexInfos( type, checker );

        if( patternInfos.length > 0 )
        {
            const patternProperties: Record<string, any> = {};

            for( const pInfo of patternInfos )
            {
                patternProperties[pInfo.pattern] = buildJsonSchemaInternal( pInfo.valueType, checker, defs, visited, counts, circularHashes );
            }

            schemaObj.patternProperties = patternProperties;
        }

        if( stringIndexInfo ) 
        {
            schemaObj.additionalProperties = buildJsonSchemaInternal( stringIndexInfo.type, checker, defs, visited, counts, circularHashes );
        }
        else 
        {
            schemaObj.additionalProperties = false;
        }

        if( required.length > 0 ) 
        {
            schemaObj.required = required;
        }

        if( hasInterfaceTags )
        {
            applyConstraintsToJsonSchema(
                schemaObj,
                collectConstraintsFromProps( props, checker ),
                checker,
                defs,
                visited,
                counts,
                circularHashes
            );
        }

        if( typeId ) { visited.delete( typeId ) }

        const isCircular = circularHashes.has( typeHash );
        const refCount = counts.get( typeHash ) || 0;
        const complexity = getTypeComplexity( type, checker, new Set<number>());
        const score = refCount * complexity;

        if( isCircular || score >= 128 ) 
        {
            defs[defName] = schemaObj;

            return { $ref : `#/$defs/${defName}` };
        }

        return schemaObj;
    }

    return {};
}
