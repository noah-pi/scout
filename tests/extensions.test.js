import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditAll, auditExtension } from '../src/shared/extensions.js';

test('broad host access and powerful permissions raise risk', () => {
  const a = auditExtension({ hostPermissions: ['<all_urls>'], permissions: ['debugger', 'cookies'] });
  assert.equal(a.risk, 3);
  assert.deepEqual(a.reasons, ['can read and change every site you visit', 'can drive any tab like a remote control (debugger)', 'can read your login cookies']);
  assert.deepEqual(auditExtension({ hostPermissions: ['https://*.example.com/*'], permissions: ['storage'] }), { risk: 0, reasons: [] });
});

test('auditAll skips Scout, disabled extensions, apps and harmless ones, riskiest first', () => {
  const list = [
    { id: 'self', name: 'Scout', enabled: true, type: 'extension', hostPermissions: ['<all_urls>'] },
    { id: 'a', name: 'Coupon Helper', enabled: true, type: 'extension', hostPermissions: ['<all_urls>'], permissions: ['cookies'] },
    { id: 'b', name: 'Dark Reader', enabled: true, type: 'extension', hostPermissions: ['<all_urls>'] },
    { id: 'c', name: 'Old thing', enabled: false, type: 'extension', permissions: ['debugger'] },
    { id: 'd', name: 'Notes', enabled: true, type: 'extension', permissions: ['storage'] },
  ];
  assert.deepEqual(auditAll(list, 'self').map((e) => e.name), ['Coupon Helper', 'Dark Reader']);
});
