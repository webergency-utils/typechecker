import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ts from 'typescript';
import 
{
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
    createInstanceOfCheck,
    wrapOptionTransform
} 
    from '../src/engine/generators.js';

function stripPositions<T extends ts.Node>( node: T ): T 
{
    const visitor = ( n: ts.Node ): ts.Node => 
    {
        const cloned = ts.visitEachChild( n, visitor, undefined );
        const res = { ...cloned, pos : -1, end : -1 };
        Object.setPrototypeOf( res, Object.getPrototypeOf( cloned ));

        return res as ts.Node;
    };

    return ts.visitNode( node, visitor ) as T;
}

function printExpr( expr: ts.Expression ): string 
{
    const file = ts.createSourceFile( 'gen.ts', '', ts.ScriptTarget.Latest, true, ts.ScriptKind.TS );
    const printer = ts.createPrinter({ newLine : ts.NewLineKind.LineFeed });

    return printer.printNode( ts.EmitHint.Expression, stripPositions( expr ), file );
}

describe( 'generators', () => 
{

    beforeEach(() => 
    {
    });

    afterEach(() => 
    {
        vi.clearAllMocks();
    });

    describe( 'template helpers', () => 
    {
        it( 'should parse parenthesized and property-access templates', () => 
        {
            // Act
            const fromVar = templateToAst( '(1 + 2)' );
            const fromExpr = templateToAst( 'validators.string' );

            // Assert
            expect( printExpr( fromVar )).toBe( '(1 + 2)' );
            expect( printExpr( fromExpr )).toBe( 'validators.string' );
        });

        it( 'should fall back to variable-wrapper parsing for object-literal templates', () => 
        {
            // Arrange / Act — `{ a: 1 };` is a block statement, so ExpressionStatement
            // parsing fails and the `const x = …` path is used.
            const ast = templateToAst( '{ a: 1 }' );

            // Assert
            expect( printExpr( ast )).toContain( 'a' );
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
            expect( printExpr( createPrimitiveCheck( 'string' ))).toBe( 'validators.string' );
            expect( printExpr( createDateCheck())).toBe( 'validators.date' );
            expect( printExpr( createRegExpCheck())).toBe( 'validators.regexp' );
            expect( printExpr( createNullCheck())).toBe( 'validators.null' );
            expect( printExpr( createUndefinedCheck())).toBe( 'validators.undefined' );
            expect( printExpr( wrapOptionTransform( createPrimitiveCheck( 'string' ), 'string', ['html'])))
                .toContain( 'applyOptionTransform' );
            expect( printExpr( wrapOptionTransform( createDateCheck(), 'Date' )))
                .toContain( '"Date"' );
        });

        it( 'should emit literal checks for string number boolean and bigint', () => 
        {
            // Act / Assert
            expect( printExpr( createLiteralCheck( 'x' ))).toContain( '"x"' );
            expect( printExpr( createLiteralCheck( 3 ))).toContain( '3' );
            expect( printExpr( createLiteralCheck( true ))).toContain( 'true' );
            expect( printExpr( createLiteralCheck( false ))).toContain( 'false' );
            expect( printExpr( createLiteralCheck({ base10Value : '9', negative : false } as ts.PseudoBigInt ))).toContain( '9n' );
        });

        it( 'should wrap child validators for array record set map tuple and instanceOf', () => 
        {
            // Arrange
            const child = createPrimitiveCheck( 'number' );
            const key = createPrimitiveCheck( 'string' );

            // Act / Assert
            expect( printExpr( createArrayCheck( child ))).toContain( 'validators.array' );
            expect( printExpr( createRecordCheck( child ))).toContain( 'validators.record' );
            expect( printExpr( createSetCheck( child ))).toContain( 'validators.set' );
            expect( printExpr( createMapCheck( key, child ))).toContain( 'validators.map' );
            expect( printExpr( createTupleCheck([key, child]))).toContain( 'validators.tuple' );
            expect( printExpr( createInstanceOfCheck( 'Date' ))).toContain( 'validators.instanceOf' );
            expect( printExpr( createInstanceOfCheck( 'Date' ))).toContain( '"Date"' );

            const ctorExpr = printExpr( createInstanceOfCheck( ts.factory.createIdentifier( 'Mailer' )));
            expect( ctorExpr ).toContain( 'validators.instanceOf(v, path, ctx, Mailer)' );
            expect( ctorExpr ).not.toContain( '"Mailer"' );
        });

        it( 'should emit union templateLiteral and intersection checks', () => 
        {
            // Arrange
            const a = createPrimitiveCheck( 'string' );
            const b = createPrimitiveCheck( 'number' );

            // Act
            const union = printExpr( createUnionCheck([a, b], 'Type<Union>' ));
            const tpl = printExpr( createTemplateLiteralCheck( '^id_', 'Template' ));
            const inter = printExpr( createIntersectionCheck([a, b]));

            // Assert
            expect( union ).toContain( 'validators.union' );
            expect( tpl ).toContain( 'validators.templateLiteral' );
            expect( inter ).toContain( 'validators.objectShell' );
            expect( inter ).toContain( 'validators.assign' );
        });

        it( 'should emit object checks with and without index signatures', () => 
        {
            // Arrange
            const props = 
            [
                {
                    name       : 'id',
                    isOptional : false,
                    validator  : createPrimitiveCheck( 'number' )
                },
                {
                    name       : 'tag',
                    isOptional : true,
                    validator  : createPrimitiveCheck( 'string' )
                }
            ];
            const index = createPrimitiveCheck( 'string' );

            // Act
            const closed = printExpr( createObjectCheck( props, 'Type<Row>' ));
            const open = printExpr( createObjectCheck( props, 'Type<Row>', index ));

            // Assert
            expect( closed ).toContain( 'validators.stripExtras' );
            expect( closed ).toContain( 'new Set(' );
            expect( closed ).toContain( '"Type<Row>"' );
            expect( open ).toContain( 'validators.additionalProps' );
            expect( open ).toContain( 'new Set(' );
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
                { type : 'minProperties', value : 1 },
                { type : 'maxProperties', value : 4 },
                {
                    type        : 'contains',
                    nestedCheck : ts.factory.createIdentifier( 'itemCheck' ),
                    message     : 'need match'
                },
                { type : 'minContains', value : 2 },
                { type : 'maxContains', value : 4 },
                {
                    type        : 'propertyNames',
                    nestedCheck : ts.factory.createIdentifier( 'keyCheck' )
                },
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
            const code = printExpr( createConstrainedPrimitiveCheck( 'string', constraints ));

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
            expect( code ).toContain( 'validators.safeRegExp' );
            expect( code ).toContain( 'validators.format' );
            expect( code ).toContain( 'validators.minProperties' );
            expect( code ).toContain( 'validators.maxProperties' );
            expect( code ).toContain( 'validators.contains' );
            expect( code ).toContain( 'itemCheck' );
            expect( code ).toContain( 'need match' );
            expect( code ).toContain( 'validators.propertyNames' );
            expect( code ).toContain( 'keyCheck' );
            expect( code ).toContain( 'validators.custom' );
            expect( code ).toContain( 'validators.requires' );
            expect( code ).toContain( 'startsWithWeb' );
            expect( code ).toContain( 'applyOptionTransform' );
        });

        it( 'should emit Date kind and tags for constrained date checks', () =>
        {
            // Arrange / Act
            const code = printExpr( createConstrainedPrimitiveCheck( 'date', [{ type : 'tags', value : ['html'] }]));
            const arrayCode = printExpr( createConstrainedPrimitiveCheck( 'array', [], createPrimitiveCheck( 'any' )));

            // Assert
            expect( code ).toContain( '"Date"' );
            expect( code ).toContain( '"html"' );
            expect( arrayCode ).toContain( '"Array"' );
        });

        it( 'should use a provided baseValidator when composing constrained checks', () => 
        {
            // Arrange
            const base = createPrimitiveCheck( 'number' );

            // Act
            const code = printExpr( createConstrainedPrimitiveCheck( 'number', [{ type : 'minimum', value : 1 }], base ));

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
            const code = printExpr( createConstrainedPrimitiveCheck( 'string', constraints ));

            // Assert
            expect( code ).toContain( '[".a", ".b"]' );
        });
    });
});
