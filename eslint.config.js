import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

export default ts.config(
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs['flat/recommended'],
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
			},
		},
	},
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parserOptions: {
				parser: ts.parser,
			},
		},
	},
	{
		rules: {
			// Moderate: errors + best practices
			'no-console': 'warn',
			'no-debugger': 'error',
			'no-unused-vars': 'off', // Use TypeScript's version
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
				},
			],
			'@typescript-eslint/no-explicit-any': 'warn',
			'@typescript-eslint/no-non-null-assertion': 'warn',
			'@typescript-eslint/ban-ts-comment': [
				'warn',
				{
					'ts-ignore': 'allow-with-description',
					'ts-expect-error': 'allow-with-description',
				},
			],
			'prefer-const': 'warn',
			'no-var': 'error',
			eqeqeq: ['error', 'smart'],

			// Svelte-specific rules (moderate)
			'svelte/no-navigation-without-resolve': 'off', // Too strict for simple apps
			'svelte/require-each-key': 'warn', // Good practice but not critical
			'svelte/prefer-svelte-reactivity': 'warn', // Svelte 5 specific, warn only
		},
	},
	{
		ignores: ['.svelte-kit/', 'build/', 'dist/', 'node_modules/', '*.config.js', '*.config.ts'],
	}
);
