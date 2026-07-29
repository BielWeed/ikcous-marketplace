/**
 * SW v29 — THE PHOENIX: ANTI-ZOMBIE PROTOCOL
 * Estratégia Nuclear de Cache e Revalidação.
 */

const sw = self as any;

// A variável __APP_VERSION__ é injetada pelo Vite (definida em vite.config.ts)
declare const __APP_VERSION__: string;
const getVersion = () => {
  try {
    return __APP_VERSION__;
  } catch {
    return "fallback";
  }
};
const CACHE_NAME = `app-cache-${getVersion()}`;
const IMAGE_CACHE_NAME = "supabase-images-cache";
const MAX_IMAGE_ENTRIES = 100;

// self.__WB_MANIFEST is the injection point for the precache manifest
// We must include it even if we handle caching manually to satisfy Workbox.
declare const self: any;
const precacheManifest = self.__WB_MANIFEST || [];
console.log("[SW] Precache Manifest received:", precacheManifest.length);

sw.addEventListener("install", (event: any) => {
  // Cache precacheManifest files
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      const urls = Array.from(
        new Set(precacheManifest.map((entry: any) => entry.url)),
      ) as string[];
      console.log(
        "[SW] Caching precache manifest URLs (deduplicated):",
        urls.length,
      );
      return cache
        .addAll(urls)
        .catch((err) => console.warn("[SW] Precache failed:", err));
    }),
  );
  console.log("[SW] Installing new version. Waiting for user/client activation signal...");
});

sw.addEventListener("activate", (event: any) => {
  event.waitUntil(
    Promise.all([
      // Assume o controle imediatamente
      sw.clients.claim(),
      // CACHE PURGE: Deleta caches antigos
      caches
        .keys()
        .then((cacheNames) => {
          const cachesToDelete = cacheNames.filter(
            (name) => name !== CACHE_NAME && name !== IMAGE_CACHE_NAME,
          );
          return Promise.all(
            cachesToDelete.map((name) => {
              console.log(`[SW] Purging old cache: ${name}`);
              return caches.delete(name);
            }),
          );
        }),
    ]),
  );
});

let networkQuality = "fast";

sw.addEventListener("fetch", (event: any) => {
  const url = new URL(event.request.url);

  // Ignorar requisições de extensões do Chrome, DevTools e protocolos não-http
  if (!url.protocol.startsWith("http")) return;

  // 1. FILTRAGEM ESTRITA: Ignorar o que não deve ser cacheado
  // Ignorar requisições que não sejam GET (POST, PUT, etc)
  if (event.request.method !== "GET") return;

  // Ignorar serviços de logs e telemetria (causam erro de clone/stream)
  if (url.hostname.includes("vercel.app") && url.pathname.includes("logs"))
    return;
  if (url.hostname.includes("supabase.co") && url.pathname.includes("auth"))
    return;

  // 2. NETWORK FIRST: Navegação e metadados críticos
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok && response.status === 200) {
            try {
              const copy = response.clone();
              caches
                .open(CACHE_NAME)
                .then((cache) => cache.put(event.request, copy));
            } catch (e) {
              console.warn("[SW] Failed to clone navigation response:", e);
            }
          }
          return response;
        })
        .catch((err) => {
          console.log(
            "[SW] Navigation fetch failed, attempting cache/SPA fallback:",
            err,
          );
          return caches.match(event.request).then((response) => {
            if (response) return response;
            return caches.match("/index.html").then((fallback) => {
              if (fallback) return fallback;
              return caches.match("/");
            });
          });
        }),
    );
    return;
  }

  // Se for Supabase, ignorar exceto se for imagens (Storage)
  if (url.hostname.includes("supabase.co")) {
    const isSupabaseImage =
      url.pathname.includes("/storage/v1/object/") ||
      url.pathname.includes("/storage/v1/render/");
    if (!isSupabaseImage) return;

    event.respondWith(
      caches.open(IMAGE_CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((cachedResponse) => {
          const fetchPromise = fetch(event.request)
            .then((networkResponse) => {
              if (networkResponse?.status === 200) {
                const responseToCache = networkResponse.clone();
                cache.put(event.request, responseToCache);
                cleanOldImageCache(cache);
              }
              return networkResponse;
            })
            .catch((err) => {
              console.warn("[SW] Supabase image fetch failed:", err);
              if (cachedResponse) return cachedResponse;
              throw err;
            });
          return cachedResponse || fetchPromise;
        });
      }),
    );
    return;
  }

  // 3. STALE-WHILE-REVALIDATE: Assets estáticos (JS, CSS, Imagens)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (
        cachedResponse &&
        (networkQuality === "slow" || networkQuality === "offline")
      ) {
        console.log(
          "[SW] Network is slow/offline. Serving from Cache only (no background fetch):",
          event.request.url,
        );
        return cachedResponse;
      }
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          // Só cachear se for uma resposta válida, de sucesso e do tipo basic/cors
          // Evitamos cachear respostas opaque (status 0) que podem estar corrompidas
          if (networkResponse?.status === 200) {
            try {
              // Robust cache update: only cache valid, successful responses
              const responseToCache = networkResponse.clone();
              if (
                responseToCache?.status === 200 &&
                (responseToCache.type === "basic" ||
                  responseToCache.type === "cors")
              ) {
                caches.open(CACHE_NAME).then((cache) => {
                  cache.put(event.request, responseToCache);
                });
              }
            } catch (e) {
              console.warn("[SW] Failed to cache asset response:", e);
            }
          }
          return networkResponse;
        })
        .catch((err) => {
          console.warn("[SW] Fetch failed for:", event.request.url, err);
          // IMPORTANTE: NÃO retornar um Response dummy (tipo 408) aqui.
          // Se retornar 408, o navegador acha que o chunk carregou mas está vazio/erro,
          // disparando o ChunkLoadError no frontend. Deixamos falhar naturalmente
          // para que o navegador tente outras estratégias ou o erro seja capturado corretamente.
          if (cachedResponse) return cachedResponse;
          throw err;
        });

      return cachedResponse || fetchPromise;
    }),
  );
});

