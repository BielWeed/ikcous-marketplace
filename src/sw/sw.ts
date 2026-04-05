

/**
 * SW v29 — THE PHOENIX: ANTI-ZOMBIE PROTOCOL
 * Estratégia Nuclear de Cache e Revalidação.
 */

const sw = self as any;

// A variável __APP_VERSION__ é injetada pelo Vite (definida em vite.config.ts)
declare const __APP_VERSION__: string;
const CACHE_NAME = `app-cache-${typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'fallback'}`;

// self.__WB_MANIFEST is the injection point for the precache manifest
// We must include it even if we handle caching manually to satisfy Workbox.
declare const self: any;
const precacheManifest = self.__WB_MANIFEST || [];
console.log('[SW] Precache Manifest received:', precacheManifest.length);

sw.addEventListener('install', () => {
    // Força a ativação imediata após a instalação
    sw.skipWaiting();
    console.log('[SW] Installing new version and skipping waiting...');
});

sw.addEventListener('activate', (event: any) => {
    event.waitUntil(
        Promise.all([
            // Assume o controle imediatamente
            sw.clients.claim(),
            // CACHE PURGE: Deleta caches antigos
            caches.keys().then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((name) => {
                        if (name !== CACHE_NAME) {
                            console.log(`[SW] Purging old cache: ${name}`);
                            return caches.delete(name);
                        }
                        return null;
                    })
                );
            })
        ])
    );
});

sw.addEventListener('fetch', (event: any) => {
    const url = new URL(event.request.url);

    // 1. FILTRAGEM ESTRITA: Ignorar o que não deve ser cacheado
    // Ignorar requisições que não sejam GET (POST, PUT, etc)
    if (event.request.method !== 'GET') return;

    // Ignorar serviços de logs e telemetria (causam erro de clone/stream)
    if (url.hostname.includes('vercel.app') && url.pathname.includes('logs')) return;
    if (url.hostname.includes('supabase.co') && url.pathname.includes('auth')) return;

    // 2. NETWORK FIRST: Navegação e metadados críticos
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    if (response.ok && response.status === 200) {
                        try {
                            const copy = response.clone();
                            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                        } catch (e) {
                            console.warn('[SW] Failed to clone navigation response:', e);
                        }
                    }
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // Ignorar Supabase API (não cachear dados dinâmicos aqui)
    if (url.hostname.includes('supabase.co')) return;

    // 3. STALE-WHILE-REVALIDATE: Assets estáticos (JS, CSS, Imagens)
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            const fetchPromise = fetch(event.request).then((networkResponse) => {
                // Só cachear se for uma resposta válida, de sucesso e do tipo basic/cors
                // Evitamos cachear respostas opaque (status 0) que podem estar corrompidas
                if (networkResponse && networkResponse.status === 200) {
                    try {
                        // Robust cache update: only cache valid, successful responses
                const responseToCache = networkResponse.clone();
                if (responseToCache && responseToCache.status === 200 && responseToCache.type === 'basic') {
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
    } catch (e) {
                        console.warn('[SW] Failed to cache asset response:', e);
                    }
                }
                return networkResponse;
            }).catch(err => {
                console.warn('[SW] Fetch failed for:', event.request.url, err);
                // IMPORTANTE: NÃO retornar um Response dummy (tipo 408) aqui.
                // Se retornar 408, o navegador acha que o chunk carregou mas está vazio/erro,
                // disparando o ChunkLoadError no frontend. Deixamos falhar naturalmente
                // para que o navegador tente outras estratégias ou o erro seja capturado corretamente.
                if (cachedResponse) return cachedResponse;
                throw err;
            });

            return cachedResponse || fetchPromise;
        })
    );
});

// ETERNAL HEARTBEAT: Listen for pings to stay alive and confirm health.
const heartbeatChannel = new BroadcastChannel('sw-heartbeat');

sw.addEventListener('message', (event: any) => {
    if (event.data === 'HEARTBEAT_PING') {
        // Responder ao Sentinel para evitar o reload de 60s
        heartbeatChannel.postMessage('HEARTBEAT_ACK');
    }

    // Workbox generic skipWaiting support
    if (event.data && event.data.type === 'SKIP_WAITING') {
        console.log('[SW] SKIP_WAITING received. Activating new version.');
        sw.skipWaiting();
    }

    // Manual cache purge support
    if (event.data && event.data.type === 'MANUAL_PURGE') {
        caches.keys().then((cacheNames) => {
            Promise.all(cacheNames.map((name) => caches.delete(name))).then(() => {
                const bc = new BroadcastChannel('sw-messages');
                bc.postMessage({ type: 'PURGE_COMPLETE' });
                bc.close();
            });
        });
    }
});

// Auto-ping a cada 30s para manter o worker ativo em alguns navegadores
setInterval(() => {
    // Keep alive logic
}, 30000);
