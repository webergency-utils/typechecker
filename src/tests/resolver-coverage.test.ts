import { describe, it, expect, afterEach, vi } from 'vitest';
import ts from 'typescript';
import { buildJsonSchema, buildValidator, generateHash } from '../engine/resolver.js';

function typesFrom( sourceText: string ): { checker : ts.TypeChecker, sourceFile : ts.SourceFile }
{
    const fileName = '/virtual/resolver-coverage.ts';
    const sourceFile = ts.createSourceFile( fileName, sourceText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS );
    const baseHost = ts.createCompilerHost({ target : ts.ScriptTarget.ES2022 });
    const host: ts.CompilerHost =
    {
        ...baseHost,
        getSourceFile : ( name, languageVersion, onError, shouldCreateNewSourceFile ) =>
            name === fileName ? sourceFile : baseHost.getSourceFile( name, languageVersion, onError, shouldCreateNewSourceFile ),
        fileExists : ( name ) => name === fileName || baseHost.fileExists( name ),
        readFile   : ( name ) => name === fileName ? sourceText : baseHost.readFile( name ),
        writeFile  : () => undefined
    };
    const program = ts.createProgram([fileName], { target : ts.ScriptTarget.ES2022, strict : true }, host );

    return { checker : program.getTypeChecker(), sourceFile };
}

function typeOfAlias( sourceFile: ts.SourceFile, checker: ts.TypeChecker, name: string ): ts.Type
{
    const declaration = sourceFile.statements.find( statement =>
        ts.isTypeAliasDeclaration( statement ) && statement.name.text === name
    );

    if( !declaration || !ts.isTypeAliasDeclaration( declaration ))
    {
        throw new Error( `Missing type alias: ${name}` );
    }

    return checker.getTypeFromTypeNode( declaration.type );
}

describe( 'resolver coverage', () =>
{
    afterEach(() =>
    {
        vi.clearAllMocks();
    });

    it( 'should build validators for supported TypeScript shapes', () =>
    {
        // Arrange
        const { checker, sourceFile } = typesFrom( `
            enum Flag { Yes = 'yes', No = 'no' }
            type Scalar = null | undefined | bigint | boolean | symbol | never;
            type Template = \`id_\${number}_\${boolean}_\${bigint}\`;
            type Tuple = [number, string];
            type RecordType = Record<string, number>;
            type OpenObject = { id: number; [key: string]: number };
            type Containers = { set: Set<string>; map: Map<string, number>; regexp: RegExp; promise: Promise<number>; bytes: Uint8Array };
            type Callable = ( value: number ) => string;
            type EnumType = Flag;
        ` );
        const validators = new Map<string, ts.Expression>();
        const names =
        [
            'Scalar',
            'Template',
            'Tuple',
            'RecordType',
            'OpenObject',
            'Containers',
            'Callable',
            'EnumType'
        ];

        // Act
        const ids = names.map( name =>
        {
            const type = typeOfAlias( sourceFile, checker, name );

            return buildValidator( type, checker, validators );
        });

        // Assert
        expect( ids ).toHaveLength( names.length );
        expect( validators.size ).toBeGreaterThan( names.length );
    });

    it( 'should build schemas for constrained containers, intersections, and nested recursion', () =>
    {
        // Arrange
        const { checker, sourceFile } = typesFrom( `
            type StringConstrained = string & { __minLength?: 2; __maxLength?: 5; __pattern?: '^x'; __format?: 'email' };
            type NumberConstrained = number & { __minimum?: 1; __maximum?: 9; __multipleOf?: 2 };
            type CollectionConstrained = Set<string> & { __minItems?: 1; __maxItems?: 3; __uniqueItems?: true };
            type ObjectIntersection = { left: string } & { right: number };
            interface Child { next?: Child; value: bigint; date: Date; regexp: RegExp; mapping: Map<string, boolean> }
            interface Parent { child: Child; enabled: boolean; bytes: Uint8Array }
            type Root = Parent;
        ` );

        // Act
        const stringSchema = buildJsonSchema( typeOfAlias( sourceFile, checker, 'StringConstrained' ), checker );
        const numberSchema = buildJsonSchema( typeOfAlias( sourceFile, checker, 'NumberConstrained' ), checker );
        const collectionSchema = buildJsonSchema( typeOfAlias( sourceFile, checker, 'CollectionConstrained' ), checker );
        const intersectionSchema = buildJsonSchema( typeOfAlias( sourceFile, checker, 'ObjectIntersection' ), checker );
        const rootType = typeOfAlias( sourceFile, checker, 'Root' );
        const rootSchema = buildJsonSchema( rootType, checker );

        // Assert
        expect( stringSchema ).toMatchObject({ type : 'string', minLength : 2, maxLength : 5, pattern : '^x', format : 'email' });
        expect( numberSchema ).toMatchObject({ type : 'number', minimum : 1, maximum : 9, multipleOf : 2 });
        expect( collectionSchema ).toMatchObject({ 'x-typescript-type' : 'Set', minItems : 1, maxItems : 3, uniqueItems : true });
        expect( intersectionSchema.allOf ).toHaveLength( 2 );
        expect( rootSchema.$defs ).toBeDefined();
        expect( generateHash( rootType, checker )).toMatch( /^[a-f0-9]{16}$/ );
    });
});
