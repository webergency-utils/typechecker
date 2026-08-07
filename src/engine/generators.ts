import * as ts from 'typescript';

const templateAstCache = new Map<string, ts.Expression>();

export function templateToAst( template: string ): ts.Expression 
{
    const hit = templateAstCache.get( template );

    if( hit )
    {
        return stripPositions( hit );
    }

    const asExpression = ts.createSourceFile(
        'template.ts',
        `${template};`,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
    );
    const expressionStatement = asExpression.statements[0];

    if( ts.isExpressionStatement( expressionStatement ))
    {
        const expr = stripPositions( expressionStatement.expression );
        templateAstCache.set( template, expr );

        return stripPositions( expr );
    }

    const asVariable = ts.createSourceFile(
        'template.ts',
        `const x = ${template};`,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
    );
    const variableStatement = asVariable.statements[0];

    if( ts.isVariableStatement( variableStatement ))
    {
        const expr = stripPositions( variableStatement.declarationList.declarations[0].initializer! );
        templateAstCache.set( template, expr );

        return stripPositions( expr );
    }

    throw new Error( 'Template must be an expression or variable declaration' );
}


function stripPositions<T extends ts.Node>( node: T ): T 
{
    const visitor = ( n: ts.Node ): ts.Node => 
    {
        const cloned = ts.visitEachChild( n, visitor, undefined );
        const res = { ...cloned, pos : -1, end : -1 };
        Object.setPrototypeOf( res, Object.getPrototypeOf( cloned ));

        return res as ts.Node;
    };

    return ts.visitNode( node, visitor ) as T;
}

export function injectNodes( expr: ts.Expression, replacements: Record<string, ts.Expression> ): ts.Expression 
{
    const transformer: ts.TransformerFactory<ts.Node> = ( context ) => 
    {
        return ( rootNode ) => 
        {
            function visit( node: ts.Node ): ts.Node 
            {
                if( ts.isIdentifier( node ) && replacements[node.text]) 
                {
                    return stripPositions( replacements[node.text]);
                }

                return ts.visitEachChild( node, visit, context );
            }

            return ts.visitNode( rootNode, visit );
        };
    };

    const result = ts.transform( expr, [transformer]);

    return stripPositions( result.transformed[0] as ts.Expression );
}

export function createPrimitiveCheck( type: string ): ts.Expression 
{
    return ts.factory.createPropertyAccessExpression(
        ts.factory.createIdentifier( 'validators' ),
        ts.factory.createIdentifier( type )
    );
}

