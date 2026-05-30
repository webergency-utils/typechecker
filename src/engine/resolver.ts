import ts from 'typescript';
import { 
  createPrimitiveCheck, 
  createLiteralCheck, 
  createArrayCheck, 
  createUnionCheck, 
  createObjectCheck,
  createDateCheck,
  createNullCheck,
  createUndefinedCheck,
  createIntersectionCheck,
  createTupleCheck,
  createRecordCheck,
  templateToAst,
  createRegExpCheck,
  createTemplateLiteralCheck,
  createConstrainedPrimitiveCheck,
  createSetCheck,
  createMapCheck
} from './generators.js';
import { createHash } from 'crypto';

function getStringLiteralValue(type: ts.Type): string | undefined {
  if (type.isStringLiteral()) {
    return type.value;
  }
  if (type.isUnion()) {
    const literalType = type.types.find(t => t.isStringLiteral());
    if (literalType && literalType.isStringLiteral()) {
      return literalType.value;
    }
  }
  return undefined;
}

function minifyTypeString(str: string): string {
  return str
    .replace(/\{\s+/g, '{')
    .replace(/\s+\}/g, '}')
    .replace(/;\s*\}/g, '}')
    .replace(/;\s+/g, ',')
    .replace(/:\s+/g, ':')
    .replace(/\s+\|\s+/g, '|');
}

