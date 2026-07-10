import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Mock SvelteKit's $app/environment
vi.mock('$app/environment', () => ({
	browser: true,
	dev: true,
	building: false,
	version: 'test',
}));

// Mock SvelteKit's $env/dynamic/public — empty by default so $lib/config falls
// back to its hardcoded brand defaults. Individual tests can override with
// vi.doMock('$env/dynamic/public', ...).
vi.mock('$env/dynamic/public', () => ({
	env: {},
}));

// Mock SvelteKit's $app/navigation
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	invalidate: vi.fn(),
	invalidateAll: vi.fn(),
	preloadData: vi.fn(),
	preloadCode: vi.fn(),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn(),
	onNavigate: vi.fn(),
	disableScrollHandling: vi.fn(),
}));

// Mock idb-keyval
vi.mock('idb-keyval', () => ({
	get: vi.fn().mockResolvedValue(null),
	set: vi.fn().mockResolvedValue(undefined),
	del: vi.fn().mockResolvedValue(undefined),
	keys: vi.fn().mockResolvedValue([]),
}));

// Mock Supabase client
// Capture channel handlers for direct invocation in tests
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
const mockChannelHandlers: Record<string, Function> = {};

// Capture subscribe callbacks for simulating channel status changes
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
let subscribeCallbacks: Function[] = [];

const mockSupabaseChannel = {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
	on: vi.fn((event: string, filter: unknown, callback?: Function) => {
		const cb = callback || (typeof filter === 'function' ? filter : undefined);
		if (typeof cb === 'function') {
			const key =
				typeof filter === 'object' && filter !== null
					? `${event}:${(filter as Record<string, string>).table || (filter as Record<string, string>).event || 'default'}`
					: event;
			mockChannelHandlers[key] = cb;
		}
		return mockSupabaseChannel;
	}),
	// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
	subscribe: vi.fn((callback?: Function) => {
		if (typeof callback === 'function') {
			subscribeCallbacks.push(callback);
		}
		return mockSupabaseChannel;
	}),
	unsubscribe: vi.fn(),
	send: vi.fn(),
};

/**
 * Simulate a channel status change for testing reconnection logic.
 * Call after subscribeToParty() to trigger status handlers.
 *
 * LIMITATION: This broadcasts the status to ALL captured subscribe callbacks.
 * When subscribeToParty creates multiple channels (party, broadcast, game),
 * each channel's callback is triggered simultaneously. This means tests verify
 * system-wide reconnection behavior rather than per-channel isolation.
 *
 * For more granular testing, consider enhancing to allow targeting specific channels.
 */
function simulateChannelStatus(status: 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED') {
	subscribeCallbacks.forEach((cb) => cb(status));
}

/**
 * Simulate a channel status change for a SINGLE captured subscribe callback, by the
 * order it was registered. Channels are created in the order broadcast → party → game,
 * accumulating across successive subscribeToParty() calls. This enables per-channel
 * isolation tests — e.g. delivering the async CLOSED that Supabase fires on an
 * intentionally-unsubscribed channel WITHOUT touching a newer channel's callback.
 */
function simulateChannelStatusAt(
	index: number,
	status: 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'
) {
	subscribeCallbacks[index]?.(status);
}

/** Number of subscribe callbacks captured so far (see simulateChannelStatusAt). */
function subscribeCallbackCount(): number {
	return subscribeCallbacks.length;
}

const mockSupabaseClient = {
	from: vi.fn(() => ({
		select: vi.fn().mockReturnThis(),
		insert: vi.fn().mockReturnThis(),
		update: vi.fn().mockReturnThis(),
		delete: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		order: vi.fn().mockReturnThis(),
		single: vi.fn().mockResolvedValue({ data: null, error: null }),
	})),
	rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
	channel: vi.fn(() => mockSupabaseChannel),
};

vi.mock('$lib/supabase', () => ({
	supabase: mockSupabaseClient,
	getSupabaseClient: vi.fn(() => mockSupabaseClient),
}));

