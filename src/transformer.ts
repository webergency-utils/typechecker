import ts from 'typescript';
import { buildValidator, generateHash, buildJsonSchema, objectToAst } from './engine/resolver.js';
export { buildValidator, generateHash, buildJsonSchema } from './engine/resolver.js';
import { hoistRegistrations } from './engine/hoister.js';
import { templateToAst, injectNodes } from './engine/generators.js';

const TARGET_DECORATORS = ['Query', 'Body', 'Param'];
const RUNTIME_FUNCTIONS = ['is', 'assert', 'assertGuard', 'validate', 'jsonSchema'];

export default function transformer(program: ts.Program) {
  const checker = program.getTypeChecker();

  return (context: ts.TransformationContext) => {
    return (sourceFile: ts.SourceFile) => {
      const validatorCache = new Map<string, ts.Expression>();
      const schemasCache = new Map<string, ts.Expression>();
      const requiredUtils = new Set<string>();

      const visitor = (node: ts.Node): ts.Node => {
        // Skip visiting ImportDeclarations to preserve their original symbols and avoid compiler crashes
        if (ts.isImportDeclaration(node)) {
          return node;
        }

        // Handle runtime function calls (is, assert, assertGuard, validate, jsonSchema)
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
              if (!schemasCache.has(hash)) {
                const schemaObj = buildJsonSchema(type, checker);
                schemasCache.set(hash, objectToAst(schemaObj));
              }

              let getCall: ts.Expression;
              const arg0 = node.arguments[0] || ts.factory.createIdentifier('undefined');
              const arg1 = node.arguments[1] || ts.factory.createIdentifier('undefined');

              let hasSchema = false;
              let schemaExpr: ts.Expression | undefined;

              if (node.arguments[1]) {
                const optArg = node.arguments[1];
                const optType = checker.getTypeAtLocation(optArg);
                const schemaProp = optType.getProperty('schema');
                if (schemaProp) {
                  hasSchema = true;
                  if (ts.isObjectLiteralExpression(optArg)) {
                    const prop = optArg.properties.find(p => {
                      if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'schema') return true;
                      if (ts.isShorthandPropertyAssignment(p) && p.name.text === 'schema') return true;
                      return false;
                    });
                    if (prop) {
                      if (ts.isPropertyAssignment(prop)) {
                        schemaExpr = prop.initializer;
                      } else if (ts.isShorthandPropertyAssignment(prop)) {
                        schemaExpr = prop.name;
                      }
                    }
                  }
                  if (!schemaExpr) {
                    schemaExpr = ts.factory.createPropertyAccessExpression(optArg, 'schema');
                  }
                }
              }

              if (hasSchema && schemaExpr) {
                const compileAccess = ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('MetadataStore'), 'getOrCompileSchema');
                getCall = ts.factory.createCallExpression(compileAccess, undefined, [schemaExpr]);
              } else {
                const mdStoreAccess = ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('MetadataStore'), 'getValidator');
                getCall = ts.factory.createCallExpression(mdStoreAccess, undefined, [ts.factory.createStringLiteral(hash)]);
              }
              
              if (fnName === 'jsonSchema') {
                  const getSchemaAccess = ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('MetadataStore'), 'getSchema');
                  return ts.factory.createCallExpression(getSchemaAccess, undefined, [ts.factory.createStringLiteral(hash)]);
              } else if (fnName === 'validate') {
                  const mdStoreAccess = ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('MetadataStore'), 'validate');
                  return ts.factory.createCallExpression(mdStoreAccess, undefined, [getCall, arg0, arg1]);
              } else if (fnName === 'is') {
                  const mdStoreAccess = ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('MetadataStore'), 'is');
                  return ts.factory.createCallExpression(mdStoreAccess, undefined, [getCall, arg0, arg1]);
              } else if (fnName === 'assert' || fnName === 'assertGuard') {
                  const mdStoreAccess = ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('MetadataStore'), 'assert');
                  return ts.factory.createCallExpression(mdStoreAccess, undefined, [getCall, arg0, arg1]);
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
                    if (!schemasCache.has(hash)) {
                      const schemaObj = buildJsonSchema(type, checker);
                      schemasCache.set(hash, objectToAst(schemaObj));
                    }

                    const mdStoreAccess = ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('MetadataStore'), 'getValidator');
                    const getCall = ts.factory.createCallExpression(mdStoreAccess, undefined, [ts.factory.createStringLiteral(hash)]);

                    const decoratorArgs = [...decorator.expression.arguments];
                    decoratorArgs[1] = getCall;
                    
                    return ts.factory.updateDecorator(decorator, 
                      ts.factory.createCallExpression(
                        decorator.expression.expression,
                        decorator.expression.typeArguments,
                        decoratorArgs
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
      return hoistRegistrations(transformedFile, validatorCache, requiredUtils, schemasCache);
    };
  };
}
