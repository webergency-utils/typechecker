import ts from 'typescript';
import { buildValidator, generateHash, buildJsonSchema, objectToAst } from './engine/resolver.js';
export { buildValidator, generateHash, buildJsonSchema } from './engine/resolver.js';
import { hoistEmitLocals, resolveEmitNames } from './engine/hoister.js';
import { createCustomFunctionScope, type ICustomFunctionScope } from './engine/customFns.js';
import { installStaticConstraintDiagnostics } from './engine/staticAsserts.js';
import { generateSerializerCode, SerializerGeneratorOptions, SerializeFormat } from './engine/serializer-generator.js';
import { generateParseCode, ParseGeneratorOptions, ParseSource } from './engine/parse-generator.js';
import { templateToAst } from './engine/generators.js';
import { ValidationMode } from './runtime/validators.js';
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
    const resolvedHash = `${hash ?? generateHash( type, checker )}_${mode}_${format}`;

    if( !map.has( resolvedHash ))
    {
        const codeStr = generateSerializerCode( type, checker, { mode, format });
        const ast = format === 'query'
            ? templateToAst( `( function( input, options ){ const transform = options && options.transform; return ${codeStr}; })` )
            : templateToAst(
                `( function( input, options ){ const transform = options && options.transform; const replacer = options && options.replacer; const out = ${codeStr}; if( replacer ){ try { return JSON.stringify( JSON.parse( out ), replacer ); } catch( e ){ throw new __tcRuntime.SerializationError( "", e && e.message ? e.message : String( e ) ); } } return out; })`
            );
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
    const resolvedHash = `${hash ?? generateHash( type, checker )}_${mode}_${from}`;

    if( !map.has( resolvedHash ))
    {
        const codeStr = generateParseCode( type, checker, { mode, from }, scope );
        const ast = templateToAst( codeStr );
        map.set( resolvedHash, ast );
    }

    return ts.factory.createIdentifier( `__parse_${resolvedHash}` );
}

const TYPE_FUNCTIONS = ['is', 'assert', 'assertGuard', 'validate', 'jsonSchema', 'serializer', 'stringify', 'parse'];
const VALIDATION_FUNCTIONS = ['is', 'assert', 'assertGuard', 'validate'];

function runtimeCall( runtimeNs: string, method: string, args: ts.Expression[]): ts.CallExpression
{
    return ts.factory.createCallExpression(
        ts.factory.createPropertyAccessExpression( ts.factory.createIdentifier( runtimeNs ), method ),
        undefined,
        args
    );
}

function argOrUndefined( args: ts.NodeArray<ts.Expression>, index: number ): ts.Expression
{
    return args[index] || ts.factory.createIdentifier( 'undefined' );
}

function parseSerializerOptions( optsArg: ts.Expression | undefined ): SerializerGeneratorOptions
{
    let mode: ValidationMode = 'strip';
    let format: SerializeFormat = 'json';

    if( optsArg && ts.isStringLiteral( optsArg ))
    {
        mode = optsArg.text as ValidationMode;
    }
    else if( optsArg && ts.isObjectLiteralExpression( optsArg ))
    {
        const modeProp = optsArg.properties.find( p => p.name && ts.isIdentifier( p.name ) && p.name.text === 'mode' );

        if( modeProp && ts.isPropertyAssignment( modeProp ) && ts.isStringLiteral( modeProp.initializer ))
        {
            mode = modeProp.initializer.text as ValidationMode;
        }

        const formatProp = optsArg.properties.find( p => p.name && ts.isIdentifier( p.name ) && ( p.name.text === 'format' || p.name.text === 'to' ));

        if( formatProp && ts.isPropertyAssignment( formatProp ) && ts.isStringLiteral( formatProp.initializer ))
        {
            format = formatProp.initializer.text as SerializeFormat;
        }
    }

    return { mode, format };
}

function parseParseOptions( optsArg: ts.Expression | undefined ): ParseGeneratorOptions
{
    let mode: ValidationMode = 'strip';
    let from: ParseSource = 'json';

    if( optsArg && ts.isStringLiteral( optsArg ))
    {
        mode = optsArg.text as ValidationMode;
    }
    else if( optsArg && ts.isObjectLiteralExpression( optsArg ))
    {
        const modeProp = optsArg.properties.find( p => p.name && ts.isIdentifier( p.name ) && p.name.text === 'mode' );

        if( modeProp && ts.isPropertyAssignment( modeProp ) && ts.isStringLiteral( modeProp.initializer ))
        {
            mode = modeProp.initializer.text as ValidationMode;
        }

        const fromProp = optsArg.properties.find( p => p.name && ts.isIdentifier( p.name ) && p.name.text === 'from' );

        if( fromProp && ts.isPropertyAssignment( fromProp ) && ts.isStringLiteral( fromProp.initializer ))
        {
            from = fromProp.initializer.text as ParseSource;
        }
    }

    return { mode, from };
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
                const isTypecheckerImport = moduleName === '@webergency-utils/typechecker' ||
                    /(?:^|\/)(?:src\/)?index\.(?:js|ts)$/.test( moduleName );

                if( !isTypecheckerImport ){ continue }

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

                            if( fnName === 'serializer' || fnName === 'stringify' )
                            {
                                const optsArg = fnName === 'serializer' ? node.arguments[0] : node.arguments[1];
                                const options = parseSerializerOptions( optsArg );
                                const serRef = buildSerializer( type, checker, serializerCache, hash, options );
                                const visitedOpts = optsArg
                                    ? ts.visitNode( optsArg, visitor ) as ts.Expression
                                    : ts.factory.createIdentifier( 'undefined' );

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

                                const inputArg = node.arguments[0];

                                if( inputArg )
                                {
                                    const inputVisitorResult = ts.visitNode( inputArg, visitor ) as ts.Expression;

                                    return ts.factory.createCallExpression( serRef, undefined, [inputVisitorResult, visitedOpts]);
                                }
                            }

                            if( fnName === 'parse' )
                            {
                                const options = parseParseOptions( node.arguments[1]);
                                const parseRef = buildParser( type, checker, parserCache, hash, options, customFns );
                                const inputArg = node.arguments[0];
                                const visitedOpts = node.arguments[1]
                                    ? ts.visitNode( node.arguments[1], visitor ) as ts.Expression
                                    : ts.factory.createIdentifier( 'undefined' );

                                if( inputArg )
                                {
                                    const inputVisitorResult = ts.visitNode( inputArg, visitor ) as ts.Expression;

                                    return ts.factory.createCallExpression( parseRef, undefined, [inputVisitorResult, visitedOpts]);
                                }
                            }

                            if( fnName === 'jsonSchema' )
                            {
                                if( !schemasCache.has( hash ))
                                {
                                    const schemaObj = buildJsonSchema( type, checker );
                                    schemasCache.set( hash, objectToAst( schemaObj ));
                                }

                                return ts.factory.createIdentifier( `__schema_${hash}` );
                            }

                            if( VALIDATION_FUNCTIONS.includes( fnName ))
                            {
                                if( !validatorCache.has( hash ))
                                {
                                    buildValidator( type, checker, validatorCache, hash, customFns );
                                }

                                const inputArg = argOrUndefined( node.arguments, 0 );
                                const optionsArg = argOrUndefined( node.arguments, 1 );
                                const validatorRef = ts.factory.createIdentifier( `__val_${hash}` );

                                return runtimeCall( emitNames.runtimeNs, fnName, [validatorRef, inputArg, optionsArg]);
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
