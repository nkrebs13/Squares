export const PARTY_CODE_LENGTH = 6;

export function normalizePartyCode(value: string): string {
	return value
		.replace(/[^a-z0-9]/gi, '')
		.toUpperCase()
		.slice(0, PARTY_CODE_LENGTH);
}

export function isCompletePartyCode(value: string): boolean {
	return normalizePartyCode(value).length === PARTY_CODE_LENGTH;
}
