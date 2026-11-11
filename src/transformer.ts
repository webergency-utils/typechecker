import ts from 'typescript';
import { buildValidator, generateHash, buildJsonSchema, objectToAst } from './engine/resolver.js';
export { buildValidator, generateHash, buildJsonSchema } from './engine/resolver.js';
import { DOMAIN_SENTINELS, hoistEmitLocals, resolveEmitNames } from './engine/hoister.js';
import { createCustomFunctionScope, type ICustomFunctionScope } from './engine/customFns.js';
import {
    installStaticConstraintDiagnostics,
    unwrapExpression,
    isTypecheckerImport
} from './engine/staticAsserts.js';
export { collectStaticConstraintDiagnostics, collectCodeFixesAtPosition } from './engine/staticAsserts.js';
import { generateSerializerCode, SerializerGeneratorOptions, SerializeFormat } from './engine/serializer-generator.js';
import { generateParseCode, ParseGeneratorOptions, ParseSource } from './engine/parse-generator.js';
import { generateCloneCode, generatePruneCode } from './engine/clone-prune-generator.js';
import { generateRandomCode } from './engine/random-generator.js';
import { generateGuardCode } from './engine/guard-generator.js';
import { templateToAst } from './engine/generators.js';
import { ValidationMode, UnionResolution, JsonSchemaTarget, JsonSchemaOptions } from './runtime/validators.js';
import type { CasingFormat } from './runtime/casing.js';
import type { BigIntWireFormat } from './runtime/serializer-runtime.js';
import { VERBATIM_CUSTOM_SCOPE, wrapTypeNodeWithJsDoc } from './engine/type-helpers.js';

export interface TransformerConfig
{
    skipDiagnostics? : boolean
}

const VALID_MODES: ReadonlySet<string> = new Set([ 'strict', 'strip', 'relaxed' ]);
const VALID_PARSE_SOURCES: ReadonlySet<string> = new Set([ 'json', 'query', 'string', 'formData', 'headers' ]);
const VALID_SERIALIZE_FORMATS: ReadonlySet<string> = new Set([ 'json', 'query' ]);
const VALID_UNION_RESOLUTIONS: ReadonlySet<string> = new Set([ 'specificity', 'declaration-order' ]);
const VALID_CASING_FORMATS: ReadonlySet<string> = new Set<CasingFormat>([
    'snake_case',
    'SNAKE_CASE',
    'camelCase',
    'camelCaseID',
    'PascalCase',
    'PascalCaseID',
    'kebab-case',
    'dot.case'
]);
const VALID_BIGINT_FORMATS: ReadonlySet<string> = new Set([ 'string', 'number' ]);
const VALID_SCHEMA_TARGETS: ReadonlySet<string> = new Set([ 'draft-07', 'draft-2020-12', 'openapi-3.0', 'openapi-3.1' ]);

const PARSE_COMPILE_KEYS: ReadonlySet<string> = new Set([ 'mode', 'from', 'unionResolution', 'propertyCasing' ]);
const SERIALIZE_COMPILE_KEYS: ReadonlySet<string> = new Set([ 'mode', 'format', 'to', 'unionResolution', 'propertyCasing', 'bigintAs' ]);
const VALIDATE_COMPILE_KEYS: ReadonlySet<string> = new Set([ 'unionResolution' ]);

export function buildSerializer(
    type    : ts.Type,
    checker : ts.TypeChecker,
    map     : Map<string, ts.Expression>,
    hash?   : string,
    options : ValidationMode | SerializerGeneratorOptions = {},
    scope   : ICustomFunctionScope = VERBATIM_CUSTOM_SCOPE
): ts.Expression
{
    const opts: SerializerGeneratorOptions = typeof options === 'string'
        ? { mode : options }
        : options;
    const mode = opts.mode || 'strip';
    const format = opts.format || opts.to || 'json';
    const unionResolution: UnionResolution = opts.unionResolution || 'specificity';
    const propertyCasing = opts.propertyCasing;
    const bigintAs = opts.bigintAs;
    const resSuffix = unionResolution === 'declaration-order' ? '_decl' : '';
    const caseSuffix = propertyCasing ? `_case_${propertyCasing}` : '';
    const biSuffix = bigintAs && bigintAs !== 'string' ? `_bi_${bigintAs}` : '';
    const resolvedHash = `${hash ?? generateHash( type, checker )}_${mode}_${format}${resSuffix}${caseSuffix}${biSuffix}`;

    if( !map.has( resolvedHash ))
    {
        const hoisted: string[] = [];
        const codeStr = generateSerializerCode(
            type,
            checker,
            {
                mode,
                format,
                unionResolution,
                propertyCasing,
                bigintAs,
                scope : opts.scope ?? scope,
                hoisted
            }
        );
        const innerFn = format === 'query'
            ? `( function( input, options ){ const transform = options && options.transform; return ${codeStr}; })`
            : `( function( input, options ){ const transform = options && options.transform; const replacer = options && options.replacer; const out = ${codeStr}; if( replacer ){ return __tcRuntime.applyJsonReplacer( out, replacer ); } return out; })`;
        const wrapped = hoisted.length > 0
            ? `( function(){ ${hoisted.join( ' ' )} return ${innerFn}; })()`
            : innerFn;
        const ast = templateToAst( wrapped );
        map.set( resolvedHash, ast );
    }

    return ts.factory.createIdentifier( `__ser_${resolvedHash}` );
}

