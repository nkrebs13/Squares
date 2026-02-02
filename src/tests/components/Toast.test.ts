import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Toast from '$lib/components/Toast.svelte';

describe('Toast Component', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('Rendering', () => {
		it('renders the toast message', () => {
			render(Toast, { props: { message: 'Hello world' } });
			expect(screen.getByText('Hello world')).toBeInTheDocument();
		});

		it('renders with info type by default', () => {
			render(Toast, { props: { message: 'Info message' } });
			const toast = document.querySelector('.toast');
			expect(toast).toHaveClass('toast-info');
		});

		it('renders with success type', () => {
			render(Toast, { props: { message: 'Success!', type: 'success' } });
			const toast = document.querySelector('.toast');
			expect(toast).toHaveClass('toast-success');
		});

		it('renders with error type', () => {
			render(Toast, { props: { message: 'Error!', type: 'error' } });
			const toast = document.querySelector('.toast');
			expect(toast).toHaveClass('toast-error');
		});
	});

	describe('Icons', () => {
		it('renders checkmark icon for success type', () => {
			render(Toast, { props: { message: 'OK', type: 'success' } });
			const icon = document.querySelector('.toast-icon svg');
			expect(icon).toBeInTheDocument();
			// Success uses polyline with checkmark points
			const polyline = icon?.querySelector('polyline');
			expect(polyline).toBeInTheDocument();
		});

		it('renders X icon for error type', () => {
			render(Toast, { props: { message: 'Fail', type: 'error' } });
			const icon = document.querySelector('.toast-icon svg');
			expect(icon).toBeInTheDocument();
			// Error uses circle + two crossing lines
			const circle = icon?.querySelector('circle');
			expect(circle).toBeInTheDocument();
		});

		it('renders info icon for info type', () => {
			render(Toast, { props: { message: 'Info', type: 'info' } });
			const icon = document.querySelector('.toast-icon svg');
			expect(icon).toBeInTheDocument();
			const circle = icon?.querySelector('circle');
			expect(circle).toBeInTheDocument();
		});
	});

	describe('Auto-dismiss', () => {
		it('becomes invisible after duration', async () => {
			render(Toast, { props: { message: 'Bye', duration: 3000 } });
			expect(document.querySelector('.toast')).toBeInTheDocument();

			vi.advanceTimersByTime(3000);
			await vi.runAllTimersAsync();

			// After duration, visible is set to false and the toast is removed from DOM
			expect(document.querySelector('.toast')).not.toBeInTheDocument();
		});

		it('calls onclose after duration plus animation delay', async () => {
			const onclose = vi.fn();
			render(Toast, { props: { message: 'Bye', duration: 2000, onclose } });

			vi.advanceTimersByTime(2000);
			await vi.runAllTimersAsync();

			// onclose is called after an additional 300ms animation delay
			vi.advanceTimersByTime(300);
			await vi.runAllTimersAsync();

			expect(onclose).toHaveBeenCalledTimes(1);
		});

		it('uses default duration of 3000ms', async () => {
			render(Toast, { props: { message: 'Default' } });
			expect(document.querySelector('.toast')).toBeInTheDocument();

			vi.advanceTimersByTime(2999);
			expect(document.querySelector('.toast')).toBeInTheDocument();

			vi.advanceTimersByTime(1);
			await vi.runAllTimersAsync();

			expect(document.querySelector('.toast')).not.toBeInTheDocument();
		});
	});
});
