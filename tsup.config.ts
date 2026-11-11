import { defineConfig } from 'tsup';
import * as fs from 'fs';
import * as path from 'path';

const RUNTIME_MODULES = new Set([
    'validators',
    'schema-compiler',
    'parse-runtime',
    'serializer-runtime',
    'clone-runtime',
    'random-runtime',
    'transform',
    'casing',
    'path',
    'regex'
]);

const ROOT_MODULES = new Set([
    'transformer',
    'unplugin'
]);

export default defineConfig({
    entry : [
        'src/index.ts',
        'src/plugin.ts',
        'src/transformer.ts',
        'src/unplugin.ts',
        'src/rollup.ts',
        'src/esbuild.ts',
        'src/webpack.ts',
        'src/webpack-loader.ts',
        'src/runtime/index.ts',
        'src/runtime/validators.ts',
        'src/runtime/schema-compiler.ts',
        'src/runtime/parse-runtime.ts',
        'src/runtime/serializer-runtime.ts',
        'src/runtime/clone-runtime.ts',
        'src/runtime/random-runtime.ts',
        'src/runtime/transform.ts',
        'src/runtime/casing.ts',
        'src/runtime/path.ts',
        'src/runtime/regex.ts'
    ],
    format    : [ 'cjs', 'esm' ],
    dts       : true,
    minify    : false,
    sourcemap : false,
    clean     : true,
    shims     : true,
    splitting : false,
    esbuildPlugins : [
        {
            name : 'dedupe-runtime-entrypoints',
            setup( build )
            {
                const ext = build.initialOptions.define?.TSUP_FORMAT === '"cjs"' ? '.cjs' : '.js';

                build.onResolve({ filter : /^\.\.?\/(?:runtime\/)?[a-z-]+\.js$/ }, args =>
                {
                    if( !args.importer ){ return null }

                    const base = path.basename( args.path, '.js' );
                    const normImporter = args.importer.replace( /\\/g, '/' );
                    const inRuntimeEntry = normImporter.includes( '/src/runtime/' );

                    if( ROOT_MODULES.has( base ) && !inRuntimeEntry )
                    {
                        return { path : `./${base}${ext}`, external : true };
                    }

                    if( !RUNTIME_MODULES.has( base )){ return null }

                    const targetPath = inRuntimeEntry
                        ? `./${base}${ext}`
                        : `./runtime/${base}${ext}`;

                    return { path : targetPath, external : true };
                });
            }
        }
    ],
    async onSuccess()
    {
        const patch = '\nif (typeof module !== "undefined" && module.exports && typeof module.exports.default === "function") { module.exports = Object.assign(module.exports.default, module.exports); }\n';

        for( const relPath of [
            'dist/plugin.cjs',
            'dist/unplugin.cjs',
            'dist/rollup.cjs',
            'dist/esbuild.cjs',
            'dist/webpack.cjs',
            'dist/webpack-loader.cjs'
        ])
        {
            const cjsFile = path.resolve( relPath );

            if( fs.existsSync( cjsFile ))
            {
                const content = fs.readFileSync( cjsFile, 'utf8' );

                if( !content.includes( 'Object.assign(module.exports.default' ))
                {
                    fs.writeFileSync( cjsFile, content + patch, 'utf8' );
                }
            }
        }
    }
});
