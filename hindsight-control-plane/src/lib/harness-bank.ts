const BANK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,190}$/;

export function validBankId(bankId: string): boolean {
  return BANK_ID.test(bankId) && new TextEncoder().encode(bankId).length <= 192;
}

/** Accept only an http loopback redirect. Anything else is refused. */
export function loopbackRedirect(raw: string | null): URL | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return null;
  if (!url.port) return null;
  return url;
}

export function bankChoiceUrl(redirect: URL, bankId: string, state: string): string {
  const url = new URL(redirect.href);
  url.searchParams.set("bank_id", bankId);
  url.searchParams.set("state", state);
  return url.toString();
}
