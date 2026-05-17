export type ValidationMode = 'strict' | 'relaxed' | 'strip';

export interface IValidationError {
    path: string;
    expected: string;
    value: any;
}

export interface ValidationContext {
    success: boolean;
    errors: IValidationError[];
    mode: ValidationMode;
    tryConvert?: boolean;
    wrapArrays?: boolean;
}

const report = (ctx: ValidationContext, path: string, expected: string, value: any) => {
    ctx.success = false;
    ctx.errors.push({ path, expected, value });
};

export const validators = {
    string: (v: any, path: string, ctx: ValidationContext) => {
        if (typeof v !== "string") {
            report(ctx, path, "string", v);
        }
        return v;
    },

    number: (v: any, path: string, ctx: ValidationContext) => {
        if (typeof v !== "number") {
            if (ctx.tryConvert && typeof v === "string" && v.trim() !== "") {
                const parsed = parseFloat(v);
                if (!isNaN(parsed)) return parsed;
            }
            report(ctx, path, "number", v);
        }
        return v;
    },

    bigint: (v: any, path: string, ctx: ValidationContext) => {
        if (typeof v !== "bigint") {
            if (ctx.tryConvert && typeof v === "string" && v.trim() !== "") {
                try {
                    return BigInt(v);
                } catch (e) {}
            }
            report(ctx, path, "bigint", v);
        }
        return v;
    },

    boolean: (v: any, path: string, ctx: ValidationContext) => {
        if (typeof v !== "boolean") {
            if (ctx.tryConvert && (v === undefined || v === null)) return false;
            if (ctx.tryConvert && (typeof v === "string" || typeof v === "number")) {
                const s = String(v).toLowerCase();
                if (s === "true" || s === "1" || s === "yes" || s === "on") return true;
                if (s === "false" || s === "0" || s === "no" || s === "off") return false;
            }
            report(ctx, path, "boolean", v);
        }
        return v;
    },

    date: (v: any, path: string, ctx: ValidationContext) => {
        if (!(v instanceof Date) || isNaN(v.getTime())) {
            if (ctx.tryConvert && typeof v === "string") {
                const parsed = new Date(v);
                if (!isNaN(parsed.getTime())) return parsed;
            }
            report(ctx, path, "Date", v);
        }
        return v;
    },

    regexp: (v: any, path: string, ctx: ValidationContext) => {
        if (!(v instanceof RegExp)) {
            if (ctx.tryConvert && typeof v === "string") {
                const match = v.match(/^\/(.*)\/([gimuy]*)$/);
                if (match) {
                    try {
                        return new RegExp(match[1], match[2]);
                    } catch (e) {}
                } else {
                    try {
                        return new RegExp(v);
                    } catch (e) {}
                }
            }
            report(ctx, path, "RegExp", v);
        }
        return v;
    },

    null: (v: any, path: string, ctx: ValidationContext) => {
        if (v !== null) {
            report(ctx, path, "null", v);
        }
        return null;
    },

    undefined: (v: any, path: string, ctx: ValidationContext) => {
        if (v !== undefined) {
            report(ctx, path, "undefined", v);
        }
        return undefined;
    },

    literal: (v: any, path: string, ctx: ValidationContext, expected: any) => {
        if (v !== expected) {
            if (ctx.tryConvert && (v === undefined || v === null)) {
                if (typeof expected === "boolean") {
                    if (expected === false) return false;
                }
            }
            if (ctx.tryConvert && typeof v === "string") {
                if (typeof expected === "number") {
                    const p = parseFloat(v);
                    if (p === expected) return p;
                }
                if (typeof expected === "boolean") {
                    const s = v.toLowerCase();
                    let val: boolean | undefined;
                    if (s === "true" || s === "1" || s === "yes" || s === "on") val = true;
                    else if (s === "false" || s === "0" || s === "no" || s === "off") val = false;
                    
                    if (val === expected) return val;
                }
            }
            report(ctx, path, `literal ${expected}`, v);
        }
        return v;
    },

    array: (v: any, path: string, ctx: ValidationContext, childValidator: Function) => {
        if (!Array.isArray(v)) {
            if (ctx.wrapArrays && v !== undefined && v !== null) {
                v = [v];
            } else {
                report(ctx, path, "array", v);
                return v;
            }
        }
        let data = ctx.mode === "strip" ? [] : v;
        for (let i = 0; i < v.length; i++) {
            const val = childValidator(v[i], path + "[" + i + "]", ctx);
            if (ctx.mode === "strip") (data as any[]).push(val);
        }
        return data;
    },

    props: (v: any, data: any, path: string, ctx: ValidationContext, props: [string, boolean, Function][]) => {
        for (const [key, isOptional, validator] of props) {
            const val = v[key];
            const oldErrors = ctx.errors.length;
            const result = validator(val, path + "." + key, ctx);
            
            if (ctx.success) {
                data[key] = result;
            } else if (isOptional && val === undefined) {
                ctx.success = true;
                ctx.errors.length = oldErrors;
            }
        }
    },

    object: (v: any, path: string, ctx: ValidationContext, allowedKeys?: string[], expected: string = "object") => {
        if (!v || typeof v !== "object" || Array.isArray(v)) {
            report(ctx, path, expected, v);
            return false;
        }
        if (ctx.mode === "strict" && allowedKeys) {
            for (const k of Object.keys(v)) {
                if (!allowedKeys.includes(k)) {
                    report(ctx, path, `property not allowed: ${k}`, v[k]);
                }
            }
        }
        return true;
    },

    templateLiteral: (v: any, path: string, ctx: ValidationContext, regex: RegExp, expected: string) => {
        if (typeof v !== "string" || !regex.test(v)) {
            report(ctx, path, expected, v);
        }
        return v;
    },

    minLength: (v: string, path: string, ctx: ValidationContext, min: number) => {
        if (v.length < min) report(ctx, path, `MinLength<${min}>`, v);
        return v;
    },

    maxLength: (v: string, path: string, ctx: ValidationContext, max: number) => {
        if (v.length > max) report(ctx, path, `MaxLength<${max}>`, v);
        return v;
    },

    minimum: (v: number | bigint, path: string, ctx: ValidationContext, min: number | bigint) => {
        if (v < min) report(ctx, path, `Minimum<${min}>`, v);
        return v;
    },

    maximum: (v: number | bigint, path: string, ctx: ValidationContext, max: number | bigint) => {
        if (v > max) report(ctx, path, `Maximum<${max}>`, v);
        return v;
    },

    exclusiveMinimum: (v: number | bigint, path: string, ctx: ValidationContext, min: number | bigint) => {
        if (v <= min) report(ctx, path, `ExclusiveMinimum<${min}>`, v);
        return v;
    },

    exclusiveMaximum: (v: number | bigint, path: string, ctx: ValidationContext, max: number | bigint) => {
        if (v >= max) report(ctx, path, `ExclusiveMaximum<${max}>`, v);
        return v;
    },

    multipleOf: (v: number | bigint, path: string, ctx: ValidationContext, n: number | bigint) => {
        if (typeof v === 'bigint' || typeof n === 'bigint') {
            if (BigInt(v) % BigInt(n) !== 0n) report(ctx, path, `MultipleOf<${n}>`, v);
        } else {
            if (v % n !== 0) report(ctx, path, `MultipleOf<${n}>`, v);
        }
        return v;
    },

    pattern: (v: string, path: string, ctx: ValidationContext, regex: RegExp, expected: string) => {
        if (!regex.test(v)) report(ctx, path, expected, v);
        return v;
    },

    format: (v: string, path: string, ctx: ValidationContext, format: string) => {
        let regex: RegExp | undefined;
        let isValid = true;

        switch (format) {
            case 'email': regex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/; break;
            case 'uuid': regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i; break;
            case 'url': regex = /^(?:https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i; break;
            case 'ipv4': regex = /^(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/; break;
            case 'ipv6': regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/; break;
            case 'date': regex = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/; break;
            case 'date-time': regex = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])[tT ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[zZ]|[+-]\d{2}:\d{2})$/; break;
            
            case 'byte': regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/; break;
            case 'password': break; // Anything is a password
            case 'regex': try { new RegExp(v); } catch { isValid = false; }; break;
            case 'hostname': regex = /^(?=.{1,253}$)(?:(?!-)[A-Za-z0-9-]{1,63}(?<!-)\.)+[A-Za-z]{2,63}$/; break;
            case 'uri': regex = /^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s]*$/; break;
            case 'time': regex = /^\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[zZ]|[+-]\d{2}:\d{2})$/; break;
            case 'duration': regex = /^P(?!$)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+S)?)?$/; break;
            default: break;
        }

        if (regex && !regex.test(v)) isValid = false;
        if (!isValid) report(ctx, path, `Format<${format}>`, v);
        return v;
    },

    minItems: (v: any[], path: string, ctx: ValidationContext, min: number) => {
        if (v.length < min) report(ctx, path, `MinItems<${min}>`, v);
        return v;
    },

    maxItems: (v: any[], path: string, ctx: ValidationContext, max: number) => {
        if (v.length > max) report(ctx, path, `MaxItems<${max}>`, v);
        return v;
    },

    uniqueItems: (v: any[], path: string, ctx: ValidationContext) => {
        const seen = new Set();
        for (let i = 0; i < v.length; i++) {
            const item = v[i];
            const key = typeof item === 'object' && item !== null ? JSON.stringify(item) : item;
            if (seen.has(key)) {
                report(ctx, path, "UniqueItems", v);
                break;
            }
            seen.add(key);
        }
        return v;
    },

    union: (v: any, path: string, ctx: ValidationContext, checks: Function[]) => {
        // Pass 1: No conversion
        for (const check of checks) {
            const subCtx = { ...ctx, success: true, errors: [], tryConvert: false };
            const val = check(v, path, subCtx);
            if (subCtx.success) return val;
        }

        // Pass 2: With conversion
        let unionErrors: IValidationError[] = [];
        for (const check of checks) {
            const subCtx = { ...ctx, success: true, errors: [], tryConvert: true };
            const val = check(v, path, subCtx);
            if (subCtx.success) return val;
            unionErrors.push(...subCtx.errors);
        }

        ctx.success = false;
        ctx.errors.push({
            path,
            expected: "union",
            value: v,
            // Nestia-like detail? We can't easily nest in this flat array without adding a field.
            // For now, we'll just push the union error and let the caller see the sub-errors if we exposed them.
            // Actually, Typia pushes all sub-errors.
        });
        ctx.errors.push(...unionErrors);
        return v;
    },

    tuple: (v: any, path: string, ctx: ValidationContext, checks: Function[]) => {
        if (!Array.isArray(v) || v.length !== checks.length) {
            report(ctx, path, `tuple of length ${checks.length}`, v);
            return v;
        }
        let data = ctx.mode === "strip" ? [] : v;
        for (let i = 0; i < checks.length; i++) {
            const val = checks[i](v[i], path + "[" + i + "]", ctx);
            if (ctx.mode === "strip") (data as any[]).push(val);
        }
        return data;
    },

    any: (v: any) => v
};

export class MetadataStoreClass {
    private validators = new Map<string, Function>();

    registerValidator(hash: string, validator: Function) {
        this.validators.set(hash, validator);
    }

    getValidator(hash: string): Function {
        const val = this.validators.get(hash);
        if (!val) throw new Error(`Validator not found for hash: ${hash}`);
        return val;
    }
}

export const MetadataStore = new MetadataStoreClass();
