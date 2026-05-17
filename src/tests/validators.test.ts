import { describe, it, expect, beforeEach } from 'vitest';
import { validators } from '../runtime/validators.js';

describe('Validators', () => {
    let ctx: any;

    beforeEach(() => {
        ctx = { success: true, errors: [], mode: 'strict' };
    });

    describe('Primitives', () => {
        it('should validate strings', () => {
            expect(validators.string('hello', 'path', ctx)).toBe('hello');
            expect(ctx.success).toBe(true);

            validators.string(123, 'path', ctx);
            expect(ctx.success).toBe(false);
            expect(ctx.errors[0]).toEqual({ path: 'path', expected: 'string', value: 123 });
        });

        it('should validate numbers (including casting)', () => {
            expect(validators.number(123, 'path', ctx)).toBe(123);
            expect(ctx.success).toBe(true);

            // Without tryConvert, numeric string should fail
            validators.number('123', 'path', ctx);
            expect(ctx.success).toBe(false);

            // With tryConvert, numeric string should now pass and return a number
            ctx.success = true;
            ctx.errors = [];
            ctx.tryConvert = true;
            expect(validators.number('123', 'path', ctx)).toBe(123);
            expect(ctx.success).toBe(true);

            ctx.success = true;
            ctx.errors = [];
            validators.number('not-a-number', 'path', ctx);
            expect(ctx.success).toBe(false);
            expect(ctx.errors[0]).toEqual({ path: 'path', expected: 'number', value: 'not-a-number' });
        });

        it('should validate booleans (including casting)', () => {
            expect(validators.boolean(true, 'path', ctx)).toBe(true);
            expect(ctx.success).toBe(true);

            // Without tryConvert, boolean string should fail
            validators.boolean('true', 'path', ctx);
            expect(ctx.success).toBe(false);

            // With tryConvert, boolean string should pass and cast
            ctx.success = true;
            ctx.errors = [];
            ctx.tryConvert = true;
            expect(validators.boolean('true', 'path', ctx)).toBe(true);
            expect(validators.boolean('false', 'path', ctx)).toBe(false);
            expect(ctx.success).toBe(true);

            ctx.success = true;
            ctx.errors = [];
            validators.boolean('not-a-bool', 'path', ctx);
            expect(ctx.success).toBe(false);
            expect(ctx.errors[0]).toEqual({ path: 'path', expected: 'boolean', value: 'not-a-bool' });
        });

        it('should validate dates', () => {
            const now = new Date();
            expect(validators.date(now, 'path', ctx)).toBe(now);
            
            // Should parse ISO strings with tryConvert
            ctx.tryConvert = true;
            const iso = now.toISOString();
            const parsed = validators.date(iso, 'path', ctx);
            expect(parsed).toBeInstanceOf(Date);
            expect(parsed.getTime()).toBe(now.getTime());

            ctx.tryConvert = false;
            ctx.success = true;
            validators.date('invalid', 'path', ctx);
            expect(ctx.success).toBe(false);
            expect(ctx.errors[0]).toEqual({ path: 'path', expected: 'Date', value: 'invalid' });
        });

        it('should validate null and undefined', () => {
            expect(validators.null(null, 'path', ctx)).toBe(null);
            expect(validators.undefined(undefined, 'path', ctx)).toBe(undefined);
            
            validators.null(undefined, 'path', ctx);
            expect(ctx.success).toBe(false);

            ctx.success = true;
            ctx.errors = [];
            validators.undefined(null, 'path', ctx);
            expect(ctx.success).toBe(false);
            expect(ctx.errors[0]).toEqual({ path: 'path', expected: 'undefined', value: null });
        });

        it('should validate literals', () => {
            expect(validators.literal('A', 'path', ctx, 'A')).toBe('A');
            
            validators.literal('A', 'path', ctx, 'B');
            expect(ctx.success).toBe(false);
            expect(ctx.errors[0]).toEqual({ path: 'path', expected: 'literal B', value: 'A' });
        });
    });

    describe('Structural', () => {
        it('should validate arrays', () => {
            const input = [1, 2, 3];
            const result = validators.array(input, 'arr', ctx, validators.number);
            expect(result).toEqual(input);
            expect(ctx.success).toBe(true);

            // Test non-array input
            validators.array('not-an-array', 'arr', ctx, validators.number);
            expect(ctx.success).toBe(false);
            expect(ctx.errors[0]).toEqual({ path: 'arr', expected: 'array', value: 'not-an-array' });

            // Test child validator failure
            ctx.success = true;
            ctx.errors = [];
            validators.array([1, 'not-a-number'], 'arr', ctx, validators.number);
            expect(ctx.success).toBe(false);
            expect(ctx.errors[0]).toEqual({ path: 'arr[1]', expected: 'number', value: 'not-a-number' });
        });

        it('should validate arrays (strip mode)', () => {
            ctx.mode = 'strip';
            const input = [1, 2, 3];
            const result = validators.array(input, 'arr', ctx, validators.number);
            expect(result).toEqual(input);
            expect(result).not.toBe(input); // Should be a copy
        });

        it('should validate base objects', () => {
            expect(validators.object({ a: 1 }, 'obj', ctx)).toBe(true);
            
            validators.object(null, 'obj', ctx);
            expect(ctx.success).toBe(false);

            ctx.success = true;
            validators.object('not-an-obj', 'obj', ctx);
            expect(ctx.success).toBe(false);
        });

        it('should validate props (strict mode)', () => {
            const input = { id: 1, name: 'Test', extra: 'bad' };
            
            // Check base object first (strict mode should catch 'extra')
            validators.object(input, 'user', ctx, ['id', 'name']);
            expect(ctx.success).toBe(false);
            expect(ctx.errors[0]).toEqual({ path: 'user', expected: 'property not allowed: extra', value: 'bad' });

            // Test missing required prop
            ctx.success = true;
            ctx.errors = [];
            validators.props({ id: 1 }, {}, 'user', ctx, [
                ['id', false, validators.number],
                ['name', false, validators.string]
            ]);
            expect(ctx.success).toBe(false);
            expect(ctx.errors[0]).toEqual({ path: 'user.name', expected: 'string', value: undefined });
        });

        it('should validate props (optional)', () => {
            const input = { id: 1 };
            const data = {};
            validators.props(input, data, 'user', ctx, [
                ['id', false, validators.number],
                ['email', true, validators.string] // Optional missing
            ]);
            expect(ctx.success).toBe(true);
        });

        it('should validate props (relaxed mode)', () => {
            ctx.mode = 'relaxed';
            const input = { id: 1, name: 'Test', extra: 'ok' };
            
            const isValid = validators.object(input, 'user', ctx, ['id', 'name']);
            expect(isValid).toBe(true);
            expect(ctx.success).toBe(true);
        });

        it('should validate props (strip mode)', () => {
            ctx.mode = 'strip';
            const input = { id: 1, name: 'Test', extra: 'remove me' };
            const data: any = {};
            
            validators.props(input, data, 'user', ctx, [
                ['id', false, validators.number],
                ['name', false, validators.string]
            ]);

            expect(data).toEqual({ id: 1, name: 'Test' });
            expect(data.extra).toBeUndefined();
        });

        it('should validate unions', () => {
            const checks = [validators.string, validators.number];
            
            expect(validators.union('test', 'u', ctx, checks)).toBe('test');
            expect(validators.union(123, 'u', ctx, checks)).toBe(123);
            
            validators.union(true, 'u', ctx, checks);
            expect(ctx.success).toBe(false);
            expect(ctx.errors[0].expected).toBe('union');
        });

        it('should validate tuples', () => {
            const checks = [validators.string, validators.number];
            const input = ['id', 1];
            
            expect(validators.tuple(input, 't', ctx, checks)).toEqual(input);
            
            // Test wrong length
            validators.tuple(['id'], 't', ctx, checks);
            expect(ctx.success).toBe(false);
            expect(ctx.errors[0]).toEqual({ path: 't', expected: 'tuple of length 2', value: ['id'] });

            // Test non-array input
            ctx.success = true;
            ctx.errors = [];
            validators.tuple('not-a-tuple', 't', ctx, checks);
            expect(ctx.success).toBe(false);

            // Test child failure
            ctx.success = true;
            ctx.errors = [];
            validators.tuple(['id', 'not-a-number'], 't', ctx, checks);
            expect(ctx.success).toBe(false);
            expect(ctx.errors[0]).toEqual({ path: 't[1]', expected: 'number', value: 'not-a-number' });
        });

        it('should validate tuples (strip mode)', () => {
            ctx.mode = 'strip';
            const checks = [validators.string, validators.number];
            const input = ['id', 1];
            const result = validators.tuple(input, 't', ctx, checks);
            expect(result).toEqual(input);
            expect(result).not.toBe(input); // Should be a copy
        });
    });
});