export function buildParser(
    type    : ts.Type,
    checker : ts.TypeChecker,
    map     : Map<string, ts.Expression>,
    hash?   : string,
    options : ParseGeneratorOptions = {},
    scope   : ICustomFunctionScope = VERBATIM_CUSTOM_SCOPE
): ts.Expression
{
    const mode = options.mode || 'strip';
    const from = options.from || 'json';
    const unionResolution: UnionResolution = options.unionResolution || 'specificity';
    const propertyCasing = options.propertyCasing;
    const resSuffix = unionResolution === 'declaration-order' ? '_decl' : '';
    const caseSuffix = propertyCasing ? `_case_${propertyCasing}` : '';
    const resolvedHash = `${hash ?? generateHash( type, checker )}_${mode}_${from}${resSuffix}${caseSuffix}`;

    if( !map.has( resolvedHash ))
    {
        const codeStr = generateParseCode( type, checker, { mode, from, unionResolution, propertyCasing }, scope );
        const ast = templateToAst( codeStr );
        map.set( resolvedHash, ast );
    }

    return ts.factory.createIdentifier( `__parse_${resolvedHash}` );
}

export function buildCloner(
    type    : ts.Type,
    checker : ts.TypeChecker,
    map     : Map<string, ts.Expression>,
    hash?   : string,
    scope   : ICustomFunctionScope = VERBATIM_CUSTOM_SCOPE
): ts.Expression
{
    const resolvedHash = hash ?? generateHash( type, checker );

    if( !map.has( resolvedHash ))
    {
        const codeStr = generateCloneCode( type, checker, scope );
        const ast = templateToAst( codeStr );
        map.set( resolvedHash, ast );
    }

    return ts.factory.createIdentifier( `__clone_${resolvedHash}` );
}

export function buildPruner(
    type    : ts.Type,
    checker : ts.TypeChecker,
    map     : Map<string, ts.Expression>,
    hash?   : string,
    scope   : ICustomFunctionScope = VERBATIM_CUSTOM_SCOPE
): ts.Expression
{
    const resolvedHash = hash ?? generateHash( type, checker );

    if( !map.has( resolvedHash ))
    {
        const codeStr = generatePruneCode( type, checker, scope );
        const ast = templateToAst( codeStr );
        map.set( resolvedHash, ast );
    }

    return ts.factory.createIdentifier( `__prune_${resolvedHash}` );
}

export function buildRandom(
    type    : ts.Type,
    checker : ts.TypeChecker,
    map     : Map<string, ts.Expression>,
    hash?   : string,
    scope   : ICustomFunctionScope = VERBATIM_CUSTOM_SCOPE
): ts.Expression
{
    const resolvedHash = hash ?? generateHash( type, checker );

    if( !map.has( resolvedHash ))
    {
        const codeStr = generateRandomCode( type, checker, scope );
        const ast = templateToAst( codeStr );
        map.set( resolvedHash, ast );
    }

    return ts.factory.createIdentifier( `__rand_${resolvedHash}` );
}

export function buildGuard(
    type        : ts.Type,
    checker     : ts.TypeChecker,
    map         : Map<string, ts.Expression>,
    hash?       : string,
    scope       : ICustomFunctionScope = VERBATIM_CUSTOM_SCOPE,
    unsupported?: Set<string>
): ts.Expression | undefined
{
    const resolvedHash = hash ?? generateHash( type, checker );

    if( unsupported?.has( resolvedHash )){ return undefined }

    if( !map.has( resolvedHash ))
    {
        const codeStr = generateGuardCode( type, checker, scope );

        if( !codeStr )
        {
            unsupported?.add( resolvedHash );

            return undefined;
        }

        const ast = templateToAst( codeStr );
        map.set( resolvedHash, ast );
    }

    return ts.factory.createIdentifier( `__is_${resolvedHash}` );
}

