import ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import transformer from '../../transformer.js';

const COMPILER_OPTIONS: ts.CompilerOptions =
{
    target           : ts.ScriptTarget.ES2022,
    module           : ts.ModuleKind.NodeNext,
    moduleResolution : ts.ModuleResolutionKind.NodeNext,
    strict           : true,
    skipLibCheck     : true,
    // ResolveDefaults references `Buffer`; without node types the whole alias collapses to `any`.
    types            : ['node']
};

/**
 * Transform a snippet and print the result. Each caller needs its own `tempName`, since test files
 * run in parallel and share the package root as their working directory.
 */
export function compileAndTransform( sourceCode: string, tempName: string ): string
{
    const file = path.resolve( `./${tempName}.ts` );

    fs.writeFileSync( file, sourceCode );

    try
    {
        const program = ts.createProgram([file], COMPILER_OPTIONS );
        const sourceFile = program.getSourceFile( file );

        if( !sourceFile ){ throw new Error( `Could not load ${file}` ) }

        const result = ts.transform( sourceFile, [transformer( program )]);

        return ts.createPrinter().printFile( result.transformed[0]);
    }
    finally
    {
        if( fs.existsSync( file )){ fs.unlinkSync( file ) }
    }
}

/**
 * Run `main.ts` through the real emit pipeline and return the emitted JavaScript. Unlike
 * `compileAndTransform`, this exercises TypeScript's own passes — notably import elision, which runs
 * after ours and is invisible when printing the transformed AST.
 */
export function emitWithTransformer( files: Record<string, string>, tempName: string ): string
{
    const dir = path.resolve( `./${tempName}` );

    fs.mkdirSync( dir, { recursive : true });

    try
    {
        for( const [name, text] of Object.entries( files ))
        {
            fs.writeFileSync( path.join( dir, name ), text );
        }

        const entry = path.join( dir, 'main.ts' );
        const program = ts.createProgram([entry], COMPILER_OPTIONS );
        let output = '';

        program.emit(
            program.getSourceFile( entry ),
            ( _fileName, text ) => { output = text },
            undefined,
            false,
            { before : [transformer( program )]}
        );

        return output;
    }
    finally
    {
        fs.rmSync( dir, { recursive : true, force : true });
    }
}

/**
 * Emit `source` (a `main.ts` body) through the transformer, rewrite runtime imports to the
 * built `dist/` tree, and dynamically import the result. Requires `npm run build` first.
 * Each caller needs its own `tempName` — tests run in parallel from the package root.
 */
export async function emitAndImport<T extends Record<string, unknown> = Record<string, unknown>>(
    source: string,
    tempName: string
): Promise<T>
{
    const dir = path.resolve( `./${tempName}_pkg` );

    fs.mkdirSync( dir, { recursive : true });

    try
    {
        const output = emitWithTransformer({ 'main.ts' : source }, `${tempName}_src` );
        const patched = output
            .replace( '@webergency-utils/typechecker/runtime', '../dist/runtime/validators.js' )
            .replace( /from ['"]\.\.\/src\/index\.js['"]/, "from '../dist/index.js'" );
        const file = path.join( dir, 'main.js' );

        fs.writeFileSync( file, patched );

        return await import( pathToFileURL( file ).href + '?t=' + Date.now()) as T;
    }
    finally
    {
        fs.rmSync( dir, { recursive : true, force : true });
    }
}
