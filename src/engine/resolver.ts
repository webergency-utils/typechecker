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
import { isTagKey } from './tagKeys.js';
import {
    ICustomFunctionScope,
    declarationSite,
    resolveFunctionIdentity
} from './customFns.js';
import { createHash } from 'crypto';

/** Used when a caller builds a validator outside a source-file context; emits names verbatim. */
const VERBATIM_SCOPE: ICustomFunctionScope = { bind : identity => identity.name, imports : []};

function getStringLiteralValue( type: ts.Type ): string | undefined 
{
    if( type.isStringLiteral()) 
    {
        return type.value;
    }

    if( type.isUnion()) 
    {
        const literalType = type.types.find( t => t.isStringLiteral());

        if( literalType && literalType.isStringLiteral()) 
        {
            return literalType.value;
        }
    }

    return undefined;
}

/** Optional tag phantoms are `V | undefined` — strip undefined before reading literals/symbols. */
function stripUndefinedFromType( type: ts.Type ): ts.Type
{
    if( !type.isUnion()){ return type }

    const nonUndefined = type.types.filter( t => !( t.getFlags() & ts.TypeFlags.Undefined ));

    if( nonUndefined.length === 1 ){ return nonUndefined[0] }

    if( nonUndefined.length > 1 )
    {
        // Keep union of remaining members (e.g. string literal | other)
        return type;
    }

    return type;
}

function getTagPropertyValue( type: ts.Type ): any
{
    const actual = stripUndefinedFromType( type );
    let val = ( actual as any ).value;

    if( val === undefined && ( actual.getFlags() & ts.TypeFlags.BooleanLiteral ))
    {
        val = ( actual as any ).intrinsicName === 'true';
    }

    if( val === undefined && ( actual.getFlags() & ts.TypeFlags.Null ))
    {
        val = null;
    }

    return val;
}

/**
 * A `Default` tag makes an absent optional property meaningful — the validator supplies the value —
 * so it must not be skipped. Looks through `| undefined` and intersection members alike.
 */
