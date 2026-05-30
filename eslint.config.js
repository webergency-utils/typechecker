import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';

export default tseslint.config(
    {
        ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/build/**'],
    },
    {
        files: ['src/**/*.ts', 'tests/**/*.ts'],
        extends: [
            js.configs.recommended,
            ...tseslint.configs.recommended,
        ],
        plugins: {
            '@stylistic': stylistic
        },
        rules: {
            // Indentation: 4 spaces strictly
            '@stylistic/indent': ['error', 4],
            'indent': 'off', 

            // Quotes: Single quotes
            '@stylistic/quotes': ['error', 'single', { 'avoidEscape': true }],

            // Allman brace style for multiline, allowing single line compacting
            '@stylistic/brace-style': ['error', 'allman', { 'allowSingleLine': true }],
            
            // Mandatory Braces for all control statements (even single-line)
            'curly': ['error', 'all'],

            // Padding spaces inside parenthesis, except empty
            '@stylistic/space-in-parens': ['error', 'always', { 'exceptions': ['empty'] }],

            // Object literal colon alignment
            '@stylistic/key-spacing': ['error', {
                'align': 'colon',
                'beforeColon': true,
                'afterColon': true
            }],

            // Block spacing: never
            '@stylistic/block-spacing': ['error', 'never'],

            // Commas & Semicolons
            '@stylistic/semi': ['error', 'always', { 'omitLastInOneLineBlock': true }],
            '@stylistic/comma-dangle': ['error', 'never'],

            // Typescript specific property/type alignments
            '@stylistic/member-delimiter-style': ['error', {
                'multiline': {
                    'delimiter': 'none',
                    'requireLast': false
                },
                'singleline': {
                    'delimiter': 'comma',
                    'requireLast': false
                }
            }],

            // Disable standard spacing that might interfere with single-line condensed blocks
            '@stylistic/keyword-spacing': ['error', {
                'overrides': {
                    'if': { 'after': false },
                    'for': { 'after': false },
                    'while': { 'after': false },
                    'catch': { 'after': false }
                }
            }]
        }
    }
);
