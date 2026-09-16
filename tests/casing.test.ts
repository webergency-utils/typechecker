import { describe, it, expect } from 'vitest';
import { convertPropertyCasing } from '../src/runtime/casing.js';

describe( 'Casing Conversion Utilities', () => 
{
    const original = 
    {
        user_id       : '123',
        firstName     : 'John',
        LastName      : 'Doe',
        'is-active'   : true,
        SOME_CONSTANT : 'value',
        'home.address' : 
        {
            street_name : 'Main St',
            ZipCode     : '12345'
        }
    };

    it( 'should convert to snake_case', () => 
    {
        const result = convertPropertyCasing( original, 'snake_case' );
        
        expect( result ).toEqual(
            {
                user_id       : '123',
                first_name    : 'John',
                last_name     : 'Doe',
                is_active     : true,
                some_constant : 'value',
                home_address : 
            {
                street_name : 'Main St',
                zip_code    : '12345'
            }
            });
    });

    it( 'should convert to SNAKE_CASE', () => 
    {
        const result = convertPropertyCasing( original, 'SNAKE_CASE' );
        
        expect( result ).toEqual(
            {
                USER_ID       : '123',
                FIRST_NAME    : 'John',
                LAST_NAME     : 'Doe',
                IS_ACTIVE     : true,
                SOME_CONSTANT : 'value',
                HOME_ADDRESS : 
            {
                STREET_NAME : 'Main St',
                ZIP_CODE    : '12345'
            }
            });
    });

    it( 'should convert to camelCase', () => 
    {
        const result = convertPropertyCasing( original, 'camelCase' );
        
        expect( result ).toEqual(
            {
                userId       : '123',
                firstName    : 'John',
                lastName     : 'Doe',
                isActive     : true,
                someConstant : 'value',
                homeAddress : 
            {
                streetName : 'Main St',
                zipCode    : '12345'
            }
            });
    });

    it( 'should convert to camelCaseID', () => 
    {
        const result = convertPropertyCasing( original, 'camelCaseID' );
        
        expect( result ).toEqual(
            {
                userID       : '123',
                firstName    : 'John',
                lastName     : 'Doe',
                isActive     : true,
                someConstant : 'value',
                homeAddress : 
            {
                streetName : 'Main St',
                zipCode    : '12345'
            }
            });
    });

    it( 'should convert to PascalCase', () => 
    {
        const result = convertPropertyCasing( original, 'PascalCase' );
        
        expect( result ).toEqual(
            {
                UserId       : '123',
                FirstName    : 'John',
                LastName     : 'Doe',
                IsActive     : true,
                SomeConstant : 'value',
                HomeAddress : 
            {
                StreetName : 'Main St',
                ZipCode    : '12345'
            }
            });
    });

    it( 'should convert to PascalCaseID', () => 
    {
        const result = convertPropertyCasing( original, 'PascalCaseID' );
        
        expect( result ).toEqual(
            {
                UserID       : '123',
                FirstName    : 'John',
                LastName     : 'Doe',
                IsActive     : true,
                SomeConstant : 'value',
                HomeAddress : 
            {
                StreetName : 'Main St',
                ZipCode    : '12345'
            }
            });
    });

    it( 'should convert to kebab-case', () => 
    {
        const result = convertPropertyCasing( original, 'kebab-case' );
        
        expect( result ).toEqual(
            {
                'user-id'       : '123',
                'first-name'    : 'John',
                'last-name'     : 'Doe',
                'is-active'     : true,
                'some-constant' : 'value',
                'home-address' : 
            {
                'street-name' : 'Main St',
                'zip-code'    : '12345'
            }
            });
    });

    it( 'should convert to dot.case', () => 
    {
        const result = convertPropertyCasing( original, 'dot.case' );
        
        expect( result ).toEqual(
            {
                'user.id'       : '123',
                'first.name'    : 'John',
                'last.name'     : 'Doe',
                'is.active'     : true,
                'some.constant' : 'value',
                'home.address' : 
            {
                'street.name' : 'Main St',
                'zip.code'    : '12345'
            }
            });
    });

    it( 'should handle arrays', () => 
    {
        const arr = [{ user_id : 1 }, { user_id : 2 }];
        const result = convertPropertyCasing( arr, 'camelCaseID' );
        
        expect( result ).toEqual([{ userID : 1 }, { userID : 2 }]);
    });

    it( 'should preserve leading and trailing special characters by default', () => 
    {
        const obj = { '__user_id__' : 1, '$_first-name' : 2 };
        const result = convertPropertyCasing( obj, 'camelCase' );
        
        expect( result ).toEqual({ '__userId__' : 1, '$_firstName' : 2 });
    });

    it( 'should strip leading and trailing special characters when preserveEnds is false', () => 
    {
        const obj = { '__user_id__' : 1, '$_first-name' : 2 };
        const result = convertPropertyCasing( obj, 'camelCase', { preserveEnds : false });
        
        expect( result ).toEqual({ 'userId' : 1, 'firstName' : 2 });
    });

    it( 'should gracefully handle primitives and non-plain objects', () => 
    {
        const date = new Date();
        const obj = { created_at : date };
        
        const result = convertPropertyCasing( obj, 'camelCase' );
        
        expect( result.createdAt ).toBe( date );
        expect( convertPropertyCasing( null as any, 'camelCase' )).toBeNull();
        expect( convertPropertyCasing( 'string' as any, 'camelCase' )).toBe( 'string' );
    });

    it( 'should fallback gracefully on unknown casing format', () => 
    {
        const obj = { user_id : 1 };
        const result = convertPropertyCasing( obj, 'UNKNOWN_FORMAT' as any );
        
        // When unknown, it normalizes and strips underscores, returning core string without further transformations
        expect( result ).toEqual({ user_id : 1 });
    });

    it( 'should reject key collisions instead of silently discarding data', () =>
    {
        expect(() => convertPropertyCasing(
            { user_id : 1, userId : 2 },
            'camelCase'
        )).toThrow( 'Casing conversion collision: user_id and userId both map to userId' );
    });

    it( 'should convert id property to ID for camelCaseID and PascalCaseID', () =>
    {
        const input = { id : 'abc', user_id : '123' };
        expect( convertPropertyCasing( input, 'camelCaseID' )).toEqual({ ID : 'abc', userID : '123' });
        expect( convertPropertyCasing( input, 'PascalCaseID' )).toEqual({ ID : 'abc', UserID : '123' });
    });

    it( 'should preserve Buffer, Uint8Array, and ArrayBuffer without recursion', () =>
    {
        const buf = Buffer.from( 'hello' );
        const u8 = new Uint8Array([1, 2, 3]);
        const i32 = new Int32Array([4, 5, 6]);
        const ab = new ArrayBuffer( 8 );

        const input = {
            raw_buffer : buf,
            byte_array : u8,
            int_array  : i32,
            buffer_mem : ab
        };

        const result = convertPropertyCasing( input, 'camelCase' );
        expect( result.rawBuffer ).toBe( buf );
        expect( result.byteArray ).toBe( u8 );
        expect( result.intArray ).toBe( i32 );
        expect( result.bufferMem ).toBe( ab );
    });
});
