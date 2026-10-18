// Isolated-world content script. Relays fingerprinting reports from
// main-world.js, tells the service worker when the stakes go up (a password
// field or a payment field appears), and extracts the few page fields a model
// may see. Values typed into fields are never read.
(() => {
  const send = (message) => chrome.runtime.sendMessage({ ...message, timeOrigin: performance.timeOrigin }).catch(() => {});

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

  const text = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

  const labelFor = (input) =>
    text(input.id && document.querySelector(`label[for="${CSS.escape(input.id)}"]`)) ||
    input.getAttribute('aria-label') ||
    input.placeholder ||
    input.name ||
    '';

  // Where each sensitive form sends its data (hosts only).
  const formHosts = () => {
    const forms = new Set();
    for (const input of document.querySelectorAll(`input[type="password"], ${PAYMENT}`)) if (input.form) forms.add(input.form);
    return [...forms].map((f) => { try { return new URL(f.action || location.href).hostname; } catch { return ''; } }).filter(Boolean);
  };

  const extract = ({ deep = false } = {}) => {
    const page = {
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content ?? '',
      headings: [...document.querySelectorAll('h1, h2')].slice(0, 6).map(text).filter(Boolean),
      labels: [...document.querySelectorAll('input:not([type="hidden"]), select')].slice(0, 12).map(labelFor).filter(Boolean),
      formHosts: formHosts(),
    };
    if (deep) page.text = (document.body?.innerText ?? '').slice(0, 20000);
    return page;
  };

  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.type !== 'extract') return false;
    reply(extract(message));
    return false;
  });

  let reported = { password: false, payment: false };
  const check = () => {
    const now = {
      password: Boolean(document.querySelector('input[type="password"]')),
      payment: Boolean(document.querySelector(PAYMENT)),
    };
    if ((now.password && !reported.password) || (now.payment && !reported.payment)) {
      reported = { password: reported.password || now.password, payment: reported.payment || now.payment };
      send({ type: 'stakes', stakes: reported, page: extract() });
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
