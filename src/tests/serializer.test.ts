import { describe, it, expect } from 'vitest';
import 
{ 
    serializeString, 
    serializeDate, 
    serializeBuffer, 
    serializeArray, 
    SerializationError 
} from '../runtime/serializer-runtime.js';
import { generateSerializerCode } from '../engine/serializer-generator.js';
import { compileAndTransform } from './helpers/compile.js';
import ts from 'typescript';

describe( 'Serializer Runtime & Generator', () =>
{
    describe( 'Runtime primitives', () =>
    {
        it( 'should serialize strings with quotes and escaping', () =>
        {
            expect( serializeString( 'hello' )).toBe( '"hello"' );
            expect( serializeString( 'hello "world"' )).toBe( '"hello \\"world\\""' );
        });

        it( 'should throw SerializationError for non-strings in serializeString', () =>
        {
            expect( () => serializeString( 123 as any )).toThrow( SerializationError );
        });

        it( 'should serialize Date objects to ISO strings', () =>
        {
            const d = new Date( '2026-01-01T00:00:00.000Z' );

            expect( serializeDate( d )).toBe( '"2026-01-01T00:00:00.000Z"' );
        });

        it( 'should throw SerializationError for invalid dates', () =>
        {
            expect( () => serializeDate( 'invalid-date' )).toThrow( SerializationError );
        });

        it( 'should serialize Uint8Array / Buffer to base64 JSON string', () =>
        {
            const buf = Buffer.from( 'hello' );

            expect( serializeBuffer( buf )).toBe( '"aGVsbG8="' );
        });

        it( 'should serialize arrays with item serializer', () =>
        {
            const res = serializeArray( [1, 2, 3], item => String( item ));

            expect( res ).toBe( '[1,2,3]' );
        });
    });

    describe( 'Serializer Generator Logic', () =>
    {
        function createDummyTypeChecker( typeFlags: ts.TypeFlags, isArray = false, isUnion = false, isObject = false )
        {
            const dummyType: any = {
                getFlags: () => typeFlags,
                isUnion: () => isUnion,
                getProperties: () => isObject ? [
                    { getName: () => 'id', flags: 0 },
                    { getName: () => 'name', flags: 0 }
                ] : []
            };

            const checker: any = {
                isArrayType: () => isArray,
                getTypeArguments: () => [{ getFlags: () => ts.TypeFlags.Number, isUnion: () => false }],
                getPropertyOfType: () => ({ flags: 0 })
            };

            return { dummyType, checker };
        }

        it( 'should generate string serializer code for string type', () =>
        {
            const { dummyType, checker } = createDummyTypeChecker( ts.TypeFlags.String );
            const code = generateSerializerCode( dummyType, checker );

            expect( code ).toContain( '__tcRuntime.serializeString' );
        });

        it( 'should generate number serializer code for number type', () =>
        {
            const { dummyType, checker } = createDummyTypeChecker( ts.TypeFlags.Number );
            const code = generateSerializerCode( dummyType, checker );

            expect( code ).toContain( 'typeof input === \'number\'' );
        });

        it( 'should generate array serializer code for Array type', () =>
        {
            const { dummyType, checker } = createDummyTypeChecker( ts.TypeFlags.Object, true );
            const code = generateSerializerCode( dummyType, checker );

            expect( code ).toContain( '__tcRuntime.serializeArray' );
        });

        it( 'should generate strict mode check for extra properties in object type', () =>
        {
            const { dummyType, checker } = createDummyTypeChecker( ts.TypeFlags.Object, false, false, true );
            const code = generateSerializerCode( dummyType, checker, { mode : 'strict' });

            expect( code ).toContain( 'Unexpected extra property in strict mode' );
        });

        it( 'should generate relaxed mode loop for extra properties in object type', () =>
        {
            const { dummyType, checker } = createDummyTypeChecker( ts.TypeFlags.Object, false, false, true );
            const code = generateSerializerCode( dummyType, checker, { mode : 'relaxed' });

            expect( code ).toContain( 'JSON.stringify( obj[k] )' );
        });
    });

    describe( 'Transformer Macro Compilation', () =>
    {
        const compile = ( code: string ) => compileAndTransform( code, 'temp_serializer_test' );

        it( 'should transform serializer<T>() into an inlined serializer function', () =>
        {
            const res = compile( `
                import { serializer } from './src/index.js';
                interface User { id: string; name: string }
                const ser = serializer<User>();
            ` );

            expect( res ).toContain( 'serializeString(obj.name)' );
        });

        it( 'should transform stringify<T>(val, "strict") into strict serializer invocation', () =>
        {
            const res = compile( `
                import { stringify } from './src/index.js';
                interface User { id: string; name: string }
                const u = { id: "1", name: "Alice" };
                const json = stringify<User>( u, "strict" );
            ` );

            expect( res ).toContain( 'Unexpected extra property in strict mode' );
        });
    });
});
