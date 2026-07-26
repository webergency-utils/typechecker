import ts from 'typescript';
import { buildValidator, generateHash, buildJsonSchema, objectToAst } from './engine/resolver.js';
export { buildValidator, generateHash, buildJsonSchema } from './engine/resolver.js';
import { hoistRegistrations } from './engine/hoister.js';
import { installStaticConstraintDiagnostics } from './engine/staticAsserts.js';

const TYPE_FUNCTIONS = ['is', 'assert', 'assertGuard', 'validate', 'jsonSchema'];
const SCHEMA_FUNCTIONS = ['isSchema', 'assertSchema', 'assertGuardSchema', 'validateSchema'];
const VALIDATION_FUNCTIONS = ['is', 'assert', 'assertGuard', 'validate'];

function metadataCall( method: string, args: ts.Expression[]): ts.CallExpression 
{
    return ts.factory.createCallExpression(
        ts.factory.createPropertyAccessExpression( ts.factory.createIdentifier( 'MetadataStore' ), method ),
        undefined,
        args
    );
}

function argOrUndefined( args: ts.NodeArray<ts.Expression>, index: number ): ts.Expression 
{
    return args[index] || ts.factory.createIdentifier( 'undefined' );
}

export default function transformer( program: ts.Program ) 
{
    const checker = program.getTypeChecker();

    installStaticConstraintDiagnostics( program );

    return ( context: ts.TransformationContext ) => 
    {
        return ( sourceFile: ts.SourceFile ) => 
        {
            const validatorCache = new Map<string, ts.Expression>();
            const schemasCache = new Map<string, ts.Expression>();
            const requiredUtils = new Set<string>();
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

                        if( TYPE_FUNCTIONS.includes( importedName ) || SCHEMA_FUNCTIONS.includes( importedName ))
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

                    if( fnName && SCHEMA_FUNCTIONS.includes( fnName ))
                    {
                        requiredUtils.add( 'MetadataStore' );
                        const schemaArg = argOrUndefined( node.arguments, 0 );
                        const inputArg = argOrUndefined( node.arguments, 1 );
                        const optionsArg = argOrUndefined( node.arguments, 2 );
                        const compiled = metadataCall( 'getOrCompileSchema', [schemaArg]);

                        if( fnName === 'validateSchema' )
                        {
                            return metadataCall( 'validate', [compiled, inputArg, optionsArg]);
                        }

                        if( fnName === 'isSchema' )
                        {
                            return metadataCall( 'is', [compiled, inputArg, optionsArg]);
                        }

                        if( fnName === 'assertSchema' )
                        {
                            return metadataCall( 'assert', [compiled, inputArg, optionsArg]);
                        }

                        return metadataCall( 'assertGuard', [compiled, inputArg, optionsArg]);
                    }

                    if( fnName && TYPE_FUNCTIONS.includes( fnName ))
                    {
                        const typeArg = node.typeArguments?.[0];

                        if( typeArg ) 
                        {
                            const type = checker.getTypeFromTypeNode( typeArg );
                            const hash = getTypeHash( type );

                            if( fnName === 'jsonSchema' )
                            {
                                requiredUtils.add( 'MetadataStore' );

                                if( !schemasCache.has( hash ))
                                {
                                    const schemaObj = buildJsonSchema( type, checker );
                                    schemasCache.set( hash, objectToAst( schemaObj ));
                                }

                                return metadataCall( 'getSchema', [ts.factory.createStringLiteral( hash )]);
                            }

                            if( VALIDATION_FUNCTIONS.includes( fnName ))
                            {
                                if( !validatorCache.has( hash ))
                                {
                                    buildValidator( type, checker, validatorCache, requiredUtils, hash );
                                }

                                const inputArg = argOrUndefined( node.arguments, 0 );
                                const optionsArg = argOrUndefined( node.arguments, 1 );
                                const getValidator = metadataCall( 'getValidator', [ts.factory.createStringLiteral( hash )]);

                                if( fnName === 'validate' )
                                {
                                    return metadataCall( 'validate', [getValidator, inputArg, optionsArg]);
                                }

                                if( fnName === 'is' )
                                {
                                    return metadataCall( 'is', [getValidator, inputArg, optionsArg]);
                                }

                                if( fnName === 'assert' )
                                {
                                    return metadataCall( 'assert', [getValidator, inputArg, optionsArg]);
                                }

                                return metadataCall( 'assertGuard', [getValidator, inputArg, optionsArg]);
                            }
                        }
                    }
                }

                return ts.visitEachChild( node, visitor, context );
            };

            const transformedFile = ts.visitNode( sourceFile, visitor ) as ts.SourceFile;

            return hoistRegistrations( transformedFile, validatorCache, requiredUtils, schemasCache );
        };
    };
}
