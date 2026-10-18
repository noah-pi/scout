// Entry point for dist/consent-lib.js: the parts of autoconsent the service
// worker runs. The rules themselves ship as dist/consent-rules.json and load on
// first use; bundling them into the worker kept Chrome from delivering
// navigation and rule-match events to it.
export { evalSnippets, filterCompactRules } from '@duckduckgo/autoconsent';
