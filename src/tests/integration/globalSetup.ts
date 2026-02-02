import { ensureSupabaseReady, cleanupAllTestParties } from './helpers';

export async function setup() {
	await ensureSupabaseReady();
	await cleanupAllTestParties();
}

export async function teardown() {
	await cleanupAllTestParties();
}
