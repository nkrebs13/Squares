import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('APP_CONFIG', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it('falls back to Football Squares defaults when no env vars are set', async () => {
		vi.doMock('$env/dynamic/public', () => ({ env: {} }));
		const { APP_CONFIG } = await import('$lib/config');

		expect(APP_CONFIG.appName).toBe('Football Squares');
		expect(APP_CONFIG.appTagline).toBe('Super Bowl party pools made easy');
		expect(APP_CONFIG.appDescription).toContain('Super Bowl');
		expect(APP_CONFIG.defaultTeams.row.name).toBe('Seahawks');
		expect(APP_CONFIG.defaultTeams.row.color).toBe('#69BE28');
		expect(APP_CONFIG.defaultTeams.col.name).toBe('Patriots');
		expect(APP_CONFIG.defaultTeams.col.color).toBe('#C60C30');
		expect(APP_CONFIG.currency.code).toBe('USD');
		expect(APP_CONFIG.currency.locale).toBe('en-US');
	});

	it('honors PUBLIC_* env overrides for every brand value', async () => {
		vi.doMock('$env/dynamic/public', () => ({
			env: {
				PUBLIC_APP_NAME: 'Demo Squares',
				PUBLIC_APP_TAGLINE: 'A different tagline',
				PUBLIC_APP_DESCRIPTION: 'A different description',
				PUBLIC_DEFAULT_TEAM_ROW_NAME: 'Lakers',
				PUBLIC_DEFAULT_TEAM_ROW_COLOR: '#552583',
				PUBLIC_DEFAULT_TEAM_COL_NAME: 'Celtics',
				PUBLIC_DEFAULT_TEAM_COL_COLOR: '#007A33',
				PUBLIC_CURRENCY_CODE: 'EUR',
				PUBLIC_LOCALE: 'de-DE',
			},
		}));
		const { APP_CONFIG } = await import('$lib/config');

		expect(APP_CONFIG.appName).toBe('Demo Squares');
		expect(APP_CONFIG.appTagline).toBe('A different tagline');
		expect(APP_CONFIG.appDescription).toBe('A different description');
		expect(APP_CONFIG.defaultTeams.row.name).toBe('Lakers');
		expect(APP_CONFIG.defaultTeams.row.color).toBe('#552583');
		expect(APP_CONFIG.defaultTeams.col.name).toBe('Celtics');
		expect(APP_CONFIG.defaultTeams.col.color).toBe('#007A33');
		expect(APP_CONFIG.currency.code).toBe('EUR');
		expect(APP_CONFIG.currency.locale).toBe('de-DE');
	});

	it('treats empty-string env values as falsy and falls back to defaults', async () => {
		vi.doMock('$env/dynamic/public', () => ({
			env: { PUBLIC_APP_NAME: '', PUBLIC_CURRENCY_CODE: '' },
		}));
		const { APP_CONFIG } = await import('$lib/config');

		expect(APP_CONFIG.appName).toBe('Football Squares');
		expect(APP_CONFIG.currency.code).toBe('USD');
	});

	it('exports DEFAULT_TEAMS aliasing APP_CONFIG.defaultTeams', async () => {
		vi.doMock('$env/dynamic/public', () => ({ env: {} }));
		const { DEFAULT_TEAMS, APP_CONFIG } = await import('$lib/config');

		expect(DEFAULT_TEAMS.row.name).toBe(APP_CONFIG.defaultTeams.row.name);
		expect(DEFAULT_TEAMS.col.name).toBe(APP_CONFIG.defaultTeams.col.name);
	});
});
