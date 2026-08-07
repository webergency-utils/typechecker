import { describe, it, expect } from 'vitest';
import {
    validate,
    is,
    assert,
    assertGuard,
    jsonSchema,
    validateSchema,
    isSchema,
    assertSchema,
    assertGuardSchema
} from '../src/index.js';

describe( 'Runtime stubs without transformer', () =>
{
    it( 'throws a clear error when AOT rewrite did not run for typed helpers', () =>
    {
        expect(() => validate( 1 )).toThrow( /transformer was not applied/ );
        expect(() => is( 1 )).toThrow( /transformer was not applied/ );
        expect(() => assert( 1 )).toThrow( /transformer was not applied/ );
        expect(() => assertGuard( 1 )).toThrow( /transformer was not applied/ );
        expect(() => jsonSchema()).toThrow( /transformer was not applied/ );
    });

    it( 'runs schema helpers without the transformer', () =>
    {
        expect( isSchema({ type : 'string' }, 'ok' )).toBe( true );
        expect( isSchema({ type : 'string' }, 1 )).toBe( false );
        expect( assertSchema({ type : 'number' }, 42 )).toBe( 42 );
        expect( validateSchema({ type : 'boolean' }, true )).toEqual({ success : true, errors : [], data : true });
        expect(() => assertGuardSchema({ type : 'string' }, 1 )).toThrow( /Validation Error/ );
    });
});
