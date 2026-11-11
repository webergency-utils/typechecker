import ts from 'typescript';
import { collectStaticConstraintDiagnostics, collectCodeFixesAtPosition } from './transformer.js';

function resolvePluginContext( ls: ts.LanguageService, fileName: string )
{
    if( fileName.includes( 'node_modules' )){ return undefined }

    const program = ls.getProgram();

    if( !program ){ return undefined }

    const sourceFile = program.getSourceFile( fileName );

    if( !sourceFile || sourceFile.isDeclarationFile ){ return undefined }

    return { sourceFile, checker : program.getTypeChecker() };
}

function init( modules: { typescript : typeof ts })
{
    function create( info: ts.server.PluginCreateInfo )
    {
        const proxy = Object.create( null );
        const ls = info.languageService;

        for( const key of Object.keys( ls ))
        {
            const member = ( ls as any )[key];
            ( proxy as any )[key] = typeof member === 'function' ? member.bind( ls ) : member;
        }

        proxy.getSemanticDiagnostics = ( fileName: string ): ts.Diagnostic[] =>
        {
            const base = ls.getSemanticDiagnostics( fileName );
            const ctx = resolvePluginContext( ls, fileName );

            if( !ctx ){ return base }

            const extra = collectStaticConstraintDiagnostics( ctx.sourceFile, ctx.checker );

            return [ ...base, ...extra ];
        };

        proxy.getCodeFixesAtPosition = (
            fileName      : string,
            start         : number,
            end           : number,
            errorCodes    : readonly number[],
            formatOptions : ts.FormatCodeSettings,
            preferences   : ts.UserPreferences
        ): readonly ts.CodeFixAction[] =>
        {
            const base = typeof ls.getCodeFixesAtPosition === 'function'
                ? ls.getCodeFixesAtPosition( fileName, start, end, errorCodes, formatOptions, preferences )
                : [];
            const ctx = resolvePluginContext( ls, fileName );

            if( !ctx ){ return base }

            const extra = collectCodeFixesAtPosition( ctx.sourceFile, start, end, errorCodes, ctx.checker );

            return extra.length > 0 ? [ ...base, ...extra ] : base;
        };

        return proxy;
    }

    return { create };
}

export default init;
