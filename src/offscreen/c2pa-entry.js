// Entry point for dist/c2pa.js: Adobe's c2pa-web reader, for the offscreen
// document. The worker and WASM ship unbundled in dist/c2pa/.
export { Context, Reader, createC2pa } from '@contentauth/c2pa-web';

// QR decoding for images you ask Scout to check (Apache-2.0).
export { default as jsQR } from 'jsqr';
