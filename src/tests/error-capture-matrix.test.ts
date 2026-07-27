import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import
{
    MetadataStore,
    validators,
    toZodIssues,
    groupErrorsByPath,
    type ValidationContext,
    type IValidationError
}
from '../runtime/validators.js';

function ctx( mode: ValidationContext['mode'] = 'strict', from?: ValidationContext['from'] ): ValidationContext
{
    return { success : true, errors : [], mode, from, root : undefined };
}

function objectArm(
    props: [string, boolean, Function][],
    allowedKeys?: string[]
)
{
    return ( v: any, path: string, c: ValidationContext ) =>
    {
        const obj = validators.object( v, path, c, allowedKeys );

        if( obj === false ){ return v }

        const data = validators.objectShell( obj, c );
        validators.props( obj, data, path, c, props );

        if( allowedKeys ){ validators.stripExtras( data, c, allowedKeys ) }

        return data;
    };
}

/** Nested union tree: number | { left: Tree, right?: Tree } */
function makeTreeUnion( depth: number ): Function
{
    if( depth <= 0 ){ return validators.number }

    const child = makeTreeUnion( depth - 1 );

    return ( v: any, path: string, c: ValidationContext ) =>
        validators.union( v, path, c, [
            validators.number,
            objectArm([
                ['left', false, child],
                ['right', true, child]
            ], ['left', 'right'])
        ], `Tree<${depth}>` );
}

function expectUnionFailure(
    errors: IValidationError[],
    path: string,
    expected: string,
    value: any,
    minIssues: number
)
{
    expect( errors ).toHaveLength( 1 );
    expect( errors[0]).toMatchObject({ path, error : expected, value });
    expect( errors[0].issues?.length ).toBeGreaterThanOrEqual( minIssues );
}

