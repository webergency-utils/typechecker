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
    ),
    // 2. const validators = globalThis.__WEBERGENCY_TYPECHECKER_VALIDATORS__;
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
    ),
    // 3. const MetadataStore = globalThis.__WEBERGENCY_TYPECHECKER_METADATA_STORE__;
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
  ];

  const registrations: ts.Statement[] = [];

  for (const [hash, expr] of cache.entries()) {
    // const __val_hash = expr;
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
