import { isIP } from 'node:net';
export function privateIPv4(address) {
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
export function lanAddress(interfaces, preferred) {
  if (preferred) {
    if (!privateIPv4(preferred) && preferred !== '127.0.0.1')
      throw new Error('IPAROOM_LAN_HOST must be a private IPv4 address assigned to this machine.');
    if (
      preferred !== '127.0.0.1' &&
      !Object.values(interfaces)
        .flat()
        .some((item) => item?.address === preferred)
    )
      throw new Error('IPAROOM_LAN_HOST is not assigned to a local network interface.');
    return preferred;
  }
  for (const [name, entries] of Object.entries(interfaces)) {
    if (/^(utun|tun|tap|docker|veth|br-)/.test(name)) continue;
    for (const entry of entries ?? [])
      if (!entry.internal && privateIPv4(entry.address)) return entry.address;
  }
  return '127.0.0.1';
}
export function lanOrigin(configured, host, port) {
  if (configured) {
    const url = new URL(configured);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error('IPAROOM_BASE_URL must be an HTTP(S) origin without a path or credentials.');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return url.origin;
  }
  return `http://${host}:${port}`;
}