export function createConstrainedPrimitiveCheck( baseType: string, constraints: any[], baseValidator?: ts.Expression ): ts.Expression 
{
    const defaultConstraint = constraints.find( c => c.type === 'default' );
    const transformConstraints = constraints.filter( c => c.type === 'transform' || c.type === 'transform_custom' );
    const messageConstraint = constraints.find( c => c.type === 'message' );
    const remainingConstraints = constraints.filter( c => c.type !== 'default' && c.type !== 'transform' && c.type !== 'transform_custom' && c.type !== 'message' );
    
    const fallbackMsg = messageConstraint?.value;
    const constraintCode = remainingConstraints.map( c => 
    {
        const valStr = typeof c.value === 'bigint' ? `${c.value}n` : ( typeof c.value === 'string' ? `"${c.value}"` : `${c.value}` );
        const activeMsg = c.message !== undefined ? c.message : fallbackMsg;
        const msgArg = activeMsg !== undefined ? `, ${JSON.stringify( activeMsg )}` : '';

        if( c.type === 'minLength' ) { return `validators.minLength(v, path, ctx, ${valStr}${msgArg})` }

        if( c.type === 'maxLength' ) { return `validators.maxLength(v, path, ctx, ${valStr}${msgArg})` }

        if( c.type === 'minimum' ) { return `validators.minimum(v, path, ctx, ${valStr}${msgArg})` }

        if( c.type === 'maximum' ) { return `validators.maximum(v, path, ctx, ${valStr}${msgArg})` }

        if( c.type === 'exclusiveMinimum' ) { return `validators.exclusiveMinimum(v, path, ctx, ${valStr}${msgArg})` }

        if( c.type === 'exclusiveMaximum' ) { return `validators.exclusiveMaximum(v, path, ctx, ${valStr}${msgArg})` }

        if( c.type === 'multipleOf' ) { return `validators.multipleOf(v, path, ctx, ${valStr}${msgArg})` }

        if( c.type === 'pattern' ) { return `validators.pattern(v, path, ctx, validators.safeRegExp(${JSON.stringify( c.value )}), ${JSON.stringify( 'Pattern<' + c.value + '>' )}${msgArg})` }

        if( c.type === 'format' ) { return `v = validators.format(v, path, ctx, ${JSON.stringify( c.value )}${msgArg})` }

        if( c.type === 'minItems' ) { return `validators.minItems(v, path, ctx, ${valStr}${msgArg})` }

        if( c.type === 'maxItems' ) { return `validators.maxItems(v, path, ctx, ${valStr}${msgArg})` }

        if( c.type === 'uniqueItems' ) { return `validators.uniqueItems(v, path, ctx${msgArg})` }

        if( c.type === 'custom' ) { return `validators.custom(v, path, ctx, ${c.value}${msgArg})` }

        if( c.type === 'requires' ) { return `validators.requires(v, path, ctx, ${JSON.stringify( Array.isArray( c.value ) ? c.value : [c.value])}${msgArg})` }

        return '';
    }).filter( c => c !== '' ).join( ';\n            ' );

    let defaultInit = '';

    if( defaultConstraint ) 
    {
        defaultInit = `if (v === undefined) v = ${JSON.stringify( defaultConstraint.value )};\n        `;
    }

    let transformInit = '';

    if( transformConstraints.length > 0 ) 
    {
        const statements = transformConstraints.map( tc => 
        {
            if( tc.type === 'transform' && tc.value === 'lowercase' ) 
            {
                return 'if (typeof v === \'string\') v = v.toLowerCase()';
            }

            if( tc.type === 'transform' && tc.value === 'uppercase' ) 
            {
                return 'if (typeof v === \'string\') v = v.toUpperCase()';
            }

            if( tc.type === 'transform' && tc.value === 'trim' ) 
            {
                return 'if (typeof v === \'string\') v = v.trim()';
            }

            if( tc.type === 'transform' && tc.value === 'capitalize' ) 
            {
                return 'if (typeof v === \'string\' && v.length > 0) v = v.charAt(0).toUpperCase() + v.slice(1)';
            }

            if( tc.type === 'transform' && tc.value === 'tonumber' ) 
            {
                return 'v = validators.coerceQueryNumber(v)';
            }

            if( tc.type === 'transform' && tc.value === 'toboolean' ) 
            {
                return 'v = validators.coerceQueryBoolean(v)';
            }

            if( tc.type === 'transform' && tc.value === 'todate' ) 
            {
                return 'v = validators.coerceQueryDate(v)';
            }

            if( tc.type === 'transform_custom' ) 
            {
                return `v = ${tc.value}(v)`;
            }

            return '';
        }).filter( s => s !== '' ).join( ';\n            ' );
        
        transformInit = `if (v !== undefined && v !== null) {\n            ${statements};\n        }\n        `;
    }

    const tpl = `
    (v, path, ctx) => {
        const _s = ctx.success;
        ctx.success = true;
        ${defaultInit}${transformInit}v = __BASE_CHECK__;
        if (ctx.success && v !== undefined && v !== null) {
            ${constraintCode};
        }
        if (_s === false) ctx.success = false;
        return v;
    }
    `;
    
    const baseCheck = baseValidator ? ts.factory.createCallExpression(
        baseValidator,
        undefined,
        [ts.factory.createIdentifier( 'v' ), ts.factory.createIdentifier( 'path' ), ts.factory.createIdentifier( 'ctx' )]
    ) : ts.factory.createCallExpression(
        ts.factory.createPropertyAccessExpression( ts.factory.createIdentifier( 'validators' ), ts.factory.createIdentifier( baseType )),
        undefined,
        [ts.factory.createIdentifier( 'v' ), ts.factory.createIdentifier( 'path' ), ts.factory.createIdentifier( 'ctx' )]
    );
    
    return injectNodes( templateToAst( tpl ), { '__BASE_CHECK__' : baseCheck });
}

