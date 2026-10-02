import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { hostname } from './network.mjs';
const exec = promisify(execFile);
export function ponteHostname(value) {
  const name = hostname(value);
  if (!/^[a-z0-9_-]+\.sgponte$/i.test(name))
    throw new Error('Ponte hostname must be <device-name>.sgponte.');
  return name;
}
// Only use an explicit Ponte identity, never guess it from the macOS computer name.
export function ponteFromStatus(status) {
  if (!status || typeof status !== 'object') return null;
  const ponte = status.ponte;
  if (ponte?.enabled === false || status['ponte-enabled'] === false) return null;
  const domain = ponte?.hostname || ponte?.domain || status['ponte-hostname'];
  const name = ponte?.['device-name'] || status['ponte-device-name'];
  try {
    return domain ? ponteHostname(domain) : name ? ponteHostname(`${name}.sgponte`) : null;
  } catch {
    return null;
  }
}
export async function detectPonte(options = {}) {
  if (options.ponte === false || process.env.IPAROOM_PONTE === '0')
    return { hostname: null, source: 'disabled' };
  const configured = options.ponteHostname || process.env.IPAROOM_PONTE_HOSTNAME;
  if (configured) return { hostname: ponteHostname(configured), source: 'configured' };
  if (process.platform !== 'darwin') return { hostname: null, source: 'unavailable' };
  try {
    const { stdout } = await exec(
      '/Applications/Surge.app/Contents/Applications/surge-cli',
      ['--raw', 'status'],
      { timeout: 2000, maxBuffer: 1024 * 1024 }
    );
    const name = ponteFromStatus(JSON.parse(stdout));
    return { hostname: name, source: name ? 'surge-cli' : 'not-reported' };
  } catch {
    return { hostname: null, source: 'unavailable' };
  }
}
