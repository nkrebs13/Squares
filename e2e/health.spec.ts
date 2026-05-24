import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { DEFAULT_APP_NAME } from '../src/lib/app-defaults';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };
const expectedAppName = process.env.PUBLIC_APP_NAME || DEFAULT_APP_NAME;

test('health endpoint reports non-secret app status', async ({ request }) => {
	const response = await request.get('/health');
	expect(response.ok()).toBe(true);

	const body = await response.json();
	expect(body).toMatchObject({
		ok: true,
		app: expectedAppName,
		version: pkg.version,
	});
	expect(typeof body.supabaseConfigured).toBe('boolean');
});
