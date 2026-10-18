// Fake-shop checks, after the German consumer centers' Fakeshop-Finder and
// Austria's Watchlist Internet: no legal notice or contact, seals that don't
// link to their issuer, only hard-to-reverse payment methods, and implausible
// discounts. Pure; the page script gathers the facts.

export const SHOP = /add to (cart|bag|basket)|buy now|in den warenkorb|jetzt kaufen|ajouter au panier|añadir al carrito|aggiungi al carrello|adicionar ao carrinho|カートに入れる|장바구니|加入购物车/i;
export const LEGAL = /impressum|imprint|legal notice|contact|kontakt|about us|returns?|refund|widerruf|shipping policy|mentions légales|aviso legal|特定商取引法/i;
export const SEAL = /trusted ?shops|norton|mcafee|trustpilot|ssl ?secur|secure checkout|verified (shop|store|seller)|bbb accredited|safe ?shop/i;
export const SEAL_ISSUERS = /trustedshops|norton|mcafee|trustpilot|bbb\.org|digicert|sectigo|ehi|safeshop/i;
const SAFE_PAY = /paypal|visa|mastercard|american express|\bamex\b|apple pay|google pay|klarna|shop pay|sofort|ideal|bancontact|pix\b|boleto/i;
const RISKY_PAY = /bank transfer|wire transfer|bitcoin|crypto|usdt|gift ?card|zelle|western union|moneygram|überweisung|vorkasse|virement/i;

// facts: { isShop, legalLinks, contact, seals: [{ name, linked }], text, discounts: [n...] }
export function shopFlags(facts, ageDays = null) {
  if (!facts?.isShop) return [];
  const signals = [];
  if (!facts.legalLinks && !facts.contact) signals.push({ kind: 'shop:no-contact', text: 'No contact details, legal notice or returns policy found.' });
  const fakeSeal = (facts.seals ?? []).find((s) => !s.linked);
  if (fakeSeal) signals.push({ kind: 'shop:unlinked-seal', text: `Shows a "${fakeSeal.name}" badge that doesn't link to its issuer.` });
  const text = facts.text ?? '';
  if (RISKY_PAY.test(text) && !SAFE_PAY.test(text)) signals.push({ kind: 'shop:risky-payment', text: 'Only takes payment methods that are hard to reverse (bank transfer, crypto, gift cards).' });
  const steep = (facts.discounts ?? []).filter((d) => d >= 70 && d < 100);
  if (steep.length >= 3) signals.push({ kind: 'shop:steep-discounts', text: `Discounts of ${Math.min(...steep)}–${Math.max(...steep)}% across the page.` });

  const flags = signals.map((s) => ({ ...s, severity: 'soft' }));
  const young = ageDays !== null && ageDays < 180;
  if (signals.length >= 3 || (signals.length >= 2 && young) || (signals.length >= 2 && ageDays === null && signals.some((s) => s.kind === 'shop:risky-payment'))) {
    flags.push({ kind: 'fake-shop', severity: 'hard', text: `This shop matches the usual fake-shop pattern (${signals.length} signs${young ? `, domain ${ageDays} days old` : ''}).` });
  }
  return flags;
}
