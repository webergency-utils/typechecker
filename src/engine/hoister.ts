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

  if (!hasVariableDeclaration(sourceFile.statements, 'validators') &&
      !hasVariableDeclaration(utilityStatements, 'validators')) {
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

  if (!hasVariableDeclaration(sourceFile.statements, 'MetadataStore') &&
      !hasVariableDeclaration(utilityStatements, 'MetadataStore')) {
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

  const variablePrepends: ts.Statement[] = [];
  const registrationAppends: ts.Statement[] = [];

  for (const [hash, expr] of cache.entries()) {
    // const __val_hash = expr;
    if (!hasVariableDeclaration(sourceFile.statements, `__val_${hash}`) &&
        !hasVariableDeclaration(utilityStatements, `__val_${hash}`) &&
        !hasVariableDeclaration(variablePrepends, `__val_${hash}`)) {
      variablePrepends.push(
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
    registrationAppends.push(
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

  const mergedStatements = [
    ...utilityStatements,
    ...variablePrepends,
    ...sourceFile.statements
  ];

  const insertIndex = findInsertionIndex(mergedStatements);

  return ts.factory.updateSourceFile(sourceFile, [
    ...mergedStatements.slice(0, insertIndex),
    ...registrationAppends,
    ...mergedStatements.slice(insertIndex)
  ]);
}


function findInsertionIndex(statements: readonly ts.Statement[]): number {
  let lastClassIndex = -1;
  for (let i = 0; i < statements.length; i++) {
    if (ts.isClassDeclaration(statements[i])) {
      lastClassIndex = i;
    }
  }

  const startIndex = lastClassIndex !== -1 ? lastClassIndex + 1 : 0;

  for (let i = startIndex; i < statements.length; i++) {
    const s = statements[i];

    if (ts.isImportDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) {
      continue;
    }

    if (ts.isVariableStatement(s)) {
      let isPrependedVar = true;
      for (const decl of s.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const text = decl.name.text;
          if (text !== 'validators' && text !== 'MetadataStore' && text !== '__server_metadata_store' && !text.startsWith('__val_')) {
            isPrependedVar = false;
            break;
          }
        } else {
          isPrependedVar = false;
          break;
        }
      }
      if (isPrependedVar) {
        continue;
      }
    }

    return i;
  }
  return statements.length;
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


