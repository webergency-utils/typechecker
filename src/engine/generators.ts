import * as ts from 'typescript';

export interface IValidationRegistry {
    validators : Map<string, ts.Expression>
}

export function createRegistry(): IValidationRegistry 
{
    return {
        validators : new Map()
    };
}

export function templateToAst( template: string ): ts.Expression 
{
    const source = ts.createSourceFile( 'template.ts', `const x = ${template};`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS );
    const statement = source.statements[0];

    if( ts.isVariableStatement( statement ) ) 
    {
        return statement.declarationList.declarations[0].initializer!;
    }

    if( ts.isExpressionStatement( statement ) ) 
    {
        return statement.expression;
    }
    throw new Error( 'Template must be an expression or variable declaration' );
}

function stripPositions<T extends ts.Node>( node: T ): T 
{
    const visitor = ( n: ts.Node ): ts.Node => 
    {
        const cloned = ts.visitEachChild( n, visitor, undefined );
        const res = { ...cloned, pos : -1, end : -1 };
        Object.setPrototypeOf( res, Object.getPrototypeOf( cloned ) );

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
                if( ts.isIdentifier( node ) && replacements[node.text] ) 
                {
                    return stripPositions( replacements[node.text] );
                }

                return ts.visitEachChild( node, visit, context );
            }

            return ts.visitNode( rootNode, visit );
        };
    };

    const result = ts.transform( expr, [transformer] );

    return stripPositions( result.transformed[0] as ts.Expression );
}

export function createPrimitiveCheck( type: string, requiredUtils: Set<string> ): ts.Expression 
{
    requiredUtils.add( 'validators' );

    return ts.factory.createPropertyAccessExpression(
        ts.factory.createIdentifier( 'validators' ),
        ts.factory.createIdentifier( type )
    );
}

export function createConstrainedPrimitiveCheck( baseType: string, constraints: any[], requiredUtils: Set<string>, baseValidator?: ts.Expression ): ts.Expression 
{
    requiredUtils.add( 'validators' );
    
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

        if( c.type === 'minLength' ) {return `validators.minLength(v, path, ctx, ${valStr}${msgArg})`}

        if( c.type === 'maxLength' ) {return `validators.maxLength(v, path, ctx, ${valStr}${msgArg})`}

        if( c.type === 'minimum' ) {return `validators.minimum(v, path, ctx, ${valStr}${msgArg})`}

        if( c.type === 'maximum' ) {return `validators.maximum(v, path, ctx, ${valStr}${msgArg})`}

        if( c.type === 'exclusiveMinimum' ) {return `validators.exclusiveMinimum(v, path, ctx, ${valStr}${msgArg})`}

        if( c.type === 'exclusiveMaximum' ) {return `validators.exclusiveMaximum(v, path, ctx, ${valStr}${msgArg})`}

        if( c.type === 'multipleOf' ) {return `validators.multipleOf(v, path, ctx, ${valStr}${msgArg})`}

        if( c.type === 'pattern' ) {return `validators.pattern(v, path, ctx, new RegExp(${JSON.stringify( c.value )}), ${JSON.stringify( 'Pattern<' + c.value + '>' )}${msgArg})`}

        if( c.type === 'format' ) {return `validators.format(v, path, ctx, ${JSON.stringify( c.value )}${msgArg})`}

        if( c.type === 'minItems' ) {return `validators.minItems(v, path, ctx, ${valStr}${msgArg})`}

        if( c.type === 'maxItems' ) {return `validators.maxItems(v, path, ctx, ${valStr}${msgArg})`}

        if( c.type === 'uniqueItems' ) {return `validators.uniqueItems(v, path, ctx${msgArg})`}

        if( c.type === 'custom' ) {return `validators.custom(v, path, ctx, ${c.value}${msgArg})`}

        if( c.type === 'requires' ) {return `validators.requires(v, path, ctx, ${JSON.stringify( Array.isArray( c.value ) ? c.value : [c.value] )}${msgArg})`}

        return '';
    } ).filter( c => c !== '' ).join( ';\n            ' );

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
                return 'v = Number(v)';
            }

            if( tc.type === 'transform' && tc.value === 'toboolean' ) 
            {
                return 'v = (v === \'true\' || v === \'1\' || v === true || v === 1)';
            }

            if( tc.type === 'transform' && tc.value === 'todate' ) 
            {
                return 'v = new Date(v)';
            }

            if( tc.type === 'transform_custom' ) 
            {
                return `v = ${tc.value}(v)`;
            }

            return '';
        } ).filter( s => s !== '' ).join( ';\n            ' );
        
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
        ts.factory.createPropertyAccessExpression( ts.factory.createIdentifier( 'validators' ), ts.factory.createIdentifier( baseType ) ),
        undefined,
        [ts.factory.createIdentifier( 'v' ), ts.factory.createIdentifier( 'path' ), ts.factory.createIdentifier( 'ctx' )]
    );
    
    return injectNodes( templateToAst( tpl ), { '__BASE_CHECK__' : baseCheck } );
}

