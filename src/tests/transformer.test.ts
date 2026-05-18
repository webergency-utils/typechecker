import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import transformer from '../transformer.js';

describe('Transformer Call Expression Replacements', () => {
    function compileAndTransform(sourceCode: string): string {
        const tempFile = path.resolve('./temp_test_file.ts');
        fs.writeFileSync(tempFile, sourceCode);

        try {
            const program = ts.createProgram([tempFile], {
                target: ts.ScriptTarget.ES2022,
                module: ts.ModuleKind.NodeNext,
                moduleResolution: ts.ModuleResolutionKind.NodeNext,
                skipLibCheck: true
            });

            const sourceFile = program.getSourceFile(tempFile);
            if (!sourceFile) throw new Error("Could not load source file");

            const result = ts.transform(sourceFile, [transformer(program)]);
            const printer = ts.createPrinter();
            return printer.printFile(result.transformed[0]);
        } finally {
            if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
            }
        }
    }

    it('should transform validate with a string ValidationMode', () => {
        const code = `
            import { validate } from '../index.js';
            const x: any = 123;
            const res = validate<number>(x, 'relaxed');
        `;
        const compiled = compileAndTransform(code);
        expect(compiled).toContain('__mode = typeof __opt === "string" ? __opt : (__opt?.mode || "strict")');
        expect(compiled).toContain('__tryConvert = typeof __opt === "object" ? __opt?.tryConvert : undefined');
        expect(compiled).toContain('__wrapArrays = typeof __opt === "object" ? __opt?.wrapArrays : undefined');
        expect(compiled).toContain('mode: __mode, tryConvert: __tryConvert, wrapArrays: __wrapArrays');
    });

    it('should transform validate with options object', () => {
        const code = `
            import { validate } from '../index.js';
            const x: any = 123;
            const res = validate<number>(x, { mode: 'relaxed', tryConvert: true, wrapArrays: true });
        `;
        const compiled = compileAndTransform(code);
        expect(compiled).toContain('__opt?.mode || "strict"');
        expect(compiled).toContain('__tryConvert = typeof __opt === "object" ? __opt?.tryConvert : undefined');
    });

    it('should transform types with constraint and format namespace constraints and custom validations', () => {
        const code = `
            import { validate, constraint, format } from './src/index.js';
            function startsWithWeb(val: string) { return val.startsWith("web_"); }
            interface ApiKey {
                key: string & constraint.Custom<typeof startsWithWeb>;
                age: number & constraint.Range<18, 99>;
                name: string & constraint.Length<3, 10>;
                email: string & format.Email;
                id: string & format.ObjectId;
            }
            const res = validate<ApiKey>({ key: "web_abc", age: 20, name: "Tom", email: "tom@web.com", id: "507f1f77bcf86cd799439011" });
        `;
        const compiled = compileAndTransform(code);
        expect(compiled).toContain('validators.custom');
        expect(compiled).toContain('startsWithWeb');
        expect(compiled).toContain('validators.minimum');
        expect(compiled).toContain('validators.maximum');
        expect(compiled).toContain('validators.minLength');
        expect(compiled).toContain('validators.maxLength');
        expect(compiled).toContain('validators.format');
    });

    it('should transform types with tag.Default initializers', () => {
        const code = `
            import { validate, tag } from './src/index.js';
            interface Config {
                port?: number & tag.Default<8080>;
                host?: string & tag.Default<"localhost">;
            }
            const res = validate<Config>({});
        `;
        const compiled = compileAndTransform(code);
        expect(compiled).toContain('v = 8080;');
        expect(compiled).toContain('v = "localhost";');
    });

    it('should transform types with transform namespace and custom mappers', () => {
        const code = `
            import { validate, transform } from './src/index.js';
            function customSuffix(val: string) { return val + "_suffix"; }
            interface Member {
                username: string & transform.Trim & transform.LowerCase;
                joined: Date & transform.ToDate;
                code: string & transform.Custom<typeof customSuffix>;
            }
            const res = validate<Member>({ username: "  TOM  ", joined: "2026-05-17T19:55:00.000Z", code: "abc" });
        `;
        const compiled = compileAndTransform(code);
        expect(compiled).toContain('v = v.trim();');
        expect(compiled).toContain('v = v.toLowerCase();');
        expect(compiled).toContain('v = new Date(v);');
        expect(compiled).toContain('v = customSuffix(v);');
    });

    it('should transform jsonSchema calls and pre-compile static schemas', () => {
        const code = `
            import { jsonSchema, constraint } from './src/index.js';
            interface Account {
                email: string;
                age: number & constraint.Range<18, 99>;
                verified: boolean;
            }
            const schema = jsonSchema<Account>();
        `;
        const compiled = compileAndTransform(code);
        expect(compiled).toContain('MetadataStore.registerSchema');
        expect(compiled).toContain('MetadataStore.getSchema');
        expect(compiled).toContain('"type": "object"');
        expect(compiled).toContain('"email"');
        expect(compiled).toContain('"age"');
        expect(compiled).toContain('"minimum": 18');
        expect(compiled).toContain('"maximum": 99');
        expect(compiled).toContain('"type": "boolean"');
    });

    it('should handle deeply nested, circular, and highly complex types in jsonSchema', () => {
        const code = `
            import { jsonSchema, constraint, format } from './src/index.js';
            
            interface ComplexNode {
                id: string & format.ObjectId;
                name: string & constraint.Length<1, 100>;
                kind: "folder" | "file";
                tags: string[];
                meta: {
                    created: Date;
                    size?: number & constraint.Minimum<0>;
                    owner: {
                        email: string & format.Email;
                        active: boolean;
                    };
                };
                children?: ComplexNode[];
                tupleField: [number, string & format.UUID, boolean];
            }
            
            const schema = jsonSchema<ComplexNode>();
        `;
        const compiled = compileAndTransform(code);
        
        expect(compiled).toContain('"type": "object"');
        expect(compiled).toContain('"id"');
        expect(compiled).toContain('"format": "objectId"');
        expect(compiled).toContain('"name"');
        expect(compiled).toContain('"minLength": 1');
        expect(compiled).toContain('"maxLength": 100');
        expect(compiled).toContain('"anyOf"');
        expect(compiled).toContain('"const": "folder"');
        expect(compiled).toContain('"const": "file"');
        expect(compiled).toContain('"tags"');
        expect(compiled).toContain('"meta"');
        expect(compiled).toContain('"format": "date-time"');
        expect(compiled).toContain('"minimum": 0');
        expect(compiled).toContain('"email"');
        expect(compiled).toContain('"format": "email"');
        expect(compiled).toContain('"active"');
        expect(compiled).toContain('"type": "boolean"');
        expect(compiled).toContain('"children"');
        expect(compiled).toContain('"$ref": "#/$defs/ComplexNode_');
        expect(compiled).toContain('"tupleField"');
        expect(compiled).toContain('"minItems": 3');
        expect(compiled).toContain('"maxItems": 3');
    });

    it('should transform validate calls with dynamic validation schema option', () => {
        const code = `
            import { validate } from './src/index.js';
            const schema = {
                type: "object",
                properties: {
                    name: { type: "string" },
                    age: { type: "number", minimum: 18 }
                },
                required: ["name"]
            };
            const res = validate<any>({ name: "Tom", age: 20 }, { schema });
        `;
        const compiled = compileAndTransform(code);
        expect(compiled).toContain('MetadataStore.getOrCompileSchema(schema)');
    });

    it('should inline small repeating structures like Point while hoisting circular types', () => {
        const code = `
            import { jsonSchema } from './src/index.js';
            interface Point {
                x: number;
                y: number;
            }
            interface SmallLine {
                start: Point;
                end: Point;
            }
            interface Node {
                val: number;
                next?: Node;
            }
            const schema1 = jsonSchema<SmallLine>();
            const schema2 = jsonSchema<Node>();
        `;
        const compiled = compileAndTransform(code);
        expect(compiled).not.toContain('"$ref": "#/$defs/Point_');
        expect(compiled).toContain('"$ref": "#/$defs/Node_');
    });
});

