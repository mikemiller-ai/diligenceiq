import { describe, expect, it } from 'vitest';
import { CLOUDFRONT_RANGES } from './cloudfront-ranges';
import { clientAddressKey, inCidr, parseCidr, parseIp } from './ip';
import { forwardedForKeys, isCloudFrontAddress, viewerAddress } from './session';

// 130.176.88.0/21 is CLOUDFRONT_ORIGIN_FACING, 108.138.0.0/15 and 2600:9000:3000::/36 are CLOUDFRONT.
const CF_PROXY = '130.176.88.10';
const CF_EDGE = '108.138.0.10';
const CF_EDGE_2 = '108.139.255.1';
const CF_V6 = '2600:9000:3000::1';
const xff = (...hops: string[]) => hops.join(', ');

describe('ip helpers (D12)', () => {
  it('parses IPv4, IPv6 (compressed, upper case, zone, brackets, embedded IPv4) and rejects junk', () => {
    expect([...parseIp('192.0.2.1')!.bytes]).toEqual([192, 0, 2, 1]);
    expect(parseIp('192.0.2.1:443')!.version).toBe(4);
    expect(parseIp('2001:DB8::1')!.version).toBe(6);
    expect(parseIp('[2001:db8::1]:443')!.version).toBe(6);
    expect(parseIp('fe80::1%eth0')!.version).toBe(6);
    expect([...parseIp('64:ff9b::192.0.2.1')!.bytes.slice(12)]).toEqual([192, 0, 2, 1]);
    for (const bad of ['', 'unknown', '256.1.1.1', '01.2.3.4', '1.2.3', '1:2:3:4:5:6:7:8:9', '1::2::3', 'g::1', '12345::1']) expect(parseIp(bad), bad).toBeNull();
  });

  it('maps ::ffff:a.b.c.d (any case or spelling) to the IPv4 address', () => {
    for (const mapped of ['::ffff:198.51.100.20', '::FFFF:198.51.100.20', '0:0:0:0:0:ffff:c633:6414']) {
      expect(parseIp(mapped)).toEqual({ version: 4, bytes: new Uint8Array([198, 51, 100, 20]) });
      expect(clientAddressKey(mapped)).toBe('198.51.100.20');
    }
  });

  it('CIDR membership for v4 and v6, including non-octet prefixes and family mismatches', () => {
    expect(inCidr(parseIp('108.139.1.1')!, parseCidr('108.138.0.0/15'))).toBe(true);
    expect(inCidr(parseIp('108.140.0.0')!, parseCidr('108.138.0.0/15'))).toBe(false);
    expect(inCidr(parseIp('120.52.22.127')!, parseCidr('120.52.22.96/27'))).toBe(true);
    expect(inCidr(parseIp('120.52.22.128')!, parseCidr('120.52.22.96/27'))).toBe(false);
    expect(inCidr(parseIp('2600:9000:3fff::1')!, parseCidr('2600:9000:3000::/36'))).toBe(true);
    expect(inCidr(parseIp('2600:9000:4000::1')!, parseCidr('2600:9000:3000::/36'))).toBe(false);
    expect(inCidr(parseIp('1.2.3.4')!, parseCidr('::/0'))).toBe(false);
    expect(inCidr(parseIp('1.2.3.4')!, parseCidr('0.0.0.0/0'))).toBe(true);
    expect(() => parseCidr('1.2.3.0/33')).toThrow();
  });

  it('keys IPv6 on its expanded, lower-case /64 prefix', () => {
    expect(clientAddressKey('2001:DB8:aa:bb::1')).toBe('2001:0db8:00aa:00bb::/64');
    expect(clientAddressKey('2001:db8:aa:bb:ffff:1:2:3')).toBe('2001:0db8:00aa:00bb::/64');
    expect(clientAddressKey('2001:db8:aa:bc::1')).toBe('2001:0db8:00aa:00bc::/64');
    expect(clientAddressKey(' Not-An-IP ')).toBe('not-an-ip');
    expect(clientAddressKey(undefined)).toBeUndefined();
  });

  it('the bundled CloudFront list parses, records its source, and covers both services and families', () => {
    expect(CLOUDFRONT_RANGES.syncToken).toMatch(/^\d+$/);
    expect(CLOUDFRONT_RANGES.services).toEqual(['CLOUDFRONT', 'CLOUDFRONT_ORIGIN_FACING']);
    expect(CLOUDFRONT_RANGES.ipv4.length).toBeGreaterThan(50);
    expect(CLOUDFRONT_RANGES.ipv6.length).toBeGreaterThan(10);
    for (const r of [...CLOUDFRONT_RANGES.ipv4, ...CLOUDFRONT_RANGES.ipv6]) expect(() => parseCidr(r), r).not.toThrow();
    for (const a of [CF_PROXY, CF_EDGE, CF_EDGE_2, CF_V6]) expect(isCloudFrontAddress(a), a).toBe(true);
    for (const a of ['198.51.100.7', '203.0.113.10', '2001:db8::1', undefined, 'garbage']) expect(isCloudFrontAddress(a), String(a)).toBe(false);
  });
});

