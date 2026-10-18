// Isolated-world content script, bundled to dist/page.js. Relays fingerprinting reports from
// main-world.js, tells the service worker when the stakes go up (a password
// field or a payment field appears), and extracts the few page fields a model
// may see. Values typed into fields are never read.
import { LEGAL, SEAL, SEAL_ISSUERS, SHOP } from '../shared/shops.js';

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

  // Shop pages: gather the facts the fake-shop check needs, once the page
  // has settled. Nothing here leaves the browser; the worker decides.
  function shopFacts() {
    const buttons = [...document.querySelectorAll('button, a, input[type="submit"]')].slice(0, 400).map((el) => text(el) || el.value || '');
    const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent).join(' ');
    const isShop = buttons.some((t) => SHOP.test(t)) || /"@type"\s*:\s*"(Product|Offer)"/.test(jsonLd) || document.querySelector('meta[property="og:type"][content="product"]') !== null;
    if (!isShop) return null;
    const links = [...document.querySelectorAll('a[href]')];
    const body = (document.body?.innerText ?? '').slice(0, 60000);
    const seals = [...document.querySelectorAll('img, svg, [class*="badge" i], [class*="seal" i]')]
      .map((el) => ({ el, name: [el.getAttribute('alt'), el.getAttribute('title'), el.getAttribute('src'), el.getAttribute('aria-label')].filter(Boolean).join(' ') }))
      .filter((s) => SEAL.test(s.name))
      .slice(0, 10)
      .map(({ el, name }) => {
        const href = el.closest('a')?.href ?? '';
        let external = false;
        try {
          external = new URL(href).hostname !== location.hostname;
        } catch {}
        return { name: (name.match(SEAL)?.[0] ?? 'trust').replace(/\b\w/g, (c) => c.toUpperCase()), linked: external && SEAL_ISSUERS.test(href) };
      });
    return {
      isShop,
      legalLinks: links.filter((a) => LEGAL.test(`${text(a)} ${a.getAttribute('href')}`)).length,
      contact: links.some((a) => /^(mailto|tel):/i.test(a.getAttribute('href') ?? '')) || /\b\d{4,5}\s+[A-ZÄÖÜ][a-zäöüß]+/.test(body),
      seals,
      text: body.toLowerCase(),
      discounts: [...body.matchAll(/(?:-|−|save\s|up to\s)?(\d{2})\s?%\s?(?:off|rabatt|de descuento|de réduction|sconto)?/gi)].map((m) => Number(m[1])).slice(0, 200),
    };
  }

  const start = () => {
    check();
    setTimeout(() => {
      const facts = shopFacts();
      if (facts) send({ type: 'shop', facts: { ...facts, text: facts.text.slice(0, 20000) } });
    }, 1500);
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
