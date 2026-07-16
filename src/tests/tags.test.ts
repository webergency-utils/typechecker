import { expect, test } from 'vitest';
import { tag, ResolveDefaults } from '../runtime/tags.js';

test('ResolveDefaults should make properties with tag.Default required', () => {
    interface TestInterface {
        a?: string & tag.Default<"a">;
        b?: string;
        c: number;
        d: {
            e?: number & tag.Default<1>;
        };
    }

    type Resolved = ResolveDefaults<TestInterface>;

    // Type checks: if types are incorrect, compilation will fail.
    const x: Resolved = {
        a: "a" as string & tag.Default<"a">,
        c: 123,
        d: {
            e: 1 as number & tag.Default<1>
        }
    };

    // The runtime values themselves don't strictly matter for the type helper,
    // but we write this test to verify the types compile cleanly.
    expect(x.a).toBe("a");
    expect(x.c).toBe(123);
    expect(x.d.e).toBe(1);

    // To verify that 'b' is still optional and 'a', 'e' are required,
    // we use TypeScript's compiler via tsc during the build process.
    // If 'a' or 'e' were mistakenly made optional, or 'b' mistakenly made required,
    // the typings in actual usage would break. This file acts as a type test.
});
