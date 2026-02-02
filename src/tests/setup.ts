import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Mock SvelteKit's $app/environment
vi.mock('$app/environment', () => ({
	browser: true,
	dev: true,
	building: false,
	version: 'test',
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
	subscribe: vi.fn().mockReturnThis(),
	unsubscribe: vi.fn(),
	send: vi.fn(),
};

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
	mockSupabaseChannel.subscribe.mockReturnThis();

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

// Mock crypto.randomUUID for consistent client IDs
vi.stubGlobal(
	'crypto',
	Object.assign({}, crypto, {
		randomUUID: vi.fn(() => 'test-uuid-1234'),
	})
);

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
});

// Export mocks for use in tests
export {
	mockSupabaseClient,
	mockSupabaseChannel,
	mockChannelHandlers,
	localStorageMock,
	sessionStorageMock,
};
