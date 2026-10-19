// Runs in the page's own JavaScript world at document_start. Bundled to
// dist/main-world.js.
// 1. Exposes navigator.globalPrivacyControl, the JS half of GPC (the header is
//    set by rules/gpc.json).
// 2. Watches the APIs fingerprinting scripts lean on and reports each kind once.
//    It reports and never blocks, so pages keep working. The page can forge
//    these messages, which is why fingerprinting is only ever a soft flag.
// 3. Guards the clipboard. Fake CAPTCHAs put a shell command there and tell
//    you to paste it into Run or Terminal. On a page that talks like a
//    CAPTCHA the command never lands; elsewhere (an install page's copy
//    button) it goes through and Scout notes it.
// 4. Holds back notification prompts that arrive without a click.
import { addressKind, commandIn } from '../shared/guards.js';

(() => {
  try {
    Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true, configurable: true });
  } catch {}

  const post = (data) => window.postMessage({ __scout: data.kind, ...data }, '*');
  const seen = new Set();
  const report = (kind) => {
    if (seen.has(kind)) return;
    seen.add(kind);
    window.postMessage({ __scout: 'fingerprint', kind }, '*');
  };

  const wrap = (proto, name, kind, when = () => true) => {
    const original = proto?.[name];
    if (typeof original !== 'function') return;
    proto[name] = function (...args) {
      if (when(this, args)) report(kind);
      return original.apply(this, args);
    };
  };

  wrap(HTMLCanvasElement.prototype, 'toDataURL', 'canvas');
  wrap(HTMLCanvasElement.prototype, 'toBlob', 'canvas');
  wrap(CanvasRenderingContext2D.prototype, 'getImageData', 'canvas');
  // 37445 and 37446 are UNMASKED_VENDOR_WEBGL and UNMASKED_RENDERER_WEBGL: your GPU's name.
  const gpu = (_, [param]) => param === 37445 || param === 37446;
  wrap(globalThis.WebGLRenderingContext?.prototype, 'getParameter', 'webgl', gpu);
  wrap(globalThis.WebGL2RenderingContext?.prototype, 'getParameter', 'webgl', gpu);
  wrap(globalThis.OfflineAudioContext?.prototype, 'startRendering', 'audio');
  wrap(globalThis.FontFaceSet?.prototype, 'check', 'fonts');

  // Clipboard.
  const BAIT = /verify (that )?(you are|you're) (a )?human|i'?m not a robot|captcha|human verification|win(dows)?\s*(key\s*)?\+\s*r\b|press\s+(ctrl|⌘|cmd|command)\s*\+\s*v|run dialog|open (the )?terminal|verification (steps?|id)|cloudflare/i;
  const bait = () => BAIT.test(document.body?.innerText?.slice(0, 20000) ?? '');
  // Returns true when the write should be stopped.
  const screen = (text, via) => {
    const command = commandIn(text);
    if (command) {
      const blocked = bait();
      post({ kind: 'clipboard', command: String(text).replace(/\s+/g, ' ').trim().slice(0, 80), blocked, via });
      return blocked;
    }
    if (addressKind(text)) post({ kind: 'copied-address', text: String(text).trim() });
    return false;
  };

  const clip = globalThis.Clipboard?.prototype;
  if (clip?.writeText) {
    const writeText = clip.writeText;
    clip.writeText = function (text) {
      if (screen(text, 'writeText')) return Promise.resolve();
      return writeText.call(this, text);
    };
  }
  if (clip?.write) {
    const write = clip.write;
    clip.write = async function (items) {
      try {
        for (const item of items ?? []) {
          if (!item.types?.includes('text/plain')) continue;
          const text = await (await item.getType('text/plain')).text();
          if (screen(text, 'write')) return undefined;
        }
      } catch {}
      return write.call(this, items);
    };
  }
  const setData = DataTransfer.prototype.setData;
  DataTransfer.prototype.setData = function (type, data) {
    if (/^text(\/plain)?$/i.test(type) && screen(data, 'copy-event')) return undefined;
    return setData.call(this, type, data);
  };
  const execCommand = Document.prototype.execCommand;
  Document.prototype.execCommand = function (command, ...rest) {
    if (/^(copy|cut)$/i.test(command)) {
      const active = document.activeElement;
      const selected = active && 'value' in active && typeof active.selectionStart === 'number' ? active.value.slice(active.selectionStart, active.selectionEnd) : String(document.getSelection() ?? '');
      if (screen(selected, 'execCommand')) return false;
    }
    return execCommand.call(this, command, ...rest);
  };

  // Notifications: a prompt the moment a page loads, before you've done
  // anything, is how notification spam starts.
  const request = globalThis.Notification?.requestPermission;
  if (request) {
    Notification.requestPermission = function (...args) {
      if (!navigator.userActivation?.hasBeenActive) {
        post({ kind: 'notification-prompt' });
        const answer = Promise.resolve('default');
        args[0]?.('default');
        return answer;
      }
      return request.apply(this, args);
    };
  }
})();
