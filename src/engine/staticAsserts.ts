import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';
import { hasUniqueItems, isMultipleOfNumber } from '../runtime/validators.js';
import { TagName } from './tagKeys.js';
import {
    collectConstraintsFromProps,
    extractPropertyJsDocInfo,
    extractTypeJsDocInfo,
    getTypeProps,
    mergeConstraintsWithJsDoc,
    peelTaggedIntersection,
    wrapTypeNodeWithJsDoc,
    type ParsedConstraint
} from './type-helpers.js';

export interface IStaticConstraint
{
    type     : string
    value    : any
    message? : string
}

/** The subset of tags whose satisfaction can be decided from a literal at compile time. */
const STATICALLY_CHECKED: ReadonlySet<string> = new Set<TagName>([
    'minLength', 'maxLength',
    'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
    'minItems', 'maxItems', 'uniqueItems',
    'minProperties', 'maxProperties'
]);

const STATIC_MACRO_FUNCTIONS: ReadonlySet<string> = new Set([
    'is', 'assert', 'assertGuard', 'validate', 'stringify', 'safeSerialize', 'parse', 'safeParse'
]);

const RELATIVE_TYPECHECKER_INDEX_RE = /^(?:\.\.?\/)+(?:(?:src|dist)\/)?index(?:\.(?:js|cjs|mjs|ts|mts|cts))?$/;

const MAX_STATIC_DEPTH = 8;

function unwrapNonNullishType( type: ts.Type ): ts.Type
{
    if( typeof type.isUnion === 'function' && type.isUnion())
    {
        const nonNullish = type.types.filter(
            t => ( t.flags & ( ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void )) === 0
        );

        if( nonNullish.length === 1 ){ return nonNullish[0] }
    }

    return type;
}

function collectAllParsedConstraints(
    type       : ts.Type,
    checker    : ts.TypeChecker,
    extraJsDoc?: ParsedConstraint[]
): ParsedConstraint[]
{
    const target = unwrapNonNullishType( type );
    const raw: ParsedConstraint[] = [];
    const types = typeof target.isIntersection === 'function' && target.isIntersection() ? target.types : [target];

    for( const sub of types )
    {
        raw.push( ...collectConstraintsFromProps( getTypeProps( sub, checker ), checker ));
    }

    let merged = mergeConstraintsWithJsDoc( raw, extractTypeJsDocInfo( type, checker ).constraints );

    if( target !== type )
    {
        merged = mergeConstraintsWithJsDoc( merged, extractTypeJsDocInfo( target, checker ).constraints );
    }

    if( extraJsDoc && extraJsDoc.length > 0 )
    {
        merged = mergeConstraintsWithJsDoc( merged, extraJsDoc );
    }

    return merged;
}

/**
 * Extract Minimum / Length / Items-style constraints from a (possibly intersected) type.
 */
export function extractStaticConstraints(
    type       : ts.Type,
    checker    : ts.TypeChecker,
    extraJsDoc?: ParsedConstraint[]
): IStaticConstraint[]
{
    const constraints: IStaticConstraint[] = [];

    for( const c of collectAllParsedConstraints( type, checker, extraJsDoc ))
    {
        if( !STATICALLY_CHECKED.has( c.type )){ continue }

        const value = c.type === 'uniqueItems' ? true : c.value;

        if( value === undefined ){ continue }

        constraints.push({ type : c.type, value, message : c.message });
    }

    return constraints;
}

function getSymbolType( checker: ts.TypeChecker, symbol: ts.Symbol ): ts.Type | undefined
{
    const decl = symbol.valueDeclaration || symbol.declarations?.[0];

    if( !decl )
    {
        return typeof ( checker as any ).getTypeOfSymbol === 'function'
            ? ( checker as any ).getTypeOfSymbol( symbol )
            : undefined;
    }

    return checker.getTypeOfSymbolAtLocation( symbol, decl );
}

type ConstantValue =
    | { kind : 'number', value : number | bigint }
    | { kind : 'string', value : string }
    | { kind : 'array', value : any[] }
    | { kind : 'object', keyCount : number };

