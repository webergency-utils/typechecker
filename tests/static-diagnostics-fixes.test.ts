import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import transformer from '../src/transformer.js';
import { installStaticConstraintDiagnostics } from '../src/engine/staticAsserts.js';

describe( 'Static Diagnostics Idempotency', () =>
{
    let tempCounter = 0;

    it( 'does not duplicate diagnostics when installStaticConstraintDiagnostics is called repeatedly', () =>
    {
        const tempFile = path.resolve( `./temp_static_idempotent_${process.pid}_${++tempCounter}.ts` );
        const sourceCode = `
            import { constraint } from './src/index.js';
            type Small = number & constraint.Maximum<10>;
            const val: Small = 99;
        `;
        fs.writeFileSync( tempFile, sourceCode );

        try
        {
            const program = ts.createProgram([tempFile], {
                target           : ts.ScriptTarget.ES2022,
                module           : ts.ModuleKind.NodeNext,
                moduleResolution : ts.ModuleResolutionKind.NodeNext,
                skipLibCheck     : true,
                strict           : true
            });

            // Call first time
            const first = installStaticConstraintDiagnostics( program );

            // Call second time
            const second = installStaticConstraintDiagnostics( program );

            expect( first ).toBe( second );

            // Also call transformer multiple times
            transformer( program );
            transformer( program );

            const sourceFile = program.getSourceFile( tempFile );

            if( !sourceFile ){ throw new Error( 'Could not load source file' ) }

            const diags = program.getSemanticDiagnostics( sourceFile )
                .filter( d => d.source === 'webergency-typechecker' );

            expect( diags.length ).toBe( 1 );
            expect( String( diags[0].messageText )).toContain( 'does not satisfy Maximum<10>' );
        }
        finally
        {
            if( fs.existsSync( tempFile ))
            {
                fs.unlinkSync( tempFile );
            }
        }
    });
});
