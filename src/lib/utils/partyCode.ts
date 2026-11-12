export const PARTY_CODE_LENGTH = 6;

/** Input maxlength: twice the code, so a pasted code with separators fits before normalizePartyCode strips them. */
export const PARTY_CODE_INPUT_MAX_LENGTH = PARTY_CODE_LENGTH * 2;

export function normalizePartyCode(value: string): string {
	return value
		.replace(/[^a-z0-9]/gi, '')
		.toUpperCase()
		.slice(0, PARTY_CODE_LENGTH);
}

export function isCompletePartyCode(value: string): boolean {
	return normalizePartyCode(value).length === PARTY_CODE_LENGTH;
}

/** The join page for a party code. */
export function joinPath(code: string): string {
	return `/join?code=${encodeURIComponent(code)}`;
}
