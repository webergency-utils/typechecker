import ts from 'typescript';
import { TagName } from './tagKeys.js';
import { collectConstraintsFromProps, getTypeProps } from './type-helpers.js';

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
    'minItems', 'maxItems', 'uniqueItems'
]);

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
    | { kind : 'array', value : any[] };

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

            const c = tryGetConstantValue( el );

            if( !c ){ return undefined }

            if( c.kind === 'array' ){ items.push( c.value ) }
            else { items.push( c.value ) }
        }

        return { kind : 'array', value : items };
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
                const key = typeof item === 'object' && item !== null ? JSON.stringify( item ) : item;

                if( seen.has( key ))
                {
                    errors.push( c.message || 'Array does not satisfy UniqueItems' );
                    break;
                }
                seen.add( key );
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
    expr: ts.Expression,
    type: ts.Type,
    checker: ts.TypeChecker,
    diagnostics: ts.Diagnostic[]
)
{
    const constraints = extractStaticConstraints( type, checker );

    if( constraints.length === 0 )
    {
        // Still recurse into object literals for nested tagged properties
        if( ts.isObjectLiteralExpression( unwrapExpression( expr )))
        {
            checkObjectLiteral( unwrapExpression( expr ) as ts.ObjectLiteralExpression, type, checker, diagnostics );
        }

        return;
    }

    const constant = tryGetConstantValue( expr );

    if( !constant )
    {
        if( ts.isObjectLiteralExpression( unwrapExpression( expr )))
        {
            checkObjectLiteral( unwrapExpression( expr ) as ts.ObjectLiteralExpression, type, checker, diagnostics );
        }

        return;
    }

    for( const msg of evaluateStaticConstraints( constant, constraints ))
    {
        diagnostics.push( createDiagnostic( expr, msg ));
    }
}

function checkObjectLiteral(
    obj: ts.ObjectLiteralExpression,
    type: ts.Type,
    checker: ts.TypeChecker,
    diagnostics: ts.Diagnostic[]
)
{
    for( const prop of obj.properties )
    {
        if( !ts.isPropertyAssignment( prop )){ continue }

        const name = prop.name;

        if( !ts.isIdentifier( name ) && !ts.isStringLiteral( name )){ continue }

        const propName = name.text;
        const symbol = checker.getPropertyOfType( type, propName );

        if( !symbol ){ continue }

        const propType = getSymbolType( checker, symbol );

        if( !propType ){ continue }

        checkExpressionAgainstType( prop.initializer, propType, checker, diagnostics );
    }
}

/**
 * Walk a source file and emit diagnostics for constant values that violate tag constraints.
 */
export function collectStaticConstraintDiagnostics(
    sourceFile: ts.SourceFile,
    checker: ts.TypeChecker
): ts.Diagnostic[]
{
    const diagnostics: ts.Diagnostic[] = [];

    const visit = ( node: ts.Node ) =>
    {
        if( ts.isVariableDeclaration( node ) && node.type && node.initializer )
        {
            const type = checker.getTypeFromTypeNode( node.type );
            checkExpressionAgainstType( node.initializer, type, checker, diagnostics );
        }
        else if( ts.isPropertyDeclaration( node ) && node.type && node.initializer )
        {
            const type = checker.getTypeFromTypeNode( node.type );
            checkExpressionAgainstType( node.initializer, type, checker, diagnostics );
        }
        else if( ts.isParameter( node ) && node.type && node.initializer )
        {
            const type = checker.getTypeFromTypeNode( node.type );
            checkExpressionAgainstType( node.initializer, type, checker, diagnostics );
        }

        ts.forEachChild( node, visit );
    };

    visit( sourceFile );

    return diagnostics;
}

/**
 * Analyze the program and patch getSemanticDiagnostics so constant constraint violations appear in tsc/IDE.
 */
export function installStaticConstraintDiagnostics( program: ts.Program )
{
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

    return collected;
}
