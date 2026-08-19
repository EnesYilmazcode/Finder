import { ANALYTICS, configured } from './analytics.js';

// One beacon per page load. Local runs are skipped so development does not
// land in the public numbers.
if (configured && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
  fetch(`${ANALYTICS}/hit`, {
    method: 'POST',
    keepalive: true,
    // text/plain keeps this a simple request, so there is no preflight round trip.
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ p: location.pathname, r: document.referrer }),
  }).catch(() => {});
}
