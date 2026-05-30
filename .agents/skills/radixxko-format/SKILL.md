---
name: radixxko-format
description: Enforces radixxko's strict backend and library formatting rules (Allman braces, padded parens, strict semicolons, etc.) before proceeding with other instructions.
---
# Radixxko Formatting Rules (Backend / Core)

Whenever this skill is triggered, you MUST adopt the following strict formatting rules for all code generation and editing in this conversation. These rules supersede standard Prettier or standard TypeScript conventions.

Read and internalize these rules before executing any further instructions from the user.

## 1. Mandatory Formatting & Syntax Rules

- **Indentation:** Exactly 4 spaces. No tabs.
- **Quotes:** Single quotes (`'`) universally. No trailing commas anywhere (`comma-dangle: never`).
- **Allman Bracing (Block Level):** Opening curly braces `{` for functions, classes, `try`/`catch`, `if`/`else` (when multi-line), and multiline control blocks MUST be on a new line and aligned with the parent block.
- **Allman-Style Arrays & Objects:** When defining multiline Arrays or Objects, the opening bracket `[` or `{` MUST be on a new line, but it MUST vertically align with the declaration (do not indent the bracket). 
  - *Correct:* `const x =\n[\n    1\n];`
  - *Incorrect:* `const x = \n    [\n        1\n    ];`
- **Mandatory Control Braces:** You MUST use curly braces `{}` for ALL `if`, `else`, `for`, and `while` blocks, even if they only contain a single statement. NEVER omit them.
- **Parentheses Padding:** You MUST add spaces immediately inside parentheses for function signatures, calls, and control statements: `( arg1, arg2 )`, `if( condition )`. 
  - *Exceptions:* Do not pad empty logic `()` or primitive/native methods like `.toString('hex')`.
- **Zero Keyword Spacing:** Do NOT put a space between keywords and parentheses: `if(...)`, `for(...)`, `catch(...)`.
- **Empty Line Before Control & Return Statements:** You MUST always put an empty line before an `if`, `for`, `while`, or `return` statement (unless it is the very first statement inside a block).
- **Single-Line Compacting:** If a control block contains only a single, simple statement (like a `return`, `break`, or `continue`), condense it entirely onto a single line.
- **Semicolon Strictness:** Always use semicolons at the end of statements, EXCEPT as the final token inside a single-line block. Example: `if( condition ){ continue }` (no semicolon after `continue`).

## 2. Advanced Type Alignment (Crucial)
When defining Types or Interfaces, you must vertically align the colons. If using Generics with multiple parameters, format the `<...>` wrapper using Allman-style newlines and align the type assignments. Omit trailing commas/semicolons on multiline type definitions.

**DO (Type Alignment Example):**
```typescript
export type MetaData
<
    Meta    extends Record<string, any> = any, 
    Data    extends Record<string, any> = any
>
=
{
    meta    : Meta
    data    : Data
}
```

## 3. The "Master Example" (DO and DON'T)

**DON'T (Standard Prettier Style - AVOID):**
```typescript
export class UserAPI {
    private api: API;
    constructor(api: API) {
        this.api = api;
    }
    async get(id: string) {
        if (!id) {
            return null;
        }
        if (id.length > 0) this.api.fetch(id);
    }
}
```

**DO (Radixxko Style - EXACT MATCH):**
```typescript
export class UserAPI
{
    #api: API; // Prefer hard privacy for internals

    // Notice: Padded parens, Allman brace
    constructor( api: API )
    {
        this.#api = api;
    }

    // Notice: Implicit return type, padded parens, Allman brace
    async get( id: string )
    {
        // Notice: Zero keyword spacing, padded parens, single-line compacting, NO inner semicolon
        if( !id ){ return null }

        // Notice: Mandatory braces even for single statements, short-circuit logic preferred if simple
        id.length > 0 && this.#api.fetch( id );
    }
}
```

## 4. Additional Concept Examples

**Example A: Multi-line Imports**
When imports are long, the `import`, `{ }` block, and `from` clauses must be on separate lines.
```typescript
import 
{ 
    EntityDbID, Optional, Required, 
    OrganizationDbID, OrganizationID 
} 
from '@webergency-sro/base-types';
```

**Example B: Try / Catch Blocks**
Notice the Allman braces, zero keyword spacing before `catch`, and padded parens.
```typescript
try
{
    await this.process( data );
}
catch( e: any )
{
    if( e.code === 11000 ){ throw new DuplicateError() }
    
    throw e;
}
```

**Example C: Iteration and Caching**
Notice the short variables, Map/Set usage, padded parens inside array destructuring `[ key, value ]`, and Allman braces.
```typescript
const cache = new Map<string, Node>();

for( const [ key, value ] of entries )
{
    if( !cache.has( key ))
    {
        cache.set( key, value );
    }
}
```

## 5. Architectural & Logic Paradigms
- **Class-based State:** Use classes for stateful logic and complex structures (using Dependency Injection). Use pure functions for stateless tooling.
- **Hard Privacy:** Use ECMAScript private fields (`#propertyName`) for internal class state.
- **Short-circuit Assignments:** Prefer terse inline logic (`condition && (this.val = x)`) over verbose if-blocks when assigning state or executing simple singles.
- **Data Structures:** Heavily favor `Map` and `Set` over plain objects for caching and mapping.
- **Implicit Types:** Rely on TS inference for simple `async` return types. Enforce strict typing for arguments.

## 6. Strict Naming Conventions
- **Classes, Types, and Interfaces:** Must use `PascalCase` (e.g., `OrganizationModel`, `IAMUserAPI`).
- **Functions and Variables:** Must use strict `camelCase` (e.g., `normalizeID`, `findExtensions`).
- **Constants:** Must use `UPPER_SNAKE_CASE` (e.g., `OBJECT_ID_RE`, `CACHE_TO_WATCHED_RATIO`).
- **Files and Directories:** Use `kebab-case` or `camelCase` for backend modules (`trie.ts`, `cache-heap.ts`).
- **Arguments/Iterators:** Keep argument names descriptive but concise. Use ultra-short, math-like variables for iterators and inner algorithmic logic (`i`, `n`, `ch`, `node`).

---

**Agent Execution Instruction:** 
Now that you have internalized these formatting rules, proceed immediately to execute the rest of the user's instructions while strictly adhering to this style.
