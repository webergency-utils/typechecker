# Typia vs. Our AOT Validation Engine

This document compares the capabilities of [Typia](https://typia.io/) with our current AOT validation engine implementation.

## Overview

| Feature | Typia | Our Implementation | Status |
| :--- | :--- | :--- | :--- |
| **Validation Method** | AOT (Transformer) | AOT (Transformer) | ✅ Same approach |
| **Performance** | Extremely Fast | Extremely Fast | ✅ Same approach |
| **Public API** | `is`, `assert`, `validate` | Generated internal validators | ⚠️ Needs public API |
| **Validation Tags** | Comprehensive | Core + Common | ⚠️ Expanding |
| **JSON Serialization** | Optimized `stringify` | Standard `JSON.stringify` | ❌ Missing |
| **Protobuf Support** | Full | None | ❌ Missing |
| **Random Gen** | `random<T>` | None | ❌ Missing |
| **LLM Support** | Tool Calls / Structured Output | None | ❌ Missing |

---

## 1. Validation Tags Parity

### Numeric Tags
| Tag | Typia | Us | Note |
| :--- | :---: | :---: | :--- |
| `Minimum<N>` | ✅ | ✅ | |
| `Maximum<N>` | ✅ | ✅ | |
| `ExclusiveMinimum<N>` | ✅ | ✅ | |
| `ExclusiveMaximum<N>` | ✅ | ✅ | |
| `MultipleOf<N>` | ✅ | ✅ | |
| `Type<"int32" | ...>` | ✅ | ❌ | Can be implemented via custom tags |

### String Tags
| Tag | Typia | Us | Note |
| :--- | :---: | :---: | :--- |
| `MinLength<N>` | ✅ | ✅ | |
| `MaxLength<N>` | ✅ | ✅ | |
| `Pattern<R>` | ✅ | ✅ | |
| `ContentMediaType` | ✅ | ❌ | |

#### String Format Details
| Format Identifier | Typia | Us | Note |
| :--- | :---: | :---: | :--- |
| `byte` | ✅ | ✅ | Base64 encoded string |
| `password` | ✅ | ✅ | |
| `regex` | ✅ | ✅ | Valid JS RegExp |
| `uuid` | ✅ | ✅ | |
| `email` | ✅ | ✅ | |
| `hostname` | ✅ | ✅ | |
| `idn-email` | ✅ | ❌ | |
| `idn-hostname` | ✅ | ❌ | |
| `iri` | ✅ | ❌ | |
| `iri-reference` | ✅ | ❌ | |
| `ipv4` | ✅ | ✅ | |
| `ipv6` | ✅ | ✅ | |
| `uri` | ✅ | ✅ | |
| `uri-reference` | ✅ | ❌ | |
| `uri-template` | ✅ | ❌ | |
| `url` | ✅ | ✅ | |
| `date-time` | ✅ | ✅ | ISO 8601 |
| `date` | ✅ | ✅ | ISO 8601 |
| `time` | ✅ | ✅ | |
| `duration` | ✅ | ✅ | ISO 8601 |

### Array Tags
| Tag | Typia | Us | Note |
| :--- | :---: | :---: | :--- |
| `MinItems<N>` | ✅ | ✅ | |
| `MaxItems<N>` | ✅ | ✅ | |
| `UniqueItems` | ✅ | ✅ | Set-based deep-uniqueness check |

---

## 2. Missing Key Features

### Public Validation API
Typia provides a clean public API for any TypeScript code:
- `typia.is<T>(input)`: Returns `boolean`.
- `typia.assert<T>(input)`: Throws `TypeGuardError`.
- `typia.validate<T>(input)`: Returns `IValidationResult`.

**Gap:** Our validators are currently generated and used internally by the server's `MetadataStore`. We could expose a similar API for manual use.

### Optimized JSON Serialization
Typia's `stringify<T>` is up to 10x faster than `JSON.stringify` because it generates a specialized string builder for every type, avoiding runtime reflection and generic object traversal.

### Random Data Generation
Typia's `random<T>()` generates mock data that strictly follows all types and tags. This is incredibly useful for testing.

### Protocol Buffer (Protobuf)
Typia can generate `.proto` schemas and high-performance binary encoders/decoders directly from TypeScript interfaces.

### LLM / AI Support
- **`application<T>`**: Generates JSON Schemas specialized for LLM Tool Calls (Function Calling).
- **Structured Output**: Specialized extraction utilities for LLM responses.

---

## 3. Roadmap for Parity

1. **Phase 1: API Parity** - Expose `is<T>`, `assert<T>`, and `validate<T>` for general use.
2. **Phase 2: Tag Expansion** - Add `UniqueItems`, `Type<int32>`, and more `Format` types.
3. **Phase 3: Strict Mode** - Implement `equals<T>` to reject extra properties.
4. **Phase 4: Serialization** - Research optimized `stringify` generation.
