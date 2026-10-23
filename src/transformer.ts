import ts from 'typescript';
import { buildValidator, generateHash, buildJsonSchema, objectToAst } from './engine/resolver.js';
export { buildValidator, generateHash, buildJsonSchema } from './engine/resolver.js';
import { hoistEmitLocals, resolveEmitNames } from './engine/hoister.js';
import { createCustomFunctionScope, type ICustomFunctionScope } from './engine/customFns.js';
import { installStaticConstraintDiagnostics, unwrapExpression, isTypecheckerImport } from './engine/staticAsserts.js';
export { collectStaticConstraintDiagnostics } from './engine/staticAsserts.js';
import { generateSerializerCode, SerializerGeneratorOptions, SerializeFormat } from './engine/serializer-generator.js';
import { generateParseCode, ParseGeneratorOptions, ParseSource } from './engine/parse-generator.js';
import { templateToAst } from './engine/generators.js';
import { ValidationMode, UnionResolution, JsonSchemaTarget, JsonSchemaOptions } from './runtime/validators.js';
import { VERBATIM_CUSTOM_SCOPE } from './engine/type-helpers.js';

export function buildSerializer(
    type    : ts.Type,
    checker : ts.TypeChecker,
    map     : Map<string, ts.Expression>,
    hash?   : string,
    options : ValidationMode | SerializerGeneratorOptions = {}
): ts.Expression
{
    const opts: SerializerGeneratorOptions = typeof options === 'string'
        ? { mode : options }
        : options;
    const mode = opts.mode || 'strip';
    const format = opts.format || opts.to || 'json';
    const unionResolution: UnionResolution = opts.unionResolution || 'specificity';
    const resSuffix = unionResolution === 'declaration-order' ? '_decl' : '';
    const resolvedHash = `${hash ?? generateHash( type, checker )}_${mode}_${format}${resSuffix}`;

    if( !map.has( resolvedHash ))
    {
        const hoisted: string[] = [];
        const codeStr = generateSerializerCode( type, checker, { mode, format, unionResolution, hoisted });
        const innerFn = format === 'query'
            ? `( function( input, options ){ const transform = options && options.transform; return ${codeStr}; })`
            : `( function( input, options ){ const transform = options && options.transform; const replacer = options && options.replacer; const out = ${codeStr}; if( replacer ){ try { return JSON.stringify( JSON.parse( out ), replacer ); } catch( e ){ throw new __tcRuntime.SerializationError( "", e && e.message ? e.message : String( e ) ); } } return out; })`;
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
    const resSuffix = unionResolution === 'declaration-order' ? '_decl' : '';
    const resolvedHash = `${hash ?? generateHash( type, checker )}_${mode}_${from}${resSuffix}`;

    if( !map.has( resolvedHash ))
    {
        const codeStr = generateParseCode( type, checker, { mode, from, unionResolution }, scope );
        const ast = templateToAst( codeStr );
        map.set( resolvedHash, ast );
    }

    return ts.factory.createIdentifier( `__parse_${resolvedHash}` );
}

const TYPE_FUNCTIONS = ['is', 'assert', 'assertGuard', 'validate', 'validator', 'jsonSchema', 'serializer', 'stringify', 'safeSerialize', 'parse', 'parser', 'safeParse', 'standardSchema'];
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
        try
        {
            let sym = checker.getSymbolAtLocation( unwrapped );

            if( sym && ( sym.flags & ts.SymbolFlags.Alias ))
            {
                sym = checker.getAliasedSymbol( sym );
            }

            const decl = sym?.valueDeclaration || sym?.declarations?.[0];

            if( decl && ts.isVariableDeclaration( decl ) && decl.initializer )
            {
                const init = unwrapExpression( decl.initializer );

                if( ts.isObjectLiteralExpression( init )){ return init }
            }
        }
        catch
        { /* ignore */ }
    }

    return undefined;
}

