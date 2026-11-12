import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/svelte';
import PageMeta from '$lib/components/PageMeta.svelte';
import { APP_CONFIG } from '$lib/config';

function metas(selector: string): Element[] {
	return Array.from(document.head.querySelectorAll(selector));
}

describe('PageMeta', () => {
	afterEach(() => {
		document.head.innerHTML = '';
	});

	it('emits each title and share tag exactly once with the given text', () => {
		render(PageMeta, {
			props: { title: 'Party title', description: 'Party text', url: 'https://x.test/party/A' },
		});

		expect(document.title).toBe('Party title');
		for (const sel of [
			'meta[name="description"]',
			'meta[property="og:title"]',
			'meta[property="og:description"]',
			'meta[property="og:url"]',
			'meta[name="twitter:title"]',
			'meta[name="twitter:description"]',
			'link[rel="canonical"]',
		]) {
			expect(metas(sel), sel).toHaveLength(1);
		}
		expect(metas('meta[property="og:title"]')[0]).toHaveAttribute('content', 'Party title');
		expect(metas('meta[property="og:url"]')[0]).toHaveAttribute(
			'content',
			'https://x.test/party/A'
		);
	});

	it('uses the app name and description by default, with no url tags', () => {
		render(PageMeta);

		expect(metas('meta[property="og:title"]')[0]).toHaveAttribute('content', APP_CONFIG.appName);
		expect(metas('meta[name="description"]')[0]).toHaveAttribute(
			'content',
			APP_CONFIG.appDescription
		);
		expect(metas('meta[property="og:url"]')).toHaveLength(0);
		expect(metas('link[rel="canonical"]')).toHaveLength(0);
	});

	it('shareTitle overrides the tab title for og/twitter only', () => {
		render(PageMeta, { props: { title: 'Tab | Eyebrow', shareTitle: 'Tab' } });

		expect(document.title).toBe('Tab | Eyebrow');
		expect(metas('meta[name="twitter:title"]')[0]).toHaveAttribute('content', 'Tab');
	});
});
