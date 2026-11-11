import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';
import {
    formatConstraintMessage,
    hasUniqueItems,
    isMultipleOfNumber,
    splitStringValue
} from '../runtime/validators.js';
import { isSafeRegexSource } from '../runtime/regex.js';
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

export const LITERAL_CONSTRAINT_DIAGNOSTIC_CODE = 90001;
export const CONTRADICTORY_CONSTRAINT_DIAGNOSTIC_CODE = 90002;

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
    'integer', 'safeInteger', 'positive', 'nonNegative', 'negative', 'finite',
    'minDate', 'maxDate',
    'minItems', 'maxItems', 'uniqueItems',
    'minProperties', 'maxProperties'
]);

const BOOLEAN_FLAG_CONSTRAINTS: ReadonlySet<string> = new Set([
    'uniqueItems', 'integer', 'safeInteger', 'positive', 'nonNegative', 'negative', 'finite'
]);

const STATIC_MACRO_FUNCTIONS: ReadonlySet<string> = new Set([
    'is', 'assert', 'assertGuard', 'validate', 'stringify', 'safeSerialize', 'parse', 'safeParse'
]);

const ALL_MACRO_FUNCTIONS: ReadonlySet<string> = new Set([
    'is', 'assert', 'assertGuard', 'validate', 'validator', 'standardSchema', 'jsonSchema',
    'stringify', 'serializer', 'safeSerialize',
    'parse', 'parser', 'safeParse',
    'clone', 'cloner', 'prune', 'pruner',
    'random', 'randomGenerator'
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
        try
        {
            raw.push( ...collectConstraintsFromProps( getTypeProps( sub, checker ), checker ));
        }
        catch
        {
            // Uninstantiated generic tag definitions (e.g. Custom<Fn>) are validated during macro codegen.
        }
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

function toStaticConstraints( parsedConstraints: ParsedConstraint[]): IStaticConstraint[]
{
    const constraints: IStaticConstraint[] = [];

    for( const c of parsedConstraints )
    {
        if( !STATICALLY_CHECKED.has( c.type )){ continue }

        const value = BOOLEAN_FLAG_CONSTRAINTS.has( c.type )
            ? ( c.value === undefined ? true : c.value )
            : c.value;

        if( value === undefined ){ continue }

        constraints.push({ type : c.type, value, message : c.message });
    }

    return constraints;
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
    return toStaticConstraints( collectAllParsedConstraints( type, checker, extraJsDoc ));
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
        if( c.type === 'transform_split' && current.kind === 'string' )
        {
            const delim = typeof c.value === 'string' ? c.value : ',';
            current = { kind : 'array', value : splitStringValue( current.value, delim ) };
        }
        else if( c.type === 'transform_trim' && current.kind === 'string' )
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

function constantRawValue( constant: ConstantValue ): unknown
{
    if( constant.kind === 'object' ){ return `{...${constant.keyCount} keys}` }

    return constant.value;
}

function resolveStaticMsg(
    msg             : string | undefined,
    fallbackMessage : string | undefined,
    defaultMsg      : string,
    pathStr         : string,
    constant        : ConstantValue,
    isSecret        : boolean
): string
{
    const template = msg || fallbackMessage;

    if( !template ){ return defaultMsg }

    return formatConstraintMessage( template, pathStr, constantRawValue( constant ), isSecret );
}

export function evaluateStaticConstraints(
    constant        : ConstantValue,
    constraints     : IStaticConstraint[],
    pathStr         : string = '',
    isSecret        : boolean = false,
    fallbackMessage?: string
): string[]
{
    const errors: string[] = [];
    const dispVal = isSecret ? '[REDACTED]' : String( constantRawValue( constant ));

    for( const c of constraints )
    {
        if( c.type === 'minimum' && constant.kind === 'number' )
        {
            if( constant.value < c.value )
            {
                errors.push( resolveStaticMsg(
                    c.message, fallbackMessage,
                    `Value ${dispVal} does not satisfy Minimum<${c.value}>`,
                    pathStr, constant, isSecret
                ));
            }
        }
        else if( c.type === 'maximum' && constant.kind === 'number' )
        {
            if( constant.value > c.value )
            {
                errors.push( resolveStaticMsg(
                    c.message, fallbackMessage,
                    `Value ${dispVal} does not satisfy Maximum<${c.value}>`,
                    pathStr, constant, isSecret
                ));
            }
        }
        else if( c.type === 'exclusiveMinimum' && constant.kind === 'number' )
        {
            if( constant.value <= c.value )
            {
                errors.push( resolveStaticMsg(
                    c.message, fallbackMessage,
                    `Value ${dispVal} does not satisfy ExclusiveMinimum<${c.value}>`,
                    pathStr, constant, isSecret
                ));
            }
        }
        else if( c.type === 'exclusiveMaximum' && constant.kind === 'number' )
        {
            if( constant.value >= c.value )
            {
                errors.push( resolveStaticMsg(
                    c.message, fallbackMessage,
                    `Value ${dispVal} does not satisfy ExclusiveMaximum<${c.value}>`,
                    pathStr, constant, isSecret
                ));
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
                errors.push( resolveStaticMsg(
                    c.message, fallbackMessage,
                    `Value ${dispVal} does not satisfy MultipleOf<${n}>`,
                    pathStr, constant, isSecret
                ));
            }
        }
        else if( c.type === 'integer' && constant.kind === 'number' )
        {
            if( typeof constant.value === 'number' && !Number.isInteger( constant.value ))
            {
                errors.push( resolveStaticMsg(
                    c.message, fallbackMessage,
                    `Value ${dispVal} does not satisfy Integer`,
                    pathStr, constant, isSecret
                ));
            }
        }
        else if( c.type === 'safeInteger' && constant.kind === 'number' )
        {
            if(
                ( typeof constant.value === 'number' && !Number.isSafeInteger( constant.value )) ||
                ( typeof constant.value === 'bigint' && ( constant.value < -9007199254740991n || constant.value > 9007199254740991n ))
            )
            {
                errors.push( resolveStaticMsg(
                    c.message, fallbackMessage,
                    `Value ${dispVal} does not satisfy SafeInteger`,
                    pathStr, constant, isSecret
                ));
            }
        }
        else if( c.type === 'positive' && constant.kind === 'number' )
        {
            if(( typeof constant.value === 'number' && !( constant.value > 0 )) || ( typeof constant.value === 'bigint' && constant.value <= 0n ))
            {
                errors.push( resolveStaticMsg(
                    c.message, fallbackMessage,
                    `Value ${dispVal} does not satisfy Positive`,
                    pathStr, constant, isSecret
                ));
            }
        }
        else if( c.type === 'nonNegative' && constant.kind === 'number' )
        {
            if(( typeof constant.value === 'number' && !( constant.value >= 0 )) || ( typeof constant.value === 'bigint' && constant.value < 0n ))
            {
                errors.push( resolveStaticMsg(
                    c.message, fallbackMessage,
                    `Value ${dispVal} does not satisfy NonNegative`,
                    pathStr, constant, isSecret
                ));
            }
        }
        else if( c.type === 'negative' && constant.kind === 'number' )
        {
            if(( typeof constant.value === 'number' && !( constant.value < 0 )) || ( typeof constant.value === 'bigint' && constant.value >= 0n ))
            {
                errors.push( resolveStaticMsg(
                    c.message, fallbackMessage,
                    `Value ${dispVal} does not satisfy Negative`,
                    pathStr, constant, isSecret
                ));
            }
        }
        else if( c.type === 'finite' && constant.kind === 'number' )
        {
            if( typeof constant.value === 'number' && !Number.isFinite( constant.value ))
            {
                errors.push( resolveStaticMsg(
                    c.message, fallbackMessage,
                    `Value ${dispVal} does not satisfy Finite`,
                    pathStr, constant, isSecret
                ));
            }
        }
        else if( c.type === 'minDate' && constant.kind === 'string' && typeof c.value === 'string' )
        {
            const ms = Date.parse( constant.value );
            const bound = Date.parse( c.value );

            if( !Number.isNaN( bound ) && ( Number.isNaN( ms ) || ms < bound ))
            {
                errors.push( resolveStaticMsg(
                    c.message, fallbackMessage,
                    `Value ${dispVal} does not satisfy MinDate<'${c.value}'>`,
                    pathStr, constant, isSecret
                ));
            }
        }
        else if( c.type === 'maxDate' && constant.kind === 'string' && typeof c.value === 'string' )
        {
            const ms = Date.parse( constant.value );
            const bound = Date.parse( c.value );

            if( !Number.isNaN( bound ) && ( Number.isNaN( ms ) || ms > bound ))
            {
                errors.push( resolveStaticMsg(
                    c.message, fallbackMessage,
                    `Value ${dispVal} does not satisfy MaxDate<'${c.value}'>`,
                    pathStr, constant, isSecret
                ));
            }
        }
        else if( c.type === 'minLength' && constant.kind === 'string' )
        {
            if( constant.value.length < c.value )
            {
                errors.push( resolveStaticMsg(
                    c.message, fallbackMessage,
                    `Value length ${constant.value.length} does not satisfy MinLength<${c.value}>`,
                    pathStr, constant, isSecret
                ));
            }
        }
        else if( c.type === 'maxLength' && constant.kind === 'string' )
        {
            if( constant.value.length > c.value )
            {
                errors.push( resolveStaticMsg(
                    c.message, fallbackMessage,
                    `Value length ${constant.value.length} does not satisfy MaxLength<${c.value}>`,
                    pathStr, constant, isSecret
                ));
            }
        }
        else if( c.type === 'minItems' && constant.kind === 'array' )
        {
            if( constant.value.length < c.value )
            {
                errors.push( resolveStaticMsg(
                    c.message, fallbackMessage,
                    `Array length ${constant.value.length} does not satisfy MinItems<${c.value}>`,
                    pathStr, constant, isSecret
                ));
            }
        }
        else if( c.type === 'maxItems' && constant.kind === 'array' )
        {
            if( constant.value.length > c.value )
            {
                errors.push( resolveStaticMsg(
                    c.message, fallbackMessage,
                    `Array length ${constant.value.length} does not satisfy MaxItems<${c.value}>`,
                    pathStr, constant, isSecret
                ));
            }
        }
        else if( c.type === 'uniqueItems' && constant.kind === 'array' )
        {
            if( !hasUniqueItems( constant.value ))
            {
                errors.push( resolveStaticMsg(
                    c.message, fallbackMessage,
                    'Array does not satisfy UniqueItems',
                    pathStr, constant, isSecret
                ));
            }
        }
        else if( c.type === 'minProperties' && constant.kind === 'object' )
        {
            if( constant.keyCount < c.value )
            {
                errors.push( resolveStaticMsg(
                    c.message, fallbackMessage,
                    `Object key count ${constant.keyCount} does not satisfy MinProperties<${c.value}>`,
                    pathStr, constant, isSecret
                ));
            }
        }
        else if( c.type === 'maxProperties' && constant.kind === 'object' )
        {
            if( constant.keyCount > c.value )
            {
                errors.push( resolveStaticMsg(
                    c.message, fallbackMessage,
                    `Object key count ${constant.keyCount} does not satisfy MaxProperties<${c.value}>`,
                    pathStr, constant, isSecret
                ));
            }
        }
    }

    return errors;
}

function cmpNumeric( a: number | bigint, b: number | bigint ): number
{
    if( typeof a === typeof b )
    {
        return a < b ? -1 : ( a > b ? 1 : 0 );
    }

    const numA = Number( a );
    const numB = Number( b );

    return numA < numB ? -1 : ( numA > numB ? 1 : 0 );
}

export function evaluateConstraintContradictions( parsedConstraints: ParsedConstraint[]): string[]
{
    const errors: string[] = [];
    let min: number | bigint | undefined;
    let max: number | bigint | undefined;
    let exclMin: number | bigint | undefined;
    let exclMax: number | bigint | undefined;
    let positive = false;
    let nonNegative = false;
    let negative = false;
    let integer = false;
    let safeInteger = false;
    let minLength: number | undefined;
    let maxLength: number | undefined;
    let minItems: number | undefined;
    let maxItems: number | undefined;
    let minContains: number | undefined;
    let maxContains: number | undefined;
    let minProps: number | undefined;
    let maxProps: number | undefined;
    let minDate: string | undefined;
    let maxDate: string | undefined;

    for( const c of parsedConstraints )
    {
        if( c.type === 'minimum' && ( typeof c.value === 'number' || typeof c.value === 'bigint' )){ min = c.value }
        else if( c.type === 'maximum' && ( typeof c.value === 'number' || typeof c.value === 'bigint' )){ max = c.value }
        else if( c.type === 'exclusiveMinimum' && ( typeof c.value === 'number' || typeof c.value === 'bigint' )){ exclMin = c.value }
        else if( c.type === 'exclusiveMaximum' && ( typeof c.value === 'number' || typeof c.value === 'bigint' )){ exclMax = c.value }
        else if( c.type === 'positive' ){ positive = true }
        else if( c.type === 'nonNegative' ){ nonNegative = true }
        else if( c.type === 'negative' ){ negative = true }
        else if( c.type === 'integer' ){ integer = true }
        else if( c.type === 'safeInteger' ){ safeInteger = true }
        else if( c.type === 'multipleOf' && ( typeof c.value === 'number' || typeof c.value === 'bigint' ))
        {
            if(( typeof c.value === 'number' && !( c.value > 0 )) || ( typeof c.value === 'bigint' && c.value <= 0n ))
            {
                errors.push( `Invalid constraint: MultipleOf<${String( c.value )}> must be greater than 0` );
            }
        }
        else if( c.type === 'minLength' && typeof c.value === 'number' ){ minLength = c.value }
        else if( c.type === 'maxLength' && typeof c.value === 'number' ){ maxLength = c.value }
        else if( c.type === 'minItems' && typeof c.value === 'number' ){ minItems = c.value }
        else if( c.type === 'maxItems' && typeof c.value === 'number' ){ maxItems = c.value }
        else if( c.type === 'minContains' && typeof c.value === 'number' ){ minContains = c.value }
        else if( c.type === 'maxContains' && typeof c.value === 'number' ){ maxContains = c.value }
        else if( c.type === 'minProperties' && typeof c.value === 'number' ){ minProps = c.value }
        else if( c.type === 'maxProperties' && typeof c.value === 'number' ){ maxProps = c.value }
        else if( c.type === 'minDate' && typeof c.value === 'string' ){ minDate = c.value }
        else if( c.type === 'maxDate' && typeof c.value === 'string' ){ maxDate = c.value }
        else if( c.type === 'pattern' && typeof c.value === 'string' )
        {
            let syntaxOk = true;

            try
            {
                new RegExp( c.value );
            }
            catch
            {
                syntaxOk = false;
                errors.push( `Invalid constraint: Pattern<'${c.value}'> is not a valid regular expression` );
            }

            if( syntaxOk && !isSafeRegexSource( c.value ))
            {
                errors.push( `Unsafe constraint: Pattern<'${c.value}'> is vulnerable to catastrophic backtracking (ReDoS)` );
            }
        }
    }

    let numericFlagged = false;

    if( min !== undefined && max !== undefined && cmpNumeric( min, max ) > 0 )
    {
        errors.push( `Contradictory constraints: Minimum<${String( min )}> exceeds Maximum<${String( max )}>` );
        numericFlagged = true;
    }
    else if( exclMin !== undefined && max !== undefined && cmpNumeric( exclMin, max ) >= 0 )
    {
        errors.push( `Contradictory constraints: ExclusiveMinimum<${String( exclMin )}> must be less than Maximum<${String( max )}>` );
        numericFlagged = true;
    }
    else if( min !== undefined && exclMax !== undefined && cmpNumeric( min, exclMax ) >= 0 )
    {
        errors.push( `Contradictory constraints: Minimum<${String( min )}> must be less than ExclusiveMaximum<${String( exclMax )}>` );
        numericFlagged = true;
    }
    else if( exclMin !== undefined && exclMax !== undefined && cmpNumeric( exclMin, exclMax ) >= 0 )
    {
        errors.push( `Contradictory constraints: ExclusiveMinimum<${String( exclMin )}> must be less than ExclusiveMaximum<${String( exclMax )}>` );
        numericFlagged = true;
    }

    let lowerVal: number | bigint | undefined;
    let lowerIncl = true;
    let lowerDesc = '';

    if( min !== undefined )
    {
        lowerVal = min;
        lowerIncl = true;
        lowerDesc = `Minimum<${String( min )}>`;
    }

    if( exclMin !== undefined && ( lowerVal === undefined || cmpNumeric( exclMin, lowerVal ) >= 0 ))
    {
        lowerVal = exclMin;
        lowerIncl = false;
        lowerDesc = `ExclusiveMinimum<${String( exclMin )}>`;
    }

    if( positive && ( lowerVal === undefined || cmpNumeric( 0, lowerVal ) >= 0 ))
    {
        lowerVal = 0;
        lowerIncl = false;
        lowerDesc = 'Positive';
    }
    else if( nonNegative && ( lowerVal === undefined || cmpNumeric( 0, lowerVal ) > 0 ))
    {
        lowerVal = 0;
        lowerIncl = true;
        lowerDesc = 'NonNegative';
    }

    let upperVal: number | bigint | undefined;
    let upperIncl = true;
    let upperDesc = '';

    if( max !== undefined )
    {
        upperVal = max;
        upperIncl = true;
        upperDesc = `Maximum<${String( max )}>`;
    }

    if( exclMax !== undefined && ( upperVal === undefined || cmpNumeric( exclMax, upperVal ) <= 0 ))
    {
        upperVal = exclMax;
        upperIncl = false;
        upperDesc = `ExclusiveMaximum<${String( exclMax )}>`;
    }

    if( negative && ( upperVal === undefined || cmpNumeric( 0, upperVal ) <= 0 ))
    {
        upperVal = 0;
        upperIncl = false;
        upperDesc = 'Negative';
    }

    if( !numericFlagged && lowerVal !== undefined && upperVal !== undefined )
    {
        const cmp = cmpNumeric( lowerVal, upperVal );

        if( cmp > 0 || ( cmp === 0 && ( !lowerIncl || !upperIncl )))
        {
            errors.push( `Contradictory constraints: ${lowerDesc} conflicts with ${upperDesc}` );
            numericFlagged = true;
        }
    }

    if( !numericFlagged && ( integer || safeInteger ) && typeof lowerVal === 'number' && typeof upperVal === 'number' )
    {
        const intLo = lowerIncl ? Math.ceil( lowerVal ) : Math.floor( lowerVal ) + 1;
        const intHi = upperIncl ? Math.floor( upperVal ) : Math.ceil( upperVal ) - 1;

        if( intLo > intHi )
        {
            errors.push( `Contradictory constraints: no integer exists between ${lowerDesc} and ${upperDesc}` );
        }
    }

    if( minLength !== undefined && minLength < 0 )
    {
        errors.push( `Invalid constraint: MinLength<${minLength}> cannot be negative` );
    }

    if( maxLength !== undefined && maxLength < 0 )
    {
        errors.push( `Invalid constraint: MaxLength<${maxLength}> cannot be negative` );
    }

    if( minLength !== undefined && maxLength !== undefined && minLength >= 0 && maxLength >= 0 && minLength > maxLength )
    {
        errors.push( `Contradictory constraints: MinLength<${minLength}> exceeds MaxLength<${maxLength}>` );
    }

    if( minItems !== undefined && minItems < 0 )
    {
        errors.push( `Invalid constraint: MinItems<${minItems}> cannot be negative` );
    }

    if( maxItems !== undefined && maxItems < 0 )
    {
        errors.push( `Invalid constraint: MaxItems<${maxItems}> cannot be negative` );
    }

    if( minItems !== undefined && maxItems !== undefined && minItems >= 0 && maxItems >= 0 && minItems > maxItems )
    {
        errors.push( `Contradictory constraints: MinItems<${minItems}> exceeds MaxItems<${maxItems}>` );
    }

    if( minContains !== undefined && minContains < 0 )
    {
        errors.push( `Invalid constraint: MinContains<${minContains}> cannot be negative` );
    }

    if( maxContains !== undefined && maxContains < 0 )
    {
        errors.push( `Invalid constraint: MaxContains<${maxContains}> cannot be negative` );
    }

    if( minContains !== undefined && maxContains !== undefined && minContains >= 0 && maxContains >= 0 && minContains > maxContains )
    {
        errors.push( `Contradictory constraints: MinContains<${minContains}> exceeds MaxContains<${maxContains}>` );
    }

    if( minContains !== undefined && maxItems !== undefined && minContains >= 0 && maxItems >= 0 && minContains > maxItems )
    {
        errors.push( `Contradictory constraints: MinContains<${minContains}> exceeds MaxItems<${maxItems}>` );
    }

    if( minProps !== undefined && minProps < 0 )
    {
        errors.push( `Invalid constraint: MinProperties<${minProps}> cannot be negative` );
    }

    if( maxProps !== undefined && maxProps < 0 )
    {
        errors.push( `Invalid constraint: MaxProperties<${maxProps}> cannot be negative` );
    }

    if( minProps !== undefined && maxProps !== undefined && minProps >= 0 && maxProps >= 0 && minProps > maxProps )
    {
        errors.push( `Contradictory constraints: MinProperties<${minProps}> exceeds MaxProperties<${maxProps}>` );
    }

    if( minDate !== undefined || maxDate !== undefined )
    {
        const minMs = minDate !== undefined ? Date.parse( minDate ) : undefined;
        const maxMs = maxDate !== undefined ? Date.parse( maxDate ) : undefined;

        if( minDate !== undefined && Number.isNaN( minMs ))
        {
            errors.push( `Invalid constraint: MinDate<'${minDate}'> is not a valid ISO date` );
        }

        if( maxDate !== undefined && Number.isNaN( maxMs ))
        {
            errors.push( `Invalid constraint: MaxDate<'${maxDate}'> is not a valid ISO date` );
        }

        if( minMs !== undefined && maxMs !== undefined && !Number.isNaN( minMs ) && !Number.isNaN( maxMs ) && minMs > maxMs )
        {
            errors.push( `Contradictory constraints: MinDate<'${minDate}'> exceeds MaxDate<'${maxDate}'>` );
        }
    }

    return errors;
}

function createDiagnostic(
    node    : ts.Node,
    message : string,
    code    : number = LITERAL_CONSTRAINT_DIAGNOSTIC_CODE
): ts.Diagnostic
{
    const start = node.getStart();
    const length = node.getWidth();

    return {
        file        : node.getSourceFile(),
        start,
        length,
        messageText : message,
        category    : ts.DiagnosticCategory.Error,
        code,
        source      : 'webergency-typechecker'
    };
}

function checkTypeNodeContradictions(
    typeNode    : ts.TypeNode,
    checker     : ts.TypeChecker,
    diagnostics : ts.Diagnostic[],
    sourceFile  : ts.SourceFile,
    extraJsDoc? : ParsedConstraint[]
): void
{
    if( ts.isTypeReferenceNode( typeNode ) && !typeNode.typeArguments?.length && ( !extraJsDoc || extraJsDoc.length === 0 ))
    {
        const sym = checker.getSymbolAtLocation( typeNode.typeName );
        const decl = sym?.declarations?.[0];

        if( decl && decl.getSourceFile() === sourceFile )
        {
            return;
        }
    }

    const type = wrapTypeNodeWithJsDoc( typeNode, checker.getTypeFromTypeNode( typeNode ), checker );
    const parsedConstraints = collectAllParsedConstraints( type, checker, extraJsDoc );

    for( const msg of evaluateConstraintContradictions( parsedConstraints ))
    {
        diagnostics.push( createDiagnostic( typeNode, msg, CONTRADICTORY_CONSTRAINT_DIAGNOSTIC_CODE ));
    }
}

function checkExpressionAgainstType(
    expr        : ts.Expression,
    type        : ts.Type,
    checker     : ts.TypeChecker,
    diagnostics : ts.Diagnostic[],
    anchorNode? : ts.Node,
    depth       : number = 0,
    extraJsDoc? : ParsedConstraint[],
    propPath    : string = ''
)
{
    if( depth > MAX_STATIC_DEPTH ){ return }

    const parsedConstraints = collectAllParsedConstraints( type, checker, extraJsDoc );
    const constraints = toStaticConstraints( parsedConstraints );
    const isSecret = parsedConstraints.some( c => c.type === 'secret' );
    const fallbackMessage = parsedConstraints.find( c => c.type === 'message' )?.value;

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
                for( const msg of evaluateStaticConstraints( transformed.value, constraints, propPath, isSecret, fallbackMessage ))
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
                lengthOnly,
                propPath,
                isSecret,
                fallbackMessage
            ))
            {
                diagnostics.push( createDiagnostic( target, msg ));
            }
        }
    }

    if( ts.isObjectLiteralExpression( unwrapped ))
    {
        checkObjectLiteral( unwrapped, type, checker, diagnostics, anchorNode, depth, propPath );
    }
    else if( ts.isArrayLiteralExpression( unwrapped ))
    {
        checkArrayLiteral( unwrapped, type, checker, diagnostics, anchorNode, depth, propPath );
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
    extraJsDoc? : ParsedConstraint[],
    propPath    : string = ''
)
{
    if( depth > MAX_STATIC_DEPTH || val === null || val === undefined ){ return }

    const parsedConstraints = collectAllParsedConstraints( type, checker, extraJsDoc );
    const constraints = toStaticConstraints( parsedConstraints );
    const isSecret = parsedConstraints.some( c => c.type === 'secret' );
    const fallbackMessage = parsedConstraints.find( c => c.type === 'message' )?.value;

    type = unwrapNonNullishType( type );

    if( constraints.length > 0 )
    {
        const rawConstant = runtimeValueToConstant( val );

        if( rawConstant )
        {
            const transformed = applyStaticTransforms( rawConstant, parsedConstraints );

            if( !transformed.skip && transformed.value )
            {
                for( const msg of evaluateStaticConstraints( transformed.value, constraints, propPath, isSecret, fallbackMessage ))
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
                    const itemPath = `${propPath}[${i}]`;
                    checkRuntimeConstantAgainstType( val[i], slotType, checker, diagnostics, anchorNode, depth + 1, undefined, itemPath );
                }
            }
        }
        else if( checker.isArrayType( baseType ))
        {
            const elemType = checker.getTypeArguments( baseType as ts.TypeReference )[0]
                ?? checker.getIndexTypeOfType( baseType, ts.IndexKind.Number );

            if( elemType )
            {
                for( let i = 0; i < val.length; i++ )
                {
                    const itemPath = `${propPath}[${i}]`;
                    checkRuntimeConstantAgainstType( val[i], elemType, checker, diagnostics, anchorNode, depth + 1, undefined, itemPath );
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
            const childPath = propPath ? `${propPath}.${propName}` : propName;
            checkRuntimeConstantAgainstType( propVal, propType, checker, diagnostics, anchorNode, depth + 1, propJsDoc, childPath );
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
    depth       : number = 0,
    propPath    : string = ''
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
                checkExpressionAgainstType( el, slotType, checker, diagnostics, anchorNode, depth + 1, undefined, `${propPath}[${i}]` );
            }
        }
    }
    else if( checker.isArrayType( baseType ))
    {
        const elemType = checker.getTypeArguments( baseType as ts.TypeReference )[0]
            ?? checker.getIndexTypeOfType( baseType, ts.IndexKind.Number );

        if( !elemType ){ return }

        for( let i = 0; i < arr.elements.length; i++ )
        {
            const el = arr.elements[i];

            if( ts.isSpreadElement( el )){ continue }

            checkExpressionAgainstType( el, elemType, checker, diagnostics, anchorNode, depth + 1, undefined, `${propPath}[${i}]` );
        }
    }
}