export function buildValidator(
  type: ts.Type, 
  checker: ts.TypeChecker, 
  validatorsMap: Map<string, ts.Expression>, 
  requiredUtils: Set<string>
): ts.Expression {
  const hash = generateHash(type, checker);
  
  if (validatorsMap.has(hash)) {
    return ts.factory.createIdentifier(`__val_${hash}`);
  }

  // Set placeholder to handle circularity
  validatorsMap.set(hash, ts.factory.createIdentifier(`PENDING_${hash}`));

  let result: ts.Expression;
  const flags = type.getFlags();

  const isUnion = (((flags & ts.TypeFlags.Union) !== 0 || type.isUnion()) && (type as any).types) ? true : false;
  const isIntersection = (((flags & ts.TypeFlags.Intersection) !== 0 || type.isIntersection()) && (type as any).types) ? true : false;

  if (isUnion) {
    const checks = (type as ts.UnionType).types.map(t => buildValidator(t, checker, validatorsMap, requiredUtils));
    result = createUnionCheck(checks, requiredUtils, `Type<${minifyTypeString(checker.typeToString(type))}>`);
  } else if (isIntersection) {
    const types = (type as ts.IntersectionType).types;
    let baseName = '';
    let baseType: ts.Type | undefined;
    const constraints: any[] = [];

    for (const sub of types) {
      const sFlags = sub.getFlags();
      if (sFlags & ts.TypeFlags.String || sFlags & ts.TypeFlags.TemplateLiteral) {
        baseName = 'string';
        baseType = sub;
      }
      else if (sFlags & ts.TypeFlags.Number) baseName = 'number';
      else if (sFlags & ts.TypeFlags.BigInt) baseName = 'bigint';
      else if (sFlags & ts.TypeFlags.Boolean || (sub as any).intrinsicName === 'boolean') {
        baseName = 'boolean';
        baseType = sub;
      }
      else if (sub.getSymbol()?.name === 'Date') {
        baseName = 'date';
        baseType = sub;
      }
      else if (checker.isArrayType(sub)) {
        baseName = 'array';
        baseType = sub;
      }
      
      const props = checker.getPropertiesOfType(sub);
      for (const prop of props) {
        const pName = prop.getName();
        if (pName.startsWith('__')) {
          const pType = checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration || (prop as any).declarations?.[0]);
          let val = (pType as any).value;
          if (val === undefined && (pType.getFlags() & ts.TypeFlags.BooleanLiteral)) {
            val = (pType as any).intrinsicName === 'true';
          }
          if (val === undefined && (pType.getFlags() & ts.TypeFlags.Null)) {
            val = null;
          }
          if (pName === '__default') {
            constraints.push({ type: 'default', value: val });
          } else if (pName === '__message') {
            constraints.push({ type: 'message', value: val });
          } else if (pName === '__transform_lowercase') {
            constraints.push({ type: 'transform', value: 'lowercase' });
          } else if (pName === '__transform_uppercase') {
            constraints.push({ type: 'transform', value: 'uppercase' });
          } else if (pName === '__transform_trim') {
            constraints.push({ type: 'transform', value: 'trim' });
          } else if (pName === '__transform_capitalize') {
            constraints.push({ type: 'transform', value: 'capitalize' });
          } else if (pName === '__transform_tonumber') {
            constraints.push({ type: 'transform', value: 'tonumber' });
          } else if (pName === '__transform_toboolean') {
            constraints.push({ type: 'transform', value: 'toboolean' });
          } else if (pName === '__transform_todate') {
            constraints.push({ type: 'transform', value: 'todate' });
          } else if (pName === '__transform_custom') {
            let fnName: string | undefined;
            let filePath: string | undefined;
            const symbol = pType.getSymbol() || pType.aliasSymbol;
            if (symbol) {
              fnName = symbol.getName();
              let dec = symbol.valueDeclaration || symbol.declarations?.[0];
              if (fnName === '__function' && dec) {
                let current: ts.Node | undefined = dec;
                while (current) {
                  if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
                    fnName = current.name.text;
                    dec = current;
                    break;
                  }
                  current = current.parent;
                }
              }
              if (dec) {
                const sourceFile = dec.getSourceFile();
                if (sourceFile) filePath = sourceFile.fileName;
              }
            } else {
              const str = checker.typeToString(pType);
              const match = str.match(/typeof\s+([a-zA-Z0-9_]+)/);
              if (match) fnName = match[1];
            }
            if (fnName === '__function' || !fnName) {
              throw new Error(`[Webergency] Custom validator must reference a named function via typeof (e.g. tag.Custom<typeof myFunc>).`);
            }
            if (filePath) {
              requiredUtils.add(`custom:${fnName}:${filePath}`);
            }
            constraints.push({ type: 'transform_custom', value: fnName });
          } else if (pName === '__custom') {
            let fnName: string | undefined;
            let filePath: string | undefined;
            const symbol = pType.getSymbol() || pType.aliasSymbol;
            if (symbol) {
              fnName = symbol.getName();
              let dec = symbol.valueDeclaration || symbol.declarations?.[0];
              if (fnName === '__function' && dec) {
                let current: ts.Node | undefined = dec;
                while (current) {
                  if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
                    fnName = current.name.text;
                    dec = current;
                    break;
                  }
                  current = current.parent;
                }
              }
              if (dec) {
                const sourceFile = dec.getSourceFile();
                if (sourceFile) filePath = sourceFile.fileName;
              }
            } else {
              const str = checker.typeToString(pType);
              const match = str.match(/typeof\s+([a-zA-Z0-9_]+)/);
              if (match) fnName = match[1];
            }
            if (fnName === '__function' || !fnName) {
              throw new Error(`[Webergency] Custom validator must reference a named function via typeof (e.g. tag.Custom<typeof myFunc>).`);
            }
            if (filePath) {
              requiredUtils.add(`custom:${fnName}:${filePath}`);
            }
            const msgProp = props.find(p => p.getName() === `${pName}_message`);
            let constraintMsg: string | undefined;
            if (msgProp) {
              const msgType = checker.getTypeOfSymbolAtLocation(msgProp, msgProp.valueDeclaration || (msgProp as any).declarations?.[0]);
              constraintMsg = getStringLiteralValue(msgType);
            }
            constraints.push({ type: 'custom', value: fnName, message: constraintMsg });
          } else if (val !== undefined) {
            const msgProp = props.find(p => p.getName() === `${pName}_message`);
            let constraintMsg: string | undefined;
            if (msgProp) {
              const msgType = checker.getTypeOfSymbolAtLocation(msgProp, msgProp.valueDeclaration || (msgProp as any).declarations?.[0]);
              constraintMsg = getStringLiteralValue(msgType);
            }
            if (pName === '__minLength') constraints.push({ type: 'minLength', value: val, message: constraintMsg });
            else if (pName === '__maxLength') constraints.push({ type: 'maxLength', value: val, message: constraintMsg });
            else if (pName === '__minimum') constraints.push({ type: 'minimum', value: val, message: constraintMsg });
            else if (pName === '__maximum') constraints.push({ type: 'maximum', value: val, message: constraintMsg });
            else if (pName === '__exclusiveMinimum') constraints.push({ type: 'exclusiveMinimum', value: val, message: constraintMsg });
            else if (pName === '__exclusiveMaximum') constraints.push({ type: 'exclusiveMaximum', value: val, message: constraintMsg });
            else if (pName === '__multipleOf') constraints.push({ type: 'multipleOf', value: val, message: constraintMsg });
            else if (pName === '__pattern') constraints.push({ type: 'pattern', value: val, message: constraintMsg });
            else if (pName === '__format') constraints.push({ type: 'format', value: val, message: constraintMsg });
            else if (pName === '__minItems') constraints.push({ type: 'minItems', value: val, message: constraintMsg });
            else if (pName === '__maxItems') constraints.push({ type: 'maxItems', value: val, message: constraintMsg });
            else if (pName === '__uniqueItems') constraints.push({ type: 'uniqueItems', value: true, message: constraintMsg });
          } else if (pName === '__requires') {
            let reqVal: string | string[] = '';
            if (pType.isStringLiteral()) {
              reqVal = pType.value;
            } else {
              const typeArgs = (pType as ts.TypeReference).typeArguments || [];
              const items: string[] = [];
              for (const arg of typeArgs) {
                if (arg.isStringLiteral()) {
                  items.push(arg.value);
                }
              }
              reqVal = items;
            }
            const msgProp = props.find(p => p.getName() === `${pName}_message`);
            let constraintMsg: string | undefined;
            if (msgProp) {
              const msgType = checker.getTypeOfSymbolAtLocation(msgProp, msgProp.valueDeclaration || (msgProp as any).declarations?.[0]);
              constraintMsg = getStringLiteralValue(msgType);
            }
            constraints.push({ type: 'requires', value: reqVal, message: constraintMsg });
          }
        }
      }
    }

    if (constraints.length > 0) {
      if (baseName) {
        if (baseName === 'array' && baseType) {
           const baseValidator = buildValidator(baseType, checker, validatorsMap, requiredUtils);
           result = createConstrainedPrimitiveCheck(baseName, constraints, requiredUtils, baseValidator);
        } else if (baseType && (baseType.getFlags() & ts.TypeFlags.TemplateLiteral)) {
           const baseValidator = buildValidator(baseType, checker, validatorsMap, requiredUtils);
           result = createConstrainedPrimitiveCheck(baseName, constraints, requiredUtils, baseValidator);
        } else {
           result = createConstrainedPrimitiveCheck(baseName, constraints, requiredUtils);
        }
      } else {
        const nonConstraintTypes = types.filter(t => {
          const props = checker.getPropertiesOfType(t);
          return !props.some(p => p.getName().startsWith('__'));
        });

        let baseValidator: ts.Expression | undefined;
        if (nonConstraintTypes.length === 1) {
          baseValidator = buildValidator(nonConstraintTypes[0], checker, validatorsMap, requiredUtils);
        } else if (nonConstraintTypes.length > 1) {
          const checks = nonConstraintTypes.map(t => buildValidator(t, checker, validatorsMap, requiredUtils));
          baseValidator = createIntersectionCheck(checks, requiredUtils);
        }

        if (baseValidator) {
          result = createConstrainedPrimitiveCheck('any', constraints, requiredUtils, baseValidator);
        } else {
          const checks = (type as ts.IntersectionType).types.map(t => buildValidator(t, checker, validatorsMap, requiredUtils));
          result = createIntersectionCheck(checks, requiredUtils);
        }
      }
    } else {
      const checks = (type as ts.IntersectionType).types.map(t => buildValidator(t, checker, validatorsMap, requiredUtils));
      result = createIntersectionCheck(checks, requiredUtils);
    }
  } else if (type.getSymbol()?.name === 'Date') {
    result = createDateCheck(requiredUtils);
  } else if (type.getSymbol()?.name === 'RegExp') {
    result = createRegExpCheck(requiredUtils);
  } else if (type.getSymbol()?.name === 'Set') {
    const elementType = (type as ts.TypeReference).typeArguments?.[0] || checker.getAnyType();
    result = createSetCheck(buildValidator(elementType, checker, validatorsMap, requiredUtils), requiredUtils);
  } else if (type.getSymbol()?.name === 'Map') {
    const keyType = (type as ts.TypeReference).typeArguments?.[0] || checker.getAnyType();
    const valueType = (type as ts.TypeReference).typeArguments?.[1] || checker.getAnyType();
    result = createMapCheck(
      buildValidator(keyType, checker, validatorsMap, requiredUtils),
      buildValidator(valueType, checker, validatorsMap, requiredUtils),
      requiredUtils
    );
  } else if (flags & ts.TypeFlags.Null) {
    result = createNullCheck(requiredUtils);
  } else if (flags & ts.TypeFlags.Undefined || flags & ts.TypeFlags.Void) {
    result = createUndefinedCheck(requiredUtils);
  } else if (flags & ts.TypeFlags.String) {
    result = createPrimitiveCheck('string', requiredUtils);
  } else if (flags & ts.TypeFlags.Number) {
    result = createPrimitiveCheck('number', requiredUtils);
  } else if (flags & ts.TypeFlags.BigInt) {
    result = createPrimitiveCheck('bigint', requiredUtils);
  } else if (flags & ts.TypeFlags.Boolean) {
    result = createPrimitiveCheck('boolean', requiredUtils);
  } else if (flags & ts.TypeFlags.TemplateLiteral) {
    const templateType = type as ts.TemplateLiteralType;
    let regexStr = '^';
    for (let i = 0; i < templateType.texts.length; i++) {
      regexStr += templateType.texts[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (i < templateType.types.length) {
        const subType = templateType.types[i];
        const subFlags = subType.getFlags();
        if (subFlags & ts.TypeFlags.String) regexStr += '.*';
        else if (subFlags & ts.TypeFlags.Number) regexStr += '[0-9]+(\\.[0-9]+)?';
        else if (subFlags & ts.TypeFlags.BigInt) regexStr += '[0-9]+';
        else if (subFlags & ts.TypeFlags.Boolean) regexStr += '(true|false)';
        else regexStr += '.*';
      }
    }
    regexStr += '$';
    result = createTemplateLiteralCheck(regexStr, checker.typeToString(type), requiredUtils);
  } else if (type.isStringLiteral()) {
    result = createLiteralCheck(type.value, requiredUtils);
  } else if (type.isNumberLiteral()) {
    result = createLiteralCheck(type.value, requiredUtils);
  } else if (flags & ts.TypeFlags.BooleanLiteral) {
    result = createLiteralCheck((type as any).intrinsicName === 'true', requiredUtils);
  } else if (flags & ts.TypeFlags.BigIntLiteral) {
    result = createLiteralCheck((type as ts.BigIntLiteralType).value, requiredUtils);
  } else if (checker.isTupleType(type)) {
    const typeArgs = (type as ts.TupleTypeReference).typeArguments || [];
    result = createTupleCheck(typeArgs.map(t => buildValidator(t, checker, validatorsMap, requiredUtils)), requiredUtils);
  } else if (checker.isArrayType(type)) {
    const elementType = (type as ts.TypeReference).typeArguments?.[0] || checker.getAnyType();
    result = createArrayCheck(buildValidator(elementType, checker, validatorsMap, requiredUtils), requiredUtils);
  } else {
    const stringIndexInfo = checker.getIndexInfoOfType(type, ts.IndexKind.String);
    if (stringIndexInfo) {
      result = createRecordCheck(buildValidator(stringIndexInfo.type, checker, validatorsMap, requiredUtils), requiredUtils);
    } else if (flags & ts.TypeFlags.Object || type.isClassOrInterface() || type.isTypeParameter()) {
      const props = checker.getPropertiesOfType(type).map(prop => {
        const declaration = prop.valueDeclaration || prop.declarations?.[0];
        const propType = declaration ? checker.getTypeOfSymbolAtLocation(prop, declaration) : checker.getAnyType();
        return {
          name: prop.getName(),
          isOptional: (prop.getFlags() & ts.SymbolFlags.Optional) !== 0,
          validator: buildValidator(propType, checker, validatorsMap, requiredUtils)
        };
      });
      const typeName = checker.typeToString(type);
      result = createObjectCheck(props, requiredUtils, typeName);
    } else {
      result = createPrimitiveCheck('any', requiredUtils);
    }
  }

  validatorsMap.delete(hash);
  validatorsMap.set(hash, result);
  return ts.factory.createIdentifier(`__val_${hash}`);
}