function typeHasDefaultTag( type: ts.Type, checker: ts.TypeChecker ): boolean
{
    if( type.isUnionOrIntersection())
    {
        return type.types.some( t => typeHasDefaultTag( t, checker ));
    }

    return checker.getPropertiesOfType( type ).some( p => p.getName() === '__default' );
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

function isNativeEnumType( type: ts.Type ): boolean
{
    const flags = type.getFlags();

    if( flags & ts.TypeFlags.Enum ){ return true }

    const symbol = type.getSymbol();

    if( !symbol ){ return false }

    return ( symbol.flags & ( ts.SymbolFlags.RegularEnum | ts.SymbolFlags.ConstEnum )) !== 0;
}

function buildEnumValidator(
    type: ts.Type,
    checker: ts.TypeChecker,
    validatorsMap: Map<string, ts.Expression>,
    scope: ICustomFunctionScope
): ts.Expression
{
    const symbol = type.getSymbol();
    const checks: ts.Expression[] = [];

    if( symbol?.exports )
    {
        symbol.exports.forEach( member =>
        {
            if( !( member.flags & ts.SymbolFlags.EnumMember )){ return }

            const declaration = member.valueDeclaration || member.declarations?.[0];

            if( !declaration ){ return }

            const memberType = checker.getTypeOfSymbolAtLocation( member, declaration );
            checks.push( buildValidatorScoped( memberType, checker, validatorsMap, scope ));
        });
    }

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

function isConstraintOnlyType( type: ts.Type, checker: ts.TypeChecker ): boolean
{
    const props = checker.getPropertiesOfType( type );

    return props.length > 0 && props.every( p => isTagKey( p.getName()));
}

function tryMergeObjectIntersection(
    types: readonly ts.Type[],
    checker: ts.TypeChecker,
    validatorsMap: Map<string, ts.Expression>,
    expected: string,
    scope: ICustomFunctionScope
): ts.Expression | undefined
{
    const objectTypes = types.filter( t => 
    {
        if( isConstraintOnlyType( t, checker )){ return false }

        const flags = t.getFlags();

        return (( flags & ts.TypeFlags.Object ) !== 0 ) || t.isClassOrInterface();
    });

    if( objectTypes.length < 2 ){ return undefined }

    const others = types.filter( t => !isConstraintOnlyType( t, checker ) && !objectTypes.includes( t ));

    if( others.length > 0 ){ return undefined }

    const propMap = new Map<string, { name : string, isOptional : boolean, validator : ts.Expression, hasDefault : boolean }>();
    let indexValidator: ts.Expression | undefined;

    for( const t of objectTypes ) 
    {
        const stringIndexInfo = checker.getIndexInfoOfType( t, ts.IndexKind.String );

        if( stringIndexInfo ) 
        {
            indexValidator = buildValidatorScoped( stringIndexInfo.type, checker, validatorsMap, scope );
        }

        for( const prop of checker.getPropertiesOfType( t )) 
        {
            const name = prop.getName();

            if( isTagKey( name )){ continue }

            const declaration = prop.valueDeclaration || prop.declarations?.[0];
            const propType = declaration ? checker.getTypeOfSymbolAtLocation( prop, declaration ) : checker.getAnyType();

            propMap.set( name, {
                name,
                isOptional : ( prop.getFlags() & ts.SymbolFlags.Optional ) !== 0,
                validator  : buildValidatorScoped( propType, checker, validatorsMap, scope ),
                hasDefault : typeHasDefaultTag( propType, checker )
            });
        }
    }

    return createObjectCheck([ ...propMap.values() ], expected, indexValidator );
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

/** Object-like enough to hold a discriminant: excludes arrays, tuples, callables and the built-ins. */
function isDiscriminableObject( type: ts.Type, checker: ts.TypeChecker ): boolean
{
    if( !( type.getFlags() & ts.TypeFlags.Object )){ return false }

    if( checker.isArrayType( type ) || checker.isTupleType( type )){ return false }

    if( type.getCallSignatures().length > 0 ){ return false }

    const name = type.getSymbol()?.name;

    return name !== 'Date' && name !== 'Set' && name !== 'Map' && name !== 'RegExp';
}

/** The value of a type that is exactly one string or number literal — a usable discriminant. */
function singleLiteralValue( type: ts.Type ): string | number | undefined
{
    if( type.isStringLiteral() || type.isNumberLiteral()){ return type.value }

    return undefined;
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
    if( members.length < 2 ){ return undefined }

    const literalsByMember: Map<string, string | number>[] = [];

    for( const member of members )
    {
        if( !isDiscriminableObject( member, checker )){ return undefined }

        const literals = new Map<string, string | number>();

        for( const prop of checker.getPropertiesOfType( member ))
        {
            const declaration = prop.valueDeclaration || prop.declarations?.[0];

            if( !declaration ){ continue }

            const value = singleLiteralValue( checker.getTypeOfSymbolAtLocation( prop, declaration ));

            if( value !== undefined ){ literals.set( prop.getName(), value ) }
        }

        if( literals.size === 0 ){ return undefined }

        literalsByMember.push( literals );
    }

    for( const key of literalsByMember[0].keys())
    {
        const byTag: [string | number, ts.Expression][] = [];
        const seen = new Set<string | number>();

        for( let i = 0; i < literalsByMember.length; i++ )
        {
            const value = literalsByMember[i].get( key );

            if( value === undefined || seen.has( value )){ break }

            seen.add( value );
            byTag.push([value, checks[i]]);
        }

        if( byTag.length === members.length ){ return createTaggedUnionCheck( key, byTag, expected ) }
    }

    return undefined;
}

export function buildValidator(
    type: ts.Type,
    checker: ts.TypeChecker,
    validatorsMap: Map<string, ts.Expression>,
    hash?: string,
    scope: ICustomFunctionScope = VERBATIM_SCOPE
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
        const members = ( type as ts.UnionType ).types;
        const expected = `Type<${minifyTypeString( checker.typeToString( type ))}>`;
        const nullable = tryNullableUnion( members, checker, validatorsMap, scope );

        if( nullable ){ result = nullable }
        else
        {
            const checks = members.map( t => buildValidatorScoped( t, checker, validatorsMap, scope ));

            result = tryTaggedUnion( members, checks, checker, expected ) || createUnionCheck( checks, expected );
        }
    }
    else if( isIntersection ) 
    {
        const types = ( type as ts.IntersectionType ).types;
        let baseName = '';
        let baseType: ts.Type | undefined;
        const constraints: any[] = [];

        for( const sub of types ) 
        {
            const sFlags = sub.getFlags();

            if( sFlags & ts.TypeFlags.String || sFlags & ts.TypeFlags.TemplateLiteral ) 
            {
                baseName = 'string';
                baseType = sub;
            }
            else if( sFlags & ts.TypeFlags.Number ) { baseName = 'number' }
            else if( sFlags & ts.TypeFlags.BigInt ) { baseName = 'bigint' }
            else if( sFlags & ts.TypeFlags.Boolean || ( sub as any ).intrinsicName === 'boolean' ) 
            {
                baseName = 'boolean';
                baseType = sub;
            }
            else if( sub.getSymbol()?.name === 'Date' ) 
            {
                baseName = 'date';
                baseType = sub;
            }
            else if( checker.isArrayType( sub )) 
            {
                baseName = 'array';
                baseType = sub;
            }

            const props = checker.getPropertiesOfType( sub );

            for( const prop of props ) 
            {
                const pName = prop.getName();

                if( isTagKey( pName )) 
                {
                    const pType = checker.getTypeOfSymbolAtLocation( prop, prop.valueDeclaration || ( prop as any ).declarations?.[0]);
                    const actualType = stripUndefinedFromType( pType );
                    const val = getTagPropertyValue( pType );

                    if( pName === '__default' ) 
                    {
                        constraints.push({ type : 'default', value : val });
                    }
                    else if( pName === '__message' ) 
                    {
                        constraints.push({ type : 'message', value : val });
                    }
                    else if( pName === '__transform_lowercase' ) 
                    {
                        constraints.push({ type : 'transform', value : 'lowercase' });
                    }
                    else if( pName === '__transform_uppercase' ) 
                    {
                        constraints.push({ type : 'transform', value : 'uppercase' });
                    }
                    else if( pName === '__transform_trim' ) 
                    {
                        constraints.push({ type : 'transform', value : 'trim' });
                    }
                    else if( pName === '__transform_capitalize' ) 
                    {
                        constraints.push({ type : 'transform', value : 'capitalize' });
                    }
                    else if( pName === '__transform_tonumber' ) 
                    {
                        constraints.push({ type : 'transform', value : 'tonumber' });
                    }
                    else if( pName === '__transform_toboolean' ) 
                    {
                        constraints.push({ type : 'transform', value : 'toboolean' });
                    }
                    else if( pName === '__transform_todate' ) 
                    {
                        constraints.push({ type : 'transform', value : 'todate' });
                    }
                    else if( pName === '__transform_custom' ) 
                    {
                        const identity = resolveFunctionIdentity( actualType, checker, pType );

                        if( !identity ) 
                        {
                            throw new Error( '[Webergency] Custom transform must reference a named function via typeof (e.g. transform.Custom<typeof myFunc>).' );
                        }

                        constraints.push({ type : 'transform_custom', value : scope.bind( identity ) });
                    }
                    else if( pName === '__custom' ) 
                    {
                        const identity = resolveFunctionIdentity( actualType, checker, pType );

                        if( !identity ) 
                        {
                            throw new Error( '[Webergency] Custom validator must reference a named function via typeof (e.g. constraint.Custom<typeof myFunc>).' );
                        }

                        const msgProp = props.find( p => p.getName() === `${pName}_message` );
                        let constraintMsg: string | undefined;

                        if( msgProp ) 
                        {
                            const msgType = checker.getTypeOfSymbolAtLocation( msgProp, msgProp.valueDeclaration || ( msgProp as any ).declarations?.[0]);
                            constraintMsg = getStringLiteralValue( msgType );
                        }
                        constraints.push({ type : 'custom', value : scope.bind( identity ), message : constraintMsg });
                    }
                    else if( val !== undefined ) 
                    {
                        const msgProp = props.find( p => p.getName() === `${pName}_message` );
                        let constraintMsg: string | undefined;

                        if( msgProp ) 
                        {
                            const msgType = checker.getTypeOfSymbolAtLocation( msgProp, msgProp.valueDeclaration || ( msgProp as any ).declarations?.[0]);
                            constraintMsg = getStringLiteralValue( msgType );
                        }

                        if( pName === '__minLength' ) { constraints.push({ type : 'minLength', value : val, message : constraintMsg }) }
                        else if( pName === '__maxLength' ) { constraints.push({ type : 'maxLength', value : val, message : constraintMsg }) }
                        else if( pName === '__minimum' ) { constraints.push({ type : 'minimum', value : val, message : constraintMsg }) }
                        else if( pName === '__maximum' ) { constraints.push({ type : 'maximum', value : val, message : constraintMsg }) }
                        else if( pName === '__exclusiveMinimum' ) { constraints.push({ type : 'exclusiveMinimum', value : val, message : constraintMsg }) }
                        else if( pName === '__exclusiveMaximum' ) { constraints.push({ type : 'exclusiveMaximum', value : val, message : constraintMsg }) }
                        else if( pName === '__multipleOf' ) { constraints.push({ type : 'multipleOf', value : val, message : constraintMsg }) }
                        else if( pName === '__pattern' ) { constraints.push({ type : 'pattern', value : val, message : constraintMsg }) }
                        else if( pName === '__format' ) { constraints.push({ type : 'format', value : val, message : constraintMsg }) }
                        else if( pName === '__minItems' ) { constraints.push({ type : 'minItems', value : val, message : constraintMsg }) }
                        else if( pName === '__maxItems' ) { constraints.push({ type : 'maxItems', value : val, message : constraintMsg }) }
                        else if( pName === '__uniqueItems' ) { constraints.push({ type : 'uniqueItems', value : true, message : constraintMsg }) }
                    }
                    else if( pName === '__requires' ) 
                    {
                        let reqVal: string | string[];

                        if( actualType.isStringLiteral()) 
                        {
                            reqVal = actualType.value;
                        }
                        else 
                        {
                            const typeArgs = ( actualType as ts.TypeReference ).typeArguments || [];
                            const items: string[] = [];

                            for( const arg of typeArgs ) 
                            {
                                if( arg.isStringLiteral()) 
                                {
                                    items.push( arg.value );
                                }
                            }
                            reqVal = items;
                        }
                        const msgProp = props.find( p => p.getName() === `${pName}_message` );
                        let constraintMsg: string | undefined;

                        if( msgProp ) 
                        {
                            const msgType = checker.getTypeOfSymbolAtLocation( msgProp, msgProp.valueDeclaration || ( msgProp as any ).declarations?.[0]);
                            constraintMsg = getStringLiteralValue( msgType );
                        }
                        constraints.push({ type : 'requires', value : reqVal, message : constraintMsg });
                    }
                }
            }
        }

        if( constraints.length > 0 ) 
        {
            if( baseName ) 
            {
                if( baseName === 'array' && baseType ) 
                {
                    const baseValidator = buildValidatorScoped( baseType, checker, validatorsMap, scope );
                    result = createConstrainedPrimitiveCheck( baseName, constraints, baseValidator );
                }
                else if( baseType && ( baseType.getFlags() & ts.TypeFlags.TemplateLiteral )) 
                {
                    const baseValidator = buildValidatorScoped( baseType, checker, validatorsMap, scope );
                    result = createConstrainedPrimitiveCheck( baseName, constraints, baseValidator );
                }
                else 
                {
                    result = createConstrainedPrimitiveCheck( baseName, constraints );
                }
            }
            else 
            {
                const nonConstraintTypes = types.filter( t => 
                {
                    const props = checker.getPropertiesOfType( t );

                    return !props.some( p => isTagKey( p.getName()));
                });

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
                        minifyTypeString( checker.typeToString( type )),
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
                    const merged = tryMergeObjectIntersection(
                        types,
                        checker,
                        validatorsMap,
                        minifyTypeString( checker.typeToString( type )),
                        scope
                    );
                    result = merged || createIntersectionCheck(
                        ( type as ts.IntersectionType ).types.map( t => buildValidatorScoped( t, checker, validatorsMap, scope ))
                    );
                }
            }
        }
        else 
        {
            const merged = tryMergeObjectIntersection(
                types,
                checker,
                validatorsMap,
                minifyTypeString( checker.typeToString( type )),
                scope
            );

            if( merged ) 
            {
                result = merged;
            }
            else 
            {
                const checks = ( type as ts.IntersectionType ).types.map( t => buildValidatorScoped( t, checker, validatorsMap, scope ));
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
    else if( type.getSymbol()?.name && [
        'Uint8Array', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array',
        'Float32Array', 'Float64Array', 'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Buffer'
    ].includes( type.getSymbol()!.name )) 
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
        const stringIndexInfo = checker.getIndexInfoOfType( type, ts.IndexKind.String );
        const props = checker.getPropertiesOfType( type ).map( prop => 
        {
            const declaration = prop.valueDeclaration || prop.declarations?.[0];
            const propType = declaration ? checker.getTypeOfSymbolAtLocation( prop, declaration ) : checker.getAnyType();

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

    if( typeSymbolName && [
        'Uint8Array', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array',
        'Float32Array', 'Float64Array', 'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Buffer'
    ].includes( typeSymbolName )) 
    {
        return typeSymbolName;
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
            const declaration = prop.valueDeclaration || prop.declarations?.[0];
            const propType = declaration ? checker.getTypeOfSymbolAtLocation( prop, declaration ) : checker.getAnyType();
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
                    const propType = checker.getTypeOfSymbolAtLocation( prop, prop.valueDeclaration || ( prop as any ).declarations?.[0]);
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
                const propType = checker.getTypeOfSymbolAtLocation( prop, prop.valueDeclaration || ( prop as any ).declarations?.[0]);
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
            const subProps = checker.getPropertiesOfType( sub );
            const isConstraintPhantom = subProps.length > 0 && subProps.every( p => isTagKey( p.getName()));

            if( isConstraintPhantom ) 
            {
                for( const prop of subProps ) 
                {
                    const pName = prop.getName();
                    const pType = checker.getTypeOfSymbolAtLocation( prop, prop.valueDeclaration || ( prop as any ).declarations?.[0]);
                    const actualType = stripUndefinedFromType( pType );
                    const val = getTagPropertyValue( pType );

                    if( pName === '__default' ) { constraints.default = val }
                    else if( pName === '__minLength' ) { constraints.minLength = val }
                    else if( pName === '__maxLength' ) { constraints.maxLength = val }
                    else if( pName === '__minimum' ) { constraints.minimum = val }
                    else if( pName === '__maximum' ) { constraints.maximum = val }
                    else if( pName === '__exclusiveMinimum' ) { constraints.exclusiveMinimum = val }
                    else if( pName === '__exclusiveMaximum' ) { constraints.exclusiveMaximum = val }
                    else if( pName === '__multipleOf' ) { constraints.multipleOf = val }
                    else if( pName === '__pattern' ) { constraints.pattern = val }
                    else if( pName === '__format' ) { constraints.format = val }
                    else if( pName === '__minItems' ) { constraints.minItems = val }
                    else if( pName === '__maxItems' ) { constraints.maxItems = val }
                    else if( pName === '__uniqueItems' ) { constraints.uniqueItems = true }
                    else if( pName === '__requires' ) 
                    {
                        let reqVal: string | string[];

                        if( actualType.isStringLiteral()) 
                        {
                            reqVal = actualType.value;
                        }
                        else 
                        {
                            const typeArgs = ( actualType as ts.TypeReference ).typeArguments || [];
                            const items: string[] = [];

                            for( const arg of typeArgs ) 
                            {
                                if( arg.isStringLiteral()) 
                                {
                                    items.push( arg.value );
                                }
                            }
                            reqVal = items;
                        }
                        constraints.requires = reqVal;
                    }
                }
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

        if( typedName && [
            'Uint8Array', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array',
            'Float32Array', 'Float64Array', 'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Buffer'
        ].includes( typedName )) 
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
            const propType = checker.getTypeOfSymbolAtLocation( prop, prop.valueDeclaration || ( prop as any ).declarations?.[0]);

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