function checkObjectLiteral(
    obj         : ts.ObjectLiteralExpression,
    type        : ts.Type,
    checker     : ts.TypeChecker,
    diagnostics : ts.Diagnostic[],
    anchorNode? : ts.Node,
    depth       : number = 0,
    propPath    : string = ''
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
            const childPath = propPath ? `${propPath}.${propName}` : propName;
            checkExpressionAgainstType( prop.initializer, propType, checker, diagnostics, anchorNode, depth + 1, propJsDoc, childPath );
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
            const childPath = propPath ? `${propPath}.${propName}` : propName;
            checkExpressionAgainstType(
                decl.initializer,
                propType,
                checker,
                diagnostics,
                anchorNode ?? prop,
                depth + 1,
                propJsDoc,
                childPath
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
 * Walk a source file and emit diagnostics for constant values that violate tag constraints
 * as well as contradictory or invalid constraint definitions.
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

                if( ALL_MACRO_FUNCTIONS.has( importedName ))
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
        if( ts.isTypeAliasDeclaration( node ))
        {
            const sym = checker.getSymbolAtLocation( node.name );
            const extraJsDoc = sym ? extractPropertyJsDocInfo( sym, checker ).constraints : undefined;
            checkTypeNodeContradictions( node.type, checker, rawDiagnostics, sourceFile, extraJsDoc );
        }
        else if( ts.isInterfaceDeclaration( node ))
        {
            const ifaceType = checker.getTypeAtLocation( node );
            const parsedConstraints = collectAllParsedConstraints( ifaceType, checker );

            for( const msg of evaluateConstraintContradictions( parsedConstraints ))
            {
                rawDiagnostics.push( createDiagnostic( node.name, msg, CONTRADICTORY_CONSTRAINT_DIAGNOSTIC_CODE ));
            }
        }
        else if( ts.isPropertySignature( node ) && node.type )
        {
            const sym = checker.getSymbolAtLocation( node.name );
            const extraJsDoc = sym ? extractPropertyJsDocInfo( sym, checker ).constraints : undefined;
            checkTypeNodeContradictions( node.type, checker, rawDiagnostics, sourceFile, extraJsDoc );
        }
        else if(
            ( ts.isVariableDeclaration( node ) || ts.isPropertyDeclaration( node ) || ts.isParameter( node )) &&
            node.type
        )
        {
            const sym = checker.getSymbolAtLocation( node.name );
            const extraJsDoc = sym ? extractPropertyJsDocInfo( sym, checker ).constraints : undefined;
            checkTypeNodeContradictions( node.type, checker, rawDiagnostics, sourceFile, extraJsDoc );

            if( node.initializer )
            {
                const declPath = ts.isIdentifier( node.name ) ? node.name.text : '';
                const type = wrapTypeNodeWithJsDoc( node.type, checker.getTypeFromTypeNode( node.type ), checker );
                checkExpressionAgainstType( node.initializer, type, checker, rawDiagnostics, undefined, 0, extraJsDoc, declPath );
            }
        }
        else if( ts.isAsExpression( node ) || ts.isSatisfiesExpression( node ))
        {
            checkTypeNodeContradictions( node.type, checker, rawDiagnostics, sourceFile );
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
        else if( ts.isCallExpression( node ) && node.typeArguments?.[0])
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

            if( fnName && ALL_MACRO_FUNCTIONS.has( fnName ))
            {
                const typeNode = node.typeArguments[0];
                checkTypeNodeContradictions( typeNode, checker, rawDiagnostics, sourceFile );

                if( STATIC_MACRO_FUNCTIONS.has( fnName ) && node.arguments[0])
                {
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
        }

        if( ts.isFunctionLike( node ) && node.type )
        {
            const targetTypeNode = ts.isTypeReferenceNode( node.type ) && node.type.typeArguments?.[0] &&
                ts.canHaveModifiers( node ) && ( ts.getModifiers( node )?.some( m => m.kind === ts.SyntaxKind.AsyncKeyword ) ?? false )
                ? node.type.typeArguments[0]
                : node.type;
            checkTypeNodeContradictions( targetTypeNode, checker, rawDiagnostics, sourceFile );
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

const COMPOSITE_RANGE_TAG_NAMES: ReadonlySet<string> = new Set([
    'Range', 'Length', 'PropertiesRange'
]);

const PAIRED_BOUND_TAG_NAMES: ReadonlyArray<readonly [ string, string ]> = [
    [ 'Minimum', 'Maximum' ],
    [ 'ExclusiveMinimum', 'ExclusiveMaximum' ],
    [ 'MinLength', 'MaxLength' ],
    [ 'MinItems', 'MaxItems' ],
    [ 'MinContains', 'MaxContains' ],
    [ 'MinProperties', 'MaxProperties' ],
    [ 'MinDate', 'MaxDate' ]
];

function getEntityRightmostName( name: ts.EntityName ): string
{
    return ts.isIdentifier( name ) ? name.text : name.right.text;
}

function buildSwapFix(
    sourceFile : ts.SourceFile,
    firstNode  : ts.Node,
    secondNode : ts.Node
): ts.CodeFixAction
{
    const firstStart = firstNode.getStart( sourceFile );
    const secondStart = secondNode.getStart( sourceFile );
    const firstText = firstNode.getText( sourceFile );
    const secondText = secondNode.getText( sourceFile );

    return {
        fixName     : 'swapConstraintBounds',
        description : 'Swap contradictory minimum and maximum bounds',
        changes     : [
            {
                fileName    : sourceFile.fileName,
                textChanges : [
                    { span : { start : firstStart, length : firstNode.getWidth( sourceFile ) }, newText : secondText },
                    { span : { start : secondStart, length : secondNode.getWidth( sourceFile ) }, newText : firstText }
                ]
            }
        ]
    };
}

function resolveLiteralTargetType( expr: ts.Expression, checker: ts.TypeChecker ): ts.Type | undefined
{
    const ctxType = checker.getContextualType( expr );

    if( ctxType ){ return ctxType }

    let curr: ts.Node = expr;

    while( curr.parent && ts.isParenthesizedExpression( curr.parent ))
    {
        curr = curr.parent;
    }

    const parent = curr.parent;

    if( parent && ( ts.isAsExpression( parent ) || ts.isSatisfiesExpression( parent )))
    {
        return wrapTypeNodeWithJsDoc( parent.type, checker.getTypeFromTypeNode( parent.type ), checker );
    }

    if( parent && ( ts.isVariableDeclaration( parent ) || ts.isPropertyDeclaration( parent ) || ts.isParameter( parent )) && parent.type )
    {
        return wrapTypeNodeWithJsDoc( parent.type, checker.getTypeFromTypeNode( parent.type ), checker );
    }

    if( parent && ts.isCallExpression( parent ) && parent.typeArguments?.[0])
    {
        const typeNode = parent.typeArguments[0];

        return wrapTypeNodeWithJsDoc( typeNode, checker.getTypeFromTypeNode( typeNode ), checker );
    }

    return undefined;
}

/**
 * Compute IDE quick fixes for `@webergency-utils/typechecker` static diagnostics (`90001` & `90002`).
 */
export function collectCodeFixesAtPosition(
    sourceFile : ts.SourceFile,
    start      : number,
    end        : number,
    errorCodes : readonly number[],
    checker    : ts.TypeChecker
): ts.CodeFixAction[]
{
    const fixes: ts.CodeFixAction[] = [];
    const wantsContradictionFix = errorCodes.includes( CONTRADICTORY_CONSTRAINT_DIAGNOSTIC_CODE );
    const wantsLiteralClamp = errorCodes.includes( LITERAL_CONSTRAINT_DIAGNOSTIC_CODE );

    if( !wantsContradictionFix && !wantsLiteralClamp ){ return fixes }

    const visit = ( node: ts.Node ): void =>
    {
        const nodeStart = node.getStart( sourceFile );
        const nodeEnd = node.getEnd();

        if( nodeEnd < start || nodeStart > end ){ return }

        if( wantsContradictionFix )
        {
            if( ts.isTypeReferenceNode( node ) && node.typeArguments && node.typeArguments.length >= 2 )
            {
                const tagName = getEntityRightmostName( node.typeName );

                if(
                    COMPOSITE_RANGE_TAG_NAMES.has( tagName ) &&
                    evaluateConstraintContradictions( collectAllParsedConstraints( checker.getTypeFromTypeNode( node ), checker )).length > 0
                )
                {
                    fixes.push( buildSwapFix( sourceFile, node.typeArguments[0], node.typeArguments[1]));

                    return;
                }
            }

            if( ts.isIntersectionTypeNode( node ))
            {
                const refsByName = new Map<string, ts.TypeNode>();

                for( const member of node.types )
                {
                    if( ts.isTypeReferenceNode( member ) && member.typeArguments && member.typeArguments.length >= 1 )
                    {
                        refsByName.set( getEntityRightmostName( member.typeName ), member.typeArguments[0]);
                    }
                }

                for( const [ minName, maxName ] of PAIRED_BOUND_TAG_NAMES )
                {
                    const minArg = refsByName.get( minName );
                    const maxArg = refsByName.get( maxName );

                    if(
                        minArg &&
                        maxArg &&
                        evaluateConstraintContradictions( collectAllParsedConstraints( checker.getTypeFromTypeNode( node ), checker )).length > 0
                    )
                    {
                        fixes.push( buildSwapFix( sourceFile, minArg, maxArg ));

                        return;
                    }
                }
            }
        }

        if( wantsLiteralClamp && ts.isExpression( node ))
        {
            const c = tryGetConstantValue( node );

            if( c?.kind === 'number' && typeof c.value === 'number' )
            {
                const targetType = resolveLiteralTargetType( node, checker );

                if( targetType )
                {
                    const parsed = collectAllParsedConstraints( targetType, checker );
                    let replacement: string | undefined;

                    for( const p of parsed )
                    {
                        if( p.type === 'minimum' && typeof p.value === 'number' && c.value < p.value )
                        {
                            replacement = String( p.value );
                            break;
                        }

                        if( p.type === 'maximum' && typeof p.value === 'number' && c.value > p.value )
                        {
                            replacement = String( p.value );
                            break;
                        }

                        if( p.type === 'nonNegative' && c.value < 0 )
                        {
                            replacement = '0';
                            break;
                        }

                        if( p.type === 'positive' && c.value <= 0 )
                        {
                            replacement = '1';
                            break;
                        }

                        if( p.type === 'negative' && c.value >= 0 )
                        {
                            replacement = '-1';
                            break;
                        }

                        if( p.type === 'exclusiveMinimum' && typeof p.value === 'number' && c.value <= p.value )
                        {
                            replacement = String( p.value + 1 );
                            break;
                        }

                        if( p.type === 'exclusiveMaximum' && typeof p.value === 'number' && c.value >= p.value )
                        {
                            replacement = String( p.value - 1 );
                            break;
                        }
                    }

                    if( replacement !== undefined )
                    {
                        fixes.push({
                            fixName     : 'clampLiteralToBound',
                            description : `Clamp literal to ${replacement}`,
                            changes     : [
                                {
                                    fileName    : sourceFile.fileName,
                                    textChanges : [{ span : { start : nodeStart, length : nodeEnd - nodeStart }, newText : replacement }]
                                }
                            ]
                        });

                        return;
                    }
                }
            }
        }

        ts.forEachChild( node, visit );
    };

    visit( sourceFile );

    return fixes;
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
