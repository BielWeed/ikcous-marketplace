/* eslint-disable security/detect-non-literal-fs-filename -- Local fixed roots and physical ancestors checked; source paths from Git and closed own tree; writes use wx. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
export const root = path.resolve(import.meta.dirname, '../..');
export const control = 'C:/Users/Gabriel/recuperacao-ikcous/20260909-ecossistema/controle';
export const kit = path.join(control, 'identidade-real-a6');
export const approvedHash = 'cb5d259e7a35cd1e1ea7ed1c97e3d73b73cc55e8b71701c2604a59989382d74c';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
export async function physical(target, directory = true) {
  assert(path.isAbsolute(target) && !/^[\\/]{2}/.test(target), 'LOCAL_PATH');
  for (let current = target; ; current = path.dirname(current)) {
    const stat = await fs.lstat(current);
    assert(!stat.isSymbolicLink(), 'NO_LINKS');
    assert(current === target && !directory ? stat.isFile() && stat.nlink === 1 : stat.isDirectory(), 'PHYSICAL_PATH');
    if (current === path.dirname(current)) break;
  }
}
export async function write(directory, name, value) {
  assert(!name.includes('/') && !name.includes('\\') && name !== '..', 'EVIDENCE_NAME');
  await physical(directory);
  await fs.writeFile(path.join(directory, name), typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value, null, 2), { flag: 'wx' });
}
export async function files(directory, relative = '') {
  await physical(path.join(directory, relative));
  const result = [];
  for (const name of (await fs.readdir(path.join(directory, relative))).sort()) {
    const child = path.join(relative, name);
    const stat = await fs.lstat(path.join(directory, child));
    assert(!stat.isSymbolicLink(), 'NO_LINKS');
    if (stat.isDirectory()) result.push(...await files(directory, child));
    else { assert(stat.isFile() && stat.nlink === 1); result.push(child.replaceAll('\\', '/')); }
  }
  return result;
}
export async function digests(directory, names = null) {
  const result = [];
  for (const name of names ?? await files(directory)) {
    const target = path.join(directory, name);
    await physical(target, false);
    const bytes = await fs.readFile(target);
    result.push({ path: name, bytes: bytes.length, sha256: hash(bytes) });
  }
  return result;
}
export async function sourceDigests() {
  const names = git(['ls-files', '-z', '--', 'scripts', 'src', 'public', 'index.html', 'vite.config.ts', 'package.json', 'package-lock.json', 'tsconfig.app.json', 'tsconfig.node.json']).split('\0').filter(Boolean);
  names.push(...(await files(path.join(root, 'tests/browser-identity-app'))).map(x => 'tests/browser-identity-app/' + x));
  assert(names.every(name => !/(^|\/)\.env(?:\.|$)/.test(name)));
  return digests(root, names.sort());
}
export async function preserve(source, destination) {
  const before = await digests(source);
  await fs.mkdir(destination);
  for (const entry of before) {
    const target = path.join(destination, entry.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await physical(path.dirname(target));
    await fs.writeFile(target, await fs.readFile(path.join(source, entry.path)), { flag: 'wx' });
  }
  assert.deepEqual(await digests(destination), before, 'COPY_BYTES');
  return before;
}
export async function absentEnv() {
  for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    const stat = await fs.lstat(path.join(root, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    assert(!stat, 'ENV_FILE_PRESENT');
  }
}
