// Which of Scout's rules count as a blocked tracker or a blocked ad. Redirect
// rules count too: the tracker never loads, a stand-in file takes its place.
// Pure, so the worker and the tests share it.
const LISTS = {
  easyprivacy: 'trackers',
  'easyprivacy-redirect': 'trackers',
  easylist: 'ads',
  'easylist-redirect': 'ads',
};
export const REPLAY_RULE = 20_000;

export function listForRule(rule) {
  if (!rule) return null;
  if (LISTS[rule.rulesetId]) return LISTS[rule.rulesetId];
  // Scout's own stand-ins: ids below 100 replace trackers, 100 and up ads.
  if (rule.rulesetId === 'surrogates') return rule.ruleId < 100 ? 'trackers' : 'ads';
  if (rule.rulesetId === '_dynamic' && rule.ruleId === REPLAY_RULE) return 'trackers';
  return null;
}

export const isTrackerRule = (rule) => listForRule(rule) === 'trackers';
