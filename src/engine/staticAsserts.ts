import ts from 'typescript';
import { TagName } from './tagKeys.js';
import { collectConstraintsFromProps, getTypeProps, peelTaggedIntersection } from './type-helpers.js';

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
    'is', 'assert', 'assertGuard', 'validate', 'stringify'
]);

const MAX_STATIC_DEPTH = 8;

/**
 * Extract Minimum / Length / Items-style constraints from a (possibly intersected) type.
 */
export function extractStaticConstraints( type: ts.Type, checker: ts.TypeChecker ): IStaticConstraint[]
{
    const constraints: IStaticConstraint[] = [];
    const types = typeof type.isIntersection === 'function' && type.isIntersection() ? type.types : [type];

    for( const sub of types )
    {
        for( const c of collectConstraintsFromProps( getTypeProps( sub, checker ), checker ))
        {
            if( !STATICALLY_CHECKED.has( c.type )){ continue }

            const value = c.type === 'uniqueItems' ? true : c.value;

            if( value === undefined ){ continue }

            constraints.push({ type : c.type, value, message : c.message });
        }
    }

    return constraints;
}

function getSymbolType( checker: ts.TypeChecker, symbol: ts.Symbol ): ts.Type | undefined
{
    const decl = symbol.valueDeclaration || symbol.declarations?.[0];

    if( !decl ){ return undefined }

    return checker.getTypeOfSymbolAtLocation( symbol, decl );
}

type ConstantValue =
    | { kind : 'number', value : number | bigint }
    | { kind : 'string', value : string }
    | { kind : 'array', value : any[] }
    | { kind : 'object', keyCount : number };

function unwrapExpression( expr: ts.Expression ): ts.Expression
{
    while(
        ts.isParenthesizedExpression( expr ) ||
        ts.isAsExpression( expr ) ||
        ts.isTypeAssertionExpression( expr ) ||
        ts.isSatisfiesExpression( expr )
    )
    {
        expr = expr.expression;
    }

    return expr;
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
                ok = BigInt( v ) % BigInt( n ) === 0n;
            }
            else
            {
                const q = v / n;

                ok = Math.abs( q - Math.round( q )) <= 1e-8 * Math.max( 1, Math.abs( q ));
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
            const seen = new Set();

            for( const item of constant.value )
            {
                const key = typeof item === 'object' && item !== null
                    ? JSON.stringify( item, ( _k, v ) => typeof v === 'bigint' ? `${v}n` : v )
                    : item;

                if( seen.has( key ))
                {
                    errors.push( c.message || 'Array does not satisfy UniqueItems' );
                    break;
                }
                seen.add( key );
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
    depth       : number = 0
)
{
    if( depth > MAX_STATIC_DEPTH ){ return }

    const constraints = extractStaticConstraints( type, checker );
    const unwrapped = unwrapExpression( expr );

    if( constraints.length > 0 )
    {
        const constant = tryGetConstantValue( expr );
        const target = anchorNode ?? unwrapped;

        if( constant )
        {
            for( const msg of evaluateStaticConstraints( constant, constraints ))
            {
                diagnostics.push( createDiagnostic( target, msg ));
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

            const slotType = typeArgs[i] ?? checker.getNumberIndexType( baseType );

            if( slotType )
            {
                checkExpressionAgainstType( el, slotType, checker, diagnostics, anchorNode, depth + 1 );
            }
        }
    }
    else if( checker.isArrayType( baseType ))
    {
        const elemType = checker.getTypeArguments( baseType as ts.TypeReference )[0]
            ?? checker.getNumberIndexType( baseType );

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

            checkExpressionAgainstType( prop.initializer, propType, checker, diagnostics, anchorNode, depth + 1 );
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

            checkExpressionAgainstType(
                decl.initializer,
                propType,
                checker,
                diagnostics,
                anchorNode ?? prop,
                depth + 1
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
        return ( checker as any ).getAwaitedType( rawType ) ?? rawType;
    }

    return rawType;
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
    const helperBindings = new Map<string, string>();
    const helperNamespaces = new Set<string>();

    for( const statement of sourceFile.statements )
    {
        if( !ts.isImportDeclaration( statement )){ continue }

        const moduleName = ts.isStringLiteral( statement.moduleSpecifier )
            ? statement.moduleSpecifier.text
            : '';
        const isTypecheckerImport = moduleName === '@webergency-utils/typechecker' ||
            /(?:^|\/)(?:src\/)?index\.(?:js|ts)$/.test( moduleName );

        if( !isTypecheckerImport ){ continue }

        const bindings = statement.importClause?.namedBindings;

        if( bindings && ts.isNamedImports( bindings ))
        {
            for( const element of bindings.elements )
            {
                const importedName = element.propertyName?.text || element.name.text;

                if( STATIC_MACRO_FUNCTIONS.has( importedName ))
                {
                    helperBindings.set( element.name.text, importedName );
                }
            }
        }
        else if( bindings && ts.isNamespaceImport( bindings ))
        {
            helperNamespaces.add( bindings.name.text );
        }
    }

    const visit = ( node: ts.Node ) =>
    {
        if( ts.isVariableDeclaration( node ) && node.type && node.initializer )
        {
            const type = checker.getTypeFromTypeNode( node.type );
            checkExpressionAgainstType( node.initializer, type, checker, rawDiagnostics );
        }
        else if( ts.isPropertyDeclaration( node ) && node.type && node.initializer )
        {
            const type = checker.getTypeFromTypeNode( node.type );
            checkExpressionAgainstType( node.initializer, type, checker, rawDiagnostics );
        }
        else if( ts.isParameter( node ) && node.type && node.initializer )
        {
            const type = checker.getTypeFromTypeNode( node.type );
            checkExpressionAgainstType( node.initializer, type, checker, rawDiagnostics );
        }
        else if( ts.isAsExpression( node ) || ts.isSatisfiesExpression( node ))
        {
            const type = checker.getTypeFromTypeNode( node.type );
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
                fnName = helperBindings.get( node.expression.text );
            }
            else if(
                ts.isPropertyAccessExpression( node.expression ) &&
                ts.isIdentifier( node.expression.expression ) &&
                helperNamespaces.has( node.expression.expression.text )
            )
            {
                fnName = node.expression.name.text;
            }

            if( fnName && STATIC_MACRO_FUNCTIONS.has( fnName ))
            {
                const type = checker.getTypeFromTypeNode( node.typeArguments[0]);
                checkExpressionAgainstType( node.arguments[0], type, checker, rawDiagnostics );
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
