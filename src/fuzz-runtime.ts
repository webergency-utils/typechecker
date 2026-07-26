/**
 * Fuzz-only CJS entry: runtime validators + casing.
 * Bundled to dist-fuzz/runtime.cjs for Jazzer.js (not part of the published package).
 */
export {
    validators,
    MetadataStore,
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