function applyStaticTransforms(
    constant          : ConstantValue,
    parsedConstraints : ParsedConstraint[]
): { value : ConstantValue | undefined, skip : boolean }
{
    if( parsedConstraints.some( c => c.type === 'transform_custom' ))
    {
        return { value : undefined, skip : true };
    }

    let current: ConstantValue = constant;

    for( const c of parsedConstraints )
    {
        if( c.type === 'transform_trim' && current.kind === 'string' )
        {
            current = { kind : 'string', value : current.value.trim() };
        }
        else if( c.type === 'transform_lowercase' && current.kind === 'string' )
        {
            current = { kind : 'string', value : current.value.toLowerCase() };
        }
        else if( c.type === 'transform_uppercase' && current.kind === 'string' )
        {
            current = { kind : 'string', value : current.value.toUpperCase() };
        }
        else if( c.type === 'transform_capitalize' && current.kind === 'string' )
        {
            current = {
                kind  : 'string',
                value : current.value.length > 0
                    ? current.value[0].toUpperCase() + current.value.slice( 1 )
                    : ''
            };
        }
        else if( c.type === 'transform_tonumber' && current.kind === 'string' )
        {
            const trimmed = current.value.trim();

            if( trimmed === '' ){ return { value : undefined, skip : true } }

            const num = Number( trimmed );

            if( Number.isNaN( num )){ return { value : undefined, skip : true } }

            current = { kind : 'number', value : num };
        }
        else if( c.type === 'transform_toboolean' && current.kind === 'string' )
        {
            return { value : undefined, skip : true };
        }
    }

    return { value : current, skip : false };
}

export function unwrapExpression( expr: ts.Expression ): ts.Expression
{
    while(
        ts.isParenthesizedExpression( expr ) ||
        ts.isAsExpression( expr ) ||
        ( typeof ts.isSatisfiesExpression === 'function' && ts.isSatisfiesExpression( expr )) ||
        ts.isTypeAssertionExpression( expr )
    )
    {
        expr = expr.expression;
    }

    return expr;
}

export function isTypecheckerImport(
    moduleName  : string,
    sourceFile? : ts.SourceFile,
    checker?    : ts.TypeChecker,
    importDecl? : ts.ImportDeclaration
): boolean
{
    if( moduleName === '@webergency-utils/typechecker' || moduleName.startsWith( '@webergency-utils/typechecker/' ))
    {
        return true;
    }

    if( !RELATIVE_TYPECHECKER_INDEX_RE.test( moduleName )){ return false }

    if( importDecl && checker )
    {
        try
        {
            const modSym = checker.getSymbolAtLocation( importDecl.moduleSpecifier );

            if( modSym )
            {
                const exports = checker.getExportsOfModule( modSym );

                return exports.some( s => s.name === 'jsonSchema' ) &&
                    exports.some( s => s.name === 'standardSchema' );
            }
        }
        catch
        { /* unresolved module specifier */ }
    }

    if( sourceFile )
    {
        const dir = path.dirname( path.resolve( sourceFile.fileName ));
        const targetBase = path.resolve( dir, moduleName ).replace( /\.(?:js|cjs|mjs|ts|mts|cts)$/, '' );

        if(
            fs.existsSync( `${targetBase}.ts` ) ||
            fs.existsSync( `${targetBase}.js` ) ||
            fs.existsSync( `${targetBase}.d.ts` )
        )
        {
            const targetDir = path.dirname( targetBase );

            return fs.existsSync( path.join( targetDir, 'runtime', 'validators.ts' )) ||
                fs.existsSync( path.join( targetDir, 'runtime', 'validators.js' )) ||
                fs.existsSync( path.join( targetDir, 'runtime', 'validators.d.ts' ));
        }
    }

    return true;
}

function tryGetConstantObject( obj: ts.ObjectLiteralExpression ): Record<string, any> | undefined
{
    const entries: [ string, any ][] = [];

    for( const prop of obj.properties )
    {
        if( !ts.isPropertyAssignment( prop )){ return undefined }

        const name = prop.name;

        if( !ts.isIdentifier( name ) && !ts.isStringLiteral( name )){ return undefined }

        const inner = unwrapExpression( prop.initializer );

        if( ts.isObjectLiteralExpression( inner ))
        {
            const nested = tryGetConstantObject( inner );

            if( !nested ){ return undefined }

            entries.push([ name.text, nested ]);
            continue;
        }

        const c = tryGetConstantValue( inner );

        if( !c || c.kind === 'object' ){ return undefined }

        entries.push([ name.text, c.value ]);
    }

    entries.sort(( a, b ) => a[0].localeCompare( b[0]));

    return Object.fromEntries( entries );
}

/**
 * Resolve a compile-time constant from an expression, or undefined if not constant.
 */
