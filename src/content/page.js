// Isolated-world content script. Relays fingerprinting reports from
// main-world.js and tells the service worker when the stakes go up: a password
// field or a payment field appears.
(() => {
  const send = (message) => chrome.runtime.sendMessage(message).catch(() => {});

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.__scout !== 'fingerprint') return;
    send({ type: 'fingerprint', kind: String(event.data.kind) });
  });

  const PAYMENT = [
    'input[autocomplete^="cc-"]',
    'input[name*="card" i]',
    'input[id*="card" i]',
    'input[name*="iban" i]',
    'iframe[src*="stripe.com"]',
    'iframe[src*="braintreegateway.com"]',
    'iframe[src*="adyen.com"]',
  ].join(',');

  let reported = { password: false, payment: false };
  const check = () => {
    const now = {
      password: Boolean(document.querySelector('input[type="password"]')),
      payment: Boolean(document.querySelector(PAYMENT)),
    };
    if ((now.password && !reported.password) || (now.payment && !reported.payment)) {
      reported = { password: reported.password || now.password, payment: reported.payment || now.payment };
      send({ type: 'stakes', stakes: reported });
    }
  };

  // Login and checkout forms often render late; check again as the DOM settles.
  let pending = null;
  const schedule = () => {
    if (pending) return;
    pending = setTimeout(() => { pending = null; check(); }, 500);
  };

  const start = () => {
    check();
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
