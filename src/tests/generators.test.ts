import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ts from 'typescript';
import 
{
    createRegistry,
    templateToAst,
    injectNodes,
    createPrimitiveCheck,
    createConstrainedPrimitiveCheck,
    createLiteralCheck,
    createArrayCheck,
    createTemplateLiteralCheck,
    createUnionCheck,
    createObjectCheck,
    createRecordCheck,
    createTupleCheck,
    createDateCheck,
    createRegExpCheck,
    createNullCheck,
    createUndefinedCheck,
    createIntersectionCheck,
    createSetCheck,
    createMapCheck,
    createInstanceOfCheck
} 
from '../engine/generators.js';

function printExpr( expr: ts.Expression ): string 
{
    const file = ts.createSourceFile( 'gen.ts', '', ts.ScriptTarget.Latest, true, ts.ScriptKind.TS );
    const printer = ts.createPrinter({ newLine : ts.NewLineKind.LineFeed });

    return printer.printNode( ts.EmitHint.Expression, expr, file );
}

describe( 'generators', () => 
{
    let requiredUtils: Set<string>;

    beforeEach(() => 
    {
        requiredUtils = new Set();
    });

    afterEach(() => 
    {
        vi.clearAllMocks();
    });

    describe( 'registry and template helpers', () => 
    {
        it( 'should create an empty validation registry', () => 
        {
            // Act
            const registry = createRegistry();

            // Assert
            expect( registry.validators.size ).toBe( 0 );
        });

        it( 'should parse expression and variable templates into AST', () => 
        {
            // Act
            const fromVar = templateToAst( '1 + 2' );
            const fromExpr = templateToAst( 'validators.string' );

            // Assert
            expect( printExpr( fromVar )).toContain( '1' );
            expect( printExpr( fromExpr )).toContain( 'validators.string' );
        });

        it( 'should reject non-expression templates', () => 
        {
            // Act / Assert
            expect(() => templateToAst( 'interface X {}' )).toThrow( /Template must be an expression/ );
        });

        it( 'should inject identifier replacements into templates', () => 
        {
            // Arrange
            const tpl = templateToAst( '(v) => __CHILD__(v)' );
            const child = ts.factory.createIdentifier( 'validators.number' );

            // Act
            const injected = injectNodes( tpl, { '__CHILD__' : child });

            // Assert
            expect( printExpr( injected )).toContain( 'validators.number' );
            expect( printExpr( injected )).not.toContain( '__CHILD__' );
        });
    });

    describe( 'primitive and container checks', () => 
    {
        it( 'should emit property-access validators for primitives and nullish types', () => 
        {
            // Act / Assert
            expect( printExpr( createPrimitiveCheck( 'string', requiredUtils ))).toBe( 'validators.string' );
            expect( printExpr( createDateCheck( requiredUtils ))).toBe( 'validators.date' );
            expect( printExpr( createRegExpCheck( requiredUtils ))).toBe( 'validators.regexp' );
            expect( printExpr( createNullCheck( requiredUtils ))).toBe( 'validators.null' );
            expect( printExpr( createUndefinedCheck( requiredUtils ))).toBe( 'validators.undefined' );
            expect( requiredUtils.has( 'validators' )).toBe( true );
        });

        it( 'should emit literal checks for string number boolean and bigint', () => 
        {
            // Act / Assert
            expect( printExpr( createLiteralCheck( 'x', requiredUtils ))).toContain( '"x"' );
            expect( printExpr( createLiteralCheck( 3, requiredUtils ))).toContain( '3' );
            expect( printExpr( createLiteralCheck( true, requiredUtils ))).toContain( 'true' );
            expect( printExpr( createLiteralCheck( false, requiredUtils ))).toContain( 'false' );
            expect( printExpr( createLiteralCheck({ base10Value : '9', negative : false } as ts.PseudoBigInt, requiredUtils ))).toContain( '9n' );
        });

        it( 'should wrap child validators for array record set map tuple and instanceOf', () => 
        {
            // Arrange
            const child = createPrimitiveCheck( 'number', requiredUtils );
            const key = createPrimitiveCheck( 'string', requiredUtils );

            // Act / Assert
            expect( printExpr( createArrayCheck( child, requiredUtils ))).toContain( 'validators.array' );
            expect( printExpr( createRecordCheck( child, requiredUtils ))).toContain( 'validators.record' );
            expect( printExpr( createSetCheck( child, requiredUtils ))).toContain( 'validators.set' );
            expect( printExpr( createMapCheck( key, child, requiredUtils ))).toContain( 'validators.map' );
            expect( printExpr( createTupleCheck([key, child], requiredUtils ))).toContain( 'validators.tuple' );
            expect( printExpr( createInstanceOfCheck( 'Date', requiredUtils ))).toContain( 'validators.instanceOf' );
            expect( printExpr( createInstanceOfCheck( 'Date', requiredUtils ))).toContain( '"Date"' );
        });

        it( 'should emit union templateLiteral and intersection checks', () => 
        {
            // Arrange
            const a = createPrimitiveCheck( 'string', requiredUtils );
            const b = createPrimitiveCheck( 'number', requiredUtils );

            // Act
            const union = printExpr( createUnionCheck([a, b], requiredUtils, 'Type<Union>' ));
            const tpl = printExpr( createTemplateLiteralCheck( '^id_', 'Template', requiredUtils ));
            const inter = printExpr( createIntersectionCheck([a, b], requiredUtils ));

            // Assert
            expect( union ).toContain( 'validators.union' );
            expect( tpl ).toContain( 'validators.templateLiteral' );
            expect( inter ).toContain( 'validators.objectShell' );
            expect( inter ).toContain( 'Object.assign' );
        });

        it( 'should emit object checks with and without index signatures', () => 
        {
            // Arrange
            const props = 
            [
                {
                    name       : 'id',
                    isOptional : false,
                    validator  : createPrimitiveCheck( 'number', requiredUtils )
                },
                {
                    name       : 'tag',
                    isOptional : true,
                    validator  : createPrimitiveCheck( 'string', requiredUtils )
                }
            ];
            const index = createPrimitiveCheck( 'string', requiredUtils );

            // Act
            const closed = printExpr( createObjectCheck( props, requiredUtils, 'Type<Row>' ));
            const open = printExpr( createObjectCheck( props, requiredUtils, 'Type<Row>', index ));

            // Assert
            expect( closed ).toContain( 'validators.stripExtras' );
            expect( closed ).toContain( '"Type<Row>"' );
            expect( open ).toContain( 'validators.additionalProps' );
            expect( open ).not.toContain( 'validators.stripExtras' );
        });
    });

    describe( 'constrained primitive checks', () => 
    {
        it( 'should emit defaults transforms messages and numeric constraints', () => 
        {
            // Arrange
            const constraints = 
            [
                { type : 'default', value : 'web_' },
                { type : 'message', value : 'bad' },
                { type : 'minLength', value : 3 },
                { type : 'maxLength', value : 10, message : 'too long' },
                { type : 'minimum', value : 1n },
                { type : 'maximum', value : 9 },
                { type : 'exclusiveMinimum', value : 0 },
                { type : 'exclusiveMaximum', value : 100 },
                { type : 'multipleOf', value : 2 },
                { type : 'pattern', value : '^web_' },
                { type : 'format', value : 'email' },
                { type : 'minItems', value : 1 },
                { type : 'maxItems', value : 5 },
                { type : 'uniqueItems', value : true },
                { type : 'custom', value : 'startsWithWeb' },
                { type : 'requires', value : '.password' },
                { type : 'transform', value : 'lowercase' },
                { type : 'transform', value : 'uppercase' },
                { type : 'transform', value : 'trim' },
                { type : 'transform', value : 'capitalize' },
                { type : 'transform', value : 'tonumber' },
                { type : 'transform', value : 'toboolean' },
                { type : 'transform', value : 'todate' },
                { type : 'transform_custom', value : 'myTransform' },
                { type : 'unknown', value : 1 }
            ];

            // Act
            const code = printExpr( createConstrainedPrimitiveCheck( 'string', constraints, requiredUtils ));

            // Assert
            expect( code ).toContain( 'v = "web_"' );
            expect( code ).toContain( 'toLowerCase' );
            expect( code ).toContain( 'toUpperCase' );
            expect( code ).toContain( 'trim()' );
            expect( code ).toContain( 'charAt(0)' );
            expect( code ).toContain( 'coerceQueryNumber' );
            expect( code ).toContain( 'coerceQueryBoolean' );
            expect( code ).toContain( 'coerceQueryDate' );
            expect( code ).toContain( 'myTransform(v)' );
            expect( code ).toContain( 'validators.minLength' );
            expect( code ).toContain( 'too long' );
            expect( code ).toContain( '1n' );
            expect( code ).toContain( 'validators.format' );
            expect( code ).toContain( 'validators.custom' );
            expect( code ).toContain( 'validators.requires' );
            expect( code ).toContain( 'startsWithWeb' );
        });

        it( 'should use a provided baseValidator when composing constrained checks', () => 
        {
            // Arrange
            const base = createPrimitiveCheck( 'number', requiredUtils );

            // Act
            const code = printExpr( createConstrainedPrimitiveCheck( 'number', [{ type : 'minimum', value : 1 }], requiredUtils, base ));

            // Assert
            expect( code ).toContain( 'validators.number' );
            expect( code ).toContain( 'validators.minimum' );
        });

        it( 'should stringify requires arrays and skip empty transform stubs', () => 
        {
            // Arrange
            const constraints = 
            [
                { type : 'requires', value : ['.a', '.b'] },
                { type : 'transform', value : 'not-a-real-transform' }
            ];

            // Act
            const code = printExpr( createConstrainedPrimitiveCheck( 'string', constraints, requiredUtils ));

            // Assert
            expect( code ).toContain( '[".a",".b"]' );
        });
    });
});
