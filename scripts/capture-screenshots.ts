/**
 * Portfolio screenshot capture script.
 *
 * Creates a temporary party, populates it with demo players via Supabase RPC,
 * advances through all states (filling → active → complete), captures
 * screenshots + GIF frames at each stage, then deletes the test party.
 *
 * Usage:
 *   npx tsx scripts/capture-screenshots.ts
 *
 * Requires the preview server to be running at http://localhost:4173 OR
 * the dev server at http://localhost:5173. Set BASE_URL env var to override.
 * Credentials are read from .env (VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY).
 */

import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { execSync } from 'child_process';

// Load .env then .env.local (local takes precedence, matching Vite's convention)
dotenv.config({ path: path.resolve(import.meta.dirname, '../.env') });
dotenv.config({ path: path.resolve(import.meta.dirname, '../.env.local'), override: true });

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
// Use service key if available, otherwise fall back to anon key (RPCs use PIN auth)
const CLIENT_KEY = process.env.SUPABASE_SERVICE_KEY || ANON_KEY;
const OUT_DIR = path.resolve(import.meta.dirname, '../docs/screenshots');
const FRAMES_DIR = path.join(OUT_DIR, 'raw-frames');
const DEMO_EVENT_NAME = '2027 Championship Squares';
const DEMO_KICKOFF_AT = '2027-02-14T23:30:00.000Z';
const DEMO_ROW_TEAM = { name: 'Ravens', color: '#241773' };
const DEMO_COL_TEAM = { name: 'Lions', color: '#0076B6' };

if (!SUPABASE_URL || !CLIENT_KEY) {
	console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env');
	process.exit(1);
}

const supabase = createClient(SUPABASE_URL, CLIENT_KEY);

// ── Helpers ──────────────────────────────────────────────────────────────────

async function rpc(fn: string, args: Record<string, unknown>) {
	const { data, error } = await supabase.rpc(fn, args);
	if (error) throw new Error(`RPC ${fn} failed: ${error.message}`);
	return data;
}

