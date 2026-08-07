import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import transformer from '../src/transformer.js';
import {
    extractStaticConstraints,
    evaluateStaticConstraints,
    tryGetConstantValue
} from '../src/engine/staticAsserts.js';

describe( 'Static constraint diagnostics', () => 
{
    let tempCounter = 0;

    function diagnosticsFor( sourceCode: string ): ts.Diagnostic[] 
    {
        const tempFile = path.resolve( `./temp_static_assert_${process.pid}_${++tempCounter}.ts` );
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

            return program.getSemanticDiagnostics( sourceFile ).filter( d => d.source === 'webergency-typechecker' );
        }
        finally 
        {
            if( fs.existsSync( tempFile )) 
            {
                fs.unlinkSync( tempFile );
            }
        }
    }

    function messages( diags: ts.Diagnostic[]): string[] 
    {
        return diags.map( d => String( d.messageText ));
    }

    function expectError( sourceCode: string, ...substrings: string[]) 
    {
        const diags = diagnosticsFor( sourceCode );
        const msgs = messages( diags );

        expect( diags.length, `expected diagnostics, got none for:\n${sourceCode}` ).toBeGreaterThan( 0 );

        for( const sub of substrings )
        {
            expect( msgs.some( m => m.includes( sub )), `expected a message containing "${sub}", got: ${JSON.stringify( msgs )}` ).toBe( true );
        }
    }

    function expectOk( sourceCode: string ) 
    {
        const diags = diagnosticsFor( sourceCode );

        expect( messages( diags ), `expected no diagnostics, got: ${JSON.stringify( messages( diags ))}` ).toEqual([]);
    }

    describe( 'numeric bounds', () => 
    {
        it( 'rejects below Minimum and accepts at/above bound', () => 
        {
            expectError( `
                import { constraint } from './src/index.js';
                const age: number & constraint.Minimum<18> = 5;
            `, 'Minimum<18>' );

            expectOk( `
                import { constraint } from './src/index.js';
                const age: number & constraint.Minimum<18> = 18;
                const older: number & constraint.Minimum<18> = 99;
            ` );
        });

        it( 'rejects above Maximum', () => 
        {
            expectError( `
                import { constraint } from './src/index.js';
                const n: number & constraint.Maximum<10> = 11;
            `, 'Maximum<10>' );

            expectOk( `
                import { constraint } from './src/index.js';
                const n: number & constraint.Maximum<10> = 10;
            ` );
        });

        it( 'rejects ExclusiveMinimum / ExclusiveMaximum at the bound', () => 
        {
            expectError( `
                import { constraint } from './src/index.js';
                const n: number & constraint.ExclusiveMinimum<0> = 0;
            `, 'ExclusiveMinimum<0>' );

            expectError( `
                import { constraint } from './src/index.js';
                const n: number & constraint.ExclusiveMaximum<10> = 10;
            `, 'ExclusiveMaximum<10>' );

            expectOk( `
                import { constraint } from './src/index.js';
                const a: number & constraint.ExclusiveMinimum<0> = 1;
                const b: number & constraint.ExclusiveMaximum<10> = 9;
            ` );
        });

        it( 'rejects MultipleOf violations', () => 
        {
            expectError( `
                import { constraint } from './src/index.js';
                const n: number & constraint.MultipleOf<5> = 7;
            `, 'MultipleOf<5>' );

            expectOk( `
                import { constraint } from './src/index.js';
                const n: number & constraint.MultipleOf<5> = 15;
            ` );
        });

        it( 'checks Range composite (Minimum & Maximum)', () => 
        {
            expectError( `
                import { constraint } from './src/index.js';
                const n: number & constraint.Range<1, 10> = 0;
            `, 'Minimum<1>' );

            expectError( `
                import { constraint } from './src/index.js';
                const n: number & constraint.Range<1, 10> = 11;
            `, 'Maximum<10>' );

            expectOk( `
                import { constraint } from './src/index.js';
                const n: number & constraint.Range<1, 10> = 5;
            ` );
        });

        it( 'handles negative numeric literals', () => 
        {
            expectError( `
                import { constraint } from './src/index.js';
                const n: number & constraint.Minimum<-5> = -6;
            `, 'Minimum<-5>' );

            expectOk( `
                import { constraint } from './src/index.js';
                const n: number & constraint.Minimum<-5> = -5;
            ` );
        });
    });

    describe( 'string length', () => 
    {
        it( 'rejects MinLength / MaxLength / Length violations', () => 
        {
            expectError( `
                import { constraint } from './src/index.js';
                const s: string & constraint.MinLength<3> = 'ab';
            `, 'MinLength<3>' );

            expectError( `
                import { constraint } from './src/index.js';
                const s: string & constraint.MaxLength<2> = 'abc';
            `, 'MaxLength<2>' );

            expectError( `
                import { constraint } from './src/index.js';
                const s: string & constraint.Length<2, 4> = 'a';
            `, 'MinLength<2>' );

            expectError( `
                import { constraint } from './src/index.js';
                const s: string & constraint.Length<2, 4> = 'abcde';
            `, 'MaxLength<4>' );

            expectOk( `
                import { constraint } from './src/index.js';
                const a: string & constraint.MinLength<3> = 'abc';
                const b: string & constraint.MaxLength<2> = 'ab';
                const c: string & constraint.Length<2, 4> = 'abc';
            ` );
        });
    });

    describe( 'array items', () => 
    {
        it( 'rejects MinItems / MaxItems / UniqueItems violations', () => 
        {
            expectError( `
                import { constraint } from './src/index.js';
                const a: string[] & constraint.MinItems<2> = ['a'];
            `, 'MinItems<2>' );

            expectError( `
                import { constraint } from './src/index.js';
                const a: string[] & constraint.MaxItems<1> = ['a', 'b'];
            `, 'MaxItems<1>' );

            expectError( `
                import { constraint } from './src/index.js';
                const a: number[] & constraint.UniqueItems = [1, 1];
            `, 'UniqueItems' );

            expectOk( `
                import { constraint } from './src/index.js';
                const a: string[] & constraint.MinItems<2> = ['a', 'b'];
                const b: string[] & constraint.MaxItems<1> = ['a'];
                const c: number[] & constraint.UniqueItems = [1, 2];
            ` );
        });

        it( 'ignores arrays with spread elements (not constant)', () => 
        {
            expectOk( `
                import { constraint } from './src/index.js';
                declare const rest: string[];
                const a: string[] & constraint.MinItems<5> = ['a', ...rest];
            ` );
        });
    });

    describe( 'object key count', () =>
    {
        it( 'rejects MinProperties / MaxProperties violations on object literals', () =>
        {
            expectError( `
                import { constraint } from './src/index.js';
                const a: Record<string, number> & constraint.MinProperties<2> = { a : 1 };
            `, 'MinProperties<2>' );

            expectError( `
                import { constraint } from './src/index.js';
                const a: Record<string, number> & constraint.MaxProperties<1> = { a : 1, b : 2 };
            `, 'MaxProperties' );

            expectOk( `
                import { constraint } from './src/index.js';
                const a: Record<string, number> & constraint.MinProperties<2> & constraint.MaxProperties<3> =
                    { a : 1, b : 2 };
                const b: Record<string, number> & constraint.PropertiesRange<1, 2> = { x : 1 };
            ` );
        });
    });

    describe( 'object / nested / aliases', () => 
    {
        it( 'checks object literal properties against tagged fields', () => 
        {
            expectError( `
                import { constraint } from './src/index.js';
                interface User {
                    age: number & constraint.Minimum<18>;
                    name: string & constraint.MinLength<2>;
                }
                const user: User = { age: 10, name: 'x' };
            `, 'Minimum<18>', 'MinLength<2>' );

            expectOk( `
                import { constraint } from './src/index.js';
                interface User {
                    age: number & constraint.Minimum<18>;
                    name: string & constraint.MinLength<2>;
                }
                const user: User = { age: 18, name: 'ab' };
            ` );
        });

        it( 'checks nested object literals', () => 
        {
            expectError( `
                import { constraint } from './src/index.js';
                interface Profile {
                    meta: {
                        score: number & constraint.Maximum<100>;
                    };
                }
                const p: Profile = { meta: { score: 101 } };
            `, 'Maximum<100>' );
        });

        it( 'works with type aliases and flat tag imports', () => 
        {
            expectError( `
                import { Minimum, MinLength } from './src/index.js';
                type Age = number & Minimum<21>;
                type Name = string & MinLength<3>;
                const age: Age = 20;
                const name: Name = 'ab';
            `, 'Minimum<21>', 'MinLength<3>' );
        });
    });

    describe( 'messages and edge cases', () => 
    {
        it( 'surfaces custom constraint messages when provided', () => 
        {
            expectError( `
                import { constraint } from './src/index.js';
                const age: number & constraint.Minimum<18, 'Too young'> = 5;
            `, 'Too young' );
        });

        it( 'checks parameter and property default initializers', () => 
        {
            expectError( `
                import { constraint } from './src/index.js';
                function f( age: number & constraint.Minimum<18> = 5 ) {}
            `, 'Minimum<18>' );

            expectError( `
                import { constraint } from './src/index.js';
                class C {
                    age: number & constraint.Minimum<18> = 5;
                }
            `, 'Minimum<18>' );
        });

        it( 'unwraps parentheses and as-expressions for constants', () => 
        {
            expectError( `
                import { constraint } from './src/index.js';
                const age: number & constraint.Minimum<18> = (5);
            `, 'Minimum<18>' );

            expectError( `
                import { constraint } from './src/index.js';
                const age: number & constraint.Minimum<18> = 5 as number;
            `, 'Minimum<18>' );
        });

        it( 'ignores non-constant values', () => 
        {
            expectOk( `
                import { constraint } from './src/index.js';
                declare const n: number;
                declare const s: string;
                declare const a: string[];
                const age: number & constraint.Minimum<18> = n;
                const name: string & constraint.MinLength<3> = s;
                const tags: string[] & constraint.MinItems<2> = a;
            ` );
        });
    });

    describe( 'evaluateStaticConstraints / tryGetConstantValue', () => 
    {
        it( 'covers all numeric constraint semantics', () => 
        {
            expect( evaluateStaticConstraints({ kind : 'number', value : 5 }, [{ type : 'minimum', value : 18 }])).toHaveLength( 1 );
            expect( evaluateStaticConstraints({ kind : 'number', value : 18 }, [{ type : 'minimum', value : 18 }])).toHaveLength( 0 );
            expect( evaluateStaticConstraints({ kind : 'number', value : 11 }, [{ type : 'maximum', value : 10 }])).toHaveLength( 1 );
            expect( evaluateStaticConstraints({ kind : 'number', value : 0 }, [{ type : 'exclusiveMinimum', value : 0 }])).toHaveLength( 1 );
            expect( evaluateStaticConstraints({ kind : 'number', value : 10 }, [{ type : 'exclusiveMaximum', value : 10 }])).toHaveLength( 1 );
            expect( evaluateStaticConstraints({ kind : 'number', value : 7 }, [{ type : 'multipleOf', value : 5 }])).toHaveLength( 1 );
            expect( evaluateStaticConstraints({ kind : 'number', value : 15 }, [{ type : 'multipleOf', value : 5 }])).toHaveLength( 0 );
        });

        it( 'covers string and array constraint semantics', () => 
        {
            expect( evaluateStaticConstraints({ kind : 'string', value : 'hi' }, [{ type : 'minLength', value : 3 }])).toHaveLength( 1 );
            expect( evaluateStaticConstraints({ kind : 'string', value : 'abcd' }, [{ type : 'maxLength', value : 3 }])).toHaveLength( 1 );
            expect( evaluateStaticConstraints({ kind : 'array', value : [1]}, [{ type : 'minItems', value : 2 }])).toHaveLength( 1 );
            expect( evaluateStaticConstraints({ kind : 'array', value : [1, 2, 3]}, [{ type : 'maxItems', value : 2 }])).toHaveLength( 1 );
            expect( evaluateStaticConstraints({ kind : 'array', value : [1, 1]}, [{ type : 'uniqueItems', value : true }])).toHaveLength( 1 );
            expect( evaluateStaticConstraints({ kind : 'array', value : [1, 2]}, [{ type : 'uniqueItems', value : true }])).toHaveLength( 0 );
            expect( evaluateStaticConstraints(
                { kind : 'object', keyCount : 1 },
                [{ type : 'minProperties', value : 2 }]
            )).toHaveLength( 1 );
            expect( evaluateStaticConstraints(
                { kind : 'object', keyCount : 3 },
                [{ type : 'maxProperties', value : 2 }]
            )).toHaveLength( 1 );
            expect( evaluateStaticConstraints(
                { kind : 'object', keyCount : 2 },
                [{ type : 'minProperties', value : 2 }, { type : 'maxProperties', value : 3 }]
            )).toHaveLength( 0 );
            expect( evaluateStaticConstraints(
                { kind : 'array', value : [{ a : 1 }, { a : 1 }] },
                [{ type : 'uniqueItems', value : true }]
            )).toHaveLength( 1 );
            expect( evaluateStaticConstraints(
                { kind : 'number', value : 15n },
                [{ type : 'multipleOf', value : 4n }]
            )).toHaveLength( 1 );
            expect( evaluateStaticConstraints(
                { kind : 'number', value : 16n },
                [{ type : 'multipleOf', value : 4n }]
            )).toHaveLength( 0 );
        });

        it( 'uses custom messages when present', () => 
        {
            const errs = evaluateStaticConstraints(
                { kind : 'number', value : 1 },
                [{ type : 'minimum', value : 2, message : 'custom min' }]
            );

            expect( errs ).toEqual([ 'custom min' ]);
        });

        it( 'parses numeric, string, and array literals', () => 
        {
            const parse = ( code: string ) => 
            {
                const sf = ts.createSourceFile( 'x.ts', `const x = ${code};`, ts.ScriptTarget.ES2022, true );
                const decl = ( sf.statements[0] as ts.VariableStatement ).declarationList.declarations[0];

                return tryGetConstantValue( decl.initializer! );
            };

            expect( parse( '42' )).toEqual({ kind : 'number', value : 42 });
            expect( parse( '-5' )).toEqual({ kind : 'number', value : -5 });
            expect( parse( "'hi'" )).toEqual({ kind : 'string', value : 'hi' });
            expect( parse( '`hi`' )).toEqual({ kind : 'string', value : 'hi' });
            expect( parse( '[1, 2]' )).toEqual({ kind : 'array', value : [1, 2]});
            expect( parse( "['a', 'b']" )).toEqual({ kind : 'array', value : ['a', 'b']});
            expect( parse( '[[1], [2]]' )).toEqual({ kind : 'array', value : [[1], [2]]});
            expect( parse( '(5)' )).toEqual({ kind : 'number', value : 5 });
            expect( parse( 'n' )).toBeUndefined();
            expect( parse( '[...xs]' )).toBeUndefined();
            expect( parse( '1n' )).toEqual({ kind : 'number', value : 1n });
        });

        it( 'parses bigint literals and evaluates bigint multiples', () =>
        {
            // Arrange
            const sourceFile = ts.createSourceFile( 'bigint.ts', 'const x = -6n;', ts.ScriptTarget.ES2022, true );
            const declaration = ( sourceFile.statements[0] as ts.VariableStatement ).declarationList.declarations[0];

            // Act
            const constant = tryGetConstantValue( declaration.initializer! );
            const errors = evaluateStaticConstraints(
                { kind : 'number', value : 7n },
                [{ type : 'multipleOf', value : 3n }]
            );

            // Assert
            expect( constant ).toEqual({ kind : 'number', value : -6n });
            expect( errors ).toHaveLength( 1 );
        });

        it( 'extracts a message from union-shaped phantom properties', () =>
        {
            // Arrange
            const fileName = path.resolve( `./temp_static_message_${process.pid}.ts` );
            const source = `
                type Tagged = string & {
                    __minLength: 3;
                    __minLength_message: 'too short' | 'alternate';
                };
            `;
            fs.writeFileSync( fileName, source );

            try
            {
                const program = ts.createProgram([fileName], { strict : true });
                const checker = program.getTypeChecker();
                const sourceFile = program.getSourceFile( fileName )!;
                const declaration = sourceFile.statements[0] as ts.TypeAliasDeclaration;

                // Act
                const constraints = extractStaticConstraints( checker.getTypeFromTypeNode( declaration.type ), checker );

                // Assert
                expect( constraints ).toContainEqual({ type : 'minLength', value : 3, message : 'too short' });
            }
            finally
            {
                fs.unlinkSync( fileName );
            }
        });

        it( 'recurses into nonconstant nested object literal properties', () =>
        {
            // Arrange
            const source = `
                import { constraint } from './src/index.js';
                interface Input {
                    nested: { value: string & constraint.MinLength<3> };
                }
                declare const unknownValue: string;
                const input: Input = { nested: { value: unknownValue } };
            `;

            // Act
            const diagnostics = diagnosticsFor( source );

            // Assert
            expect( diagnostics ).toEqual([]);
        });

        it( 'extracts constraints with message properties and uniqueItems object keys', () =>
        {
            // Arrange
            const fileName = path.resolve( `./temp_static_msg_branch_${process.pid}.ts` );
            const source = `
                type Tagged = string & {
                    __minLength: 3;
                    __minLength_message: 'too short';
                };
                type Flagged = unknown[] & {
                    __uniqueItems: true;
                };
            `;
            fs.writeFileSync( fileName, source );

            try
            {
                const program = ts.createProgram([fileName], { strict : true });
                const checker = program.getTypeChecker();
                const sourceFile = program.getSourceFile( fileName )!;
                const tagged = sourceFile.statements[0] as ts.TypeAliasDeclaration;
                const flagged = sourceFile.statements[1] as ts.TypeAliasDeclaration;

                // Act
                const taggedConstraints = extractStaticConstraints( checker.getTypeFromTypeNode( tagged.type ), checker );
                const flaggedConstraints = extractStaticConstraints( checker.getTypeFromTypeNode( flagged.type ), checker );

                // Assert
                expect( taggedConstraints.some( c => c.message === 'too short' )).toBe( true );
                expect( flaggedConstraints.some( c => c.type === 'uniqueItems' )).toBe( true );
            }
            finally
            {
                fs.unlinkSync( fileName );
            }
        });
    });
});
