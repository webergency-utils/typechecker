import ts from 'typescript';
import type { ICustomFunctionImport } from './customFns.js';

const RUNTIME_NS = '__tcRuntime';
const VALIDATORS_NAME = 'validators';

export type RuntimeDomain = 'validators' | 'serialize' | 'parse' | 'clone' | 'random';

export const DOMAIN_SENTINELS: Record<RuntimeDomain, string> =
{
    validators : '__tcDom_validators',
    serialize  : '__tcDom_serialize',
    parse      : '__tcDom_parse',
    clone      : '__tcDom_clone',
    random     : '__tcDom_random'
};

const SENTINEL_TO_DOMAIN = new Map<string, RuntimeDomain>([
    [ DOMAIN_SENTINELS.validators, 'validators' ],
    [ DOMAIN_SENTINELS.serialize, 'serialize' ],
    [ DOMAIN_SENTINELS.parse, 'parse' ],
    [ DOMAIN_SENTINELS.clone, 'clone' ],
    [ DOMAIN_SENTINELS.random, 'random' ]
]);

const DOMAIN_ORDER: readonly RuntimeDomain[] =
[
    'validators',
    'serialize',
    'parse',
    'clone',
    'random'
];

const DOMAIN_MODULES: Record<RuntimeDomain, string> =
{
    validators : '@webergency-utils/typechecker/runtime/validators',
    serialize  : '@webergency-utils/typechecker/runtime/serialize',
    parse      : '@webergency-utils/typechecker/runtime/parse',
    clone      : '@webergency-utils/typechecker/runtime/clone',
    random     : '@webergency-utils/typechecker/runtime/random'
};

const DOMAIN_FALLBACK_BASES: Record<RuntimeDomain, string> =
{
    validators : '__tcVal',
    serialize  : '__tcSer',
    parse      : '__tcParse',
    clone      : '__tcClone',
    random     : '__tcRand'
};

