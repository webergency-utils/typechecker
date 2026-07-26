import { describe, it, expect } from 'vitest';
import { validate, is, assert, assertGuard, jsonSchema } from '../index.js';

describe( 'Runtime stubs without transformer', () => 
{
    it( 'throws a clear error when AOT rewrite did not run', () => 
    {
        expect(() => validate( 1 )).toThrow( /transformer was not applied/ );
        expect(() => is( 1 )).toThrow( /transformer was not applied/ );
        expect(() => assert( 1 )).toThrow( /transformer was not applied/ );
        expect(() => assertGuard( 1 )).toThrow( /transformer was not applied/ );
        expect(() => jsonSchema()).toThrow( /transformer was not applied/ );
    });
});
