import ts from 'typescript';
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
    createNullCheck,
    createUndefinedCheck,
    createIntersectionCheck,
    createTupleCheck,
    createRecordCheck,
    createRegExpCheck,
    createTemplateLiteralCheck,
    createConstrainedPrimitiveCheck,
    createSetCheck,
    createMapCheck,
    createInstanceOfCheck
} from './generators.js';
import {
    ICustomFunctionScope,
    declarationSite,
    resolveClassIdentity,
    resolveFunctionIdentity
} from './customFns.js';
import {
    BUFFER_LIKE,
    collectConstraintsFromProps,
    enumMemberTypes,
    getPropertyType,
    getTypeProps,
    isConstraintOnlyType,
    isNativeEnumType,
    peelTaggedIntersection,
    tryMergeObjectTypes,
    tryTaggedUnionTypes,
    typeHasDefaultTag,
    typeSymbolName,
    VERBATIM_CUSTOM_SCOPE,
    type ParsedConstraint
} from './type-helpers.js';
import { createHash } from 'crypto';

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

/** Map peeled tag constraints onto JSON Schema / x-extension fields. */
function applyConstraintsToJsonSchema( target: Record<string, any>, constraints: ParsedConstraint[]): void
{
    for( const c of constraints )
    {
        if( c.type === 'default' ){ target.default = c.value }
        else if( c.type === 'requires' ){ target.requires = c.value }
        else if(
            c.type === 'minLength' || c.type === 'maxLength' ||
            c.type === 'minimum' || c.type === 'maximum' ||
            c.type === 'exclusiveMinimum' || c.type === 'exclusiveMaximum' ||
            c.type === 'multipleOf' || c.type === 'pattern' || c.type === 'format' ||
            c.type === 'minItems' || c.type === 'maxItems'
        )
        {
            if( c.value !== undefined ){ target[c.type] = c.value }
        }
        else if( c.type === 'uniqueItems' ){ target.uniqueItems = true }
    }
}

function buildEnumValidator(
    type: ts.Type,
    checker: ts.TypeChecker,
    validatorsMap: Map<string, ts.Expression>,
    scope: ICustomFunctionScope
): ts.Expression
{
    const members = enumMemberTypes( type, checker );
    const checks = members.map( t => buildValidatorScoped( t, checker, validatorsMap, scope ));

    if( checks.length === 0 && type.isUnion())
    {
        const unionChecks = ( type as ts.UnionType ).types.map( t => buildValidatorScoped( t, checker, validatorsMap, scope ));

        return createUnionCheck( unionChecks, `Type<${minifyTypeString( checker.typeToString( type ))}>` );
    }

    if( checks.length === 0 )
    {
        return createPrimitiveCheck( 'any' );
    }

    if( checks.length === 1 ){ return checks[0] }

    return createUnionCheck( checks, `Type<${minifyTypeString( checker.typeToString( type ))}>` );
}

function tryMergeObjectIntersection(
    types: readonly ts.Type[],
    checker: ts.TypeChecker,
    validatorsMap: Map<string, ts.Expression>,
    expected: string,
    scope: ICustomFunctionScope
): ts.Expression | undefined
{
    const merged = tryMergeObjectTypes( types, checker );

    if( !merged ){ return undefined }

    const props = merged.props.map( prop => ({
        name       : prop.name,
        isOptional : prop.isOptional,
        validator  : buildValidatorScoped( prop.type, checker, validatorsMap, scope ),
        hasDefault : prop.hasDefault
    }));
    const indexValidator = merged.indexType
        ? buildValidatorScoped( merged.indexType, checker, validatorsMap, scope )
        : undefined;

    return createObjectCheck( props, expected, indexValidator );
}

/**
 * `T | undefined`, `T | null` and `T | null | undefined` do not need an arm-by-arm search. A null check
 * delegating to the single remaining arm skips the union's speculative context entirely.
 *
 * Deliberately conservative: `boolean | undefined` arrives as `true | false | undefined` and keeps the
 * generic union.
 */