function buildStructuralSignature(type: ts.Type, checker: ts.TypeChecker, visited: Set<number> = new Set()): string {
  const flags = type.getFlags();
  const typeId = (type as any).id;

    if (typeId && visited.has(typeId)) return `[Circular:${typeId}]`;
    if (typeId) visited.add(typeId);

    if ((flags & ts.TypeFlags.Union) && (type as any).types) {
      return `Union<${(type as ts.UnionType).types.map(t => buildStructuralSignature(t, checker, visited)).sort().join(',')}>`;
    }
    if ((flags & ts.TypeFlags.Intersection) && (type as any).types) {
      return `Intersection<${(type as ts.IntersectionType).types.map(t => buildStructuralSignature(t, checker, visited)).sort().join(',')}>`;
    }
  if (type.isStringLiteral()) return `S:"${type.value}"`;
  if (type.isNumberLiteral()) return `N:${type.value}`;
  if (flags & ts.TypeFlags.BigIntLiteral) return `B:${checker.typeToString(type)}`;
  if (flags & ts.TypeFlags.BooleanLiteral) return `L:${(type as any).intrinsicName}`;
  
  if (flags & ts.TypeFlags.String) return 'string';
  if (flags & ts.TypeFlags.Number) return 'number';
  if (flags & ts.TypeFlags.Boolean || (type as any).intrinsicName === 'boolean') return 'boolean';
  if (flags & ts.TypeFlags.BigInt) return 'bigint';
  if (flags & ts.TypeFlags.Null) return 'null';
  if (flags & ts.TypeFlags.Undefined || flags & ts.TypeFlags.Void) return 'undefined';
  if (flags & ts.TypeFlags.TemplateLiteral) {
    const templateType = type as ts.TemplateLiteralType;
    return `TemplateLiteral<${templateType.texts.join(',')}|${templateType.types.map(t => buildStructuralSignature(t, checker, visited)).join(',')}>`;
  }

  if (checker.isArrayType(type)) {
    const elementType = (type as ts.TypeReference).typeArguments?.[0] || checker.getAnyType();
    return `Array<${buildStructuralSignature(elementType, checker, visited)}>`;
  }

  if (flags & ts.TypeFlags.Object || type.isClassOrInterface()) {
    const props = checker.getPropertiesOfType(type);
    if (props.length === 0) {
        // Handle Record or empty object
        const stringIndexInfo = checker.getIndexInfoOfType(type, ts.IndexKind.String);
        if (stringIndexInfo) return `Record<${buildStructuralSignature(stringIndexInfo.type, checker, visited)}>`;
    }
    const propSigs = props.map(prop => {
      const declaration = prop.valueDeclaration || prop.declarations?.[0];
      const propType = declaration ? checker.getTypeOfSymbolAtLocation(prop, declaration) : checker.getAnyType();
      const isOptional = (prop.getFlags() & ts.SymbolFlags.Optional) !== 0;
      return `${prop.getName()}${isOptional ? '?' : ''}:${buildStructuralSignature(propType, checker, visited)}`;
    }).sort();
    return `Object{${propSigs.join(';')}}`;
  }

  return 'any';
}

