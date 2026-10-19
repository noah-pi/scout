// Fingerprint defense, for the sites you switch it on for. Bundled to
// dist/farble.js and registered per site by the service worker, in the page's
// own world at document_start. Canvas and audio readings get a faint,
// per-site, per-session jitter, and the GPU's name reads as a generic one, so
// the fingerprint a tracker computes changes between visits. Pages draw and
// play exactly as before; only what scripts read back is altered.
(() => {
  let seed = 0;
  for (const ch of `${location.hostname}:${performance.timeOrigin}`) seed = (Math.imul(seed ^ ch.charCodeAt(0), 2654435761) >>> 0) || 1;
  const rand = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };

  const jitter = (data) => {
    // Flip the lowest bit of about one channel in 50; invisible, but enough
    // to change any hash of the pixels.
    for (let i = 0; i < data.length; i += 4) if (rand() < 0.02) data[i + Math.floor(rand() * 3)] ^= 1;
    return data;
  };

  const getImageData = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function (...args) {
    const image = getImageData.apply(this, args);
    jitter(image.data);
    return image;
  };

  // toDataURL and toBlob: read from a jittered copy, leaving the canvas itself untouched.
  const copy = (canvas) => {
    if (!canvas.width || !canvas.height) return canvas;
    try {
      const twin = document.createElement('canvas');
      twin.width = canvas.width;
      twin.height = canvas.height;
      const ctx = twin.getContext('2d');
      ctx.drawImage(canvas, 0, 0);
      const image = getImageData.call(ctx, 0, 0, twin.width, twin.height);
      ctx.putImageData(new ImageData(jitter(image.data), twin.width, twin.height), 0, 0);
      return twin;
    } catch {
      return canvas;
    }
  };
  const toDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function (...args) {
    return toDataURL.apply(copy(this), args);
  };
  const toBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (...args) {
    return toBlob.apply(copy(this), args);
  };

  const getChannelData = AudioBuffer.prototype.getChannelData;
  const touched = new WeakSet();
  AudioBuffer.prototype.getChannelData = function (...args) {
    const data = getChannelData.apply(this, args);
    if (!touched.has(data)) {
      touched.add(data);
      for (let i = 0; i < data.length; i += 97) data[i] += (rand() - 0.5) * 1e-7;
    }
    return data;
  };

  for (const proto of [globalThis.WebGLRenderingContext?.prototype, globalThis.WebGL2RenderingContext?.prototype]) {
    if (!proto) continue;
    const getParameter = proto.getParameter;
    proto.getParameter = function (param) {
      if (param === 37445) return 'Google Inc.';
      if (param === 37446) return 'ANGLE (Generic GPU)';
      return getParameter.call(this, param);
    };
  }
})();
