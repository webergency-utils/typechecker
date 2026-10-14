import { describe, it, expect } from 'vitest';
import { emitAndImport } from './helpers/compile.js';
import { validate, type IValidation } from '../src/index.js';

describe( 'Custom Messages on Constraints and Tag', () =>
{
    it( 'uses custom message from constraint type parameter', async() =>
    {
        const mod = await emitAndImport<{
            validateUser : ( input: unknown ) => IValidation<any>
        }>( `
            import { validate, constraint } from '../src/index.js';
            interface User {
                username: string & constraint.MinLength<5, 'Username must be at least 5 characters'>;
            }
            export const validateUser = ( input: unknown ) => validate<User>( input );
        `, 'temp_msg_constraint_param' );

        const res = mod.validateUser({ username : 'abc' });
        expect( res.success ).toBe( false );
        expect( res.errors?.[0].error ).toBe( 'Username must be at least 5 characters' );
    });

    it( 'uses custom message from Tag<T, C, V, Msg>', async() =>
    {
        const mod = await emitAndImport<{
            validateAge : ( input: unknown ) => IValidation<any>
        }>( `
            import { validate, Tag } from '../src/index.js';
            interface Person {
                age: Tag<number, 'minimum', 18, 'You must be at least 18 years old'>;
            }
            export const validateAge = ( input: unknown ) => validate<Person>( input );
        `, 'temp_msg_tag_param' );

        const res = mod.validateAge({ age : 16 });
        expect( res.success ).toBe( false );
        expect( res.errors?.[0].error ).toBe( 'You must be at least 18 years old' );

        const ok = mod.validateAge({ age : 20 });
        expect( ok.success ).toBe( true );
    });

    it( 'falls back to Message<Msg> override when present', async() =>
    {
        const mod = await emitAndImport<{
            validatePin : ( input: unknown ) => IValidation<any>
        }>( `
            import { validate, constraint } from '../src/index.js';
            interface Card {
                pin: string & constraint.MinLength<4> & constraint.Message<'Invalid PIN format'>;
            }
            export const validatePin = ( input: unknown ) => validate<Card>( input );
        `, 'temp_msg_fallback' );

        const res = mod.validatePin({ pin : '12' });
        expect( res.success ).toBe( false );
        expect( res.errors?.[0].error ).toBe( 'Invalid PIN format' );
    });
});