export function createLiteralCheck( value: string | number | boolean | ts.PseudoBigInt, requiredUtils: Set<string> ): ts.Expression 
{
    requiredUtils.add( 'validators' );
    
    return ts.factory.createArrowFunction(
        undefined,
        undefined,
        [
            ts.factory.createParameterDeclaration( undefined, undefined, ts.factory.createIdentifier( 'v' ) ),
            ts.factory.createParameterDeclaration( undefined, undefined, ts.factory.createIdentifier( 'path' ) ),
            ts.factory.createParameterDeclaration( undefined, undefined, ts.factory.createIdentifier( 'ctx' ) )
        ],
        undefined,
        undefined,
        ts.factory.createCallExpression(
            ts.factory.createPropertyAccessExpression( ts.factory.createIdentifier( 'validators' ), ts.factory.createIdentifier( 'literal' ) ),
            undefined,
            [
                ts.factory.createIdentifier( 'v' ),
                ts.factory.createIdentifier( 'path' ),
                ts.factory.createIdentifier( 'ctx' ),
                typeof value === 'string' ? ts.factory.createStringLiteral( value ) :
                    typeof value === 'number' ? ts.factory.createNumericLiteral( value.toString() ) :
                        typeof value === 'boolean' ? ( value ? ts.factory.createTrue() : ts.factory.createFalse() ) :
                            ts.factory.createBigIntLiteral( ( value as any ).base10Value + 'n' )
            ]
        )
    );
}

export function createArrayCheck( elementValidator: ts.Expression, requiredUtils: Set<string> ): ts.Expression 
{
    requiredUtils.add( 'validators' );
    const tpl = '(v, path, ctx) => validators.array(v, path, ctx, __CHILD__)';

    return injectNodes( templateToAst( tpl ), { '__CHILD__' : elementValidator } );
}

export function createTemplateLiteralCheck( regexStr: string, expected: string, requiredUtils: Set<string> ): ts.Expression 
{
    requiredUtils.add( 'validators' );
    const tpl = `(v, path, ctx) => validators.templateLiteral(v, path, ctx, new RegExp(${JSON.stringify( regexStr )}), ${JSON.stringify( expected )})`;

    return stripPositions( templateToAst( tpl ) );
}

export function createUnionCheck( checks: ts.Expression[], requiredUtils: Set<string>, expected: string = 'Type<Union>' ): ts.Expression 
{
    requiredUtils.add( 'validators' );

    return ts.factory.createArrowFunction(
        undefined,
        undefined,
        [
            ts.factory.createParameterDeclaration( undefined, undefined, ts.factory.createIdentifier( 'v' ) ),
            ts.factory.createParameterDeclaration( undefined, undefined, ts.factory.createIdentifier( 'path' ) ),
            ts.factory.createParameterDeclaration( undefined, undefined, ts.factory.createIdentifier( 'ctx' ) )
        ],
        undefined,
        undefined,
        ts.factory.createCallExpression(
            ts.factory.createPropertyAccessExpression( ts.factory.createIdentifier( 'validators' ), ts.factory.createIdentifier( 'union' ) ),
            undefined,
            [
                ts.factory.createIdentifier( 'v' ),
                ts.factory.createIdentifier( 'path' ),
                ts.factory.createIdentifier( 'ctx' ),
                ts.factory.createArrayLiteralExpression( checks ),
                ts.factory.createStringLiteral( expected )
            ]
        )
    );
}

