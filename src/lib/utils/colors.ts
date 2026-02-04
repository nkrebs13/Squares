export interface PlayerColor {
	bg: string;
	text: string;
}

/**
 * Predefined color palette for 15 distinct players.
 * Optimized for: WCAG AA contrast (4.5:1+), colorblind accessibility, visual distinction.
 */
export const PLAYER_COLORS: readonly PlayerColor[] = [
	// Primary - widely spaced hues (60°+ apart)
	{ bg: 'rgba(100, 180, 255, 0.22)', text: 'rgba(120, 190, 255, 0.95)' }, // Blue (210°)
	{ bg: 'rgba(255, 110, 110, 0.22)', text: 'rgba(255, 130, 130, 0.95)' }, // Red (0°)
	{ bg: 'rgba(100, 230, 100, 0.22)', text: 'rgba(120, 240, 120, 0.95)' }, // Green (120°)
	{ bg: 'rgba(255, 230, 100, 0.22)', text: 'rgba(255, 235, 130, 0.98)' }, // Yellow (50°) - brightened
	{ bg: 'rgba(180, 100, 255, 0.22)', text: 'rgba(190, 120, 255, 0.95)' }, // Violet (270°)

	// Secondary - fill hue gaps
	{ bg: 'rgba(255, 150, 80, 0.22)', text: 'rgba(255, 170, 110, 0.98)' }, // Orange (30°) - brightened
	{ bg: 'rgba(100, 230, 230, 0.22)', text: 'rgba(120, 240, 240, 0.95)' }, // Cyan (180°)
	{ bg: 'rgba(255, 100, 170, 0.22)', text: 'rgba(255, 130, 185, 0.95)' }, // Magenta (330°)
	{ bg: 'rgba(190, 255, 100, 0.22)', text: 'rgba(200, 255, 130, 0.98)' }, // Chartreuse (80°) - brightened
	{ bg: 'rgba(255, 130, 220, 0.22)', text: 'rgba(255, 150, 230, 0.95)' }, // Hot Pink (315°)

	// Tertiary - remaining gaps with distinct saturation/lightness
	{ bg: 'rgba(100, 255, 190, 0.22)', text: 'rgba(120, 255, 200, 0.95)' }, // Spring Green (150°)
	{ bg: 'rgba(230, 190, 150, 0.22)', text: 'rgba(245, 210, 175, 0.98)' }, // Tan/Bronze (30°) - brightened
	{ bg: 'rgba(130, 200, 200, 0.22)', text: 'rgba(150, 220, 220, 0.95)' }, // Teal (180°)
	{ bg: 'rgba(200, 160, 255, 0.22)', text: 'rgba(210, 175, 255, 0.95)' }, // Lavender (265°)
	{ bg: 'rgba(255, 200, 150, 0.22)', text: 'rgba(255, 215, 175, 0.98)' }, // Apricot/Peach (35°) - brightened
] as const;

export function getPlayerColor(name: string): PlayerColor {
	let hash = 0;
	for (let i = 0; i < name.length; i++) {
		hash = name.charCodeAt(i) + ((hash << 5) - hash);
	}
	return PLAYER_COLORS[Math.abs(hash) % PLAYER_COLORS.length];
}
