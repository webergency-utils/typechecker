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
});
