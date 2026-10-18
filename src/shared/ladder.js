// The escalation ladder: turns stakes and flags into a badge level and an
// optional request to climb a tier. Pure; the service worker supplies inputs.
//
// Hard flags are deterministic red signals. Nothing downstream (a model, a
// dismissal) can lower them; only explicitly trusting the site clears them.
// Soft flags are context, and repeated dismissals mute them.
// Info flags (fingerprinting, which login pages do routinely for fraud
// checks) are shown in the panel and never move the badge.

export const DISMISS_MUTE_AFTER = 3;

export function assess({ stakes = {}, flags = [], dismissals = {} }) {
  const highStakes = Boolean(stakes.password || stakes.payment);
  const hard = flags.filter((f) => f.severity === 'hard');
  const soft = flags.filter((f) => f.severity === 'soft' && (dismissals[f.kind] ?? 0) < DISMISS_MUTE_AFTER);

  let level = 'quiet';
  if (hard.length && highStakes) level = 'stop';
  else if (hard.length || (highStakes && soft.length)) level = 'note';

  // Climb to the cloud only in the uncertain middle: real stakes, mixed local
  // signals, nothing decisive either way.
  const escalate = highStakes && !hard.length && soft.length >= 1 ? 'tier3' : null;

  const info = flags.filter((f) => f.severity === 'info');
  return { level, escalate, notes: [...hard, ...soft, ...info] };
}
