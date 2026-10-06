import { describe, it, expect } from 'vitest';
import { APP_CONFIG } from '$lib/config';
import { MAX_NICKNAME_LENGTH } from '$lib/constants';
import { getDetailLine, getDisplayName, getStatusBadge } from '$lib/utils/recentParties';
import { createMockRecentParty } from '../factories';

describe('getStatusBadge', () => {
	it.each([
		['filling', 'Filling', 'badge-filling'],
		['locked', 'Locked', 'badge-locked'],
		['active', 'Live', 'badge-active'],
		['complete', 'Done', 'badge-complete'],
	] as const)('maps %s', (status, text, cls) => {
		expect(getStatusBadge(status)).toEqual({ text, class: cls });
	});

	it('passes unknown statuses through with no class', () => {
		expect(getStatusBadge('mystery' as never)).toEqual({ text: 'mystery', class: '' });
	});
});

describe('getDisplayName', () => {
	it('prefers the nickname', () => {
		expect(getDisplayName(createMockRecentParty({ nickname: 'Office', eventName: 'X' }))).toBe(
			'Office'
		);
	});

	it('falls back to a specific event name', () => {
		expect(getDisplayName(createMockRecentParty({ eventName: ' Big Game ' }))).toBe('Big Game');
	});

	it('falls back to the matchup for default, matchup, or empty event names', () => {
		const matchup = 'Seahawks vs Patriots';
		expect(getDisplayName(createMockRecentParty())).toBe(matchup);
		expect(getDisplayName(createMockRecentParty({ eventName: '   ' }))).toBe(matchup);
		expect(getDisplayName(createMockRecentParty({ eventName: matchup }))).toBe(matchup);
		expect(getDisplayName(createMockRecentParty({ eventName: APP_CONFIG.defaultEventName }))).toBe(
			matchup
		);
	});
});

describe('getDetailLine', () => {
	const KICKOFF = '2027-02-14T23:30:00Z';

	it('is empty with no nickname, event name, or kickoff', () => {
		expect(getDetailLine(createMockRecentParty())).toBe('');
	});

	it('is only the kickoff when there is no nickname and no specific event name', () => {
		const line = getDetailLine(createMockRecentParty({ kickoffAt: KICKOFF }));
		expect(line).not.toContain('Seahawks');
		expect(line).not.toBe('');
	});

	it('does not repeat the event name when it is already the display name', () => {
		const line = getDetailLine(
			createMockRecentParty({ eventName: 'Big Game', kickoffAt: KICKOFF })
		);
		expect(line).not.toContain('Big Game');
		expect(line.startsWith('Seahawks vs Patriots - ')).toBe(true);
	});

	it('shows the matchup under a nickname', () => {
		expect(getDetailLine(createMockRecentParty({ nickname: 'Office' }))).toBe(
			'Seahawks vs Patriots'
		);
	});

	it('adds the specific event name when it differs from the nickname', () => {
		expect(
			getDetailLine(createMockRecentParty({ nickname: 'Office', eventName: 'Big Game' }))
		).toBe('Big Game - Seahawks vs Patriots');
	});

	it('omits the event name when it matches the nickname case-insensitively', () => {
		expect(
			getDetailLine(createMockRecentParty({ nickname: ' big game', eventName: 'Big Game' }))
		).toBe('Seahawks vs Patriots');
	});

	it('appends the kickoff when present', () => {
		const line = getDetailLine(createMockRecentParty({ nickname: 'Office', kickoffAt: KICKOFF }));
		expect(line.startsWith('Seahawks vs Patriots - ')).toBe(true);
	});
});

describe('MAX_NICKNAME_LENGTH', () => {
	it('is 30', () => {
		expect(MAX_NICKNAME_LENGTH).toBe(30);
	});
});
