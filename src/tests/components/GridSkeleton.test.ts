import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import GridSkeleton from '$lib/components/GridSkeleton.svelte';

describe('GridSkeleton', () => {
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
		// Should have 10 number elements plus the corner
		const numbers = colNumbers?.querySelectorAll('.skeleton-number');
		expect(numbers).toHaveLength(10);
	});

	it('staggers the animation delay by 20ms per square in reading order', () => {
		const { container } = render(GridSkeleton);
		const delays = Array.from(container.querySelectorAll<HTMLElement>('.skeleton-square')).map(
			(el) => el.style.animationDelay
		);
		expect(delays[0]).toBe('0ms');
		expect(delays[1]).toBe('20ms');
		expect(delays[10]).toBe('200ms');
		expect(delays[99]).toBe('1980ms');
	});
});
