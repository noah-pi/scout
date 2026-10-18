// Trust memory rules. A trusted site keeps its trust only while its domain
// registration looks the same; an expired-and-rebought domain starts over.
// (Chrome gives extensions no access to TLS certificates, so the registration
// date stands in for "is this still the same site".)

export const TRUST_TTL_DAYS = 365;

export function makeTrustRecord(domain, registered, now = Date.now()) {
  return { domain, registeredAt: registered ?? null, addedAt: now, expiresAt: now + TRUST_TTL_DAYS * 86_400_000 };
}

export function trustStillValid(record, currentRegisteredAt, now = Date.now()) {
  if (!record || record.expiresAt < now) return false;
  if (record.registeredAt && currentRegisteredAt && record.registeredAt !== currentRegisteredAt) return false;
  return true;
}