const TYPE_FUNCTIONS = [
    'is',
    'assert',
    'assertGuard',
    'validate',
    'validator',
    'jsonSchema',
    'serializer',
    'stringify',
    'safeSerialize',
    'parse',
    'parser',
    'safeParse',
    'standardSchema',
    'clone',
    'cloner',
    'prune',
    'pruner',
    'random',
    'randomGenerator'
];
const VALIDATION_FUNCTIONS = ['is', 'assert', 'assertGuard', 'validate'];

function runtimeCall( runtimeNs: string, method: string, args: ts.Expression[]): ts.CallExpression
{
    return ts.factory.createCallExpression(
        ts.factory.createPropertyAccessExpression( ts.factory.createIdentifier( runtimeNs ), method ),
        undefined,
        args
    );
}

function visitArgOrUndefined(
    args    : ts.NodeArray<ts.Expression>,
    index   : number,
    visitor : ts.Visitor
): ts.Expression
{
    const arg = args[index];

    if( !arg ){ return ts.factory.createIdentifier( 'undefined' ) }

    return ts.visitNode( arg, visitor ) as ts.Expression;
}

function getPropName( prop: ts.ObjectLiteralElementLike ): string | undefined
{
    if( !prop.name ){ return undefined }

    if( ts.isIdentifier( prop.name )){ return prop.name.text }

    if( ts.isStringLiteral( prop.name )){ return prop.name.text }

    return undefined;
}

function isUndefinedLiteral( expr: ts.Expression | undefined ): boolean
{
    if( !expr ){ return true }

    const unwrapped = unwrapExpression( expr );

    return ts.isIdentifier( unwrapped ) && unwrapped.text === 'undefined';
}

function resolveIdentifierDecl(
    ident   : ts.Identifier,
    checker : ts.TypeChecker
): { decl : ts.VariableDeclaration, isConst : boolean } | undefined
{
    try
    {
        let sym = checker.getSymbolAtLocation( ident );

        if( sym && ( sym.flags & ts.SymbolFlags.Alias ))
        {
            sym = checker.getAliasedSymbol( sym );
        }

        const decl = sym?.valueDeclaration || sym?.declarations?.[0];

        if( decl && ts.isVariableDeclaration( decl ) && decl.parent && ts.isVariableDeclarationList( decl.parent ))
        {
            return {
                decl,
                isConst : ( decl.parent.flags & ts.NodeFlags.Const ) !== 0
            };
        }
    }
    catch
    { /* ignore */ }

    return undefined;
}

function resolveOptionsObjectLiteral(
    optsArg : ts.Expression | undefined,
    checker : ts.TypeChecker
): ts.ObjectLiteralExpression | undefined
{
    if( !optsArg ){ return undefined }

    const unwrapped = unwrapExpression( optsArg );

    if( ts.isObjectLiteralExpression( unwrapped )){ return unwrapped }

    if( ts.isIdentifier( unwrapped ))
    {
        const resolved = resolveIdentifierDecl( unwrapped, checker );

        if( resolved && resolved.isConst && resolved.decl.initializer )
        {
            const init = unwrapExpression( resolved.decl.initializer );

            if( ts.isObjectLiteralExpression( init )){ return init }
        }
    }

    return undefined;
}

function assertNotMutableCompileOptions(
    optsArg         : ts.Expression | undefined,
    compileTimeKeys : ReadonlySet<string>,
    fnName          : string,
    checker         : ts.TypeChecker
): void
{
    if( !optsArg ){ return }

    const unwrapped = unwrapExpression( optsArg );

    if( !ts.isIdentifier( unwrapped )){ return }

    const resolved = resolveIdentifierDecl( unwrapped, checker );

    if( !resolved || resolved.isConst || !resolved.decl.initializer ){ return }

    const init = unwrapExpression( resolved.decl.initializer );

    if( ts.isStringLiteral( init ) || ts.isNoSubstitutionTemplateLiteral( init ))
    {
        throw new Error(
            `@webergency-utils/typechecker: Compile-time mode/target option passed to ${fnName}<T>() must use 'const' or an inline string literal, not mutable 'let' or 'var'.`
        );
    }

    if( ts.isObjectLiteralExpression( init ))
    {
        for( const prop of init.properties )
        {
            const name = getPropName( prop );

            if( name && compileTimeKeys.has( name ))
            {
                throw new Error(
                    `@webergency-utils/typechecker: Compile-time option '${name}' passed to ${fnName}<T>() must use 'const' or an inline object literal, not mutable 'let' or 'var'.`
                );
            }
        }
    }
}

