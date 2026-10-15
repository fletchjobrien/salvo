// Small line icons for modules and silhouettes for hulls and airframes.
// Plain SVG strings drawn in currentColor, so CSS colours them.

const ICONS = {
  // missiles
  skimmer: '<path d="M3 12h12l5-2-5-2H3z"/><path d="M5 8l-2-3M5 12l-2 3"/><path d="M2 19c2-1.5 4 1.5 6 0s4 1.5 6 0 4 1.5 6 0"/>',
  supersonic: '<path d="M8 12h9l5-2-5-2H8z"/><path d="M2 6h5M1 10h6M2 14h5"/>',
  cruise: '<path d="M4 17C8 7 14 5 21 5"/><path d="M17 3l4 2-3 3"/><path d="M8 13l-3-1M10 9l-1-3"/>',
  torpedo: '<rect x="4" y="9" width="14" height="5" rx="2.5"/><path d="M18 11.5h3M21 9v5"/><path d="M2 5c2-1 4 1 6 0s4 1 6 0 4 1 6 0"/>',
  asw: '<rect x="4" y="5" width="13" height="4" rx="2"/><path d="M17 7h3"/><path d="M11 12v8M8 17l3 3 3-3"/>',
  aam: '<path d="M4 20L18 6"/><path d="M15 5l5-1-1 5"/><path d="M6 14l-2-2M10 18l2 2"/>',
  asm: '<path d="M3 5l13 9"/><path d="M14 16l6 2-3-5"/><path d="M2 20c2-1 4 1 6 0s4 1 6 0 4 1 6 0"/>',
  atorp: '<path d="M8 3h8"/><path d="M12 3v6"/><rect x="9" y="9" width="6" height="11" rx="3"/>',
  // guns
  autocannon: '<path d="M4 18h12v-5H6z"/><path d="M11 13l9-6M12 15l9-5"/>',
  naval: '<path d="M3 19h14v-6c0-2-2-3-4-3H7c-2 0-4 1-4 3z"/><path d="M13 12l9-5"/>',
  railgun: '<path d="M3 9h18M3 15h18"/><path d="M13 9l-3 3h4l-3 3"/>',
  // defence
  sam: '<path d="M12 3l3 5v8H9V8z"/><path d="M9 13l-2 3M15 13l2 3"/><path d="M10 19l2 3 2-3"/>',
  ciws: '<path d="M5 20h12v-7a6 6 0 00-12 0z"/><path d="M13 10l8-4M14 12l8-3"/>',
  laser: '<rect x="2" y="13" width="6" height="7"/><path d="M8 15L20 5"/><path d="M18 3l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/>',
  decoy: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/>',
  flares: '<path d="M6 4l1 3M12 3v4M18 4l-1 3"/><circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="14" r="1.5"/><circle cx="18" cy="12" r="1.5"/><path d="M6 15v4M12 17v4M18 15v4"/>',
  fuel: '<path d="M12 3c4 6 6 9 6 12a6 6 0 01-12 0c0-3 2-6 6-12z"/>',
  // sensors
  search: '<path d="M5 13c2 3 9 3 11-2"/><path d="M5 13l6-8 5 6"/><path d="M10 15v6M7 21h6"/><path d="M18 5a5 5 0 012 4"/>',
  aradar: '<path d="M5 13c2 3 9 3 11-2"/><path d="M5 13l6-8 5 6"/><path d="M10 15v6M7 21h6"/><path d="M18 5a5 5 0 012 4"/>',
  early: '<path d="M3 14c3 4 11 4 14-3"/><path d="M3 14l8-11 6 8"/><path d="M10 17v4M7 21h6"/><path d="M17 3a6 6 0 013 5M19 1a9 9 0 013 7"/>',
  fire: '<circle cx="12" cy="12" r="7"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/>',
  sonar: '<path d="M2 6c2-1 4 1 6 0s4 1 6 0 4 1 6 0"/><path d="M7 14a5 5 0 0010 0M4 15a8 8 0 0016 0"/><circle cx="12" cy="13" r="1.5"/>',
  dip: '<path d="M12 2v10"/><circle cx="12" cy="13" r="1.5"/><path d="M7 15a5 5 0 0010 0M4 16a8 8 0 0016 0"/>',
  aew: '<ellipse cx="12" cy="8" rx="9" ry="3"/><path d="M12 11v4"/><path d="M3 18h18"/>',
  // electronic warfare
  noise: '<path d="M3 12l18-5v10z"/><path d="M8 12l3-2v4l3-2"/>',
  barrage: '<path d="M3 12L21 3v18z"/><path d="M8 12l3-3v6l3-3 3 2"/>',
  pod: '<rect x="3" y="9" width="12" height="6" rx="3"/><path d="M15 12h2l2-3-1 3h3"/>',
  // hangars
  helo: '<path d="M3 5h18M12 5v4"/><path d="M6 13c0-2 2-4 6-4h2c3 0 4 2 4 4s-1 3-4 3H9c-2 0-3-1-3-3z"/><path d="M6 13H2M9 19h8"/>',
  drone: '<path d="M12 4v16M4 10h16M9 19h6"/><path d="M10 6h4"/>',
};

