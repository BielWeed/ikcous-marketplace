/**
 * SW v29 — THE PHOENIX: ANTI-ZOMBIE PROTOCOL
 * Estratégia Nuclear de Cache e Revalidação.
 */

import type { FichaDaLoja } from "../config/fichaDaLojaContract";
import {
  CAMINHO_IDENTIDADE_JSON,
  FICHA_DA_LOJA_ID,
} from "../config/fichaDaLojaContract";

const sw = self as any;

// Com um único build para toda a frota (etapa 2 da escala, 11/09/2026), o SW
// não tem `document` e não recebe `__STORE_IDENTITY__` por loja — a ficha da
// loja (marca + conexão) chega pelo mesmo JSON que o porteiro serve em
// CAMINHO_IDENTIDADE_JSON. Guardada aqui, num cache PRÓPRIO (nome que o
// `activate` abaixo NÃO apaga), para o `push` ler sem depender do build.
const IDENTIDADE_CACHE_NAME = "ikcous-identidade";

// O ícone ASSADO vem direto do define `__STORE_IDENTITY__` (declarado em
// src/vite-env.d.ts), e NÃO de `src/config/buildIdentity` — aquele módulo
// passou a ler a ficha da loja (T1 da etapa 2) e arrasta o validador da
// identidade (zod) para dentro de quem o importa. Medido em 11/09/2026: com
// o import, o `sw.js` publicado saltava de 12,7 KB para 543 KB (76 módulos
// de zod) — e `npm run size` não acusa porque só mede `assets/*.js`. Aqui só
// se precisa de UM campo; o define entrega esse campo sem custo.
const ICONE_ASSADO: string = __STORE_IDENTITY__.localUrls.icon_192;

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
  console.log(
    "[SW] Installing new version. Waiting for user/client activation signal...",
  );

  // A ficha da loja, fora do <head>: busca própria, sem bloquear o install
  // se o porteiro estiver fora do ar ou o build ainda for o antigo (que não
  // serve este caminho) — daí um waitUntil separado, com o erro contido nele.
  event.waitUntil(
    fetch(CAMINHO_IDENTIDADE_JSON, { cache: "no-store" })
      .then((resposta: any) => {
        if (!resposta?.ok) return;
        return caches
          .open(IDENTIDADE_CACHE_NAME)
          .then((cache) => cache.put(CAMINHO_IDENTIDADE_JSON, resposta));
      })
      .catch((err: unknown) => {
        console.warn("[SW] Falha ao buscar a ficha da loja no install:", err);
      }),
  );
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
            (name) =>
              name !== CACHE_NAME &&
              name !== IMAGE_CACHE_NAME &&
              name !== IDENTIDADE_CACHE_NAME,
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

// Achado do revisor (rodada 2, 11/09/2026): o `install` precacheia
// `/index.html` CRU (`cache.addAll(urls)`, linha ~49 — `vite.config.ts`
// não exclui `html` do `globPatterns`). Esse HTML é o assado do build
// "idêntico para todas" (fixture da etapa 2), sem NENHUMA ficha dentro.
// O fallback de navegação abaixo (rota nunca visitada + rede fora do ar)
// caía nele sem checar — servindo o assado de ninguém como se fosse a
// loja, e violando "na dúvida, em manutenção" (o bem maior desta etapa).
// Por isso: antes de devolver um HTML tirado do cache de FALLBACK (não o
// da rota exata, que só chega ao cache vindo de uma resposta de rede real
// já passada pelo porteiro), confirmamos que ele carrega a tag da ficha.
async function respostaTemFichaDaLoja(resposta: any): Promise<boolean> {
  if (!resposta) return false;
  try {
    const texto = await resposta.clone().text();
    return texto.includes(`id="${FICHA_DA_LOJA_ID}"`);
  } catch (e) {
    console.warn("[SW] Falha ao checar a ficha no HTML de fallback:", e);
    return false;
  }
}

/** Página curta de "em manutenção" — mesma decisão de falha fechada do
 * porteiro (T3), reproduzida aqui porque o SW não pode importar código de
 * outra tarefa: nenhum byte de marca ou conexão sai quando não há ficha. */
