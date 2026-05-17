import ts from 'typescript';
import { RUNTIME_UTILITIES, templateToAst } from './generators.js';

export function hoistRegistrations(sourceFile: ts.SourceFile, cache: Map<string, ts.Expression>, requiredUtils: Set<string>) {
  if (cache.size === 0 && requiredUtils.size === 0) return sourceFile;

  const utilityStatements = Array.from(requiredUtils).map(utilName => {
    const code = RUNTIME_UTILITIES[utilName];
    if (!code) throw new Error(`Missing utility function definition for ${utilName}`);
    // templateToAst creates an Expression, but our utility templates are variable declarations (Statements).
    // Actually, templateToAst as written currently extracts the first ExpressionStatement.
    // Let's create a full SourceFile and extract its statements to support variable declarations!
    const utilSource = ts.createSourceFile('temp.ts', code, ts.ScriptTarget.Latest, true);
    
    // We want to pass these statements through our cleaner to avoid literal slicing bugs
    const transformer = (context: ts.TransformationContext) => (rootNode: ts.Node) => {
        function visit(node: ts.Node): ts.Node {
            if (ts.isStringLiteral(node)) {
                return ts.factory.createStringLiteral(node.text);
            }
            if (ts.isNumericLiteral(node)) {
                return ts.factory.createNumericLiteral(node.text);
            }
            return ts.visitEachChild(node, visit, context);
        }
        return ts.visitNode(rootNode, visit);
    };
    
    const transformedSource = ts.transform(utilSource, [transformer]).transformed[0] as ts.SourceFile;
    return transformedSource.statements;
  }).reduce((acc, val) => acc.concat(val), [] as ts.Statement[]);

  const registrations = Array.from(cache.entries()).map(([hash, expr]) => 
    ts.factory.createExpressionStatement(
      ts.factory.createCallExpression(
        ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('MetadataStore'), 'registerValidator'),
        undefined,
        [ts.factory.createStringLiteral(hash), expr]
      )
    )
  );

  return ts.factory.updateSourceFile(sourceFile, [
    ...utilityStatements,
    ...registrations,
    ...sourceFile.statements
  ]);
}
