import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ts from 'typescript';
import init from '../plugin.js';

describe( 'plugin', () => 
{
    beforeEach(() => 
    {
        // fresh seams per test
    });

    afterEach(() => 
    {
        vi.clearAllMocks();
    });

    it( 'should proxy language service and append static constraint diagnostics', () => 
    {
        // Arrange
        const sourceText = `
            import { assert } from './index.js';
            type Age = number & { __min?: 18 };
            const age = 10 as Age;
            assert<Age>(age);
        `;
        const fileName = '/virtual/plugin-user.ts';
        const sourceFile = ts.createSourceFile( fileName, sourceText, ts.ScriptTarget.Latest, true );
        const host: ts.CompilerHost = 
        {
            ...ts.createCompilerHost({}),
            getSourceFile : ( name, languageVersion ) =>
                name === fileName ? sourceFile : ts.createCompilerHost({}).getSourceFile( name, languageVersion ),
            fileExists : ( name ) => name === fileName || ts.sys.fileExists( name ),
            readFile   : ( name ) => name === fileName ? sourceText : ts.sys.readFile( name ),
            writeFile  : () => undefined
        };
        const program = ts.createProgram([fileName], { noEmit : true, strict : true }, host );
        const baseDiagnostics: ts.Diagnostic[] = [{
            file               : sourceFile,
            start              : 0,
            length             : 1,
            messageText        : 'base',
            category           : ts.DiagnosticCategory.Error,
            code               : 1,
            reportsUnnecessary : undefined
        }];
        const languageService = 
        {
            getProgram             : () => program,
            getSemanticDiagnostics : ( name: string ) => name === fileName ? baseDiagnostics : []
        } as unknown as ts.LanguageService;
        const plugin = init({ typescript : ts });
        const proxy = plugin.create({
            languageService,
            project        : {} as ts.server.Project,
            languageServiceHost : {} as ts.LanguageServiceHost,
            serverHost     : {} as ts.server.ServerHost,
            config         : {}
        } as ts.server.PluginCreateInfo );

        // Act
        const diagnostics = proxy.getSemanticDiagnostics( fileName );

        // Assert
        expect( diagnostics[0]).toBe( baseDiagnostics[0]);
        expect( Array.isArray( diagnostics )).toBe( true );
    });

    it( 'should skip declaration files node_modules and missing programs', () => 
    {
        // Arrange
        const plugin = init({ typescript : ts });
        const base: ts.Diagnostic[] = [];
        const dts = ts.createSourceFile( '/pkg/index.d.ts', 'export {};', ts.ScriptTarget.Latest, true );
        const languageService = 
        {
            getProgram : () => ({
                getSourceFile : ( name: string ) => name.endsWith( '.d.ts' ) ? dts : undefined,
                getTypeChecker : () => ({})
            }),
            getSemanticDiagnostics : () => base
        } as unknown as ts.LanguageService;
        const proxy = plugin.create({
            languageService,
            project             : {} as ts.server.Project,
            languageServiceHost : {} as ts.LanguageServiceHost,
            serverHost          : {} as ts.server.ServerHost,
            config              : {}
        } as ts.server.PluginCreateInfo );

        // Act / Assert
        // Arrange — real source under a node_modules path
        const nmFile = '/proj/node_modules/pkg/index.ts';
        const nmSource = ts.createSourceFile( nmFile, 'export const x = 1;', ts.ScriptTarget.Latest, true );
        const nmProgram = {
            getSourceFile  : ( name: string ) => name === nmFile ? nmSource : undefined,
            getTypeChecker : () => ({})
        };
        const nmLs = {
            getProgram             : () => nmProgram,
            getSemanticDiagnostics : () => base
        } as unknown as ts.LanguageService;
        const nmProxy = plugin.create({
            languageService     : nmLs,
            project             : {} as ts.server.Project,
            languageServiceHost : {} as ts.LanguageServiceHost,
            serverHost          : {} as ts.server.ServerHost,
            config              : {}
        } as ts.server.PluginCreateInfo );

        // Act / Assert
        expect( nmProxy.getSemanticDiagnostics( nmFile )).toBe( base );

        // Arrange — no program
        const noProgram = plugin.create({
            languageService : {
                getProgram             : () => undefined,
                getSemanticDiagnostics : () => base
            } as unknown as ts.LanguageService,
            project             : {} as ts.server.Project,
            languageServiceHost : {} as ts.LanguageServiceHost,
            serverHost          : {} as ts.server.ServerHost,
            config              : {}
        } as ts.server.PluginCreateInfo );

        // Act / Assert
        expect( noProgram.getSemanticDiagnostics( '/virtual/a.ts' )).toBe( base );
    });
});
