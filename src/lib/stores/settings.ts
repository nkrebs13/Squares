import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export type GridMode = 'panzoom' | 'scroll';

// Load from localStorage if available
const storedGridMode = browser ? localStorage.getItem('gridMode') as GridMode : null;

export const gridMode = writable<GridMode>(storedGridMode || 'panzoom');

// Persist changes to localStorage
if (browser) {
	gridMode.subscribe((value) => {
		localStorage.setItem('gridMode', value);
	});
}
