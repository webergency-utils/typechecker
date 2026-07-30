import ts from 'typescript';
import type { ICustomFunctionImport } from './customFns.js';

const RUNTIME_NS = '__tcRuntime';
const RUNTIME_MODULE = '@webergency-utils/typechecker/runtime';
const VALIDATORS_NAME = 'validators';

/** Identifiers the transformer and hoister emit into a file, resolved against names the file already binds. */
export interface IEmitNames {
    runtimeNs      : string
    validatorsName : string
}

/**
 * Both identifiers are always injected rather than reused. An existing user import of the runtime
 * is elided by TypeScript once calls are rewritten to synthesized nodes, and an existing binding
 * would sit after the hoisted declarations that reference it.
 */
export function resolveEmitNames( sourceFile: ts.SourceFile ): IEmitNames
{
    return {
        // Rewritten call sites reference the namespace in any scope, so a nested binding would shadow it.
        runtimeNs      : uniqueName( RUNTIME_NS, collectAllBindingNames( sourceFile )),
        // Only module-scope hoisted declarations reference this one.
        validatorsName : uniqueName( VALIDATORS_NAME, collectBindingNames( sourceFile.statements ))
    };
}

export function hoistEmitLocals(
    sourceFile: ts.SourceFile,
    cache: Map<string, ts.Expression>,
    schemasMap?: Map<string, ts.Expression>,
    emitNames?: IEmitNames,
    customImports?: readonly ICustomFunctionImport[],
    serializerCache?: Map<string, ts.Expression>,
    parserCache?: Map<string, ts.Expression>
)
{
    const hasSchemas = !!( schemasMap && schemasMap.size > 0 );
    const hasValidators = cache.size > 0;
    const hasSerializers = !!( serializerCache && serializerCache.size > 0 );
    const hasParsers = !!( parserCache && parserCache.size > 0 );
    const needsRuntime = hasValidators || hasSerializers || hasParsers;

    if( !needsRuntime && !hasSchemas ){ return sourceFile }

    const names = emitNames || resolveEmitNames( sourceFile );
    const declaredNames = collectBindingNames( sourceFile.statements );
    const importStatements: ts.Statement[] = [];
    const localStatements: ts.Statement[] = [];
    const prependedNames = new Set<string>();

    if( needsRuntime )
    {
        importStatements.push(
            ts.factory.createImportDeclaration(
                undefined,
                ts.factory.createImportClause(
                    false,
                    undefined,
                    ts.factory.createNamespaceImport( ts.factory.createIdentifier( names.runtimeNs ))
                ),
                ts.factory.createStringLiteral( RUNTIME_MODULE ),
                undefined
            )
        );
    }

    if( hasValidators )
    {
        localStatements.push(
            constStatement(
                names.validatorsName,
                ts.factory.createPropertyAccessExpression(
                    ts.factory.createIdentifier( names.runtimeNs ),
                    VALIDATORS_NAME
                )
            )
        );
    }

    for( const custom of customImports || [])
    {
        importStatements.push( customFunctionImport( custom ));
    }

    for( const [hash, expr] of cache.entries())
    {
        const valName = `__val_${hash}`;

        if( !declaredNames.has( valName ) && !prependedNames.has( valName ))
        {
            prependedNames.add( valName );
            localStatements.push( constStatement( valName, renameValidatorsRef( expr, names.validatorsName )));
        }
    }

    if( serializerCache )
    {
        for( const [hash, expr] of serializerCache.entries())
        {
            const serName = `__ser_${hash}`;

            if( !declaredNames.has( serName ) && !prependedNames.has( serName ))
            {
                prependedNames.add( serName );
                localStatements.push( constStatement( serName, renameRuntimeRef( expr, names.runtimeNs )));
            }
        }
    }

    if( parserCache )
    {
        for( const [hash, expr] of parserCache.entries())
        {
            const parseName = `__parse_${hash}`;

            if( !declaredNames.has( parseName ) && !prependedNames.has( parseName ))
            {
                prependedNames.add( parseName );
                localStatements.push( constStatement( parseName, renameRuntimeRef( expr, names.runtimeNs )));
            }
        }
    }

    if( schemasMap )
    {
        for( const [hash, schemaExpr] of schemasMap.entries())
        {
            const schemaName = `__schema_${hash}`;

            if( !declaredNames.has( schemaName ) && !prependedNames.has( schemaName ))
            {
                prependedNames.add( schemaName );
                localStatements.push( constStatement( schemaName, schemaExpr ));
            }
        }
    }

    const existingImports: ts.Statement[] = [];
    const rest: ts.Statement[] = [];

    for( const statement of sourceFile.statements )
    {
        if( ts.isImportDeclaration( statement )){ existingImports.push( statement ) }
        else { rest.push( statement ) }
    }

    return ts.factory.updateSourceFile( sourceFile,
        [
            ...importStatements,
            ...existingImports,
            ...localStatements,
            ...rest
        ]);
}


/**
 * Synthesized imports survive TypeScript's emit, unlike the user's own `typeof`-only import, so the
 * custom function is re-imported here under the name the generated validator calls.
 */
