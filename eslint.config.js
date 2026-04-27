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
			// Strict: all rules that were previously warn are now error
			// Combined with --max-warnings 0, this creates a zero-tolerance quality gate
			'no-console': 'error',
			'no-debugger': 'error',
			'no-unused-vars': 'off', // Use TypeScript's version
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
				},
			],
			'@typescript-eslint/no-explicit-any': 'error',
			'@typescript-eslint/no-non-null-assertion': 'error',
			'@typescript-eslint/ban-ts-comment': [
				'error',
				{
					'ts-ignore': 'allow-with-description',
					'ts-expect-error': 'allow-with-description',
				},
			],
			'prefer-const': 'error',
			'no-var': 'error',
			eqeqeq: ['error', 'smart'],

			// Svelte-specific rules
			'svelte/no-navigation-without-resolve': 'off', // Too strict for simple apps
			'svelte/require-each-key': 'error',
			'svelte/prefer-svelte-reactivity': 'error',
		},
	},
	{
		// Service workers, edge functions, and CLI scripts use console as their only logging mechanism
		files: ['static/push-sw.js', 'supabase/functions/**/index.ts', 'scripts/**/*.{js,mjs,ts}'],
		rules: {
			'no-console': 'off',
		},
	},
	{
		ignores: ['.svelte-kit/', 'build/', 'dist/', 'node_modules/', '*.config.js', '*.config.ts'],
	}
);