function isStringOnlyType( expr: ts.Expression, checker: ts.TypeChecker ): boolean
{
    try
    {
        const t = checker.getTypeAtLocation( expr );

        if( !t || ( t.flags & ( ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never )) !== 0 )
        {
            return false;
        }

        const arms = typeof t.isUnion === 'function' && t.isUnion() ? t.types : [t];
        const nonUndefined = arms.filter( a => ( a.flags & ( ts.TypeFlags.Undefined | ts.TypeFlags.Void )) === 0 );

        return nonUndefined.length > 0 && nonUndefined.every( a => ( a.flags & ts.TypeFlags.StringLike ) !== 0 );
    }
    catch
    {
        return false;
    }
}

function extractStringValue(
    exprOrProp : ts.Expression | ts.ObjectLiteralElementLike | undefined,
    checker?   : ts.TypeChecker
): string | undefined
{
    if( !exprOrProp ){ return undefined }

    if( ts.isStringLiteral( exprOrProp as ts.Node ) || ts.isNoSubstitutionTemplateLiteral( exprOrProp as ts.Node ))
    {
        return ( exprOrProp as ts.StringLiteral ).text;
    }

    if( ts.isPropertyAssignment( exprOrProp as ts.ObjectLiteralElementLike ))
    {
        const pa = exprOrProp as ts.PropertyAssignment;
        const init = unwrapExpression( pa.initializer );

        if( ts.isStringLiteral( init ) || ts.isNoSubstitutionTemplateLiteral( init ))
        {
            return init.text;
        }

        if( ts.isIdentifier( init ) && checker )
        {
            const resolved = resolveIdentifierDecl( init, checker );

            if( resolved && !resolved.isConst ){ return undefined }
        }

        if( checker )
        {
            try
            {
                const t = checker.getTypeAtLocation( pa.initializer );

                if( t && typeof t.isStringLiteral === 'function' && t.isStringLiteral())
                {
                    return t.value;
                }
            }
            catch
            { /* ignore */ }
        }
    }
    else if( ts.isShorthandPropertyAssignment( exprOrProp as ts.ObjectLiteralElementLike ))
    {
        const shorthand = exprOrProp as ts.ShorthandPropertyAssignment;

        if( checker )
        {
            const resolved = resolveIdentifierDecl( shorthand.name, checker );

            if( resolved && !resolved.isConst ){ return undefined }

            try
            {
                const t = checker.getTypeAtLocation( shorthand.name );

                if( t && typeof t.isStringLiteral === 'function' && t.isStringLiteral())
                {
                    return t.value;
                }
            }
            catch
            { /* ignore */ }
        }
    }
    else if( ts.isExpression( exprOrProp as ts.Node ))
    {
        const unwrapped = unwrapExpression( exprOrProp as ts.Expression );

        if( ts.isStringLiteral( unwrapped ) || ts.isNoSubstitutionTemplateLiteral( unwrapped ))
        {
            return unwrapped.text;
        }

        if( ts.isIdentifier( unwrapped ) && checker )
        {
            const resolved = resolveIdentifierDecl( unwrapped, checker );

            if( resolved && !resolved.isConst ){ return undefined }
        }

        if( checker )
        {
            try
            {
                const t = checker.getTypeAtLocation( exprOrProp as ts.Expression );

                if( t && typeof t.isStringLiteral === 'function' && t.isStringLiteral())
                {
                    return t.value;
                }
            }
            catch
            { /* ignore */ }
        }
    }

    return undefined;
}

function extractCompileTimeEnumProp<T extends string>(
    objLit      : ts.ObjectLiteralExpression,
    propNames   : readonly string[],
    validValues : ReadonlySet<string>,
    fnName      : string,
    checker     : ts.TypeChecker
): T | undefined
{
    let resolved: T | undefined;

    for( const prop of objLit.properties )
    {
        const name = getPropName( prop );

        if( !name || !propNames.includes( name )){ continue }

        if( ts.isPropertyAssignment( prop ) && isUndefinedLiteral( prop.initializer ))
        {
            continue;
        }

        const val = extractStringValue( prop, checker );

        if( val === undefined || !validValues.has( val ))
        {
            throw new Error(
                `@webergency-utils/typechecker: Option '${name}' in ${fnName}<T>() is a compile-time AOT option and must be a static literal (${[ ...validValues ].join( ' | ' )}).`
            );
        }

        resolved = val as T;
    }

    return resolved;
}

function extractUnionResolution(
    objLit  : ts.ObjectLiteralExpression | undefined,
    fnName  : string,
    checker : ts.TypeChecker
): UnionResolution
{
    if( objLit )
    {
        const extracted = extractCompileTimeEnumProp<UnionResolution>(
            objLit,
            ['unionResolution'],
            VALID_UNION_RESOLUTIONS,
            fnName,
            checker
        );

        if( extracted ){ return extracted }
    }

    return 'specificity';
}