// ETERNAL HEARTBEAT: Listen for pings to stay alive and confirm health.
const heartbeatChannel = new BroadcastChannel("sw-heartbeat");

sw.addEventListener("message", (event: any) => {
  if (event.data === "HEARTBEAT_PING") {
    // Responder ao Sentinel diretamente para evitar o reload de 5m
    if (event.source) {
      event.source.postMessage("HEARTBEAT_ACK");
    } else {
      heartbeatChannel.postMessage("HEARTBEAT_ACK");
    }
  }

  // Workbox generic skipWaiting support
  if (event.data?.type === "SKIP_WAITING") {
    console.log("[SW] SKIP_WAITING received. Activating new version.");
    sw.skipWaiting();
  }

  // Manual cache purge support
  if (event.data?.type === "MANUAL_PURGE") {
    caches.keys().then((cacheNames) => {
      Promise.all(cacheNames.map((name) => caches.delete(name))).then(() => {
        const bc = new BroadcastChannel("sw-messages");
        bc.postMessage({ type: "PURGE_COMPLETE" });
        bc.close();
      });
    });
  }

async function warmSingleUrl(url: string, imgCache: Cache, appCache: Cache) {
  try {
    const parsedUrl = new URL(url, self.location.origin);
    const allowedHosts = [
      self.location.hostname,
      "images.unsplash.com",
      "placehold.co",
    ];
    const isSupabase =
      parsedUrl.hostname.endsWith(".supabase.co") ||
      parsedUrl.hostname === "supabase.co";

    if (!allowedHosts.includes(parsedUrl.hostname) && !isSupabase) {
      console.warn(
        "[SW] Blocked cache warming for untrusted host:",
        parsedUrl.hostname,
      );
      return;
    }

    const targetCache = isSupabase ? imgCache : appCache;
    const existing = await targetCache.match(url);
    if (existing) return;

    const res = await fetch(url); // ship-safe-ignore
    if (res.ok && res.status === 200) {
      await targetCache.put(url, res);
      if (isSupabase) {
        cleanOldImageCache(imgCache);
      }
    }
  } catch (e) {
    console.warn("[SW] Warm fetch failed for:", url, e);
  }
}

  if (event.data?.type === "WARM_CACHE") {
    const urls: string[] = event.data.urls || [];
    console.log("[SW] WARM_CACHE received. Warming:", urls.length, "URLs");

    Promise.all([caches.open(CACHE_NAME), caches.open(IMAGE_CACHE_NAME)]).then(
      async ([appCache, imgCache]) => {
        for (const url of urls) {
          await warmSingleUrl(url, imgCache, appCache);
        }
      },
    );
  }

  if (event.data?.type === "SET_NETWORK_QUALITY") {
    networkQuality = event.data.quality || "fast";
    console.log("[SW] Network quality updated to:", networkQuality);
  }
});

// Auto-ping a cada 30s para manter o worker ativo em alguns navegadores
setInterval(() => {
  // Keep alive logic
}, 30000);

sw.addEventListener("push", (event: any) => {
  if (!event.data) return;
  try {
    const payload = event.data.json();
    const title = payload.title || "Novidade!";
    const options = {
      body: payload.body || "",
      icon: "/icon-192x192.png",
      badge: "/icon-192x192.png",
      data: {
        url: payload.url || "/",
        ...payload.data,
      },
    };
    event.waitUntil(sw.registration.showNotification(title, options));
  } catch (e) {
    console.error("[SW] Push parse error:", e);
    event.waitUntil(
      sw.registration.showNotification("Notificação", {
        body: event.data.text(),
      }),
    );
  }
});

sw.addEventListener("notificationclick", (event: any) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    sw.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList: any) => {
        const absoluteUrl = new URL(targetUrl, sw.location.origin).href;
        for (const client of clientList) {
          if (client.url === absoluteUrl && "focus" in client) {
            return client.focus();
          }
        }
        if (sw.clients.openWindow) {
          return sw.clients.openWindow(absoluteUrl);
        }
      }),
  );
});

async function cleanOldImageCache(cache: Cache) {
  try {
    const keys = await cache.keys();
    if (keys.length > MAX_IMAGE_ENTRIES) {
      const keysToDelete = keys.slice(0, keys.length - MAX_IMAGE_ENTRIES);
      for (const key of keysToDelete) {
        console.log("[SW] Cache limit reached. Deleting old image:", key.url);
        await cache.delete(key);
      }
    }
  } catch (e) {
    console.warn("[SW] Image cache cleaning failed:", e);
  }
}
