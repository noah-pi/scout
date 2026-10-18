// Runs in the page's own JavaScript world at document_start.
// 1. Exposes navigator.globalPrivacyControl, the JS half of GPC (the header is
//    set by rules/gpc.json).
// 2. Watches the APIs fingerprinting scripts lean on and reports each kind once.
//    It reports and never blocks, so pages keep working. The page can forge
//    these messages, which is why fingerprinting is only ever a soft flag.
(() => {
  try {
    Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true, configurable: true });
  } catch {}

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
})();
