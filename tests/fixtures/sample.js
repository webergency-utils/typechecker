import * as __tcRuntime from "@webergency-utils/typechecker/runtime";
import { validate } from '../../src/index.js';
const validators = __tcRuntime.validators;
const __val_473287f8298dba71 = validators.string;
const __val_eb045d78d2731073 = validators.undefined;
const __val_12886f9d00055adf = validators.number;
const __val_0b3d835cdcd4c14c = (v, path, ctx) => validators.union(v, path, ctx, [__val_eb045d78d2731073, __val_12886f9d00055adf], "Type<number|undefined>");
const __val_e5da2f9fabafe20e = (v, path, ctx) => validators.array(v, path, ctx, __val_473287f8298dba71);
const __val_99c40ab405926cb5 = validators.date;
const __val_7f67336e8b9a8864 = (v, path, ctx) => {
    const obj = validators.object(v, path, ctx, new Set(["x", "y"]), "Point");
    if (obj === false)
        return v;
    const data = validators.objectShell(obj, ctx);
    validators.props(obj, data, path, ctx, [
        ["x", false, __val_12886f9d00055adf],
        ["y", false, __val_12886f9d00055adf]
    ]);
    validators.stripExtras(data, ctx, new Set(["x", "y"]));
    return data;
};
const __val_d86ad75296b5344e = (v, path, ctx) => {
    const obj = validators.object(v, path, ctx, new Set(["start", "end"]), "Line");
    if (obj === false)
        return v;
    const data = validators.objectShell(obj, ctx);
    validators.props(obj, data, path, ctx, [
        ["start", false, __val_7f67336e8b9a8864],
        ["end", false, __val_7f67336e8b9a8864]
    ]);
    validators.stripExtras(data, ctx, new Set(["start", "end"]));
    return data;
};
const __val_7759f9bdbfff935a = (v, path, ctx) => validators.union(v, path, ctx, [__val_7f67336e8b9a8864, __val_d86ad75296b5344e], "Type<Point|Line>");
const __val_7838beb19b8115fe = (v, path, ctx) => {
    const obj = validators.object(v, path, ctx, new Set(["id", "name", "age", "tags", "createdAt", "foo"]), "User");
    if (obj === false)
        return v;
    const data = validators.objectShell(obj, ctx);
    validators.props(obj, data, path, ctx, [
        ["id", false, __val_473287f8298dba71],
        ["name", false, __val_473287f8298dba71],
        ["age", true, __val_0b3d835cdcd4c14c],
        ["tags", false, __val_e5da2f9fabafe20e],
        ["createdAt", false, __val_99c40ab405926cb5],
        ["foo", false, __val_7759f9bdbfff935a]
    ]);
    validators.stripExtras(data, ctx, new Set(["id", "name", "age", "tags", "createdAt", "foo"]));
    return data;
};
interface Point {
    x: number;
    y: number;
}
interface Line {
    start: Point;
    end: Point;
}
interface User {
    id: string;
    name: string;
    age?: number;
    tags: string[];
    createdAt: Date;
    foo: Point | Line;
}
const inputData = { id: '123', name: 'Alice', tags: ['admin'], createdAt: '2026-05-12T00:00:00Z', extra: 'should-strip' };
const validationResult = __tcRuntime.validate(__val_7838beb19b8115fe, inputData, 'strip');
console.log(validationResult);
