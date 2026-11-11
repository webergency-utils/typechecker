import type { BundlerTransformerController } from './unplugin.js';

export interface WebpackLoaderOptions
{
    controller? : BundlerTransformerController
}

export default function typecheckerWebpackLoader(
    this           : any,
    source         : string,
    inputSourceMap?: any
): string | void
{
    const callback = typeof this?.async === 'function' ? this.async() : undefined;
    const opts: WebpackLoaderOptions | undefined = typeof this?.getOptions === 'function'
        ? this.getOptions()
        : this?.query;
    const controller = opts?.controller;
    const resourcePath: string = this?.resourcePath || '';

    if( !controller )
    {
        if( callback )
        {
            callback( null, source, inputSourceMap );

            return;
        }

        return source;
    }

    try
    {
        const result = controller.transform( source, resourcePath );

        if( result && typeof this?.addDependency === 'function' && typeof controller.getWatchFiles === 'function' )
        {
            for( const dep of controller.getWatchFiles())
            {
                this.addDependency( dep );
            }
        }

        const outCode = result ? result.code : source;
        const outMap = result && result.map ? result.map : inputSourceMap;

        if( callback )
        {
            callback( null, outCode, outMap );

            return;
        }

        return outCode;
    }
    catch( err )
    {
        if( callback )
        {
            callback( err );

            return;
        }

        throw err;
    }
}
