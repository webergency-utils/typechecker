import { defineConfig } from 'tsup';
import * as path from 'path';

const RUNTIME_MODULES = new Set([
    'validators',
    'schema-compiler',
    'parse-runtime',
    'serializer-runtime',
    'transform',
    'casing',
    'path',
    'regex'
]);

const ROOT_MODULES = new Set([
    'transformer'
]);

export default defineConfig({
    entry : [
        'src/index.ts',
        'src/plugin.ts',
        'src/transformer.ts',
        'src/unplugin.ts',
        'src/runtime/index.ts',
        'src/runtime/validators.ts',
        'src/runtime/schema-compiler.ts',
        'src/runtime/parse-runtime.ts',
        'src/runtime/serializer-runtime.ts',
        'src/runtime/transform.ts',
        'src/runtime/casing.ts',
        'src/runtime/path.ts',
        'src/runtime/regex.ts'
    ],
    format    : [ 'cjs', 'esm' ],
    dts       : true,
    sourcemap : false,
    clean     : true,
    shims     : true,
    splitting : false,
    esbuildOptions( options )
    {
        options.minifyWhitespace = true;
        options.minifySyntax = true;
    },
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
    ]
});
