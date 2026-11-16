import {CONFIG} from './config.js';
import {pendingEvents} from './store.js';
let running = false;
export async function syncEvents(state) {
  if (!CONFIG.apiBaseUrl) return {status:'unconfigured',ids:[]};
  if (!navigator.onLine) return {status:'offline',ids:[]};
  if (running) return {status:'busy',ids:[]};
  const events = pendingEvents(state);
  if (!events.length) return {status:'done',ids:[]};
  running = true;
  try {
    const response = await fetch(`${CONFIG.apiBaseUrl.replace(/\/$/,'')}/v1/learning-events`, {
      method:'POST',credentials:'include', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({schemaVersion:1,events}),signal:AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body.acceptedEventIds) || body.acceptedEventIds.some(id=>typeof id!=='string')) throw new Error('Invalid acknowledgement');
    const sent = new Set(events.map(event=>event.id));
    return {status:'done',ids:body.acceptedEventIds.filter(id=>sent.has(id))};
  } finally { running = false; }
}
