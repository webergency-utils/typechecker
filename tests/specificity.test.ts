import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import * as path from 'path';
import { getCachedCompilerHost } from './helpers/compile.js';
import
{
    MAX_SPECIFICITY_DEPTH,
    getDeepSpecificity,
    sortUnionArmsBySpecificity,
    isFallbackUnionArm,
    hasCompetingObjectArms,
    tryExclusiveKeyUnion
}
    from '../src/engine/specificity.js';

const COMPILER_OPTIONS: ts.CompilerOptions =
{
    target           : ts.ScriptTarget.ES2022,
    module           : ts.ModuleKind.NodeNext,
    moduleResolution : ts.ModuleResolutionKind.NodeNext,
    strict           : true,
    skipLibCheck     : true,
    types            : ['node']
};

function resolveTypesFromCode( code: string ): { checker : ts.TypeChecker, types : Record<string, ts.Type> }
{
    const fileName = path.resolve( './tests/__virtual_specificity__.ts' );
    const virtualFiles = new Map<string, string>([[ fileName, code ]]);
    const host = getCachedCompilerHost( COMPILER_OPTIONS, virtualFiles );
    const program = ts.createProgram([fileName], COMPILER_OPTIONS, host );
    const checker = program.getTypeChecker();
    const sourceFile = program.getSourceFile( fileName )!;
    const types: Record<string, ts.Type> = {};

    ts.forEachChild( sourceFile, node =>
    {
        if(
            ts.isTypeAliasDeclaration( node ) ||
            ts.isInterfaceDeclaration( node ) ||
            ts.isEnumDeclaration( node )
        )
        {
            const sym = checker.getSymbolAtLocation( node.name );

            if( sym )
            {
                types[node.name.text] = checker.getDeclaredTypeOfSymbol( sym );
            }
        }
    });

    return { checker, types };
}