export function tryGetConstantValue( expr: ts.Expression ): ConstantValue | undefined
{
    expr = unwrapExpression( expr );

    if( ts.isNumericLiteral( expr ))
    {
        return { kind : 'number', value : Number( expr.text ) };
    }

    if( ts.isBigIntLiteral( expr ))
    {
        return { kind : 'number', value : BigInt( expr.text.slice( 0, -1 )) };
    }

    if( ts.isPrefixUnaryExpression( expr ) && expr.operator === ts.SyntaxKind.MinusToken )
    {
        const inner = tryGetConstantValue( expr.operand );

        if( inner?.kind === 'number' )
        {
            if( typeof inner.value === 'bigint' ){ return { kind : 'number', value : -inner.value } }

            return { kind : 'number', value : -inner.value };
        }
    }

    if( ts.isStringLiteral( expr ) || ts.isNoSubstitutionTemplateLiteral( expr ))
    {
        return { kind : 'string', value : expr.text };
    }

    if( ts.isArrayLiteralExpression( expr ))
    {
        const items: any[] = [];

        for( const el of expr.elements )
        {
            if( ts.isSpreadElement( el )){ return undefined }

            const unwrappedEl = unwrapExpression( el );

            if( ts.isObjectLiteralExpression( unwrappedEl ))
            {
                const objVal = tryGetConstantObject( unwrappedEl );

                if( !objVal ){ return undefined }

                items.push( objVal );
                continue;
            }

            const c = tryGetConstantValue( unwrappedEl );

            if( !c || c.kind === 'object' ){ return undefined }

            items.push( c.value );
        }

        return { kind : 'array', value : items };
    }

    if( ts.isObjectLiteralExpression( expr ))
    {
        let keyCount = 0;

        for( const prop of expr.properties )
        {
            if( ts.isSpreadAssignment( prop )){ return undefined }

            if( ts.isPropertyAssignment( prop ) ||
                ts.isShorthandPropertyAssignment( prop ) ||
                ts.isMethodDeclaration( prop ) ||
                ts.isGetAccessorDeclaration( prop ) ||
                ts.isSetAccessorDeclaration( prop ))
            {
                keyCount++;
            }
        }

        return { kind : 'object', keyCount };
    }

    return undefined;
}

export function evaluateStaticConstraints(
    constant: ConstantValue,
    constraints: IStaticConstraint[]
): string[]
{
    const errors: string[] = [];

    for( const c of constraints )
    {
        if( c.type === 'minimum' && constant.kind === 'number' )
        {
            if( constant.value < c.value )
            {
                errors.push( c.message || `Value ${String( constant.value )} does not satisfy Minimum<${c.value}>` );
            }
        }
        else if( c.type === 'maximum' && constant.kind === 'number' )
        {
            if( constant.value > c.value )
            {
                errors.push( c.message || `Value ${String( constant.value )} does not satisfy Maximum<${c.value}>` );
            }
        }
        else if( c.type === 'exclusiveMinimum' && constant.kind === 'number' )
        {
            if( constant.value <= c.value )
            {
                errors.push( c.message || `Value ${String( constant.value )} does not satisfy ExclusiveMinimum<${c.value}>` );
            }
        }
        else if( c.type === 'exclusiveMaximum' && constant.kind === 'number' )
        {
            if( constant.value >= c.value )
            {
                errors.push( c.message || `Value ${String( constant.value )} does not satisfy ExclusiveMaximum<${c.value}>` );
            }
        }
        else if( c.type === 'multipleOf' && constant.kind === 'number' )
        {
            const v = constant.value;
            const n = c.value;
            let ok: boolean;

            if( typeof v === 'bigint' || typeof n === 'bigint' )
            {
                if(( typeof v === 'number' && !Number.isInteger( v )) || ( typeof n === 'number' && !Number.isInteger( n )))
                {
                    ok = false;
                }
                else
                {
                    ok = BigInt( n ) !== 0n && BigInt( v ) % BigInt( n ) === 0n;
                }
            }
            else
            {
                ok = isMultipleOfNumber( v, n );
            }

            if( !ok )
            {
                errors.push( c.message || `Value ${String( v )} does not satisfy MultipleOf<${n}>` );
            }
        }
        else if( c.type === 'minLength' && constant.kind === 'string' )
        {
            if( constant.value.length < c.value )
            {
                errors.push( c.message || `Value length ${constant.value.length} does not satisfy MinLength<${c.value}>` );
            }
        }
        else if( c.type === 'maxLength' && constant.kind === 'string' )
        {
            if( constant.value.length > c.value )
            {
                errors.push( c.message || `Value length ${constant.value.length} does not satisfy MaxLength<${c.value}>` );
            }
        }
        else if( c.type === 'minItems' && constant.kind === 'array' )
        {
            if( constant.value.length < c.value )
            {
                errors.push( c.message || `Array length ${constant.value.length} does not satisfy MinItems<${c.value}>` );
            }
        }
        else if( c.type === 'maxItems' && constant.kind === 'array' )
        {
            if( constant.value.length > c.value )
            {
                errors.push( c.message || `Array length ${constant.value.length} does not satisfy MaxItems<${c.value}>` );
            }
        }
        else if( c.type === 'uniqueItems' && constant.kind === 'array' )
        {
            if( !hasUniqueItems( constant.value ))
            {
                errors.push( c.message || 'Array does not satisfy UniqueItems' );
            }
        }
        else if( c.type === 'minProperties' && constant.kind === 'object' )
        {
            if( constant.keyCount < c.value )
            {
                errors.push(
                    c.message ||
                    `Object key count ${constant.keyCount} does not satisfy MinProperties<${c.value}>`
                );
            }
        }
        else if( c.type === 'maxProperties' && constant.kind === 'object' )
        {
            if( constant.keyCount > c.value )
            {
                errors.push(
                    c.message ||
                    `Object key count ${constant.keyCount} does not satisfy MaxProperties<${c.value}>`
                );
            }
        }
    }

    return errors;
}

