import ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import transformer from '../../transformer.js';

const COMPILER_OPTIONS: ts.CompilerOptions =
{
    target           : ts.ScriptTarget.ES2022,
    module           : ts.ModuleKind.NodeNext,
    moduleResolution : ts.ModuleResolutionKind.NodeNext,
    strict           : true,
    skipLibCheck     : true
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