function ensureDir(dir: string) {
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function wait(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
	ensureDir(OUT_DIR);
	ensureDir(FRAMES_DIR);

	// Remove any stale frames from a previous run
	fs.readdirSync(FRAMES_DIR).forEach((f) => fs.unlinkSync(path.join(FRAMES_DIR, f)));

	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage();
	await page.setViewportSize({ width: 1280, height: 800 });

	let partyId: string | null = null;
	let partyCode: string | null = null;
	const partyPin = '1234';

	try {
		// ── 1. Capture home / landing page ───────────────────────────────────
		console.log('Capturing home page…');
		await page.goto(BASE_URL);
		await page.waitForLoadState('networkidle');
		await wait(800);
		await page.screenshot({ path: path.join(FRAMES_DIR, 'f001-home.png'), fullPage: false });

		// ── 2. Create the demo party via RPC (faster than UI flow) ────────────
		console.log('Creating demo party…');
		const party = await rpc('create_party', {
			p_host_name: 'Screenshot Bot',
			p_pin: partyPin,
			p_square_price: 5,
			p_split_q1: 20,
			p_split_q2: 20,
			p_split_q3: 20,
			p_split_final: 40,
			p_event_name: DEMO_EVENT_NAME,
			p_kickoff_at: DEMO_KICKOFF_AT,
			p_team_row_name: DEMO_ROW_TEAM.name,
			p_team_col_name: DEMO_COL_TEAM.name,
			p_team_row_color: DEMO_ROW_TEAM.color,
			p_team_col_color: DEMO_COL_TEAM.color,
		});
		partyId = party.id as string;
		partyCode = party.code as string;
		console.log(`  Party created: ${partyCode} (${partyId})`);

		// ── 3. Navigate to the party page and screenshot empty grid ──────────
		const partyUrl = `${BASE_URL}/party/${partyCode}`;

		// Seed localStorage + sessionStorage BEFORE the party page loads, otherwise
		// the page reads userName === null and redirects to /join before we can react.
		await page.goto(BASE_URL);
		await page.waitForLoadState('networkidle');
		await page.evaluate(
			([code, pin]) => {
				localStorage.setItem('squares_user_name', 'Alex');
				sessionStorage.setItem(`squares_pin_${code}`, pin);
			},
			[partyCode, partyPin]
		);

		await page.goto(partyUrl);
		await page.waitForLoadState('networkidle');
		await wait(1500);
		await page.screenshot({ path: path.join(FRAMES_DIR, 'f002-empty.png') });

		// ── 4. Claim squares for multiple players ─────────────────────────────
		const players = [
			{
				name: 'Alex',
				cells: Array.from({ length: 15 }, (_, i) => ({ row: Math.floor(i / 5), col: i % 5 })),
			},
			{
				name: 'Jamie',
				cells: Array.from({ length: 12 }, (_, i) => ({
					row: Math.floor(i / 6) + 1,
					col: (i % 6) + 3,
				})),
			},
			{
				name: 'Riley',
				cells: Array.from({ length: 10 }, (_, i) => ({ row: Math.floor(i / 5) + 3, col: i % 5 })),
			},
			{
				name: 'Morgan',
				cells: Array.from({ length: 8 }, (_, i) => ({
					row: 4 + Math.floor(i / 4),
					col: 5 + (i % 4),
				})),
			},
			{
				name: 'Jordan',
				cells: Array.from({ length: 7 }, (_, i) => ({
					row: 6 + Math.floor(i / 4),
					col: 2 + (i % 4),
				})),
			},
			{ name: 'Taylor', cells: Array.from({ length: 6 }, (_, i) => ({ row: 7, col: 4 + i })) },
		];

		console.log('Claiming squares for demo players…');
		for (const player of players) {
			await rpc('claim_squares_batch', {
				p_party_id: partyId,
				p_player_name: player.name,
				p_cells: player.cells,
			});
		}

		// Reload and screenshot the partially filled grid (filling state)
		// Re-inject storage so we stay logged in across reloads
		await page.evaluate(
			([code, pin]) => {
				localStorage.setItem('squares_user_name', 'Alex');
				sessionStorage.setItem(`squares_pin_${code}`, pin);
			},
			[partyCode, partyPin]
		);
		await page.reload();
		await page.waitForLoadState('networkidle');
		await wait(1500);
		console.log('Capturing filling state…');
		await page.screenshot({ path: path.join(OUT_DIR, 'filling.png') });
		await page.screenshot({ path: path.join(FRAMES_DIR, 'f003-filling.png') });

		// ── 5. Fill the rest to 100 so we can lock ────────────────────────────
		console.log('Filling remaining squares…');
		// Collect all claimed cells
		const { data: claimed } = await supabase
			.from('squares')
			.select('row_num, col_num, player_name')
			.eq('party_id', partyId)
			.not('player_name', 'is', null);

		const claimedSet = new Set((claimed ?? []).map((s) => `${s.row_num}-${s.col_num}`));
		const remaining: Array<{ row: number; col: number }> = [];
		for (let r = 0; r < 10; r++) {
			for (let c = 0; c < 10; c++) {
				if (!claimedSet.has(`${r}-${c}`)) {
					remaining.push({ row: r, col: c });
				}
			}
		}

		// Claim remaining squares in a batch under a final player
		if (remaining.length > 0) {
			const chunkSize = 50;
			for (let i = 0; i < remaining.length; i += chunkSize) {
				await rpc('claim_squares_batch', {
					p_party_id: partyId,
					p_player_name: 'Chris',
					p_cells: remaining.slice(i, i + chunkSize),
				});
			}
		}

		// ── 6. Lock party (assigns numbers, moves to active) ─────────────────
		console.log('Locking party (moving to active state)…');
		await rpc('lock_party', { p_party_id: partyId, p_pin: partyPin });

		// Reload and screenshot active state (numbers now assigned)
		await page.evaluate(
			([code, pin]) => {
				localStorage.setItem('squares_user_name', 'Alex');
				sessionStorage.setItem(`squares_pin_${code}`, pin);
			},
			[partyCode, partyPin]
		);
		await page.reload();
		await page.waitForLoadState('networkidle');
		await wait(1500);
		console.log('Capturing active state…');
		await page.screenshot({ path: path.join(OUT_DIR, 'active.png') });
		await page.screenshot({ path: path.join(FRAMES_DIR, 'f004-active.png') });

		// ── 7. Update score to create a winner ────────────────────────────────
		// Look up a claimed square's row/col numbers to manufacture a winning score
		const { data: numbersRow } = await supabase
			.from('numbers')
			.select('row_numbers, col_numbers')
			.eq('party_id', partyId)
			.single();

		const { data: firstClaimedSquare } = await supabase
			.from('squares')
			.select('row_num, col_num, player_name')
			.eq('party_id', partyId)
			.not('player_name', 'is', null)
			.neq('player_name', 'Chris')
			.order('row_num', { ascending: true })
			.order('col_num', { ascending: true })
			.limit(1)
			.single();

		if (numbersRow && firstClaimedSquare) {
			const winRow = firstClaimedSquare.row_num as number;
			const winCol = firstClaimedSquare.col_num as number;
			const rowScore = (numbersRow as { row_numbers: number[]; col_numbers: number[] }).row_numbers[
				winRow
			];
			const colScore = (numbersRow as { row_numbers: number[]; col_numbers: number[] }).col_numbers[
				winCol
			];

			// Score ending in these digits will produce a winner
			const teamRowFinalScore = 10 + rowScore; // e.g. 13 ends in 3
			const teamColFinalScore = 10 + colScore;

			console.log(
				`  Setting Q1 score to ${teamRowFinalScore}-${teamColFinalScore} to create winner for ${firstClaimedSquare.player_name}…`
			);

			await rpc('update_score', {
				p_party_id: partyId,
				p_pin: partyPin,
				p_quarter: 'q1',
				p_row_score: teamRowFinalScore,
				p_col_score: teamColFinalScore,
			});

			await page.evaluate(
				([code, pin]) => {
					localStorage.setItem('squares_user_name', 'Alex');
					sessionStorage.setItem(`squares_pin_${code}`, pin);
				},
				[partyCode, partyPin]
			);
			await page.reload();
			await page.waitForLoadState('networkidle');
			await wait(1500);
			console.log('Capturing complete state (with winner)…');
			await page.screenshot({ path: path.join(OUT_DIR, 'complete.png') });
			await page.screenshot({ path: path.join(FRAMES_DIR, 'f005-complete.png') });
		}

		// ── 8. Capture hero (active state, wider crop) ────────────────────────
		// Go back to active screenshot as the hero — reload active state
		await page.setViewportSize({ width: 1400, height: 700 });
		// Use the active state screenshot again (already saved)
		// Re-capture at hero dimensions
		const { data: activeParty } = await supabase
			.from('parties')
			.select('status')
			.eq('id', partyId)
			.single();
		console.log(
			`  Party status: ${(activeParty as { status: string } | null)?.status ?? 'unknown'}`
		);

		await page.evaluate(
			([code, pin]) => {
				localStorage.setItem('squares_user_name', 'Alex');
				sessionStorage.setItem(`squares_pin_${code}`, pin);
			},
			[partyCode, partyPin]
		);
		await page.goto(partyUrl);
		await page.waitForLoadState('networkidle');
		await wait(1500);
		await page.screenshot({ path: path.join(OUT_DIR, 'hero.png') });
		console.log('Captured hero.png');

		// ── 9. Assemble animated GIF from frames ──────────────────────────────
		console.log('Assembling demo GIF…');
		const frames = fs
			.readdirSync(FRAMES_DIR)
			.filter((f) => f.endsWith('.png'))
			.sort()
			.map((f) => path.join(FRAMES_DIR, f));

		if (frames.length > 0) {
			// Use ffmpeg to build a slideshow GIF (each frame = 1.5 seconds)
			const frameList = path.join(FRAMES_DIR, 'frames.txt');
			const listContent = frames
				.map((f, i) => `file '${f}'\nduration ${i === frames.length - 1 ? 3 : 2}`)
				.join('\n');
			fs.writeFileSync(frameList, listContent);

			const gifOut = path.join(OUT_DIR, 'demo.gif');
			execSync(
				`ffmpeg -y -f concat -safe 0 -i "${frameList}" ` +
					`-vf "fps=4,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer" ` +
					`-loop 0 "${gifOut}"`,
				{ stdio: 'inherit' }
			);

			const sizeKB = Math.round(fs.statSync(gifOut).size / 1024);
			console.log(`  demo.gif: ${sizeKB} KB`);
			if (sizeKB > 2048) {
				console.warn('  ⚠ GIF > 2 MB — re-encoding at lower quality…');
				execSync(
					`ffmpeg -y -f concat -safe 0 -i "${frameList}" ` +
						`-vf "fps=3,scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse=dither=bayer" ` +
						`-loop 0 "${gifOut}"`,
					{ stdio: 'inherit' }
				);
				const newSize = Math.round(fs.statSync(gifOut).size / 1024);
				console.log(`  Re-encoded demo.gif: ${newSize} KB`);
			}
		}

		console.log('\n✓ Screenshots captured:');
		['hero.png', 'filling.png', 'active.png', 'complete.png', 'demo.gif'].forEach((f) => {
			const p = path.join(OUT_DIR, f);
			if (fs.existsSync(p)) {
				const sizeKB = Math.round(fs.statSync(p).size / 1024);
				console.log(`  docs/screenshots/${f}  (${sizeKB} KB)`);
			} else {
				console.log(`  docs/screenshots/${f}  ← MISSING`);
			}
		});
	} finally {
		// ── Cleanup: delete the test party ────────────────────────────────────
		if (partyId) {
			console.log(`\nCleaning up test party ${partyCode}…`);
			const { error: delErr } = await supabase.rpc('delete_party', {
				p_party_id: partyId,
				p_pin: partyPin,
			});
			if (delErr) {
				// Try service-role direct delete as fallback
				await supabase.from('parties').delete().eq('id', partyId);
			}
			console.log('  Party deleted.');
		}
		await browser.close();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
