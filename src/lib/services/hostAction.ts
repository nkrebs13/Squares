import { refusalCopy, type HostCopy, type HostRefusal } from '$lib/services/hostCopy';
import { getSupabaseClient } from '$lib/supabase';

type HostResponse =
	({ ok: true } & Record<string, unknown>) | { ok: false; error: HostRefusal; field?: string };

export type HostCallResult =
	{ ok: true; data: Record<string, unknown> } | { ok: false; error: string };

function isHostResponse(data: unknown): data is HostResponse {
	return (
		typeof data === 'object' && data !== null && typeof (data as { ok?: unknown }).ok === 'boolean'
	);
}

/** Call a `host_*` RPC and turn its result into data or user-facing copy. */
export async function callHost(
	rpc: string,
	args: Record<string, unknown>,
	copy: HostCopy
): Promise<HostCallResult> {
	const { data, error } = await getSupabaseClient().rpc(rpc, args);
	if (error || !isHostResponse(data)) return { ok: false, error: copy.failed };
	if (data.ok) return { ok: true, data };
	return { ok: false, error: refusalCopy(data, copy) };
}