/** Identifiers the transformer and hoister emit into a file, resolved against names the file already binds. */
export interface IEmitNames
{
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
    sourceFile      : ts.SourceFile,
    cache           : Map<string, ts.Expression>,
    schemasMap?     : Map<string, ts.Expression>,
    emitNames?      : IEmitNames,
    customImports?  : readonly ICustomFunctionImport[],
    serializerCache?: Map<string, ts.Expression>,
    parserCache?    : Map<string, ts.Expression>,
    clonerCache?    : Map<string, ts.Expression>,
    prunerCache?    : Map<string, ts.Expression>,
    randomCache?    : Map<string, ts.Expression>,
    guardCache?     : Map<string, ts.Expression>
)
{
    const hasSchemas = !!( schemasMap && schemasMap.size > 0 );
    const hasValidators = cache.size > 0;
    const hasGuards = !!( guardCache && guardCache.size > 0 );
    const hasSerializers = !!( serializerCache && serializerCache.size > 0 );
    const hasParsers = !!( parserCache && parserCache.size > 0 );
    const hasCloners = !!( clonerCache && clonerCache.size > 0 );
    const hasPruners = !!( prunerCache && prunerCache.size > 0 );
    const hasRandoms = !!( randomCache && randomCache.size > 0 );
    const sentinelsUsed = collectUsedSentinels( sourceFile );

    const activeDomains = new Set<RuntimeDomain>();

    if( hasValidators || sentinelsUsed.has( 'validators' ) || mapUsesRuntimeRef( guardCache ))
    {
        activeDomains.add( 'validators' );
    }

    if( sentinelsUsed.has( 'serialize' ) || mapUsesRuntimeRef( serializerCache ))
    {
        activeDomains.add( 'serialize' );
    }

    if( sentinelsUsed.has( 'parse' ) || mapUsesRuntimeRef( parserCache ))
    {
        activeDomains.add( 'parse' );
    }

    if( sentinelsUsed.has( 'clone' ) || mapUsesRuntimeRef( clonerCache ) || mapUsesRuntimeRef( prunerCache ))
    {
        activeDomains.add( 'clone' );
    }

    if( sentinelsUsed.has( 'random' ) || mapUsesRuntimeRef( randomCache ))
    {
        activeDomains.add( 'random' );
    }

    const hasLocals =
        hasValidators ||
        hasGuards ||
        hasSerializers ||
        hasParsers ||
        hasCloners ||
        hasPruners ||
        hasRandoms ||
        hasSchemas;
    const hasCustomImports = !!( customImports && customImports.length > 0 );

    if( activeDomains.size === 0 && !hasLocals && !hasCustomImports ){ return sourceFile }

    const names = emitNames || resolveEmitNames( sourceFile );
    const allBindings = collectAllBindingNames( sourceFile );
    allBindings.add( names.runtimeNs );
    allBindings.add( names.validatorsName );

    const domainNs = new Map<RuntimeDomain, string>();
    let isFirstDomain = true;

    for( const domain of DOMAIN_ORDER )
    {
        if( !activeDomains.has( domain )){ continue }

        if( isFirstDomain )
        {
            domainNs.set( domain, names.runtimeNs );
            isFirstDomain = false;
        }
        else
        {
            const ns = uniqueName( DOMAIN_FALLBACK_BASES[domain], allBindings );
            allBindings.add( ns );
            domainNs.set( domain, ns );
        }
    }

    const declaredNames = collectBindingNames( sourceFile.statements );
    const importStatements: ts.Statement[] = [];
    const localStatements: ts.Statement[] = [];
    const prependedNames = new Set<string>();

    for( const [ domain, ns ] of domainNs.entries())
    {
        importStatements.push(
            ts.factory.createImportDeclaration(
                undefined,
                ts.factory.createImportClause(
                    false,
                    undefined,
                    ts.factory.createNamespaceImport( ts.factory.createIdentifier( ns ))
                ),
                ts.factory.createStringLiteral( DOMAIN_MODULES[domain]),
                undefined
            )
        );
    }

    if( hasValidators )
    {
        const valNs = domainNs.get( 'validators' ) || names.runtimeNs;
        localStatements.push(
            constStatement(
                names.validatorsName,
                ts.factory.createPropertyAccessExpression(
                    ts.factory.createIdentifier( valNs ),
                    VALIDATORS_NAME
                )
            )
        );
    }

    for( const custom of customImports || [])
    {
        importStatements.push( customFunctionImport( custom ));
    }

    for( const [ hash, expr ] of cache.entries())
    {
        const valName = `__val_${hash}`;

        if( !declaredNames.has( valName ) && !prependedNames.has( valName ))
        {
            prependedNames.add( valName );
            localStatements.push( constStatement( valName, renameValidatorsRef( expr, names.validatorsName )));
        }
    }

    if( guardCache )
    {
        const valNs = domainNs.get( 'validators' ) || names.runtimeNs;

        for( const [ hash, expr ] of guardCache.entries())
        {
            const guardName = `__is_${hash}`;

            if( !declaredNames.has( guardName ) && !prependedNames.has( guardName ))
            {
                prependedNames.add( guardName );
                localStatements.push( constStatement( guardName, renameRuntimeRef( expr, valNs )));
            }
        }
    }

    if( serializerCache )
    {
        const serNs = domainNs.get( 'serialize' ) || names.runtimeNs;

        for( const [ hash, expr ] of serializerCache.entries())
        {
            const serName = `__ser_${hash}`;

            if( !declaredNames.has( serName ) && !prependedNames.has( serName ))
            {
                prependedNames.add( serName );
                localStatements.push( constStatement( serName, renameRuntimeRef( expr, serNs )));
            }
        }
    }

    if( parserCache )
    {
        const parseNs = domainNs.get( 'parse' ) || names.runtimeNs;

        for( const [ hash, expr ] of parserCache.entries())
        {
            const parseName = `__parse_${hash}`;

            if( !declaredNames.has( parseName ) && !prependedNames.has( parseName ))
            {
                prependedNames.add( parseName );
                localStatements.push( constStatement( parseName, renameRuntimeRef( expr, parseNs )));
            }
        }
    }

    if( clonerCache )
    {
        const cloneNs = domainNs.get( 'clone' ) || names.runtimeNs;

        for( const [ hash, expr ] of clonerCache.entries())
        {
            const cloneName = `__clone_${hash}`;

            if( !declaredNames.has( cloneName ) && !prependedNames.has( cloneName ))
            {
                prependedNames.add( cloneName );
                localStatements.push( constStatement( cloneName, renameRuntimeRef( expr, cloneNs )));
            }
        }
    }

    if( prunerCache )
    {
        const cloneNs = domainNs.get( 'clone' ) || names.runtimeNs;

        for( const [ hash, expr ] of prunerCache.entries())
        {
            const pruneName = `__prune_${hash}`;

            if( !declaredNames.has( pruneName ) && !prependedNames.has( pruneName ))
            {
                prependedNames.add( pruneName );
                localStatements.push( constStatement( pruneName, renameRuntimeRef( expr, cloneNs )));
            }
        }
    }

    if( randomCache )
    {
        const randNs = domainNs.get( 'random' ) || names.runtimeNs;

        for( const [ hash, expr ] of randomCache.entries())
        {
            const randName = `__rand_${hash}`;

            if( !declaredNames.has( randName ) && !prependedNames.has( randName ))
            {
                prependedNames.add( randName );
                localStatements.push( constStatement( randName, renameRuntimeRef( expr, randNs )));
            }
        }
    }

    if( schemasMap )
    {
        for( const [ hash, schemaExpr ] of schemasMap.entries())
        {
            const schemaName = `__schema_${hash}`;

            if( !declaredNames.has( schemaName ) && !prependedNames.has( schemaName ))
            {
                prependedNames.add( schemaName );
                localStatements.push( constStatement( schemaName, schemaExpr ));
            }
        }
    }

    const sentinelMap = new Map<string, string>();

    for( const [ domain, ns ] of domainNs.entries())
    {
        sentinelMap.set( DOMAIN_SENTINELS[domain], ns );
    }

    const directives: ts.Statement[] = [];
    const existingImports: ts.Statement[] = [];
    const rest: ts.Statement[] = [];
    let inPrologue = true;

    for( const statement of sourceFile.statements )
    {
        if( inPrologue && ts.isExpressionStatement( statement ) && ts.isStringLiteral( statement.expression ))
        {
            directives.push( statement );
            continue;
        }

        inPrologue = false;

        if( ts.isImportDeclaration( statement )){ existingImports.push( statement ) }
        else
        {
            rest.push( sentinelMap.size > 0 ? rewriteSentinels( statement, sentinelMap ) : statement );
        }
    }

    return ts.factory.updateSourceFile( sourceFile,
        [
            ...directives,
            ...importStatements,
            ...existingImports,
            ...localStatements,
            ...rest
        ]);
}


