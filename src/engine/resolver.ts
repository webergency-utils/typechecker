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
  createConstrainedPrimitiveCheck
} from './generators.js';
import { createHash } from 'crypto';

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

  const isUnion = (flags & ts.TypeFlags.Union) !== 0 || type.isUnion();
  const isIntersection = (flags & ts.TypeFlags.Intersection) !== 0 || type.isIntersection();

  if (isUnion) {
    const checks = (type as ts.UnionType).types.map(t => buildValidator(t, checker, validatorsMap, requiredUtils));
    result = createUnionCheck(checks, requiredUtils);
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
            const symbol = pType.getSymbol() || pType.aliasSymbol;
            if (symbol) {
              fnName = symbol.getName();
            } else {
              const str = checker.typeToString(pType);
              const match = str.match(/typeof\s+([a-zA-Z0-9_]+)/);
              if (match) fnName = match[1];
            }
            if (fnName) {
              constraints.push({ type: 'transform_custom', value: fnName });
            }
          } else if (pName === '__custom') {
            let fnName: string | undefined;
            const symbol = pType.getSymbol() || pType.aliasSymbol;
            if (symbol) {
              fnName = symbol.getName();
            } else {
              const str = checker.typeToString(pType);
              const match = str.match(/typeof\s+([a-zA-Z0-9_]+)/);
              if (match) fnName = match[1];
            }
            if (fnName) {
              constraints.push({ type: 'custom', value: fnName });
            }
          } else if (val !== undefined) {
            if (pName === '__minLength') constraints.push({ type: 'minLength', value: val });
            else if (pName === '__maxLength') constraints.push({ type: 'maxLength', value: val });
            else if (pName === '__minimum') constraints.push({ type: 'minimum', value: val });
            else if (pName === '__maximum') constraints.push({ type: 'maximum', value: val });
            else if (pName === '__exclusiveMinimum') constraints.push({ type: 'exclusiveMinimum', value: val });
            else if (pName === '__exclusiveMaximum') constraints.push({ type: 'exclusiveMaximum', value: val });
            else if (pName === '__multipleOf') constraints.push({ type: 'multipleOf', value: val });
            else if (pName === '__pattern') constraints.push({ type: 'pattern', value: val });
            else if (pName === '__format') constraints.push({ type: 'format', value: val });
            else if (pName === '__minItems') constraints.push({ type: 'minItems', value: val });
            else if (pName === '__maxItems') constraints.push({ type: 'maxItems', value: val });
            else if (pName === '__uniqueItems') constraints.push({ type: 'uniqueItems', value: true });
          }
        }
      }
    }

    if (baseName && constraints.length > 0) {
      if (baseName === 'array' && baseType) {
         // Special case: constrained array
         const baseValidator = buildValidator(baseType, checker, validatorsMap, requiredUtils);
         result = createConstrainedPrimitiveCheck(baseName, constraints, requiredUtils, baseValidator);
      } else if (baseType && (baseType.getFlags() & ts.TypeFlags.TemplateLiteral)) {
         // Special case: template literal with tags
         const baseValidator = buildValidator(baseType, checker, validatorsMap, requiredUtils);
         result = createConstrainedPrimitiveCheck(baseName, constraints, requiredUtils, baseValidator);
      } else {
         result = createConstrainedPrimitiveCheck(baseName, constraints, requiredUtils);
      }
    } else {
      const checks = (type as ts.IntersectionType).types.map(t => buildValidator(t, checker, validatorsMap, requiredUtils));
      result = createIntersectionCheck(checks, requiredUtils);
    }
  } else if (type.getSymbol()?.name === 'Date') {
    result = createDateCheck(requiredUtils);
  } else if (type.getSymbol()?.name === 'RegExp') {
    result = createRegExpCheck(requiredUtils);
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

  if (flags & ts.TypeFlags.Union) {
    return `Union<${(type as ts.UnionType).types.map(t => buildStructuralSignature(t, checker, visited)).sort().join(',')}>`;
  }
  if (flags & ts.TypeFlags.Intersection) {
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

export function buildJsonSchema(type: ts.Type, checker: ts.TypeChecker): any {
  const defs: Record<string, any> = {};
  const visited = new Map<number, string>();
  const rootSchema = buildJsonSchemaInternal(type, checker, defs, visited);

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
  visited: Map<number, string>
): any {
  const flags = type.getFlags();
  const typeId = (type as any).id;

  if (typeId && visited.has(typeId)) {
    return { $ref: `#/$defs/${visited.get(typeId)}` };
  }

  const isUnion = (flags & ts.TypeFlags.Union) !== 0 || type.isUnion();
  const isIntersection = (flags & ts.TypeFlags.Intersection) !== 0 || type.isIntersection();

  if (isUnion) {
    const types = (type as ts.UnionType).types;
    const isBoolUnion = types.length === 2 && 
      types.every(t => (t.getFlags() & ts.TypeFlags.BooleanLiteral) !== 0);
    
    if (isBoolUnion) {
      return { type: "boolean" };
    }

    return {
      anyOf: types.map(t => buildJsonSchemaInternal(t, checker, defs, visited))
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
      } else if (checker.isArrayType(sub)) {
        const elementType = (sub as ts.TypeReference).typeArguments?.[0] || checker.getAnyType();
        baseSchema = { type: "array", items: buildJsonSchemaInternal(elementType, checker, defs, visited) };
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
        }
      }
    }
    
    return { ...baseSchema, ...constraints };
  }

  if (type.getSymbol()?.name === 'Date') {
    return { type: "string", format: "date-time" };
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
      items: buildJsonSchemaInternal(elementType, checker, defs, visited)
    };
  }

  if (checker.isTupleType(type)) {
    const elementTypes = (type as ts.TypeReference).typeArguments || [];
    return {
      type: "array",
      items: elementTypes.map(t => buildJsonSchemaInternal(t, checker, defs, visited)),
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

    if (typeId) visited.set(typeId, defName);

    const properties: Record<string, any> = {};
    const required: string[] = [];
    const props = checker.getPropertiesOfType(type);

    for (const prop of props) {
      const pName = prop.getName();
      const isOptional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
      const propType = checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration || (prop as any).declarations?.[0]);
      
      properties[pName] = buildJsonSchemaInternal(propType, checker, defs, visited);
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

    defs[defName] = schemaObj;

    if (typeId) visited.delete(typeId);

    return { $ref: `#/$defs/${defName}` };
  }

  return {};
}
