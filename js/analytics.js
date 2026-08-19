// The one place the analytics worker's address lives. Both the beacon and the
// stats page read it from here.
export const ANALYTICS = 'https://finder-analytics.WORKERS_SUBDOMAIN.workers.dev';

export const configured = !ANALYTICS.includes('WORKERS_SUBDOMAIN');
