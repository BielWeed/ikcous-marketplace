/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection -- Fixed owned evidence roots, byte-verified kit, closed store/role keys; no remote file paths. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildStore } from '../../scripts/buildStore.mjs';
import { readPrecache } from '../identity-real-kit-build/run.mjs';
import { serviceOrigin, publicKey } from './contracts.mjs';
import { root, kit, approvedHash, git, hash, write, preserve, absentEnv, sourceDigests, physical } from './evidence.mjs';

export async function buildOne(directory, store, phase, codeSha) {
  await absentEnv();
  assert.equal(git(['rev-parse', 'HEAD']), codeSha);
  const before = await sourceDigests();
  let snapshot;
  let inputs;
  const publicDefines = { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(serviceOrigin), 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(publicKey) };
  const plugin = {
    name: 'a6c-fixture-public-service-defines',
    config() {
      assert.equal(process.env.IKCOUS_IDENTITY_MODE, 'fixture');
      assert(!process.env.VERCEL && !process.env.CF_PAGES, 'HOSTING_FORBIDDEN');
      assert(Object.keys(process.env).every(key => !/^(VITE_SUPABASE_|SUPABASE_|DATABASE_URL$)/.test(key)), 'SERVICE_ENV_FORBIDDEN');
      return { define: publicDefines };
    },
    configResolved(config) {
      snapshot = JSON.parse(config.define.__STORE_IDENTITY__);
      assert.equal(snapshot.source, 'fixture');
      assert.equal(snapshot.publicUrl, 'https://loja-ensaio.invalid');
      assert(!Object.hasOwn(config.define, 'import.meta.env'), 'WHOLE_ENV_FORBIDDEN');
      inputs = { root: config.root, envDir: config.envDir, mode: config.mode, outDir: config.build.outDir, plugins: config.plugins.map(p => p.name), define: config.define, syntheticFields: Object.keys(publicDefines) };
    },
  };
  const marker = await buildStore({ root, envFile: false, logLevel: 'warn', plugins: [plugin] });
  assert.deepEqual(await sourceDigests(), before, 'SOURCES_CHANGED_DURING_BUILD');
  assert.equal(marker.promotable, false);
  assert.equal(marker.identityRevision, snapshot.identityRevision);
  assert.equal(snapshot.codeSha, codeSha);
  assert.equal(inputs.outDir, 'dist-test');
  assert.equal(inputs.envDir, false);
  const label = store + '-' + phase;
  const artifact = path.join(directory, label);
  const hashes = await preserve(path.join(root, 'dist-test'), artifact);
  await write(directory, label + '-hashes.json', hashes);
  await write(directory, label + '-snapshot.json', snapshot);
  await write(directory, label + '-inputs.json', inputs);
  const manifest = JSON.parse(await fs.readFile(path.join(kit, 'manifesto.json')));
  assert.equal(hash(await fs.readFile(path.join(kit, 'manifesto.json'))), approvedHash);
  assert.deepEqual(snapshot.identity.assets, manifest.stores[store]);
  const assets = snapshot.identity.assets;
  const descriptors = new Map([...assets.originals, ...['header', 'loader', 'favicon', 'apple_touch', 'icon_192', 'icon_512', 'maskable_512', 'og'].map(role => assets[role])].map(asset => [asset.path, asset]));
  for (const asset of descriptors.values()) {
    const output = await fs.readFile(path.join(artifact, 'store-identity', asset.path));
    assert.equal(hash(output), asset.sha256);
    assert.equal(output.length, asset.bytes);
    assert.deepEqual(output, await fs.readFile(path.join(kit, 'objetos', asset.path.slice(3))));
  }
  const precache = readPrecache(await fs.readFile(path.join(artifact, 'sw.js'), 'utf8'));
  const essential = [...new Set(['header', 'loader', 'favicon', 'apple_touch', 'icon_192', 'icon_512', 'maskable_512'].map(role => snapshot.localUrls[role].slice(1)))].sort();
  assert.deepEqual([...new Set(precache.filter(x => x.url.startsWith('store-identity/')).map(x => x.url))].sort(), essential);
  await write(directory, label + '-precache.json', precache);
  console.log('A6C_BUILD_PASS ' + label + ' ' + marker.identityRevision);
}

export async function buildAll(directory, codeSha) {
  const artifacts = {};
  await absentEnv();
  const existing = path.join(root, 'dist-test');
  await physical(existing);
  await write(directory, 'previous-output-hashes.json', await preserve(existing, path.join(directory, 'previous-output')));
  for (const store of ['ikcous', 'savy']) for (const phase of ['baseline', 'update']) {
    const label = store + '-' + phase;
    const selector = path.join(directory, label + '-selector.json');
    await write(directory, label + '-selector.json', { kind: 'local-kit', directory: kit, expectedManifestSha256: approvedHash, store, phase });
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SYSTEMROOT|WINDIR|SYSTEMDRIVE|COMSPEC|PATHEXT|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMDATA|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i.test(key)));
    Object.assign(env, { IKCOUS_IDENTITY_MODE: 'fixture', IKCOUS_CODE_SHA: codeSha, IKCOUS_IDENTITY_FIXTURE_FILE: selector });
    const script = `import { buildOne } from ${JSON.stringify(import.meta.url)}; await buildOne(${JSON.stringify(directory)}, ${JSON.stringify(store)}, ${JSON.stringify(phase)}, ${JSON.stringify(codeSha)});`;
    const child = spawn(process.execPath, ['--input-type=module', '--eval', script], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const chunks = [];
    child.stdout.on('data', chunk => { chunks.push(chunk); process.stdout.write(chunk); });
    child.stderr.on('data', chunk => { chunks.push(chunk); process.stderr.write(chunk); });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    await write(directory, label + '-build.log', Buffer.concat(chunks));
    assert.equal(code, 0, 'BUILD_FAILED ' + label);
    artifacts[label] = { directory: path.join(directory, label), snapshot: JSON.parse(await fs.readFile(path.join(directory, label + '-snapshot.json'))), precache: JSON.parse(await fs.readFile(path.join(directory, label + '-precache.json'))) };
  }
  return artifacts;
}
