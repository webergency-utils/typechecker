import fs from 'fs';
import path from 'path';

const filesToUpdate =
[
    { file : 'dist/transformer.js', relativePath : './ts.js' },
    { file : 'dist/transformer.d.ts', relativePath : './ts.js' },
    { file : 'dist/engine/resolver.js', relativePath : '../ts.js' },
    { file : 'dist/engine/resolver.d.ts', relativePath : '../ts.js' },
    { file : 'dist/engine/hoister.js', relativePath : '../ts.js' },
    { file : 'dist/engine/hoister.d.ts', relativePath : '../ts.js' },
    { file : 'dist/engine/generators.js', relativePath : '../ts.js' },
    { file : 'dist/engine/generators.d.ts', relativePath : '../ts.js' },
    { file : 'dist/engine/customFns.js', relativePath : '../ts.js' },
    { file : 'dist/engine/customFns.d.ts', relativePath : '../ts.js' }
];

for( const { file, relativePath } of filesToUpdate )
{
    const filePath = path.resolve( file );

    if( fs.existsSync( filePath ))
    {
        let content = fs.readFileSync( filePath, 'utf8' );

        content = content.replace(
            /import\s+(?:(?:\*\s+as\s+)?(\w+))\s+from\s+['"]typescript['"];?/g,
            ( match, name ) => `import ${name} from '${relativePath}';`
        );

        fs.writeFileSync( filePath, content, 'utf8' );
    }
}

console.log( '✅ Imports updated in dist files' );
