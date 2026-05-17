import ts from 'typescript';

export function hoistRegistrations(sourceFile: ts.SourceFile, cache: Map<string, ts.Expression>, requiredUtils: Set<string>) {
  if (cache.size === 0 && requiredUtils.size === 0) return sourceFile;

  const utilityStatements: ts.Statement[] = [
    // 1. import "@webergency-utils/typechecker/runtime";
    ts.factory.createImportDeclaration(
      undefined,
      undefined,
      ts.factory.createStringLiteral('@webergency-utils/typechecker/runtime'),
      undefined
    )
  ];

  if (!hasVariableDeclaration(sourceFile.statements, 'validators')) {
    utilityStatements.push(
      ts.factory.createVariableStatement(
        undefined,
        ts.factory.createVariableDeclarationList([
          ts.factory.createVariableDeclaration(
            ts.factory.createIdentifier('validators'),
            undefined,
            undefined,
            ts.factory.createPropertyAccessExpression(
              ts.factory.createIdentifier('globalThis'),
              '__WEBERGENCY_TYPECHECKER_VALIDATORS__'
            )
          )
        ], ts.NodeFlags.Const)
      )
    );
  }

  if (!hasVariableDeclaration(sourceFile.statements, 'MetadataStore')) {
    utilityStatements.push(
      ts.factory.createVariableStatement(
        undefined,
        ts.factory.createVariableDeclarationList([
          ts.factory.createVariableDeclaration(
            ts.factory.createIdentifier('MetadataStore'),
            undefined,
            undefined,
            ts.factory.createPropertyAccessExpression(
              ts.factory.createIdentifier('globalThis'),
              '__WEBERGENCY_TYPECHECKER_METADATA_STORE__'
            )
          )
        ], ts.NodeFlags.Const)
      )
    );
  }

  const registrations: ts.Statement[] = [];

  for (const [hash, expr] of cache.entries()) {
    // const __val_hash = expr;
    if (!hasVariableDeclaration(sourceFile.statements, `__val_${hash}`) &&
        !hasVariableDeclaration(registrations, `__val_${hash}`)) {
      registrations.push(
        ts.factory.createVariableStatement(
          undefined,
          ts.factory.createVariableDeclarationList([
            ts.factory.createVariableDeclaration(
              ts.factory.createIdentifier(`__val_${hash}`),
              undefined,
              undefined,
              expr
            )
          ], ts.NodeFlags.Const)
        )
      );
    }

    // MetadataStore.registerValidator(hash, __val_hash);
    registrations.push(
      ts.factory.createExpressionStatement(
        ts.factory.createCallExpression(
          ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('MetadataStore'), 'registerValidator'),
          undefined,
          [
            ts.factory.createStringLiteral(hash),
            ts.factory.createIdentifier(`__val_${hash}`)
          ]
        )
      )
    );
  }

  return ts.factory.updateSourceFile(sourceFile, [
    ...utilityStatements,
    ...registrations,
    ...sourceFile.statements
  ]);
}

function hasVariableDeclaration(statements: readonly ts.Statement[], name: string): boolean {
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name) {
          return true;
        }
      }
    }
  }
  return false;
}