const SIL = {
  ddg: '<path d="M2 15h58l-4 5H6z"/><path d="M14 15V11h8V7h6v4h6v4z"/><path d="M28 7V2h1v5"/><path d="M40 15v-3h6v3zM48 14h4v1h-4z"/>',
  ffg: '<path d="M4 15h52l-4 5H8z"/><path d="M16 15v-4h7V7h5v4h6v4z"/><path d="M25 7V3h1v4"/><path d="M40 15v-2h5v2z"/>',
  fac: '<path d="M10 15h42l-4 5H13z"/><path d="M22 15v-4h10v4z"/><path d="M27 11V7h1v4"/><path d="M36 15v-2h4v2z"/>',
  ssk: '<path d="M6 16c0-3 4-4 10-4h28c8 0 14 2 14 4s-6 4-14 4H16c-6 0-10-1-10-4z"/><path d="M24 12V7h7l2 5z"/><path d="M6 16l-4-3v6z"/>',
  helo: '<path d="M8 4h40M28 4v4"/><path d="M14 13c0-3 4-5 10-5h6c5 0 8 3 8 5s-3 5-8 5H20c-4 0-6-2-6-5z"/><path d="M14 12H3l-1-3"/><path d="M20 21h16M24 18v3M32 18v3"/>',
  drone: '<path d="M8 12h44l4 1-4 1H8z"/><path d="M26 12L22 3h4l6 9zM26 14l-4 9h4l6-9z"/><path d="M10 12l-3-5h3l3 5zM10 14l-3 5h3l3-5z"/>',
  fighter: '<path d="M4 12l10-2h14l10-8h4l-4 9h18l4 1-4 1H38l4 9h-4l-10-8H14z"/><path d="M8 11l-4-5h3l5 5zM8 13l-4 5h3l5-5z"/>',
  jet: '<path d="M4 12l8-2h18l6-8h5l-3 9h20l2 1-2 1H38l3 9h-5l-6-8H12z"/><path d="M8 11l-4-4h3l4 4zM8 13l-4 4h3l4-4z"/>',
  mpa: '<path d="M2 12l6-2h46l6 2-6 2H8z"/><path d="M28 10l-6-9h4l10 9zM28 14l-6 9h4l10-9z"/><path d="M6 11l-3-4h3l3 4zM6 13l-3 4h3l3-4z"/>',
};

export function icon(key, cls = 'ic') {
  const body = ICONS[key] || SIL[key];
  if (!body) return '';
  if (SIL[key] && !ICONS[key]) return silhouette(key, cls);
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function silhouette(cls, klass = 'sil') {
  const body = SIL[cls];
  if (!body) return '';
  return `<svg class="${klass}" viewBox="0 0 64 24" fill="currentColor" stroke="currentColor" stroke-width="0.6" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
