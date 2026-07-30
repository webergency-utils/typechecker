import ts from 'typescript';
import { ValidationMode } from '../runtime/validators.js';

export type SerializationMode = ValidationMode;

export interface SerializerGeneratorOptions
{
    mode? : ValidationMode
}


function getPropertyType( parentType: ts.Type, prop: ts.Symbol, checker: ts.TypeChecker ): ts.Type
{
    const fromSymbol = ( checker as ts.TypeChecker & { getTypeOfSymbol?: ( s: ts.Symbol ) => ts.Type }).getTypeOfSymbol?.( prop );

    if( fromSymbol && typeof fromSymbol.getFlags === 'function' && !( fromSymbol.flags & ts.TypeFlags.Any )){ return fromSymbol }

    const declaration = prop.valueDeclaration || prop.declarations?.[0];

    if( declaration && typeof checker.getTypeOfSymbolAtLocation === 'function' )
    {
        const fromDecl = checker.getTypeOfSymbolAtLocation( prop, declaration );

        if( fromDecl && typeof fromDecl.getFlags === 'function' && !( fromDecl.flags & ts.TypeFlags.Any )){ return fromDecl }
    }

    if( ( prop as any ).type && typeof ( prop as any ).type.getFlags === 'function' )
    {
        return ( prop as any ).type;
    }

    return { getFlags : () => ts.TypeFlags.Any } as any;
}

function safePropAccess( varName: string, propName: string ): string
{
    if( /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test( propName ))
    {
        return `${varName}.${propName}`;
    }

    return `${varName}[${JSON.stringify( propName )}]`;
}

/**
 * Builds an inline JS expression `( v, path ) => string` that serializes value `v` according to `type`.
 */