function createDiagnostic( node: ts.Node, message: string ): ts.Diagnostic
{
    const start = node.getStart();
    const length = node.getWidth();

    return {
        file        : node.getSourceFile(),
        start,
        length,
        messageText : message,
        category    : ts.DiagnosticCategory.Error,
        code        : 90001,
        source      : 'webergency-typechecker'
    };
}

function checkExpressionAgainstType(
    expr        : ts.Expression,
    type        : ts.Type,
    checker     : ts.TypeChecker,
    diagnostics : ts.Diagnostic[],
    anchorNode? : ts.Node,
    depth       : number = 0,
    extraJsDoc? : ParsedConstraint[]
)
{
    if( depth > MAX_STATIC_DEPTH ){ return }

    const parsedConstraints = collectAllParsedConstraints( type, checker, extraJsDoc );
    const constraints: IStaticConstraint[] = [];

    for( const c of parsedConstraints )
    {
        if( !STATICALLY_CHECKED.has( c.type )){ continue }

        const value = c.type === 'uniqueItems' ? true : c.value;

        if( value === undefined ){ continue }

        constraints.push({ type : c.type, value, message : c.message });
    }

    type = unwrapNonNullishType( type );

    const unwrapped = unwrapExpression( expr );

    if( constraints.length > 0 )
    {
        const rawConstant = tryGetConstantValue( expr );
        const target = anchorNode ?? unwrapped;

        if( rawConstant )
        {
            const transformed = applyStaticTransforms( rawConstant, parsedConstraints );

            if( !transformed.skip && transformed.value )
            {
                for( const msg of evaluateStaticConstraints( transformed.value, constraints ))
                {
                    diagnostics.push( createDiagnostic( target, msg ));
                }
            }
        }
        else if( ts.isArrayLiteralExpression( unwrapped ) && !unwrapped.elements.some( ts.isSpreadElement ))
        {
            const lengthOnly = constraints.filter( c => c.type === 'minItems' || c.type === 'maxItems' );

            for( const msg of evaluateStaticConstraints(
                { kind : 'array', value : new Array( unwrapped.elements.length ) },
                lengthOnly
            ))
            {
                diagnostics.push( createDiagnostic( target, msg ));
            }
        }
    }

    if( ts.isObjectLiteralExpression( unwrapped ))
    {
        checkObjectLiteral( unwrapped, type, checker, diagnostics, anchorNode, depth );
    }
    else if( ts.isArrayLiteralExpression( unwrapped ))
    {
        checkArrayLiteral( unwrapped, type, checker, diagnostics, anchorNode, depth );
    }
}

