import ts from 'typescript';
import { collectBindingNames } from './hoister.js';

export interface IFunctionIdentity
{
    name         : string
    declaration? : ts.Declaration
}

/** A value import the hoister must inject for a bound custom function to resolve at runtime. */
export interface ICustomFunctionImport
{
    localName    : string
    /** `default` imports the module default; anything else is a named import. */
    importedName : string
    module       : string
}

export interface ICustomFunctionScope
{
    /** The identifier text the generated validator should call for this function. */
    bind    : ( identity: IFunctionIdentity ) => string
    imports : ICustomFunctionImport[]
}

/** Declarations that put a callable under a name the emitted validator can reference. */
function isNamedValueBinding( declaration: ts.Declaration ): boolean
{
    if( ts.isVariableDeclaration( declaration )){ return ts.isIdentifier( declaration.name ) }

    if( ts.isFunctionDeclaration( declaration )){ return declaration.name !== undefined }

    if( ts.isClassDeclaration( declaration )){ return declaration.name !== undefined }

    return false;
}

/**
 * Name a function type by the binding it was written as (`typeof myFunc`). Inline signatures, methods
 * and other unnameable callables yield `undefined` — there is nothing the generated code could call.
 */
export function resolveFunctionIdentity( type: ts.Type, checker: ts.TypeChecker, alternate?: ts.Type ): IFunctionIdentity | undefined
{
    const symbol = type.getSymbol() || type.aliasSymbol || alternate?.getSymbol() || alternate?.aliasSymbol;
    let declaration = symbol && ( symbol.valueDeclaration || symbol.declarations?.[0]);
    let name = symbol?.getName();

    // Function expressions and arrows are themselves anonymous; the name lives on the variable
    // holding them. Only they are worth walking out of — a type node's parent is unrelated to it.
    if( declaration && ( ts.isFunctionExpression( declaration ) || ts.isArrowFunction( declaration )))
    {
        let current: ts.Node | undefined = declaration;

        while( current )
        {
            if( ts.isVariableDeclaration( current ) && ts.isIdentifier( current.name ))
            {
                name = current.name.text;
                declaration = current;
                break;
            }

            current = current.parent;
        }
    }

    if( name && declaration && isNamedValueBinding( declaration )){ return { name, declaration } }

    const match = checker.typeToString( type ).match( /typeof\s+([a-zA-Z0-9_]+)/ );

    if( match ){ return { name : match[1] } }

    return undefined;
}

/**
 * Basename and line rather than the absolute path, so that two same-named functions from different
 * modules hash apart without making validator names depend on where the project is checked out.
 */
export function declarationSite( declaration?: ts.Declaration ): string
{
    if( !declaration ){ return '' }

    const sourceFile = declaration.getSourceFile();
    const basename = sourceFile.fileName.split( '/' ).pop() || '';
    const { line } = sourceFile.getLineAndCharacterOfPosition( declaration.getStart());

    return `@${basename}:${line + 1}`;
}

/** Generated validators are hoisted to module scope, so only module-scope bindings are reachable. */
function isModuleScoped( declaration: ts.Declaration ): boolean
{
    if( ts.isFunctionDeclaration( declaration ) || ts.isClassDeclaration( declaration ))
    {
        return ts.isSourceFile( declaration.parent );
    }

    const statement = declaration.parent?.parent;

    return statement !== undefined && ts.isSourceFile( statement.parent );
}

function importsSymbol( reference: ts.Identifier, declaration: ts.Declaration, checker: ts.TypeChecker ): boolean
{
    const symbol = checker.getSymbolAtLocation( reference );

    if( !symbol ){ return false }

    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol( symbol ) : symbol;

    return target.valueDeclaration === declaration || target.declarations?.includes( declaration ) === true;
}