export function generateHash(type: ts.Type, checker: ts.TypeChecker): string {
  const structuralSig = buildStructuralSignature(type, checker);
  return createHash('sha256').update(structuralSig).digest('hex').substring(0, 16);
}

export function objectToAst(val: any): ts.Expression {
  if (val === null) return ts.factory.createNull();
  if (val === undefined) return ts.factory.createIdentifier('undefined');
  if (typeof val === 'string') return ts.factory.createStringLiteral(val);
  if (typeof val === 'number') return ts.factory.createNumericLiteral(val.toString());
  if (typeof val === 'boolean') return val ? ts.factory.createTrue() : ts.factory.createFalse();
  if (typeof val === 'bigint') return ts.factory.createBigIntLiteral(val.toString() + 'n');
  if (Array.isArray(val)) {
    return ts.factory.createArrayLiteralExpression(val.map(objectToAst));
  }
  if (typeof val === 'object') {
    const properties = Object.entries(val).map(([k, v]) => 
      ts.factory.createPropertyAssignment(ts.factory.createStringLiteral(k), objectToAst(v))
    );
    return ts.factory.createObjectLiteralExpression(properties, true);
  }
  return ts.factory.createIdentifier('undefined');
}

export function getTypeComplexity(
  type: ts.Type,
  checker: ts.TypeChecker,
  visited: Set<number>
): number {
  const typeId = (type as any).id;
  if (typeId) {
    if (visited.has(typeId)) return 1;
    visited.add(typeId);
  }

  const flags = type.getFlags();
  let complexity = 1;

  const isUnion = (((flags & ts.TypeFlags.Union) !== 0 || type.isUnion()) && (type as any).types) ? true : false;
  const isIntersection = (((flags & ts.TypeFlags.Intersection) !== 0 || type.isIntersection()) && (type as any).types) ? true : false;

  if (isUnion) {
    for (const t of (type as ts.UnionType).types) {
      complexity += getTypeComplexity(t, checker, visited);
    }
  } else if (isIntersection) {
    for (const t of (type as ts.IntersectionType).types) {
      complexity += getTypeComplexity(t, checker, visited);
    }
  } else if (checker.isArrayType(type)) {
    const elementType = (type as ts.TypeReference).typeArguments?.[0] || checker.getAnyType();
    complexity += getTypeComplexity(elementType, checker, visited);
  } else if (checker.isTupleType(type)) {
    const elementTypes = (type as ts.TypeReference).typeArguments || [];
    for (const t of elementTypes) {
      complexity += getTypeComplexity(t, checker, visited);
    }
  } else if (flags & ts.TypeFlags.Object || type.isClassOrInterface()) {
    const name = type.getSymbol()?.name;
    if (name !== 'Date' && name !== 'Set' && name !== 'Map' && name !== 'RegExp') {
      const props = checker.getPropertiesOfType(type);
      for (const prop of props) {
        const propType = checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration || (prop as any).declarations?.[0]);
        complexity += getTypeComplexity(propType, checker, visited);
      }
    }
  }

  if (typeId) visited.delete(typeId);
  return complexity;
}

