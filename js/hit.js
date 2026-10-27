import { ANALYTICS, configured } from './analytics.js';

// One beacon per page load. Local runs are skipped so development does not
// land in the public numbers.
// A random id kept in this browser so a return visit counts as the same person.
// Storage can be blocked (private windows, strict settings); then there is no id.
function visitorId() {
  try {
    let id = localStorage.getItem('finder-v');
    if (!id) localStorage.setItem('finder-v', (id = crypto.randomUUID()));
    return id;
  } catch {
    return '';
  }
}

if (configured && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
  fetch(`${ANALYTICS}/hit`, {
    method: 'POST',
    keepalive: true,
    // text/plain keeps this a simple request, so there is no preflight round trip.
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ p: location.pathname, r: document.referrer, v: visitorId() }),
  }).catch(() => {});
}