// Shared helper to restore mock defaults after vi.resetAllMocks()
function restoreMockDefaults() {
	// Clear subscribe callbacks
	subscribeCallbacks = [];

	mockSupabaseChannel.on.mockImplementation(
		// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
		(event: string, filter: unknown, callback?: Function) => {
			const cb = callback || (typeof filter === 'function' ? filter : undefined);
			if (typeof cb === 'function') {
				const key =
					typeof filter === 'object' && filter !== null
						? `${event}:${(filter as Record<string, string>).table || (filter as Record<string, string>).event || 'default'}`
						: event;
				mockChannelHandlers[key] = cb;
			}
			return mockSupabaseChannel;
		}
	);
	// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
	mockSupabaseChannel.subscribe.mockImplementation((callback?: Function) => {
		if (typeof callback === 'function') {
			subscribeCallbacks.push(callback);
		}
		return mockSupabaseChannel;
	});

	mockSupabaseClient.from.mockImplementation(() => ({
		select: vi.fn().mockReturnThis(),
		insert: vi.fn().mockReturnThis(),
		update: vi.fn().mockReturnThis(),
		delete: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		order: vi.fn().mockReturnThis(),
		single: vi.fn().mockResolvedValue({ data: null, error: null }),
	}));
	mockSupabaseClient.rpc.mockResolvedValue({ data: null, error: null });
	mockSupabaseClient.channel.mockImplementation(() => mockSupabaseChannel);

	for (const key in mockChannelHandlers) {
		delete mockChannelHandlers[key];
	}
}

// Mock crypto — keep getRandomValues from Node's webcrypto for real randomness in tests,
// but stub randomUUID for consistent client IDs
const realGetRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
vi.stubGlobal('crypto', {
	randomUUID: vi.fn(() => 'test-uuid-1234'),
	getRandomValues: realGetRandomValues,
	subtle: globalThis.crypto.subtle,
});

// Mock localStorage
const localStorageMock = (() => {
	let store: Record<string, string> = {};
	return {
		getItem: vi.fn((key: string) => store[key] ?? null),
		setItem: vi.fn((key: string, value: string) => {
			store[key] = value;
		}),
		removeItem: vi.fn((key: string) => {
			delete store[key];
		}),
		clear: vi.fn(() => {
			store = {};
		}),
		get length() {
			return Object.keys(store).length;
		},
		key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
	};
})();

vi.stubGlobal('localStorage', localStorageMock);

// Mock sessionStorage
const sessionStorageMock = (() => {
	let store: Record<string, string> = {};
	return {
		getItem: vi.fn((key: string) => store[key] ?? null),
		setItem: vi.fn((key: string, value: string) => {
			store[key] = value;
		}),
		removeItem: vi.fn((key: string) => {
			delete store[key];
		}),
		clear: vi.fn(() => {
			store = {};
		}),
		get length() {
			return Object.keys(store).length;
		},
		key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
	};
})();

vi.stubGlobal('sessionStorage', sessionStorageMock);

// Polyfill native <dialog> methods not available in jsdom
HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
	this.setAttribute('open', '');
});
HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
	this.removeAttribute('open');
});

// Mock ResizeObserver
class ResizeObserverMock {
	callback: ResizeObserverCallback;
	constructor(callback: ResizeObserverCallback) {
		this.callback = callback;
	}
	observe() {}
	unobserve() {}
	disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverMock);

// Reset mocks before each test
beforeEach(() => {
	vi.resetAllMocks();
	restoreMockDefaults();
	localStorageMock.clear();
	sessionStorageMock.clear();

	// jsdom does not implement matchMedia. GestureHint reads it for a mobile-layout
	// check and a pointer-type check; default to a mobile-width, non-touch-pointer
	// profile so component/page tests that don't care about breakpoints see the same
	// auto-show behavior they did before that check existed. Tests that need a
	// different breakpoint/pointer profile assign window.matchMedia locally, which
	// takes precedence over this default (and is deleted in their own afterEach, so
	// this default re-applies for the next test via the `typeof !== 'function'` guard).
	if (typeof window.matchMedia !== 'function') {
		window.matchMedia = ((query: string) => ({
			matches: query === '(max-width: 1023px)',
			media: query,
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false,
		})) as typeof window.matchMedia;
	}
});

// Export mocks for use in tests
export {
	mockSupabaseClient,
	mockSupabaseChannel,
	mockChannelHandlers,
	localStorageMock,
	sessionStorageMock,
	simulateChannelStatus,
	simulateChannelStatusAt,
	subscribeCallbackCount,
};