function parseUnionResolution(
    optsArg : ts.Expression | undefined,
    fnName  : string,
    checker : ts.TypeChecker
): UnionResolution
{
    assertNotMutableCompileOptions( optsArg, VALIDATE_COMPILE_KEYS, fnName, checker );

    return extractUnionResolution( resolveOptionsObjectLiteral( optsArg, checker ), fnName, checker );
}

function parseSerializerOptions(
    optsArg : ts.Expression | undefined,
    fnName  : string,
    checker : ts.TypeChecker
): { options : SerializerGeneratorOptions, needsRuntimeGuard : boolean }
{
    assertNotMutableCompileOptions( optsArg, SERIALIZE_COMPILE_KEYS, fnName, checker );

    let mode: ValidationMode = 'strip';
    let format: SerializeFormat = 'json';
    let propertyCasing: CasingFormat | undefined;
    let bigintAs: BigIntWireFormat | undefined;
    let needsRuntimeGuard = false;
    const objLit = resolveOptionsObjectLiteral( optsArg, checker );
    const unionResolution = extractUnionResolution( objLit, fnName, checker );

    if( objLit )
    {
        const extractedMode = extractCompileTimeEnumProp<ValidationMode>( objLit, ['mode'], VALID_MODES, fnName, checker );

        if( extractedMode ){ mode = extractedMode }

        const extractedFormat = extractCompileTimeEnumProp<SerializeFormat>(
            objLit,
            [ 'format', 'to' ],
            VALID_SERIALIZE_FORMATS,
            fnName,
            checker
        );

        if( extractedFormat ){ format = extractedFormat }

        propertyCasing = extractCompileTimeEnumProp<CasingFormat>(
            objLit,
            ['propertyCasing'],
            VALID_CASING_FORMATS,
            fnName,
            checker
        );
        bigintAs = extractCompileTimeEnumProp<BigIntWireFormat>(
            objLit,
            ['bigintAs'],
            VALID_BIGINT_FORMATS,
            fnName,
            checker
        );
        needsRuntimeGuard = objLit.properties.some( ts.isSpreadAssignment );
    }
    else if( optsArg && !isUndefinedLiteral( optsArg ))
    {
        const extractedMode = extractStringValue( optsArg, checker );

        if( extractedMode !== undefined )
        {
            if( !VALID_MODES.has( extractedMode ))
            {
                throw new Error(
                    `@webergency-utils/typechecker: Mode '${extractedMode}' in ${fnName}<T>() must be one of: strict | strip | relaxed.`
                );
            }

            mode = extractedMode as ValidationMode;
        }
        else if( isStringOnlyType( optsArg, checker ))
        {
            throw new Error(
                `@webergency-utils/typechecker: Dynamic mode argument in ${fnName}<T>() cannot be resolved at compile time; pass a static string literal ('strict' | 'strip' | 'relaxed').`
            );
        }
        else
        {
            needsRuntimeGuard = true;
        }
    }

    return {
        options : { mode, format, unionResolution, propertyCasing, bigintAs },
        needsRuntimeGuard
    };
}

function parseParseOptions(
    optsArg : ts.Expression | undefined,
    fnName  : string,
    checker : ts.TypeChecker
): { options : ParseGeneratorOptions, needsRuntimeGuard : boolean }
{
    assertNotMutableCompileOptions( optsArg, PARSE_COMPILE_KEYS, fnName, checker );

    let mode: ValidationMode = 'strip';
    let from: ParseSource = 'json';
    let propertyCasing: CasingFormat | undefined;
    let needsRuntimeGuard = false;
    const objLit = resolveOptionsObjectLiteral( optsArg, checker );
    const unionResolution = extractUnionResolution( objLit, fnName, checker );

    if( objLit )
    {
        const extractedMode = extractCompileTimeEnumProp<ValidationMode>( objLit, ['mode'], VALID_MODES, fnName, checker );

        if( extractedMode ){ mode = extractedMode }

        const extractedFrom = extractCompileTimeEnumProp<ParseSource>( objLit, ['from'], VALID_PARSE_SOURCES, fnName, checker );

        if( extractedFrom ){ from = extractedFrom }

        propertyCasing = extractCompileTimeEnumProp<CasingFormat>(
            objLit,
            ['propertyCasing'],
            VALID_CASING_FORMATS,
            fnName,
            checker
        );
        needsRuntimeGuard = objLit.properties.some( ts.isSpreadAssignment );
    }
    else if( optsArg && !isUndefinedLiteral( optsArg ))
    {
        const extractedMode = extractStringValue( optsArg, checker );

        if( extractedMode !== undefined )
        {
            if( !VALID_MODES.has( extractedMode ))
            {
                throw new Error(
                    `@webergency-utils/typechecker: Mode '${extractedMode}' in ${fnName}<T>() must be one of: strict | strip | relaxed.`
                );
            }

            mode = extractedMode as ValidationMode;
        }
        else if( isStringOnlyType( optsArg, checker ))
        {
            throw new Error(
                `@webergency-utils/typechecker: Dynamic mode argument in ${fnName}<T>() cannot be resolved at compile time; pass a static string literal ('strict' | 'strip' | 'relaxed').`
            );
        }
        else
        {
            needsRuntimeGuard = true;
        }
    }

    return {
        options : { mode, from, unionResolution, propertyCasing },
        needsRuntimeGuard
    };
}

