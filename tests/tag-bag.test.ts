import { afterEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { buildJsonSchema } from '../src/engine/resolver.js';
import { peelTaggedIntersection } from '../src/engine/type-helpers.js';
import { compileAndTransform, emitAndImport } from './helpers/compile.js';

function typesFrom( sourceText: string ): { checker : ts.TypeChecker, sourceFile : ts.SourceFile }
{
    const fileName = '/virtual/tag-bag.ts';
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

const TAG_SOURCE = `
    type Tag<Names extends string> = { readonly __tags?: { [K in Names]?: true } };
    type Html = string & Tag<'html'>;
    type Both = string & Tag<'html' | 'basic'>;
    type Intersected = string & Tag<'html'> & Tag<'basic'>;
    type WithConstraint = string & Tag<'html'> & { readonly __minLength?: 1 };
    type Article = { body: string & Tag<'html' | 'basic'> };
`;

describe( 'tag bag peel and jsonSchema', () =>
{
    afterEach(() =>
    {
        vi.clearAllMocks();
    });

    it( 'should peel a single name into a sorted tags bag', () =>
    {
        // Arrange
        const { checker, sourceFile } = typesFrom( TAG_SOURCE );
        const type = typeOfAlias( sourceFile, checker, 'Html' );

        // Act
        const peeled = peelTaggedIntersection( type, checker );

        // Assert
        expect( peeled?.hasTags ).toBe( true );
        expect( peeled?.constraints ).toEqual([
            { type : 'tags', value : ['html'] }
        ]);
    });

    it( 'should store union names in one bag', () =>
    {
        // Arrange
        const { checker, sourceFile } = typesFrom( TAG_SOURCE );
        const type = typeOfAlias( sourceFile, checker, 'Both' );

        // Act
        const peeled = peelTaggedIntersection( type, checker );

        // Assert
        expect( peeled?.constraints ).toEqual([
            { type : 'tags', value : ['basic', 'html'] }
        ]);
    });

    it( 'should merge intersected tag bags into one sorted list', () =>
    {
        // Arrange
        const { checker, sourceFile } = typesFrom( TAG_SOURCE );
        const type = typeOfAlias( sourceFile, checker, 'Intersected' );

        // Act
        const peeled = peelTaggedIntersection( type, checker );

        // Assert
        expect( peeled?.constraints ).toEqual([
            { type : 'tags', value : ['basic', 'html'] }
        ]);
    });

    it( 'should keep other constraints beside the tag bag', () =>
    {
        // Arrange
        const { checker, sourceFile } = typesFrom( TAG_SOURCE );
        const type = typeOfAlias( sourceFile, checker, 'WithConstraint' );

        // Act
        const peeled = peelTaggedIntersection( type, checker );
        const kinds = ( peeled?.constraints || []).map( c => c.type ).sort();

        // Assert
        expect( kinds ).toEqual([ 'minLength', 'tags' ]);
        expect( peeled?.constraints.find( c => c.type === 'tags' )?.value ).toEqual([ 'html' ]);
    });

    it( 'should emit x-tags on jsonSchema for union and intersected bags', () =>
    {
        // Arrange
        const { checker, sourceFile } = typesFrom( TAG_SOURCE );
        const both = typeOfAlias( sourceFile, checker, 'Both' );
        const intersected = typeOfAlias( sourceFile, checker, 'Intersected' );
        const article = typeOfAlias( sourceFile, checker, 'Article' );

        // Act
        const bothSchema = buildJsonSchema( both, checker );
        const intersectedSchema = buildJsonSchema( intersected, checker );
        const articleSchema = buildJsonSchema( article, checker );

        // Assert
        expect( bothSchema ).toMatchObject({ type : 'string', 'x-tags' : ['basic', 'html'] });
        expect( intersectedSchema ).toMatchObject({ type : 'string', 'x-tags' : ['basic', 'html'] });
        expect( articleSchema ).toMatchObject({
            type       : 'object',
            properties : {
                body : { type : 'string', 'x-tags' : ['basic', 'html'] }
            }
        });
    });
});

describe( 'tag bag transformer', () =>
{
    afterEach(() =>
    {
        vi.clearAllMocks();
    });

    it( 'should hoist jsonSchema with x-tags from tag union and intersection', () =>
    {
        // Arrange
        const code = `
            import { jsonSchema, tag } from './src/index.js';
            type Body = string & tag<'html' | 'basic'>;
            type Also = string & tag<'html'> & tag<'markdown'>;
            const a = jsonSchema<Body>();
            const b = jsonSchema<Also>();
        `;

        // Act
        const compiled = compileAndTransform( code, 'temp_tag_bag_schema' );

        // Assert
        expect( compiled ).toContain( '"x-tags"' );
        expect( compiled ).toContain( '"html"' );
        expect( compiled ).toContain( '"basic"' );
        expect( compiled ).toContain( '"markdown"' );
    });

    it( 'should validate tagged strings as the base type and expose x-tags at runtime', async() =>
    {
        // Arrange
        const mod = await emitAndImport<{
            schema : { type? : string, 'x-tags'? : string[], minLength? : number }
            articleSchema : { properties? : { body? : { 'x-tags'? : string[] } } }
            ok : { success : boolean, data? : { body : string } }
            short : { success : boolean }
        }>( `
            import { jsonSchema, validate, tag, constraint } from '../src/index.js';

            type Body = string & tag<'html' | 'basic'> & constraint.MinLength<3>;
            interface Article { body : Body }

            export const schema = jsonSchema<Body>();
            export const articleSchema = jsonSchema<Article>();
            export const ok = validate<Article>({ body : '<p>hi</p>' });
            export const short = validate<Article>({ body : 'ab' });
        `, 'temp_tag_bag_e2e' );

        // Act
        const { schema, articleSchema, ok, short } = mod;

        // Assert
        expect( schema ).toMatchObject({ type : 'string', 'x-tags' : ['basic', 'html'], minLength : 3 });
        expect( articleSchema.properties?.body?.['x-tags'] ).toEqual([ 'basic', 'html' ]);
        expect( ok.success ).toBe( true );
        expect( ok.data?.body ).toBe( '<p>hi</p>' );
        expect( short.success ).toBe( false );
    });
});
