import { describe, it, expect } from 'vitest';
import { validators, ValidationContext } from '../runtime/validators.js';

describe('Requires Validation Unit Tests', () => {
    const createCtx = (root: any): ValidationContext => ({
        success: true,
        errors: [],
        mode: 'relaxed',
        root
    });

    it('should validate absolute required paths when field is present', () => {
        const data = { host: 'localhost', port: 80 };
        const ctx = createCtx(data);
        
        validators.requires(data.port, 'port', ctx, ['host']);
        expect(ctx.success).toBe(true);

        const dataMissing = { port: 80 };
        const ctxMissing = createCtx(dataMissing);
        validators.requires(dataMissing.port, 'port', ctxMissing, ['host']);
        expect(ctxMissing.success).toBe(false);
        expect(ctxMissing.errors[0].error).toBe("Requires<host>");
    });

    it('should skip validation if the field itself is undefined or null', () => {
        const data = {};
        const ctx = createCtx(data);
        
        validators.requires(undefined, 'port', ctx, ['host']);
        expect(ctx.success).toBe(true);
    });

    it('should resolve and validate relative sibling paths (.path)', () => {
        const data = {
            profile: {
                details: {
                    email: 'test@example.com',
                    password: 'secret'
                }
            }
        };

        const ctx = createCtx(data);
        // Current path of email is "profile.details.email". Target is ".password".
        // Password is at "profile.details.password".
        validators.requires(data.profile.details.email, 'profile.details.email', ctx, ['.password']);
        expect(ctx.success).toBe(true);

        const dataMissing = {
            profile: {
                details: {
                    email: 'test@example.com'
                }
            }
        };
        const ctxMissing = createCtx(dataMissing);
        validators.requires(dataMissing.profile.details.email, 'profile.details.email', ctxMissing, ['.password']);
        expect(ctxMissing.success).toBe(false);
        expect(ctxMissing.errors[0].path).toBe('profile.details.email');
        expect(ctxMissing.errors[0].error).toBe('Requires<.password>');
    });

    it('should resolve and validate relative grandparent/cousin paths (..path)', () => {
        const data = {
            profile: {
                status: 'active',
                details: {
                    email: 'test@example.com'
                }
            }
        };

        const ctx = createCtx(data);
        // Current path of email is "profile.details.email". Target is "..status".
        // status is at "profile.status".
        validators.requires(data.profile.details.email, 'profile.details.email', ctx, ['..status']);
        expect(ctx.success).toBe(true);

        const dataMissing = {
            profile: {
                details: {
                    email: 'test@example.com'
                }
            }
        };
        const ctxMissing = createCtx(dataMissing);
        validators.requires(dataMissing.profile.details.email, 'profile.details.email', ctxMissing, ['..status']);
        expect(ctxMissing.success).toBe(false);
        expect(ctxMissing.errors[0].error).toBe('Requires<..status>');
    });

    it('should supply { parent, root, path } context parameter to custom validation functions', () => {
        const data = {
            username: 'alice',
            auth: {
                password: 'password123'
            }
        };
        const ctx = createCtx(data);
        
        let passedParent: any;
        let passedRoot: any;
        let passedPath: string = '';

        const customFn = (val: any, context: any) => {
            passedParent = context.parent;
            passedRoot = context.root;
            passedPath = context.path;
            return val === 'password123';
        };

        validators.custom(data.auth.password, 'auth.password', ctx, customFn);
        expect(ctx.success).toBe(true);
        expect(passedParent).toEqual({ password: 'password123' });
        expect(passedRoot).toEqual(data);
        expect(passedPath).toBe('auth.password');
    });

    it('should supply index parameter in context if the field is the array item itself', () => {
        const data = {
            items: [
                { id: '1', score: 99 },
                { id: '2', score: 100 }
            ]
        };
        const ctx = createCtx(data);

        let passedIndex: number | undefined;

        const customFn = (val: any, context: any) => {
            passedIndex = context.index;
            return typeof val === 'object';
        };

        // Path ends with [1], so it's the array item itself
        validators.custom(data.items[1], 'items[1]', ctx, customFn);
        expect(ctx.success).toBe(true);
        expect(passedIndex).toBe(1);

        // Path does not end with [1] (nested property), so index should be undefined
        let passedNestedIndex: number | undefined;
        const customNestedFn = (val: any, context: any) => {
            passedNestedIndex = context.index;
            return val > 90;
        };
        validators.custom(data.items[1].score, 'items[1].score', ctx, customNestedFn);
        expect(ctx.success).toBe(true);
        expect(passedNestedIndex).toBeUndefined();
    });
});