export function preScanType(
  type: ts.Type,
  checker: ts.TypeChecker,
  counts: Map<string, number>,
  circularHashes: Set<string>,
  visited: Set<number>
) {
  const flags = type.getFlags();
  const typeId = (type as any).id;
  if (!typeId) return;

  if (visited.has(typeId)) {
    const hash = generateHash(type, checker);
    circularHashes.add(hash);
    return;
  }
  visited.add(typeId);

  const isUnion = (((flags & ts.TypeFlags.Union) !== 0 || type.isUnion()) && (type as any).types) ? true : false;
  const isIntersection = (((flags & ts.TypeFlags.Intersection) !== 0 || type.isIntersection()) && (type as any).types) ? true : false;

  if (isUnion) {
    for (const t of (type as ts.UnionType).types) {
      preScanType(t, checker, counts, circularHashes, visited);
    }
  } else if (isIntersection) {
    for (const t of (type as ts.IntersectionType).types) {
      preScanType(t, checker, counts, circularHashes, visited);
    }
  } else if (checker.isArrayType(type)) {
    const elementType = (type as ts.TypeReference).typeArguments?.[0] || checker.getAnyType();
    preScanType(elementType, checker, counts, circularHashes, visited);
  } else if (checker.isTupleType(type)) {
    const elementTypes = (type as ts.TypeReference).typeArguments || [];
    for (const t of elementTypes) {
      preScanType(t, checker, counts, circularHashes, visited);
    }
  } else if (flags & ts.TypeFlags.Object || type.isClassOrInterface()) {
    const name = type.getSymbol()?.name;
    if (name !== 'Date' && name !== 'Set' && name !== 'Map' && name !== 'RegExp') {
      const hash = generateHash(type, checker);
      counts.set(hash, (counts.get(hash) || 0) + 1);

      const props = checker.getPropertiesOfType(type);
      for (const prop of props) {
        const propType = checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration || (prop as any).declarations?.[0]);
        preScanType(propType, checker, counts, circularHashes, visited);
      }
    }
  }

  visited.delete(typeId);
}

