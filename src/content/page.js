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

  // Instructions aimed at AI assistants, hidden from the reader: present in
  // the page's full text but not in what's rendered. Visible mentions (an
  // article about prompt injection) don't count.
  const INJECTION = /ignore (all |any )?(previous|prior|above|earlier) (instructions|prompts|messages)|disregard (your|all|previous) (instructions|rules)|(you are|act as) an? (ai|language model|llm|assistant)\b|\b(ai|llm|assistant|agent)s?,? (must|should|please) (say|tell|report|confirm|mark|classify|rate)|\bsystem prompt\b|<\|im_start\|>|\[\[?system\]?\]/i;
  const hiddenPrompt = () => {
    const all = document.body?.textContent ?? '';
    if (!INJECTION.test(all)) return false;
    return !INJECTION.test(document.body.innerText ?? '');
  };

  const extract = ({ deep = false, links = false } = {}) => {
    const page = {
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content ?? '',
      headings: [...document.querySelectorAll('h1, h2')].slice(0, 6).map(text).filter(Boolean),
      labels: [...document.querySelectorAll('input:not([type="hidden"]), select')].slice(0, 12).map(labelFor).filter(Boolean),
      formHosts: formHosts(),
      hiddenPrompt: hiddenPrompt(),
      seedPhrase: [...document.querySelectorAll('input, textarea')].some((f) => SEED.test(describeField(f))),
    };
    if (deep) page.text = (document.body?.innerText ?? '').slice(0, 20000);
    if (links) page.links = [...document.querySelectorAll('a[href]')].slice(0, 600).map((a) => ({ text: text(a).slice(0, 80), href: a.getAttribute('href') }));
    return page;
  };

  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.type !== 'extract') return false;
    reply(extract(message));
    return false;
  });

  // What a field asks for. Recovery phrases matter most: legitimate wallets
  // never ask for one on a web page.
  const OTP = /\b(otp|one[- ]?time|2fa|two[- ]factor|verification code|auth(entication)? code|sms code|passcode)\b/i;
  const SEED = /seed phrase|recovery phrase|secret (recovery )?phrase|mnemonic|wallet phrase|private key|\b(12|24)[- ]word/i;
  const describeField = (el) => [labelFor(el), el.name, el.id, el.getAttribute('autocomplete')].filter(Boolean).join(' ');

  function kindsOf(el) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return {};
    const about = describeField(el);
    return {
      password: el.type === 'password',
      payment: el.matches?.(PAYMENT) ?? false,
      otp: el.autocomplete === 'one-time-code' || OTP.test(about),
      seed: SEED.test(about),
    };
  }

  let reported = { password: false, payment: false, otp: false, seed: false };
  const report = (found) => {
    const fresh = Object.keys(reported).filter((k) => found[k] && !reported[k]);
    if (!fresh.length) return;
    for (const k of fresh) reported[k] = true;
    send({ type: 'stakes', stakes: { ...reported }, page: extract() });
  };

  const check = () => {
    const fields = [...document.querySelectorAll('input, textarea')];
    report({
      password: Boolean(document.querySelector('input[type="password"]')),
      payment: Boolean(document.querySelector(PAYMENT)),
      otp: fields.some((f) => kindsOf(f).otp),
      seed: fields.some((f) => kindsOf(f).seed),
    });
  };

  // The moment you click into a sensitive field, check it right away, even if
  // the form appeared after load or inside a popup.
  document.addEventListener(
    'focusin',
    (event) => {
      const el = event.composedPath?.()[0] ?? event.target;
      const kinds = kindsOf(el);
      if (Object.values(kinds).some(Boolean)) report(kinds);
    },
    true,
  );

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
