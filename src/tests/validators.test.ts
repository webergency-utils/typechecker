import { describe, it, expect, beforeEach } from 'vitest';
import { validators, MetadataStore } from '../runtime/validators.js';

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

        it('should validate custom validations', () => {
            const isEven = (val: number) => val % 2 === 0;
            
            expect(validators.custom(2, 'val', ctx, isEven)).toBe(2);
            expect(ctx.success).toBe(true);

            validators.custom(3, 'val', ctx, isEven);
            expect(ctx.success).toBe(false);
            expect(ctx.errors[0]).toEqual({ path: 'val', expected: 'Custom<isEven>', value: 3 });
        });

        it('should validate minLength and maxLength', () => {
            expect(validators.minLength('abc', 'path', ctx, 2)).toBe('abc');
            expect(ctx.success).toBe(true);

            validators.minLength('abc', 'path', ctx, 4);
            expect(ctx.success).toBe(false);
            expect(ctx.errors[0]).toEqual({ path: 'path', expected: 'MinLength<4>', value: 'abc' });

            ctx.success = true;
            ctx.errors = [];
            expect(validators.maxLength('abc', 'path', ctx, 4)).toBe('abc');
            expect(ctx.success).toBe(true);

            validators.maxLength('abc', 'path', ctx, 2);
            expect(ctx.success).toBe(false);
            expect(ctx.errors[0]).toEqual({ path: 'path', expected: 'MaxLength<2>', value: 'abc' });
        });

        it('should validate minimum, maximum, exclusiveMinimum, and exclusiveMaximum', () => {
            // Numbers
            expect(validators.minimum(10, 'path', ctx, 5)).toBe(10);
            expect(ctx.success).toBe(true);
            validators.minimum(10, 'path', ctx, 15);
            expect(ctx.success).toBe(false);

            ctx.success = true;
            expect(validators.maximum(10, 'path', ctx, 15)).toBe(10);
            expect(ctx.success).toBe(true);
            validators.maximum(10, 'path', ctx, 5);
            expect(ctx.success).toBe(false);

            ctx.success = true;
            expect(validators.exclusiveMinimum(10, 'path', ctx, 5)).toBe(10);
            expect(ctx.success).toBe(true);
            validators.exclusiveMinimum(10, 'path', ctx, 10);
            expect(ctx.success).toBe(false);

            ctx.success = true;
            expect(validators.exclusiveMaximum(10, 'path', ctx, 15)).toBe(10);
            expect(ctx.success).toBe(true);
            validators.exclusiveMaximum(10, 'path', ctx, 10);
            expect(ctx.success).toBe(false);

            // Bigints
            ctx.success = true;
            expect(validators.minimum(10n, 'path', ctx, 5n)).toBe(10n);
            expect(ctx.success).toBe(true);
            validators.minimum(10n, 'path', ctx, 15n);
            expect(ctx.success).toBe(false);
        });

        it('should validate multipleOf', () => {
            expect(validators.multipleOf(10, 'path', ctx, 5)).toBe(10);
            expect(ctx.success).toBe(true);
            validators.multipleOf(10, 'path', ctx, 3);
            expect(ctx.success).toBe(false);

            // Bigints
            ctx.success = true;
            expect(validators.multipleOf(10n, 'path', ctx, 5n)).toBe(10n);
            expect(ctx.success).toBe(true);
            validators.multipleOf(10n, 'path', ctx, 3n);
            expect(ctx.success).toBe(false);
        });

        it('should validate pattern', () => {
            expect(validators.pattern('hello', 'path', ctx, /^h/, 'starts with h')).toBe('hello');
            expect(ctx.success).toBe(true);

            validators.pattern('hello', 'path', ctx, /^a/, 'starts with a');
            expect(ctx.success).toBe(false);
        });

        it('should validate various formats', () => {
            const formats = [
                { format: 'email', valid: 'test@example.com', invalid: 'invalid-email' },
                { format: 'uuid', valid: '123e4567-e89b-12d3-a456-426614174000', invalid: 'invalid-uuid' },
                { format: 'url', valid: 'https://google.com', invalid: 'google.com' },
                { format: 'ipv4', valid: '192.168.1.1', invalid: '999.999.999.999' },
                { format: 'ipv6', valid: '2001:0db8:85a3:0000:0000:8a2e:0370:7334', invalid: 'invalid-ipv6' },
                { format: 'date', valid: '2026-05-17', invalid: '17-05-2026' },
                { format: 'date-time', valid: '2026-05-17T19:55:00.000Z', invalid: 'invalid-date-time' },
                { format: 'byte', valid: 'Zm9vYmFy', invalid: 'invalid-base64!' },
                { format: 'password', valid: 'anything-goes', invalid: '' }, // Password always passes
                { format: 'regex', valid: '^[a-z]+$', invalid: '[' },
                { format: 'hostname', valid: 'google.com', invalid: '-google.com' },
                { format: 'uri', valid: 'mailto:test@example.com', invalid: 'test@example.com' },
                { format: 'time', valid: '19:55:00Z', invalid: '19-55-00' },
                { format: 'duration', valid: 'P3D', invalid: 'invalid-duration' },
                { format: 'objectId', valid: '507f1f77bcf86cd799439011', invalid: 'invalid-object-id' }
            ];

            for (const f of formats) {
                ctx.success = true;
                ctx.errors = [];
                expect(validators.format(f.valid, 'path', ctx, f.format)).toBe(f.valid);
                expect(ctx.success).toBe(true);

                if (f.invalid) {
                    validators.format(f.invalid, 'path', ctx, f.format);
                    expect(ctx.success).toBe(false);
                }
            }
        });

        it('should validate minItems and maxItems', () => {
            expect(validators.minItems([1, 2], 'path', ctx, 2)).toEqual([1, 2]);
            expect(ctx.success).toBe(true);
            validators.minItems([1], 'path', ctx, 2);
            expect(ctx.success).toBe(false);

            ctx.success = true;
            expect(validators.maxItems([1, 2], 'path', ctx, 2)).toEqual([1, 2]);
            expect(ctx.success).toBe(true);
            validators.maxItems([1, 2, 3], 'path', ctx, 2);
            expect(ctx.success).toBe(false);
        });

        it('should validate uniqueItems', () => {
            expect(validators.uniqueItems([1, 2, 3], 'path', ctx)).toEqual([1, 2, 3]);
            expect(ctx.success).toBe(true);

            validators.uniqueItems([1, 2, 2], 'path', ctx);
            expect(ctx.success).toBe(false);

            ctx.success = true;
            // Objects uniqueness stringify check
            expect(validators.uniqueItems([{ a: 1 }, { b: 2 }], 'path', ctx)).toEqual([{ a: 1 }, { b: 2 }]);
            expect(ctx.success).toBe(true);

            validators.uniqueItems([{ a: 1 }, { a: 1 }], 'path', ctx);
            expect(ctx.success).toBe(false);
        });

        it('should support literal casting options', () => {
            // Null to boolean false
            ctx.tryConvert = true;
            expect(validators.literal(null, 'path', ctx, false)).toBe(false);
            expect(ctx.success).toBe(true);

            // String to number literal
            expect(validators.literal('123', 'path', ctx, 123)).toBe(123);
            expect(ctx.success).toBe(true);

            // String to boolean literal
            expect(validators.literal('true', 'path', ctx, true)).toBe(true);
            expect(validators.literal('yes', 'path', ctx, true)).toBe(true);
            expect(validators.literal('0', 'path', ctx, false)).toBe(false);
            expect(ctx.success).toBe(true);
        });

        it('should validate templateLiteral', () => {
            expect(validators.templateLiteral('abc', 'path', ctx, /^[a-z]+$/, 'lowercase')).toBe('abc');
            expect(ctx.success).toBe(true);

            validators.templateLiteral('123', 'path', ctx, /^[a-z]+$/, 'lowercase');
            expect(ctx.success).toBe(false);

            ctx.success = true;
            validators.templateLiteral(123, 'path', ctx, /^[a-z]+$/, 'lowercase');
            expect(ctx.success).toBe(false);
        });

        it('should validate array with wrapArrays option', () => {
            ctx.wrapArrays = true;
            const result = validators.array(123, 'path', ctx, validators.number);
            expect(result).toEqual([123]);
            expect(ctx.success).toBe(true);
        });

        it('should validate any validator', () => {
            expect(validators.any('anything')).toBe('anything');
            expect(validators.any(123)).toBe(123);
        });

        it('should manage schema and validator registration in MetadataStore', () => {
            // Validator
            const dummyVal = () => {};
            MetadataStore.registerValidator('h1', dummyVal);
            expect(MetadataStore.getValidator('h1')).toBe(dummyVal);
            expect(() => MetadataStore.getValidator('h2')).toThrow('Validator not found');

            // Schema
            const dummySchema = { type: 'string' };
            MetadataStore.registerSchema('s1', dummySchema);
            expect(MetadataStore.getSchema('s1')).toBe(dummySchema);
            expect(() => MetadataStore.getSchema('s2')).toThrow('Schema not found');
        });

        it('should validate bigint and bigint tryConvert conversions', () => {
            expect(validators.bigint(123n, 'path', ctx)).toBe(123n);
            expect(ctx.success).toBe(true);

            // Without tryConvert, numeric string should fail
            validators.bigint('123', 'path', ctx);
            expect(ctx.success).toBe(false);

            // With tryConvert, numeric string should pass and cast
            ctx.success = true;
            ctx.errors = [];
            ctx.tryConvert = true;
            expect(validators.bigint('123', 'path', ctx)).toBe(123n);
            expect(ctx.success).toBe(true);

            // tryConvert fails with invalid string
            ctx.success = true;
            validators.bigint('invalid-bigint', 'path', ctx);
            expect(ctx.success).toBe(false);
        });

        it('should validate regexp and regexp tryConvert conversions', () => {
            const rx = /abc/i;
            expect(validators.regexp(rx, 'path', ctx)).toBe(rx);
            expect(ctx.success).toBe(true);

            // Without tryConvert, string should fail
            validators.regexp('/abc/i', 'path', ctx);
            expect(ctx.success).toBe(false);

            // With tryConvert, matching regex string `/abc/i` should parse
            ctx.success = true;
            ctx.errors = [];
            ctx.tryConvert = true;
            const parsed1 = validators.regexp('/abc/i', 'path', ctx);
            expect(parsed1).toBeInstanceOf(RegExp);
            expect(parsed1.source).toBe('abc');
            expect(parsed1.flags).toBe('i');
            expect(ctx.success).toBe(true);

            // With tryConvert, plain string should compile to simple regex
            const parsed2 = validators.regexp('abc', 'path', ctx);
            expect(parsed2).toBeInstanceOf(RegExp);
            expect(parsed2.source).toBe('abc');
            expect(ctx.success).toBe(true);

            // With tryConvert, invalid regex should fail
            ctx.success = true;
            validators.regexp('[', 'path', ctx);
            expect(ctx.success).toBe(false);
        });

        it('should fallback on default format switch case', () => {
            expect(validators.format('anything', 'path', ctx, 'unknown-format')).toBe('anything');
            expect(ctx.success).toBe(true);
        });
    });

    describe('Dynamic Runtime Schema Validation', () => {
        it('should compile and validate simple and complex schemas at runtime', () => {
            const schema = {
                type: "object",
                properties: {
                    name: { type: "string", minLength: 2 },
                    age: { type: "number", minimum: 18 },
                    tags: { type: "array", items: { type: "string" }, uniqueItems: true },
                    active: { type: "boolean" },
                    nullField: { type: "null" },
                    kind: { const: "member" },
                    role: { anyOf: [{ const: "admin" }, { const: "user" }] }
                },
                required: ["name", "age"]
            };

            const validateFn = MetadataStore.getOrCompileSchema(schema);

            // Valid payload
            ctx.success = true;
            ctx.errors = [];
            const validPayload = {
                name: "Tom",
                age: 20,
                tags: ["web", "dev"],
                active: true,
                nullField: null,
                kind: "member",
                role: "admin"
            };
            const result1 = validateFn(validPayload, 'path', ctx);
            expect(ctx.success).toBe(true);
            expect(result1.name).toBe("Tom");

            // Invalid payload
            ctx.success = true;
            ctx.errors = [];
            const invalidPayload = {
                name: "T",
                age: 15,
                tags: ["web", "web"],
                active: "yes",
                nullField: 123,
                kind: "guest",
                role: "superadmin"
            };
            validateFn(invalidPayload, 'path', ctx);
            expect(ctx.success).toBe(false);
            expect(ctx.errors.length).toBeGreaterThan(0);
        });

        it('should support dynamic schema validation for circular structures', () => {
            const circularSchema = {
                $defs: {
                    Node: {
                        type: "object",
                        properties: {
                            value: { type: "string" },
                            next: { $ref: "#/$defs/Node" }
                        },
                        required: ["value"]
                    }
                },
                $ref: "#/$defs/Node"
            };

            const validateFn = MetadataStore.getOrCompileSchema(circularSchema);

            ctx.success = true;
            ctx.errors = [];
            const circularData = {
                value: "root",
                next: {
                    value: "child",
                    next: {
                        value: "grandchild"
                    }
                }
            };
            const result = validateFn(circularData, 'path', ctx);
            expect(ctx.success).toBe(true);
            expect(result.next.next.value).toBe("grandchild");
        });
    });
});

