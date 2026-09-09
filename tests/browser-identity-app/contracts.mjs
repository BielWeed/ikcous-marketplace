/* eslint-disable security/detect-object-injection -- Query keys require Object.hasOwn on the closed local route table before indexing. */
import assert from 'node:assert/strict';
import { classifyOfflineException, assertCutTransport } from './offline.mjs';
export const serviceHost = 'abcdefghijklmnopqrst.supabase.co';
export const serviceOrigin = 'https://' + serviceHost;
export const publicKey = 'a6c-public-artificial-key-no-account';
const routes = [
  ['config', '/rest/v1/v_store_config', { select: '*' }],
  ['products', '/rest/v1/vw_produtos_public', { select: '*,product_variants(*)', limit: '200', order: 'data_cadastro.desc' }],
  ['categories', '/rest/v1/categorias', { select: '*', order: 'nome.asc' }],
  ['banners', '/rest/v1/banners', { select: '*', order: 'order.asc' }],
  ['catchup', '/rest/v1/vw_produtos_public', { select: 'id,ultima_atualizacao' }],
];
export function serviceRoute(value) {
  if (!value.startsWith('/')) return null;
  const url = new URL(value, serviceOrigin);
  if (url.origin !== serviceOrigin || url.hash) return null;
  for (const [kind, pathname, query] of routes) {
    const pairs = [...url.searchParams];
    if (url.pathname === pathname && pairs.length === Object.keys(query).length &&
      pairs.every(([key, val]) => Object.hasOwn(query, key) && query[key] === val) &&
      new Set(pairs.map(([key]) => key)).size === pairs.length) return kind;
  }
  return null;
}
export function assertView(view, name) {
  assert(!view.loader, 'LOADER_PRESENT');
  assert(view.header, 'HEADER_ABSENT');
  assert.equal(view.alt, name, 'HEADER_NAME');
  assert(view.naturalWidth > 0 && view.naturalHeight > 0, 'IMAGE_UNLOADED');
  assert(view.width > 0 && view.height > 0 && view.x >= 0 && view.y >= 0 &&
    view.x + view.width <= view.viewportWidth + 1 &&
    view.y + view.height <= view.viewportHeight + 1, 'IMAGE_CLIPPED');
  assert(view.scrollWidth <= view.documentWidth + 1, 'HORIZONTAL_OVERFLOW');
}
export function assertRevision(actual, expected) {
  assert.equal(actual, expected, 'REVISION_MISMATCH');
}
const fontURL = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap';
function requestClass(value, contract) {
  if (!value) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (value === fontURL) return 'font-refused';
  if (url.origin === contract.origin && !url.search && !url.hash &&
    contract.localPaths.has(url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1)))) return 'local';
  if (url.origin === serviceOrigin && (serviceRoute(url.pathname + url.search) || contract.logos.has(value))) return 'service';
  if (url.origin === serviceOrigin.replace('https:', 'wss:') && url.pathname === '/realtime/v1/websocket') {
    const pairs = [...url.searchParams];
    if (pairs.length === 3 && new Set(pairs.map(([key]) => key)).size === 3 &&
      url.searchParams.get('apikey') === '[public-key-redacted]' && url.searchParams.get('vsn') === '2.0.0' &&
      url.searchParams.get('events_per_second') === '10') return 'realtime-refused';
  }
  if (url.protocol === 'data:' || url.protocol === 'blob:' || value === 'about:blank') return 'non-network';
  return null;
}
export function assertObservations(events, transportEvents, contract) {
  const classifications = [];
  for (const [index, event] of events.entries()) {
    assert(!['pageerror', 'observer-error'].includes(event.kind), 'OBSERVATION_FAILURE ' + event.kind + ' ' + (event.message ?? event.text ?? ''));
    if (event.kind === 'sw-exception') classifications.push(classifyOfflineException(index, events, transportEvents, contract));
    if (!['request', 'network-response', 'network-failed', 'websocket', 'websocket-error'].includes(event.kind)) continue;
    const classification = requestClass(event.url, contract);
    assert(classification, 'UNEXPECTED_APP_REQUEST ' + event.url);
    if (event.responseURL) assert(requestClass(event.responseURL, contract), 'UNEXPECTED_RESPONSE_URL ' + event.responseURL);
    if (event.kind === 'request') assert(['GET', 'OPTIONS'].includes(event.method), 'UNEXPECTED_APP_METHOD');
    if (event.kind === 'websocket' || event.kind === 'websocket-error') assert.equal(classification, 'realtime-refused', 'UNKNOWN_WEBSOCKET');
    if (event.kind === 'network-failed') {
      assert(!event.blockedReason && !event.corsErrorStatus, 'NETWORK_POLICY_FAILURE');
      const expected = event.offline || classification === 'font-refused' || classification === 'realtime-refused' || (event.canceled && event.error === 'net::ERR_ABORTED');
      assert(expected, 'UNEXPECTED_NETWORK_FAILURE ' + event.url + ' ' + event.error);
    }
    if (event.kind === 'network-response') assert(event.status < 400 || classification === 'font-refused' || classification === 'realtime-refused', 'UNEXPECTED_HTTP_STATUS ' + event.status + ' ' + event.url);
  }
  for (const event of transportEvents) {
    // Unattributed proxy traffic stays unattributed; it never exempts an observed app request.
    assert(event.type !== 'deny' || event.reason === 'proxy-background-or-external', 'UNEXPECTED_APP_OR_SERVICE_REQUEST ' + event.url);
    assert(event.type !== 'websocket-denied' || event.known, 'UNKNOWN_WEBSOCKET');
  }
  for (const cut of contract.offlineCuts ?? []) assertCutTransport(cut, transportEvents);
  return classifications;
}
export function publicRow(snapshot) {
  const identity = snapshot.identity;
  return {
    business_hours: null, created_at: null, enable_coupons: false, enable_reviews: false,
    enabled_shipping_methods: [], free_shipping_min: 100, home_sections: [], id: 1,
    local_cep_range: null, local_delivery_fee: 0, logo_url: identity.urls.header,
    min_app_version: null, origin_cep: null, primary_color: identity.theme.primary,
    secondary_color: identity.theme.secondary, accent_color: identity.theme.accent,
    branding_assets: identity.assets, push_marketing_enabled: false,
    real_time_sales_alerts: false, share_text: 'Loja artificial de ensaio',
    shipping_coverage: 'local', shipping_fee: 0, shipping_provider: 'manual',
    store_city: identity.city, store_name: identity.storeName, store_state: identity.state,
    theme_mode: 'light', updated_at: null, whatsapp_number: null,
  };
}
