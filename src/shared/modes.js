// How much Scout says. Protection runs the same in every mode; the mode only
// sets how visible Scout is about it. Each guard can still be switched on its
// own in Shields; changing the mode clears those overrides.
export const MODES = {
  quiet: {
    label: 'Quiet',
    about: 'Protects silently. Speaks only to stop you from harm.',
    toasts: 'off',
    affiliateMarks: false,
    dateNotes: false,
    emailMarks: false,
    darkPatternMarks: false,
    badgeCount: false,
  },
  balanced: {
    label: 'Balanced',
    about: 'Marks what matters on the page, and says hello once per site.',
    toasts: 'first',
    affiliateMarks: true,
    dateNotes: true,
    emailMarks: true,
    darkPatternMarks: true,
    badgeCount: false,
  },
  watchful: {
    label: 'Watchful',
    about: 'Shows its work everywhere: counts on the icon, a note on every site.',
    toasts: 'always',
    affiliateMarks: true,
    dateNotes: true,
    emailMarks: true,
    darkPatternMarks: true,
    badgeCount: true,
  },
};

// On in every mode; these protect rather than inform.
export const PROTECTIVE = {
  unwrap: true,
  clipboard: true,
  addresses: true,
  downloads: true,
  notifications: true,
  replayBlock: true,
};

// Off until you turn them on: they change what sites see or show.
export const OPT_IN = {
  forgetOnClose: false,
  honestTitles: false,
  feedLimit: 0, // minutes a day per feed site; 0 is off
  outletAuto: false,
};

export const GUARD_KEYS = [...Object.keys(PROTECTIVE), ...Object.keys(MODES.balanced).filter((k) => !['label', 'about'].includes(k)), ...Object.keys(OPT_IN)];

export function effectiveGuards(shields) {
  const mode = MODES[shields?.mode] ? shields.mode : 'balanced';
  const { label, about, ...look } = MODES[mode];
  return { mode, ...PROTECTIVE, ...look, ...OPT_IN, ...(shields?.guards ?? {}) };
}
