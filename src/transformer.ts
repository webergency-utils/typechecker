import ts from 'typescript';
import { buildValidator, generateHash, buildJsonSchema, objectToAst } from './engine/resolver.js';
export { buildValidator, generateHash, buildJsonSchema } from './engine/resolver.js';
import { hoistRegistrations } from './engine/hoister.js';
import { installStaticConstraintDiagnostics } from './engine/staticAsserts.js';

const TYPE_FUNCTIONS = ['is', 'assert', 'assertGuard', 'validate', 'jsonSchema'];
const SCHEMA_FUNCTIONS = ['isSchema', 'assertSchema', 'assertGuardSchema', 'validateSchema'];

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

            const visitor = ( node: ts.Node ): ts.Node => 
            {
                if( ts.isImportDeclaration( node )) 
                {
                    return node;
                }

                if( ts.isCallExpression( node ) && ts.isIdentifier( node.expression )) 
                {
                    const fnName = node.expression.text;

                    if( SCHEMA_FUNCTIONS.includes( fnName )) 
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

                    if( TYPE_FUNCTIONS.includes( fnName )) 
                    {
                        const typeArg = node.typeArguments?.[0];

                        if( typeArg ) 
                        {
                            const type = checker.getTypeFromTypeNode( typeArg );
                            const hash = generateHash( type, checker );

                            if( !validatorCache.has( hash )) 
                            {
                                buildValidator( type, checker, validatorCache, requiredUtils );
                            }

                            if( !schemasCache.has( hash )) 
                            {
                                const schemaObj = buildJsonSchema( type, checker );
                                schemasCache.set( hash, objectToAst( schemaObj ));
                            }

                            const inputArg = argOrUndefined( node.arguments, 0 );
                            const optionsArg = argOrUndefined( node.arguments, 1 );
                            const getValidator = metadataCall( 'getValidator', [ts.factory.createStringLiteral( hash )]);

                            if( fnName === 'jsonSchema' ) 
                            {
                                return metadataCall( 'getSchema', [ts.factory.createStringLiteral( hash )]);
                            }

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

                return ts.visitEachChild( node, visitor, context );
            };

            const transformedFile = ts.visitNode( sourceFile, visitor ) as ts.SourceFile;

            return hoistRegistrations( transformedFile, validatorCache, requiredUtils, schemasCache );
        };
    };
}