export function createLiteralCheck( value: string | number | boolean | ts.PseudoBigInt ): ts.Expression 
{
    
    return ts.factory.createArrowFunction(
        undefined,
        undefined,
        [
            ts.factory.createParameterDeclaration( undefined, undefined, ts.factory.createIdentifier( 'v' )),
            ts.factory.createParameterDeclaration( undefined, undefined, ts.factory.createIdentifier( 'path' )),
            ts.factory.createParameterDeclaration( undefined, undefined, ts.factory.createIdentifier( 'ctx' ))
        ],
        undefined,
        undefined,
        ts.factory.createCallExpression(
            ts.factory.createPropertyAccessExpression( ts.factory.createIdentifier( 'validators' ), ts.factory.createIdentifier( 'literal' )),
            undefined,
            [
                ts.factory.createIdentifier( 'v' ),
                ts.factory.createIdentifier( 'path' ),
                ts.factory.createIdentifier( 'ctx' ),
                typeof value === 'string' ? ts.factory.createStringLiteral( value ) :
                    typeof value === 'number' ? ts.factory.createNumericLiteral( value.toString()) :
                        typeof value === 'boolean' ? ( value ? ts.factory.createTrue() : ts.factory.createFalse()) :
                            ts.factory.createBigIntLiteral(( value as any ).base10Value + 'n' )
            ]
        )
    );
}

export function createArrayCheck( elementValidator: ts.Expression ): ts.Expression 
{
    const tpl = '(v, path, ctx) => validators.array(v, path, ctx, __CHILD__)';

    return injectNodes( templateToAst( tpl ), { '__CHILD__' : elementValidator });
}

export function createTemplateLiteralCheck( regexStr: string, expected: string ): ts.Expression 
{
    const tpl = `(v, path, ctx) => validators.templateLiteral(v, path, ctx, validators.safeRegExp(${JSON.stringify( regexStr )}), ${JSON.stringify( expected )})`;

    return stripPositions( templateToAst( tpl ));
}

export type NullableKind = 'optional' | 'nullable' | 'nullish';

export function createTaggedUnionCheck(
    key: string,
    byTag: [string | number, ts.Expression][],
    expected: string
): ts.Expression
{
    const entries = byTag.map(([value, check]) => ts.factory.createArrayLiteralExpression([
        typeof value === 'number'
            ? ts.factory.createNumericLiteral( value.toString())
            : ts.factory.createStringLiteral( value ),
        check
    ]));

    // The lookup table is bound by an immediately applied arrow so it is built once at module load
    // rather than on every validation.
    const tpl = '((byTag) => (v, path, ctx) => validators.taggedUnion(v, path, ctx, __KEY__, byTag, __EXPECTED__))(__BY_TAG__)';

    return injectNodes( templateToAst( tpl ), {
        '__KEY__'      : ts.factory.createStringLiteral( key ),
        '__EXPECTED__' : ts.factory.createStringLiteral( expected ),
        '__BY_TAG__'   : ts.factory.createNewExpression(
            ts.factory.createIdentifier( 'Map' ),
            undefined,
            [ts.factory.createArrayLiteralExpression( entries, true )]
        )
    });
}

export function createNullableCheck( kind: NullableKind, inner: ts.Expression ): ts.Expression
{
    const tpl = `(v, path, ctx) => validators.${kind}(v, path, ctx, __INNER__)`;

    return injectNodes( templateToAst( tpl ), { '__INNER__' : inner });
}

export function createUnionCheck( checks: ts.Expression[], expected: string = 'Type<Union>' ): ts.Expression 
{
    const tpl = '((checks) => (v, path, ctx) => validators.union(v, path, ctx, checks, __EXPECTED__))(__CHECKS__)';

    return injectNodes( templateToAst( tpl ), {
        '__CHECKS__'   : ts.factory.createArrayLiteralExpression( checks ),
        '__EXPECTED__' : ts.factory.createStringLiteral( expected )
    });
}

export function createObjectCheck( props: any[], expected: string = 'object', indexValidator?: ts.Expression ): ts.Expression 
{
    const propDefinitions = props.map(( p ) => 
    {
        const parts: ts.Expression[] =
        [
            ts.factory.createStringLiteral( p.name ),
            p.isOptional ? ts.factory.createTrue() : ts.factory.createFalse(),
            p.validator
        ];

        // Only carried when set: an absent optional property is skipped unless a default fills it in.
        if( p.hasDefault ){ parts.push( ts.factory.createTrue()) }

        return ts.factory.createArrayLiteralExpression( parts );
    });

    const allowedKeys = props.map( p => ts.factory.createStringLiteral( p.name ));
    const allowedKeySet = ts.factory.createNewExpression(
        ts.factory.createIdentifier( 'Set' ),
        undefined,
        [ts.factory.createArrayLiteralExpression( allowedKeys )]
    );

    if( indexValidator )
    {
        const tpl = `
        ((keys, props) => (v, path, ctx) => {
            const obj = validators.object(v, path, ctx, undefined, __EXPECTED__);
            if (obj === false) return v;
            const data = validators.objectShell(obj, ctx, true);
            validators.props(obj, data, path, ctx, props);
            validators.additionalProps(obj, data, path, ctx, keys, __INDEX__);
            return data;
        })(__KEYS__, __PROPS__)
        `;

        return injectNodes( templateToAst( tpl ), {
            '__KEYS__'     : allowedKeySet,
            '__EXPECTED__' : ts.factory.createStringLiteral( expected ),
            '__PROPS__'    : ts.factory.createArrayLiteralExpression( propDefinitions, true ),
            '__INDEX__'    : indexValidator
        });
    }

    const tpl = `
    ((keys, props) => (v, path, ctx) => {
        const obj = validators.object(v, path, ctx, keys, __EXPECTED__);
        if (obj === false) return v;
        const data = validators.objectShell(obj, ctx, true);
        validators.props(obj, data, path, ctx, props);
        validators.stripExtras(data, ctx, keys);
        return data;
    })(__KEYS__, __PROPS__)
    `;
    
    return injectNodes( templateToAst( tpl ), {
        '__KEYS__'     : allowedKeySet,
        '__EXPECTED__' : ts.factory.createStringLiteral( expected ),
        '__PROPS__'    : ts.factory.createArrayLiteralExpression( propDefinitions, true )
    });
}