function collectUsedSentinels( sourceFile: ts.SourceFile ): Set<RuntimeDomain>
{
    const used = new Set<RuntimeDomain>();

    const visit = ( node: ts.Node ) =>
    {
        if( ts.isPropertyAccessExpression( node ))
        {
            visit( node.expression );

            return;
        }

        if( ts.isIdentifier( node ))
        {
            const domain = SENTINEL_TO_DOMAIN.get( node.text );

            if( domain ){ used.add( domain ) }

            return;
        }

        ts.forEachChild( node, visit );
    };

    ts.forEachChild( sourceFile, visit );

    return used;
}


function mapUsesRuntimeRef( map: Map<string, ts.Expression> | undefined ): boolean
{
    if( !map || map.size === 0 ){ return false }

    for( const expr of map.values())
    {
        if( exprUsesRuntimeRef( expr )){ return true }
    }

    return false;
}


function exprUsesRuntimeRef( root: ts.Node ): boolean
{
    let found = false;

    const visit = ( node: ts.Node ) =>
    {
        if( found ){ return }

        if( ts.isPropertyAccessExpression( node ))
        {
            visit( node.expression );

            return;
        }

        if( ts.isIdentifier( node ) && node.text === RUNTIME_NS )
        {
            found = true;

            return;
        }

        ts.forEachChild( node, visit );
    };

    visit( root );

    return found;
}


function rewriteSentinels( statement: ts.Statement, sentinelMap: Map<string, string> ): ts.Statement
{
    const visit = ( node: ts.Node ): ts.Node =>
    {
        if( ts.isPropertyAccessExpression( node ))
        {
            return ts.factory.updatePropertyAccessExpression(
                node,
                visit( node.expression ) as ts.Expression,
                node.name
            );
        }

        if( ts.isIdentifier( node ))
        {
            const mapped = sentinelMap.get( node.text );

            if( mapped ){ return ts.factory.createIdentifier( mapped ) }
        }

        return ts.visitEachChild( node, visit, undefined );
    };

    return visit( statement ) as ts.Statement;
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
