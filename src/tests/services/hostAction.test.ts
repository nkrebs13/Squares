import { describe, it, expect } from 'vitest';
import { callHost } from '$lib/services/hostAction';
import {
	DB_MAX_TEAM_NAME_LENGTH,
	MAX_EVENT_NAME_LENGTH,
	MIN_SQUARE_PRICE,
	PIN_LENGTH,
} from '$lib/constants';
import { mockSupabaseClient } from '../setup';

async function refusedField(field: string): Promise<string> {
	mockSupabaseClient.rpc.mockResolvedValueOnce({
		data: { ok: false, error: 'invalid_input', field },
		error: null,
	});
	const result = await callHost('host_create_party', {}, { failed: 'failed' });
	if (result.ok) throw new Error('expected a refusal');
	return result.error;
}

describe('callHost invalid_input copy', () => {
	it('states the limits constants.ts defines', async () => {
		expect(await refusedField('pin')).toBe(`PIN must be exactly ${PIN_LENGTH} digits.`);
		expect(await refusedField('event_name')).toBe(
			`Event name must be 1–${MAX_EVENT_NAME_LENGTH} characters.`
		);
		expect(await refusedField('team_name')).toBe(
			`Team names must be 1–${DB_MAX_TEAM_NAME_LENGTH} characters.`
		);
		expect(await refusedField('square_price')).toBe(
			`Square price must be at least ${MIN_SQUARE_PRICE} and under 100,000,000.`
		);
	});
});
