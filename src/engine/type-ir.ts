import ts from 'typescript';
import
{
    BUFFER_LIKE,
    MergedPropInfo,
    NullableUnionClassification,
    TemplateIndexInfo,
    TupleInspection,
    bigIntLiteralText,
    buildTemplateLiteralRegex,
    classifyNullableUnion,
    getTemplateIndexInfos,
    inspectTupleType,
    isNativeEnumType,
    mapStructuralProps,
    stringIndexType,
    typeSymbolName
}
    from './type-helpers.js';

export type TypeIrKind =
    | 'any'
    | 'never'
    | 'void'
    | 'undefined'
    | 'null'
    | 'boolean'
    | 'string'
    | 'number'
    | 'bigint'
    | 'symbol'
    | 'literal-string'
    | 'literal-number'
    | 'literal-boolean'
    | 'literal-bigint'
    | 'template-literal'
    | 'enum'
    | 'union'
    | 'intersection'
    | 'tuple'
    | 'array'
    | 'date'
    | 'url'
    | 'regexp'
    | 'set'
    | 'map'
    | 'promise'
    | 'buffer'
    | 'function'
    | 'object';

export interface TypeIrNode
{
    readonly type                  : ts.Type
    readonly kind                  : TypeIrKind
    readonly flags                 : number
    readonly symbolName?           : string
    readonly literalValue?         : string | number | boolean | bigint
    readonly literalText?          : string
    readonly templateRegex?        : string
    readonly elementType?          : ts.Type
    readonly keyType?              : ts.Type
    readonly valueType?            : ts.Type
    getProps                       : () => MergedPropInfo[]
    getStringIndexType             : () => ts.Type | undefined
    getTemplateIndexInfos          : () => TemplateIndexInfo[]
    getTuple                       : () => TupleInspection
    getNullableUnionClassification : () => NullableUnionClassification
}

const irCacheByChecker = new WeakMap<object, WeakMap<object, TypeIrNode>>();

function classifyTypeIr( type: ts.Type, checker: ts.TypeChecker ): Omit<
    TypeIrNode,
    'getProps' | 'getStringIndexType' | 'getTemplateIndexInfos' | 'getTuple' | 'getNullableUnionClassification'
>
{
    const flags = typeof type.getFlags === 'function' ? type.getFlags() : 0;
    const symbolName = typeSymbolName( type );

    if( flags & ( ts.TypeFlags.Any | ts.TypeFlags.Unknown ))
    {
        return { type, kind : 'any', flags, symbolName };
    }

    if( flags & ts.TypeFlags.Never )
    {
        return { type, kind : 'never', flags, symbolName };
    }

    if( isNativeEnumType( type ))
    {
        return { type, kind : 'enum', flags, symbolName };
    }

    if( typeof type.isUnion === 'function' && type.isUnion() && !( flags & ts.TypeFlags.Boolean ))
    {
        return { type, kind : 'union', flags, symbolName };
    }

    if( typeof type.isIntersection === 'function' && type.isIntersection())
    {
        return { type, kind : 'intersection', flags, symbolName };
    }

    if( typeof type.isStringLiteral === 'function' && type.isStringLiteral())
    {
        return { type, kind : 'literal-string', flags, symbolName, literalValue : type.value };
    }

    if( typeof type.isNumberLiteral === 'function' && type.isNumberLiteral())
    {
        return { type, kind : 'literal-number', flags, symbolName, literalValue : type.value };
    }

    if( flags & ts.TypeFlags.BigIntLiteral )
    {
        const text = bigIntLiteralText( type );

        return { type, kind : 'literal-bigint', flags, symbolName, literalText : text };
    }

    if(( flags & ts.TypeFlags.BooleanLiteral ) && !( flags & ts.TypeFlags.Boolean ))
    {
        const val = ( type as any ).intrinsicName === 'true';

        return { type, kind : 'literal-boolean', flags, symbolName, literalValue : val };
    }

    if( flags & ts.TypeFlags.TemplateLiteral )
    {
        return {
            type,
            kind          : 'template-literal',
            flags,
            symbolName,
            templateRegex : buildTemplateLiteralRegex( type as ts.TemplateLiteralType )
        };
    }

    if( flags & ts.TypeFlags.String ){ return { type, kind : 'string', flags, symbolName } }

    if( flags & ts.TypeFlags.Number ){ return { type, kind : 'number', flags, symbolName } }

    if( flags & ts.TypeFlags.Boolean ){ return { type, kind : 'boolean', flags, symbolName } }

    if( flags & ts.TypeFlags.BigInt ){ return { type, kind : 'bigint', flags, symbolName } }

    if( flags & ( ts.TypeFlags.ESSymbol | ts.TypeFlags.UniqueESSymbol ))
    {
        return { type, kind : 'symbol', flags, symbolName };
    }

    if( flags & ts.TypeFlags.Void ){ return { type, kind : 'void', flags, symbolName } }

    if( flags & ts.TypeFlags.Undefined ){ return { type, kind : 'undefined', flags, symbolName } }

    if( flags & ts.TypeFlags.Null ){ return { type, kind : 'null', flags, symbolName } }

    if( typeof checker.isTupleType === 'function' && checker.isTupleType( type ))
    {
        return { type, kind : 'tuple', flags, symbolName };
    }

    if( typeof checker.isArrayType === 'function' && checker.isArrayType( type ))
    {
        const typeArgs = ( checker as any ).getTypeArguments?.( type as ts.TypeReference )
            || ( type as ts.TypeReference ).typeArguments
            || [];

        return { type, kind : 'array', flags, symbolName, elementType : typeArgs[0] };
    }

    if( symbolName === 'Date' ){ return { type, kind : 'date', flags, symbolName } }

    if( symbolName === 'URL' ){ return { type, kind : 'url', flags, symbolName } }

    if( symbolName === 'RegExp' ){ return { type, kind : 'regexp', flags, symbolName } }

    if( symbolName === 'Promise' ){ return { type, kind : 'promise', flags, symbolName } }

    if( symbolName === 'Set' || symbolName === 'ReadonlySet' )
    {
        const typeArgs = ( type as ts.TypeReference ).typeArguments
            || ( checker as any ).getTypeArguments?.( type as ts.TypeReference )
            || [];

        return { type, kind : 'set', flags, symbolName, elementType : typeArgs[0] };
    }

    if( symbolName === 'Map' || symbolName === 'ReadonlyMap' )
    {
        const typeArgs = ( type as ts.TypeReference ).typeArguments
            || ( checker as any ).getTypeArguments?.( type as ts.TypeReference )
            || [];

        return { type, kind : 'map', flags, symbolName, keyType : typeArgs[0], valueType : typeArgs[1] };
    }

    if( symbolName !== undefined && BUFFER_LIKE.has( symbolName ))
    {
        return { type, kind : 'buffer', flags, symbolName };
    }

    if(
        symbolName === 'Function' ||
        ( typeof type.getCallSignatures === 'function' &&
            type.getCallSignatures().length > 0 &&
            ( typeof type.getConstructSignatures !== 'function' || type.getConstructSignatures().length === 0 ))
    )
    {
        return { type, kind : 'function', flags, symbolName };
    }

    return { type, kind : 'object', flags, symbolName };
}

