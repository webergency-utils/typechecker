/**
 * Fuzz-only CJS entry: runtime validators + casing + serialize/parse helpers.
 * Bundled to dist-fuzz/runtime.cjs for Jazzer.js (not part of the published package).
 */
export {
    validators,
    is,
    assert,
    assertGuard,
    validate,
    coerceQueryNumber,
    coerceQueryBoolean,
    coerceQueryDate,
    coerceJsonDate,
    extractFormDataObject,
    extractHeadersObject,
    groupErrorsByPath,
    toZodIssues,
    ZodLikeError
} from '../src/runtime/validators.js';

export { getOrCompileSchema, compileSchema } from '../src/runtime/schema-compiler.js';

export { convertPropertyCasing } from '../src/runtime/casing.js';

export { cloneAny } from '../src/runtime/clone-runtime.js';

export { createRng, randFromPattern } from '../src/runtime/random-runtime.js';

export {
    SerializationError,
    serializeString,
    serializeDate,
    serializeBuffer,
    serializeArray
} from '../src/runtime/serializer-runtime.js';

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
} from '../src/runtime/parse-runtime.js';