function runtimeValueToConstant( val: unknown ): ConstantValue | undefined
{
    if( typeof val === 'number' ){ return { kind : 'number', value : val } }

    if( typeof val === 'string' ){ return { kind : 'string', value : val } }

    if( Array.isArray( val )){ return { kind : 'array', value : val } }

    if( typeof val === 'object' && val !== null )
    {
        return { kind : 'object', keyCount : Object.keys( val ).length };
    }

    return undefined;
}

function checkRuntimeConstantAgainstType(
    val         : unknown,
    type        : ts.Type,
    checker     : ts.TypeChecker,
    diagnostics : ts.Diagnostic[],
    anchorNode  : ts.Node,
    depth       : number = 0,
    extraJsDoc? : ParsedConstraint[]
)
{
    if( depth > MAX_STATIC_DEPTH || val === null || val === undefined ){ return }

    const parsedConstraints = collectAllParsedConstraints( type, checker, extraJsDoc );
    const constraints: IStaticConstraint[] = [];

    for( const c of parsedConstraints )
    {
        if( !STATICALLY_CHECKED.has( c.type )){ continue }

        const value = c.type === 'uniqueItems' ? true : c.value;

        if( value === undefined ){ continue }

        constraints.push({ type : c.type, value, message : c.message });
    }

    type = unwrapNonNullishType( type );

    if( constraints.length > 0 )
    {
        const rawConstant = runtimeValueToConstant( val );

        if( rawConstant )
        {
            const transformed = applyStaticTransforms( rawConstant, parsedConstraints );

            if( !transformed.skip && transformed.value )
            {
                for( const msg of evaluateStaticConstraints( transformed.value, constraints ))
                {
                    diagnostics.push( createDiagnostic( anchorNode, msg ));
                }
            }
        }
    }

    if( Array.isArray( val ))
    {
        const peeled = peelTaggedIntersection( type, checker );
        let baseType = peeled ? peeled.base : type;

        if( typeof baseType.isIntersection === 'function' && baseType.isIntersection())
        {
            const arrayArm = baseType.types.find( t => checker.isTupleType( t ) || checker.isArrayType( t ));

            if( arrayArm ){ baseType = arrayArm }
        }

        if( checker.isTupleType( baseType ))
        {
            const typeArgs = checker.getTypeArguments( baseType as ts.TypeReference );

            for( let i = 0; i < val.length; i++ )
            {
                const slotType = typeArgs[i] ?? checker.getIndexTypeOfType( baseType, ts.IndexKind.Number );

                if( slotType )
                {
                    checkRuntimeConstantAgainstType( val[i], slotType, checker, diagnostics, anchorNode, depth + 1 );
                }
            }
        }
        else if( checker.isArrayType( baseType ))
        {
            const elemType = checker.getTypeArguments( baseType as ts.TypeReference )[0]
                ?? checker.getIndexTypeOfType( baseType, ts.IndexKind.Number );

            if( elemType )
            {
                for( const item of val )
                {
                    checkRuntimeConstantAgainstType( item, elemType, checker, diagnostics, anchorNode, depth + 1 );
                }
            }
        }
    }
    else if( typeof val === 'object' )
    {
        for( const [propName, propVal] of Object.entries( val as Record<string, unknown> ))
        {
            const symbol = checker.getPropertyOfType( type, propName );

            if( !symbol ){ continue }

            const propType = getSymbolType( checker, symbol );

            if( !propType ){ continue }

            const propJsDoc = extractPropertyJsDocInfo( symbol, checker ).constraints;
            checkRuntimeConstantAgainstType( propVal, propType, checker, diagnostics, anchorNode, depth + 1, propJsDoc );
        }
    }
}

