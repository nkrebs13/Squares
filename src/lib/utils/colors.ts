import { normalizePlayerName } from './playerName';

export interface PlayerColor {
	bg: string;
	text: string;
	/** The text colour at another opacity (borders, outlines, glows). */
	textAt(alpha: number): string;
}

type Rgb = readonly [number, number, number];

/**
 * 15 distinct player colours: [background rgb, text rgb, text opacity].
 * Optimized for WCAG AA contrast (4.5:1+), colorblind accessibility, visual distinction.
 */
const PALETTE: ReadonlyArray<readonly [Rgb, Rgb, number]> = [
	// Primary - widely spaced hues (60°+ apart)
	[[100, 180, 255], [120, 190, 255], 0.95], // Blue (210°)
	[[255, 110, 110], [255, 130, 130], 0.95], // Red (0°)
	[[100, 230, 100], [120, 240, 120], 0.95], // Green (120°)
	[[255, 230, 100], [255, 235, 130], 0.98], // Yellow (50°)
	[[180, 100, 255], [190, 120, 255], 0.95], // Violet (270°)

	// Secondary - fill hue gaps
	[[255, 150, 80], [255, 170, 110], 0.98], // Orange (30°)
	[[100, 230, 230], [120, 240, 240], 0.95], // Cyan (180°)
	[[255, 100, 170], [255, 130, 185], 0.95], // Magenta (330°)
	[[190, 255, 100], [200, 255, 130], 0.98], // Chartreuse (80°)
	[[255, 130, 220], [255, 150, 230], 0.95], // Hot Pink (315°)

	// Tertiary - remaining gaps with distinct saturation/lightness
	[[100, 255, 190], [120, 255, 200], 0.95], // Spring Green (150°)
	[[230, 190, 150], [245, 210, 175], 0.98], // Tan/Bronze (30°)
	[[130, 200, 200], [150, 220, 220], 0.95], // Teal (180°)
	[[200, 160, 255], [210, 175, 255], 0.95], // Lavender (265°)
	[[255, 200, 150], [255, 215, 175], 0.98], // Apricot/Peach (35°)
];

const rgba = ([r, g, b]: Rgb, alpha: number) => `rgba(${r}, ${g}, ${b}, ${alpha})`;

export const PLAYER_COLORS: readonly PlayerColor[] = PALETTE.map(([bg, text, alpha]) => ({
	bg: rgba(bg, 0.22),
	text: rgba(text, alpha),
	textAt: (a: number) => rgba(text, a),
}));

/** A player's colour, keyed by the normalized name so "Ann " and "ann" share one. */
export function getPlayerColor(name: string): PlayerColor {
	name = normalizePlayerName(name);
	let hash = 0;
	for (let i = 0; i < name.length; i++) {
		hash = name.charCodeAt(i) + ((hash << 5) - hash);
	}
	return PLAYER_COLORS[Math.abs(hash) % PLAYER_COLORS.length];
}
