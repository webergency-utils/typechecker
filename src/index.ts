export interface IValidation<T> {
  success: boolean;
  data?: T;
  errors?: any[];
}

export type ValidationMode = 'strict' | 'relaxed' | 'strip';

export interface ValidationOptions {
    mode?: ValidationMode;
    tryConvert?: boolean;
    wrapArrays?: boolean;
}

export declare function is<T>(input: unknown, options?: ValidationMode | ValidationOptions): input is T;
export declare function assert<T>(input: unknown, options?: ValidationMode | ValidationOptions): T;
export declare function assertGuard<T>(input: unknown, options?: ValidationMode | ValidationOptions): asserts input is T;
export declare function validate<T>(input: unknown, options?: ValidationMode | ValidationOptions): IValidation<T>;

export { default as transformer } from './transformer.js';
export * from './runtime/validators.js';
export * from './runtime/tags.js';
