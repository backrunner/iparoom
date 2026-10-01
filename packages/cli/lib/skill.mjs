import { cp, mkdir, lstat, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
async function digestTree(root) {
  const hash = createHash('sha256');
  async function walk(folder, prefix = '') {
    for (const name of (await readdir(folder)).sort()) {
      const path = join(folder, name),
        relative = `${prefix}${name}`,
        info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error('Skill directory must not contain symlinks.');
      hash.update(relative + '\0');
      if (info.isDirectory()) await walk(path, `${relative}/`);
      else hash.update(await readFile(path));
    }
  }
  await walk(root);
  return hash.digest('hex');
}
export async function installSkill(source, directory) {
  const base = resolve(
    directory || join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'skills')
  );
  const target = join(base, 'iparoom-install');
  await lstat(join(source, 'SKILL.md'));
  let exists = false;
  try {
    const info = await lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error('Skill destination is not a regular directory.');
    exists = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (exists) {
    if ((await digestTree(source)) !== (await digestTree(target)))
      throw new Error(
        `Existing skill differs: ${target}. Review changes or choose another --path; it was not overwritten.`
      );
    return { name: 'iparoom-install', path: target, status: 'already-installed' };
  }
  await mkdir(base, { recursive: true });
  await cp(source, target, { recursive: true, force: false, errorOnExist: true });
  return { name: 'iparoom-install', path: target, status: 'installed' };
}
