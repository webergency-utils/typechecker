/**
 * Fuzz-only CJS entry: runtime validators + casing + serialize/parse helpers.
 * Bundled to dist-fuzz/runtime.cjs for Jazzer.js (not part of the published package).
 */
export {
    validators,
    getOrCompileSchema,
    is,
    assert,
    assertGuard,
    validate,
    compileSchema,
    coerceQueryNumber,
    coerceQueryBoolean,
    coerceQueryDate,
    coerceJsonDate,
    groupErrorsByPath,
    toZodIssues,
    ZodLikeError
} from './runtime/validators.js';

export { convertPropertyCasing } from './runtime/casing.js';

export {
    SerializationError,
    serializeString,
    serializeDate,
    serializeBuffer,
    serializeArray
} from './runtime/serializer-runtime.js';

export {
    ParseError,
    parseQueryString,
    coerceNumber,
    coerceBoolean,
    coerceDate,
    coerceArray,
    coerceBuffer,
    coerceBigInt,
    applyParseConstraints
} from './runtime/parse-runtime.js';
