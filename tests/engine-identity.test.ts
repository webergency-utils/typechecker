import { describe, it, expect } from 'vitest';
import { compileAndTransform, emitWithTransformer } from './helpers/compile.js';
import { TAG_KEYS, isTagKey, tagKey } from '../src/engine/tagKeys.js';

describe( 'Engine tag identity', () =>
{
    const compile = ( code: string ) => compileAndTransform( code, 'temp_engine_identity' );

    describe( 'tag key registry', () =>
    {
        it( 'should recognize value tags, their message siblings, transforms and defaults', () =>
        {
            expect( isTagKey( tagKey( 'minLength' ))).toBe( true );
            expect( isTagKey( '__minLength_message' )).toBe( true );
            expect( isTagKey( '__transform_custom' )).toBe( true );
            expect( isTagKey( '__default' )).toBe( true );
            expect( isTagKey( '__message' )).toBe( true );
        });

        it( 'should not claim arbitrary dunder property names', () =>
        {
            expect( isTagKey( '__typename' )).toBe( false );
            expect( isTagKey( '__proto__' )).toBe( false );
            expect( TAG_KEYS.has( 'minLength' )).toBe( false );
        });
    });

    describe( 'custom function identity', () =>
    {
        it( 'should compile a distinct validator per custom constraint function', () =>
        {
            const code = `
                import { validate, constraint } from './src/index.js';
                function isEven(v: number) { return v % 2 === 0; }
                function isOdd(v: number) { return v % 2 === 1; }
                interface Pair {
                    a: number & constraint.Custom<typeof isEven>;
                    b: number & constraint.Custom<typeof isOdd>;
                }
                const res = validate<Pair>({ a: 2, b: 3 });
            `;

            const compiled = compile( code );

            expect( compiled ).toContain( 'validators.custom(v, path, ctx, isEven)' );
            expect( compiled ).toContain( 'validators.custom(v, path, ctx, isOdd)' );
        });

        it( 'should compile a distinct validator per custom transform function', () =>
        {
            const code = `
                import { validate, transform } from './src/index.js';
                function addPrefix(v: string) { return 'a' + v; }
                function addSuffix(v: string) { return v + 'b'; }
                interface Pair {
                    a: string & transform.Custom<typeof addPrefix>;
                    b: string & transform.Custom<typeof addSuffix>;
                }
                const res = validate<Pair>({ a: 'x', b: 'y' });
            `;

            const compiled = compile( code );

            expect( compiled ).toContain( 'addPrefix(v)' );
            expect( compiled ).toContain( 'addSuffix(v)' );
        });

        it( 'should reject an inline function expression that has no referencable binding', () =>
        {
            const code = `
                import { validate, constraint } from './src/index.js';
                type Even = number & constraint.Custom<(v: number) => boolean>;
                const res = validate<Even>(2);
            `;

            expect(() => compile( code )).toThrow( /must reference a named function via typeof/ );
        });
    });

    describe( 'custom function emit', () =>
    {
        const emit = ( files: Record<string, string> ) => emitWithTransformer( files, 'temp_engine_emit' );

        it( 'should re-import a custom function that the user only referenced through typeof', () =>
        {
            const output = emit({
                'helpers.ts' : 'export function isEven( v: number ){ return v % 2 === 0 }',
                'main.ts'    : `
                    import { validate, constraint } from '../src/index.js';
                    import { isEven } from './helpers.js';
                    const input: unknown = 2;
                    export const result = validate<number & constraint.Custom<typeof isEven>>( input );
                `
            });

            expect( output ).toContain( 'import { isEven as __tc_fn_isEven } from "./helpers.js"' );
            expect( output ).toContain( 'validators.custom(v, path, ctx, __tc_fn_isEven)' );
        });

        it( 'should reference a custom function declared in the same file by its own name', () =>
        {
            const output = emit({
                'main.ts' : `
                    import { validate, constraint } from '../src/index.js';
                    function isEven( v: number ){ return v % 2 === 0 }
                    const input: unknown = 2;
                    export const result = validate<number & constraint.Custom<typeof isEven>>( input );
                `
            });

            expect( output ).toContain( 'validators.custom(v, path, ctx, isEven)' );
            expect( output ).not.toContain( '__tc_fn_' );
        });

        it( 'should name an arrow function by the variable holding it', () =>
        {
            const output = emit({
                'main.ts' : `
                    import { validate, constraint } from '../src/index.js';
                    const isEven = ( v: number ) => v % 2 === 0;
                    const input: unknown = 2;
                    export const result = validate<number & constraint.Custom<typeof isEven>>( input );
                `
            });

            expect( output ).toContain( 'validators.custom(v, path, ctx, isEven)' );
            expect( output ).not.toContain( '__tc_fn_' );
        });

        it( 'should re-import an arrow function imported as a default export', () =>
        {
            const output = emit({
                'helpers.ts' : 'const isEven = ( v: number ) => v % 2 === 0;\nexport default isEven;',
                'main.ts'    : `
                    import { validate, constraint } from '../src/index.js';
                    import isEven from './helpers.js';
                    const input: unknown = 2;
                    export const result = validate<number & constraint.Custom<typeof isEven>>( input );
                `
            });

            expect( output ).toContain( 'import __tc_fn_isEven from "./helpers.js"' );
            expect( output ).toContain( 'validators.custom(v, path, ctx, __tc_fn_isEven)' );
        });

        it( 'should reject a custom function reached through a namespace import', () =>
        {
            const build = () => emit({
                'helpers.ts' : 'export function isEven( v: number ){ return v % 2 === 0 }',
                'main.ts'    : `
                    import { validate, constraint } from '../src/index.js';
                    import * as helpers from './helpers.js';
                    const input: unknown = 2;
                    export const result = validate<number & constraint.Custom<typeof helpers.isEven>>( input );
                `
            });

            expect( build ).toThrow( /must be imported directly into this file/ );
        });

        it( 'should reject a custom function that is not reachable from module scope', () =>
        {
            const build = () => emit({
                'main.ts' : `
                    import { validate, constraint } from '../src/index.js';
                    export function check( input: unknown )
                    {
                        function isEven( v: number ){ return v % 2 === 0 }

                        return validate<number & constraint.Custom<typeof isEven>>( input );
                    }
                `
            });

            expect( build ).toThrow( /must be declared at module scope/ );
        });
    });

    describe( 'structural hashing', () =>
    {
        function countValidators( compiled: string ): number
        {
            return ( compiled.match( /const __val_/g ) || []).length;
        }

        it( 'should share one validator between two properties of the same type', () =>
        {
            const code = `
                import { validate } from './src/index.js';
                interface Inner { a: string }
                interface Outer { p: Inner; q: Inner }
                const res = validate<Outer>({ p: { a: 'x' }, q: { a: 'y' } });
            `;

            const compiled = compile( code );
            const props = [...compiled.matchAll( /\["([pq])", false, (__val_[0-9a-f]+)\]/g )];

            // The second Inner must not be read as a cycle and hashed apart, which would compile a
            // duplicate validator for an identical shape.
            expect( props ).toHaveLength( 2 );
            expect( props[0][2]).toBe( props[1][2]);
        });

        it( 'should hash a named type and its inline equivalent identically when repeated', () =>
        {
            const named = `
                import { validate } from './src/index.js';
                interface Inner { a: string }
                const res = validate<{ p: Inner; q: Inner }>({ p: { a: 'x' }, q: { a: 'y' } });
            `;

            const inline = `
                import { validate } from './src/index.js';
                const res = validate<{ p: { a: string }; q: { a: string } }>({ p: { a: 'x' }, q: { a: 'y' } });
            `;

            const namedHashes = compile( named ).match( /__val_[0-9a-f]+/g ) || [];
            const inlineHashes = compile( inline ).match( /__val_[0-9a-f]+/g ) || [];

            expect( new Set( namedHashes )).toEqual( new Set( inlineHashes ));
        });

        it( 'should still compile a recursive type', () =>
        {
            const code = `
                import { validate } from './src/index.js';
                interface Tree { value: number; children: Tree[] }
                const res = validate<Tree>({ value: 1, children: [] });
            `;

            const compiled = compile( code );

            expect( compiled ).toContain( '"children"' );
            expect( countValidators( compiled )).toBeGreaterThan( 0 );
        });
    });

    describe( 'user properties that look like tags', () =>
    {
        it( 'should keep a __typename property when merging an object intersection', () =>
        {
            const code = `
                import { validate } from './src/index.js';
                type Node = { __typename: 'User' } & { id: string };
                const res = validate<Node>({ __typename: 'User', id: 'a' });
            `;

            const compiled = compile( code );

            expect( compiled ).toContain( '"__typename"' );
        });
    });
});
