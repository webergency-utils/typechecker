import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ts from 'typescript';
import { hoistEmitLocals, resolveEmitNames } from '../engine/hoister.js';

function printSource( file: ts.SourceFile ): string
{
    return ts.createPrinter({ newLine : ts.NewLineKind.LineFeed }).printFile( file );
}

function sourceFrom( code: string ): ts.SourceFile
{
    return ts.createSourceFile( 'hoist.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS );
}

function exprFrom( code: string ): ts.Expression
{
    const statement = sourceFrom( `const __probe = ${code};` ).statements[0] as ts.VariableStatement;

    return statement.declarationList.declarations[0].initializer!;
}

describe( 'hoister', () =>
{
    beforeEach(() =>
    {
        // isolation seam for future mocks
    });

    afterEach(() =>
    {
        vi.clearAllMocks();
    });

    it( 'should leave the source unchanged when cache and schemas are empty', () =>
    {
        // Arrange
        const source = sourceFrom( 'const x = 1;' );

        // Act
        const result = hoistEmitLocals( source, new Map());

        // Assert
        expect( result ).toBe( source );
    });

    it( 'should inject runtime import validators and local validator consts after user imports', () =>
    {
        // Arrange
        const source = sourceFrom( `
            import { value } from './x.js';
            export const ready = 1;
        ` );
        const cache = new Map<string, ts.Expression>([
            ['abc123', exprFrom( 'validators.string' )]
        ]);

        // Act
        const printed = printSource( hoistEmitLocals( source, cache ));

        // Assert
        expect( printed.indexOf( 'import * as __tcRuntime' )).toBeLessThan( printed.indexOf( "import { value }" ));
        expect( printed.indexOf( "import { value }" )).toBeLessThan( printed.indexOf( 'const validators =' ));
        expect( printed.indexOf( 'const validators =' )).toBeLessThan( printed.indexOf( 'export const ready' ));
        expect( printed ).toContain( 'const __val_abc123 =' );
        expect( printed ).not.toContain( 'registerValidator' );
        expect( printed ).not.toContain( '__WEBERGENCY_TYPECHECKER' );
    });

    it( 'should hoist schemas without injecting runtime validators', () =>
    {
        // Arrange
        const source = sourceFrom( 'export const ready = true;' );
        const schemas = new Map<string, ts.Expression>([
            ['only', ts.factory.createObjectLiteralExpression([
                ts.factory.createPropertyAssignment( 'type', ts.factory.createStringLiteral( 'string' ))
            ])]
        ]);

        // Act
        const printed = printSource( hoistEmitLocals( source, new Map(), schemas ));

        // Assert
        expect( printed ).toContain( 'const __schema_only =' );
        expect( printed ).not.toContain( '__tcRuntime' );
        expect( printed ).not.toContain( 'const validators' );
        expect( printed ).not.toContain( '__val_' );
    });

    it( 'should skip duplicate validator and schema declarations', () =>
    {
        // Arrange
        const source = sourceFrom( `
            const __val_dup = validators.string;
            const __schema_dup = { type: 'string' };
            export const ready = true;
        ` );
        const cache = new Map<string, ts.Expression>([
            ['dup', exprFrom( 'validators.number' )]
        ]);
        const schemas = new Map<string, ts.Expression>([
            ['dup', ts.factory.createObjectLiteralExpression([
                ts.factory.createPropertyAssignment( 'type', ts.factory.createStringLiteral( 'number' ))
            ])]
        ]);

        // Act
        const printed = printSource( hoistEmitLocals( source, cache, schemas ));

        // Assert
        expect( printed.match( /const __val_dup =/g )?.length ).toBe( 1 );
        expect( printed.match( /const __schema_dup =/g )?.length ).toBe( 1 );
    });

    it( 'should rename nested validator references when the name is taken', () =>
    {
        // Arrange
        const source = sourceFrom( 'function validators() { return 1; }' );
        const cache = new Map<string, ts.Expression>([
            ['nested', exprFrom( '(v, path, ctx) => validators.array(v, path, ctx, validators.string)' )]
        ]);

        // Act
        const names = resolveEmitNames( source );
        const printed = printSource( hoistEmitLocals( source, cache, undefined, names ));

        // Assert
        expect( names.validatorsName ).toBe( 'validators_1' );
        expect( printed ).toContain( 'validators_1.array' );
        expect( printed ).toContain( 'validators_1.string' );
        expect( printed ).not.toMatch( /[^_]validators\.(array|string)/ );
    });

    it( 'should inject its own runtime import instead of reusing a user import', () =>
    {
        // Arrange
        const source = sourceFrom( `
            import * as rt from "@webergency-utils/typechecker/runtime";
            export const value = 1;
        ` );
        const cache = new Map<string, ts.Expression>([
            ['aliased', exprFrom( 'validators.string' )]
        ]);

        // Act
        const names = resolveEmitNames( source );
        const printed = printSource( hoistEmitLocals( source, cache, undefined, names ));

        // Assert
        expect( names.runtimeNs ).toBe( '__tcRuntime' );
        expect( printed ).toContain( 'import * as __tcRuntime from "@webergency-utils/typechecker/runtime"' );
        expect( printed ).toContain( 'const validators = __tcRuntime.validators' );
    });

    it( 'should avoid colliding with a later validators binding', () =>
    {
        // Arrange
        const source = sourceFrom( `
            function validators() { return 1; }
            export const ready = true;
        ` );
        const cache = new Map<string, ts.Expression>([
            ['global', exprFrom( 'validators.string' )]
        ]);

        // Act
        const names = resolveEmitNames( source );
        const printed = printSource( hoistEmitLocals( source, cache, undefined, names ));

        // Assert
        expect( names.validatorsName ).toBe( 'validators_1' );
        expect( printed ).toContain( 'const validators_1 = __tcRuntime.validators' );
        expect( printed ).toContain( 'const __val_global = validators_1.string' );
    });
});

describe( 'resolveEmitNames', () =>
{
    it( 'should avoid names bound by functions classes enums and imports', () =>
    {
        // Arrange
        const source = sourceFrom( `
            import __tcRuntime from './other.js';
            function validators() { return 1; }
            class validators_1 {}
            enum validators_2 { A }
        ` );

        // Act
        const names = resolveEmitNames( source );

        // Assert
        expect( names.runtimeNs ).toBe( '__tcRuntime_1' );
        expect( names.validatorsName ).toBe( 'validators_3' );
    });

    it( 'should avoid a namespace name bound only inside a nested scope', () =>
    {
        // Arrange
        const source = sourceFrom( `
            export function f( __tcRuntime_1: any )
            {
                const __tcRuntime = { fake: true };

                return [__tcRuntime, __tcRuntime_1];
            }
        ` );

        // Act
        const names = resolveEmitNames( source );

        // Assert
        expect( names.runtimeNs ).toBe( '__tcRuntime_2' );
        expect( names.validatorsName ).toBe( 'validators' );
    });

    it( 'should avoid names bound by destructuring patterns', () =>
    {
        // Arrange
        const source = sourceFrom( 'const { validators, ...rest } = deps; const [, __tcRuntime] = pair;' );

        // Act
        const names = resolveEmitNames( source );

        // Assert
        expect( names.validatorsName ).toBe( 'validators_1' );
        expect( names.runtimeNs ).toBe( '__tcRuntime_1' );
    });

    it( 'should keep default names when nothing collides', () =>
    {
        // Arrange
        const source = sourceFrom( 'export const value = 1;' );

        // Act
        const names = resolveEmitNames( source );

        // Assert
        expect( names ).toEqual({
            runtimeNs      : '__tcRuntime',
            validatorsName : 'validators'
        });
    });
});