export function createObjectCheck( props: any[], requiredUtils: Set<string>, expected: string = 'object' ): ts.Expression 
{
    requiredUtils.add( 'validators' );
    
    const propDefinitions = props.map( ( p, i ) => 
        ts.factory.createArrayLiteralExpression( [
            ts.factory.createStringLiteral( p.name ),
            p.isOptional ? ts.factory.createTrue() : ts.factory.createFalse(),
            p.validator
        ] )
    );

    const allowedKeys = props.map( p => ts.factory.createStringLiteral( p.name ) );

    const tpl = `
    (v, path, ctx) => {
        if (!validators.object(v, path, ctx, __KEYS__, __EXPECTED__)) return v;
        let data = v;
        if (ctx.mode === 'strip') {
            let hasAdditional = false;
            const keys = Object.keys(v);
            const allowed = __KEYS__;
            if (keys.length > allowed.length) {
                hasAdditional = true;
            } else {
                for (let i = 0; i < keys.length; i++) {
                    if (!allowed.includes(keys[i])) {
                        hasAdditional = true;
                        break;
                    }
                }
            }
            if (hasAdditional) data = {};
        }
        validators.props(v, data, path, ctx, __PROPS__);
        return data;
    }
    `;
    
    return injectNodes( templateToAst( tpl ), {
        '__KEYS__'     : ts.factory.createArrayLiteralExpression( allowedKeys ),
        '__EXPECTED__' : ts.factory.createStringLiteral( expected ),
        '__PROPS__'    : ts.factory.createArrayLiteralExpression( propDefinitions, true )
    } );
}

export function createRecordCheck( valueValidator: ts.Expression, requiredUtils: Set<string> ): ts.Expression 
{
    requiredUtils.add( 'validators' );
    const tpl = '(v, path, ctx) => validators.record(v, path, ctx, __CHILD__)';

    return injectNodes( templateToAst( tpl ), { '__CHILD__' : valueValidator } );
}

export function createTupleCheck( checks: ts.Expression[], requiredUtils: Set<string> ): ts.Expression 
{
    requiredUtils.add( 'validators' );
    const arrayElements = checks.map( ( _, i ) => `__CHECK_${i}__` ).join( ', ' );
    const tpl = `(v, path, ctx) => validators.tuple(v, path, ctx, [${arrayElements}])`;
    const replacements: Record<string, ts.Expression> = {};
    checks.forEach( ( c, i ) => replacements[`__CHECK_${i}__`] = c );

    return injectNodes( templateToAst( tpl ), replacements );
}

export function createDateCheck( requiredUtils: Set<string> ): ts.Expression 
{
    requiredUtils.add( 'validators' );

    return ts.factory.createPropertyAccessExpression( ts.factory.createIdentifier( 'validators' ), ts.factory.createIdentifier( 'date' ) );
}

export function createRegExpCheck( requiredUtils: Set<string> ): ts.Expression 
{
    requiredUtils.add( 'validators' );

    return ts.factory.createPropertyAccessExpression( ts.factory.createIdentifier( 'validators' ), ts.factory.createIdentifier( 'regexp' ) );
}

export function createNullCheck( requiredUtils: Set<string> ): ts.Expression 
{
    requiredUtils.add( 'validators' );

    return ts.factory.createPropertyAccessExpression( ts.factory.createIdentifier( 'validators' ), ts.factory.createIdentifier( 'null' ) );
}

export function createUndefinedCheck( requiredUtils: Set<string> ): ts.Expression 
{
    requiredUtils.add( 'validators' );

    return ts.factory.createPropertyAccessExpression( ts.factory.createIdentifier( 'validators' ), ts.factory.createIdentifier( 'undefined' ) );
}

export function createIntersectionCheck( checks: ts.Expression[], requiredUtils: Set<string> ): ts.Expression 
{
    const tpl = `
    (v, path, ctx) => {
        const checks = __CHECKS__;
        let data = ctx.mode === "strip" ? (typeof v === "object" && v !== null && !Array.isArray(v) ? {} : v) : v;
        for (let i = 0; i < checks.length; i++) {
            const val = checks[i](v, path, ctx);
            if (ctx.mode === "strip" && typeof val === "object" && val !== null) Object.assign(data, val);
        }
        return data;
    }
    `;

    return injectNodes( templateToAst( tpl ), {
        '__CHECKS__' : ts.factory.createArrayLiteralExpression( checks )
    } );
}

export function createSetCheck( elementValidator: ts.Expression, requiredUtils: Set<string> ): ts.Expression 
{
    requiredUtils.add( 'validators' );
    const tpl = '(v, path, ctx) => validators.set(v, path, ctx, __CHILD__)';

    return injectNodes( templateToAst( tpl ), { '__CHILD__' : elementValidator } );
}

export function createMapCheck( keyValidator: ts.Expression, valueValidator: ts.Expression, requiredUtils: Set<string> ): ts.Expression 
{
    requiredUtils.add( 'validators' );
    const tpl = '(v, path, ctx) => validators.map(v, path, ctx, __KEY__, __VALUE__)';

    return injectNodes( templateToAst( tpl ), { '__KEY__' : keyValidator, '__VALUE__' : valueValidator } );
}
