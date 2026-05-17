# Deploying Football Squares

The repo uses [`@sveltejs/adapter-auto`](https://kit.svelte.dev/docs/adapter-auto), which detects the build environment and picks the matching adapter on demand. The same source ships unchanged to Cloudflare Pages, Vercel, and Netlify; you only edit env vars in the platform dashboard. Self-hosted Node deploys are also supported with a one-line `svelte.config.js` override.

## Prerequisites

Before deploying anywhere, you need:

- A [Supabase](https://supabase.com) project with the migrations in `supabase/migrations/` applied (see [README.md](../README.md#database-setup))
- The required environment variables ready to paste into the platform's dashboard

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
   - **Framework preset:** `SvelteKit (v1)` (or leave on `None` — adapter-auto handles it either way)
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

## Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fnkrebs13%2FSquares&env=VITE_SUPABASE_URL,VITE_SUPABASE_ANON_KEY)

### Setup

1. Click the deploy button above (or go to [Vercel](https://vercel.com/new) → **Import Git Repository** → pick your fork).
2. Vercel auto-detects SvelteKit. The build command (`npm run build`), output, and routing are all picked up by adapter-auto — no overrides needed.
3. **Environment variables**: paste `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (and any optional ones) into the project settings. Apply to **Production**, **Preview**, and **Development** as needed.
4. Click **Deploy**.

Preview deploys work the same as Cloudflare Pages — every push to a branch gets its own URL.

## Netlify

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/nkrebs13/Squares)

### Setup

1. Click the deploy button above (or go to [Netlify](https://app.netlify.com/start) → **Add new site** → **Import an existing project** → pick your fork).
2. Build configuration is auto-detected. If Netlify asks:
   - **Build command:** `npm run build`
   - **Publish directory:** `build` (adapter-auto installs `@sveltejs/adapter-netlify` on demand and writes there)
3. **Environment variables**: under **Site configuration → Environment variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (and any optional ones).
4. Trigger a deploy.

Netlify also gives you preview deploys for every PR.

## Self-host (Node)

For VPS / Docker / Fly.io / your own infrastructure, swap adapter-auto for `@sveltejs/adapter-node`:

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
- **Vercel:** [Custom domains](https://vercel.com/docs/projects/domains)
- **Netlify:** [Custom domains](https://docs.netlify.com/domains-https/custom-domains/)

## PWA assets

The PWA manifest is generated at build time from `vite.config.ts` and uses icons in `static/icons/`. To rebrand:

- Replace `static/icons/icon.svg`, `static/icons/icon-192.png`, `static/icons/icon-512.png`, `static/icons/apple-touch-icon.png`, and `static/icons/favicon-{16x16,32x32}.png` with your own assets at the matching dimensions
- Set `PUBLIC_APP_NAME` and `PUBLIC_APP_DESCRIPTION` env vars at build time so the manifest's `name` / `description` reflect your brand

Any tool that outputs the correct PNG dimensions works — ImageMagick, Figma export, or Inkscape are common choices.

## Troubleshooting

**Build succeeds but live site shows a blank page.** Usually missing env vars at build time. Confirm `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set in the platform dashboard _for the Production environment_ (not just Development).

**Realtime updates don't arrive on production.** Check the Supabase project's [Realtime settings](https://supabase.com/dashboard/project/_/database/replication) — the `parties`, `squares`, `numbers`, `scores`, and `winners` tables must have replication enabled. Migration `017_realtime_publication.sql` enables this; if you applied migrations via SQL Editor, verify the publication.

**`adapter-auto` warns "Could not detect a supported production environment"** during local `npm run build`. Expected — adapter-auto only resolves on the supported platforms (CF/Vercel/Netlify/Azure SWA). Local builds produce a no-op output. Use `npm run dev` for local testing, or switch temporarily to `adapter-node` if you need a real local production build.
