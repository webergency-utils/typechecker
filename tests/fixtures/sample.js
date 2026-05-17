"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const __type_check_string = (v, path, ctx) => {
    if (typeof v !== "string") {
        ctx.success = false;
        ctx.errors.push(path + ": expected string");
    }
    return v;
};
const __type_check_number = (v, path, ctx) => {
    if (typeof v !== "number") {
        ctx.success = false;
        ctx.errors.push(path + ": expected number");
    }
    return v;
};
const __type_check_array = (v, path, ctx, childValidator) => {
    if (!Array.isArray(v)) {
        ctx.success =
            false;
        ctx.errors
            .push(path + ": expected array");
        return v;
    }
    let data = ctx.mode === "strip" ? [] : v;
    for (let i = 0; i < v.length; i++) {
        const val = childValidator(v[i], path + "[" + i + "]", ctx);
        if (ctx.
            mode === "strip")
            data.push(val);
    }
    return data;
};
const __type_check_date = (v, path, ctx) => {
    if (!(v instanceof Date)
        || isNaN(v.getTime())) {
        if (typeof v === "string") {
            const parsed = new Date(v);
            if (!isNaN(parsed.getTime()))
                return parsed;
        }
        ctx.success = false;
        ctx.errors.push(path + ": expected valid Date");
    }
    return v;
};
const __type_check_prop = (v, data, key, isOptional, validator, path, ctx) => {
    if (v[key] !== undefined) {
        const val = validator(v[key], path + "." + key, ctx);
        if (ctx
            .mode === "strip")
            data[key] = val;
    }
    else if (!isOptional) {
        ctx.success = false;
        ctx.errors.push(path + "." + key + ": is required");
    }
};
const __type_check_obj = (v, path, ctx, allowedKeys) => {
    if (!v ||
        typeof v !== "object") {
        ctx.success
            = false;
        ctx.errors.push(path + ": expected object");
        return false;
    }
    if (ctx.mode === "strict" && allowedKeys) {
        for (const k of Object.keys(v)) {
            if (!allowedKeys.includes(k)) {
                ctx.success = false;
                ctx.errors.push(path + "." + k + ": unknown property not allowed in strict mode");
            }
        }
    }
    return true;
};
MetadataStore.registerValidator("f17dd18cd7df8edf", (v, path, ctx) => {
    if (!__type_check_obj(v, path, ctx, ["id", "name", "age", "tags", "createdAt", "foo"]))
        return v;
    let data = ctx.mode
        === "strip" ?
        {} : v;
    __type_check_prop(v, data, "id", false, __type_check_string, path, ctx);
    __type_check_prop(v, data, "name", false, __type_check_string, path, ctx);
    __type_check_prop(v, data, "age", true, __type_check_number, path, ctx);
    __type_check_prop(v, data, "tags", false, (v, path, ctx) => __type_check_array(v, path, ctx, __type_check_string), path, ctx);
    __type_check_prop(v, data, "createdAt", false, __type_check_date, path, ctx);
    __type_check_prop(v, data, "foo", false, (v, path, ctx) => {
        const checks = [
            (v, path, ctx) => {
                if (!__type_check_obj(v, path, ctx, ["x", "y"]))
                    return v;
                let data = ctx.mode === "strip" ? {} :
                    v;
                __type_check_prop(v, data, "x", false, __type_check_number, path, ctx);
                __type_check_prop(v, data, "y", false, __type_check_number, path, ctx);
                return data;
            }, (v, path, ctx) => {
                if (!__type_check_obj(v, path, ctx, ["start", "end"]))
                    return v;
                let data = ctx.mode === "strip" ? {} : v;
                __type_check_prop(v, data, "start", false, (v, path, ctx) => MetadataStore.getValidator("9cbf3d4049aefbd8")(v, path, ctx), path, ctx);
                __type_check_prop(v, data, "end", false, (v, path, ctx) => MetadataStore.getValidator("9cbf3d4049aefbd8")(v, path, ctx), path, ctx);
                return data;
            }
        ];
        let unionErrors = [];
        for (const check of checks) {
            const subCtx = {
                success: true, errors: [], mode: ctx.mode };
            const val = check(v, path, subCtx);
            if (subCtx.success)
                return val;
            unionErrors.push(...subCtx.errors);
        }
        ctx.success =
            false;
        ctx.errors.push(path + ": no union matched. "
            + unionErrors.join(", "));
        return v;
    }, path, ctx);
    return data;
});
const index_1 = require("../../src/index");
const inputData = { id: "123", name: "Alice", tags: ["admin"], createdAt: "2026-05-12T00:00:00Z", extra: "should-strip" };
const validationResult = (() => {
    const ctx = {
        success: true, errors: [],
        mode: 'strip'
            || "relaxed" };
    const data = MetadataStore.getValidator("f17dd18cd7df8edf")(inputData, "", ctx);
    return { success: ctx.success,
        errors: ctx.errors, data };
})();
console.log(validationResult);
