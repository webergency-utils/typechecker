import ts from 'typescript';
import type { JsonSchema, UnionResolution } from '../runtime/validators.js';
import type { CasingFormat } from '../runtime/casing.js';
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
    createStringMappingCheck,
    createTemplateLiteralCheck,
    createConstrainedPrimitiveCheck,
    createSecretCheck,
    createNumericAst,
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
    assertNotTypeParameter,
    bigIntLiteralText,
    BUFFER_LIKE,
    buildTemplateLiteralRegex,
    buildWirePropertyMap,
    collectConstraintsFromProps,
    enumMemberTypes,
    extractPropertyJsDocInfo,
    extractTypeJsDocInfo,
    getPropertyType,
    getTemplateIndexInfos,
    getTypeProps,
    hasJsDocMetadata,
    inspectTupleType,
    isBrandOnlyType,
    isConstraintOnlyType,
    isIgnoredPropertySymbol,
    isNativeEnumType,
    isTagKey,
    mergeConstraintsWithJsDoc,
    minifyTypeString,
    peelTaggedIntersection,
    resolveWirePropertyName,
    stripUndefinedFromUnion,
    tryMergeObjectTypes,
    tryTaggedUnionTypes,
    typeHasDefaultTag,
    typeHasSecretTag,
    typeSymbolName,
    VERBATIM_CUSTOM_SCOPE,
    type JsDocMetadata,
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

function applyJsDocMetadataToJsonSchema( target: Record<string, any>, meta: JsDocMetadata | undefined ): void
{
    if( !meta || !hasJsDocMetadata( meta )){ return }

    if( meta.title !== undefined && target.title === undefined )
    {
        target.title = meta.title;
    }

    if( meta.description !== undefined && target.description === undefined )
    {
        target.description = meta.description;
    }

    if( meta.hasDefault && target.default === undefined )
    {
        target.default = typeof meta.default === 'bigint' ? meta.default.toString() : meta.default;
    }

    if( meta.examples && meta.examples.length > 0 && target.examples === undefined )
    {
        target.examples = meta.examples.slice();
    }

    if( meta.deprecated === true && target.deprecated === undefined )
    {
        target.deprecated = true;
    }

    if( meta.readOnly === true && target.readOnly === undefined )
    {
        target.readOnly = true;
    }

    if( meta.writeOnly === true && target.writeOnly === undefined )
    {
        target.writeOnly = true;
    }

    if( meta.secret === true )
    {
        if( target.writeOnly === undefined ){ target.writeOnly = true }

        if( target['x-secret'] === undefined ){ target['x-secret'] = true }
    }
}

