import { DataVault } from "@/lib/dataVault";
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

        // Puxar imagens dos banners e produtos do DataVault (IndexedDB)
        const vault = await DataVault.init();

        const banners = await vault.getAll<any>("banners");
        const bannerUrls = banners
          .filter((b) => b.imageUrl || b.imagem_url)
          .map((b) => b.imageUrl || b.imagem_url);

        const products = await vault.getAll<any>("products");
        const productUrls = products
          .slice(0, 15) // Limitar aos primeiros 15 produtos
          .flatMap((p) => p.images || (p.imagem_url ? [p.imagem_url] : []))
          .filter((url) => typeof url === "string" && url.trim() !== "");

        // Laudo 0109 (C5): guarda de rede lenta — o mesmo critério do
        // usePrefetchOnHover. Em 2G/slow-2g ou com economia de dados ligada,
        // aquece SÓ as rotas críticas; as imagens (banners + 15 produtos em
        // URL original) ficam para uma rede que aguenta.
        const pularImagens = redeLenta(conexaoDoNavegador());

        // Collect critical routes and images
        const urls = pularImagens
          ? [...CRITICAL_URLS]
          : [...CRITICAL_URLS, ...bannerUrls, ...productUrls];

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