function tryNullableUnion(
    members: readonly ts.Type[],
    checker: ts.TypeChecker,
    validatorsMap: Map<string, ts.Expression>,
    scope: ICustomFunctionScope
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

    return createNullableCheck( kind, buildValidatorScoped( rest[0], checker, validatorsMap, scope ));
}

/**
 * When every arm is an object and some shared property holds a distinct literal in each, that property
 * selects the arm in one lookup instead of the arms being tried in sequence.
 */
function tryTaggedUnion(
    members: readonly ts.Type[],
    checks: readonly ts.Expression[],
    checker: ts.TypeChecker,
    expected: string
): ts.Expression | undefined
{
    const tagged = tryTaggedUnionTypes( members, checker );

    if( !tagged ){ return undefined }

    const byTag: [string | number, ts.Expression][] = tagged.arms.map(( arm, i ) => [arm.tag, checks[i]]);

    return createTaggedUnionCheck( tagged.key, byTag, expected );
}

/** Classify a peeled base for constrained-primitive emit. */
function constrainedBaseKind( type: ts.Type, checker: ts.TypeChecker ): { baseName: string, baseType?: ts.Type } | undefined
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

    if( typeof checker.isArrayType === 'function' && checker.isArrayType( type ))
    {
        return { baseName : 'array', baseType : type };
    }

    return undefined;
}

export function buildValidator(
    type: ts.Type,
    checker: ts.TypeChecker,
    validatorsMap: Map<string, ts.Expression>,
    hash?: string,
    scope: ICustomFunctionScope = VERBATIM_CUSTOM_SCOPE
): ts.Expression
{
    return buildValidatorScoped( type, checker, validatorsMap, scope, hash );
}