export function buildJsonSchema(type: ts.Type, checker: ts.TypeChecker): any {
  const defs: Record<string, any> = {};
  const visited = new Map<number, string>();
  const counts = new Map<string, number>();
  const circularHashes = new Set<string>();
  preScanType(type, checker, counts, circularHashes, new Set<number>());

  const rootSchema = buildJsonSchemaInternal(type, checker, defs, visited, counts, circularHashes);

  if (Object.keys(defs).length > 0) {
    const rootSymbol = type.getSymbol() || type.aliasSymbol;
    const rootName = rootSymbol ? rootSymbol.getName() : 'Root';
    const rootHash = generateHash(type, checker);
    const rootDefName = `${rootName}_${rootHash}`;

    if (defs[rootDefName]) {
      return {
        $ref: `#/$defs/${rootDefName}`,
        $defs: defs
      };
    } else {
      return {
        ...rootSchema,
        $defs: defs
      };
    }
  }

  return rootSchema;
}

function buildJsonSchemaInternal(
  type: ts.Type, 
  checker: ts.TypeChecker, 
  defs: Record<string, any>, 
  visited: Map<number, string>,
  counts: Map<string, number>,
  circularHashes: Set<string>
): any {
  const flags = type.getFlags();
  const typeId = (type as any).id;

  if (typeId && visited.has(typeId)) {
    return { $ref: `#/$defs/${visited.get(typeId)}` };
  }

  const isUnion = (((flags & ts.TypeFlags.Union) !== 0 || type.isUnion()) && (type as any).types) ? true : false;
  const isIntersection = (((flags & ts.TypeFlags.Intersection) !== 0 || type.isIntersection()) && (type as any).types) ? true : false;

  if (isUnion) {
    const types = (type as ts.UnionType).types;
    const isBoolUnion = types.length === 2 && 
      types.every(t => (t.getFlags() & ts.TypeFlags.BooleanLiteral) !== 0);
    
    if (isBoolUnion) {
      return { type: "boolean" };
    }

    return {
      anyOf: types.map(t => buildJsonSchemaInternal(t, checker, defs, visited, counts, circularHashes))
    };
  }

  if (isIntersection) {
    const types = (type as ts.IntersectionType).types;
    let baseSchema: any = {};
    const constraints: Record<string, any> = {};

    for (const sub of types) {
      const sFlags = sub.getFlags();
      if (sFlags & ts.TypeFlags.String || sFlags & ts.TypeFlags.TemplateLiteral) {
        baseSchema = { type: "string" };
      } else if (sFlags & ts.TypeFlags.Number) {
        baseSchema = { type: "number" };
      } else if (sFlags & ts.TypeFlags.BigInt) {
        baseSchema = { type: "integer" };
      } else if (sFlags & ts.TypeFlags.Boolean || (sub as any).intrinsicName === 'boolean') {
        baseSchema = { type: "boolean" };
      } else if (sub.getSymbol()?.name === 'Date') {
        baseSchema = { type: "string", format: "date-time" };
      } else if (sub.getSymbol()?.name === 'RegExp') {
        baseSchema = { type: "string", format: "regex" };
      } else if (sub.getSymbol()?.name === 'Set') {
        const elementType = (sub as ts.TypeReference).typeArguments?.[0] || checker.getAnyType();
        baseSchema = { type: "array", items: buildJsonSchemaInternal(elementType, checker, defs, visited, counts, circularHashes), uniqueItems: true };
      } else if (sub.getSymbol()?.name === 'Map') {
        const valueType = (sub as ts.TypeReference).typeArguments?.[1] || checker.getAnyType();
        baseSchema = { type: "object", additionalProperties: buildJsonSchemaInternal(valueType, checker, defs, visited, counts, circularHashes) };
      } else if (checker.isArrayType(sub)) {
        const elementType = (sub as ts.TypeReference).typeArguments?.[0] || checker.getAnyType();
        baseSchema = { type: "array", items: buildJsonSchemaInternal(elementType, checker, defs, visited, counts, circularHashes) };
      }

      const props = checker.getPropertiesOfType(sub);
      for (const prop of props) {
        const pName = prop.getName();
        if (pName.startsWith('__')) {
          const pType = checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration || (prop as any).declarations?.[0]);
          let val = (pType as any).value;
          if (val === undefined && (pType.getFlags() & ts.TypeFlags.BooleanLiteral)) {
            val = (pType as any).intrinsicName === 'true';
          }
          if (val === undefined && (pType.getFlags() & ts.TypeFlags.Null)) {
            val = null;
          }
          
          if (pName === '__default') constraints.default = val;
          else if (pName === '__minLength') constraints.minLength = val;
          else if (pName === '__maxLength') constraints.maxLength = val;
          else if (pName === '__minimum') constraints.minimum = val;
          else if (pName === '__maximum') constraints.maximum = val;
          else if (pName === '__exclusiveMinimum') constraints.exclusiveMinimum = val;
          else if (pName === '__exclusiveMaximum') constraints.exclusiveMaximum = val;
          else if (pName === '__multipleOf') constraints.multipleOf = val;
          else if (pName === '__pattern') constraints.pattern = val;
          else if (pName === '__format') constraints.format = val;
          else if (pName === '__minItems') constraints.minItems = val;
          else if (pName === '__maxItems') constraints.maxItems = val;
          else if (pName === '__uniqueItems') constraints.uniqueItems = true;
          else if (pName === '__requires') {
            let reqVal: string | string[] = '';
            if (pType.isStringLiteral()) {
              reqVal = pType.value;
            } else {
              const typeArgs = (pType as ts.TypeReference).typeArguments || [];
              const items: string[] = [];
              for (const arg of typeArgs) {
                if (arg.isStringLiteral()) {
                  items.push(arg.value);
                }
              }
              reqVal = items;
            }
            constraints.requires = reqVal;
          }
        }
      }
    }
    
    return { ...baseSchema, ...constraints };
  }

  if (type.getSymbol()?.name === 'Date') {
    return { type: "string", format: "date-time" };
  }
  if (type.getSymbol()?.name === 'RegExp') {
    return { type: "string", format: "regex" };
  }
  if (type.getSymbol()?.name === 'Set') {
    const elementType = (type as ts.TypeReference).typeArguments?.[0] || checker.getAnyType();
    return {
      type: "array",
      items: buildJsonSchemaInternal(elementType, checker, defs, visited, counts, circularHashes),
      uniqueItems: true
    };
  }
  if (type.getSymbol()?.name === 'Map') {
    const valueType = (type as ts.TypeReference).typeArguments?.[1] || checker.getAnyType();
    return {
      type: "object",
      additionalProperties: buildJsonSchemaInternal(valueType, checker, defs, visited, counts, circularHashes)
    };
  }
  if (flags & ts.TypeFlags.Null) {
    return { type: "null" };
  }
  if (flags & ts.TypeFlags.Undefined || flags & ts.TypeFlags.Void) {
    return { type: "null", description: "undefined" };
  }
  if (flags & ts.TypeFlags.String) {
    return { type: "string" };
  }
  if (flags & ts.TypeFlags.Number) {
    return { type: "number" };
  }
  if (flags & ts.TypeFlags.BigInt) {
    return { type: "integer" };
  }
  if (flags & ts.TypeFlags.Boolean || (type as any).intrinsicName === 'boolean') {
    return { type: "boolean" };
  }
  if (type.isStringLiteral()) {
    return { type: "string", const: type.value };
  }
  if (type.isNumberLiteral()) {
    return { type: "number", const: type.value };
  }
  if (flags & ts.TypeFlags.BigIntLiteral) {
    return { type: "integer", const: (type as any).value };
  }
  if (flags & ts.TypeFlags.BooleanLiteral) {
    return { type: "boolean", const: (type as any).intrinsicName === 'true' };
  }

  if (checker.isArrayType(type)) {
    const elementType = (type as ts.TypeReference).typeArguments?.[0] || checker.getAnyType();
    return {
      type: "array",
      items: buildJsonSchemaInternal(elementType, checker, defs, visited, counts, circularHashes)
    };
  }

  if (checker.isTupleType(type)) {
    const elementTypes = (type as ts.TypeReference).typeArguments || [];
    return {
      type: "array",
      items: elementTypes.map(t => buildJsonSchemaInternal(t, checker, defs, visited, counts, circularHashes)),
      minItems: elementTypes.length,
      maxItems: elementTypes.length
    };
  }

  // Object types
  if (flags & ts.TypeFlags.Object || type.isClassOrInterface()) {
    const symbol = type.getSymbol() || type.aliasSymbol;
    const name = symbol ? symbol.getName() : 'Object';
    const typeHash = generateHash(type, checker);
    const defName = `${name}_${typeHash}`;

    if (defs[defName]) {
      return { $ref: `#/$defs/${defName}` };
    }

    if (typeId && visited.has(typeId)) {
      return { $ref: `#/$defs/${defName}` };
    }

    if (typeId) visited.set(typeId, defName);

    const properties: Record<string, any> = {};
    const required: string[] = [];
    const props = checker.getPropertiesOfType(type);

    for (const prop of props) {
      const pName = prop.getName();
      const isOptional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
      const propType = checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration || (prop as any).declarations?.[0]);
      
      properties[pName] = buildJsonSchemaInternal(propType, checker, defs, visited, counts, circularHashes);
      if (!isOptional) {
        required.push(pName);
      }
    }

    const schemaObj: any = {
      type: "object",
      properties,
      additionalProperties: false
    };
    if (required.length > 0) {
      schemaObj.required = required;
    }

    if (typeId) visited.delete(typeId);

    const isCircular = circularHashes.has(typeHash);
    const refCount = counts.get(typeHash) || 0;
    const complexity = getTypeComplexity(type, checker, new Set<number>());
    const score = refCount * complexity;

    if (isCircular || score >= 128) {
      defs[defName] = schemaObj;
      return { $ref: `#/$defs/${defName}` };
    }

    return schemaObj;
  }

  return {};
}
