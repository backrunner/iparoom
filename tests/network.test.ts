import { describe, expect, it } from 'vitest';
import { lanAddress, lanOrigin, privateIPv4 } from '../scripts/network.mjs';
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
  it('replaces localhost share origins with device-reachable LAN URLs', () => {
    expect(lanOrigin(undefined, '192.168.1.10', 5173)).toBe('http://192.168.1.10:5173');
    expect(lanOrigin('http://localhost:5173', '192.168.1.10', 3000)).toBe(
      'http://192.168.1.10:3000'
    );
    expect(lanOrigin('https://192.168.1.10:8443', '192.168.1.10', 3000)).toBe(
      'https://192.168.1.10:8443'
    );
    expect(() => lanOrigin('https://user:password@192.168.1.10', '192.168.1.10', 3000)).toThrow();
  });
});
