import ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';
import transformerSource from '../../src/transformer.js';

const require = createRequire( import.meta.url );

const COMPILER_OPTIONS: ts.CompilerOptions =
{
    target           : ts.ScriptTarget.ES2022,
    module           : ts.ModuleKind.NodeNext,
    moduleResolution : ts.ModuleResolutionKind.NodeNext,
    strict           : true,
    skipLibCheck     : true,
    types            : ['node']
};

const distEsmTransformerPath = path.resolve( './dist/transformer.js' );
const distCjsTransformerPath = path.resolve( './dist/transformer.cjs' );

/**
 * Get transformer instance from built ESM artifact (dist/transformer.js) if present.
 */
export function getEsmTransformer( program: ts.Program ): ( context: ts.TransformationContext ) => ( sourceFile: ts.SourceFile ) => ts.SourceFile
{
    if( fs.existsSync( distEsmTransformerPath ))
    {
        const mod = require( distEsmTransformerPath );
        const fn = mod.default || mod.transformer || mod;

        return fn( program );
    }

    return transformerSource( program );
}

/**
 * Get transformer instance from built CJS artifact (dist/transformer.cjs) if present.
 */
export function getCjsTransformer( program: ts.Program ): ( context: ts.TransformationContext ) => ( sourceFile: ts.SourceFile ) => ts.SourceFile
{
    if( fs.existsSync( distCjsTransformerPath ))
    {
        const mod = require( distCjsTransformerPath );
        const fn = mod.default || mod.transformer || mod;

        return fn( program );
    }

    return transformerSource( program );
}

const defaultHost = ts.createCompilerHost( COMPILER_OPTIONS );
const libSourceFileCache = new Map<string, ts.SourceFile>();

export function getCachedCompilerHost(
    options: ts.CompilerOptions,
    virtualFiles?: Map<string, string>
): ts.CompilerHost
{
    const baseHost = options === COMPILER_OPTIONS ? defaultHost : ts.createCompilerHost( options );

    return {
        ...baseHost,
        getSourceFile( fileName, languageVersion, onError, shouldCreateNewSourceFile )
        {
            if( virtualFiles && virtualFiles.has( fileName ))
            {
                return ts.createSourceFile( fileName, virtualFiles.get( fileName )!, languageVersion, true );
            }

            if( fileName.includes( 'node_modules/typescript/lib/' ))
            {
                let cached = libSourceFileCache.get( fileName );

                if( !cached )
                {
                    cached = baseHost.getSourceFile( fileName, languageVersion, onError, shouldCreateNewSourceFile );

                    if( cached )
                    {
                        libSourceFileCache.set( fileName, cached );
                    }
                }

                return cached;
            }

            return baseHost.getSourceFile( fileName, languageVersion, onError, shouldCreateNewSourceFile );
        },
        fileExists( fileName )
        {
            if( virtualFiles && virtualFiles.has( fileName )){ return true }

            return baseHost.fileExists( fileName );
        },
        readFile( fileName )
        {
            if( virtualFiles && virtualFiles.has( fileName )){ return virtualFiles.get( fileName )! }

            return baseHost.readFile( fileName );
        }
    };
}

/**
 * Transform a snippet and print the result using the built transformer.
 */
export function compileAndTransform( sourceCode: string, tempName: string, mode: 'esm' | 'cjs' = 'esm' ): string
{
    const file = path.resolve( `./${tempName}.ts` );
    const virtualFiles = new Map<string, string>();
    virtualFiles.set( file, sourceCode );

    const opts = mode === 'cjs'
        ? {
            target           : ts.ScriptTarget.ES2022,
            module           : ts.ModuleKind.CommonJS,
            moduleResolution : ts.ModuleResolutionKind.Node10,
            strict           : true,
            skipLibCheck     : true,
            types            : ['node']
        }
        : COMPILER_OPTIONS;

    const host = getCachedCompilerHost( opts, virtualFiles );
    const program = ts.createProgram([file], opts, host );
    const sourceFile = program.getSourceFile( file );

    if( !sourceFile ){ throw new Error( `Could not load ${file}` ) }

    const tf = mode === 'cjs' ? getCjsTransformer( program ) : getEsmTransformer( program );
    const result = ts.transform( sourceFile, [tf]);

    return ts.createPrinter().printFile( result.transformed[0]);
}

/**
 * Run `main.ts` through the real emit pipeline using built dist transformer artifacts.
 */