function buildValidatorScoped(
    type: ts.Type,
    checker: ts.TypeChecker,
    validatorsMap: Map<string, ts.Expression>,
    scope: ICustomFunctionScope,
    hash?: string
): ts.Expression 
{
    const resolvedHash = hash ?? generateHash( type, checker );

    if( validatorsMap.has( resolvedHash )) 
    {
        return ts.factory.createIdentifier( `__val_${resolvedHash}` );
    }

    // Set placeholder to handle circularity
    validatorsMap.set( resolvedHash, ts.factory.createIdentifier( `PENDING_${resolvedHash}` ));

    let result: ts.Expression;
    const flags = type.getFlags();

    const isUnion = ((( flags & ts.TypeFlags.Union ) !== 0 || type.isUnion()) && ( type as any ).types ) ? true : false;
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
            result = buildValidatorScoped( members[0], checker, validatorsMap, scope );
        }
        else
        {
            const nullable = tryNullableUnion( members, checker, validatorsMap, scope );

            if( nullable ){ result = nullable }
            else
            {
                const checks = members.map( t => buildValidatorScoped( t, checker, validatorsMap, scope ));

                result = tryTaggedUnion( members, checks, checker, expected ) || createUnionCheck( checks, expected );
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
            const constraints = peeled.constraints;
            let walkBase = peeled.base;
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
                if( kind.baseName === 'array' && kind.baseType )
                {
                    const baseValidator = buildValidatorScoped( kind.baseType, checker, validatorsMap, scope );
                    result = createConstrainedPrimitiveCheck( kind.baseName, constraints, baseValidator );
                }
                else if( kind.baseType && ( kind.baseType.getFlags() & ts.TypeFlags.TemplateLiteral ))
                {
                    const baseValidator = buildValidatorScoped( kind.baseType, checker, validatorsMap, scope );
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
                    baseValidator = buildValidatorScoped( nonConstraintTypes[0], checker, validatorsMap, scope );
                }
                else if( nonConstraintTypes.length > 1 )
                {
                    const merged = tryMergeObjectIntersection(
                        nonConstraintTypes,
                        checker,
                        validatorsMap,
                        expected,
                        scope
                    );
                    baseValidator = merged || createIntersectionCheck(
                        nonConstraintTypes.map( t => buildValidatorScoped( t, checker, validatorsMap, scope ))
                    );
                }

                if( baseValidator )
                {
                    result = createConstrainedPrimitiveCheck( 'any', constraints, baseValidator );
                }
                else
                {
                    const merged = tryMergeObjectIntersection( types, checker, validatorsMap, expected, scope );
                    result = merged || createIntersectionCheck(
                        types.map( t => buildValidatorScoped( t, checker, validatorsMap, scope ))
                    );
                }
            }
        }
        else if( peeled )
        {
            // Brand-only (or other tagless) peels — walk the effective base, not the full intersection.
            result = buildValidatorScoped( peeled.base, checker, validatorsMap, scope );
        }
        else
        {
            const merged = tryMergeObjectIntersection( types, checker, validatorsMap, expected, scope );

            if( merged )
            {
                result = merged;
            }
            else
            {
                const checks = types.map( t => buildValidatorScoped( t, checker, validatorsMap, scope ));
                result = createIntersectionCheck( checks );
            }
        }
    }
    else if( type.getSymbol()?.name === 'Date' ) 
    {
        result = createDateCheck( );
    }
    else if( type.getSymbol()?.name === 'RegExp' ) 
    {
        result = createRegExpCheck( );
    }
    else if( type.getSymbol()?.name === 'Set' ) 
    {
        const elementType = ( type as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();
        result = createSetCheck( buildValidatorScoped( elementType, checker, validatorsMap, scope ) );
    }
    else if( type.getSymbol()?.name === 'Map' ) 
    {
        const keyType = ( type as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();
        const valueType = ( type as ts.TypeReference ).typeArguments?.[1] || checker.getAnyType();
        result = createMapCheck(
            buildValidatorScoped( keyType, checker, validatorsMap, scope ),
            buildValidatorScoped( valueType, checker, validatorsMap, scope )
        );
    }
    else if( type.getSymbol()?.name === 'Promise' ) 
    {
        result = createInstanceOfCheck( 'Promise' );
    }
    else if( type.getSymbol()?.name && BUFFER_LIKE.has( type.getSymbol()!.name )) 
    {
        result = createInstanceOfCheck( type.getSymbol()!.name );
    }
    else if( flags & ts.TypeFlags.Null ) 
    {
        result = createNullCheck( );
    }
    else if( flags & ts.TypeFlags.Undefined || flags & ts.TypeFlags.Void ) 
    {
        result = createUndefinedCheck( );
    }
    else if( flags & ts.TypeFlags.String ) 
    {
        result = createPrimitiveCheck( 'string' );
    }
    else if( flags & ts.TypeFlags.Number ) 
    {
        result = createPrimitiveCheck( 'number' );
    }
    else if( flags & ts.TypeFlags.BigInt ) 
    {
        result = createPrimitiveCheck( 'bigint' );
    }
    else if( flags & ts.TypeFlags.Boolean ) 
    {
        result = createPrimitiveCheck( 'boolean' );
    }
    else if( flags & ts.TypeFlags.Never ) 
    {
        result = createPrimitiveCheck( 'never' );
    }
    else if( flags & ts.TypeFlags.ESSymbol || flags & ts.TypeFlags.UniqueESSymbol || ( type as any ).intrinsicName === 'symbol' ) 
    {
        result = createPrimitiveCheck( 'symbol' );
    }
    else if( flags & ts.TypeFlags.TemplateLiteral ) 
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

                if( subFlags & ts.TypeFlags.String ) { regexStr += '.*' }
                else if( subFlags & ts.TypeFlags.Number ) { regexStr += '[0-9]+(\\.[0-9]+)?' }
                else if( subFlags & ts.TypeFlags.BigInt ) { regexStr += '[0-9]+' }
                else if( subFlags & ts.TypeFlags.Boolean ) { regexStr += '(true|false)' }
                else { regexStr += '.*' }
            }
        }
        regexStr += '$';
        result = createTemplateLiteralCheck( regexStr, checker.typeToString( type ) );
    }
    else if( type.isStringLiteral()) 
    {
        result = createLiteralCheck( type.value );
    }
    else if( type.isNumberLiteral()) 
    {
        result = createLiteralCheck( type.value );
    }
    else if( flags & ts.TypeFlags.BooleanLiteral ) 
    {
        result = createLiteralCheck(( type as any ).intrinsicName === 'true' );
    }
    else if( flags & ts.TypeFlags.BigIntLiteral ) 
    {
        result = createLiteralCheck(( type as ts.BigIntLiteralType ).value );
    }
    else if( checker.isTupleType( type )) 
    {
        const typeArgs = ( type as ts.TupleTypeReference ).typeArguments || [];
        result = createTupleCheck( typeArgs.map( t => buildValidatorScoped( t, checker, validatorsMap, scope )) );
    }
    else if( checker.isArrayType( type )) 
    {
        const elementType = ( type as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();
        result = createArrayCheck( buildValidatorScoped( elementType, checker, validatorsMap, scope ) );
    }
    else if( type.getCallSignatures().length > 0 && type.getConstructSignatures().length === 0 ) 
    {
        result = createPrimitiveCheck( 'function' );
    }
    else if( isNativeEnumType( type )) 
    {
        result = buildEnumValidator( type, checker, validatorsMap, scope );
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
                result = createInstanceOfCheck( classIdentity.name );
            }
            else
            {
                const localName = scope.bind( classIdentity );

                result = createInstanceOfCheck( ts.factory.createIdentifier( localName ));
            }
        }
        else
        {
            const stringIndexInfo = checker.getIndexInfoOfType( type, ts.IndexKind.String );
            const props = checker.getPropertiesOfType( type ).map( prop =>
            {
                const propType = getPropertyType( type, prop, checker );

                return {
                    name       : prop.getName(),
                    isOptional : ( prop.getFlags() & ts.SymbolFlags.Optional ) !== 0,
                    validator  : buildValidatorScoped( propType, checker, validatorsMap, scope ),
                    hasDefault : typeHasDefaultTag( propType, checker )
                };
            });

            if( stringIndexInfo && props.length === 0 )
            {
                result = createRecordCheck( buildValidatorScoped( stringIndexInfo.type, checker, validatorsMap, scope ) );
            }
            else if( flags & ts.TypeFlags.Object || type.isClassOrInterface() || type.isTypeParameter() || stringIndexInfo )
            {
                const typeName = checker.typeToString( type );
                const indexValidator = stringIndexInfo
                    ? buildValidatorScoped( stringIndexInfo.type, checker, validatorsMap, scope )
                    : undefined;
                result = createObjectCheck( props, typeName, indexValidator );
            }
            else
            {
                result = createPrimitiveCheck( 'any' );
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

    if( !typeId ){ return signatureOf( type, checker, visited ) }

    visited.add( typeId );

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
        visited.delete( typeId );
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

    if( checker.isArrayType( type )) 
    {
        const elementType = ( type as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();

        return `Array<${buildStructuralSignature( elementType, checker, visited )}>`;
    }

    const typeSymbolName = type.getSymbol()?.name || type.aliasSymbol?.getName();

    if( typeSymbolName === 'Date' ) { return 'Date' }

    if( typeSymbolName === 'RegExp' ) { return 'RegExp' }

    if( typeSymbolName === 'Promise' ) 
    {
        const valueType = ( type as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();

        return `Promise<${buildStructuralSignature( valueType, checker, visited )}>`;
    }

    if( typeSymbolName === 'Set' ) 
    {
        const elementType = ( type as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();

        return `Set<${buildStructuralSignature( elementType, checker, visited )}>`;
    }

    if( typeSymbolName === 'Map' ) 
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

        if( props.length === 0 ) 
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
        const indexSig = stringIndexInfo
            ? `;[string]:${buildStructuralSignature( stringIndexInfo.type, checker, visited )}`
            : '';

        return `Object{${propSigs.join( ';' )}${indexSig}}`;
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

    if( typeof val === 'bigint' ) { return ts.factory.createBigIntLiteral( val.toString() + 'n' ) }

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

        const isUnion = ((( flags & ts.TypeFlags.Union ) !== 0 || type.isUnion()) && ( type as any ).types ) ? true : false;
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

            if( name !== 'Date' && name !== 'Set' && name !== 'Map' && name !== 'RegExp' ) 
            {
                const props = checker.getPropertiesOfType( type );

                for( const prop of props ) 
                {
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

    const isUnion = ((( flags & ts.TypeFlags.Union ) !== 0 || type.isUnion()) && ( type as any ).types ) ? true : false;
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

        if( name !== 'Date' && name !== 'Set' && name !== 'Map' && name !== 'RegExp' ) 
        {
            const hash = generateHash( type, checker );
            counts.set( hash, ( counts.get( hash ) || 0 ) + 1 );

            const props = checker.getPropertiesOfType( type );

            for( const prop of props ) 
            {
                const propType = getPropertyType( type, prop, checker );
                preScanType( propType, checker, counts, circularHashes, visited );
            }
        }
    }

    visited.delete( typeId );
}

export function buildJsonSchema( type: ts.Type, checker: ts.TypeChecker ): any 
{
    const defs: Record<string, any> = {};
    const visited = new Map<number, string>();
    const counts = new Map<string, number>();
    const circularHashes = new Set<string>();
    preScanType( type, checker, counts, circularHashes, new Set<number>());

    const rootSchema = buildJsonSchemaInternal( type, checker, defs, visited, counts, circularHashes );

    if( Object.keys( defs ).length > 0 ) 
    {
        const rootSymbol = type.getSymbol() || type.aliasSymbol;
        const rootName = rootSymbol ? rootSymbol.getName() : 'Root';
        const rootHash = generateHash( type, checker );
        const rootDefName = `${rootName}_${rootHash}`;

        if( defs[rootDefName]) 
        {
            return {
                $ref  : `#/$defs/${rootDefName}`,
                $defs : defs
            };
        }
        else 
        {
            return {
                ...rootSchema,
                $defs : defs
            };
        }
    }

    return rootSchema;
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

    const isUnion = ((( flags & ts.TypeFlags.Union ) !== 0 || type.isUnion()) && ( type as any ).types ) ? true : false;
    const isIntersection = ((( flags & ts.TypeFlags.Intersection ) !== 0 || type.isIntersection()) && ( type as any ).types ) ? true : false;

    if( isUnion ) 
    {
        const types = ( type as ts.UnionType ).types;
        const isBoolUnion = types.length === 2 &&
            types.every( t => ( t.getFlags() & ts.TypeFlags.BooleanLiteral ) !== 0 );

        if( isBoolUnion ) 
        {
            return { type : 'boolean' };
        }

        return {
            anyOf : types.map( t => buildJsonSchemaInternal( t, checker, defs, visited, counts, circularHashes ))
        };
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
                    collectConstraintsFromProps( getTypeProps( sub, checker ), checker )
                );
                continue;
            }

            if( sFlags & ts.TypeFlags.String || sFlags & ts.TypeFlags.TemplateLiteral ) 
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
            else if( sub.getSymbol()?.name === 'RegExp' ) 
            {
                baseSchema = { 'x-typescript-type' : 'RegExp' };
            }
            else if( sub.getSymbol()?.name === 'Set' ) 
            {
                const elementType = ( sub as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();
                baseSchema = {
                    'x-typescript-type' : 'Set',
                    items               : buildJsonSchemaInternal( elementType, checker, defs, visited, counts, circularHashes )
                };
            }
            else if( sub.getSymbol()?.name === 'Map' ) 
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

    if( type.getSymbol()?.name === 'Set' ) 
    {
        const elementType = ( type as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();

        return {
            'x-typescript-type' : 'Set',
            items               : buildJsonSchemaInternal( elementType, checker, defs, visited, counts, circularHashes )
        };
    }

    if( type.getSymbol()?.name === 'Map' ) 
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
        const elementTypes = ( type as ts.TypeReference ).typeArguments || [];

        return {
            type     : 'array',
            items    : elementTypes.map( t => buildJsonSchemaInternal( t, checker, defs, visited, counts, circularHashes )),
            minItems : elementTypes.length,
            maxItems : elementTypes.length
        };
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

        for( const prop of props )
        {
            const pName = prop.getName();
            const isOptional = ( prop.flags & ts.SymbolFlags.Optional ) !== 0;
            const propType = getPropertyType( type, prop, checker );

            properties[pName] = buildJsonSchemaInternal( propType, checker, defs, visited, counts, circularHashes );

            if( !isOptional ) 
            {
                required.push( pName );
            }
        }

        const schemaObj: any = {
            type       : 'object',
            properties
        };

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
