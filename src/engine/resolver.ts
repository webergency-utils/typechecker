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
          if (val !== undefined) {
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