function parseJsonSchemaOptions(
    optsArg : ts.Expression | undefined,
    checker : ts.TypeChecker
): { target? : JsonSchemaTarget, propertyCasing? : CasingFormat }
{
    if( !optsArg || isUndefinedLiteral( optsArg ))
    {
        return {};
    }

    assertNotMutableCompileOptions( optsArg, new Set([ 'target', 'propertyCasing' ]), 'jsonSchema', checker );

    const objLit = resolveOptionsObjectLiteral( optsArg, checker );

    if( objLit )
    {
        if( objLit.properties.some( ts.isSpreadAssignment ))
        {
            throw new Error(
                '@webergency-utils/typechecker: jsonSchema<T>() options are evaluated entirely at compile time and cannot contain dynamic spread properties.'
            );
        }

        const target = extractCompileTimeEnumProp<JsonSchemaTarget>(
            objLit,
            ['target'],
            VALID_SCHEMA_TARGETS,
            'jsonSchema',
            checker
        );
        const propertyCasing = extractCompileTimeEnumProp<CasingFormat>(
            objLit,
            ['propertyCasing'],
            VALID_CASING_FORMATS,
            'jsonSchema',
            checker
        );

        return { target, propertyCasing };
    }

    const extractedTarget = extractStringValue( optsArg, checker );

    if( extractedTarget !== undefined && VALID_SCHEMA_TARGETS.has( extractedTarget ))
    {
        return { target : extractedTarget as JsonSchemaTarget };
    }

    throw new Error(
        '@webergency-utils/typechecker: jsonSchema<T>() options must be a static literal at compile time.'
    );
}