function resolveStaticParseSource(
    optsArg : ts.Expression | undefined,
    checker : ts.TypeChecker
): 'json' | 'query' | 'string' | 'dynamic'
{
    if( !optsArg ){ return 'json' }

    const unwrapped = unwrapExpression( optsArg );

    if( ts.isIdentifier( unwrapped ) && unwrapped.text === 'undefined' ){ return 'json' }

    if( ts.isStringLiteral( unwrapped )){ return 'json' }

    let objLit: ts.ObjectLiteralExpression | undefined;

    if( ts.isObjectLiteralExpression( unwrapped ))
    {
        objLit = unwrapped;
    }
    else if( ts.isIdentifier( unwrapped ))
    {
        const sym = checker.getSymbolAtLocation( unwrapped );
        const decl = sym?.valueDeclaration || sym?.declarations?.[0];

        if(
            decl &&
            ts.isVariableDeclaration( decl ) &&
            decl.initializer &&
            decl.parent &&
            ts.isVariableDeclarationList( decl.parent ) &&
            ( decl.parent.flags & ts.NodeFlags.Const ) !== 0
        )
        {
            const init = unwrapExpression( decl.initializer );

            if( ts.isStringLiteral( init )){ return 'json' }

            if( ts.isObjectLiteralExpression( init )){ objLit = init }
        }
    }

    if( !objLit ){ return 'dynamic' }

    let resolvedFrom: 'json' | 'query' | 'string' = 'json';
    let hasUnknownSpread = false;

    for( const prop of objLit.properties )
    {
        if( ts.isSpreadAssignment( prop ))
        {
            hasUnknownSpread = true;
            continue;
        }

        const propName = prop.name && ( ts.isIdentifier( prop.name ) || ts.isStringLiteral( prop.name ))
            ? prop.name.text
            : undefined;

        if( propName !== 'from' ){ continue }

        hasUnknownSpread = false;

        if( ts.isPropertyAssignment( prop ))
        {
            const init = unwrapExpression( prop.initializer );

            if( ts.isStringLiteral( init ) && ( init.text === 'json' || init.text === 'query' || init.text === 'string' ))
            {
                resolvedFrom = init.text;
                continue;
            }
        }

        return 'dynamic';
    }

    return hasUnknownSpread ? 'dynamic' : resolvedFrom;
}

function checkArrayLiteral(
    arr         : ts.ArrayLiteralExpression,
    type        : ts.Type,
    checker     : ts.TypeChecker,
    diagnostics : ts.Diagnostic[],
    anchorNode? : ts.Node,
    depth       : number = 0
)
{
    const peeled = peelTaggedIntersection( type, checker );
    let baseType = peeled ? peeled.base : type;

    if( typeof baseType.isIntersection === 'function' && baseType.isIntersection())
    {
        const arrayArm = baseType.types.find( t => checker.isTupleType( t ) || checker.isArrayType( t ));

        if( arrayArm ){ baseType = arrayArm }
    }

    if( checker.isTupleType( baseType ))
    {
        const typeArgs = checker.getTypeArguments( baseType as ts.TypeReference );

        for( let i = 0; i < arr.elements.length; i++ )
        {
            const el = arr.elements[i];

            if( ts.isSpreadElement( el )){ continue }

            const slotType = typeArgs[i] ?? checker.getIndexTypeOfType( baseType, ts.IndexKind.Number );

            if( slotType )
            {
                checkExpressionAgainstType( el, slotType, checker, diagnostics, anchorNode, depth + 1 );
            }
        }
    }
    else if( checker.isArrayType( baseType ))
    {
        const elemType = checker.getTypeArguments( baseType as ts.TypeReference )[0]
            ?? checker.getIndexTypeOfType( baseType, ts.IndexKind.Number );

        if( !elemType ){ return }

        for( const el of arr.elements )
        {
            if( ts.isSpreadElement( el )){ continue }

            checkExpressionAgainstType( el, elemType, checker, diagnostics, anchorNode, depth + 1 );
        }
    }
}

function checkObjectLiteral(
    obj         : ts.ObjectLiteralExpression,
    type        : ts.Type,
    checker     : ts.TypeChecker,
    diagnostics : ts.Diagnostic[],
    anchorNode? : ts.Node,
    depth       : number = 0
)
{
    for( const prop of obj.properties )
    {
        if( ts.isPropertyAssignment( prop ))
        {
            const name = prop.name;

            if( !ts.isIdentifier( name ) && !ts.isStringLiteral( name )){ continue }

            const propName = name.text;
            const symbol = checker.getPropertyOfType( type, propName );

            if( !symbol ){ continue }

            const propType = getSymbolType( checker, symbol );

            if( !propType ){ continue }

            const propJsDoc = extractPropertyJsDocInfo( symbol, checker ).constraints;
            checkExpressionAgainstType( prop.initializer, propType, checker, diagnostics, anchorNode, depth + 1, propJsDoc );
        }
        else if( ts.isShorthandPropertyAssignment( prop ))
        {
            const propName = prop.name.text;
            const symbol = checker.getPropertyOfType( type, propName );

            if( !symbol ){ continue }

            const propType = getSymbolType( checker, symbol );

            if( !propType ){ continue }

            const valueSymbol = checker.getShorthandAssignmentValueSymbol( prop );
            const decl = valueSymbol?.valueDeclaration;

            if( !decl || !ts.isVariableDeclaration( decl ) || !decl.initializer ){ continue }

            if( !decl.parent || !ts.isVariableDeclarationList( decl.parent )){ continue }

            if(( decl.parent.flags & ts.NodeFlags.Const ) === 0 ){ continue }

            const propJsDoc = extractPropertyJsDocInfo( symbol, checker ).constraints;
            checkExpressionAgainstType(
                decl.initializer,
                propType,
                checker,
                diagnostics,
                anchorNode ?? prop,
                depth + 1,
                propJsDoc
            );
        }
    }
}