/** Locate the import in `sourceFile` that brings `declaration` into scope, to re-import it under our own name. */
function findImportOf(
    sourceFile: ts.SourceFile,
    declaration: ts.Declaration,
    checker: ts.TypeChecker
): { importedName : string, module : string } | undefined
{
    for( const statement of sourceFile.statements )
    {
        if( !ts.isImportDeclaration( statement ) || !ts.isStringLiteral( statement.moduleSpecifier )){ continue }

        const clause = statement.importClause;

        if( !clause ){ continue }

        const module = statement.moduleSpecifier.text;

        if( clause.name && importsSymbol( clause.name, declaration, checker ))
        {
            return { importedName : 'default', module };
        }

        const bindings = clause.namedBindings;

        if( !bindings || !ts.isNamedImports( bindings )){ continue }

        for( const element of bindings.elements )
        {
            if( importsSymbol( element.name, declaration, checker ))
            {
                return { importedName : ( element.propertyName || element.name ).text, module };
            }
        }
    }

    return undefined;
}

/**
 * Decides how a generated validator refers to a `constraint.Custom` / `transform.Custom` function
 * or a user class used as a nominal type.
 *
 * A binding declared in the file being transformed is referenced by its own name. One that is
 * imported must be re-imported under a generated name: TypeScript elides an import whose only use is
 * in a type position, which would leave the hoisted validator calling an undefined binding.
 */
export function createCustomFunctionScope( sourceFile: ts.SourceFile, checker: ts.TypeChecker ): ICustomFunctionScope
{
    const imports: ICustomFunctionImport[] = [];
    const boundByDeclaration = new Map<ts.Declaration, string>();
    const taken = collectBindingNames( sourceFile.statements );

    const bind = ( identity: IFunctionIdentity ): string =>
    {
        const declaration = identity.declaration;
        const kind = declaration && ts.isClassDeclaration( declaration ) ? 'class' : 'function';

        // No declaration means the name came from the type's text; emit it and let tsc judge.
        if( !declaration ){ return identity.name }

        const bound = boundByDeclaration.get( declaration );

        if( bound !== undefined ){ return bound }

        if( !isModuleScoped( declaration ))
        {
            throw new Error( `[Webergency] Custom ${kind} '${identity.name}' must be declared at module scope — generated validators are hoisted to the top of the file and cannot reach a nested binding.` );
        }

        if( declaration.getSourceFile() === sourceFile )
        {
            boundByDeclaration.set( declaration, identity.name );

            return identity.name;
        }

        const source = findImportOf( sourceFile, declaration, checker );

        if( !source )
        {
            throw new Error( `[Webergency] Custom ${kind} '${identity.name}' must be imported directly into this file (a namespace or re-exported binding cannot be re-imported for the generated validator).` );
        }

        let localName = `__tc_fn_${identity.name}`;
        let index = 1;

        while( taken.has( localName )){ localName = `__tc_fn_${identity.name}_${index++}` }

        taken.add( localName );
        imports.push({ localName, importedName : source.importedName, module : source.module });
        boundByDeclaration.set( declaration, localName );

        return localName;
    };

    return { bind, imports };
}

/**
 * A real `class` declaration used as a type — not an interface or type-literal shape. Those stay
 * structural; classes are nominal (`instanceof`) at runtime.
 */
export function resolveClassIdentity( type: ts.Type ): IFunctionIdentity | undefined
{
    const symbol = type.getSymbol() || type.aliasSymbol;

    if( !symbol ){ return undefined }

    // Prefer the value side: an interface merged with a class still has a ClassDeclaration there.
    const declaration = symbol.valueDeclaration
        || symbol.declarations?.find( d => ts.isClassDeclaration( d ))
        || symbol.declarations?.[0];

    if( !declaration || !ts.isClassDeclaration( declaration ) || !declaration.name ){ return undefined }

    // Built-ins handled earlier in the resolver (Date, Promise, typed arrays) also look like classes
    // in lib.d.ts in some targets; callers must check those first.
    return { name : declaration.name.text, declaration };
}