describe( 'Error capture matrix', () =>
{
    let c: ValidationContext;

    beforeEach(() =>
    {
        c = ctx();
    });

    afterEach(() =>
    {
        vi.clearAllMocks();
    });

    describe( 'schema primitive and container failures', () =>
    {
        const cases: { name: string, schema: any, value: any, pathError: RegExp | string }[] =
        [
            { name : 'string', schema : { type : 'string' }, value : 1, pathError : 'Type<string>' },
            { name : 'number', schema : { type : 'number' }, value : 'x', pathError : 'Type<number>' },
            { name : 'integer', schema : { type : 'integer' }, value : 1.5, pathError : /integer|number/i },
            { name : 'boolean', schema : { type : 'boolean' }, value : 'yes', pathError : 'Type<boolean>' },
            { name : 'null', schema : { type : 'null' }, value : undefined, pathError : 'Type<null>' },
            { name : 'array', schema : { type : 'array', items : { type : 'string' } }, value : {}, pathError : 'Type<Array>' },
            {
                name      : 'object',
                schema    : { type : 'object', properties : { a : { type : 'string' } }, required : ['a'], additionalProperties : false },
                value     : null,
                pathError : /Object/
            },
            {
                name      : 'minLength',
                schema    : { type : 'string', minLength : 3 },
                value     : 'ab',
                pathError : /MinLength|minLength/i
            },
            {
                name      : 'maxLength',
                schema    : { type : 'string', maxLength : 2 },
                value     : 'abcd',
                pathError : /MaxLength|maxLength/i
            },
            {
                name      : 'minimum',
                schema    : { type : 'number', minimum : 10 },
                value     : 3,
                pathError : /Minimum|minimum/i
            },
            {
                name      : 'maximum',
                schema    : { type : 'number', maximum : 10 },
                value     : 30,
                pathError : /Maximum|maximum/i
            },
            {
                name      : 'exclusiveMinimum',
                schema    : { type : 'number', exclusiveMinimum : 10 },
                value     : 10,
                pathError : /ExclusiveMinimum|exclusiveMinimum/i
            },
            {
                name      : 'exclusiveMaximum',
                schema    : { type : 'number', exclusiveMaximum : 10 },
                value     : 10,
                pathError : /ExclusiveMaximum|exclusiveMaximum/i
            },
            {
                name      : 'multipleOf',
                schema    : { type : 'number', multipleOf : 3 },
                value     : 4,
                pathError : /MultipleOf|multipleOf/i
            },
            {
                name      : 'pattern',
                schema    : { type : 'string', pattern : '^[a-z]+$' },
                value     : 'A1',
                pathError : /\^\[a-z\]\+\$|Pattern|pattern/i
            },
            {
                name      : 'format email',
                schema    : { type : 'string', format : 'email' },
                value     : 'not-an-email',
                pathError : /email|Format/i
            },
            {
                name      : 'minItems',
                schema    : { type : 'array', items : { type : 'number' }, minItems : 2 },
                value     : [1],
                pathError : /MinItems|minItems/i
            },
            {
                name      : 'maxItems',
                schema    : { type : 'array', items : { type : 'number' }, maxItems : 1 },
                value     : [1, 2],
                pathError : /MaxItems|maxItems/i
            },
            {
                name      : 'uniqueItems',
                schema    : { type : 'array', items : { type : 'number' }, uniqueItems : true },
                value     : [1, 1],
                pathError : /UniqueItems/i
            },
            {
                name      : 'required prop',
                schema    :
                {
                    type                 : 'object',
                    properties           : { a : { type : 'string' } },
                    required             : ['a'],
                    additionalProperties : false
                },
                value     : {},
                pathError : /Type<string>|Required/i
            },
            {
                name      : 'strict extra prop',
                schema    :
                {
                    type                 : 'object',
                    properties           : { a : { type : 'string' } },
                    required             : ['a'],
                    additionalProperties : false
                },
                value     : { a : 'x', b : 1 },
                pathError : /PropertyNotAllowed/i
            },
            {
                name      : 'const mismatch',
                schema    : { const : 'fixed' },
                value     : 'other',
                pathError : /Literal|Const|fixed/i
            },
            {
                name      : 'boolean schema false',
                schema    : false,
                value     : 'anything',
                pathError : /.+/
            }
        ];

        for( const entry of cases )
        {
            it( `captures ${entry.name} failure via validate`, () =>
            {
                // Arrange
                const fn = MetadataStore.getOrCompileSchema( entry.schema );

                // Act
                const result = MetadataStore.validate( fn, entry.value );

                // Assert
                expect( result.success ).toBe( false );
                expect( result.data ).toBeUndefined();
                expect( result.errors.length ).toBeGreaterThan( 0 );
                const joined = result.errors.map( e => `${e.path}:${e.error}` ).join( ' | ' );
                expect( joined ).toMatch( entry.pathError instanceof RegExp ? entry.pathError : new RegExp( entry.pathError ));
            });
        }
    });

    describe( 'flat unions — no correct branch', () =>
    {
        it( 'string | number rejects boolean and nests both arm errors', () =>
        {
            // Arrange
            const fn = MetadataStore.getOrCompileSchema({
                anyOf : [{ type : 'string' }, { type : 'number' }]
            });

            // Act
            const result = MetadataStore.validate( fn, true );

            // Assert
            expectUnionFailure( result.errors, '', 'Type<Union>', true, 2 );
            expect( result.errors[0].issues ).toEqual( expect.arrayContaining([
                expect.objectContaining({ error : 'Type<string>', value : true }),
                expect.objectContaining({ error : 'Type<number>', value : true })
            ]));
        });

        it( 'three-arm union rejects and keeps one issues list', () =>
        {
            // Arrange
            const fn = MetadataStore.getOrCompileSchema({
                anyOf : [{ type : 'string' }, { type : 'number' }, { type : 'boolean' }]
            });

            // Act
            MetadataStore.validate( fn, null ).errors;

            // Assert
            const result = MetadataStore.validate( fn, null );
            expectUnionFailure( result.errors, '', 'Type<Union>', null, 3 );
        });

        it( 'object | array rejects scalar with nested issues', () =>
        {
            // Arrange
            const fn = MetadataStore.getOrCompileSchema({
                anyOf :
                [
                    { type : 'object', properties : { a : { type : 'string' } }, additionalProperties : false },
                    { type : 'array', items : { type : 'number' } }
                ]
            });

            // Act
            const result = MetadataStore.validate( fn, 'nope' );

            // Assert
            expectUnionFailure( result.errors, '', 'Type<Union>', 'nope', 2 );
        });
    });

    describe( 'flat unions — exactly one correct branch', () =>
    {
        it( 'accepts matching string arm and ignores failing number arm', () =>
        {
            // Arrange
            const fn = MetadataStore.getOrCompileSchema({
                anyOf : [{ type : 'string' }, { type : 'number' }]
            });

            // Act
            const result = MetadataStore.validate( fn, 'ok' );

            // Assert
            expect( result.success ).toBe( true );
            expect( result.data ).toBe( 'ok' );
            expect( result.errors ).toEqual([]);
        });

        it( 'accepts matching object arm among incompatible shapes', () =>
        {
            // Arrange
            const fn = MetadataStore.getOrCompileSchema({
                anyOf :
                [
                    {
                        type                 : 'object',
                        properties           : { kind : { const : 'a' }, n : { type : 'number' } },
                        required             : ['kind', 'n'],
                        additionalProperties : false
                    },
                    {
                        type                 : 'object',
                        properties           : { kind : { const : 'b' }, s : { type : 'string' } },
                        required             : ['kind', 's'],
                        additionalProperties : false
                    }
                ]
            });

            // Act
            const result = MetadataStore.validate( fn, { kind : 'b', s : 'x' });

            // Assert
            expect( result.success ).toBe( true );
            expect( result.data ).toEqual({ kind : 'b', s : 'x' });
        });

        it( 'rejects when object matches neither discriminant', () =>
        {
            // Arrange
            const fn = MetadataStore.getOrCompileSchema({
                anyOf :
                [
                    {
                        type                 : 'object',
                        properties           : { kind : { const : 'a' }, n : { type : 'number' } },
                        required             : ['kind', 'n'],
                        additionalProperties : false
                    },
                    {
                        type                 : 'object',
                        properties           : { kind : { const : 'b' }, s : { type : 'string' } },
                        required             : ['kind', 's'],
                        additionalProperties : false
                    }
                ]
            });

            // Act
            const result = MetadataStore.validate( fn, { kind : 'c', n : 1 });

            // Assert
            expect( result.success ).toBe( false );
            expectUnionFailure( result.errors, '', 'Type<Union>', { kind : 'c', n : 1 }, 2 );
        });
    });

    describe( 'nested / recursive-style unions', () =>
    {
        it( 'depth-3 tree union accepts a valid nested branch', () =>
        {
            // Arrange
            const tree = makeTreeUnion( 3 );
            const value = { left : { left : 1, right : 2 }, right : 3 };

            // Act
            const result = MetadataStore.validate( tree, value );

            // Assert
            expect( result.success ).toBe( true );
            expect( result.data ).toEqual( value );
        });

        it( 'depth-3 tree union rejects when no branch matches at leaf', () =>
        {
            // Arrange
            const tree = makeTreeUnion( 3 );
            const value = { left : { left : 'bad', right : 2 }, right : 3 };

            // Act
            const result = MetadataStore.validate( tree, value );

            // Assert
            expect( result.success ).toBe( false );
            expect( result.errors[0].error ).toMatch( /Tree|Union/ );
            expect( result.errors[0].issues?.length ).toBeGreaterThan( 0 );

            const zod = toZodIssues( result.errors );
            expect( zod.length ).toBeGreaterThan( 0 );
            expect( Object.keys( groupErrorsByPath( result.errors )).length ).toBeGreaterThan( 0 );
        });

        it( 'depth-4 tree union rejects totally wrong root with nested issues', () =>
        {
            // Arrange
            const tree = makeTreeUnion( 4 );

            // Act
            const result = MetadataStore.validate( tree, true );

            // Assert
            expectUnionFailure( result.errors, '', 'Tree<4>', true, 2 );
        });

        it( 'nested schema anyOf inside object property reports path-qualified union error', () =>
        {
            // Arrange
            const fn = MetadataStore.getOrCompileSchema({
                type       : 'object',
                properties :
                {
                    node :
                    {
                        anyOf :
                        [
                            { type : 'string' },
                            {
                                type                 : 'object',
                                properties           :
                                {
                                    child : {
                                        anyOf : [{ type : 'number' }, { type : 'boolean' }]
                                    }
                                },
                                required             : ['child'],
                                additionalProperties : false
                            }
                        ]
                    }
                },
                required             : ['node'],
                additionalProperties : false
            });

            // Act
            const result = MetadataStore.validate( fn, { node : { child : 'nope' } });

            // Assert
            expect( result.success ).toBe( false );
            const paths = result.errors.flatMap( function walk( e ): string[]
            {
                return [e.path, ...( e.issues ? e.issues.flatMap( walk ) : [] )];
            });
            expect( paths.some( p => p.includes( 'node' ))).toBe( true );
        });

        it( 'union of unions flattens through toZodIssues', () =>
        {
            // Arrange
            const inner = ( v: any, path: string, local: ValidationContext ) =>
                validators.union( v, path, local, [validators.string, validators.number], 'Inner' );
            const outer = ( v: any, path: string, local: ValidationContext ) =>
                validators.union( v, path, local, [inner, validators.boolean], 'Outer' );

            // Act
            outer( null, 'root', c );

            // Assert
            expect( c.success ).toBe( false );
            expect( c.errors[0].error ).toBe( 'Outer' );
            expect( c.errors[0].issues?.some( i => i.error === 'Inner' )).toBe( true );
            expect( toZodIssues( c.errors ).length ).toBeGreaterThan( 2 );
        });

        it( 'recursive-style optional right branch can be omitted when left is valid', () =>
        {
            // Arrange
            const tree = makeTreeUnion( 2 );
            const value = { left : 1 };

            // Act
            const result = MetadataStore.validate( tree, value );

            // Assert
            expect( result.success ).toBe( true );
            expect( result.data ).toEqual({ left : 1 });
        });

        it( 'is returns false and assertGuard throws with captured union issues', () =>
        {
            // Arrange
            const tree = makeTreeUnion( 2 );
            const value = { left : false };

            // Act / Assert
            expect( MetadataStore.is( tree, value )).toBe( false );
            expect(() => MetadataStore.assertGuard( tree, value )).toThrow( /Tree|Union|Validation Error/ );
            expect(() => MetadataStore.assert( tree, value )).toThrow( /Tree|Union|Validation Error/ );
        });
    });

    describe( 'multiple sibling and deep paths', () =>
    {
        it( 'collects multiple property errors without short-circuiting siblings', () =>
        {
            // Arrange
            const fn = MetadataStore.getOrCompileSchema({
                type       : 'object',
                properties :
                {
                    a : { type : 'string' },
                    b : { type : 'number' },
                    c : { type : 'boolean' }
                },
                required             : ['a', 'b', 'c'],
                additionalProperties : false
            });

            // Act
            const result = MetadataStore.validate( fn, { a : 1, b : 'x', c : 'y' });

            // Assert
            expect( result.success ).toBe( false );
            expect( result.errors.length ).toBeGreaterThanOrEqual( 3 );
            expect( result.errors.map( e => e.path ).sort()).toEqual(['.a', '.b', '.c'].sort());
        });

        it( 'array element failures keep index paths', () =>
        {
            // Arrange
            const fn = MetadataStore.getOrCompileSchema({
                type  : 'array',
                items : { type : 'number' }
            });

            // Act
            const result = MetadataStore.validate( fn, [1, 'x', 3, true]);

            // Assert
            expect( result.success ).toBe( false );
            expect( result.errors.map( e => e.path )).toEqual( expect.arrayContaining(['[1]', '[3]']));
        });

        it( 'tuple length mismatch reports Tuple error', () =>
        {
            // Arrange
            c.root = [1];

            // Act
            validators.tuple([1], 't', c, [validators.number, validators.string]);

            // Assert
            expect( c.success ).toBe( false );
            expect( c.errors[0].error ).toMatch( /Tuple/ );
        });

        it( 'record value failures use key paths', () =>
        {
            // Arrange
            c.root = { a : 1, b : 'x' };

            // Act
            validators.record( c.root, 'r', c, validators.number );

            // Assert
            expect( c.success ).toBe( false );
            expect( c.errors.some( e => e.path.includes( 'b' ))).toBe( true );
        });
    });

    describe( 'coercion-aware union pass-2 failures', () =>
    {
        it( 'without from, numeric string fails number|boolean union', () =>
        {
            // Arrange
            const fn = MetadataStore.getOrCompileSchema({
                anyOf : [{ type : 'number' }, { type : 'boolean' }]
            });

            // Act
            const result = MetadataStore.validate( fn, '12' );

            // Assert
            expect( result.success ).toBe( false );
            expectUnionFailure( result.errors, '', 'Type<Union>', '12', 2 );
        });

        it( 'with from query, numeric string succeeds on number arm', () =>
        {
            // Arrange
            const fn = MetadataStore.getOrCompileSchema({
                anyOf : [{ type : 'number' }, { type : 'boolean' }]
            });

            // Act
            const result = MetadataStore.validate( fn, '12', { from : 'query' });

            // Assert
            expect( result.success ).toBe( true );
            expect( result.data ).toBe( 12 );
        });

        it( 'with from query, still fails when no arm can coerce', () =>
        {
            // Arrange
            const fn = MetadataStore.getOrCompileSchema({
                anyOf : [{ type : 'number' }, { type : 'boolean' }]
            });

            // Act
            const result = MetadataStore.validate( fn, { x : 1 }, { from : 'query' });

            // Assert
            expect( result.success ).toBe( false );
            expect( result.errors[0].issues?.length ).toBeGreaterThanOrEqual( 2 );
        });
    });

    describe( 'allOf error aggregation', () =>
    {
        it( 'reports errors from every failing allOf member', () =>
        {
            // Arrange
            const fn = MetadataStore.getOrCompileSchema({
                allOf :
                [
                    {
                        type                 : 'object',
                        properties           : { a : { type : 'string' } },
                        required             : ['a'],
                        additionalProperties : false
                    },
                    {
                        type                 : 'object',
                        properties           : { b : { type : 'number' } },
                        required             : ['b'],
                        additionalProperties : false
                    }
                ]
            });

            // Act
            const result = MetadataStore.validate( fn, { a : 1, b : 'x' });

            // Assert
            expect( result.success ).toBe( false );
            expect( result.errors.length ).toBeGreaterThanOrEqual( 2 );
        });
    });

    describe( 'guard / assert error factories', () =>
    {
        it( 'assert and assertGuard honor custom errorFactory payloads', () =>
        {
            // Arrange
            const fn = MetadataStore.getOrCompileSchema({ type : 'string' });
            const factory = ( errors: IValidationError[] ) =>
            {
                const err = new Error( 'custom' );
                ( err as any ).issues = errors;

                return err;
            };

            // Act / Assert
            expect(() => MetadataStore.assert( fn, 1, { errorFactory : factory })).toThrow( 'custom' );
            expect(() => MetadataStore.assertGuard( fn, 1, { errorFactory : factory })).toThrow( 'custom' );
        });
    });
});
