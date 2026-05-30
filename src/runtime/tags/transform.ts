export type LowerCase = { readonly __transform_lowercase : true };
export type UpperCase = { readonly __transform_uppercase : true };
export type Trim = { readonly __transform_trim : true };
export type Capitalize = { readonly __transform_capitalize : true };
export type ToNumber = { readonly __transform_tonumber : true };
export type ToBoolean = { readonly __transform_toboolean : true };
export type ToDate = { readonly __transform_todate : true };
export type Custom<Fn extends ( val: any ) => any> = { readonly __transform_custom : Fn };
