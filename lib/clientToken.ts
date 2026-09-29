// A client's personal ordering-link token: their UUID minus the dashes.
// Carried as ?ref=<token> on the storefront so a completed order links to
// the right client deterministically, instead of fuzzy-matching names.
// Anyone holding the link can order as that client — that's the point of a
// personal link — and the UUID is unguessable.

export function clientIdToRefToken(clientId: string): string {
  return clientId.replace(/-/g, "");
}

export function refTokenToClientId(token: string | null | undefined): string | null {
  const match = token?.match(/^[0-9a-f]{32}$/i);
  if (!match) return null;
  const hex = match[0].toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Server-only in practice (reads SITE_URL); returns null until it's set.
export function getStorefrontLink(clientId: string): string | null {
  const base = process.env.SITE_URL?.replace(/\/$/, "");
  if (!base) return null;
  return `${base}/order?ref=${clientIdToRefToken(clientId)}`;
}
