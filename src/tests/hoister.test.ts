import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ts from 'typescript';
import { hoistRegistrations } from '../engine/hoister.js';

function printSource( file: ts.SourceFile ): string 
{
    return ts.createPrinter({ newLine : ts.NewLineKind.LineFeed }).printFile( file );
}

function sourceFrom( code: string ): ts.SourceFile 
{
    return ts.createSourceFile( 'hoist.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS );
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

    it( 'should leave the source unchanged when cache and utils are empty', () => 
    {
        // Arrange
        const source = sourceFrom( 'const x = 1;' );

        // Act
        const result = hoistRegistrations( source, new Map(), new Set());

        // Assert
        expect( result ).toBe( source );
    });

    it( 'should prepend runtime import validators MetadataStore and register validators', () => 
    {
        // Arrange
        const source = sourceFrom( 'export const value = 1;' );
        const cache = new Map<string, ts.Expression>([
            ['abc123', ts.factory.createIdentifier( 'validators.string' )]
        ]);
        const utils = new Set([ 'validators' ]);

        // Act
        const printed = printSource( hoistRegistrations( source, cache, utils ));

        // Assert
        expect( printed ).toContain( '@webergency-utils/typechecker/runtime' );
        expect( printed ).toContain( '__WEBERGENCY_TYPECHECKER_VALIDATORS__' );
        expect( printed ).toContain( '__WEBERGENCY_TYPECHECKER_METADATA_STORE__' );
        expect( printed ).toContain( '__val_abc123' );
        expect( printed ).toContain( 'registerValidator' );
    });

    it( 'should register schemas and skip duplicate utility declarations', () => 
    {
        // Arrange
        const source = sourceFrom( `
            const validators = globalThis.__WEBERGENCY_TYPECHECKER_VALIDATORS__;
            const MetadataStore = globalThis.__WEBERGENCY_TYPECHECKER_METADATA_STORE__;
            const __val_dup = validators.string;
            export const ready = true;
        ` );
        const cache = new Map<string, ts.Expression>([
            ['dup', ts.factory.createIdentifier( 'validators.number' )]
        ]);
        const schemas = new Map<string, ts.Expression>([
            ['dup', ts.factory.createObjectLiteralExpression([
                ts.factory.createPropertyAssignment( 'type', ts.factory.createStringLiteral( 'string' ))
            ])]
        ]);

        // Act
        const printed = printSource( hoistRegistrations( source, cache, new Set([ 'validators' ]), schemas ));

        // Assert
        expect( printed ).toContain( 'registerSchema' );
        expect( printed.match( /const validators =/g )?.length ).toBe( 1 );
        expect( printed.match( /const __val_dup =/g )?.length ).toBe( 1 );
    });

    it( 'should insert registrations after class declarations', () => 
    {
        // Arrange
        const source = sourceFrom( `
            class Row {}
            export const value = 1;
        ` );
        const cache = new Map<string, ts.Expression>([
            ['cls', ts.factory.createIdentifier( 'validators.any' )]
        ]);

        // Act
        const printed = printSource( hoistRegistrations( source, cache, new Set([ 'validators' ])));

        // Assert
        const classAt = printed.indexOf( 'class Row' );
        const registerAt = printed.indexOf( 'registerValidator' );
        const valueAt = printed.indexOf( 'export const value' );
        expect( classAt ).toBeGreaterThan( -1 );
        expect( registerAt ).toBeGreaterThan( classAt );
        expect( valueAt ).toBeGreaterThan( registerAt );
    });

    it( 'should treat destructuring variable statements as insertion points', () => 
    {
        // Arrange
        const source = sourceFrom( `
            const { a } = { a: 1 };
            export const b = 2;
        ` );
        const cache = new Map<string, ts.Expression>([
            ['d', ts.factory.createIdentifier( 'validators.string' )]
        ]);

        // Act
        const printed = printSource( hoistRegistrations( source, cache, new Set([ 'validators' ])));

        // Assert
        expect( printed.indexOf( 'registerValidator' )).toBeLessThan( printed.indexOf( 'const { a }' ));
    });

    it( 'should append registrations at end when file is only imports and types', () => 
    {
        // Arrange
        const source = sourceFrom( `
            import { x } from './x.js';
            interface Row { id: number }
            type Alias = string;
        ` );
        const cache = new Map<string, ts.Expression>([
            ['tail', ts.factory.createIdentifier( 'validators.string' )]
        ]);

        // Act
        const printed = printSource( hoistRegistrations( source, cache, new Set([ 'validators' ])));

        // Assert
        expect( printed ).toContain( 'registerValidator("tail", __val_tail)' );
        expect( printed.indexOf( 'registerValidator' )).toBeGreaterThan( printed.indexOf( 'type Alias' ));
    });
});
