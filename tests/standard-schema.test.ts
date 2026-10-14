import { describe, it, expect } from 'vitest';
import { emitAndImport } from './helpers/compile.js';
import { compileSchema, createStandardSchema, type StandardSchemaV1 } from '../src/index.js';

describe( 'Standard Schema v1 (~standard)', () =>
{
    it( 'creates a valid Standard Schema v1 object via standardSchema<T>() macro', async() =>
    {
        const mod = await emitAndImport<{
            schema : StandardSchemaV1<unknown, { name : string, age : number }>
        }>( `
            import { standardSchema, constraint } from '../src/index.js';
            interface User {
                name: string;
                age: number & constraint.Minimum<18>;
            }
            export const schema = standardSchema<User>();
        `, 'temp_standard_schema_macro' );

        const s = mod.schema;
        expect( s['~standard']).toBeDefined();
        expect( s['~standard'].version ).toBe( 1 );
        expect( s['~standard'].vendor ).toBe( 'webergency-typechecker' );
        expect( typeof s['~standard'].validate ).toBe( 'function' );

        // Success case
        const validRes = s['~standard'].validate({ name : 'Alice', age : 25 });
        expect( 'value' in validRes ).toBe( true );

        if( 'value' in validRes )
        {
            expect( validRes.value ).toEqual({ name : 'Alice', age : 25 });
            expect( validRes.issues ).toBeUndefined();
        }

        // Failure case
        const invalidRes = s['~standard'].validate({ name : 'Bob', age : 15 });
        expect( 'issues' in invalidRes ).toBe( true );

        if( 'issues' in invalidRes )
        {
            expect( invalidRes.issues.length ).toBeGreaterThan( 0 );
            expect( invalidRes.issues[0].message ).toBeDefined();
            expect( invalidRes.issues[0].path ).toEqual(['age']);
        }
    });

    it( 'supports options passed to standardSchema<T>()', async() =>
    {
        const mod = await emitAndImport<{
            schema : StandardSchemaV1<unknown, { id : number }>
        }>( `
            import { standardSchema } from '../src/index.js';
            interface Item {
                id: number;
            }
            export const schema = standardSchema<Item>( 'relaxed' );
        `, 'temp_standard_schema_options' );

        const res = mod.schema['~standard'].validate({ id : 1, extra : 'ok' });
        expect( 'value' in res ).toBe( true );
    });

    it( 'attaches ~standard to compiled JSON schema validator function', () =>
    {
        const compiled = compileSchema({
            type       : 'object',
            properties : {
                title : { type : 'string' }
            },
            required : ['title']
        }) as any;

        expect( compiled['~standard']).toBeDefined();
        expect( compiled['~standard'].version ).toBe( 1 );
        expect( compiled['~standard'].vendor ).toBe( 'webergency-typechecker' );

        const ok = compiled['~standard'].validate({ title : 'Hello' });
        expect( ok.value ).toEqual({ title : 'Hello' });

        const fail = compiled['~standard'].validate({ title : 123 });
        expect( fail.issues ).toBeDefined();
        expect( fail.issues[0].path ).toEqual(['title']);
    });

    it( 'directly uses createStandardSchema helper on custom validator function', () =>
    {
        const customValidator = ( v: any, path: any, ctx: any ) =>
        {
            if( typeof v !== 'string' )
            {
                ctx.errors.push({ path, error : 'ExpectedString', value : v });
                ctx.success = false;
            }

            return v;
        };

        const standard = createStandardSchema( customValidator );
        const successRes = standard['~standard'].validate( 'hello' );
        expect( successRes ).toEqual({ value : 'hello' });

        const failRes = standard['~standard'].validate( 123 );
        expect( 'issues' in failRes ).toBe( true );

        if( 'issues' in failRes )
        {
            expect( failRes.issues.length ).toBe( 1 );
            expect( failRes.issues[0].message ).toBe( 'ExpectedString' );
        }
    });
});
