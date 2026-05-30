import ts from 'typescript';
const code = `
import { constraint } from './src/index.js';
type T = constraint.MinLength<1>;
`;
const host = ts.createCompilerHost({});
const originalGetSourceFile = host.getSourceFile;
host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (fileName === 'test.ts') {
        return ts.createSourceFile(fileName, code, languageVersion);
    }
    return originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
};
const program = ts.createProgram(['test.ts'], { target: ts.ScriptTarget.ES2022, moduleResolution: ts.ModuleResolutionKind.NodeNext }, host);
const checker = program.getTypeChecker();
const sf = program.getSourceFile('test.ts');
let found = false;
ts.forEachChild(sf, node => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === 'T') {
        const type = checker.getTypeAtLocation(node.type);
        console.log("Type properties:", type.getProperties().map(p => p.name));
        found = true;
    }
});
if (!found) console.log("Node not found");
