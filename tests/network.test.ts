import { describe, expect, it } from 'vitest';
import {
  lanAddress,
  lanOrigin,
  privateIPv4,
  listenAddress,
  hostname,
  shareHostname
} from '../scripts/network.mjs';
const network = {
  en0: [{ address: '192.168.1.10', internal: false }],
  utun0: [{ address: '10.1.1.1', internal: false }]
};
describe('LAN startup', () => {
  it('selects a private LAN interface and excludes VPN interfaces', () => {
    expect(lanAddress(network)).toBe('192.168.1.10');
    expect(lanAddress({ utun0: network.utun0, en0: network.en0 })).toBe('192.168.1.10');
    expect(lanAddress({})).toBe('127.0.0.1');
  });
  it('requires explicit host overrides to belong to this machine', () => {
    expect(lanAddress(network, '192.168.1.10')).toBe('192.168.1.10');
    expect(() => lanAddress(network, '192.168.1.20')).toThrow('not assigned');
    expect(() => lanAddress(network, '0.0.0.0')).toThrow('private');
  });
  it('recognizes RFC1918 ranges', () => {
    for (const value of ['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.10'])
      expect(privateIPv4(value)).toBe(true);
    for (const value of ['172.32.0.1', '8.8.8.8', '127.0.0.1'])
      expect(privateIPv4(value)).toBe(false);
  });
  it('keeps explicit URL origins and rejects credentials', () => {
    expect(lanOrigin(undefined, '192.168.1.10', 5173)).toBe('http://192.168.1.10:5173');
    expect(lanOrigin('http://localhost:5173', '192.168.1.10', 3000)).toBe('http://localhost:5173');
    expect(lanOrigin('https://192.168.1.10:8443', '192.168.1.10', 3000)).toBe(
      'https://192.168.1.10:8443'
    );
    expect(() => lanOrigin('https://user:password@192.168.1.10', '192.168.1.10', 3000)).toThrow();
  });
});

describe('separate listening and advertised hostname', () => {
  it('binds every interface by default without advertising a wildcard address', () => {
    expect(listenAddress(network)).toBe('0.0.0.0');
    expect(listenAddress(network, '0.0.0.0')).toBe('0.0.0.0');
    expect(listenAddress(network, '127.0.0.1')).toBe('127.0.0.1');
    expect(() => listenAddress(network, '192.168.1.20')).toThrow();
    expect(shareHostname(network, '0.0.0.0')).toBe('192.168.1.10');
    expect(shareHostname({}, '0.0.0.0')).toBe('127.0.0.1');
  });
  it('uses a certificate hostname independently of the listening interface', () => {
    expect(shareHostname(network, '0.0.0.0', 'ipa.example.test')).toBe('ipa.example.test');
    expect(lanOrigin(undefined, '0.0.0.0', 8443, 'ipa.example.test')).toBe(
      'http://ipa.example.test:8443'
    );
  });
  it('rejects URL components, wildcard hosts and malformed DNS labels', () => {
    for (const name of [
      'https://ipa.test',
      'ipa.test:8443',
      'ipa.test:',
      'user@ipa.test',
      'ipa.test/path',
      '0.0.0.0',
      '[::]',
      '-ipa.test',
      'bad_name.test'
    ])
      expect(() => hostname(name), name).toThrow();
    expect(hostname('IPA.EXAMPLE.TEST')).toBe('ipa.example.test');
    expect(hostname('192.168.1.10')).toBe('192.168.1.10');
    expect(() => lanOrigin('http://0.0.0.0:3000', '0.0.0.0', 3000)).toThrow();
  });
});

describe('MCP Host and Origin protection', () => {
  it('accepts URL-normalized default-port hosts without accepting unconfigured names or ports', async () => {
    const { mcpAddresses } = await import('../packages/cli/lib/network.mjs');
    for (const [scheme, port] of [
      ['https', 443],
      ['http', 80]
    ] as const) {
      const { allowedHosts, allowedOrigins } = mcpAddresses(
        ['ipa.lan', '::1'],
        port,
        scheme === 'https'
      );
      for (const name of ['ipa.lan', '[::1]']) {
        const url = new URL(`${scheme}://${name}:${port}/mcp`);
        expect(allowedHosts).toContain(url.host);
        expect(allowedOrigins).toContain(url.origin);
      }
      expect(allowedHosts).not.toContain('evil.lan');
      expect(allowedHosts).not.toContain('ipa.lan:3001');
    }
    const custom = mcpAddresses(['ipa.lan'], 3001, true);
    expect(custom.allowedHosts).not.toContain('ipa.lan');
    expect(custom.allowedOrigins).not.toContain('https://ipa.lan');
  });
});
