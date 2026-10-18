// Audit of your other extensions: which ones can see or steer what Scout
// protects. An extension with access to every site can read every page,
// including your AI assistants' (the BragJack lesson, Sept 2026). Pure.

const BROAD_HOSTS = /^(<all_urls>|\*:\/\/\*\/\*|https?:\/\/\*\/\*|\*:\/\/\*\.[^/]+\/\*)$/;

const POWERFUL = {
  debugger: 'can drive any tab like a remote control (debugger)',
  nativeMessaging: 'can talk to programs on your computer',
  proxy: 'can route your traffic through any server',
  webRequestBlocking: 'can rewrite your traffic',
  cookies: 'can read your login cookies',
  history: 'can read your browsing history',
  management: 'can turn your other extensions on and off',
  clipboardRead: 'can read your clipboard',
  privacy: 'can change Chrome privacy settings',
  downloads: 'can download and open files',
};

// ext: chrome.management.ExtensionInfo. Returns { risk: 0..3, reasons: [] }.
export function auditExtension(ext) {
  const reasons = [];
  let risk = 0;
  const hosts = ext.hostPermissions ?? [];
  if (hosts.some((h) => BROAD_HOSTS.test(h) && !h.includes('.'))) {
    reasons.push('can read and change every site you visit');
    risk += 2;
  }
  for (const perm of ext.permissions ?? []) {
    if (POWERFUL[perm]) {
      reasons.push(POWERFUL[perm]);
      risk += perm === 'debugger' || perm === 'nativeMessaging' || perm === 'proxy' ? 2 : 1;
    }
  }
  if (ext.installType === 'development' || ext.installType === 'sideload') reasons.push(`installed outside the Chrome Web Store (${ext.installType})`);
  return { risk: Math.min(3, Math.ceil(risk / 2)), reasons };
}

export function auditAll(extensions, selfId) {
  return extensions
    .filter((e) => e.id !== selfId && e.enabled && e.type === 'extension')
    .map((e) => ({ id: e.id, name: e.name, ...auditExtension(e) }))
    .filter((e) => e.reasons.length)
    .sort((a, b) => b.risk - a.risk || a.name.localeCompare(b.name));
}
