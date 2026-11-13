/** App title — displayed in the nav header and browser tab */
export const APP_TITLE = 'Agent Observability';

/** Path to the logo in /public (used in the header and as favicon) */
export const LOGO_SRC = '/icon.svg';

/**
 * Pages shown in the header nav and under "Go to" in the ⌘K command palette.
 */
export const NAV_ITEMS: { label: string; href: string }[] = [
  { label: 'Portfolio', href: '/' },
  { label: 'Threads', href: '/threads' },
  { label: 'Config', href: '/config' },
  { label: 'Assets', href: '/assets' },
  { label: 'Admin', href: '/admin' },
];
