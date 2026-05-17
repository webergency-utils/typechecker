import ts from 'typescript';
import { buildValidator, generateHash } from './engine/resolver.js';
import { hoistRegistrations } from './engine/hoister.js';
import { templateToAst, injectNodes } from './engine/generators.js';

const TARGET_DECORATORS = ['Query', 'Body', 'Param'];
const RUNTIME_FUNCTIONS = ['is', 'assert', 'assertGuard', 'validate'];

export default function transformer(program: ts.Program) {
  const checker = program.getTypeChecker();

  return (context: ts.TransformationContext) => {
    return (sourceFile: ts.SourceFile) => {
      const validatorCache = new Map<string, ts.Expression>();
      const requiredUtils = new Set<string>();

      const visitor = (node: ts.Node): ts.Node => {
        // Skip visiting ImportDeclarations to preserve their original symbols and avoid compiler crashes
        if (ts.isImportDeclaration(node)) {
          return node;
        }

        // Handle runtime function calls (is, assert, assertGuard, validate)
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
          const fnName = node.expression.text;
          if (RUNTIME_FUNCTIONS.includes(fnName)) {
            const typeArg = node.typeArguments?.[0];
            if (typeArg) {
              const type = checker.getTypeFromTypeNode(typeArg);
              const hash = generateHash(type, checker);

              if (!validatorCache.has(hash)) {
                buildValidator(type, checker, validatorCache, requiredUtils);
              }

              const mdStoreAccess = ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('MetadataStore'), 'getValidator');
              const getCall = ts.factory.createCallExpression(mdStoreAccess, undefined, [ts.factory.createStringLiteral(hash)]);
              const arg0 = node.arguments[0] || ts.factory.createIdentifier('undefined');
              const arg1 = node.arguments[1] || ts.factory.createIdentifier('undefined');
              
              if (fnName === 'validate') {
                  const tpl = `
                  (() => {
                      const opt = __ARG1__;
                      const mode = typeof opt === 'string' ? opt : (opt?.mode || 'strict');
                      const tryConvert = typeof opt === 'object' ? opt?.tryConvert : undefined;
                      const wrapArrays = typeof opt === 'object' ? opt?.wrapArrays : undefined;
                      const ctx = { success: true, errors: [], mode, tryConvert, wrapArrays };
                      const data = __GET_CALL__(__ARG0__, "", ctx);
                      return { success: ctx.success, errors: ctx.errors, data };
                  })()
                  `;
                  return injectNodes(templateToAst(tpl), { '__GET_CALL__': getCall, '__ARG0__': arg0, '__ARG1__': arg1 });
              } else if (fnName === 'is') {
                  const tpl = `
                  (() => {
                      const opt = __ARG1__;
                      const mode = typeof opt === 'string' ? opt : (opt?.mode || 'strict');
                      const tryConvert = typeof opt === 'object' ? opt?.tryConvert : undefined;
                      const wrapArrays = typeof opt === 'object' ? opt?.wrapArrays : undefined;
                      const ctx = { success: true, errors: [], mode, tryConvert, wrapArrays };
                      __GET_CALL__(__ARG0__, "", ctx);
                      return ctx.success;
                  })()
                  `;
                  return injectNodes(templateToAst(tpl), { '__GET_CALL__': getCall, '__ARG0__': arg0, '__ARG1__': arg1 });
              } else if (fnName === 'assert' || fnName === 'assertGuard') {
                  const tpl = `
                  (() => {
                      const opt = __ARG1__;
                      const mode = typeof opt === 'string' ? opt : (opt?.mode || 'strict');
                      const tryConvert = typeof opt === 'object' ? opt?.tryConvert : undefined;
                      const wrapArrays = typeof opt === 'object' ? opt?.wrapArrays : undefined;
                      const ctx = { success: true, errors: [], mode, tryConvert, wrapArrays };
                      const data = __GET_CALL__(__ARG0__, "", ctx);
                      if (!ctx.success) throw new Error("Validation Error: " + ctx.errors.join(', '));
                      return data;
                  })()
                  `;
                  return injectNodes(templateToAst(tpl), { '__GET_CALL__': getCall, '__ARG0__': arg0, '__ARG1__': arg1 });
              }
            }
          }
        }

        // Handle decorators
        if (ts.isParameter(node) && ts.canHaveDecorators(node)) {
          const decorators = ts.getDecorators(node);
          if (decorators) {
            const updatedDecorators = decorators.map(decorator => {
              if (ts.isCallExpression(decorator.expression) && ts.isIdentifier(decorator.expression.expression)) {
                const decName = decorator.expression.expression.text;
                if (TARGET_DECORATORS.includes(decName)) {
                  const typeNode = node.type;
                  if (typeNode) {
                    const type = checker.getTypeFromTypeNode(typeNode);
                    const hash = generateHash(type, checker);

                    if (!validatorCache.has(hash)) {
                      buildValidator(type, checker, validatorCache, requiredUtils);
                    }

                    return ts.factory.updateDecorator(decorator, 
                      ts.factory.createCallExpression(
                        decorator.expression.expression,
                        undefined,
                        [ts.factory.createStringLiteral(hash)]
                      )
                    );
                  }
                }
              }
              return decorator;
            });
            
            return ts.factory.updateParameterDeclaration(
              node,
              ts.getModifiers(node),
              node.dotDotDotToken,
              node.name,
              node.questionToken,
              node.type,
              node.initializer
            );
          }
        }
        return ts.visitEachChild(node, visitor, context);
      };

      const transformedFile = ts.visitNode(sourceFile, visitor) as ts.SourceFile;
      return hoistRegistrations(transformedFile, validatorCache, requiredUtils);
    };
  };
}
