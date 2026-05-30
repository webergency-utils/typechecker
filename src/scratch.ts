function test() 
{
    const mergedStatements =
    [
        ...utilityStatements,
        ...variablePrepends,
        ...sourceFile.statements
    ];
}