function extractStringValue(
    exprOrProp : ts.Expression | ts.ObjectLiteralElementLike | undefined,
    checker?   : ts.TypeChecker
): string | undefined
{
    if( !exprOrProp ){ return undefined }

    if( ts.isStringLiteral( exprOrProp as ts.Node )){ return ( exprOrProp as ts.StringLiteral ).text }

    if( ts.isPropertyAssignment( exprOrProp as ts.ObjectLiteralElementLike ))
    {
        const pa = exprOrProp as ts.PropertyAssignment;
        const init = unwrapExpression( pa.initializer );

        if( ts.isStringLiteral( init )){ return init.text }

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
        if( checker )
        {
            try
            {
                const t = checker.getTypeAtLocation(( exprOrProp as ts.ShorthandPropertyAssignment ).name );

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

        if( ts.isStringLiteral( unwrapped )){ return unwrapped.text }

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

function extractUnionResolution(
    objLit  : ts.ObjectLiteralExpression | undefined,
    checker : ts.TypeChecker
): UnionResolution
{
    if( objLit )
    {
        const resProp = objLit.properties.find( p => getPropName( p ) === 'unionResolution' );
        const extracted = extractStringValue( resProp, checker );

        if( extracted === 'declaration-order' || extracted === 'specificity' )
        {
            return extracted;
        }
    }

    return 'specificity';
}

function parseUnionResolution(
    optsArg : ts.Expression | undefined,
    checker : ts.TypeChecker
): UnionResolution
{
    return extractUnionResolution( resolveOptionsObjectLiteral( optsArg, checker ), checker );
}

function parseSerializerOptions(
    optsArg : ts.Expression | undefined,
    checker : ts.TypeChecker
): SerializerGeneratorOptions
{
    let mode: ValidationMode = 'strip';
    let format: SerializeFormat = 'json';
    const objLit = resolveOptionsObjectLiteral( optsArg, checker );
    const unionResolution = extractUnionResolution( objLit, checker );

    if( objLit )
    {
        const modeProp = objLit.properties.find( p => getPropName( p ) === 'mode' );
        const extractedMode = extractStringValue( modeProp, checker );

        if( extractedMode )
        {
            mode = extractedMode as ValidationMode;
        }

        const formatProp = objLit.properties.find( p =>
        {
            const name = getPropName( p );

            return name === 'format' || name === 'to';
        });
        const extractedFormat = extractStringValue( formatProp, checker );

        if( extractedFormat )
        {
            format = extractedFormat as SerializeFormat;
        }
    }
    else if( optsArg )
    {
        const extractedMode = extractStringValue( optsArg, checker );

        if( extractedMode )
        {
            mode = extractedMode as ValidationMode;
        }
    }

    return { mode, format, unionResolution };
}

function parseParseOptions(
    optsArg : ts.Expression | undefined,
    checker : ts.TypeChecker
): ParseGeneratorOptions
{
    let mode: ValidationMode = 'strip';
    let from: ParseSource = 'json';
    const objLit = resolveOptionsObjectLiteral( optsArg, checker );
    const unionResolution = extractUnionResolution( objLit, checker );

    if( objLit )
    {
        const modeProp = objLit.properties.find( p => getPropName( p ) === 'mode' );
        const extractedMode = extractStringValue( modeProp, checker );

        if( extractedMode )
        {
            mode = extractedMode as ValidationMode;
        }

        const fromProp = objLit.properties.find( p => getPropName( p ) === 'from' );
        const extractedFrom = extractStringValue( fromProp, checker );

        if( extractedFrom )
        {
            from = extractedFrom as ParseSource;
        }
    }
    else if( optsArg )
    {
        const extractedMode = extractStringValue( optsArg, checker );

        if( extractedMode )
        {
            mode = extractedMode as ValidationMode;
        }
    }

    return { mode, from, unionResolution };
}

export default function transformer( program: ts.Program )
{
    const checker = program.getTypeChecker();

    installStaticConstraintDiagnostics( program );

    return ( context: ts.TransformationContext ) =>
    {
        return ( sourceFile: ts.SourceFile ) =>
        {
            const emitNames = resolveEmitNames( sourceFile );
            const customFns = createCustomFunctionScope( sourceFile, checker );
            const validatorCache = new Map<string, ts.Expression>();
            const schemasCache = new Map<string, ts.Expression>();
            const serializerCache = new Map<string, ts.Expression>();
            const parserCache = new Map<string, ts.Expression>();
            const helperBindings = new Map<string, string>();
            const helperNamespaces = new Set<string>();
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

                if( !isTypecheckerImport( moduleName )){ continue }

                const bindings = statement.importClause?.namedBindings;

                if( bindings && ts.isNamedImports( bindings ))
                {
                    for( const element of bindings.elements )
                    {
                        const importedName = element.propertyName?.text || element.name.text;

                        if( TYPE_FUNCTIONS.includes( importedName ))
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
                        fnName = helperBindings.get( node.expression.text );
                    }
                    else if( ts.isPropertyAccessExpression( node.expression ) &&
                        ts.isIdentifier( node.expression.expression ) &&
                        helperNamespaces.has( node.expression.expression.text ))
                    {
                        fnName = node.expression.name.text;
                    }

                    if( fnName && TYPE_FUNCTIONS.includes( fnName ))
                    {
                        const typeArg = node.typeArguments?.[0];

                        if( typeArg )
                        {
                            const type = checker.getTypeFromTypeNode( typeArg );
                            const hash = getTypeHash( type );

                            if( fnName === 'serializer' || fnName === 'stringify' || fnName === 'safeSerialize' )
                            {
                                const optsIdx = fnName === 'serializer' ? 0 : 1;
                                const optsArg = node.arguments[optsIdx];
                                const options = parseSerializerOptions( optsArg, checker );
                                const serRef = buildSerializer( type, checker, serializerCache, hash, options );
                                const visitedOpts = visitArgOrUndefined( node.arguments, optsIdx, visitor );

                                if( fnName === 'serializer' )
                                {
                                    return ts.factory.createArrowFunction(
                                        undefined,
                                        undefined,
                                        [ts.factory.createParameterDeclaration( undefined, undefined, 'input' )],
                                        undefined,
                                        ts.factory.createToken( ts.SyntaxKind.EqualsGreaterThanToken ),
                                        ts.factory.createCallExpression( serRef, undefined, [
                                            ts.factory.createIdentifier( 'input' ),
                                            visitedOpts
                                        ])
                                    );
                                }

                                const inputVisitorResult = visitArgOrUndefined( node.arguments, 0, visitor );

                                if( fnName === 'safeSerialize' )
                                {
                                    return runtimeCall( emitNames.runtimeNs, 'safeSerialize', [ serRef, inputVisitorResult, visitedOpts ]);
                                }

                                return ts.factory.createCallExpression( serRef, undefined, [ inputVisitorResult, visitedOpts ]);
                            }

                            if( fnName === 'parse' || fnName === 'parser' || fnName === 'safeParse' )
                            {
                                const optsIdx = fnName === 'parser' ? 0 : 1;
                                const options = parseParseOptions( node.arguments[optsIdx], checker );
                                const parseRef = buildParser( type, checker, parserCache, hash, options, customFns );
                                const visitedOpts = visitArgOrUndefined( node.arguments, optsIdx, visitor );

                                if( fnName === 'parser' )
                                {
                                    return ts.factory.createArrowFunction(
                                        undefined,
                                        undefined,
                                        [ts.factory.createParameterDeclaration( undefined, undefined, 'input' )],
                                        undefined,
                                        ts.factory.createToken( ts.SyntaxKind.EqualsGreaterThanToken ),
                                        ts.factory.createCallExpression( parseRef, undefined, [
                                            ts.factory.createIdentifier( 'input' ),
                                            visitedOpts
                                        ])
                                    );
                                }

                                const inputVisitorResult = visitArgOrUndefined( node.arguments, 0, visitor );

                                if( fnName === 'safeParse' )
                                {
                                    return runtimeCall( emitNames.runtimeNs, 'safeParse', [ parseRef, inputVisitorResult, visitedOpts ]);
                                }

                                return ts.factory.createCallExpression( parseRef, undefined, [ inputVisitorResult, visitedOpts ]);
                            }

                            if( fnName === 'jsonSchema' )
                            {
                                const optsArg = node.arguments[0];
                                const objLit = resolveOptionsObjectLiteral( optsArg, checker );
                                let target: JsonSchemaTarget | undefined;

                                if( objLit )
                                {
                                    const targetProp = objLit.properties.find( p => getPropName( p ) === 'target' );
                                    const extracted = extractStringValue( targetProp, checker );

                                    if( extracted ){ target = extracted as JsonSchemaTarget }
                                }
                                else if( optsArg )
                                {
                                    const extracted = extractStringValue( optsArg, checker );

                                    if( extracted ){ target = extracted as JsonSchemaTarget }
                                }

                                const schemaKey = target && target !== 'draft-07'
                                    ? `${hash}_${target.replace( /[^a-zA-Z0-9_]/g, '_' )}`
                                    : hash;

                                if( !schemasCache.has( schemaKey ))
                                {
                                    const schemaOpts: JsonSchemaOptions | undefined = target ? { target } : undefined;
                                    const schemaObj = buildJsonSchema( type, checker, schemaOpts );
                                    schemasCache.set( schemaKey, objectToAst( schemaObj ));
                                }

                                return ts.factory.createIdentifier( `__schema_${schemaKey}` );
                            }

                            if( fnName === 'standardSchema' || fnName === 'validator' )
                            {
                                const unionResolution = parseUnionResolution( node.arguments[0], checker );
                                const valKey = unionResolution === 'declaration-order' ? `${hash}_decl` : hash;

                                if( !validatorCache.has( valKey ))
                                {
                                    buildValidator( type, checker, validatorCache, hash, customFns, unionResolution );
                                }

                                const validatorRef = ts.factory.createIdentifier( `__val_${valKey}` );
                                const optionsArg = visitArgOrUndefined( node.arguments, 0, visitor );
                                const helperMethod = fnName === 'validator' ? 'createValidator' : 'createStandardSchema';

                                return runtimeCall( emitNames.runtimeNs, helperMethod, [ validatorRef, optionsArg ]);
                            }

                            if( VALIDATION_FUNCTIONS.includes( fnName ))
                            {
                                const unionResolution = parseUnionResolution( node.arguments[1], checker );
                                const valKey = unionResolution === 'declaration-order' ? `${hash}_decl` : hash;

                                if( !validatorCache.has( valKey ))
                                {
                                    buildValidator( type, checker, validatorCache, hash, customFns, unionResolution );
                                }

                                const inputArg = visitArgOrUndefined( node.arguments, 0, visitor );
                                const optionsArg = visitArgOrUndefined( node.arguments, 1, visitor );
                                const validatorRef = ts.factory.createIdentifier( `__val_${valKey}` );

                                return runtimeCall( emitNames.runtimeNs, fnName, [ validatorRef, inputArg, optionsArg ]);
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
                parserCache
            );
        };
    };
}
