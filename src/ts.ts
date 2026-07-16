import * as tsModule from 'typescript';
import type * as ts6Types from '@typescript/typescript6';
import { createRequire } from 'node:module';

let tsInstance: any = tsModule;

if( !tsInstance.createProgram )
{
    try
    {
        const require = createRequire( import.meta.url );
        const ts6 = require( '@typescript/typescript6' );
        tsInstance = ts6.default || ts6;
    }
    catch( e )
    {
        // Ignore
    }
}

const ts: typeof ts6Types = tsInstance;

export default ts;
