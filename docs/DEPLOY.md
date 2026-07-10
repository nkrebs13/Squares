# Deploying Football Squares

The repo uses [`@sveltejs/adapter-cloudflare`](https://kit.svelte.dev/docs/adapter-cloudflare) because Cloudflare Pages is the production target for the live portfolio app. Other hosts are still possible, but they require swapping the SvelteKit adapter so the build output matches the platform.

## Prerequisites

Before deploying anywhere, you need:

- A [Supabase](https://supabase.com) project with the migrations in `supabase/migrations/` applied (see [README.md](../README.md#database-setup))
- The required environment variables ready to paste into the platform's dashboard

### Migration ordering: deploy the client first

Ship the Cloudflare Pages build **before** applying a migration that changes an RPC's
return contract. Clients are PWA-cached, so a browser can keep running an old bundle
for a while after a migration lands.

Migration 033 is the live example: it changed `update_party_details`,
`update_payout_structure`, and `remove_player` to return a NULL sentinel on a
wrong/locked-out PIN instead of raising. A pre-033 bundle reads `remove_player`'s
sentinel as `data || 0` — i.e. `removedCount: 0` — and reports a rejected removal as a
success, clearing the player's squares locally even though the server changed nothing.
(No server data is harmed and the grid self-heals on the next realtime event or reload,
but the host sees a lie.) Deploying the client first means every browser already
understands the sentinel by the time the DB starts returning it.

### Required env vars

| Var                      | Purpose                    |
| ------------------------ | -------------------------- |
| `VITE_SUPABASE_URL`      | Supabase project URL       |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon (public) key |

### Optional env vars

See [`.env.example`](../.env.example) for the full list. The most useful for forks:

| Var                     | Purpose                                                |
| ----------------------- | ------------------------------------------------------ |
| `PUBLIC_SENTRY_DSN`     | Error tracking + Web Vitals (Sentry)                   |
| `VITE_VAPID_PUBLIC_KEY` | Push notifications (with `VAPID_PRIVATE_KEY`)          |
| `PUBLIC_APP_NAME`       | Brand override — see "Customizing your fork" in README |
| `PUBLIC_CURRENCY_CODE`  | Currency override (default `USD`)                      |

`PUBLIC_*` env vars must be set **at build time** (in the platform dashboard before deploying), not at runtime, because SvelteKit's `$env/dynamic/public` is replaced at build.

## Cloudflare Pages

The project's canonical production target. Deploys for free, supports preview deploys per branch, and is what `squares.nathankrebs.com` runs on.

### Setup

1. Go to [Cloudflare Pages](https://dash.cloudflare.com/?to=/:account/pages) → **Create a project** → **Connect to Git** → pick your fork.
2. Build configuration:
   - **Framework preset:** `SvelteKit (v1)` or `None`
   - **Build command:** `npm run build`
   - **Build output directory:** `.svelte-kit/cloudflare`
   - **Root directory:** `/`
3. **Environment variables** (in **Settings → Environment variables**, set both Production and Preview): paste the values from "Required env vars" above. Add any optional vars you need.
4. **Compatibility flags** (in **Settings → Functions**): enable `nodejs_compat` if you hit Supabase realtime errors at runtime. (Most deploys don't need it.)
5. Save and trigger a deploy.

### Preview deploys

Cloudflare Pages auto-creates a preview URL for every branch you push. Useful for testing OSS contributors' PRs before merging.

### CLI alternative

If you prefer the CLI, install [`wrangler`](https://developers.cloudflare.com/workers/wrangler/install-and-update/) and run `npx wrangler pages deploy .svelte-kit/cloudflare`. Env vars are configured via `wrangler pages secret put` or in the dashboard.

## Other hosts

The app is standard SvelteKit, so forks can target other platforms by installing the platform adapter and changing `svelte.config.js`.

- **Vercel:** install `@sveltejs/adapter-vercel`, import it in `svelte.config.js`, then deploy with `npm run build`.
- **Netlify:** install `@sveltejs/adapter-netlify`, import it in `svelte.config.js`, then use Netlify's SvelteKit build settings.
- **Self-hosted Node:** use `@sveltejs/adapter-node` as shown below.

## Self-host (Node)

For VPS / Docker / Fly.io / your own infrastructure, swap the Cloudflare adapter for `@sveltejs/adapter-node`:

```js
// svelte.config.js
import adapter from '@sveltejs/adapter-node';

const config = {
	kit: {
		adapter: adapter(),
		alias: { $lib: './src/lib' },
	},
};

export default config;
```

Then:

```bash
npm install -D @sveltejs/adapter-node
npm run build
node build  # produced by adapter-node
```

Set the env vars (`VITE_SUPABASE_URL`, etc.) in your process manager or `.env` file. The Node server listens on `PORT` (default 3000) and `HOST` (default `0.0.0.0`).

## Custom domain + DNS

Each platform has its own domain configuration UI. The general flow is the same: in the platform dashboard, add your domain and copy the DNS records (usually a CNAME pointing at `<project>.<platform>.app` or similar) into your DNS provider.

- **Cloudflare Pages:** [Custom domains for Pages](https://developers.cloudflare.com/pages/configuration/custom-domains/)

## PWA assets

The PWA manifest is generated at build time from `vite.config.ts` and uses icons in `static/icons/`. To rebrand:

- Replace `static/icons/icon.svg`, `static/icons/icon-192.png`, `static/icons/icon-512.png`, `static/icons/apple-touch-icon.png`, and `static/icons/favicon-{16x16,32x32}.png` with your own assets at the matching dimensions
- Set `PUBLIC_APP_NAME` and `PUBLIC_APP_DESCRIPTION` env vars at build time so the manifest's `name` / `description` reflect your brand

Any tool that outputs the correct PNG dimensions works — ImageMagick, Figma export, or Inkscape are common choices.

## Troubleshooting

**Build succeeds but live site shows a blank page.** Usually missing env vars at build time. Confirm `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set in the platform dashboard _for the Production environment_ (not just Development).

**Realtime updates don't arrive on production.** Check the Supabase project's [Realtime settings](https://supabase.com/dashboard/project/_/database/replication) — the `parties`, `squares`, `numbers`, `scores`, and `winners` tables must have replication enabled. The `ALTER PUBLICATION supabase_realtime ADD TABLE …` statements live in `001_schema.sql`; if you applied migrations via SQL Editor, verify the publication is active in the dashboard.

**Local build emits PWA precache warnings.** The Workbox precache is scoped to SvelteKit client assets. If warnings mention missing `prerendered/` files, verify `vite.config.ts` still uses the explicit `client/**` glob patterns and `modifyURLPrefix` mapping.
