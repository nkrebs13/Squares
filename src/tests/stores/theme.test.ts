import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { theme } from '$lib/stores/theme';

describe('theme store', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('initializes with default team values', () => {
		const value = get(theme);
		expect(value.rowName).toBe('Seahawks');
		expect(value.colName).toBe('Patriots');
		expect(value.rowColor).toBe('#69BE28');
		expect(value.colColor).toBe('#C60C30');
	});

	it('setTeams updates store values', () => {
		theme.setTeams({
			rowColor: '#004C54',
			colColor: '#E31837',
			rowName: 'Eagles',
			colName: 'Chiefs',
		});

		const value = get(theme);
		expect(value.rowName).toBe('Eagles');
		expect(value.colName).toBe('Chiefs');
		expect(value.rowColor).toBe('#004C54');
		expect(value.colColor).toBe('#E31837');
	});

	it('setTeams sets CSS custom properties', () => {
		const spy = vi.spyOn(document.documentElement.style, 'setProperty');

		theme.setTeams({
			rowColor: '#004C54',
			colColor: '#E31837',
			rowName: 'Eagles',
			colName: 'Chiefs',
		});

		expect(spy).toHaveBeenCalledWith('--team-row-color', '#004C54');
		expect(spy).toHaveBeenCalledWith('--team-col-color', '#E31837');
	});
});