function customFunctionImport( custom: ICustomFunctionImport ): ts.Statement
{
    const local = ts.factory.createIdentifier( custom.localName );
    const clause = custom.importedName === 'default'
        ? ts.factory.createImportClause( false, local, undefined )
        : ts.factory.createImportClause( false, undefined, ts.factory.createNamedImports([
            ts.factory.createImportSpecifier(
                false,
                ts.factory.createIdentifier( custom.importedName ),
                local
            )
        ]));

    return ts.factory.createImportDeclaration(
        undefined,
        clause,
        ts.factory.createStringLiteral( custom.module ),
        undefined
    );
}


function constStatement( name: string, initializer: ts.Expression ): ts.Statement
{
    return ts.factory.createVariableStatement(
        undefined,
        ts.factory.createVariableDeclarationList([
            ts.factory.createVariableDeclaration(
                ts.factory.createIdentifier( name ),
                undefined,
                undefined,
                initializer
            )
        ], ts.NodeFlags.Const )
    );
}


/** Generated validator expressions always reference `validators`; retarget them when that name is taken. */
function renameValidatorsRef( expr: ts.Expression, validatorsName: string ): ts.Expression
{
    if( validatorsName === VALIDATORS_NAME ){ return expr }

    const visit = ( node: ts.Node ): ts.Node =>
    {
        if( ts.isPropertyAccessExpression( node ))
        {
            return ts.factory.updatePropertyAccessExpression( node, visit( node.expression ) as ts.Expression, node.name );
        }

        if( ts.isIdentifier( node ) && node.text === VALIDATORS_NAME )
        {
            return ts.factory.createIdentifier( validatorsName );
        }

        return ts.visitEachChild( node, visit, undefined );
    };

    return visit( expr ) as ts.Expression;
}

/** Generated serialize/parse expressions always reference `__tcRuntime`; retarget when that name is taken. */
function renameRuntimeRef( expr: ts.Expression, runtimeNs: string ): ts.Expression
{
    if( runtimeNs === RUNTIME_NS ){ return expr }

    const visit = ( node: ts.Node ): ts.Node =>
    {
        if( ts.isPropertyAccessExpression( node ))
        {
            return ts.factory.updatePropertyAccessExpression( node, visit( node.expression ) as ts.Expression, node.name );
        }

        if( ts.isIdentifier( node ) && node.text === RUNTIME_NS )
        {
            return ts.factory.createIdentifier( runtimeNs );
        }

        return ts.visitEachChild( node, visit, undefined );
    };

    return visit( expr ) as ts.Expression;
}


function uniqueName( base: string, taken: Set<string> ): string
{
    if( !taken.has( base )){ return base }

    let index = 1;

    while( taken.has( `${base}_${index}` )){ index++ }

    return `${base}_${index}`;
}


/** Every name bound anywhere in the file, so an injected identifier cannot be shadowed in a nested scope. */
function collectAllBindingNames( sourceFile: ts.SourceFile ): Set<string>
{
    const names = new Set<string>();

    const visit = ( node: ts.Node ) =>
    {
        if( ts.isVariableDeclaration( node ) || ts.isParameter( node ) || ts.isBindingElement( node ))
        {
            addBindingName( node.name, names );
        }
        else if( ts.isImportDeclaration( node ))
        {
            addImportNames( node, names );
        }
        else if( ts.isFunctionDeclaration( node ) || ts.isFunctionExpression( node ) ||
            ts.isClassDeclaration( node ) || ts.isClassExpression( node ) ||
            ts.isEnumDeclaration( node ) || ts.isModuleDeclaration( node ))
        {
            if( node.name && ts.isIdentifier( node.name )){ names.add( node.name.text ) }
        }

        ts.forEachChild( node, visit );
    };

    ts.forEachChild( sourceFile, visit );

    return names;
}


export function collectBindingNames( statements: readonly ts.Statement[]): Set<string>
{
    const names = new Set<string>();

    for( const statement of statements )
    {
        if( ts.isVariableStatement( statement ))
        {
            for( const decl of statement.declarationList.declarations )
            {
                addBindingName( decl.name, names );
            }

            continue;
        }

        if( ts.isFunctionDeclaration( statement ) ||
            ts.isClassDeclaration( statement ) ||
            ts.isEnumDeclaration( statement ) ||
            ts.isModuleDeclaration( statement ))
        {
            if( statement.name && ts.isIdentifier( statement.name ))
            {
                names.add( statement.name.text );
            }

            continue;
        }

        if( ts.isImportDeclaration( statement ))
        {
            addImportNames( statement, names );
        }
    }

    return names;
}


function addImportNames( statement: ts.ImportDeclaration, names: Set<string> )
{
    const clause = statement.importClause;

    if( !clause ){ return }

    if( clause.name ){ names.add( clause.name.text ) }

    const bindings = clause.namedBindings;

    if( !bindings ){ return }

    if( ts.isNamespaceImport( bindings ))
    {
        names.add( bindings.name.text );

        return;
    }

    for( const element of bindings.elements )
    {
        names.add( element.name.text );
    }
}


function addBindingName( name: ts.BindingName, names: Set<string> )
{
    if( ts.isIdentifier( name ))
    {
        names.add( name.text );

        return;
    }

    for( const element of name.elements )
    {
        if( ts.isOmittedExpression( element )){ continue }

        addBindingName( element.name, names );
    }
}