describe( 'Compile-Time Deep Specificity Scorer (U1)', () =>
{
    it( 'ranks wider subtype objects above narrower objects (AE1)', () =>
    {
        // Arrange
        const { checker, types } = resolveTypesFromCode( `
            type A = { foo: string };
            type B = { bar: number };
            type C = { foo: string; bar: number };
            type Union = A | B | C;
        ` );

        // Act
        const scoreA = getDeepSpecificity( types.A, checker );
        const scoreB = getDeepSpecificity( types.B, checker );
        const scoreC = getDeepSpecificity( types.C, checker );
        const sorted = sortUnionArmsBySpecificity(( types.Union as ts.UnionType ).types, checker );

        // Assert
        expect( scoreC ).toBeGreaterThan( scoreA );
        expect( scoreC ).toBeGreaterThan( scoreB );
        expect( sorted[0]).toBe( types.C );
    });

    it( 'weights required properties strictly higher than pairs of optional properties (AE2)', () =>
    {
        // Arrange
        const { checker, types } = resolveTypesFromCode( `
            type WithOptionals = { foo: string; opt1?: number; opt2?: number };
            type WithRequired = { foo: string; bar: number };
        ` );

        // Act
        const scoreOptionals = getDeepSpecificity( types.WithOptionals, checker );
        const scoreRequired = getDeepSpecificity( types.WithRequired, checker );

        // Assert
        expect( scoreRequired ).toBeGreaterThan( scoreOptionals );
    });

    it( 'applies 0.95 depth decay so deeper nested structures outrank shallow primitives while shallower wins ties (R2)', () =>
    {
        // Arrange
        const { checker, types } = resolveTypesFromCode( `
            type ShallowPrim = { a: string };
            type NestedOne = { a: { x: string } };
            type NestedTwo = { a: { x: string; y: number } };
            type TwoTopLevel = { a: string; b: number };
            type OneTopOneChild = { a: { x: string } };
        ` );

        // Act
        const sShallow = getDeepSpecificity( types.ShallowPrim, checker );
        const sNestedOne = getDeepSpecificity( types.NestedOne, checker );
        const sNestedTwo = getDeepSpecificity( types.NestedTwo, checker );
        const sTwoTop = getDeepSpecificity( types.TwoTopLevel, checker );
        const sOneTopOneChild = getDeepSpecificity( types.OneTopOneChild, checker );

        // Assert
        expect( sNestedTwo ).toBeGreaterThan( sNestedOne );
        expect( sNestedOne ).toBeGreaterThan( sShallow );
        expect( sNestedTwo ).toBeGreaterThan( sTwoTop );
        expect( sTwoTop ).toBeGreaterThan( sOneTopOneChild );
    });

    it( 'scores nested unions using min + 0.001 * max across non-nullish arms (R3, AE4)', () =>
    {
        // Arrange
        const { checker, types } = resolveTypesFromCode( `
            type Small = { id: string };
            type Medium = { id: string; a: number; b: number };
            type Huge = { id: string; a: number; b: number; c: number; d: number };
            type WrapUnion = { data: Small | Huge };
            type WrapMedium = { data: Medium };
            type WrapSmall = { data: Small };
            type WrapNullable = { data: Small | null | undefined };
        ` );

        // Act
        const scoreWrapUnion = getDeepSpecificity( types.WrapUnion, checker );
        const scoreWrapMedium = getDeepSpecificity( types.WrapMedium, checker );
        const scoreWrapSmall = getDeepSpecificity( types.WrapSmall, checker );
        const scoreWrapNullable = getDeepSpecificity( types.WrapNullable, checker );

        // Assert
        expect( scoreWrapMedium ).toBeGreaterThan( scoreWrapUnion );
        expect( scoreWrapUnion ).toBeGreaterThan( scoreWrapSmall );
        expect( scoreWrapNullable ).toBeCloseTo( scoreWrapSmall, 5 );
    });

    it( 'enforces category hierarchy: structured object > Record > empty {} > literal > template > primitive > bare object > any (R4, AE5)', () =>
    {
        // Arrange
        const { checker, types } = resolveTypesFromCode( `
            type Structured = { foo: string };
            type StrRecord = Record<string, number>;
            type EmptyObj = {};
            type BareObject = object;
            type Lit = 'exact';
            type Tpl = \`prefix_\${string}\`;
            type Prim = string;
            type AnyType = any;
        ` );

        // Act
        const sStructured = getDeepSpecificity( types.Structured, checker );
        const sRecord = getDeepSpecificity( types.StrRecord, checker );
        const sEmpty = getDeepSpecificity( types.EmptyObj, checker );
        const sBare = getDeepSpecificity( types.BareObject, checker );
        const sLit = getDeepSpecificity( types.Lit, checker );
        const sTpl = getDeepSpecificity( types.Tpl, checker );
        const sPrim = getDeepSpecificity( types.Prim, checker );
        const sAny = getDeepSpecificity( types.AnyType, checker );

        // Assert
        expect( sStructured ).toBeGreaterThan( sRecord );
        expect( sRecord ).toBeGreaterThan( sEmpty );
        expect( sEmpty ).toBeGreaterThan( sLit );
        expect( sLit ).toBeGreaterThan( sTpl );
        expect( sTpl ).toBeGreaterThan( sPrim );
        expect( sPrim ).toBeGreaterThan( sBare );
        expect( sBare ).toBeGreaterThan( sAny );
        expect( sAny ).toBe( 0 );
    });

    it( 'terminates deterministically on self-referential and mutually recursive types (R5)', () =>
    {
        // Arrange
        const { checker, types } = resolveTypesFromCode( `
            interface TreeNode {
                id: string;
                children?: TreeNode[];
                parent?: TreeNode;
            }
            interface NodeA {
                name: string;
                b?: NodeB;
            }
            interface NodeB {
                count: number;
                a?: NodeA;
            }
        ` );

        // Act
        const scoreTree = getDeepSpecificity( types.TreeNode, checker );
        const scoreA = getDeepSpecificity( types.NodeA, checker );
        const scoreB = getDeepSpecificity( types.NodeB, checker );

        // Assert
        expect( Number.isFinite( scoreTree )).toBe( true );
        expect( scoreTree ).toBeGreaterThan( 1000 );
        expect( Number.isFinite( scoreA )).toBe( true );
        expect( Number.isFinite( scoreB )).toBe( true );
    });

    it( 'identifies fallback union arms and competing object unions accurately (R9, R10)', () =>
    {
        // Arrange
        const { checker, types } = resolveTypesFromCode( `
            import { constraint } from '../src/index.js';
            type A = { foo: string };
            type B = { bar: number };
            type BareObj = object;
            type TaggedBareObj = object & constraint.MinProperties<1>;
            type TaggedStructObj = { foo: string } & constraint.MinProperties<1>;
            type MergedIntersection = { foo: string } & { bar: number };
            type Competing = A | B;
            type WithFallback = A | object;
            type WithTaggedStruct = TaggedStructObj | B;
            type WithMerged = MergedIntersection | A;
            type NonCompeting = A | string | number | null;
        ` );

        // Act & Assert
        expect( isFallbackUnionArm( types.BareObj, checker )).toBe( true );
        expect( isFallbackUnionArm( types.TaggedBareObj, checker )).toBe( true );
        expect( isFallbackUnionArm( types.TaggedStructObj, checker )).toBe( false );
        expect( isFallbackUnionArm( types.MergedIntersection, checker )).toBe( false );
        expect( isFallbackUnionArm( types.A, checker )).toBe( false );
        expect( hasCompetingObjectArms(( types.Competing as ts.UnionType ).types, checker )).toBe( true );
        expect( hasCompetingObjectArms(( types.WithFallback as ts.UnionType ).types, checker )).toBe( true );
        expect( hasCompetingObjectArms(( types.WithTaggedStruct as ts.UnionType ).types, checker )).toBe( true );
        expect( hasCompetingObjectArms(( types.WithMerged as ts.UnionType ).types, checker )).toBe( true );
        expect( hasCompetingObjectArms(( types.NonCompeting as ts.UnionType ).types, checker )).toBe( false );
    });

    it( 'scores intersections, constraint tags, tuples, and arrays including multi-object intersections with constraint tags', () =>
    {
        // Arrange
        const { checker, types } = resolveTypesFromCode( `
            import { constraint } from '../src/index.js';
            type Intersected = { a: string } & { b: number };
            type ConstrainedIntersected = { a: string } & { b: number } & constraint.MinProperties<2>;
            type SingleProp = { a: string };
            type ConstrainedSingleObj = { a: string } & constraint.MinProperties<1>;
            type ConstrainedProp = { a: string & constraint.MinLength<3> };
            type TupleWrap = { items: [string, number] };
            type ArrayWrap = { items: string[] };
            type HybridRecord = { fixed: string } & Record<string, string>;
        ` );

        // Act & Assert
        expect( getDeepSpecificity( types.Intersected, checker )).toBeGreaterThan( getDeepSpecificity( types.SingleProp, checker ));
        expect( getDeepSpecificity( types.ConstrainedIntersected, checker )).toBeGreaterThan( getDeepSpecificity( types.Intersected, checker ));
        expect( getDeepSpecificity( types.ConstrainedSingleObj, checker )).toBeGreaterThan( getDeepSpecificity( types.SingleProp, checker ));
        expect( getDeepSpecificity( types.ConstrainedProp, checker )).toBeGreaterThan( getDeepSpecificity( types.SingleProp, checker ));
        expect( getDeepSpecificity( types.TupleWrap, checker )).toBeGreaterThan( getDeepSpecificity( types.ArrayWrap, checker ));
        expect( getDeepSpecificity( types.HybridRecord, checker )).toBeGreaterThan( getDeepSpecificity( types.SingleProp, checker ));
    });

    it( 'scores boolean and optional boolean properties as primitive boolean rather than BooleanLiteral unions', () =>
    {
        // Arrange
        const { checker, types } = resolveTypesFromCode( `
            type PrimBool = boolean;
            type PrimStr = string;
            type LitTrue = true;
            type ObjWithBool = { flag: boolean };
            type ObjWithStr = { flag: string };
            type ObjWithTrue = { flag: true };
            type ObjWithOptBool = { flag?: boolean };
            type ObjWithOptStr = { flag?: string };
            type ObjWithOptTrue = { flag?: true };
            type UnionBoolAndObj = { val: boolean | { a: string } };
            type UnionStrAndObj = { val: string | { a: string } };
            type UnionTrueAndObj = { val: true | { a: string } };
        ` );

        // Act
        const sPrimBool = getDeepSpecificity( types.PrimBool, checker );
        const sPrimStr = getDeepSpecificity( types.PrimStr, checker );
        const sLitTrue = getDeepSpecificity( types.LitTrue, checker );
        const sObjBool = getDeepSpecificity( types.ObjWithBool, checker );
        const sObjStr = getDeepSpecificity( types.ObjWithStr, checker );
        const sObjTrue = getDeepSpecificity( types.ObjWithTrue, checker );
        const sObjOptBool = getDeepSpecificity( types.ObjWithOptBool, checker );
        const sObjOptStr = getDeepSpecificity( types.ObjWithOptStr, checker );
        const sObjOptTrue = getDeepSpecificity( types.ObjWithOptTrue, checker );
        const sUnionBoolObj = getDeepSpecificity( types.UnionBoolAndObj, checker );
        const sUnionStrObj = getDeepSpecificity( types.UnionStrAndObj, checker );
        const sUnionTrueObj = getDeepSpecificity( types.UnionTrueAndObj, checker );

        // Assert
        expect( sPrimBool ).toBe( 10 );
        expect( sPrimBool ).toBe( sPrimStr );
        expect( sLitTrue ).toBe( 25 );
        expect( sObjBool ).toBeCloseTo( sObjStr, 6 );
        expect( sObjTrue ).toBeGreaterThan( sObjBool );
        expect( sObjOptBool ).toBeCloseTo( sObjOptStr, 6 );
        expect( sObjBool ).toBeGreaterThan( sObjOptBool );
        expect( sObjOptTrue ).toBeGreaterThan( sObjOptBool );
        expect( sUnionBoolObj ).toBeCloseTo( sUnionStrObj, 6 );
        expect( sUnionTrueObj ).toBeGreaterThan( sUnionBoolObj );
    });

    it( 'ranks Date, Set, Map, RegExp, and Buffer ahead of bare object at depth 0 and in union sorting', () =>
    {
        // Arrange
        const { checker, types } = resolveTypesFromCode( `
            type BareObj = object;
            type DateType = Date;
            type SetStr = Set<string>;
            type SetObj = Set<{ id: string }>;
            type MapStrNum = Map<string, number>;
            type MapStrObj = Map<string, { count: number }>;
            type RegExpType = RegExp;
            type BufferType = Buffer;
            type UnionDate = object | Date;
            type UnionSet = object | Set<string>;
            type UnionMap = object | Map<string, number>;
            type UnionRegExp = object | RegExp;
            type UnionBuffer = object | Buffer;
        ` );

        // Act
        const sBare = getDeepSpecificity( types.BareObj, checker );
        const sDate = getDeepSpecificity( types.DateType, checker );
        const sSetStr = getDeepSpecificity( types.SetStr, checker );
        const sSetObj = getDeepSpecificity( types.SetObj, checker );
        const sMapStrNum = getDeepSpecificity( types.MapStrNum, checker );
        const sMapStrObj = getDeepSpecificity( types.MapStrObj, checker );
        const sRegExp = getDeepSpecificity( types.RegExpType, checker );
        const sBuffer = getDeepSpecificity( types.BufferType, checker );

        const sortedDate = sortUnionArmsBySpecificity(( types.UnionDate as ts.UnionType ).types, checker );
        const sortedSet = sortUnionArmsBySpecificity(( types.UnionSet as ts.UnionType ).types, checker );
        const sortedMap = sortUnionArmsBySpecificity(( types.UnionMap as ts.UnionType ).types, checker );
        const sortedRegExp = sortUnionArmsBySpecificity(( types.UnionRegExp as ts.UnionType ).types, checker );
        const sortedBuffer = sortUnionArmsBySpecificity(( types.UnionBuffer as ts.UnionType ).types, checker );

        // Assert
        expect( sBare ).toBe( 5 );
        expect( sDate ).toBeGreaterThan( sBare );
        expect( sSetStr ).toBeGreaterThan( sBare );
        expect( sSetObj ).toBeGreaterThan( sSetStr );
        expect( sMapStrNum ).toBeGreaterThan( sBare );
        expect( sMapStrObj ).toBeGreaterThan( sMapStrNum );
        expect( sRegExp ).toBeGreaterThan( sBare );
        expect( sBuffer ).toBeGreaterThan( sBare );

        expect( sortedDate.map( t => checker.typeToString( t ))).toEqual([ 'Date', 'object' ]);
        expect( sortedSet.map( t => checker.typeToString( t ))).toEqual([ 'Set<string>', 'object' ]);
        expect( sortedMap.map( t => checker.typeToString( t ))).toEqual([ 'Map<string, number>', 'object' ]);
        expect( sortedRegExp.map( t => checker.typeToString( t ))).toEqual([ 'RegExp', 'object' ]);
        expect( sortedBuffer.map( t => checker.typeToString( t ))).toEqual([ 'Buffer<ArrayBufferLike>', 'object' ]);
    });

    it( 'scores native enums, function types, tie-breakers, and deep recursion up to MAX_SPECIFICITY_DEPTH', () =>
    {
        // Arrange
        const { checker, types } = resolveTypesFromCode( `
            enum Role {
                Admin = 'admin',
                User = 'user'
            }
            type FnType = ( x: number ) => string;
            type ObjWithEnum = { role: Role };
            type ObjWithStr = { role: string };
            type ObjWithFn = { cb: FnType };
            type TieA = { a: string };
            type TieB = { b: number };
            type TiedUnion = TieA | TieB;
            type NullishUnion = null | undefined | void;
            type DeepChain = {
                l1: { l2: { l3: { l4: { l5: { l6: { l7: { l8: {
                    l9: { l10: { l11: { l12: { l13: { l14: { l15: { l16: {
                        l17: { l18: string }
                    } } } } } } } }
                } } } } } } } }
            };
        ` );

        // Act
        const sEnumTop = getDeepSpecificity( types.Role, checker );
        const sFnTop = getDeepSpecificity( types.FnType, checker );
        const sObjEnum = getDeepSpecificity( types.ObjWithEnum, checker );
        const sObjStr = getDeepSpecificity( types.ObjWithStr, checker );
        const sObjFn = getDeepSpecificity( types.ObjWithFn, checker );
        const sNullish = getDeepSpecificity( types.NullishUnion, checker );
        const sDeep = getDeepSpecificity( types.DeepChain, checker );
        const sAtMaxDepth = getDeepSpecificity( types.TieA, checker, new Set(), MAX_SPECIFICITY_DEPTH );
        const tiedArms = ( types.TiedUnion as ts.UnionType ).types;
        const sortedTied = sortUnionArmsBySpecificity( tiedArms, checker );
        const sortedTiedReversed = sortUnionArmsBySpecificity([ ...tiedArms ].reverse(), checker );

        // Assert
        expect( sEnumTop ).toBe( 25 );
        expect( sObjEnum ).toBeGreaterThan( sObjStr );
        expect( sFnTop ).toBe( 0 );
        expect( sObjStr ).toBeGreaterThan( sObjFn );
        expect( hasCompetingObjectArms([ types.TieA, types.FnType ], checker )).toBe( false );
        expect( sNullish ).toBe( 0 );
        expect( Number.isFinite( sDeep )).toBe( true );
        expect( sAtMaxDepth ).toBe( 0 );
        expect( sortedTied ).toEqual([ tiedArms[0], tiedArms[1] ]);
        expect( sortedTiedReversed ).toEqual([ tiedArms[1], tiedArms[0] ]);
    });

    it( 'memoizes diamond type graphs per TypeChecker while respecting depth 0 vs nested depth and cycles', () =>
    {
        // Arrange
        const { checker, types } = resolveTypesFromCode( `
            interface SharedLeaf {
                id: string;
                title: string;
                count: number;
            }
            interface BranchA {
                leaf1: SharedLeaf;
                leaf2: SharedLeaf;
            }
            interface BranchB {
                a1: BranchA;
                a2: BranchA;
                directLeaf: SharedLeaf;
            }
        ` );

        // Act
        const topLeaf1 = getDeepSpecificity( types.SharedLeaf, checker );
        const topLeaf2 = getDeepSpecificity( types.SharedLeaf, checker );
        const nestedLeaf = getDeepSpecificity( types.SharedLeaf, checker, new Set(), 1 );
        const diamondScore1 = getDeepSpecificity( types.BranchB, checker );
        const diamondScore2 = getDeepSpecificity( types.BranchB, checker );

        // Assert
        expect( topLeaf1 ).toBe( topLeaf2 );
        expect( topLeaf1 ).toBeGreaterThan( 1000 );
        expect( nestedLeaf ).toBeLessThan( 100 );
        expect( diamondScore1 ).toBe( diamondScore2 );
    });

    it( 'detects competing collection unions (Array, Tuple, Set, Map) and collection fallback arms', () =>
    {
        // Arrange
        const { checker, types } = resolveTypesFromCode( `
            type A = { a: string };
            type B = { a: string; b: number };
            type ArrUnion = A[] | B[];
            type ArrFallback = A[] | object[];
            type TupleUnion = [A, string] | [B, string];
            type TupleFallback = [object, string];
            type SetUnion = Set<A> | Set<B>;
            type SetFallback = Set<object>;
            type MapUnion = Map<string, A> | Map<string, B>;
            type MapFallback = Map<string, object>;
            type PrimArrUnion = string[] | number[];
            type MixedCatUnion = A[] | B;
            type WildcardArrUnion = [A, B];
        ` );

        // Act & Assert
        expect( hasCompetingObjectArms(( types.ArrUnion as ts.UnionType ).types, checker )).toBe( true );
        expect( hasCompetingObjectArms(( types.ArrFallback as ts.UnionType ).types, checker )).toBe( true );
        expect( hasCompetingObjectArms(( types.TupleUnion as ts.UnionType ).types, checker )).toBe( true );
        expect( hasCompetingObjectArms(( types.SetUnion as ts.UnionType ).types, checker )).toBe( true );
        expect( hasCompetingObjectArms(( types.MapUnion as ts.UnionType ).types, checker )).toBe( true );
        expect( hasCompetingObjectArms([ ( types.ArrUnion as ts.UnionType ).types[0], checker.getAnyType() ], checker )).toBe( true );
        expect( hasCompetingObjectArms([ checker.getAnyType(), ( types.ArrUnion as ts.UnionType ).types[0] ], checker )).toBe( true );
        expect( hasCompetingObjectArms(( types.PrimArrUnion as ts.UnionType ).types, checker )).toBe( false );
        expect( hasCompetingObjectArms(( types.MixedCatUnion as ts.UnionType ).types, checker )).toBe( false );

        expect( isFallbackUnionArm(( types.ArrFallback as ts.UnionType ).types[1], checker )).toBe( true );
        expect( isFallbackUnionArm(( types.ArrFallback as ts.UnionType ).types[0], checker )).toBe( false );
        expect( isFallbackUnionArm( types.TupleFallback, checker )).toBe( true );
        expect( isFallbackUnionArm( types.SetFallback, checker )).toBe( true );
        expect( isFallbackUnionArm( types.MapFallback, checker )).toBe( true );
    });

    it( 'detects mutually exclusive required keys across untagged object union arms via tryExclusiveKeyUnion', () =>
    {
        // Arrange
        const { checker, types } = resolveTypesFromCode( `
            import { constraint } from '../src/index.js';
            type Exclusive = { a: string; shared?: number } | { b: number; shared?: number } | { c: boolean };
            type OverlappingOpt = { a: string; b?: number } | { b: number };
            type SubsetArms = { a: string } | { a: string; b: number };
            type WithUndefUnion = { a: string | undefined } | { b: number };
            type WithDefault = { a: string & constraint.Default<'x'> } | { b: number };
            type WithRecord = { a: string } | Record<string, number>;
            type MergedInter = ( { a: string } & { shared: number } ) | ( { b: number } & { shared: number } );
        ` );

        // Act & Assert
        expect( tryExclusiveKeyUnion(( types.Exclusive as ts.UnionType ).types, checker )).toEqual([ 'a', 'b', 'c' ]);
        expect( tryExclusiveKeyUnion(( types.MergedInter as ts.UnionType ).types, checker )).toEqual([ 'a', 'b' ]);
        expect( tryExclusiveKeyUnion(( types.OverlappingOpt as ts.UnionType ).types, checker )).toBeUndefined();
        expect( tryExclusiveKeyUnion(( types.SubsetArms as ts.UnionType ).types, checker )).toBeUndefined();
        expect( tryExclusiveKeyUnion(( types.WithUndefUnion as ts.UnionType ).types, checker )).toBeUndefined();
        expect( tryExclusiveKeyUnion(( types.WithDefault as ts.UnionType ).types, checker )).toBeUndefined();
        expect( tryExclusiveKeyUnion(( types.WithRecord as ts.UnionType ).types, checker )).toBeUndefined();
    });
});