describe('viewerAddress (D12, CloudFront-gated)', () => {
  it('H1: a source address outside CloudFront keys on sourceIp whatever hops it forges', () => {
    for (const forged of [xff('192.0.2.1', CF_EDGE, CF_PROXY), xff('192.0.2.2', '192.0.2.3', '192.0.2.4'), xff(CF_EDGE, CF_PROXY), '']) {
      expect(viewerAddress('198.51.100.66', forged)).toEqual({ address: '198.51.100.66', source: 'source_ip', viaCloudFront: false });
    }
  });

  it('via CloudFront, the observed viewer, edge, proxy chain keys on the viewer', () => {
    expect(viewerAddress(CF_PROXY, xff('198.51.100.7', CF_EDGE, CF_PROXY))).toEqual({ address: '198.51.100.7', source: 'viewer_hop', viaCloudFront: true });
  });

  it('via CloudFront, forged leading hops (CloudFront-looking or not) never move the key', () => {
    for (const forged of ['10.9.9.9', CF_EDGE, `203.0.113.1, ${CF_EDGE_2}`]) {
      expect(viewerAddress(CF_PROXY, xff(forged, '198.51.100.7', CF_EDGE, CF_PROXY)).address).toBe('198.51.100.7');
    }
  });

  it('M1: walks past any number of CloudFront hops (a 4-infrastructure-hop chain, mixed v4 and v6)', () => {
    expect(viewerAddress(CF_PROXY, xff('192.0.2.200', '198.51.100.7', CF_EDGE, CF_V6, CF_EDGE_2, CF_PROXY))).toEqual({
      address: '198.51.100.7',
      source: 'viewer_hop',
      viaCloudFront: true,
    });
  });

  it('via CloudFront with only CloudFront hops (or none), falls back to sourceIp', () => {
    expect(viewerAddress(CF_PROXY, xff(CF_EDGE, CF_PROXY))).toEqual({ address: CF_PROXY, source: 'source_ip', viaCloudFront: true });
    expect(viewerAddress(CF_PROXY, undefined)).toEqual({ address: CF_PROXY, source: 'source_ip', viaCloudFront: true });
  });

  it('M2: an IPv6 viewer is keyed on its /64 and an IPv4-mapped viewer on its IPv4', () => {
    expect(viewerAddress(CF_PROXY, xff('2001:DB8:aa:bb::1', CF_EDGE, CF_PROXY)).address).toBe('2001:0db8:00aa:00bb::/64');
    expect(viewerAddress(CF_PROXY, xff('::ffff:198.51.100.20', CF_EDGE, CF_PROXY)).address).toBe('198.51.100.20');
    expect(viewerAddress('2001:db8:1:2::a', undefined).address).toBe('2001:0db8:0001:0002::/64');
  });
});

describe('forwardedForKeys (D12 diagnostic, M3)', () => {
  const SECRET = 'x'.repeat(40);
  it('keys the last 5 hops and counts them all', () => {
    const hops = Array.from({ length: 8 }, (_, i) => `10.0.0.${i}`);
    const out = forwardedForKeys(SECRET, hops.join(','));
    expect(out.hops).toBe(8);
    expect(out.keys).toEqual(forwardedForKeys(SECRET, hops.slice(-5).join(',')).keys);
    expect(forwardedForKeys(SECRET, undefined)).toEqual({ keys: [], hops: 0 });
  });
});
