import { DataVault } from "@/lib/dataVault";
import { miniaturaDaSugestao } from "@/lib/imageUrl";
import { conexaoDoNavegador, redeLenta } from "@/lib/rede-lenta";
import { useEffect } from "react";

const IDLE_TIMEOUT = 2000; // ms before starting warm

const CRITICAL_URLS = ["/"];

/**
 * useCacheWarmer v15.0
 * Pre-warms critical routes using requestIdleCallback when browser is idle.
 * Signals the SW to add them to the 'warmed-routes' cache.
 */
export function useCacheWarmer() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const warmCache = async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg?.active) return;

        // Laudo do sócio r2 (Frente 1, 08/09/2026) + revisão Opus do PR: nada
        // RENDERIZA banner nem a foto 2..N de um produto no endereço original —
        // quem os mostra (BannerCarousel via LazyImage, galeria do ProductView)
        // pede a versão TRANSFORMADA (imageUrl.ts), que a gaveta do service
        // worker não casa por endereço exato (sw.ts:176). O único pedido cru de
        // banner é o preloadTopBanner (useBanners.ts:15), que passa pelo SW e
        // se auto-serve na gaveta — aquecê-lo aqui era um no-op. Só a 1ª foto
        // de cada produto tem consumidor no endereço que se aquece: a ORIGINAL
        // (CartItemsList, ShippingProgress) e a MINIATURA da sugestão da
        // busca (SearchBar, via `miniaturaDaSugestao` — a mesma string que ela
        // renderiza). Quando a loja não redimensiona (IKCOUS), a miniatura é a
        // própria original e entra uma vez só.
        const vault = await DataVault.init();

        const products = await vault.getAll<any>("products");
        const productUrls = [
          ...new Set(
            products
              .slice(0, 15) // Limitar aos primeiros 15 produtos
              .map((p) => p.images?.[0] || p.imagem_url)
              .filter((url) => typeof url === "string" && url.trim() !== "")
              .flatMap((url: string) => [url, miniaturaDaSugestao(url)]),
          ),
        ];

        // Laudo 0109 (C5): guarda de rede lenta — o mesmo critério do
        // usePrefetchOnHover. Em 2G/slow-2g ou com economia de dados ligada,
        // aquece SÓ as rotas críticas; a 1ª foto de cada um dos 15 produtos
        // fica para uma rede que aguenta.
        const pularImagens = redeLenta(conexaoDoNavegador());

        // Collect critical routes and images
        const urls = pularImagens
          ? [...CRITICAL_URLS]
          : [...CRITICAL_URLS, ...productUrls];

        reg.active.postMessage({ type: "WARM_CACHE", urls });

        // Also cache directly from client side as fallback for critical routes
        const cache = await caches.open("warmed-routes");
        await Promise.all(
          CRITICAL_URLS.map((url) => {
            try {
              const parsedUrl = new URL(url, window.location.origin);
              if (parsedUrl.origin !== window.location.origin) {
                console.warn(
                  "[CacheWarmer] Blocked external URL warming:",
                  url,
                );
                return Promise.resolve();
              }
              return fetch(parsedUrl.toString(), { cache: "reload" })
                .then((res) => {
                  if (res.ok) cache.put(url, res);
                })
                .catch(() => null);
            } catch (e) {
              console.error("[CacheWarmer] Invalid URL:", url, e);
              return Promise.resolve();
            }
          }),
        );

        // Log to forensics
        const logs = JSON.parse(localStorage.getItem("pwa_forensics") || "[]");
        localStorage.setItem(
          "pwa_forensics",
          JSON.stringify(
            [
              { t: new Date().toISOString(), m: "Cache Warmed", d: { urls } },
              ...logs,
            ].slice(0, 20),
          ),
        );
      } catch (e) {
        console.warn("[CacheWarmer] Failed:", e);
      }
    };

    // Use requestIdleCallback if available, fallback to setTimeout
    let idleId: number | ReturnType<typeof setTimeout> | null = null;

    if ("requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(warmCache, { timeout: 5000 });
    } else {
      idleId = setTimeout(warmCache, IDLE_TIMEOUT);
    }

    return () => {
      if (idleId === null) return;
      if ("cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId as number);
      } else {
        clearTimeout(idleId as ReturnType<typeof setTimeout>);
      }
    };
  }, []);
}