export function resolveTypeIr( type: ts.Type, checker: ts.TypeChecker ): TypeIrNode
{
    const checkerObj = ( checker && typeof checker === 'object' ) ? ( checker as object ) : undefined;
    const typeObj = ( type && typeof type === 'object' ) ? ( type as object ) : undefined;
    let typeMap: WeakMap<object, TypeIrNode> | undefined;

    if( checkerObj && typeObj )
    {
        typeMap = irCacheByChecker.get( checkerObj );

        if( !typeMap )
        {
            typeMap = new WeakMap<object, TypeIrNode>();
            irCacheByChecker.set( checkerObj, typeMap );
        }

        const hit = typeMap.get( typeObj );

        if( hit ){ return hit }
    }

    const base = classifyTypeIr( type, checker );
    let cachedProps: MergedPropInfo[] | undefined;
    let cachedStringIndex: ts.Type | undefined;
    let hasCachedStringIndex = false;
    let cachedTemplateIndex: TemplateIndexInfo[] | undefined;
    let cachedTuple: TupleInspection | undefined;
    let cachedNullableUnion: NullableUnionClassification | undefined;

    const node: TypeIrNode =
    {
        ...base,
        getProps()
        {
            if( !cachedProps ){ cachedProps = mapStructuralProps( type, checker ) }

            return cachedProps;
        },
        getStringIndexType()
        {
            if( !hasCachedStringIndex )
            {
                cachedStringIndex = stringIndexType( type, checker );
                hasCachedStringIndex = true;
            }

            return cachedStringIndex;
        },
        getTemplateIndexInfos()
        {
            if( !cachedTemplateIndex ){ cachedTemplateIndex = getTemplateIndexInfos( type, checker ) }

            return cachedTemplateIndex;
        },
        getTuple()
        {
            if( !cachedTuple ){ cachedTuple = inspectTupleType( type, checker ) }

            return cachedTuple;
        },
        getNullableUnionClassification()
        {
            if( !cachedNullableUnion )
            {
                const arms = typeof type.isUnion === 'function' && type.isUnion() ? type.types : [];
                cachedNullableUnion = classifyNullableUnion( arms );
            }

            return cachedNullableUnion;
        }
    };

    if( typeMap && typeObj )
    {
        typeMap.set( typeObj, node );
    }

    return node;
}
