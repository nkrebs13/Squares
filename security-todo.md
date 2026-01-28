# Security TODO

Items identified during security audit (2026-01-28) to address in future iterations.

---

## CRITICAL: Rotate Database Credentials

**File:** `run-migration.mjs:9-15`

**Issue:** Hardcoded database password is exposed in git history.

```javascript
// CURRENT (INSECURE)
const client = new Client({
	host: 'aws-1-us-east-2.pooler.supabase.com',
	password: '0?2d1OnmX2L2', // Exposed!
	ssl: { rejectUnauthorized: false },
});
```

**Action Items:**

1. Rotate the Supabase database password immediately in Supabase Dashboard
2. Update `run-migration.mjs` to use environment variables:
   ```javascript
   const client = new Client({
   	connectionString: process.env.DATABASE_URL,
   	ssl: { rejectUnauthorized: true },
   });
   ```
3. Add `DATABASE_URL` to `.env.example`
4. Consider cleaning git history with `git filter-repo` (optional - credentials should be rotated anyway)

---

## HIGH: SSL Verification Disabled

**File:** `run-migration.mjs:15`

**Issue:** `ssl: { rejectUnauthorized: false }` disables certificate validation, allowing MITM attacks.

**Fix:** Change to `ssl: { rejectUnauthorized: true }` or simply `ssl: true` (Supabase certs are valid).

---

## HIGH: PIN Brute-Forceable

**Issue:** 4-digit PIN = 10,000 combinations. No rate limiting or lockout.

**Possible Fixes:**

1. **Rate limit PIN attempts** - Track failed attempts per party_id, lock after 5 failures
2. **Increase PIN length** - 6 digits = 1M combinations
3. **Add delay on failure** - Exponential backoff in RPC
4. **Use Supabase rate limiting** - Configure in dashboard for RPC endpoints

**Example implementation:**

```sql
-- Add to parties table
ALTER TABLE parties ADD COLUMN pin_attempts INTEGER DEFAULT 0;
ALTER TABLE parties ADD COLUMN pin_locked_until TIMESTAMPTZ;

-- In verify_host_pin function
IF v_party.pin_attempts >= 5 AND v_party.pin_locked_until > NOW() THEN
    RAISE EXCEPTION 'Too many attempts. Try again later.';
END IF;

IF v_party.host_pin != p_pin THEN
    UPDATE parties SET
        pin_attempts = pin_attempts + 1,
        pin_locked_until = NOW() + INTERVAL '5 minutes'
    WHERE id = v_party.id;
    RETURN FALSE;
END IF;

-- Reset on success
UPDATE parties SET pin_attempts = 0, pin_locked_until = NULL WHERE id = v_party.id;
```

---

## HIGH: Client-Side PIN Validation

**Files:** `src/lib/stores/game.ts:945, 1001, 1038`

**Issue:** Functions like `updatePayoutStructure`, `removePlayer`, `deleteParty` validate PIN against client-side state before calling RPC. The PIN is already exposed in frontend state.

**Current pattern:**

```typescript
async function deleteParty(pin: string) {
	const currentParty = get(party);
	if (currentParty?.host_pin !== pin) {
		// Client-side check (bypassable)
		return { success: false };
	}
	// ... call RPC
}
```

**Fix:** Remove client-side PIN validation entirely. Server-side RPC already validates:

```typescript
async function deleteParty(pin: string) {
	const currentParty = get(party);
	if (!currentParty) return { success: false };

	// Let server validate PIN
	const { error } = await supabase.rpc('delete_party', {
		p_party_id: currentParty.id,
		p_pin: pin,
	});
	// ...
}
```

---

## HIGH: Unclaim Bypass

**File:** `supabase/migrations/001_schema.sql:144-177`

**Issue:** Anyone can unclaim a square if they know the player name. No verification that the requester is the original claimer.

**Current logic:**

```sql
-- Only checks if player_name matches, not if requester IS that player
IF v_current_owner IS NULL OR lower(v_current_owner) != lower(p_player_name) THEN
    RETURN FALSE;
END IF;
```

**Possible Fixes:**

1. **Accept it** - In a party context, friends know each other's names anyway
2. **Add session tokens** - Generate a claim token on first claim, require it for unclaim
3. **Host-only unclaim** - Only allow host (with PIN) to unclaim squares

---

## MEDIUM: Batch Claim No Atomicity

**File:** `supabase/migrations/004_batch_claim.sql`

**Issue:** Batch claims process cells in a loop. If one fails mid-way, earlier claims persist while later ones fail silently.

**Current behavior:**

```sql
FOR v_cell IN SELECT * FROM jsonb_array_elements(p_cells) LOOP
    -- Each claim is independent, no rollback on partial failure
END LOOP;
```

**Fix options:**

1. **Wrap in transaction with EXCEPTION handler** - Rollback all on any failure
2. **Return detailed results** - Array of success/failure per cell
3. **Pre-validate all cells** - Check all are available before claiming any

---

## Notes

- Audit performed: 2026-01-28
- Auditor: Claude Code security review
- Priority: Address credential rotation FIRST, then PIN security
