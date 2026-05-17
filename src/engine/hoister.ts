import ts from 'typescript';

export function hoistRegistrations(sourceFile: ts.SourceFile, cache: Map<string, ts.Expression>, requiredUtils: Set<string>) {
  if (cache.size === 0 && requiredUtils.size === 0) return sourceFile;

  const utilityStatements: ts.Statement[] = [];
  
  if (requiredUtils.has('validators')) {
    utilityStatements.push(
      ts.factory.createImportDeclaration(
        undefined,
        ts.factory.createImportClause(
          false,
          undefined,
          ts.factory.createNamedImports([
            ts.factory.createImportSpecifier(
              false,
              undefined,
              ts.factory.createIdentifier('validators')
            )
          ])
        ),
        ts.factory.createStringLiteral('@webergency-utils/typechecker/runtime'),
        undefined
      )
    );
  }

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