export function generateSerializerCode(
    type        : ts.Type,
    checker     : ts.TypeChecker,
    options     : SerializerGeneratorOptions = {}
): string
{
    const mode = options.mode || 'strip';

    function buildSerializer( t: ts.Type, path: string, varName: string ): string
    {
        const flags = typeof t.getFlags === 'function' ? t.getFlags() : ts.TypeFlags.Any;
        const pathLiteral = JSON.stringify( path );

        // Handle Primitives
        if( flags & ts.TypeFlags.String )
        {
            return `__tcRuntime.serializeString( ${varName} )`;
        }

        if( flags & ts.TypeFlags.Number )
        {
            return `( typeof ${varName} === 'number' && !isNaN( ${varName} ) ? String( ${varName} ) : ( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, "Expected number" ); })() )`;
        }

        if( flags & ts.TypeFlags.Boolean )
        {
            return `( typeof ${varName} === 'boolean' ? ( ${varName} ? 'true' : 'false' ) : ( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, "Expected boolean" ); })() )`;
        }

        if( flags & ts.TypeFlags.BigInt )
        {
            return `( typeof ${varName} === 'bigint' ? String( ${varName} ) : ( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, "Expected bigint" ); })() )`;
        }

        if( flags & ts.TypeFlags.Null || flags & ts.TypeFlags.Undefined )
        {
            return `'null'`;
        }

        if( flags & ts.TypeFlags.StringLiteral )
        {
            const val = ( t as ts.StringLiteralType ).value;

            return JSON.stringify( JSON.stringify( val ));
        }

        if( flags & ts.TypeFlags.NumberLiteral )
        {
            const val = ( t as ts.NumberLiteralType ).value;

            return JSON.stringify( String( val ));
        }

        if( flags & ts.TypeFlags.BooleanLiteral )
        {
            const val = ( t as any ).intrinsicName === 'true';

            return JSON.stringify( String( val ));
        }

        // Date check
        const symbol = typeof t.getSymbol === 'function' ? t.getSymbol() : ( t as any ).aliasSymbol;

        if( symbol && typeof symbol.getName === 'function' && symbol.getName() === 'Date' )
        {
            return `__tcRuntime.serializeDate( ${varName} )`;
        }

        // Array handling
        if( typeof checker.isArrayType === 'function' && checker.isArrayType( t ))
        {
            const typeArgs = typeof checker.getTypeArguments === 'function' ? checker.getTypeArguments( t as ts.TypeReference ) : [];
            const elemType = typeArgs[0] || ( { getFlags : () => ts.TypeFlags.Any } as any );
            const elemSer = buildSerializer( elemType, path ? `${path}[i]` : '[i]', 'elem' );

            return `__tcRuntime.serializeArray( ${varName}, function( elem, i ){ return ${elemSer}; } )`;
        }

        // Union handling
        if( typeof t.isUnion === 'function' && t.isUnion())
        {
            return buildUnionSerializer( t, path, varName );
        }

        // Object / Interface handling
        if( ( flags & ts.TypeFlags.Object ) || ( flags & ts.TypeFlags.NonPrimitive ) || typeof t.getProperties === 'function' )
        {
            return buildObjectSerializer( t, path, varName );
        }

        // Fallback for any / unknown / unhandled
        return `JSON.stringify( ${varName} )`;
    }

    function buildUnionSerializer( unionType: ts.UnionType, path: string, varName: string ): string
    {
        const types = unionType.types;
        const pathLiteral = JSON.stringify( path );

        // Check for Nullable / Optional (e.g. T | null | undefined)
        const nonNull = types.filter( t => !( typeof t.getFlags === 'function' && ( t.getFlags() & ( ts.TypeFlags.Null | ts.TypeFlags.Undefined ))));
        const hasNull = types.some( t => typeof t.getFlags === 'function' && ( t.getFlags() & ts.TypeFlags.Null ) !== 0 );
        const hasUndefined = types.some( t => typeof t.getFlags === 'function' && ( t.getFlags() & ts.TypeFlags.Undefined ) !== 0 );

        if( nonNull.length === 1 && ( hasNull || hasUndefined ))
        {
            const innerSer = buildSerializer( nonNull[0], path, varName );

            return `( ${varName} === null || ${varName} === undefined ? 'null' : ${innerSer} )`;
        }

        // Discriminated Union Detection
        let discriminantKey: string | undefined;

        if( nonNull.every( t => typeof t.getFlags === 'function' && ( t.getFlags() & ts.TypeFlags.Object ) !== 0 ))
        {
            const firstProps = typeof nonNull[0].getProperties === 'function' ? nonNull[0].getProperties() : [];

            for( const prop of firstProps )
            {
                const propName = prop.getName();
                const isDiscrim = nonNull.every( t => 
                {
                    if( typeof checker.getPropertyOfType !== 'function' ){ return false }
                    const p = checker.getPropertyOfType( t, propName );

                    if( !p ){ return false }
                    const pType = getPropertyType( t, p, checker );

                    return typeof pType.getFlags === 'function' && ( pType.getFlags() & ( ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral | ts.TypeFlags.BooleanLiteral )) !== 0;
                });

                if( isDiscrim )
                {
                    discriminantKey = propName;
                    break;
                }
            }
        }

        if( discriminantKey )
        {
            const discrimAccess = safePropAccess( 'val', discriminantKey );
            let code = `( function( val ){ switch( val && ${discrimAccess} ){ `;

            for( const branchType of nonNull )
            {
                const p = checker.getPropertyOfType( branchType, discriminantKey )!;
                const pType = getPropertyType( branchType, p, checker );
                const literalVal = ( pType as any ).value !== undefined ? ( pType as any ).value : ( pType as any ).intrinsicName;
                const caseKey = typeof literalVal === 'string' ? JSON.stringify( literalVal ) : literalVal;
                const branchSer = buildSerializer( branchType, path, 'val' );

                code += `case ${caseKey}: return ${branchSer}; `;
            }

            code += `default: throw new __tcRuntime.SerializationError( ${pathLiteral}, "Invalid discriminant value for ${discriminantKey}" ); } })( ${varName} )`;

            return code;
        }

        // General Untagged Union
        let code = `( function( val ){ `;

        for( let i = 0; i < types.length; i++ )
        {
            const branch = types[i];
            const branchFlags = typeof branch.getFlags === 'function' ? branch.getFlags() : 0;
            const branchSer = buildSerializer( branch, path, 'val' );

            if( branchFlags & ts.TypeFlags.String )
            {
                code += `if( typeof val === 'string' ){ return ${branchSer}; } `;
            }
            else if( branchFlags & ts.TypeFlags.Number )
            {
                code += `if( typeof val === 'number' ){ return ${branchSer}; } `;
            }
            else if( branchFlags & ts.TypeFlags.Boolean )
            {
                code += `if( typeof val === 'boolean' ){ return ${branchSer}; } `;
            }
            else if( typeof checker.isArrayType === 'function' && checker.isArrayType( branch ))
            {
                code += `if( Array.isArray( val )){ return ${branchSer}; } `;
            }
            else if( branchFlags & ts.TypeFlags.Object )
            {
                code += `if( typeof val === 'object' && val !== null ){ return ${branchSer}; } `;
            }
        }

        code += `return JSON.stringify( val ); })( ${varName} )`;

        return code;
    }

    function buildObjectSerializer( objType: ts.Type, path: string, varName: string ): string
    {
        const props = typeof objType.getProperties === 'function' ? objType.getProperties() : [];
        const knownKeys = props.map( p => p.getName());
        const pathLiteral = JSON.stringify( path );

        let code = `( function( obj ){ `;
        code += `if( typeof obj !== 'object' || obj === null ){ throw new __tcRuntime.SerializationError( ${pathLiteral}, "Expected object" ); } `;

        // Check for extra properties in strict mode
        if( mode === 'strict' )
        {
            code += `for( const k in obj ){ `;
            code += `if( ${JSON.stringify( knownKeys )}.indexOf( k ) === -1 ){ `;
            code += `throw new __tcRuntime.SerializationError( ${path ? JSON.stringify( path + '.' ) : '""'} + k, "Unexpected extra property in strict mode: " + k ); `;
            code += `} } `;
        }

        code += `let parts = []; `;

        for( const prop of props )
        {
            const propName = prop.getName();
            const propPath = path ? `${path}.${propName}` : propName;
            const propPathLiteral = JSON.stringify( propPath );
            const propAccess = safePropAccess( 'obj', propName );
            const isOptional = ( prop.flags & ts.SymbolFlags.Optional ) !== 0;
            const propType = getPropertyType( objType, prop, checker );

            const keyHeader = JSON.stringify( `"${propName}":` );
            const propSer = buildSerializer( propType, propPath, propAccess );

            if( isOptional )
            {
                code += `if( ${propAccess} !== undefined ){ `;
                code += `parts.push( ${keyHeader} + ${propSer} ); `;
                code += `} `;
            }
            else
            {
                code += `if( ${propAccess} === undefined ){ throw new __tcRuntime.SerializationError( ${propPathLiteral}, "Missing required property ${propName}" ); } `;
                code += `parts.push( ${keyHeader} + ${propSer} ); `;
            }
        }

        if( mode === 'relaxed' )
        {
            code += `for( const k in obj ){ `;
            code += `if( ${JSON.stringify( knownKeys )}.indexOf( k ) === -1 && obj[k] !== undefined ){ `;
            code += `parts.push( JSON.stringify( k ) + ':' + JSON.stringify( obj[k] ) ); `;
            code += `} } `;
        }

        code += `return '{' + parts.join( ',' ) + '}'; `;
        code += `})( ${varName} )`;

        return code;
    }

    return buildSerializer( type, '', 'input' );
}