export default function transformer( program: ts.Program, config?: TransformerConfig )
{
    const checker = program.getTypeChecker();

    if( !config?.skipDiagnostics )
    {
        installStaticConstraintDiagnostics( program );
    }

    return ( context: ts.TransformationContext ) =>
    {
        return ( sourceFile: ts.SourceFile ) =>
        {
            const emitNames = resolveEmitNames( sourceFile );
            const customFns = createCustomFunctionScope( sourceFile, checker );
            const validatorCache = new Map<string, ts.Expression>();
            const guardCache = new Map<string, ts.Expression>();
            const unsupportedGuards = new Set<string>();
            const schemasCache = new Map<string, ts.Expression>();
            const serializerCache = new Map<string, ts.Expression>();
            const parserCache = new Map<string, ts.Expression>();
            const clonerCache = new Map<string, ts.Expression>();
            const prunerCache = new Map<string, ts.Expression>();
            const randomCache = new Map<string, ts.Expression>();
            const helperBindings = new Map<string, { importedName : string, decl : ts.ImportSpecifier }>();
            const helperNamespaces = new Map<string, ts.NamespaceImport>();
            const hashByTypeId = new Map<number, string>();

            const getTypeHash = ( type: ts.Type ): string =>
            {
                const typeId = ( type as any ).id;

                if( typeof typeId === 'number' )
                {
                    const cached = hashByTypeId.get( typeId );

                    if( cached ){ return cached }

                    const hash = generateHash( type, checker );
                    hashByTypeId.set( typeId, hash );

                    return hash;
                }

                return generateHash( type, checker );
            };

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

                        if( TYPE_FUNCTIONS.includes( importedName ))
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

            const visitor = ( node: ts.Node ): ts.Node =>
            {
                if( ts.isImportDeclaration( node ))
                {
                    return node;
                }

                if( ts.isCallExpression( node ))
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

                    if( fnName && TYPE_FUNCTIONS.includes( fnName ))
                    {
                        const typeArg = node.typeArguments?.[0];

                        if( typeArg )
                        {
                            const rawType = checker.getTypeFromTypeNode( typeArg );
                            const type = wrapTypeNodeWithJsDoc( typeArg, rawType, checker );
                            const hash = getTypeHash( type );

                            if( fnName === 'serializer' || fnName === 'stringify' || fnName === 'safeSerialize' )
                            {
                                const optsIdx = fnName === 'serializer' ? 0 : 1;
                                const optsArg = node.arguments[optsIdx];
                                const { options, needsRuntimeGuard } = parseSerializerOptions( optsArg, fnName, checker );
                                const serRef = buildSerializer( type, checker, serializerCache, hash, options, customFns );
                                const rawVisitedOpts = visitArgOrUndefined( node.arguments, optsIdx, visitor );
                                const visitedOpts = needsRuntimeGuard
                                    ? runtimeCall( DOMAIN_SENTINELS.serialize, 'checkSerializeOptions', [
                                        rawVisitedOpts,
                                        ts.factory.createStringLiteral( options.mode || 'strip' ),
                                        ts.factory.createStringLiteral( options.format || 'json' ),
                                        ts.factory.createStringLiteral( options.unionResolution || 'specificity' ),
                                        options.propertyCasing
                                            ? ts.factory.createStringLiteral( options.propertyCasing )
                                            : ts.factory.createIdentifier( 'undefined' ),
                                        ts.factory.createStringLiteral( options.bigintAs || 'string' )
                                    ])
                                    : rawVisitedOpts;

                                if( fnName === 'serializer' )
                                {
                                    return runtimeCall( DOMAIN_SENTINELS.serialize, 'createSerializer', [ serRef, visitedOpts ]);
                                }

                                const inputVisitorResult = visitArgOrUndefined( node.arguments, 0, visitor );

                                if( fnName === 'safeSerialize' )
                                {
                                    return runtimeCall( DOMAIN_SENTINELS.serialize, 'safeSerialize', [ serRef, inputVisitorResult, visitedOpts ]);
                                }

                                return ts.factory.createCallExpression( serRef, undefined, [ inputVisitorResult, visitedOpts ]);
                            }

                            if( fnName === 'parse' || fnName === 'parser' || fnName === 'safeParse' )
                            {
                                const optsIdx = fnName === 'parser' ? 0 : 1;
                                const optsArg = node.arguments[optsIdx];
                                const { options, needsRuntimeGuard } = parseParseOptions( optsArg, fnName, checker );
                                const parseRef = buildParser( type, checker, parserCache, hash, options, customFns );
                                const rawVisitedOpts = visitArgOrUndefined( node.arguments, optsIdx, visitor );
                                const visitedOpts = needsRuntimeGuard
                                    ? runtimeCall( DOMAIN_SENTINELS.parse, 'checkParseOptions', [
                                        rawVisitedOpts,
                                        ts.factory.createStringLiteral( options.mode || 'strip' ),
                                        ts.factory.createStringLiteral( options.from || 'json' ),
                                        ts.factory.createStringLiteral( options.unionResolution || 'specificity' ),
                                        options.propertyCasing
                                            ? ts.factory.createStringLiteral( options.propertyCasing )
                                            : ts.factory.createIdentifier( 'undefined' )
                                    ])
                                    : rawVisitedOpts;

                                if( fnName === 'parser' )
                                {
                                    return runtimeCall( DOMAIN_SENTINELS.parse, 'createParser', [ parseRef, visitedOpts ]);
                                }

                                const inputVisitorResult = visitArgOrUndefined( node.arguments, 0, visitor );

                                if( fnName === 'safeParse' )
                                {
                                    return runtimeCall( DOMAIN_SENTINELS.parse, 'safeParse', [ parseRef, inputVisitorResult, visitedOpts ]);
                                }

                                return ts.factory.createCallExpression( parseRef, undefined, [ inputVisitorResult, visitedOpts ]);
                            }

                            if( fnName === 'jsonSchema' )
                            {
                                const { target, propertyCasing } = parseJsonSchemaOptions( node.arguments[0], checker );
                                const targetSuffix = target && target !== 'draft-07'
                                    ? `_${target.replace( /[^a-zA-Z0-9_]/g, '_' )}`
                                    : '';
                                const caseSuffix = propertyCasing ? `_case_${propertyCasing}` : '';
                                const schemaKey = `${hash}${targetSuffix}${caseSuffix}`;

                                if( !schemasCache.has( schemaKey ))
                                {
                                    const schemaOpts: JsonSchemaOptions | undefined = target || propertyCasing
                                        ? {
                                            ...( target ? { target } : {}),
                                            ...( propertyCasing ? { propertyCasing } : {})
                                        }
                                        : undefined;
                                    const schemaObj = buildJsonSchema( type, checker, schemaOpts );
                                    schemasCache.set( schemaKey, objectToAst( schemaObj ));
                                }

                                return ts.factory.createCallExpression(
                                    ts.factory.createIdentifier( 'structuredClone' ),
                                    undefined,
                                    [ts.factory.createIdentifier( `__schema_${schemaKey}` )]
                                );
                            }

                            if( fnName === 'standardSchema' || fnName === 'validator' )
                            {
                                const unionResolution = parseUnionResolution( node.arguments[0], fnName, checker );
                                const valKey = unionResolution === 'declaration-order' ? `${hash}_decl` : hash;

                                if( !validatorCache.has( valKey ))
                                {
                                    buildValidator( type, checker, validatorCache, hash, customFns, unionResolution );
                                }

                                const validatorRef = ts.factory.createIdentifier( `__val_${valKey}` );
                                const optionsArg = visitArgOrUndefined( node.arguments, 0, visitor );

                                if( fnName === 'validator' )
                                {
                                    const guardRef = buildGuard( type, checker, guardCache, hash, customFns, unsupportedGuards );
                                    const args = guardRef
                                        ? [ validatorRef, optionsArg, guardRef ]
                                        : [ validatorRef, optionsArg ];

                                    return runtimeCall( DOMAIN_SENTINELS.validators, 'createValidator', args );
                                }

                                return runtimeCall( DOMAIN_SENTINELS.validators, 'createStandardSchema', [ validatorRef, optionsArg ]);
                            }

                            if( VALIDATION_FUNCTIONS.includes( fnName ))
                            {
                                if( fnName === 'is' && ( !node.arguments[1] || isUndefinedLiteral( node.arguments[1])))
                                {
                                    const guardRef = buildGuard( type, checker, guardCache, hash, customFns, unsupportedGuards );

                                    if( guardRef )
                                    {
                                        const inputArg = visitArgOrUndefined( node.arguments, 0, visitor );

                                        return ts.factory.createCallExpression( guardRef, undefined, [inputArg]);
                                    }
                                }

                                const unionResolution = parseUnionResolution( node.arguments[1], fnName, checker );
                                const valKey = unionResolution === 'declaration-order' ? `${hash}_decl` : hash;

                                if( !validatorCache.has( valKey ))
                                {
                                    buildValidator( type, checker, validatorCache, hash, customFns, unionResolution );
                                }

                                const inputArg = visitArgOrUndefined( node.arguments, 0, visitor );
                                const optionsArg = visitArgOrUndefined( node.arguments, 1, visitor );
                                const validatorRef = ts.factory.createIdentifier( `__val_${valKey}` );

                                return runtimeCall( DOMAIN_SENTINELS.validators, fnName, [ validatorRef, inputArg, optionsArg ]);
                            }

                            if( fnName === 'clone' || fnName === 'cloner' )
                            {
                                const cloneRef = buildCloner( type, checker, clonerCache, hash, customFns );

                                if( fnName === 'cloner' )
                                {
                                    return cloneRef;
                                }

                                const inputArg = visitArgOrUndefined( node.arguments, 0, visitor );

                                return ts.factory.createCallExpression( cloneRef, undefined, [inputArg]);
                            }

                            if( fnName === 'prune' || fnName === 'pruner' )
                            {
                                const pruneRef = buildPruner( type, checker, prunerCache, hash, customFns );

                                if( fnName === 'pruner' )
                                {
                                    return pruneRef;
                                }

                                const inputArg = visitArgOrUndefined( node.arguments, 0, visitor );

                                return ts.factory.createCallExpression( pruneRef, undefined, [inputArg]);
                            }

                            if( fnName === 'random' || fnName === 'randomGenerator' )
                            {
                                const randRef = buildRandom( type, checker, randomCache, hash, customFns );
                                const seedArgs = node.arguments[0]
                                    ? [visitArgOrUndefined( node.arguments, 0, visitor )]
                                    : [];

                                if( fnName === 'randomGenerator' )
                                {
                                    return runtimeCall( DOMAIN_SENTINELS.random, 'createRandomGenerator', [ randRef, ...seedArgs ]);
                                }

                                const rngExpr = runtimeCall( DOMAIN_SENTINELS.random, 'createRng', seedArgs );

                                return ts.factory.createCallExpression( randRef, undefined, [rngExpr]);
                            }
                        }
                    }
                }

                return ts.visitEachChild( node, visitor, context );
            };

            const transformedFile = ts.visitNode( sourceFile, visitor ) as ts.SourceFile;

            return hoistEmitLocals(
                transformedFile,
                validatorCache,
                schemasCache,
                emitNames,
                customFns.imports,
                serializerCache,
                parserCache,
                clonerCache,
                prunerCache,
                randomCache,
                guardCache
            );
        };
    };
}
