import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { installSkill } from '../packages/cli/lib/skill.mjs';
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
describe('companion skill installation', () => {
  it('installs the complete skill and supports identical repeat installs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'iparoom-skill-test-'));
    dirs.push(dir);
    const result = await installSkill(resolve('skills/iparoom-install'), dir);
    expect(result.status).toBe('installed');
    expect(await readFile(join(result.path, 'SKILL.md'), 'utf8')).toContain(
      'name: iparoom-install'
    );
    expect(await readFile(join(result.path, 'scripts/verify-share.py'), 'utf8')).toContain(
      'deviceInstallation'
    );
    expect((await installSkill(resolve('skills/iparoom-install'), dir)).status).toBe(
      'already-installed'
    );
  });
  it('preserves an existing skill with local modifications', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'iparoom-skill-test-'));
    dirs.push(dir);
    const result = await installSkill(resolve('skills/iparoom-install'), dir);
    const path = join(result.path, 'SKILL.md');
    const original = await readFile(path, 'utf8');
    await writeFile(path, original + '\nLocal workflow adjustment.\n');
    await expect(installSkill(resolve('skills/iparoom-install'), dir)).rejects.toThrow(
      'not overwritten'
    );
    expect(await readFile(path, 'utf8')).toContain('Local workflow adjustment.');
  });
});
