import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import transformer from '../transformer.js';

describe( 'Transformer Call Expression Replacements', () => 
{
    function compileAndTransform( sourceCode: string ): string 
    {
        const tempFile = path.resolve( './temp_test_file.ts' );
        fs.writeFileSync( tempFile, sourceCode );

        try 
        {
            const program = ts.createProgram([tempFile], {
                target           : ts.ScriptTarget.ES2022,
                module           : ts.ModuleKind.NodeNext,
                moduleResolution : ts.ModuleResolutionKind.NodeNext,
                skipLibCheck     : true
            });

            const sourceFile = program.getSourceFile( tempFile );

            if( !sourceFile ) { throw new Error( 'Could not load source file' ) }

            const result = ts.transform( sourceFile, [transformer( program )]);
            const printer = ts.createPrinter();

            return printer.printFile( result.transformed[0]);
        }
        finally 
        {
            if( fs.existsSync( tempFile )) 
            {
                fs.unlinkSync( tempFile );
            }
        }
    }

    it( 'should transform validate with a string ValidationMode', () => 
    {
        const code = `
            import { validate } from '../index.js';
            const x: any = 123;
            const res = validate<number>(x, 'relaxed');
        `;
        const compiled = compileAndTransform( code );
        expect( compiled ).toContain( '__tcRuntime.validate(' );
        expect( compiled ).toContain( "'relaxed'" );
    });

    it( 'should transform validate with options object', () => 
    {
        const code = `
            import { validate } from '../index.js';
            const x: any = 123;
            const res = validate<number>(x, { mode: 'relaxed', from: 'query', mutate: true });
        `;
        const compiled = compileAndTransform( code );
        expect( compiled ).toContain( '__tcRuntime.validate(' );
        expect( compiled ).toContain( "mode: 'relaxed'" );
        expect( compiled ).toContain( "from: 'query'" );
        expect( compiled ).toContain( 'mutate: true' );
    });

    it( 'should transform aliased typed helpers and leave schema helpers alone', () =>
    {
        const code = `
            import { validate as check, validateSchema as checkSchema } from '../index.js';
            const value = check<number>(123);
            const schemaValue = checkSchema({ type: 'number' }, 123);
        `;
        const compiled = compileAndTransform( code );

        expect( compiled ).toContain( '__tcRuntime.validate(' );
        expect( compiled ).toContain( '__val_' );
        expect( compiled ).toContain( 'checkSchema(' );
        expect( compiled ).not.toContain( 'check<number>' );
        expect( compiled ).not.toContain( 'getOrCompileSchema(' );
        expect( compiled ).not.toContain( 'MetadataStore' );
    });

    it( 'should transform namespace typed helpers and leave schema helpers alone', () =>
    {
        const code = `
            import * as typechecker from '../index.js';
            const value = typechecker.validate<number>(123);
            const schemaValue = typechecker.validateSchema({ type: 'number' }, 123);
        `;
        const compiled = compileAndTransform( code );

        expect( compiled ).toContain( '__tcRuntime.validate(' );
        expect( compiled ).toContain( '__val_' );
        expect( compiled ).toContain( 'typechecker.validateSchema(' );
        expect( compiled ).not.toContain( 'typechecker.validate<number>' );
        expect( compiled ).not.toContain( 'getOrCompileSchema(' );
        expect( compiled ).not.toContain( 'MetadataStore' );
    });

    it( 'should not transform helpers imported from unrelated modules', () =>
    {
        const code = `
            import { validate } from 'unrelated-validator';
            import * as other from 'other-library';
            const direct = validate<number>(123);
            const namespaced = other.validate<number>(123);
        `;
        const compiled = compileAndTransform( code );

        expect( compiled ).toContain( 'validate<number>(123)' );
        expect( compiled ).toContain( 'other.validate<number>(123)' );
        expect( compiled ).not.toContain( 'MetadataStore' );
    });

    it( 'should transform types with constraint and format namespace constraints and custom validations', () => 
    {
        const code = `
            import { validate, constraint, format } from './src/index.js';
            function startsWithWeb(val: string) { return val.startsWith("web_"); }
            interface ApiKey {
                key: string & constraint.Custom<typeof startsWithWeb>;
                age: number & constraint.Range<18, 99>;
                name: string & constraint.Length<3, 10>;
                email: string & format.Email;
                id: string & format.ObjectId;
            }
            const res = validate<ApiKey>({ key: "web_abc", age: 20, name: "Tom", email: "tom@web.com", id: "507f1f77bcf86cd799439011" });
        `;
        const compiled = compileAndTransform( code );
        expect( compiled ).toContain( 'validators.custom' );
        expect( compiled ).toContain( 'startsWithWeb' );
        expect( compiled ).toContain( 'validators.minimum' );
        expect( compiled ).toContain( 'validators.maximum' );
        expect( compiled ).toContain( 'validators.minLength' );
        expect( compiled ).toContain( 'validators.maxLength' );
        expect( compiled ).toContain( 'validators.format' );
    });

    it( 'should transform types with tag.Default initializers', () => 
    {
        const code = `
            import { validate, tag } from './src/index.js';
            interface Config {
                port?: number & tag.Default<8080>;
                host?: string & tag.Default<"localhost">;
            }
            const res = validate<Config>({});
        `;
        const compiled = compileAndTransform( code );
        expect( compiled ).toContain( 'v = 8080;' );
        expect( compiled ).toContain( 'v = "localhost";' );
    });

    it( 'should transform types with tag.Default boolean initializers', () => 
    {
        const code = `
            import { validate, tag } from './src/index.js';
            interface Config {
                isCool?: boolean & tag.Default<false>;
                isFast?: boolean & tag.Default<true>;
            }
            const res = validate<Config>({});
        `;
        const compiled = compileAndTransform( code );
        expect( compiled ).toContain( 'v = false;' );
        expect( compiled ).toContain( 'v = true;' );
    });

    it( 'should transform ToNumber and ToBoolean via shared query coerce helpers', () => 
    {
        const code = `
            import { validate, transform } from './src/index.js';
            interface Row {
                n: number & transform.ToNumber;
                b: boolean & transform.ToBoolean;
            }
            const res = validate<Row>({ n: "42", b: "true" });
        `;
        const compiled = compileAndTransform( code );
        expect( compiled ).toContain( 'v = validators.coerceQueryNumber(v);' );
        expect( compiled ).toContain( 'v = validators.coerceQueryBoolean(v);' );
    });

    it( 'should transform types with transform namespace and custom mappers', () => 
    {
        const code = `
            import { validate, transform } from './src/index.js';
            function customSuffix(val: string) { return val + "_suffix"; }
            interface Member {
                username: string & transform.Trim & transform.LowerCase;
                joined: Date & transform.ToDate;
                code: string & transform.Custom<typeof customSuffix>;
            }
            const res = validate<Member>({ username: "  TOM  ", joined: "2026-05-17T19:55:00.000Z", code: "abc" });
        `;
        const compiled = compileAndTransform( code );
        expect( compiled ).toContain( 'v = v.trim();' );
        expect( compiled ).toContain( 'v = v.toLowerCase();' );
        expect( compiled ).toContain( 'v = validators.coerceQueryDate(v);' );
        expect( compiled ).toContain( 'v = customSuffix(v);' );
    });

    it( 'should transform jsonSchema calls and pre-compile static schemas', () => 
    {
        const code = `
            import { jsonSchema, constraint } from './src/index.js';
            interface Account {
                email: string;
                age: number & constraint.Range<18, 99>;
                verified: boolean;
            }
            const schema = jsonSchema<Account>();
        `;
        const compiled = compileAndTransform( code );
        expect( compiled ).toContain( 'const __schema_' );
        expect( compiled ).toContain( '__schema_' );
        expect( compiled ).not.toContain( '__val_' );
        expect( compiled ).not.toContain( 'MetadataStore' );
        expect( compiled ).toContain( '"type": "object"' );
        expect( compiled ).toContain( '"email"' );
        expect( compiled ).toContain( '"age"' );
        expect( compiled ).toContain( '"minimum": 18' );
        expect( compiled ).toContain( '"maximum": 99' );
        expect( compiled ).toContain( '"type": "boolean"' );
    });

    it( 'should hoist validators without schemas for validate helpers', () =>
    {
        const code = `
            import { validate } from '../index.js';
            interface Row { id: number; name: string }
            const res = validate<Row>({ id: 1, name: 'a' });
        `;
        const compiled = compileAndTransform( code );
        expect( compiled ).toContain( '__val_' );
        expect( compiled ).toContain( '__tcRuntime.validate(' );
        expect( compiled ).not.toContain( '__schema_' );
        expect( compiled ).not.toContain( 'MetadataStore' );
        expect( compiled ).not.toContain( 'registerValidator' );
        expect( compiled ).toContain( 'new Set(' );
    });

    it( 'should handle deeply nested, circular, and highly complex types in jsonSchema', () => 
    {
        const code = `
            import { jsonSchema, constraint, format } from './src/index.js';
            
            interface ComplexNode {
                id: string & format.ObjectId;
                name: string & constraint.Length<1, 100>;
                kind: "folder" | "file";
                tags: string[];
                meta: {
                    created: Date;
                    size?: number & constraint.Minimum<0>;
                    owner: {
                        email: string & format.Email;
                        active: boolean;
                    };
                };
                children?: ComplexNode[];
                tupleField: [number, string & format.UUID, boolean];
            }
            
            const schema = jsonSchema<ComplexNode>();
        `;
        const compiled = compileAndTransform( code );
        
        expect( compiled ).toContain( '"type": "object"' );
        expect( compiled ).toContain( '"id"' );
        expect( compiled ).toContain( '"format": "objectId"' );
        expect( compiled ).toContain( '"name"' );
        expect( compiled ).toContain( '"minLength": 1' );
        expect( compiled ).toContain( '"maxLength": 100' );
        expect( compiled ).toContain( '"anyOf"' );
        expect( compiled ).toContain( '"const": "folder"' );
        expect( compiled ).toContain( '"const": "file"' );
        expect( compiled ).toContain( '"tags"' );
        expect( compiled ).toContain( '"meta"' );
        expect( compiled ).toContain( '"x-typescript-type": "Date"' );
        expect( compiled ).toContain( '"minimum": 0' );
        expect( compiled ).toContain( '"email"' );
        expect( compiled ).toContain( '"format": "email"' );
        expect( compiled ).toContain( '"active"' );
        expect( compiled ).toContain( '"type": "boolean"' );
        expect( compiled ).toContain( '"children"' );
        expect( compiled ).toContain( '"$ref": "#/$defs/ComplexNode_' );
        expect( compiled ).toContain( '"tupleField"' );
        expect( compiled ).toContain( '"minItems": 3' );
        expect( compiled ).toContain( '"maxItems": 3' );
    });

    it( 'should leave schema entrypoints untransformed', () =>
    {
        const code = `
            import { validateSchema, isSchema, assertSchema, assertGuardSchema } from './src/index.js';
            const schema = {
                type: "object",
                properties: {
                    name: { type: "string" },
                    age: { type: "number", minimum: 18 }
                },
                required: ["name"]
            };
            const res = validateSchema(schema, { name: "Tom", age: 20 }, { mode: 'relaxed' });
            const ok = isSchema(schema, { name: "Tom" });
            const value = assertSchema(schema, { name: "Tom", age: 20 });
            assertGuardSchema(schema, { name: "Tom" });
        `;
        const compiled = compileAndTransform( code );
        expect( compiled ).toContain( 'validateSchema(schema,' );
        expect( compiled ).toContain( 'isSchema(schema,' );
        expect( compiled ).toContain( 'assertSchema(schema,' );
        expect( compiled ).toContain( 'assertGuardSchema(schema,' );
        expect( compiled ).not.toContain( 'getOrCompileSchema' );
        expect( compiled ).not.toContain( '__tcRuntime' );
        expect( compiled ).not.toContain( 'MetadataStore' );
    });

    it( 'should inline small repeating structures like Point while hoisting circular types', () => 
    {
        const code = `
            import { jsonSchema } from './src/index.js';
            interface Point {
                x: number;
                y: number;
            }
            interface SmallLine {
                start: Point;
                end: Point;
            }
            interface Node {
                val: number;
                next?: Node;
            }
            const schema1 = jsonSchema<SmallLine>();
            const schema2 = jsonSchema<Node>();
        `;
        const compiled = compileAndTransform( code );
        expect( compiled ).not.toContain( '"$ref": "#/$defs/Point_' );
        expect( compiled ).toContain( '"$ref": "#/$defs/Node_' );
    });

    it( 'should transform types with Set and Map', () => 
    {
        const code = `
            import { validate } from './src/index.js';
            interface Container {
                numbers: Set<number>;
                mapping: Map<string, boolean>;
            }
            const res = validate<Container>({
                numbers: new Set([1, 2, 3]),
                mapping: new Map([['a', true]])
            });
        `;
        const compiled = compileAndTransform( code );
        expect( compiled ).toContain( 'validators.set' );
        expect( compiled ).toContain( 'validators.map' );
    });

    it( 'should use distinct validators for Set and Map type arguments', () => 
    {
        const code = `
            import { validate } from './src/index.js';
            interface Dual {
                nums: Set<number>;
                strs: Set<string>;
                mapNum: Map<string, number>;
                mapStr: Map<string, string>;
            }
            const res = validate<Dual>({
                nums: new Set([1]),
                strs: new Set(['a']),
                mapNum: new Map([['a', 1]]),
                mapStr: new Map([['a', 'b']])
            });
        `;
        const compiled = compileAndTransform( code );
        expect( compiled ).toContain( 'validators.set' );
        // Distinct hashes prove Set<number> and Set<string> are not collapsed
        const setHashes = [...compiled.matchAll( /validators\.set\(v, path, ctx, (__val_[a-f0-9]+)\)/g )].map( m => m[1]);
        expect( new Set( setHashes ).size ).toBe( 2 );
        const mapHashes = [...compiled.matchAll( /validators\.map\(v, path, ctx, (__val_[a-f0-9]+), (__val_[a-f0-9]+)\)/g )]
            .map( m => `${m[1]}:${m[2]}` );
        expect( new Set( mapHashes ).size ).toBe( 2 );
    });

    it( 'should transform assertGuard to assertGuard', () => 
    {
        const code = `
            import { assertGuard } from '../index.js';
            const x: unknown = 123;
            assertGuard<number>(x);
        `;
        const compiled = compileAndTransform( code );
        expect( compiled ).toContain( '__tcRuntime.assertGuard(' );
    });

    it( 'should emit Date and Record json schemas matching runtime validators', () => 
    {
        const code = `
            import { jsonSchema } from './src/index.js';
            type Rec = Record<string, number>;
            const schemaDate = jsonSchema<Date>();
            const schemaRec = jsonSchema<Rec>();
        `;
        const compiled = compileAndTransform( code );
        expect( compiled ).toContain( '"x-typescript-type": "Date"' );
        expect( compiled ).toContain( '"additionalProperties"' );
        expect( compiled ).not.toMatch( /additionalProperties"\s*:\s*false[\s\S]*Record|Record[\s\S]*additionalProperties"\s*:\s*false/ );
    });

    it( 'should transform custom validation messages and pass message arguments to validator helpers', () => 
    {
        const code = `
            import { validate, constraint, Message } from './src/index.js';
            interface User {
                email: string & constraint.Format<'email'> & Message<"Please supply a valid email address">;
                age: number & constraint.Minimum<18> & constraint.Message<"You must be 18 or older">;
            }
            const res = validate<User>({ email: "invalid", age: 16 });
        `;
        const compiled = compileAndTransform( code );
        expect( compiled ).toContain( 'v = validators.format(v, path, ctx, "email", "Please supply a valid email address")' );
        expect( compiled ).toContain( 'validators.minimum(v, path, ctx, 18, "You must be 18 or older")' );
    });

    it( 'should prioritize specific messages over fallback message', () => 
    {
        const code = `
            import { validate, constraint, Message } from './src/index.js';
            interface User {
                age: number 
                    & constraint.Minimum<18, "Too young"> 
                    & constraint.Maximum<99, "Too old"> 
                    & Message<"Invalid age fallback">;
            }
            const res = validate<User>({ age: 16 });
        `;
        const compiled = compileAndTransform( code );
        expect( compiled ).toContain( 'validators.minimum(v, path, ctx, 18, "Too young")' );
        expect( compiled ).toContain( 'validators.maximum(v, path, ctx, 99, "Too old")' );
    });

    it( 'should transform function types', () => 
    {
        const code = `
            import { validate } from '../index.js';
            type Handler = ( x: number ) => string;
            const res = validate<Handler>(( n ) => String( n ));
        `;
        const compiled = compileAndTransform( code );
        expect( compiled ).toContain( 'validators.function' );
    });

    it( 'should emit allOf for object intersections and x-typescript-type for Set/bigint', () => 
    {
        const code = `
            import { jsonSchema } from './src/index.js';
            type A = { a: string };
            type B = { b: number };
            type Both = A & B;
            enum unused { X = 1 }
            const s1 = jsonSchema<Both>();
            const s2 = jsonSchema<Set<number>>();
            const s3 = jsonSchema<bigint>();
        `;
        const compiled = compileAndTransform( code );
        expect( compiled ).toContain( '"allOf"' );
        expect( compiled ).toContain( '"x-typescript-type": "Set"' );
        expect( compiled ).toContain( '"x-typescript-type": "bigint"' );
    });

    it( 'should validate named props together with string index signatures', () => 
    {
        const code = `
            import { validate } from './src/index.js';
            interface Row {
                id: number;
                [key: string]: number;
            }
            const res = validate<Row>({ id: 1, extra: 2 });
        `;
        const compiled = compileAndTransform( code );
        expect( compiled ).toContain( 'validators.props' );
        expect( compiled ).toContain( 'validators.additionalProps' );
        expect( compiled ).not.toContain( 'validators.record' );
    });

    it( 'should transform is and assert entrypoints', () => 
    {
        const code = `
            import { is, assert } from '../index.js';
            const ok = is<number>(1);
            const value = assert<string>('x');
        `;
        const compiled = compileAndTransform( code );
        expect( compiled ).toContain( '__tcRuntime.is(' );
        expect( compiled ).toContain( '__tcRuntime.assert(' );
    });

    it( 'should leave validateSchema options and calls untouched by the transformer', () =>
    {
        const code = `
            import { validateSchema } from '../index.js';
            const schema = { type: 'string' };
            const a = validateSchema({ type: 'string' }, 'x', { mode: 'strict' });
            const b = validateSchema(schema, 'x');
            const opts = { mode: 'strip' as const };
            const c = validateSchema(schema, 'x', opts);
        `;
        const compiled = compileAndTransform( code );
        expect( compiled ).toContain( 'validateSchema(' );
        expect( compiled ).not.toContain( 'getOrCompileSchema' );
        expect( compiled ).not.toContain( '__tcRuntime' );
        expect( compiled ).not.toContain( 'MetadataStore' );
    });

    it( 'should transform enums never symbol template literals and bigint literals', () => 
    {
        const code = `
            import { validate } from '../index.js';
            enum Color { Red = 'red', Blue = 'blue' }
            type Id = \`id_\${string}\`;
            type Flag = \`\${boolean}\`;
            type NumTpl = \`n_\${number}\`;
            type BigTpl = \`b_\${bigint}\`;
            type MixedTpl = \`m_\${string | number}\`;
            const e = validate<Color>(Color.Red);
            const n = validate<never>(null as never);
            const s = validate<symbol>(Symbol('x'));
            const t = validate<Id>('id_a');
            const f = validate<Flag>('true');
            const nt = validate<NumTpl>('n_1');
            const bt = validate<BigTpl>('b_1');
            const mt = validate<MixedTpl>('m_x');
            const bl = validate<1n>(1n);
            const p = validate<Promise<number>>(Promise.resolve(1));
        `;
        const compiled = compileAndTransform( code );
        expect( compiled ).toContain( 'validators.literal' );
        expect( compiled ).toContain( 'validators.never' );
        expect( compiled ).toContain( 'validators.symbol' );
        expect( compiled ).toContain( 'validators.templateLiteral' );
        expect( compiled ).toContain( '1n' );
        expect( compiled ).toContain( 'Promise' );
    });

    it( 'should transform requires uniqueItems and array length constraints', () => 
    {
        const code = `
            import { validate, jsonSchema, constraint } from './src/index.js';
            interface User {
                password: string;
                email: string & constraint.Requires<'.password'>;
                tags: string[] & constraint.MinItems<1> & constraint.MaxItems<3> & constraint.UniqueItems;
            }
            const res = validate<User>({ password: 'x', email: 'a@b.co', tags: ['a'] });
            const schema = jsonSchema<User>();
        `;
        const compiled = compileAndTransform( code );

        expect( compiled ).toMatch( /validators\.(minItems|maxItems|uniqueItems)/ );
        expect( compiled ).toContain( '__val_' );
        expect( compiled ).toContain( '__schema_' );
        expect( compiled ).toContain( '"requires": ".password"' );
        expect( compiled ).toContain( '"minItems": 1' );
        expect( compiled ).toContain( '"maxItems": 3' );
        expect( compiled ).toContain( '"uniqueItems": true' );
    });

    function compileAndEmit( sourceCode: string, module: ts.ModuleKind ): string
    {
        const tempFile = path.resolve( './temp_emit_file.ts' );
        fs.writeFileSync( tempFile, sourceCode );

        try
        {
            const program = ts.createProgram([tempFile], {
                target       : ts.ScriptTarget.ES2022,
                module,
                skipLibCheck : true
            });
            const sourceFile = program.getSourceFile( tempFile );

            if( !sourceFile ){ throw new Error( 'Could not load source file' ) }

            let emitted = '';

            program.emit( sourceFile, ( fileName, text ) =>
            {
                if( fileName.endsWith( '.js' )){ emitted = text }
            }, undefined, false, { before : [transformer( program )] });

            return emitted;
        }
        finally
        {
            if( fs.existsSync( tempFile )){ fs.unlinkSync( tempFile ) }
        }
    }

    function topLevelBindings( compiled: string ): string[]
    {
        const file = ts.createSourceFile( 'out.ts', compiled, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS );
        const names: string[] = [];

        for( const statement of file.statements )
        {
            if( ts.isVariableStatement( statement ))
            {
                for( const decl of statement.declarationList.declarations )
                {
                    if( ts.isIdentifier( decl.name )){ names.push( decl.name.text ) }
                }
            }
            else if(( ts.isFunctionDeclaration( statement ) || ts.isClassDeclaration( statement )) && statement.name )
            {
                names.push( statement.name.text );
            }
            else if( ts.isImportDeclaration( statement ))
            {
                const bindings = statement.importClause?.namedBindings;

                if( bindings && ts.isNamespaceImport( bindings )){ names.push( bindings.name.text ) }

                if( bindings && ts.isNamedImports( bindings ))
                {
                    for( const element of bindings.elements ){ names.push( element.name.text ) }
                }
            }
        }

        return names;
    }

    it( 'should not redeclare a validators name already bound by user code', () =>
    {
        const code = `
            import { validate } from '../index.js';
            function validators() { return 1; }
            const r = validate<number>(1);
        `;
        const compiled = compileAndTransform( code );
        const names = topLevelBindings( compiled );

        expect( new Set( names ).size ).toBe( names.length );
        expect( compiled ).toContain( 'function validators()' );
        expect( compiled ).toMatch( /const validators_1 = __tcRuntime\.validators/ );
        expect( compiled ).toMatch( /const __val_[a-f0-9]+ = validators_1\./ );
    });

    it( 'should not redeclare a validators name imported from another module', () =>
    {
        const code = `
            import { validate } from '../index.js';
            import { validators } from 'unrelated-validator';
            const r = validate<number>(1);
        `;
        const compiled = compileAndTransform( code );
        const names = topLevelBindings( compiled );

        expect( new Set( names ).size ).toBe( names.length );
        expect( compiled ).toContain( "import { validators } from 'unrelated-validator'" );
        expect( compiled ).toMatch( /const validators_1 = __tcRuntime\.validators/ );
    });

    it( 'should not collide with a user declared runtime namespace name', () =>
    {
        const code = `
            import { validate } from '../index.js';
            const __tcRuntime = { nope: true };
            const r = validate<number>(1);
        `;
        const compiled = compileAndTransform( code );
        const names = topLevelBindings( compiled );

        expect( new Set( names ).size ).toBe( names.length );
        expect( compiled ).toContain( 'import * as __tcRuntime_1 from "@webergency-utils/typechecker/runtime"' );
        expect( compiled ).toContain( '__tcRuntime_1.validate(' );
        expect( compiled ).toContain( 'const __tcRuntime = { nope: true }' );
    });

    it( 'should not let a nested binding shadow the runtime namespace', () =>
    {
        const code = `
            import { validate } from '../index.js';
            export function f() {
                const __tcRuntime = { fake: true };
                return validate<number>(1);
            }
        `;
        const compiled = compileAndTransform( code );

        expect( compiled ).toContain( 'import * as __tcRuntime_1 from "@webergency-utils/typechecker/runtime"' );
        expect( compiled ).toContain( '__tcRuntime_1.validate(' );
        expect( compiled ).toContain( 'const __tcRuntime = { fake: true }' );
    });

    it( 'should not let a parameter shadow the runtime namespace', () =>
    {
        const code = `
            import { validate } from '../index.js';
            export function h(__tcRuntime: any) {
                return validate<number>(1);
            }
        `;
        const compiled = compileAndTransform( code );

        expect( compiled ).toContain( 'import * as __tcRuntime_1 from "@webergency-utils/typechecker/runtime"' );
        expect( compiled ).toContain( '__tcRuntime_1.validate(' );
    });

    it( 'should emit a self-contained runtime import that survives CommonJS emit', () =>
    {
        const code = `
            import * as rt from '@webergency-utils/typechecker/runtime';
            import { validate } from '../index.js';
            export const r = validate<number>(1);
        `;
        const emitted = compileAndEmit( code, ts.ModuleKind.CommonJS );

        // The user import is elided once calls become synthesized nodes, so the emit must not rely on it.
        expect( emitted ).toContain( 'require("@webergency-utils/typechecker/runtime")' );
        expect( emitted ).toMatch( /const __tcRuntime = .*require\("@webergency-utils\/typechecker\/runtime"\)/ );
        expect( emitted ).toContain( '__tcRuntime.validate(' );
        expect( emitted ).not.toMatch( /=\s*rt\.validators/ );
    });

    it( 'should reuse one local validator for duplicate typed calls', () =>
    {
        const code = `
            import { validate, is } from '../index.js';
            const a = validate<number>(1);
            const b = is<number>(2);
        `;
        const compiled = compileAndTransform( code );
        const vals = compiled.match( /const __val_[a-f0-9]+ =/g ) || [];
        expect( vals.length ).toBe( 1 );
        expect( compiled ).toContain( '__tcRuntime.validate(' );
        expect( compiled ).toContain( '__tcRuntime.is(' );
        expect( compiled ).not.toContain( 'registerValidator' );
        expect( compiled ).not.toContain( 'getValidator' );
    });
});

