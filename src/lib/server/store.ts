import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { settings } from './config';
import type { Build } from '$lib/types';
let db: DatabaseSync | undefined;
process.on('iparoom:shutdown', () => {
  db?.close();
  db = undefined;
});
export function database() {
  if (!db) {
    mkdirSync(settings().dataDir, { recursive: true, mode: 0o700 });
    db = new DatabaseSync(join(settings().dataDir, 'iparoom.sqlite'));
    db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS builds (id TEXT PRIMARY KEY, share_token TEXT UNIQUE, metadata TEXT NOT NULL)'
    );
  }
  return db;
}
export function listBuilds(): Build[] {
  return (
    database().prepare('SELECT metadata FROM builds ORDER BY rowid DESC').all() as {
      metadata: string;
    }[]
  ).map((row) => JSON.parse(row.metadata));
}
export function findBuild(id: string): Build | null {
  const row = database().prepare('SELECT metadata FROM builds WHERE id = ?').get(id) as
    { metadata: string } | undefined;
  return row ? JSON.parse(row.metadata) : null;
}
export function findShared(token: string): Build | null {
  if (!/^[a-f0-9]{48}$/.test(token)) return null;
  const row = database().prepare('SELECT metadata FROM builds WHERE share_token = ?').get(token) as
    { metadata: string } | undefined;
  return row ? JSON.parse(row.metadata) : null;
}
export function saveBuild(build: Build) {
  database()
    .prepare('INSERT INTO builds (id, share_token, metadata) VALUES (?, ?, ?)')
    .run(build.id, build.shareToken, JSON.stringify(build));
}
export function changeShare(id: string, enabled: boolean): Build | null {
  const build = findBuild(id);
  if (!build) return null;
  build.shareToken = enabled ? randomBytes(24).toString('hex') : null;
  database()
    .prepare('UPDATE builds SET share_token = ?, metadata = ? WHERE id = ?')
    .run(build.shareToken, JSON.stringify(build), id);
  return build;
}
export function removeBuild(id: string) {
  database().prepare('DELETE FROM builds WHERE id = ?').run(id);
}
export function ipaPath(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid build ID');
  return join(settings().dataDir, `${id}.ipa`);
}
