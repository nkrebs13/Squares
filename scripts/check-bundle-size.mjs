#!/usr/bin/env node
/**
 * Bundle-size budget gate.
 *
 * Reads .svelte-kit/output/client/_app/immutable/chunks/ after `npm run build`
 * and asserts:
 *   1. No individual JS chunk exceeds MAX_CHUNK_BYTES.
 *   2. Total client JS does not exceed MAX_TOTAL_BYTES.
 *
 * Prints a numeric report regardless of pass/fail so the CI log shows the
 * current size vs the cap. Exit code 1 on violation.
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CHUNKS_DIR = '.svelte-kit/output/client/_app/immutable/chunks';
const NODES_DIR = '.svelte-kit/output/client/_app/immutable/nodes';
const ENTRY_DIR = '.svelte-kit/output/client/_app/immutable/entry';

const MAX_CHUNK_BYTES = 500 * 1024; // 500 KB per chunk
const MAX_TOTAL_BYTES = 1024 * 1024; // 1 MB total client JS

function listJsFiles(dir) {
	let entries;
	try {
		entries = readdirSync(dir);
	} catch (err) {
		if (err.code === 'ENOENT') return [];
		throw err;
	}
	return entries
		.filter((f) => f.endsWith('.js'))
		.map((f) => ({ path: join(dir, f), size: statSync(join(dir, f)).size }));
}

const files = [...listJsFiles(CHUNKS_DIR), ...listJsFiles(NODES_DIR), ...listJsFiles(ENTRY_DIR)];

if (files.length === 0) {
	console.error(
		'check-bundle-size: no JS files found under .svelte-kit/output/client/. Did `npm run build` succeed?'
	);
	process.exit(1);
}

const total = files.reduce((sum, f) => sum + f.size, 0);
const oversize = files.filter((f) => f.size > MAX_CHUNK_BYTES);

const fmt = (b) => `${(b / 1024).toFixed(1)} KB`;

console.log(`Bundle size report:`);
console.log(`  ${files.length} JS file(s) scanned`);
console.log(`  Total: ${fmt(total)} (cap ${fmt(MAX_TOTAL_BYTES)})`);
const top = [...files].sort((a, b) => b.size - a.size).slice(0, 5);
console.log(`  Top chunks:`);
for (const f of top) {
	console.log(`    - ${f.path}: ${fmt(f.size)}`);
}

let failed = false;
if (oversize.length > 0) {
	failed = true;
	console.error(`\nFAIL: ${oversize.length} chunk(s) exceed ${fmt(MAX_CHUNK_BYTES)}:`);
	for (const f of oversize) console.error(`  - ${f.path}: ${fmt(f.size)}`);
}
if (total > MAX_TOTAL_BYTES) {
	failed = true;
	console.error(`\nFAIL: total ${fmt(total)} exceeds cap ${fmt(MAX_TOTAL_BYTES)}.`);
}

if (failed) process.exit(1);
console.log(`\nOK: bundle size is within budget.`);
