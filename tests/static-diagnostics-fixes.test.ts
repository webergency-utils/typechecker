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

    function diagnosticsFor( sourceCode: string ): { diags : ts.Diagnostic[], sourceFile : ts.SourceFile }
    {
        const tempFile = path.resolve( `./temp_static_fixes_${process.pid}_${++tempCounter}.ts` );
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

            transformer( program );

            const sourceFile = program.getSourceFile( tempFile );

            if( !sourceFile ){ throw new Error( 'Could not load source file' ) }

            const diags = program.getSemanticDiagnostics( sourceFile )
                .filter( d => d.source === 'webergency-typechecker' );

            return { diags, sourceFile };
        }
        finally
        {
            if( fs.existsSync( tempFile ))
            {
                fs.unlinkSync( tempFile );
            }
        }
    }

    it( 'reports diagnostics on satisfies and as assertions including as const inside satisfies', () =>
    {
        const { diags } = diagnosticsFor( `
            import { constraint } from './src/index.js';
            interface User {
                age  : number & constraint.Minimum<18>;
                name : string & constraint.MinLength<3>;
            }
            const u1 = { age : 12, name : 'Al' } satisfies User;
            const u2 = ( { age : 15, name : 'Bo' } as const ) satisfies User;
            const n1 = 5 as ( number & constraint.Minimum<10> );
            const ok = { age : 25, name : 'Alice' } satisfies User;
        ` );

        const msgs = diags.map( d => String( d.messageText ));
        expect( msgs.filter( m => m.includes( 'Minimum<18>' ))).toHaveLength( 2 );
        expect( msgs.filter( m => m.includes( 'MinLength<3>' ))).toHaveLength( 2 );
        expect( msgs.filter( m => m.includes( 'Minimum<10>' ))).toHaveLength( 1 );
        expect( diags ).toHaveLength( 5 );
    });

    it( 'reports diagnostics on explicit return statements and expression-bodied arrows', () =>
    {
        const { diags } = diagnosticsFor( `
            import { constraint } from './src/index.js';
            interface User {
                age : number & constraint.Minimum<18>;
            }
            function makeUser(): User
            {
                const helper = () => ({ age : 1 });
                void helper;
                return { age : 10 };
            }
            const arrowUser = (): User => ({ age : 12 });
            async function asyncUser(): Promise<User>
            {
                return { age : 14 };
            }
            function validUser(): User
            {
                return { age : 21 };
            }
        ` );

        const msgs = diags.map( d => String( d.messageText ));
        expect( msgs ).toEqual([
            'Value 10 does not satisfy Minimum<18>',
            'Value 12 does not satisfy Minimum<18>',
            'Value 14 does not satisfy Minimum<18>'
        ]);
    });

    it( 'reports diagnostics on AOT macro call arguments with explicit type arguments', () =>
    {
        const { diags } = diagnosticsFor( `
            import { is, assert, assertGuard, validate, stringify, constraint } from './src/index.js';
            import * as tc from './src/index.js';
            interface Item {
                count : number & constraint.Minimum<5>;
            }
            is<Item>({ count : 1 });
            assert<Item>({ count : 2 });
            assertGuard<Item>({ count : 3 });
            validate<Item>({ count : 4 });
            stringify<Item>({ count : 0 });
            tc.assert<number & constraint.Minimum<10>>( 7 );
            assert<Item>({ count : 9 });
        ` );

        const msgs = diags.map( d => String( d.messageText ));
        expect( msgs ).toEqual([
            'Value 1 does not satisfy Minimum<5>',
            'Value 2 does not satisfy Minimum<5>',
            'Value 3 does not satisfy Minimum<5>',
            'Value 4 does not satisfy Minimum<5>',
            'Value 0 does not satisfy Minimum<5>',
            'Value 7 does not satisfy Minimum<10>'
        ]);
    });

    it( 'reports diagnostics on array and tuple element literals and nested objects', () =>
    {
        const { diags } = diagnosticsFor( `
            import { constraint } from './src/index.js';
            type ScoreList = ( number & constraint.Minimum<10> )[] & constraint.MinItems<2>;
            type Pair = [ number & constraint.Minimum<10>, string & constraint.MinLength<3> ];
            interface Group {
                members : { age : number & constraint.Minimum<18> }[];
            }

            const scores: ScoreList = [ 5 ];
            const pair: Pair = [ 3, 'a' ];
            const group: Group = { members : [ { age : 12 }, { age : 22 } ] };
        ` );

        const msgs = diags.map( d => String( d.messageText ));
        expect( msgs ).toContain( 'Array length 1 does not satisfy MinItems<2>' );
        expect( msgs ).toContain( 'Value 5 does not satisfy Minimum<10>' );
        expect( msgs ).toContain( 'Value 3 does not satisfy Minimum<10>' );
        expect( msgs ).toContain( 'Value length 1 does not satisfy MinLength<3>' );
        expect( msgs ).toContain( 'Value 12 does not satisfy Minimum<18>' );
        expect( diags ).toHaveLength( 5 );
    });

    it( 'reports diagnostics on const shorthand object properties anchored at the shorthand property and ignores let/var/dynamic', () =>
    {
        const sourceCode = `
            import { constraint } from './src/index.js';
            interface User {
                age  : number & constraint.Minimum<18>;
                name : string & constraint.MinLength<3>;
            }
            const age = 10;
            let name = 'a';
            const badUser: User = { age, name };

            var mutableAge = 5;
            const okMutable: { age : number & constraint.Minimum<18> } = { age : mutableAge };
        `;
        const { diags, sourceFile } = diagnosticsFor( sourceCode );

        expect( diags ).toHaveLength( 1 );
        expect( String( diags[0].messageText )).toContain( 'Value 10 does not satisfy Minimum<18>' );

        const highlighted = sourceFile.text.slice( diags[0].start!, diags[0].start! + diags[0].length! );
        expect( highlighted ).toBe( 'age' );
        expect( sourceFile.text.slice( diags[0].start! - 2, diags[0].start! + diags[0].length! + 2 )).toBe( '{ age, ' );
    });

    it( 'unwraps Promise<T> on async expression-bodied arrow functions and handles non-integer numbers against MultipleOf<bigint> without throwing RangeError', () =>
    {
        const { diags } = diagnosticsFor( `
            import { constraint } from './src/index.js';
            const asyncArrowBad = async (): Promise<number & constraint.Minimum<10>> => 5;
            const asyncArrowOk = async (): Promise<number & constraint.Minimum<10>> => 15;
            const floatBigMult: number & constraint.MultipleOf<2n> = 1.5;
        ` );

        expect( diags ).toHaveLength( 2 );
        expect( String( diags[0].messageText )).toContain( 'Value 5 does not satisfy Minimum<10>' );
        expect( String( diags[1].messageText )).toContain( 'Value 1.5 does not satisfy MultipleOf<2>' );
    });
});

