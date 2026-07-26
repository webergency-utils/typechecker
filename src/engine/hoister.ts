import ts from 'typescript';

export function hoistRegistrations( sourceFile: ts.SourceFile, cache: Map<string, ts.Expression>, requiredUtils: Set<string>, schemasMap?: Map<string, ts.Expression> ) 
{
    const hasSchemas = !!( schemasMap && schemasMap.size > 0 );

    if( cache.size === 0 && requiredUtils.size === 0 && !hasSchemas ) { return sourceFile }

    const declaredNames = collectDeclaredNames( sourceFile.statements );
    const utilityStatements: ts.Statement[] = [
        // 1. import "@webergency-utils/typechecker/runtime";
        ts.factory.createImportDeclaration(
            undefined,
            undefined,
            ts.factory.createStringLiteral( '@webergency-utils/typechecker/runtime' ),
            undefined
        )
    ];
    const utilityNames = new Set<string>();

    if( !declaredNames.has( 'validators' ) && !utilityNames.has( 'validators' )) 
    {
        utilityNames.add( 'validators' );
        utilityStatements.push(
            ts.factory.createVariableStatement(
                undefined,
                ts.factory.createVariableDeclarationList([
                    ts.factory.createVariableDeclaration(
                        ts.factory.createIdentifier( 'validators' ),
                        undefined,
                        undefined,
                        ts.factory.createPropertyAccessExpression(
                            ts.factory.createIdentifier( 'globalThis' ),
                            '__WEBERGENCY_TYPECHECKER_VALIDATORS__'
                        )
                    )
                ], ts.NodeFlags.Const )
            )
        );
    }

    if( !declaredNames.has( 'MetadataStore' ) && !utilityNames.has( 'MetadataStore' )) 
    {
        utilityNames.add( 'MetadataStore' );
        utilityStatements.push(
            ts.factory.createVariableStatement(
                undefined,
                ts.factory.createVariableDeclarationList([
                    ts.factory.createVariableDeclaration(
                        ts.factory.createIdentifier( 'MetadataStore' ),
                        undefined,
                        undefined,
                        ts.factory.createPropertyAccessExpression(
                            ts.factory.createIdentifier( 'globalThis' ),
                            '__WEBERGENCY_TYPECHECKER_METADATA_STORE__'
                        )
                    )
                ], ts.NodeFlags.Const )
            )
        );
    }

    const variablePrepends: ts.Statement[] = [];
    const registrationAppends: ts.Statement[] = [];
    const prependedNames = new Set<string>( utilityNames );

    for( const [hash, expr] of cache.entries()) 
    {
        const valName = `__val_${hash}`;

        // const __val_hash = expr;
        if( !declaredNames.has( valName ) && !prependedNames.has( valName )) 
        {
            prependedNames.add( valName );
            variablePrepends.push(
                ts.factory.createVariableStatement(
                    undefined,
                    ts.factory.createVariableDeclarationList([
                        ts.factory.createVariableDeclaration(
                            ts.factory.createIdentifier( valName ),
                            undefined,
                            undefined,
                            expr
                        )
                    ], ts.NodeFlags.Const )
                )
            );
        }

        // MetadataStore.registerValidator(hash, __val_hash);
        registrationAppends.push(
            ts.factory.createExpressionStatement(
                ts.factory.createCallExpression(
                    ts.factory.createPropertyAccessExpression( ts.factory.createIdentifier( 'MetadataStore' ), 'registerValidator' ),
                    undefined,
                    [
                        ts.factory.createStringLiteral( hash ),
                        ts.factory.createIdentifier( valName )
                    ]
                )
            )
        );
    }

    if( schemasMap ) 
    {
        for( const [hash, schemaExpr] of schemasMap.entries()) 
        {
            registrationAppends.push(
                ts.factory.createExpressionStatement(
                    ts.factory.createCallExpression(
                        ts.factory.createPropertyAccessExpression( ts.factory.createIdentifier( 'MetadataStore' ), 'registerSchema' ),
                        undefined,
                        [
                            ts.factory.createStringLiteral( hash ),
                            schemaExpr
                        ]
                    )
                )
            );
        }
    }

    const mergedStatements =
        [
            ...utilityStatements,
            ...variablePrepends,
            ...sourceFile.statements
        ];

    const insertIndex = findInsertionIndex( mergedStatements );

    return ts.factory.updateSourceFile( sourceFile,
        [
            ...mergedStatements.slice( 0, insertIndex ),
            ...registrationAppends,
            ...mergedStatements.slice( insertIndex )
        ]);
}


function findInsertionIndex( statements: readonly ts.Statement[]): number 
{
    let lastClassIndex = -1;

    for( let i = 0; i < statements.length; i++ ) 
    {
        if( ts.isClassDeclaration( statements[i])) 
        {
            lastClassIndex = i;
        }
    }

    const startIndex = lastClassIndex !== -1 ? lastClassIndex + 1 : 0;

    for( let i = startIndex; i < statements.length; i++ ) 
    {
        const s = statements[i];

        if( ts.isImportDeclaration( s ) || ts.isInterfaceDeclaration( s ) || ts.isTypeAliasDeclaration( s )) 
        {
            continue;
        }

        if( ts.isVariableStatement( s )) 
        {
            let isPrependedVar = true;

            for( const decl of s.declarationList.declarations ) 
            {
                if( ts.isIdentifier( decl.name )) 
                {
                    const text = decl.name.text;

                    if( text !== 'validators' && text !== 'MetadataStore' && text !== '__server_metadata_store' && !text.startsWith( '__val_' )) 
                    {
                        isPrependedVar = false;
                        break;
                    }
                }
                else 
                {
                    isPrependedVar = false;
                    break;
                }
            }

            if( isPrependedVar ) 
            {
                continue;
            }
        }

        return i;
    }

    return statements.length;
}


function collectDeclaredNames( statements: readonly ts.Statement[]): Set<string>
{
    const names = new Set<string>();

    for( const statement of statements ) 
    {
        if( !ts.isVariableStatement( statement )){ continue }

        for( const decl of statement.declarationList.declarations ) 
        {
            if( ts.isIdentifier( decl.name )) 
            {
                names.add( decl.name.text );
            }
        }
    }

    return names;
}
