import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const CLIENT_OUTPUT_DIR = '.svelte-kit/output/client';
const ROOT_SW_URL_PATTERN = /['"`]\/sw\.js['"`]/;
const ROOT_SCOPE_PATTERN = /scope\s*:\s*['"`]\/['"`]/;
const RELATIVE_SW_URL_PATTERN = /['"`]\.\/sw\.js['"`]/;
const RELATIVE_SCOPE_PATTERN = /scope\s*:\s*['"`]\.\/['"`]/;

async function listJavaScriptFiles(dir) {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
			throw new Error(`build output directory not found: ${dir}. Run npm run build first.`, {
				cause: error,
			});
		}
		throw error;
	}

	const files = await Promise.all(
		entries.map(async (entry) => {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) return listJavaScriptFiles(path);
			if (entry.isFile() && entry.name.endsWith('.js')) return [path];
			return [];
		})
	);
	return files.flat();
}

const jsFiles = await listJavaScriptFiles(CLIENT_OUTPUT_DIR);
const registrationFiles = [];

for (const file of jsFiles) {
	const source = await readFile(file, 'utf8');
	if (source.includes('as registerSW')) {
		registrationFiles.push({ file, source });
	}
}

if (registrationFiles.length !== 1) {
	console.error(
		`Expected exactly one generated PWA registration chunk, found ${registrationFiles.length}.`
	);
	for (const { file } of registrationFiles) {
		console.error(`  - ${file}`);
	}
	process.exit(1);
}

const [{ file, source }] = registrationFiles;
const hasRootServiceWorkerUrl = ROOT_SW_URL_PATTERN.test(source);
const hasRootScope = ROOT_SCOPE_PATTERN.test(source);
const hasRelativeServiceWorkerUrl = RELATIVE_SW_URL_PATTERN.test(source);
const hasRelativeScope = RELATIVE_SCOPE_PATTERN.test(source);

if (!hasRootServiceWorkerUrl || !hasRootScope || hasRelativeServiceWorkerUrl || hasRelativeScope) {
	console.error(`PWA service worker registration is not root-scoped in ${file}.`);
	console.error('Expected generated registration to use /sw.js and scope: /.');
	process.exit(1);
}

console.log(`PWA registration OK: ${file} uses /sw.js with scope /.`);