function respostaEmManutencao(): Response {
  return new Response(
    "<!doctype html><html><body>Loja em manutenção. Tente novamente em instantes.</body></html>",
    {
      status: 503,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "retry-after": "60",
        "x-ikcous-porteiro": "sem-ficha-no-cache",
      },
    },
  );
}

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

  // `/version.json` é SONDA DE FRESCOR, não recurso cacheável: é ela que o
  // useUpdateCheck consulta a cada 3 minutos para descobrir se saiu versão
  // nova. Duas razões para não passar por aqui, e as duas custaram medição:
  //
  // (1) O catch-all lá embaixo grava POR URL. Como cada poll levava um
  //     carimbo diferente (`?t=<agora>`), 20 polls viraram 20 entradas
  //     distintas no cache `app-cache-<versao>` (medido em 08/09/2026, Cache
  //     Storage real) — ~20 por hora de app aberto, sem despejo, só limpas
  //     quando a versão muda. O cache do app instalado crescia sem limite.
  //
  // (2) E o catch-all é CACHE-FIRST (`return cachedResponse || fetchPromise`).
  //     Tirar o carimbo sem tirar a sonda daqui seria PIOR que o vazamento: o
  //     poll passaria a receber a versão VELHA do cache para sempre e o aviso
  //     de atualização morreria em silêncio.
  //
  // Dar `return` sem `respondWith` devolve o controle ao navegador, que busca
  // nativamente. O `cache: "no-store"` do useUpdateCheck cuida do cache HTTP.
  if (url.pathname === "/version.json") return;

  // 2. NAVEGAÇÃO: CACHE PRIMEIRO, REVALIDAÇÃO EM SEGUNDO PLANO
  // (laudo ofensiva 3108, achado N4)
  //
  // O DEFEITO PROVADO EM 31/08 (3 reproduções, build de produção): o ramo
  // era NETWORK-FIRST com fetch() DENTRO do respondWith — offline, o fetch
  // interno morria, o fallback entregava o HTML do cache, mas TODOS os
  // subrecursos (módulos e CSS) falhavam com net::ERR_FAILED: tela branca
  // ao abrir/recarregar a PWA sem internet, MESMO com o precache cheio e o
  // SW ativo (fetches DENTRO da página offline devolviam 200 do cache — o
  // cache estava lá; o quebrado era este fluxo de navegação).
  //
  // A cura: a resposta vem DO CACHE na hora; a rede entra por
  // `event.waitUntil` (fora da promessa respondWith) só para REVALIDAR a
  // cópia para a próxima visita. Com `registerType: "prompt"` +
  // useUpdateCheck, versão nova de app continua avisando pelo ciclo de
  // update do SW — a revalidação em segundo plano não contorna o aviso.
  if (event.request.mode === "navigate") {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) {
          event.waitUntil(
            fetch(event.request)
              .then((response) => {
                if (response.ok && response.status === 200) {
                  // Pílula da revisão do PR #375 (ressalva 1a): com um
                  // update PENDENTE (waiting), NÃO gravar HTML novo no
                  // cache VELHO — a revalidação não pode misturar HTML
                  // novo com chunks velhos enquanto o SW novo espera
                  // ativação (a janela de ChunkLoadError da ressalva).
                  if (sw.registration.waiting) return;
                  try {
                    const copy = response.clone();
                    // O try/catch aqui é SÍNCRONO: ele não pega rejeição de
                    // promessa. Sem este .catch, um put que falha (cota de
                    // disco estourada) vira unhandled rejection dentro do SW.
                    caches
                      .open(CACHE_NAME)
                      .then((cache) => cache.put(event.request, copy))
                      .catch((err) =>
                        console.warn(
                          "[SW] Failed to cache navigation response:",
                          err,
                        ),
                      );
                  } catch (e) {
                    console.warn(
                      "[SW] Failed to clone navigation response:",
                      e,
                    );
                  }
                }
              })
              .catch(() => {}),
          );
          return cached;
        }
        return fetch(event.request)
          .then((response) => {
            if (response.ok && response.status === 200) {
              try {
                const copy = response.clone();
                // Mesma razão do .catch da revalidação acima: o try/catch
                // síncrono não alcança a rejeição da promessa do put.
                caches
                  .open(CACHE_NAME)
                  .then((cache) => cache.put(event.request, copy))
                  .catch((err) =>
                    console.warn(
                      "[SW] Failed to cache navigation response:",
                      err,
                    ),
                  );
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
              return caches.match("/index.html").then(async (fallback) => {
                if (fallback && (await respostaTemFichaDaLoja(fallback))) {
                  return fallback;
                }
                const raiz = await caches.match("/");
                if (raiz && (await respostaTemFichaDaLoja(raiz))) {
                  return raiz;
                }
                return respostaEmManutencao();
              });
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
                // O .catch do fetchPromise (abaixo) não cobre este put: ele é
                // promessa SOLTA, e rejeitar aqui (cota cheia) viraria
                // unhandled rejection dentro do SW.
                cache
                  .put(event.request, responseToCache)
                  .catch((err: unknown) =>
                    console.warn("[SW] Failed to cache Supabase image:", err),
                  );
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

  // GUARD DE ORIGEM: a partir daqui só sobra o catch-all de assets estáticos,
  // que faz stale-while-revalidate via fetch() manual dentro do SW. Esse
  // fetch() é regido pela CSP connect-src — NÃO pela script-src que liberou
  // a tag <script> na página (ex.: sdk.mercadopago.com está em script-src,
  // não em connect-src). Se deixarmos o catch-all reemitir uma requisição
  // cross-origin como fetch(), a CSP barra, o catch cai no throw e o SW
  // cancela o carregamento do script de terceiro (respondWith rejeitado).
  // Para requisição de outra origem, não interceptar: dar `return` sem
  // `respondWith` devolve o controle ao navegador, que busca nativamente
  // e não passa pelo filtro de connect-src do SW.
  if (url.origin !== sw.location.origin) return;

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
                // O try/catch que envolve este bloco é SÍNCRONO e não pega
                // rejeição de promessa: sem o .catch, um put que falha (cota
                // de disco estourada) vira unhandled rejection no SW.
                caches
                  .open(CACHE_NAME)
                  .then((cache) => cache.put(event.request, responseToCache))
                  .catch((err) =>
                    console.warn("[SW] Failed to cache asset response:", err),
                  );
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

// A imagem da notificação prefere a FICHA guardada no install (loja
// resolvida por host, build compartilhado) e só cai no ícone assado
// (`buildIdentity`, comportamento de hoje) quando não há ficha em cache —
// build antigo, ou o `install` ainda não terminou de buscá-la. Qualquer falha
// na leitura do cache (inclusive `caches` sem `match`, ambiente antigo) cai
// no mesmo fallback: nunca deixa a notificação sem ícone.
//
// Lê pelo cache PRÓPRIO (`IDENTIDADE_CACHE_NAME`), não pelo `caches.match`
// de nível topo: um build compartilhado por toda a frota (etapa 2 da escala)
// pode ter, no mesmo Cache Storage, entradas de outra origem/loja para o
// MESMO caminho `/identidade.json` sobrevivendo entre trocas de host num
// mesmo dispositivo (SW não é limpo por navegação). Por isso, mesmo achando
// a ficha no cache próprio, só ela é aceita se `ficha.host` bater com
// `self.location.hostname` — senão, ícone assado (nunca a ficha de outra loja).
async function resolverIconeDaLoja(): Promise<string> {
  try {
    const cache = await caches.open(IDENTIDADE_CACHE_NAME);
    const resposta = await cache.match(CAMINHO_IDENTIDADE_JSON);
    if (resposta) {
      const ficha: FichaDaLoja = await resposta.json();
      if (ficha?.host === sw.location.hostname) {
        const icone = ficha?.identidade?.localUrls?.icon_192;
        if (icone) return icone;
      }
    }
  } catch (e) {
    console.warn("[SW] Falha ao ler a ficha da loja em cache:", e);
  }
  return ICONE_ASSADO;
}

sw.addEventListener("push", (event: any) => {
  if (!event.data) return;
  try {
    const payload = event.data.json();
    const title = payload.title || "Novidade!";
    const notificar = (icon: string) => {
      const options = {
        body: payload.body || "",
        icon,
        badge: icon,
        data: {
          url: payload.url || "/",
          ...payload.data,
        },
      };
      return sw.registration.showNotification(title, options);
    };
    // Sem a API de cache (ambiente sem `caches.match`), não há como ler a
    // ficha — segue direto para o ícone assado, exatamente como antes desta
    // mudança. Com a API disponível (todo SW real), a ficha tem preferência.
    if (typeof caches?.match !== "function") {
      event.waitUntil(notificar(ICONE_ASSADO));
    } else {
      event.waitUntil(resolverIconeDaLoja().then(notificar));
    }
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
        const absoluteUrl = new URL(targetUrl, sw.location.origin);
        // Laudo #2 (P-7): as janelas vivem em /?source=pwa (start_url do
        // manifest) e o alvo padrão é "/" — a comparação de URL inteira
        // nunca batia e TODO toque abria uma segunda janela da loja.
        // Comparar o CAMINHO (mesma origem) foca a janela que já existe.
        for (const client of clientList) {
          const clientUrl = new URL(client.url);
          if (
            clientUrl.origin === absoluteUrl.origin &&
            clientUrl.pathname === absoluteUrl.pathname &&
            "focus" in client
          ) {
            return client.focus();
          }
        }
        if (sw.clients.openWindow) {
          return sw.clients.openWindow(absoluteUrl.href);
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
