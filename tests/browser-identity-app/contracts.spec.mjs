import assert from 'node:assert/strict';
import test from 'node:test';
import { serviceRoute, assertView, assertRevision } from './contracts.mjs';

test('public requests have a closed query contract, including duplicates', () => {
  assert.equal(serviceRoute('/rest/v1/v_store_config?select=*'), 'config');
  assert.equal(serviceRoute('/rest/v1/categorias?order=nome.asc&select=*'), 'categories');
  assert.equal(serviceRoute('/rest/v1/vw_produtos_public?select=*,product_variants(*)&limit=200&order=data_cadastro.desc'), 'products');
  assert.equal(serviceRoute('/rest/v1/banners?select=*&order=order.asc'), 'banners');
  for (const url of ['', '/rest/v1/users', '/rest/v1/banners?select=id&limit=1', '/rest/v1/v_store_config?select=*&select=*', '/rest/v1/v_store_config?select=*&extra=1'])
    assert.equal(serviceRoute(url), null);
});

const view = { loader: false, header: true, alt: 'Ensaio', naturalWidth: 100, naturalHeight: 50, x: 1, y: 1, width: 100, height: 50, viewportWidth: 390, viewportHeight: 844, scrollWidth: 390, documentWidth: 390 };
test('loader left in captured page and missing image reject acceptance', () => {
  assert.doesNotThrow(() => assertView(view, 'Ensaio'));
  assert.throws(() => assertView({ ...view, loader: true }, 'Ensaio'), /LOADER/);
  assert.throws(() => assertView({ ...view, naturalWidth: 0 }, 'Ensaio'), /IMAGE/);
  assert.throws(() => assertView({ ...view, x: 380 }, 'Ensaio'), /CLIPPED/);
  assert.throws(() => assertView({ ...view, scrollWidth: 450 }, 'Ensaio'), /HORIZONTAL/);
});
test('prior revision cannot certify update', () => {
  assert.doesNotThrow(() => assertRevision('new', 'new'));
  assert.throws(() => assertRevision('old', 'new'), /REVISION/);
});
