import ts from 'typescript';
import { collectStaticConstraintDiagnostics } from './engine/staticAsserts.js';

function init( modules: { typescript : typeof ts })
{
    function create( info: ts.server.PluginCreateInfo )
    {
        const proxy = Object.create( null );
        const ls = info.languageService;

        for( const key of Object.keys( ls ))
        {
            ( proxy as any )[key] = ( ls as any )[key];
        }

        proxy.getSemanticDiagnostics = ( fileName: string ): ts.Diagnostic[] =>
        {
            const base = ls.getSemanticDiagnostics( fileName );
            const program = ls.getProgram();

            if( !program ){ return base }

            const sourceFile = program.getSourceFile( fileName );

            if( !sourceFile || sourceFile.isDeclarationFile ){ return base }

            if( fileName.includes( 'node_modules' )){ return base }

            const checker = program.getTypeChecker();
            const extra = collectStaticConstraintDiagnostics( sourceFile, checker );

            return [ ...base, ...extra ];
        };

        return proxy;
    }

    return { create };
}

export default init;