function findEnclosingFunction( node: ts.Node ): ts.FunctionLikeDeclaration | undefined
{
    let current = node.parent;

    while( current )
    {
        if( ts.isFunctionLike( current ))
        {
            return current as ts.FunctionLikeDeclaration;
        }

        current = current.parent;
    }

    return undefined;
}

function resolveReturnCheckType( fn: ts.FunctionLikeDeclaration, checker: ts.TypeChecker ): ts.Type
{
    const rawType = checker.getTypeFromTypeNode( fn.type! );
    const isAsync = ts.canHaveModifiers( fn )
        && ( ts.getModifiers( fn )?.some( m => m.kind === ts.SyntaxKind.AsyncKeyword ) ?? false );

    if( isAsync && typeof ( checker as any ).getAwaitedType === 'function' )
    {
        const awaited = ( checker as any ).getAwaitedType( rawType ) ?? rawType;

        if( ts.isTypeReferenceNode( fn.type! ) && fn.type!.typeArguments?.[0])
        {
            return wrapTypeNodeWithJsDoc( fn.type!.typeArguments[0], awaited, checker );
        }

        return awaited;
    }

    return wrapTypeNodeWithJsDoc( fn.type!, rawType, checker );
}

/**
 * Walk a source file and emit diagnostics for constant values that violate tag constraints.
 */