export function emitWithTransformer(
    files: Record<string, string>,
    tempName: string,
    mode: 'esm' | 'cjs' = 'esm'
): string
{
    const dir = path.resolve( `./${tempName}` );

    fs.mkdirSync( dir, { recursive : true });

    const opts: ts.CompilerOptions = mode === 'cjs'
        ? {
            target           : ts.ScriptTarget.ES2022,
            module           : ts.ModuleKind.CommonJS,
            moduleResolution : ts.ModuleResolutionKind.Node10,
            strict           : true,
            skipLibCheck     : true,
            types            : ['node']
        }
        : COMPILER_OPTIONS;

    try
    {
        for( const [name, text] of Object.entries( files ))
        {
            fs.writeFileSync( path.join( dir, name ), text );
        }

        const entry = path.join( dir, 'main.ts' );
        const host = getCachedCompilerHost( opts );
        const program = ts.createProgram([entry], opts, host );
        let output = '';
        const tf = mode === 'cjs' ? getCjsTransformer( program ) : getEsmTransformer( program );

        program.emit(
            program.getSourceFile( entry ),
            ( _fileName, text ) => { output = text },
            undefined,
            false,
            { before : [tf]}
        );

        return output;
    }
    finally
    {
        fs.rmSync( dir, { recursive : true, force : true });
    }
}

/**
 * Emit `source` (a `main.ts` body) through the transformer using ESM built artifacts (dist/index.js),
 * and dynamically import the result.
 */
export async function emitAndImport<T extends Record<string, unknown> = Record<string, unknown>>(
    source: string,
    tempName: string
): Promise<T>
{
    const dir = path.resolve( `./${tempName}_pkg` );
    const runtimeDist = path.resolve( './dist/runtime/index.js' );
    const indexDist = path.resolve( './dist/index.js' );

    if( !fs.existsSync( runtimeDist ))
    {
        throw new Error( 'emitAndImport requires dist/ — run `npm run build` first.' );
    }

    fs.mkdirSync( dir, { recursive : true });

    try
    {
        const output = emitWithTransformer({ 'main.ts' : source }, `${tempName}_src`, 'esm' );
        const patched = output
            .replace( '@webergency-utils/typechecker/runtime', pathToFileURL( runtimeDist ).href )
            .replace( /from ['"]\.\.\/src\/index(?:\.js)?['"]/g, `from '${pathToFileURL( indexDist ).href}'` )
            .replace( /from ['"]\.\/src\/index(?:\.js)?['"]/g, `from '${pathToFileURL( indexDist ).href}'` );
        const file = path.join( dir, 'main.js' );
        fs.writeFileSync( file, patched );

        return await import( pathToFileURL( file ).href + '?t=' + Date.now()) as T;
    }
    finally
    {
        fs.rmSync( dir, { recursive : true, force : true });
    }
}

/**
 * Emit `source` (a `main.ts` body) through the transformer using CommonJS built artifacts (dist/index.cjs),
 * and require the result.
 */
export function emitAndRequire<T extends Record<string, unknown> = Record<string, unknown>>(
    source: string,
    tempName: string
): T
{
    const dir = path.resolve( `./${tempName}_cjs_pkg` );
    const runtimeDistCjs = path.resolve( './dist/runtime/index.cjs' );
    const indexDistCjs = path.resolve( './dist/index.cjs' );

    if( !fs.existsSync( runtimeDistCjs ))
    {
        throw new Error( 'emitAndRequire requires dist/ — run `npm run build` first.' );
    }

    fs.mkdirSync( dir, { recursive : true });

    try
    {
        const output = emitWithTransformer({ 'main.ts' : source }, `${tempName}_cjs_src`, 'cjs' );
        const patched = output
            .replace( /require\(['"]@webergency-utils\/typechecker\/runtime['"]\)/g, `require('${runtimeDistCjs}')` )
            .replace( /require\(['"]\.\.\/src\/index(?:\.js)?['"]\)/g, `require('${indexDistCjs}')` )
            .replace( /require\(['"]\.\/src\/index(?:\.js)?['"]\)/g, `require('${indexDistCjs}')` )
            .replace( /require\(['"]@webergency-utils\/typechecker['"]\)/g, `require('${indexDistCjs}')` );
        const file = path.join( dir, 'main.cjs' );

        fs.writeFileSync( file, patched );

        delete require.cache[require.resolve( file )];

        return require( file ) as T;
    }
    finally
    {
        fs.rmSync( dir, { recursive : true, force : true });
    }
}
