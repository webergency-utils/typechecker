import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ts from 'typescript';
import { objectToAst } from '../engine/resolver.js';

function printExpr( expr: ts.Expression ): string 
{
    const strip = ( node: ts.Node ): ts.Node => 
    {
        const cloned = ts.visitEachChild( node, strip, undefined );
        const res = { ...cloned, pos : -1, end : -1 };
        Object.setPrototypeOf( res, Object.getPrototypeOf( cloned ));

        return res;
    };
    const file = ts.createSourceFile( 'ast.ts', '', ts.ScriptTarget.Latest, true, ts.ScriptKind.TS );

    return ts.createPrinter().printNode( ts.EmitHint.Expression, ts.visitNode( expr, strip ) as ts.Expression, file );
}

describe( 'resolver objectToAst', () => 
{
    beforeEach(() => 
    {
        // isolation
    });

    afterEach(() => 
    {
        vi.clearAllMocks();
    });

    it( 'should convert primitives arrays and objects into AST literals', () => 
    {
        // Act / Assert
        expect( printExpr( objectToAst( null ))).toBe( 'null' );
        expect( printExpr( objectToAst( undefined ))).toBe( 'undefined' );
        expect( printExpr( objectToAst( 'hi' ))).toBe( '"hi"' );
        expect( printExpr( objectToAst( 4 ))).toBe( '4' );
        expect( printExpr( objectToAst( true ))).toBe( 'true' );
        expect( printExpr( objectToAst( false ))).toBe( 'false' );
        expect( printExpr( objectToAst( 3n ))).toBe( '3n' );
        expect( printExpr( objectToAst([1, 'a']))).toContain( '1' );
        expect( printExpr( objectToAst({ a : 1, b : null }))).toContain( '"a"' );
    });

    it( 'should fall back to undefined for unsupported values', () => 
    {
        // Act
        const printed = printExpr( objectToAst( Symbol( 'x' )));

        // Assert
        expect( printed ).toBe( 'undefined' );
    });
});
