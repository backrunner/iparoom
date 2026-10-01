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
export function listenAddress(interfaces, preferred = '0.0.0.0') {
  if (preferred === '0.0.0.0' || preferred === '127.0.0.1') return preferred;
  if (
    isIP(preferred) !== 4 ||
    !Object.values(interfaces)
      .flat()
      .some((item) => item?.address === preferred)
  )
    throw new Error('--host / IPAROOM_LAN_HOST must be 0.0.0.0 or a local IPv4 address.');
  return preferred;
}
export function hostname(value) {
  const url = new URL(`http://${value}`);
  if (
    url.hostname.toLowerCase() !== value.toLowerCase() ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    ['0.0.0.0', '[::]'].includes(url.hostname)
  )
    throw new Error(
      'Hostname must be a DNS name or IP address, without a scheme, port or path; wildcard addresses cannot appear in links.'
    );
  if (
    !isIP(url.hostname.replace(/^\[|\]$/g, '')) &&
    (url.hostname.length > 253 ||
      !url.hostname
        .split('.')
        .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)))
  )
    throw new Error('Invalid hostname.');
  return url.hostname;
}
export function shareHostname(interfaces, bind, configured) {
  return hostname(configured || (bind === '0.0.0.0' ? lanAddress(interfaces) : bind));
}
export function lanOrigin(configured, host, port, advertised) {
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
    hostname(url.hostname);
    return url.origin;
  }
  return `http://${hostname(advertised || (host === '0.0.0.0' ? '127.0.0.1' : host))}:${port}`;
}
