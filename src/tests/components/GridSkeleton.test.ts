import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import GridSkeleton from '$lib/components/GridSkeleton.svelte';

describe('GridSkeleton', () => {
	it('renders the skeleton container', () => {
		const { container } = render(GridSkeleton);
		expect(container.querySelector('.grid-skeleton')).toBeTruthy();
	});

	it('renders 10 skeleton rows', () => {
		const { container } = render(GridSkeleton);
		const rows = container.querySelectorAll('.skeleton-row');
		expect(rows).toHaveLength(10);
	});

	it('renders 100 skeleton squares (10x10)', () => {
		const { container } = render(GridSkeleton);
		const squares = container.querySelectorAll('.skeleton-square');
		expect(squares).toHaveLength(100);
	});

	it('renders column numbers header', () => {
		const { container } = render(GridSkeleton);
		const colNumbers = container.querySelector('.skeleton-col-numbers');
		expect(colNumbers).toBeTruthy();
		// Should have 10 number elements plus the corner
		const numbers = colNumbers?.querySelectorAll('.skeleton-number');
		expect(numbers).toHaveLength(10);
	});

	it('renders skeleton header with badge and text', () => {
		const { container } = render(GridSkeleton);
		expect(container.querySelector('.skeleton-badge')).toBeTruthy();
		expect(container.querySelector('.skeleton-text')).toBeTruthy();
	});

	it('applies animation delay to squares', () => {
		const { container } = render(GridSkeleton);
		const firstSquare = container.querySelector('.skeleton-square');
		expect(firstSquare).toBeTruthy();
		// First square should have animation-delay: 0ms
		expect(firstSquare?.getAttribute('style')).toContain('animation-delay');
	});
});
