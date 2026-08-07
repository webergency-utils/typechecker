/**
 * The phantom property names contributed by the tag types in `runtime/tags`.
 *
 * Membership in this registry — rather than a `__` prefix — decides what counts as a tag, so that
 * user properties such as `__typename` are kept as real data instead of being read as constraints.
 */

/** Tags carrying a value, each of which also accepts a `<key>_message` sibling. */
const VALUE_TAG_NAMES =
[
    'minLength', 'maxLength', 'pattern', 'format',
    'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
    'minItems', 'maxItems', 'uniqueItems',
    'minProperties', 'maxProperties',
    'contains', 'minContains', 'maxContains',
    'propertyNames',
    'custom', 'requires'
] as const;

export type TagName = ( typeof VALUE_TAG_NAMES )[number];

const TRANSFORM_TAG_KEYS =
[
    '__transform_lowercase',
    '__transform_uppercase',
    '__transform_trim',
    '__transform_capitalize',
    '__transform_tonumber',
    '__transform_toboolean',
    '__transform_todate',
    '__transform_custom'
];

export function tagKey( name: TagName ): string
{
    return `__${name}`;
}

export const TAG_KEYS: ReadonlySet<string> = new Set([
    ...VALUE_TAG_NAMES.map( name => tagKey( name )),
    ...VALUE_TAG_NAMES.map( name => `${tagKey( name )}_message` ),
    ...TRANSFORM_TAG_KEYS,
    '__default',
    '__message'
]);

export function isTagKey( name: string ): boolean
{
    return TAG_KEYS.has( name );
}