export function collectStaticConstraintDiagnostics(
    sourceFile: ts.SourceFile,
    checker: ts.TypeChecker
): ts.Diagnostic[]
{
    const rawDiagnostics: ts.Diagnostic[] = [];
    const helperBindings = new Map<string, { importedName : string, decl : ts.ImportSpecifier }>();
    const helperNamespaces = new Map<string, ts.NamespaceImport>();

    for( const statement of sourceFile.statements )
    {
        if( !ts.isImportDeclaration( statement )){ continue }

        const moduleName = ts.isStringLiteral( statement.moduleSpecifier )
            ? statement.moduleSpecifier.text
            : '';

        if( !isTypecheckerImport( moduleName, sourceFile, checker, statement )){ continue }

        const bindings = statement.importClause?.namedBindings;

        if( bindings && ts.isNamedImports( bindings ))
        {
            for( const element of bindings.elements )
            {
                const importedName = element.propertyName?.text || element.name.text;

                if( STATIC_MACRO_FUNCTIONS.has( importedName ))
                {
                    helperBindings.set( element.name.text, { importedName, decl : element });
                }
            }
        }
        else if( bindings && ts.isNamespaceImport( bindings ))
        {
            helperNamespaces.set( bindings.name.text, bindings );
        }
    }

    const visit = ( node: ts.Node ) =>
    {
        if(
            ( ts.isVariableDeclaration( node ) || ts.isPropertyDeclaration( node ) || ts.isParameter( node )) &&
            node.type &&
            node.initializer
        )
        {
            const type = wrapTypeNodeWithJsDoc( node.type, checker.getTypeFromTypeNode( node.type ), checker );
            checkExpressionAgainstType( node.initializer, type, checker, rawDiagnostics );
        }
        else if( ts.isAsExpression( node ) || ts.isSatisfiesExpression( node ))
        {
            const type = wrapTypeNodeWithJsDoc( node.type, checker.getTypeFromTypeNode( node.type ), checker );
            checkExpressionAgainstType( node.expression, type, checker, rawDiagnostics );
        }
        else if( ts.isReturnStatement( node ) && node.expression )
        {
            const enclosingFn = findEnclosingFunction( node );

            if( enclosingFn && enclosingFn.type )
            {
                const returnType = resolveReturnCheckType( enclosingFn, checker );
                checkExpressionAgainstType( node.expression, returnType, checker, rawDiagnostics );
            }
        }
        else if( ts.isArrowFunction( node ) && node.type && !ts.isBlock( node.body ))
        {
            const returnType = resolveReturnCheckType( node, checker );
            checkExpressionAgainstType( node.body, returnType, checker, rawDiagnostics );
        }
        else if( ts.isCallExpression( node ) && node.typeArguments?.[0] && node.arguments[0])
        {
            let fnName: string | undefined;

            if( ts.isIdentifier( node.expression ))
            {
                const entry = helperBindings.get( node.expression.text );

                if( entry )
                {
                    const sym = checker.getSymbolAtLocation( node.expression );

                    if( !sym?.declarations?.length || sym.declarations.includes( entry.decl ))
                    {
                        fnName = entry.importedName;
                    }
                }
            }
            else if(
                ts.isPropertyAccessExpression( node.expression ) &&
                ts.isIdentifier( node.expression.expression )
            )
            {
                const nsDecl = helperNamespaces.get( node.expression.expression.text );

                if( nsDecl )
                {
                    const sym = checker.getSymbolAtLocation( node.expression.expression );

                    if( !sym?.declarations?.length || sym.declarations.includes( nsDecl ))
                    {
                        fnName = node.expression.name.text;
                    }
                }
            }

            if( fnName && STATIC_MACRO_FUNCTIONS.has( fnName ))
            {
                const typeNode = node.typeArguments[0];
                const type = wrapTypeNodeWithJsDoc( typeNode, checker.getTypeFromTypeNode( typeNode ), checker );

                if( fnName === 'parse' || fnName === 'safeParse' )
                {
                    const src = resolveStaticParseSource( node.arguments[1], checker );

                    if( src === 'string' )
                    {
                        checkExpressionAgainstType( node.arguments[0], type, checker, rawDiagnostics );
                    }
                    else if( src === 'json' )
                    {
                        const rawConst = tryGetConstantValue( node.arguments[0]);

                        if( rawConst?.kind === 'string' )
                        {
                            const targetNode = unwrapExpression( node.arguments[0]);

                            try
                            {
                                const parsed = JSON.parse( rawConst.value );
                                checkRuntimeConstantAgainstType( parsed, type, checker, rawDiagnostics, targetNode, 0 );
                            }
                            catch
                            {
                                rawDiagnostics.push( createDiagnostic( targetNode, `Invalid JSON literal passed to ${fnName}` ));
                            }
                        }
                    }
                }
                else
                {
                    checkExpressionAgainstType( node.arguments[0], type, checker, rawDiagnostics );
                }
            }
        }

        ts.forEachChild( node, visit );
    };

    visit( sourceFile );

    const seen = new Set<string>();
    const diagnostics: ts.Diagnostic[] = [];

    for( const d of rawDiagnostics )
    {
        const key = `${d.start}:${d.length}:${String( d.messageText )}`;

        if( seen.has( key )){ continue }

        seen.add( key );
        diagnostics.push( d );
    }

    return diagnostics;
}

const STATIC_DIAGNOSTICS_INSTALLED = Symbol.for( '@webergency-utils/typechecker:static-diagnostics-installed' );

/**
 * Analyze the program and patch getSemanticDiagnostics so constant constraint violations appear in tsc/IDE.
 */
export function installStaticConstraintDiagnostics( program: ts.Program )
{
    if(( program as any )[STATIC_DIAGNOSTICS_INSTALLED])
    {
        return ( program as any )[STATIC_DIAGNOSTICS_INSTALLED] as ts.Diagnostic[];
    }

    const checker = program.getTypeChecker();
    const collected: ts.Diagnostic[] = [];

    for( const sourceFile of program.getSourceFiles())
    {
        if( sourceFile.isDeclarationFile ){ continue }

        if( sourceFile.fileName.includes( 'node_modules' )){ continue }

        collected.push( ...collectStaticConstraintDiagnostics( sourceFile, checker ));
    }

    const previous = program.getSemanticDiagnostics.bind( program );

    program.getSemanticDiagnostics = (( sourceFile?: ts.SourceFile, cancellationToken?: ts.CancellationToken ) =>
    {
        const base = previous( sourceFile, cancellationToken );
        const extra = sourceFile
            ? collected.filter( d => d.file === sourceFile )
            : collected;

        return [ ...base, ...extra ];
    }) as typeof program.getSemanticDiagnostics;

    ( program as any )[STATIC_DIAGNOSTICS_INSTALLED] = collected;

    return collected;
}
