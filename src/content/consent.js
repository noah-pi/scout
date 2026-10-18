// Cookie-banner auto-reject, using DuckDuckGo's autoconsent. Bundled to
// dist/consent.js. The rules arrive from the service worker (filtered to this
// page), which keeps this script small enough to run in every frame.
import AutoConsent from '@duckduckgo/autoconsent';

const consent = new AutoConsent((message) => chrome.runtime.sendMessage({ type: 'consent', message, timeOrigin: performance.timeOrigin }).catch(() => {}));

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'consentReply') consent.receiveMessageCallback(message.message);
});
