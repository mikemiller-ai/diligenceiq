/**
 * Small IP helpers for the per-client workspace-creation key (assumptions D12): parsing IPv4 and
 * IPv6 text, CIDR membership, and the normalised form a viewer is keyed on. No dependencies.
 */

export type ParsedIp = { version: 4; bytes: Uint8Array } | { version: 6; bytes: Uint8Array };

function parseV4(text: string): Uint8Array | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const p = parts[i]!;
    if (!/^\d{1,3}$/.test(p) || (p.length > 1 && p.startsWith('0'))) return null;
    const n = Number(p);
    if (n > 255) return null;
    out[i] = n;
  }
  return out;
}

function parseV6(text: string): Uint8Array | null {
  let s = text;
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (!s.includes(':')) return null;
  // An embedded IPv4 tail (::ffff:192.0.2.1, 64:ff9b::192.0.2.1) becomes two 16-bit groups.
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseV4(tail);
    if (!v4) return null;
    s = `${s.slice(0, lastColon + 1)}${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const groups = (part: string) => (part === '' ? [] : part.split(':'));
  const head = groups(halves[0]!);
  const rest = halves.length === 2 ? groups(halves[1]!) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const all = [...head, ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => '0'), ...rest];
  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const g = all[i]!;
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    const n = parseInt(g, 16);
    out[i * 2] = n >> 8;
    out[i * 2 + 1] = n & 0xff;
  }
  return out;
}

/**
 * Parses one address as it can appear in `X-Forwarded-For` or `sourceIp`: IPv4, IPv6 (any case,
 * compressed, with a zone or in brackets), or IPv4 with a port. An IPv4-mapped IPv6 address
 * (`::ffff:a.b.c.d`) is the IPv4 address. Anything else is null.
 */
export function parseIp(raw: string | undefined): ParsedIp | null {
  if (!raw) return null;
  let s = raw.trim().toLowerCase();
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (bracket) s = bracket[1]!;
  const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(s);
  if (v4WithPort) s = v4WithPort[1]!;
  const v4 = parseV4(s);
  if (v4) return { version: 4, bytes: v4 };
  const v6 = parseV6(s);
  if (!v6) return null;
  const mapped = v6.slice(0, 10).every((b) => b === 0) && v6[10] === 0xff && v6[11] === 0xff;
  return mapped ? { version: 4, bytes: v6.slice(12) } : { version: 6, bytes: v6 };
}

export interface Cidr {
  version: 4 | 6;
  bytes: Uint8Array;
  prefix: number;
}

export function parseCidr(text: string): Cidr {
  const slash = text.indexOf('/');
  const ip = parseIp(slash < 0 ? text : text.slice(0, slash));
  const prefix = slash < 0 ? undefined : Number(text.slice(slash + 1));
  if (!ip || prefix === undefined || !Number.isInteger(prefix) || prefix < 0 || prefix > ip.bytes.length * 8) throw new Error(`invalid CIDR ${text}`);
  return { version: ip.version, bytes: ip.bytes, prefix };
}

export function inCidr(ip: ParsedIp, cidr: Cidr): boolean {
  if (ip.version !== cidr.version) return false;
  const full = cidr.prefix >> 3;
  for (let i = 0; i < full; i++) if (ip.bytes[i] !== cidr.bytes[i]) return false;
  const bits = cidr.prefix & 7;
  if (bits === 0) return true;
  const mask = (0xff << (8 - bits)) & 0xff;
  return (ip.bytes[full]! & mask) === (cidr.bytes[full]! & mask);
}

/**
 * The form a client is keyed on: IPv4 dotted; IPv6 as its expanded, lower-case /64 prefix, because
 * one subscriber is usually given a whole /64 and could otherwise rotate addresses inside it for a
 * fresh key per request. Text that is not an address is keyed as given (trimmed, lower-case).
 */
export function clientAddressKey(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const ip = parseIp(raw);
  if (!ip) return raw.trim().toLowerCase();
  if (ip.version === 4) return [...ip.bytes].join('.');
  const groups: string[] = [];
  for (let i = 0; i < 8; i += 2) groups.push(((ip.bytes[i]! << 8) | ip.bytes[i + 1]!).toString(16).padStart(4, '0'));
  return `${groups.join(':')}::/64`;
}
