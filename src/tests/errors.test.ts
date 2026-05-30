import { describe, it, expect } from 'vitest';
import { validators, ValidationContext } from '../runtime/validators.js';

describe('Error Reporting Unit Tests', () => {
    const createCtx = (mode: any = 'relaxed'): ValidationContext => ({
        success: true,
        errors: [],
        mode
    });

    it('should report multiple sibling errors in objects', () => {
        const ctx = createCtx();
        const v = { name: 123, age: 'abc' };
        
        // Mocking a generated validator for { name: string, age: number }
        validators.props(v, v, 'user', ctx, [
            ['name', false, validators.string],
            ['age', false, validators.number]
        ]);

        expect(ctx.success).toBe(false);
        expect(ctx.errors).toHaveLength(2);
        expect(ctx.errors[0]).toEqual({ path: 'user.name', error: "Type<string>", value: 123 });
        expect(ctx.errors[1]).toEqual({ path: 'user.age', error: "Type<number>", value: 'abc' });
    });

    it('should resolve nested paths correctly', () => {
        const ctx = createCtx();
        const v = { info: { address: { street: 123 } } };
        
        const addressValidator = (v: any, path: string, ctx: any) => {
            if (!validators.object(v, path, ctx)) return v;
            validators.props(v, v, path, ctx, [['street', false, validators.string]]);
            return v;
        };

        const infoValidator = (v: any, path: string, ctx: any) => {
            if (!validators.object(v, path, ctx)) return v;
            validators.props(v, v, path, ctx, [['address', false, addressValidator]]);
            return v;
        };

        validators.props(v, v, 'root', ctx, [['info', false, infoValidator]]);

        expect(ctx.success).toBe(false);
        expect(ctx.errors[0].path).toBe('root.info.address.street');
        expect(ctx.errors[0].error).toBe('Type<string>');
        expect(ctx.errors[0].value).toBe(123);
    });

    it('should report all errors in a failing union', () => {
        const ctx = createCtx();
        const v = true;
        
        // Union of string | number
        validators.union(v, 'val', ctx, [validators.string, validators.number]);

        expect(ctx.success).toBe(false);
        // Should have 3 errors: union itself + string branch + number branch
        expect(ctx.errors).toHaveLength(3);
        expect(ctx.errors[0].error).toBe('Type<Union>');
        expect(ctx.errors[1].error).toBe('Type<string>');
        expect(ctx.errors[2].error).toBe('Type<number>');
    });

    it('should report multiple errors in arrays', () => {
        const ctx = createCtx();
        const v = ['a', 1, 'b', 2];
        
        // Array of strings
        validators.array(v, 'tags', ctx, validators.string);

        expect(ctx.success).toBe(false);
        expect(ctx.errors).toHaveLength(2);
        expect(ctx.errors[0].path).toBe('tags[1]');
        expect(ctx.errors[1].path).toBe('tags[3]');
    });

    it('should report unknown properties in strict mode', () => {
        const ctx = createCtx('strict');
        const v = { name: 'John', extra: 'bad' };
        
        validators.object(v, 'user', ctx, ['name']);

        expect(ctx.success).toBe(false);
        expect(ctx.errors[0]).toEqual({
            path: 'user',
            error: 'PropertyNotAllowed<extra>',
            value: 'bad'
        });
    });

    it('should stop at depth if parent type is wrong', () => {
        const ctx = createCtx();
        const v = { info: 'not-an-object' };
        
        const infoValidator = (v: any, path: string, ctx: any) => {
            if (!validators.object(v, path, ctx)) return v; // Should exit here
            validators.props(v, v, path, ctx, [['first', false, validators.string]]);
            return v;
        };

        validators.props(v, v, 'root', ctx, [['info', false, infoValidator]]);

        expect(ctx.success).toBe(false);
        expect(ctx.errors).toHaveLength(1);
        expect(ctx.errors[0].path).toBe('root.info');
        expect(ctx.errors[0].error).toBe('Type<Object>');
    });
});
