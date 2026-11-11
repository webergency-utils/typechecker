import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';
import transformer from './transformer.js';

export interface TypecheckerBundlerOptions
{
    /** Path to `tsconfig.json` (defaults to `tsconfig.json` in `cwd`). */
    tsconfig?  : string
    /** Working directory used to locate `tsconfig.json` (defaults to `process.cwd()`). */
    cwd?       : string
    /** File filter regex or predicate (defaults to `/\.(?:ts|tsx|mts|cts)$/`). */
    include?   : RegExp | (( id: string ) => boolean )
    /** File exclusion regex or predicate (defaults to `/node_modules/`). */
    exclude?   : RegExp | (( id: string ) => boolean )
    /** When `true`, also transpile TypeScript syntax to JavaScript after AOT macro expansion. */
    transpile? : boolean
}

export interface TransformOutput
{
    code : string
    map? : any
}

export interface BundlerTransformerController
{
    transform     : ( code: string, id: string ) => TransformOutput | null
    invalidate    : ( id?: string ) => void
    getWatchFiles : () => string[]
}

const DEFAULT_INCLUDE_RE = /\.(?:ts|tsx|mts|cts)$/;
const DEFAULT_EXCLUDE_RE = /(?:^|[/\\])node_modules(?:[/\\]|$)/;
const RELATIVE_INDEX_SPECIFIER_RE = /['"]((?:\.\.?\/)+(?:(?:src|dist)\/)?index(?:\.(?:js|cjs|mjs|ts|mts|cts))?)['"]/g;

function matchesFilter( filter: RegExp | (( id: string ) => boolean ), id: string ): boolean
{
    return typeof filter === 'function' ? filter( id ) : filter.test( id );
}

function hasRelativeTypecheckerImport( code: string, cleanId: string ): boolean
{
    RELATIVE_INDEX_SPECIFIER_RE.lastIndex = 0;
    let match: RegExpExecArray | null;

    while(( match = RELATIVE_INDEX_SPECIFIER_RE.exec( code )) !== null )
    {
        const specifier = match[1];
        const dir = path.dirname( path.resolve( cleanId ));
        const targetBase = path.resolve( dir, specifier ).replace( /\.(?:js|cjs|mjs|ts|mts|cts)$/, '' );

        if(
            fs.existsSync( `${targetBase}.ts` ) ||
            fs.existsSync( `${targetBase}.js` ) ||
            fs.existsSync( `${targetBase}.d.ts` )
        )
        {
            const targetDir = path.dirname( targetBase );

            if(
                fs.existsSync( path.join( targetDir, 'runtime', 'validators.ts' )) ||
                fs.existsSync( path.join( targetDir, 'runtime', 'validators.js' )) ||
                fs.existsSync( path.join( targetDir, 'runtime', 'validators.d.ts' ))
            )
            {
                return true;
            }

            continue;
        }

        return true;
    }

    return false;
}

export function shouldTransformFile(
    code    : string,
    id      : string,
    options : TypecheckerBundlerOptions = {}
): boolean
{
    const cleanId = id.split( '?' )[0].replace( /\\/g, '/' );
    const include = options.include ?? DEFAULT_INCLUDE_RE;
    const exclude = options.exclude ?? DEFAULT_EXCLUDE_RE;

    if( !matchesFilter( include, cleanId )){ return false }

    if( matchesFilter( exclude, cleanId )){ return false }

    if( code.includes( 'typechecker' )){ return true }

    return hasRelativeTypecheckerImport( code, cleanId );
}

function loadTsConfig( options: TypecheckerBundlerOptions ): ts.ParsedCommandLine
{
    const cwd = options.cwd ?? process.cwd();
    const configPath = options.tsconfig
        ? path.resolve( cwd, options.tsconfig )
        : ts.findConfigFile( cwd, ts.sys.fileExists, 'tsconfig.json' );

    if( configPath && ts.sys.fileExists( configPath ))
    {
        const configFile = ts.readConfigFile( configPath, ts.sys.readFile );

        if( !configFile.error )
        {
            return ts.parseJsonConfigFileContent(
                configFile.config,
                ts.sys,
                path.dirname( configPath )
            );
        }
    }

    return {
        options : {
            target           : ts.ScriptTarget.ES2022,
            module           : ts.ModuleKind.ESNext,
            moduleResolution : ts.ModuleResolutionKind.Bundler,
            strict           : true
        },
        fileNames : [],
        errors    : []
    };
}

export function createBundlerTransformer(
    options: TypecheckerBundlerOptions = {}
): BundlerTransformerController
{
    const parsedConfig = loadTsConfig( options );
    const compilerOptions: ts.CompilerOptions = {
        ...parsedConfig.options,
        noEmit : false
    };
    const rootFiles = new Set<string>(
        parsedConfig.fileNames.map( f => path.resolve( f ).replace( /\\/g, '/' ))
    );
    const overlays = new Map<string, { code : string, sourceFile : ts.SourceFile }>();
    let cachedProgram: ts.Program | undefined;
    let lastProgram: ts.Program | undefined;

    const baseHost = ts.createCompilerHost( compilerOptions, true );
    const origGetSourceFile = baseHost.getSourceFile.bind( baseHost );
    const origFileExists = baseHost.fileExists.bind( baseHost );
    const origReadFile = baseHost.readFile.bind( baseHost );

    baseHost.fileExists = ( fileName: string ): boolean =>
    {
        const norm = path.resolve( fileName ).replace( /\\/g, '/' );

        return overlays.has( norm ) || origFileExists( fileName );
    };

    baseHost.readFile = ( fileName: string ): string | undefined =>
    {
        const norm = path.resolve( fileName ).replace( /\\/g, '/' );
        const overlay = overlays.get( norm );

        if( overlay ){ return overlay.code }

        return origReadFile( fileName );
    };

    baseHost.getSourceFile = ( fileName, languageVersion, onError, shouldCreateNewSourceFile ) =>
    {
        const norm = path.resolve( fileName ).replace( /\\/g, '/' );
        const overlay = overlays.get( norm );

        if( overlay ){ return overlay.sourceFile }

        return origGetSourceFile( fileName, languageVersion, onError, shouldCreateNewSourceFile );
    };

    const invalidate = ( id?: string ): void =>
    {
        if( id )
        {
            const norm = path.resolve( id.split( '?' )[0]).replace( /\\/g, '/' );
            overlays.delete( norm );
        }
        else
        {
            overlays.clear();
        }

        cachedProgram = undefined;
    };

    const getWatchFiles = (): string[] =>
    {
        const prog = cachedProgram ?? lastProgram;

        if( !prog ){ return [] }

        const watched: string[] = [];

        for( const sf of prog.getSourceFiles())
        {
            if( sf.fileName.includes( 'node_modules' )){ continue }

            watched.push( sf.fileName );
        }

        return watched;
    };

    const transform = ( code: string, id: string ): TransformOutput | null =>
    {
        if( !shouldTransformFile( code, id, options )){ return null }

        const cleanId = path.resolve( id.split( '?' )[0]).replace( /\\/g, '/' );
        const prev = overlays.get( cleanId );

        if( !prev || prev.code !== code )
        {
            const sf = ts.createSourceFile(
                cleanId,
                code,
                compilerOptions.target ?? ts.ScriptTarget.Latest,
                true
            );
            overlays.set( cleanId, { code, sourceFile : sf });
            rootFiles.add( cleanId );
            cachedProgram = undefined;
        }

        if( !cachedProgram )
        {
            cachedProgram = ts.createProgram({
                rootNames  : [ ...rootFiles ],
                options    : compilerOptions,
                host       : baseHost,
                oldProgram : lastProgram
            });
            lastProgram = cachedProgram;
        }

        const sourceFile = cachedProgram.getSourceFile( cleanId );

        if( !sourceFile ){ return null }

        const transformResult = ts.transform(
            sourceFile,
            [ transformer( cachedProgram, { skipDiagnostics : true }) ],
            compilerOptions
        );
        const transformedSf = transformResult.transformed[0] as ts.SourceFile;
        transformResult.dispose();

        const printer = ts.createPrinter({ newLine : ts.NewLineKind.LineFeed });
        const printed = printer.printFile( transformedSf );

        if( printed === code ){ return null }

        if( options.transpile )
        {
            const transpiled = ts.transpileModule( printed, {
                compilerOptions : {
                    ...compilerOptions,
                    module    : ts.ModuleKind.ESNext,
                    sourceMap : true
                },
                fileName : cleanId
            });

            return {
                code : transpiled.outputText,
                map  : transpiled.sourceMapText ? JSON.parse( transpiled.sourceMapText ) : null
            };
        }

        return { code : printed, map : null };
    };

    return { transform, invalidate, getWatchFiles };
}

function addPluginWatchFiles( pluginCtx: any, controller: BundlerTransformerController ): void
{
    if( typeof pluginCtx?.addWatchFile !== 'function' ){ return }

    for( const dep of controller.getWatchFiles())
    {
        pluginCtx.addWatchFile( dep );
    }
}

function resolveWebpackLoaderPath(): string
{
    const currentDir = typeof __dirname === 'string'
        ? __dirname
        : path.dirname( fileURLToPath( import.meta.url ));
    const cjsCandidate = path.join( currentDir, 'webpack-loader.cjs' );

    if( fs.existsSync( cjsCandidate )){ return cjsCandidate }

    const jsCandidate = path.join( currentDir, 'webpack-loader.js' );

    if( fs.existsSync( jsCandidate )){ return jsCandidate }

    return path.join( currentDir, 'webpack-loader.ts' );
}

/** Vite / Vitest plugin for ahead-of-time `@webergency-utils/typechecker` macro expansion. */
export function typecheckerVite( options: TypecheckerBundlerOptions = {})
{
    const controller = createBundlerTransformer( options );

    return {
        name    : 'webergency-typechecker',
        enforce : 'pre' as const,
        transform( this: any, code: string, id: string )
        {
            const res = controller.transform( code, id );

            if( res ){ addPluginWatchFiles( this, controller ) }

            return res;
        },
        handleHotUpdate( ctx: { file : string })
        {
            controller.invalidate( ctx.file );
        }
    };
}

/** Rollup plugin for ahead-of-time `@webergency-utils/typechecker` macro expansion. */
export function typecheckerRollup( options: TypecheckerBundlerOptions = {})
{
    const controller = createBundlerTransformer( options );

    return {
        name : 'webergency-typechecker',
        transform( this: any, code: string, id: string )
        {
            const res = controller.transform( code, id );

            if( res ){ addPluginWatchFiles( this, controller ) }

            return res;
        },
        watchChange( id: string )
        {
            controller.invalidate( id );
        }
    };
}

/** esbuild plugin for ahead-of-time `@webergency-utils/typechecker` macro expansion. */
export function typecheckerEsbuild( options: TypecheckerBundlerOptions = {})
{
    const controller = createBundlerTransformer( options );
    const filter = options.include instanceof RegExp ? options.include : DEFAULT_INCLUDE_RE;

    return {
        name : 'webergency-typechecker',
        setup( build: { onLoad : ( opts: { filter : RegExp }, cb: ( args: { path : string }) => any ) => void })
        {
            build.onLoad({ filter }, ( args: { path : string }) =>
            {
                const raw = fs.readFileSync( args.path, 'utf8' );
                const res = controller.transform( raw, args.path );

                if( !res ){ return null }

                const ext = path.extname( args.path ).toLowerCase();
                const loader = ext === '.tsx' ? 'tsx' : 'ts';

                return {
                    contents   : res.code,
                    loader,
                    watchFiles : controller.getWatchFiles()
                };
            });
        }
    };
}

/** Webpack / Rspack plugin for ahead-of-time `@webergency-utils/typechecker` macro expansion. */
export function typecheckerWebpack( options: TypecheckerBundlerOptions = {})
{
    const controller = createBundlerTransformer( options );
    const include = options.include ?? DEFAULT_INCLUDE_RE;
    const exclude = options.exclude ?? DEFAULT_EXCLUDE_RE;

    return {
        name : 'webergency-typechecker',
        apply( compiler: any )
        {
            compiler.options = compiler.options || {};
            compiler.options.module = compiler.options.module || {};
            compiler.options.module.rules = compiler.options.module.rules || [];
            compiler.options.module.rules.unshift({
                test    : include,
                exclude,
                enforce : 'pre',
                use     : [
                    {
                        loader  : resolveWebpackLoaderPath(),
                        options : { controller }
                    }
                ]
            });

            compiler.hooks?.watchRun?.tap( 'webergency-typechecker', ( comp: any ) =>
            {
                const modified: Iterable<string> | undefined = comp?.modifiedFiles;
                const removed: Iterable<string> | undefined = comp?.removedFiles;
                let invalidatedSpecific = false;

                if( modified )
                {
                    for( const f of modified )
                    {
                        controller.invalidate( f );
                        invalidatedSpecific = true;
                    }
                }

                if( removed )
                {
                    for( const f of removed )
                    {
                        controller.invalidate( f );
                        invalidatedSpecific = true;
                    }
                }

                if( !invalidatedSpecific )
                {
                    controller.invalidate();
                }
            });
        },
        transform( code: string, id: string )
        {
            return controller.transform( code, id );
        }
    };
}

export const typecheckerPlugin = Object.assign(
    ( options: TypecheckerBundlerOptions = {}) => typecheckerVite( options ),
    {
        vite    : typecheckerVite,
        rollup  : typecheckerRollup,
        esbuild : typecheckerEsbuild,
        webpack : typecheckerWebpack,
        raw     : createBundlerTransformer
    }
);

export default typecheckerPlugin;
