import * as ts from 'typescript';
import transformer from '../src/transformer';

const filePath = './tests/fixtures/sample.ts';

const program = ts.createProgram([filePath], {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS
});

const sourceFile = program.getSourceFile(filePath);
if (!sourceFile) {
  throw new Error("Could not find source file");
}

const transformers: ts.CustomTransformers = {
  before: [transformer(program)]
};

// Emit only the transformed test file to disk
program.emit(sourceFile, undefined, undefined, false, transformers);
console.log("=== COMPILATION COMPLETE ===\\nCheck tests/fixtures/sample.js");
