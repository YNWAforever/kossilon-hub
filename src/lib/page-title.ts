/**
 * The browser tab title for a screen: its sidebar label, then the product.
 * Every route sets one, so open tabs and history entries say which screen
 * they are (WCAG 2.4.2 Page Titled) instead of all reading the product name.
 */
export const pageTitle = (label: string) => `${label} — Kossilon CoSec OS`;
