/**
 * The two-column party layout starts at Tailwind's `lg` breakpoint. Components that
 * render something in only one layout build `new MediaQuery(DESKTOP_LAYOUT_QUERY)`
 * per instance, so each piece of UI is mounted once rather than hidden by CSS.
 */
export const DESKTOP_LAYOUT_QUERY = '(min-width: 1024px)';