/** Map peeled tag constraints onto JSON Schema / x-extension fields. */
function applyConstraintsToJsonSchema(
    target          : Record<string, any>,
    constraints     : ParsedConstraint[],
    checker?        : ts.TypeChecker,
    defs?           : Record<string, any>,
    visited?        : Map<number, string>,
    counts?         : Map<string, number>,
    circularHashes? : Set<string>,
    options?        : JsonSchemaOptions
): void
{
    for( const c of constraints )
    {
        if( c.type === 'default' )
        {
            target.default = typeof c.value === 'bigint' ? Number( c.value ) : c.value;
        }
        else if( c.type === 'requires' )
        {
            const casing = options?.propertyCasing;

            if( casing )
            {
                target.requires = Array.isArray( c.value )
                    ? c.value.map( k => resolveWirePropertyName( String( k ), casing ))
                    : resolveWirePropertyName( String( c.value ), casing );
            }
            else
            {
                target.requires = c.value;
            }
        }
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
        else if( c.type === 'readOnly' ){ target.readOnly = true }
        else if( c.type === 'writeOnly' ){ target.writeOnly = true }
        else if( c.type === 'secret' )
        {
            target.writeOnly = true;
            target['x-secret'] = true;
        }
        else if( c.type === 'contains' && c.nestedType && checker && defs && visited && counts && circularHashes )
        {
            target.contains = buildJsonSchemaInternal(
                c.nestedType, checker, defs, visited, counts, circularHashes, options
            );
        }
        else if( c.type === 'propertyNames' && c.nestedType && checker && defs && visited && counts && circularHashes )
        {
            target.propertyNames = buildJsonSchemaInternal(
                c.nestedType, checker, defs, visited, counts, circularHashes, options
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

function isDirectConstrainedBase( type: ts.Type, kind: { baseName : string, baseType? : ts.Type } | undefined ): kind is { baseName : string, baseType? : ts.Type }
{
    if( !kind ){ return false }

    if( kind.baseName === 'array' || kind.baseName === 'set' || kind.baseName === 'map' ){ return false }

    const flags = typeof type.getFlags === 'function' ? type.getFlags() : 0;

    if( flags & ( ts.TypeFlags.TemplateLiteral | ts.TypeFlags.StringMapping | ts.TypeFlags.Union | ts.TypeFlags.Intersection ))
    {
        return false;
    }

    if(
        typeof type.isStringLiteral === 'function' && type.isStringLiteral() ||
        typeof type.isNumberLiteral === 'function' && type.isNumberLiteral() ||
        ( flags & ( ts.TypeFlags.BooleanLiteral | ts.TypeFlags.BigIntLiteral )) !== 0 && !( flags & ts.TypeFlags.Boolean )
    )
    {
        return false;
    }

    return true;
}

function wrapPropValidatorWithJsDoc(
    propType          : ts.Type,
    jsdocConstraints  : ParsedConstraint[] | undefined,
    baseValidator     : ts.Expression,
    checker           : ts.TypeChecker,
    validatorsMap     : Map<string, ts.Expression>,
    scope             : ICustomFunctionScope,
    unionResolution   : UnionResolution
): ts.Expression
{
    if( !jsdocConstraints || jsdocConstraints.length === 0 ){ return baseValidator }

    // Filter out constraints already enforced by phantom tags on propType
    let existingTagTypes = new Set<string>();

    if( typeof propType.isIntersection === 'function' && propType.isIntersection())
    {
        const peeled = peelTaggedIntersection( propType, checker, scope );

        if( peeled )
        {
            existingTagTypes = new Set( peeled.constraints.map( c => c.type ));
        }
    }

    const extra = jsdocConstraints.filter( c => !existingTagTypes.has( c.type ));

    if( extra.length === 0 ){ return baseValidator }

    const attached = attachNestedConstraintChecks( extra, checker, validatorsMap, scope, unionResolution );
    const kind = constrainedBaseKind( propType, checker );

    if( isDirectConstrainedBase( propType, kind ))
    {
        return createConstrainedPrimitiveCheck( kind.baseName, attached );
    }

    return createConstrainedPrimitiveCheck( 'any', attached, baseValidator );
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
        return wrapOptionTransform( createPrimitiveCheck( 'number' ), 'number' );
    }

    if( checks.length === 1 ){ return checks[0] }

    return createUnionCheck( checks, `Type<${minifyTypeString( checker.typeToString( type ))}>` );
}

function tryMergeObjectIntersection(
    types            : readonly ts.Type[],
    checker          : ts.TypeChecker,
    validatorsMap    : Map<string, ts.Expression>,
    expected         : string,
    scope            : ICustomFunctionScope,
    unionResolution  : UnionResolution = 'specificity',
    intersectionType?: ts.Type
): ts.Expression | undefined
{
    const merged = tryMergeObjectTypes( types, checker, intersectionType );

    if( !merged ){ return undefined }

    const props = merged.props.map( prop =>
    {
        const baseVal = buildValidatorScoped( prop.type, checker, validatorsMap, scope, undefined, unionResolution );
        let validator = wrapPropValidatorWithJsDoc( prop.type, prop.jsdocConstraints, baseVal, checker, validatorsMap, scope, unionResolution );

        if( prop.isSecret && !typeHasSecretTag( prop.type, checker ))
        {
            validator = createSecretCheck( validator );
        }

        return {
            name       : prop.name,
            isOptional : prop.isOptional,
            validator,
            hasDefault : prop.hasDefault,
            isReadOnly : prop.isReadOnly
        };
    });
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

    if( flags & ( ts.TypeFlags.String | ts.TypeFlags.TemplateLiteral | ts.TypeFlags.StringMapping ))
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
    assertNotTypeParameter( type );

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
    const appliedTagConstraintTypes = new Set<string>();

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
            for( const c of peeled.constraints ){ appliedTagConstraintTypes.add( c.type ) }

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
                else if( kind.baseType && ( kind.baseType.getFlags() & ts.TypeFlags.StringMapping ))
                {
                    const baseValidator = createStringMappingCheck( typeSymbolName( kind.baseType ), checker.typeToString( kind.baseType ));
                    result = createConstrainedPrimitiveCheck( kind.baseName, constraints, baseValidator );
                }
                else
                {
                    result = createConstrainedPrimitiveCheck( kind.baseName, constraints );
                }
            }
            else
            {
                const nonConstraintTypes = types.filter( t => !isConstraintOnlyType( t, checker ) && !isBrandOnlyType( t, checker ));
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
                        unionResolution,
                        type
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
                    const merged = tryMergeObjectIntersection( types, checker, validatorsMap, expected, scope, unionResolution, type );
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
            const merged = tryMergeObjectIntersection( types, checker, validatorsMap, expected, scope, unionResolution, type );

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
    else if( type.getSymbol()?.name === 'File' || type.getSymbol()?.name === 'Blob' )
    {
        result = wrapOptionTransform( createInstanceOfCheck( type.getSymbol()!.name ), 'instance' );
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
    else if( flags & ts.TypeFlags.StringMapping )
    {
        result = wrapOptionTransform( createStringMappingCheck( typeSymbolName( type ), checker.typeToString( type )), 'string' );
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
        const { typeArgs, elementFlags, hasRest, hasOptional, fixedCount, minItems, restType, suffixTypes } = inspectTupleType( type, checker );

        if( hasRest && restType )
        {
            const fixedArgs = typeArgs.slice( 0, fixedCount );
            const minPrefix = minItems - suffixTypes.length;
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
            const suffixChecks = suffixTypes.length > 0
                ? suffixTypes.map( t => buildValidatorScoped( t, checker, validatorsMap, scope, undefined, unionResolution ))
                : undefined;
            result = createTupleCheck( checks, minPrefix, restValidator, suffixChecks );
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
    else if( type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0 || typeSymbolName( type ) === 'Function' ) 
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
            const props = ir.getProps().map( p =>
            {
                const baseVal = buildValidatorScoped( p.type, checker, validatorsMap, scope, undefined, unionResolution );
                let validator = wrapPropValidatorWithJsDoc( p.type, p.jsdocConstraints, baseVal, checker, validatorsMap, scope, unionResolution );

                if( p.isSecret && !typeHasSecretTag( p.type, checker ))
                {
                    validator = createSecretCheck( validator );
                }

                return {
                    name       : p.name,
                    isOptional : p.isOptional,
                    validator,
                    hasDefault : p.hasDefault,
                    isReadOnly : p.isReadOnly
                };
            });
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
            else if( flags & ts.TypeFlags.Object || type.isClassOrInterface() || stringIndexInfo || patternChecks )
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

                for( const c of rawConstraints ){ appliedTagConstraintTypes.add( c.type ) }

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

    if( !isUnion )
    {
        const typeJsDoc = extractTypeJsDocInfo( type, checker );
        const extraTypeConstraints = typeJsDoc.constraints.filter( c => !appliedTagConstraintTypes.has( c.type ));

        if( extraTypeConstraints.length > 0 )
        {
            const attached = attachNestedConstraintChecks( extraTypeConstraints, checker, validatorsMap, scope, unionResolution );
            const kind = constrainedBaseKind( type, checker );

            if( isDirectConstrainedBase( type, kind ))
            {
                result = createConstrainedPrimitiveCheck( kind.baseName, attached );
            }
            else
            {
                result = createConstrainedPrimitiveCheck( 'any', attached, result );
            }
        }

        if( typeJsDoc.metadata.secret && !appliedTagConstraintTypes.has( 'secret' ))
        {
            result = createSecretCheck( result );
        }
    }

    validatorsMap.delete( resolvedHash );
    validatorsMap.set( resolvedHash, result );

    return ts.factory.createIdentifier( `__val_${resolvedHash}` );
}

function serializeJsDocForSignature( type: ts.Type, checker: ts.TypeChecker ): string
{
    const info = extractTypeJsDocInfo( type, checker );
    const parts: string[] = [];

    if( info.constraints.length > 0 )
    {
        parts.push( info.constraints.map( c => `${c.type}=${String( c.value ?? '' )}` ).join( ',' ));
    }

    if( hasJsDocMetadata( info.metadata ))
    {
        const m = info.metadata;
        parts.push( JSON.stringify([ m.title, m.description, m.hasDefault ? String( m.default ) : undefined, m.examples, m.deprecated, m.readOnly, m.writeOnly, m.secret ]));
    }

    return parts.length > 0 ? `@jsdoc(${parts.join( '|' )})` : '';
}

function stringMappingPattern( kind: string | undefined ): string
{
    if( kind === 'Uppercase' ){ return '^[^a-z]*$' }

    if( kind === 'Lowercase' ){ return '^[^A-Z]*$' }

    if( kind === 'Capitalize' ){ return '^(?:[^a-z][\\s\\S]*)?$' }

    if( kind === 'Uncapitalize' ){ return '^(?:[^A-Z][\\s\\S]*)?$' }

    return '^[\\s\\S]*$';
}

function applyJsDocConstraintsToSchema(
    schemaObj      : Record<string, any>,
    constraints    : ParsedConstraint[] | undefined,
    checker        : ts.TypeChecker,
    defs           : Record<string, any>,
    visited        : Map<number, string>,
    counts         : Map<string, number>,
    circularHashes : Set<string>,
    options?       : JsonSchemaOptions
): void
{
    if( !constraints || constraints.length === 0 ){ return }

    const filtered = constraints.filter( c => c.type === 'tags' || schemaObj[c.type] === undefined );

    if( filtered.length === 0 ){ return }

    applyConstraintsToJsonSchema( schemaObj, filtered, checker, defs, visited, counts, circularHashes, options );
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
        const signature = `${signatureOf( type, checker, visited )}${serializeJsDocForSignature( type, checker )}`;

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
        return `Union<${( type as ts.UnionType ).types.map( t => buildStructuralSignature( t, checker, visited )).join( ',' )}>`;
    }

    if(( flags & ts.TypeFlags.Intersection ) && ( type as any ).types ) 
    {
        return `Intersection<${( type as ts.IntersectionType ).types.map( t => buildStructuralSignature( t, checker, visited )).join( ',' )}>`;
    }

    if( type.isStringLiteral()) { return `S:${type.value.length}:"${type.value}"` }

    if( type.isNumberLiteral()) { return `N:${type.value}` }

    if( flags & ts.TypeFlags.BigIntLiteral ) { return `B:${checker.typeToString( type )}` }

    if( flags & ts.TypeFlags.BooleanLiteral ) { return `L:${( type as any ).intrinsicName}` }

    if( flags & ts.TypeFlags.StringMapping )
    {
        const inner = ( type as ts.StringMappingType ).type;
        const innerSig = inner ? buildStructuralSignature( inner, checker, visited ) : 'string';

        return `StringMapping<${typeSymbolName( type ) || 'Uppercase'}:${innerSig}>`;
    }

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

    if( type.getConstructSignatures().length > 0 || typeSymbolName( type ) === 'Function' )
    {
        return `ctor<${typeSymbolName( type ) || 'Function'}>`;
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

        if( members.length === 0 )
        {
            return `EnumMember<${symbol?.name || 'anonymous'}:${checker.typeToString( type )}>`;
        }

        return `Enum<${symbol?.name || 'anonymous'}:${members.join( ',' )}>`;
    }

    if( flags & ts.TypeFlags.TemplateLiteral ) 
    {
        const templateType = type as ts.TemplateLiteralType;

        return `TemplateLiteral<${templateType.texts.map( t => `${t.length}:${t}` ).join( ',' )}|${templateType.types.map( t => buildStructuralSignature( t, checker, visited )).join( ',' )}>`;
    }

    if( checker.isTupleType( type ))
    {
        const target = ( type as ts.TupleTypeReference ).target || ( type as unknown as ts.TupleType );
        const elementFlags = target?.elementFlags || [];
        const typeArgs = ( type as ts.TupleTypeReference ).typeArguments || [];
        const parts = typeArgs.map(( t, i ) =>
        {
            const flag = elementFlags[i] || ts.ElementFlags.Required;
            const prefix = ( flag & ( ts.ElementFlags.Rest | ts.ElementFlags.Variadic )) ? '...' : '';
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

    const symName = type.getSymbol()?.name || type.aliasSymbol?.getName();

    if( symName === 'Date' ) { return 'Date' }

    if( symName === 'URL' ) { return 'URL' }

    if( symName === 'RegExp' ) { return 'RegExp' }

    if( symName === 'File' ) { return 'File' }

    if( symName === 'Blob' ) { return 'Blob' }

    if( symName === 'Promise' ) 
    {
        const valueType = ( type as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();

        return `Promise<${buildStructuralSignature( valueType, checker, visited )}>`;
    }

    if( symName === 'Set' || symName === 'ReadonlySet' ) 
    {
        const elementType = ( type as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();

        return `Set<${buildStructuralSignature( elementType, checker, visited )}>`;
    }

    if( symName === 'Map' || symName === 'ReadonlyMap' ) 
    {
        const keyType = ( type as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();
        const valueType = ( type as ts.TypeReference ).typeArguments?.[1] || checker.getAnyType();

        return `Map<${buildStructuralSignature( keyType, checker, visited )},${buildStructuralSignature( valueType, checker, visited )}>`;
    }

    if( symName && BUFFER_LIKE.has( symName )) 
    {
        return symName;
    }

    const classIdentity = resolveClassIdentity( type );

    if( classIdentity )
    {
        return `Class<${classIdentity.name}${declarationSite( classIdentity.declaration )}>`;
    }

    if( flags & ts.TypeFlags.Object || type.isClassOrInterface()) 
    {
        const props = checker.getPropertiesOfType( type ).filter( p =>
        {
            const n = p.getName();

            return !n.startsWith( '__@' ) && !n.startsWith( '#' ) && !n.startsWith( '__#' );
        });
        const stringIndexInfo = checker.getIndexInfoOfType( type, ts.IndexKind.String );
        const patternInfos = getTemplateIndexInfos( type, checker );

        if( props.length === 0 && patternInfos.length === 0 ) 
        {
            // Handle Record or empty object
            if( stringIndexInfo ) { return `Record<${buildStructuralSignature( stringIndexInfo.type, checker, visited )}>` }
        }
        const propSigs = props.map( prop =>
        {
            const pName = prop.getName();
            const propType = getPropertyType( type, prop, checker );
            const isOptional = ( prop.getFlags() & ts.SymbolFlags.Optional ) !== 0;
            const propJsDoc = isTagKey( pName ) ? undefined : extractPropertyJsDocInfo( prop, checker );
            const jsdocPart = propJsDoc && ( propJsDoc.constraints.length > 0 || hasJsDocMetadata( propJsDoc.metadata ))
                ? `@j(${propJsDoc.constraints.map( c => `${c.type}=${String( c.value ?? '' )}` ).join( ',' )}|${JSON.stringify( propJsDoc.metadata )})`
                : '';

            return `${pName.length}:${pName}${isOptional ? '?' : ''}:${buildStructuralSignature( propType, checker, visited )}${jsdocPart}`;
        }).sort();
        const patternSig = patternInfos.length > 0
            ? patternInfos.map( p => `;[${p.pattern.length}:${p.pattern}]:${buildStructuralSignature( p.valueType, checker, visited )}` ).sort().join( '' )
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

    if( typeof val === 'number' ) { return createNumericAst( val ) }

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

            if( name !== 'Date' && name !== 'URL' && name !== 'Set' && name !== 'ReadonlySet' && name !== 'Map' && name !== 'ReadonlyMap' && name !== 'RegExp' && name !== 'File' && name !== 'Blob' ) 
            {
                const isClassInst = resolveClassIdentity( type ) !== undefined;
                const props = checker.getPropertiesOfType( type );

                for( const prop of props ) 
                {
                    if( isIgnoredPropertySymbol( prop, isClassInst )){ continue }

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
        else if(
            name !== 'Date' && name !== 'URL' && name !== 'RegExp' && name !== 'Promise' && name !== 'Function' &&
            name !== 'File' && name !== 'Blob' &&
            type.getCallSignatures().length === 0 && type.getConstructSignatures().length === 0 &&
            ( !name || !BUFFER_LIKE.has( name ))
        ) 
        {
            const hash = generateHash( type, checker );
            counts.set( hash, ( counts.get( hash ) || 0 ) + 1 );

            const isClassInst = resolveClassIdentity( type ) !== undefined;
            const props = checker.getPropertiesOfType( type );

            for( const prop of props ) 
            {
                if( isIgnoredPropertySymbol( prop, isClassInst )){ continue }

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
    target?         : JsonSchemaTarget
    propertyCasing? : CasingFormat
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

        if( typeof out.exclusiveMinimum === 'number' )
        {
            out.minimum = out.exclusiveMinimum;
            out.exclusiveMinimum = true;
        }

        if( typeof out.exclusiveMaximum === 'number' )
        {
            out.maximum = out.exclusiveMaximum;
            out.exclusiveMaximum = true;
        }

        if( out.type === 'array' )
        {
            if( Array.isArray( out.items ))
            {
                const itemSchemas = out.items.slice();
                out['x-tuple-items'] = out.items.slice();

                if( 'additionalItems' in out )
                {
                    out['x-additional-items'] = out.additionalItems;
                }

                if( out.additionalItems && typeof out.additionalItems === 'object' )
                {
                    itemSchemas.push( out.additionalItems );
                }

                delete out.additionalItems;

                if( itemSchemas.length === 0 )
                {
                    out.items = {};
                }
                else if( itemSchemas.length === 1 )
                {
                    out.items = itemSchemas[0];
                }
                else
                {
                    out.items = { anyOf : itemSchemas };
                }
            }
            else if( out.items === undefined )
            {
                out.items = {};
            }
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
    assertNotTypeParameter( type );

    const defs: Record<string, any> = {};
    const visited = new Map<number, string>();
    const counts = new Map<string, number>();
    const circularHashes = new Set<string>();
    preScanType( type, checker, counts, circularHashes, new Set<number>());

    const rootSchema = buildJsonSchemaInternal( type, checker, defs, visited, counts, circularHashes, options );
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
    type           : ts.Type,
    checker        : ts.TypeChecker,
    defs           : Record<string, any>,
    visited        : Map<number, string>,
    counts         : Map<string, number>,
    circularHashes : Set<string>,
    options?       : JsonSchemaOptions
): any
{
    const schema = buildJsonSchemaRaw( type, checker, defs, visited, counts, circularHashes, options );

    if( schema && typeof schema === 'object' && !schema.$ref )
    {
        const typeJsDoc = extractTypeJsDocInfo( type, checker );
        applyJsDocConstraintsToSchema( schema, typeJsDoc.constraints, checker, defs, visited, counts, circularHashes, options );
        applyJsDocMetadataToJsonSchema( schema, typeJsDoc.metadata );
    }

    return schema;
}

function buildJsonSchemaRaw(
    type           : ts.Type,
    checker        : ts.TypeChecker,
    defs           : Record<string, any>,
    visited        : Map<number, string>,
    counts         : Map<string, number>,
    circularHashes : Set<string>,
    options?       : JsonSchemaOptions
): any 
{
    assertNotTypeParameter( type );

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
                        ...nonBoolTypes.map( t => buildJsonSchemaInternal( t, checker, defs, visited, counts, circularHashes, options )),
                        { type : 'boolean' }
                    ]
                };
            }
            else
            {
                unionSchema = {
                    anyOf : types.map( t => buildJsonSchemaInternal( t, checker, defs, visited, counts, circularHashes, options ))
                };
            }
        }

        if( isCircularUnion )
        {
            if( typeId ){ visited.delete( typeId ) }

            const typeJsDoc = extractTypeJsDocInfo( type, checker );
            applyJsDocConstraintsToSchema( unionSchema, typeJsDoc.constraints, checker, defs, visited, counts, circularHashes, options );
            applyJsDocMetadataToJsonSchema( unionSchema, typeJsDoc.metadata );
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
        const nonTagArms: ts.Type[] = [];

        for( const sub of types ) 
        {
            if( isConstraintOnlyType( sub, checker )) 
            {
                applyConstraintsToJsonSchema(
                    constraints,
                    collectConstraintsFromProps( getTypeProps( sub, checker ), checker ),
                    checker,
                    defs,
                    visited,
                    counts,
                    circularHashes,
                    options
                );
                continue;
            }

            if( isBrandOnlyType( sub, checker ))
            {
                continue;
            }

            nonTagArms.push( sub );
        }

        if( nonTagArms.length > 1 )
        {
            const mergedObj = tryMergeObjectTypes( nonTagArms, checker, type );

            if( mergedObj )
            {
                const wireMap = buildWirePropertyMap( mergedObj.props.map( p => p.name ), options?.propertyCasing );
                const properties: Record<string, any> = {};
                const required: string[] = [];

                for( const prop of mergedObj.props )
                {
                    const wireName = wireMap.get( prop.name )!;
                    const effectivePropType = prop.isOptional ? stripUndefinedFromUnion( prop.type ) : prop.type;
                    const propSchema = buildJsonSchemaInternal( effectivePropType, checker, defs, visited, counts, circularHashes, options );
                    applyJsDocConstraintsToSchema( propSchema, prop.jsdocConstraints, checker, defs, visited, counts, circularHashes, options );
                    applyJsDocMetadataToJsonSchema( propSchema, prop.jsdocMeta );
                    properties[wireName] = propSchema;

                    if( !prop.isOptional )
                    {
                        required.push( wireName );
                    }
                }

                const mergedSchema: Record<string, any> = {
                    type : 'object',
                    properties
                };

                if( mergedObj.patternIndexInfos && mergedObj.patternIndexInfos.length > 0 )
                {
                    const patternProperties: Record<string, any> = {};

                    for( const pInfo of mergedObj.patternIndexInfos )
                    {
                        patternProperties[pInfo.pattern] = buildJsonSchemaInternal( pInfo.valueType, checker, defs, visited, counts, circularHashes, options );
                    }

                    mergedSchema.patternProperties = patternProperties;
                }

                if( mergedObj.indexType )
                {
                    mergedSchema.additionalProperties = buildJsonSchemaInternal( mergedObj.indexType, checker, defs, visited, counts, circularHashes, options );
                }
                else
                {
                    mergedSchema.additionalProperties = false;
                }

                if( required.length > 0 )
                {
                    mergedSchema.required = required;
                }

                return { ...mergedSchema, ...constraints };
            }
        }

        const memberSchemas: any[] = [];

        for( const sub of nonTagArms )
        {
            const sFlags = sub.getFlags();

            if( sFlags & ts.TypeFlags.TemplateLiteral )
            {
                baseSchema = {
                    type    : 'string',
                    pattern : buildTemplateLiteralRegex( sub as ts.TemplateLiteralType )
                };
            }
            else if( sFlags & ts.TypeFlags.StringMapping )
            {
                baseSchema = {
                    type    : 'string',
                    pattern : stringMappingPattern( typeSymbolName( sub ))
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
            else if( sub.getSymbol()?.name === 'File' || sub.getSymbol()?.name === 'Blob' )
            {
                baseSchema = { type : 'string', format : 'binary', 'x-typescript-type' : sub.getSymbol()!.name };
            }
            else if( sub.getSymbol()?.name === 'Set' || sub.getSymbol()?.name === 'ReadonlySet' ) 
            {
                const elementType = ( sub as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();
                baseSchema = {
                    'x-typescript-type' : 'Set',
                    items               : buildJsonSchemaInternal( elementType, checker, defs, visited, counts, circularHashes, options )
                };
            }
            else if( sub.getSymbol()?.name === 'Map' || sub.getSymbol()?.name === 'ReadonlyMap' ) 
            {
                const keyType = ( sub as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();
                const valueType = ( sub as ts.TypeReference ).typeArguments?.[1] || checker.getAnyType();
                baseSchema = {
                    'x-typescript-type' : 'Map',
                    key                 : buildJsonSchemaInternal( keyType, checker, defs, visited, counts, circularHashes, options ),
                    value               : buildJsonSchemaInternal( valueType, checker, defs, visited, counts, circularHashes, options )
                };
            }
            else if( checker.isArrayType( sub )) 
            {
                const elementType = ( sub as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();
                baseSchema = { type : 'array', items : buildJsonSchemaInternal( elementType, checker, defs, visited, counts, circularHashes, options ) };
            }
            else if(( sFlags & ts.TypeFlags.Object ) || sub.isClassOrInterface()) 
            {
                memberSchemas.push( buildJsonSchemaInternal( sub, checker, defs, visited, counts, circularHashes, options ));
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

    if( type.getSymbol()?.name === 'File' || type.getSymbol()?.name === 'Blob' )
    {
        return { type : 'string', format : 'binary', 'x-typescript-type' : type.getSymbol()!.name };
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
            items               : buildJsonSchemaInternal( elementType, checker, defs, visited, counts, circularHashes, options )
        };
    }

    if( type.getSymbol()?.name === 'Map' || type.getSymbol()?.name === 'ReadonlyMap' ) 
    {
        const keyType = ( type as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();
        const valueType = ( type as ts.TypeReference ).typeArguments?.[1] || checker.getAnyType();

        return {
            'x-typescript-type' : 'Map',
            key                 : buildJsonSchemaInternal( keyType, checker, defs, visited, counts, circularHashes, options ),
            value               : buildJsonSchemaInternal( valueType, checker, defs, visited, counts, circularHashes, options )
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

    if( flags & ts.TypeFlags.StringMapping )
    {
        return {
            type    : 'string',
            pattern : stringMappingPattern( typeSymbolName( type ))
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
        return { type : 'string', const : bigIntLiteralText( type ), 'x-typescript-type' : 'bigint' };
    }

    if( flags & ts.TypeFlags.BooleanLiteral ) 
    {
        return { type : 'boolean', const : ( type as any ).intrinsicName === 'true' };
    }

    if( isNativeEnumType( type ))
    {
        const members = enumMemberTypes( type, checker );

        if( members.length === 0 ){ return { type : 'number' } }

        if( members.length === 1 )
        {
            return buildJsonSchemaInternal( members[0], checker, defs, visited, counts, circularHashes, options );
        }

        return {
            anyOf : members.map( m => buildJsonSchemaInternal( m, checker, defs, visited, counts, circularHashes, options ))
        };
    }

    if( checker.isArrayType( type )) 
    {
        const elementType = ( type as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();

        return {
            type  : 'array',
            items : buildJsonSchemaInternal( elementType, checker, defs, visited, counts, circularHashes, options )
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

        const { typeArgs : elementTypes, elementFlags, hasRest, fixedCount, minItems, restType, suffixTypes } = inspectTupleType( type, checker );

        let tupleSchema: any;

        if( hasRest && restType )
        {
            const fixedTypes = elementTypes.slice( 0, fixedCount );
            const restSchema = buildJsonSchemaInternal( restType, checker, defs, visited, counts, circularHashes, options );
            const tailSchema = suffixTypes.length > 0
                ? { anyOf : [ restSchema, ...suffixTypes.map( t => buildJsonSchemaInternal( t, checker, defs, visited, counts, circularHashes, options )) ] }
                : restSchema;

            if( fixedTypes.length === 0 )
            {
                tupleSchema = {
                    minItems,
                    type  : 'array',
                    items : tailSchema
                };
            }
            else
            {
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
                            circularHashes,
                            options
                        )
                    ),
                    additionalItems : tailSchema
                };
            }
        }
        else if( elementTypes.length === 0 )
        {
            tupleSchema = {
                minItems : 0,
                maxItems : 0,
                type     : 'array'
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
                        circularHashes,
                        options
                    )
                )
            };
        }

        if( isCircularTuple )
        {
            if( typeId ){ visited.delete( typeId ) }

            const typeJsDoc = extractTypeJsDocInfo( type, checker );
            applyJsDocConstraintsToSchema( tupleSchema, typeJsDoc.constraints, checker, defs, visited, counts, circularHashes, options );
            applyJsDocMetadataToJsonSchema( tupleSchema, typeJsDoc.metadata );
            defs[tupleDefName] = tupleSchema;

            return { $ref : `#/$defs/${tupleDefName}` };
        }

        return tupleSchema;
    }

    if( type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0 || typeSymbolName( type ) === 'Function' )
    {
        return { 'x-typescript-type' : 'Function' };
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
        const isClassInst = resolveClassIdentity( type ) !== undefined;
        const rawProps = checker.getPropertiesOfType( type );
        let hasInterfaceTags = false;
        const includedProps: ts.Symbol[] = [];

        for( const prop of rawProps )
        {
            const pName = prop.getName();

            if( isTagKey( pName ))
            {
                hasInterfaceTags = true;
                continue;
            }

            if( isIgnoredPropertySymbol( prop, isClassInst )){ continue }

            includedProps.push( prop );
        }

        const wireMap = buildWirePropertyMap( includedProps.map( p => p.getName()), options?.propertyCasing );

        for( const prop of includedProps )
        {
            const pName = prop.getName();
            const wireName = wireMap.get( pName )!;
            const isOptional = ( prop.flags & ts.SymbolFlags.Optional ) !== 0;
            const propType = getPropertyType( type, prop, checker );
            const effectivePropType = isOptional ? stripUndefinedFromUnion( propType ) : propType;
            const propJsDoc = extractPropertyJsDocInfo( prop, checker );
            const propSchema = buildJsonSchemaInternal( effectivePropType, checker, defs, visited, counts, circularHashes, options );

            applyJsDocConstraintsToSchema( propSchema, propJsDoc.constraints, checker, defs, visited, counts, circularHashes, options );
            applyJsDocMetadataToJsonSchema( propSchema, propJsDoc.metadata );
            properties[wireName] = propSchema;

            if( !isOptional ) 
            {
                required.push( wireName );
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
                patternProperties[pInfo.pattern] = buildJsonSchemaInternal( pInfo.valueType, checker, defs, visited, counts, circularHashes, options );
            }

            schemaObj.patternProperties = patternProperties;
        }

        if( stringIndexInfo ) 
        {
            schemaObj.additionalProperties = buildJsonSchemaInternal( stringIndexInfo.type, checker, defs, visited, counts, circularHashes, options );
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
                collectConstraintsFromProps( rawProps, checker ),
                checker,
                defs,
                visited,
                counts,
                circularHashes,
                options
            );
        }

        if( typeId ) { visited.delete( typeId ) }

        const isCircular = circularHashes.has( typeHash );
        const refCount = counts.get( typeHash ) || 0;
        const complexity = getTypeComplexity( type, checker, new Set<number>());
        const score = refCount * complexity;

        if( isCircular || score >= 128 ) 
        {
            const typeJsDoc = extractTypeJsDocInfo( type, checker );
            applyJsDocConstraintsToSchema( schemaObj, typeJsDoc.constraints, checker, defs, visited, counts, circularHashes, options );
            applyJsDocMetadataToJsonSchema( schemaObj, typeJsDoc.metadata );
            defs[defName] = schemaObj;

            return { $ref : `#/$defs/${defName}` };
        }

        return schemaObj;
    }

    return {};
}
