Write tests for the specified file or function following project conventions.

## Test Infrastructure

### Setup (auto-loaded via `src/tests/setup.ts`)

- `@testing-library/jest-dom/vitest` matchers
- `$app/environment` mocked with `browser: true`
- `$app/navigation` mocked (goto, invalidate, etc.)
- `idb-keyval` mocked (get, set, del, keys)
- `crypto.randomUUID` returns `'test-uuid-1234'`
- `localStorage` and `sessionStorage` mocked with working storage
- `ResizeObserver` mocked

### Exported Mocks (import from `../setup` or `../../setup`)

- `mockSupabaseClient` — mock Supabase client with `.from()`, `.rpc()`, `.channel()`
- `mockSupabaseChannel` — mock channel with `.on()`, `.subscribe()`, `.unsubscribe()`, `.send()`
- `localStorageMock` — mock localStorage
- `sessionStorageMock` — mock sessionStorage

### Supabase Chain Mock Pattern

```ts
const mockChain = {
	select: vi.fn().mockReturnThis(),
	eq: vi.fn().mockReturnThis(),
	order: vi.fn().mockReturnThis(),
	single: vi.fn().mockResolvedValue({ data: mockData, error: null }),
};
mockSupabaseClient.from.mockReturnValueOnce(mockChain);
```

### Optimistic RPC `.then()` Mock Pattern

```ts
mockSupabaseClient.rpc.mockReturnValue({
	then: (cb: Function) => {
		cb({ error: null }); // success
		return { catch: vi.fn() };
	},
});
```

For failure:

```ts
mockSupabaseClient.rpc.mockReturnValue({
	then: (cb: Function) => {
		cb({ error: { message: 'Already claimed' } });
		return { catch: vi.fn() };
	},
});
```

### Factory Functions (define in test file)

- `createMockParty(overrides?)` — returns a full `Party` object
- `createMockSquare(row, col, overrides?)` — returns a `Square`
- `createEmptyGrid()` — returns 100 squares (10x10)

### Conventions

- File naming: `src/tests/<mirror-path>/<FileName>.test.ts`
  - Stores: `src/tests/stores/game.test.ts`
  - Components: `src/tests/components/Square.test.ts`
  - Utils: `src/tests/utils/format.test.ts`
  - Lib: `src/tests/lib/storage.test.ts`
- Always call `cleanup()` in `beforeEach` for game store tests
- Always call `userName.setName()` before testing user-dependent functions
- Use `vi.useFakeTimers()` for timeout tests, restore with `vi.useRealTimers()` in afterEach
- Import from `$lib/...` paths (aliases configured)

$ARGUMENTS
