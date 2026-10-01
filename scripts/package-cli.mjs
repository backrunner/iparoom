import { cp, rm, stat, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(join(root, 'dist'), { recursive: true });
if (process.argv.includes('--build')) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build'], {
      cwd: root,
      stdio: 'inherit'
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Web build failed (${code})`))
    );
  });
}
const source = join(root, 'build'),
  target = join(root, 'packages/cli/runtime/web');
await stat(join(source, 'handler.js'));
await rm(target, { recursive: true, force: true });
await cp(source, target, {
  recursive: true,
  filter: (path) => !path.endsWith('.map') && !path.endsWith('.br') && !path.endsWith('.gz')
});
// The published CLI needs assets and compiled code, never workspace secrets or source maps.
console.log('Bundled SvelteKit server and browser assets into iparoom-cli.');

const skillSource = join(root, 'skills/iparoom-install');
const skillTarget = join(root, 'packages/cli/skills/iparoom-install');
await rm(skillTarget, { recursive: true, force: true });
await cp(skillSource, skillTarget, {
  recursive: true,
  filter: (path) => !path.includes('__pycache__') && !path.endsWith('.pyc')
});
console.log('Bundled iparoom-install agent skill.');