export function createRecordCheck( valueValidator: ts.Expression ): ts.Expression 
{
    const tpl = '(v, path, ctx) => validators.record(v, path, ctx, __CHILD__)';

    return injectNodes( templateToAst( tpl ), { '__CHILD__' : valueValidator });
}

export function createTupleCheck( checks: ts.Expression[]): ts.Expression 
{
    const tpl = '((checks) => (v, path, ctx) => validators.tuple(v, path, ctx, checks))(__CHECKS__)';

    return injectNodes( templateToAst( tpl ), {
        '__CHECKS__' : ts.factory.createArrayLiteralExpression( checks )
    });
}

export function createDateCheck(): ts.Expression 
{
    return ts.factory.createPropertyAccessExpression( ts.factory.createIdentifier( 'validators' ), ts.factory.createIdentifier( 'date' ));
}

export function createRegExpCheck(): ts.Expression 
{
    return ts.factory.createPropertyAccessExpression( ts.factory.createIdentifier( 'validators' ), ts.factory.createIdentifier( 'regexp' ));
}

export function createNullCheck(): ts.Expression 
{
    return ts.factory.createPropertyAccessExpression( ts.factory.createIdentifier( 'validators' ), ts.factory.createIdentifier( 'null' ));
}

export function createUndefinedCheck(): ts.Expression 
{
    return ts.factory.createPropertyAccessExpression( ts.factory.createIdentifier( 'validators' ), ts.factory.createIdentifier( 'undefined' ));
}

export function createIntersectionCheck( checks: ts.Expression[]): ts.Expression 
{
    const tpl = `
    ((checks) => (v, path, ctx) => {
        let data = validators.objectShell(v, ctx);
        for (let i = 0; i < checks.length; i++) {
            const val = checks[i](v, path, ctx);
            if (typeof val === "object" && val !== null && !Array.isArray(val) && typeof data === "object" && data !== null && !Array.isArray(data)) validators.assign(data, val);
            else data = val;
        }
        return data;
    })(__CHECKS__)
    `;

    return injectNodes( templateToAst( tpl ), {
        '__CHECKS__' : ts.factory.createArrayLiteralExpression( checks )
    });
}

export function createSetCheck( elementValidator: ts.Expression ): ts.Expression 
{
    const tpl = '(v, path, ctx) => validators.set(v, path, ctx, __CHILD__)';

    return injectNodes( templateToAst( tpl ), { '__CHILD__' : elementValidator });
}

export function createMapCheck( keyValidator: ts.Expression, valueValidator: ts.Expression ): ts.Expression 
{
    const tpl = '(v, path, ctx) => validators.map(v, path, ctx, __KEY__, __VALUE__)';

    return injectNodes( templateToAst( tpl ), { '__KEY__' : keyValidator, '__VALUE__' : valueValidator });
}

export function createInstanceOfCheck( ctorOrName: string | ts.Expression ): ts.Expression
{
    if( typeof ctorOrName === 'string' )
    {
        const tpl = `(v, path, ctx) => validators.instanceOf(v, path, ctx, ${JSON.stringify( ctorOrName )})`;

        return templateToAst( tpl );
    }

    return injectNodes(
        templateToAst( '(v, path, ctx) => validators.instanceOf(v, path, ctx, __CTOR__)' ),
        { '__CTOR__' : ctorOrName }
    );
}
