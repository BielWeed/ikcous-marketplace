import { useRegisterSW } from "virtual:pwa-register/react";
import { useStore } from "@/contexts/StoreContext";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

declare const __APP_VERSION__: string;
const SAFE_APP_VERSION =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0-dev";

export function useUpdateCheck() {
  const { config } = useStore();
  const [isMandatory, setIsMandatory] = useState(false);
  const [newVersion, setNewVersion] = useState<string | null>(null);

  // ==============================
  // CORE: Vite PWA Native Events
  // ==============================
  const [registration, setRegistration] =
    useState<ServiceWorkerRegistration | null>(null);

  const fetchServerVersion = useCallback(async () => {
    if (import.meta.env.DEV) return SAFE_APP_VERSION;
    try {
      const response = await fetch(`/version.json?t=${Date.now()}`);
      if (response.ok) {
        const data = await response.json();
        return data.version as string;
      }
    } catch (e) {
      console.error("[Update] Failed to fetch server version:", e);
    }
    return null;
  }, []);

  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, _setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl: string, r: ServiceWorkerRegistration | undefined) {
      console.log(`[PWA] Service Worker registered: ${swUrl}`);
      if (r) {
        setRegistration(r);
      }
    },
    onRegisterError(error: any) {
      console.error("[PWA] Service Worker registration error:", error);
    },
  });

  useEffect(() => {
    if (!registration) return;

    const checkUpdateNow = async () => {
      console.log("[PWA] Checking for updates...");
      const ver = await fetchServerVersion();
      if (ver && ver !== SAFE_APP_VERSION) {
        console.log(`[PWA] Server version (${ver}) differs from local (${SAFE_APP_VERSION}). Updating SW.`);
        setNewVersion(ver);
      }
      registration.update().catch((err) => {
        console.error("[PWA] Failed to check for SW update:", err);
      });
    };

    const intervalId = setInterval(checkUpdateNow, 3 * 60 * 1000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        console.log("[PWA] App became visible. Checking SW update...");
        checkUpdateNow();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      console.log("[PWA] Clearing SW update check interval & visibility listener...");
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [registration, fetchServerVersion, SAFE_APP_VERSION]);

  // ==============================
  // CORE: Nuclear Purge (mandatory)
  // ==============================
  const performNuclearPurge = useCallback(async (immediate = false) => {
    console.warn("[Update] 🔴 NUCLEAR_PURGE_START: Initiating full cleanup...");

    const doPurge = async () => {
      // 1. Service Worker cleanup
      if ("serviceWorker" in navigator) {
        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const r of regs) {
            if (r.waiting) r.waiting.postMessage({ type: "SKIP_WAITING" });
            await r.unregister();
          }
        } catch (e) {
          console.error("[Purge] SW error:", e);
        }
      }

      // 2. Cache storage cleanup
      if ("caches" in window) {
        try {
          const keys = await caches.keys();
          for (const k of keys) await caches.delete(k);
        } catch (e) {
          console.error("[Purge] Cache error:", e);
        }
      }

      // 2.5 IndexedDB cleanup (DataVault deletion)
      try {
        const req = indexedDB.deleteDatabase("ikcous-datavault");
        req.onsuccess = () =>
          console.log("[Purge] DataVault database deleted.");
        req.onerror = () =>
          console.error("[Purge] Failed to delete DataVault database.");
      } catch (e) {
        console.error("[Purge] DB delete error:", e);
      }

      // 3. Selective localStorage purge
      // Keep auth tokens, user data, and brand specific keys
      const whitelist = [
        "sb-",
        "supabase.auth",
        "pwa_",
        "marketplace_",
        "ikcous_",
        "cart_",
        "favorites_",
      ];
      try {
        for (const key of Object.keys(localStorage)) {
          if (!whitelist.some((prefix) => key.startsWith(prefix))) {
            localStorage.removeItem(key);
          }
        }
      } catch (e) {
        console.error("[Purge] LocalStorage error:", e);
      }

      // 4. Set reload reason for next boot
      localStorage.setItem(
        "pwa_reload_reason",
        "Sistema atualizado e otimizado.",
      );

      // 5. Hard reload
      window.location.href = `${window.location.origin}/?forceUpdate=${Date.now()}`;
    };

    if (immediate) {
      await doPurge();
    } else {
      // Give UI time to show "Updating..." state
      setTimeout(doPurge, 1500);
    }
  }, []);

  // Helper to trigger the update process
  const handleUpdate = useCallback(
    async (_immediate?: boolean) => {
      console.log("[Update] Triggering SW update and reload...");
      localStorage.setItem(
        "pwa_reload_reason",
        "Sistema atualizado e otimizado.",
      );

      let reloaded = false;
      const onControllerChange = () => {
        if (!reloaded) {
          reloaded = true;
          window.location.reload();
        }
      };
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          onControllerChange,
        );
      }

      await updateServiceWorker(true);

      setTimeout(() => {
        if ("serviceWorker" in navigator) {
          navigator.serviceWorker.removeEventListener(
            "controllerchange",
            onControllerChange,
          );
        }
        if (!reloaded) {
          reloaded = true;
          window.location.reload();
        }
      }, 1200);
    },
    [updateServiceWorker],
  );

  // ==============================
  // CORE: Mandatory Version Check (DB)
  // ==============================
  const checkMandatoryUpdate = useCallback(() => {
    const isDev = import.meta.env.DEV;
    if (isDev) return false;

    // Skip check if SAFE_APP_VERSION is a dev timestamp (optional logic)
    const isTimestampVersion =
      SAFE_APP_VERSION.length > 10 && !Number.isNaN(Number(SAFE_APP_VERSION));

    // Versão local não coincide com a mínima exigida (e não é timestamp de dev)
    if (
      config.minAppVersion &&
      config.minAppVersion !== SAFE_APP_VERSION &&
      !isTimestampVersion
    ) {
      console.log("[Update] 🚨 Mandatory version mismatch detected!");
      console.log(
        `[Update] Local: ${SAFE_APP_VERSION} | Required: ${config.minAppVersion}`,
      );
      setIsMandatory(true);

      // Grava log para o próximo boot saber o que aconteceu
      localStorage.setItem(
        "pwa_update_log",
        `Version Mismatch: ${SAFE_APP_VERSION} -> ${config.minAppVersion}`,
      );

      performNuclearPurge(true);
      return true;
    }
    return false;
  }, [config.minAppVersion, performNuclearPurge]);

  useEffect(() => {
    checkMandatoryUpdate();
  }, [checkMandatoryUpdate]);

  // ==============================
  // UI Sync: Refresh Notifications
  // ==============================
  useEffect(() => {
    if (needRefresh) {
      console.log("[PWA] New content available! User prompt should appear.");
      if (!newVersion || newVersion === "Nova Versão") {
        fetchServerVersion().then((ver) => {
          setNewVersion(ver || "Nova Versão");
        });
      }
    }
  }, [needRefresh, newVersion, fetchServerVersion]);

  useEffect(() => {
    if (offlineReady) {
      console.log("[PWA] App ready for offline use.");
      toast.success("App pronto para uso offline!", {
        duration: 3000,
      });
      setOfflineReady(false); // Reset to avoid re-triggering
    }
  }, [offlineReady, setOfflineReady]);

  // ==============================
  // ChunkLoadError auto-recovery
  // ==============================
  useEffect(() => {
    const handleError = (e: ErrorEvent) => {
      const msg = (e.message || "").toLowerCase();
      const isChunkError =
        msg.includes("loading chunk") ||
        msg.includes("chunkloaderror") ||
        msg.includes("unexpected token") ||
        msg.includes("failed to fetch dynamically imported module") ||
        msg.includes("error loading dynamically imported module") ||
        msg.includes("importing a module script failed") ||
        msg.includes("css chunk load failed");

      if (isChunkError) {
        console.error("[Update] 💥 ChunkLoadError detected");

        const lastReload = sessionStorage.getItem("pwa_chunk_error_reload");
        const now = Date.now();

        if (lastReload && now - Number.parseInt(lastReload) < 15000) {
          console.warn("[Update] 🛡️ Reload Guard Active.");
          toast.error("Ocorreu um erro persistente", {
            description: "Por favor, tente recarregar manualmente.",
            duration: 10000,
          });
          return;
        }

        sessionStorage.setItem("pwa_chunk_error_reload", now.toString());
        localStorage.setItem(
          "pwa_reload_reason",
          "Auto-recuperação (Erro de Módulo)",
        );

        toast.loading("Sincronizando nova versão...", {
          description: "Corrigindo erro de carregamento automaticamente.",
        });

        setTimeout(() => performNuclearPurge(true), 1500);
      }
    };

    window.addEventListener("error", handleError);
    return () => window.removeEventListener("error", handleError);
  }, [performNuclearPurge]);

  return {
    isMandatory,
    updateAvailable: needRefresh,
    newVersion,
    checkUpdate: useCallback(async (realtimeVersion?: string) => {
      let targetVer = realtimeVersion;
      if (!targetVer) {
        targetVer = await fetchServerVersion() || undefined;
      }
      
      if (targetVer && targetVer !== SAFE_APP_VERSION) {
        console.log(`[Update] Server version (${targetVer}) differs from local (${SAFE_APP_VERSION})`);
        setNewVersion(targetVer);
      }

      if (registration) {
        console.log("[Update] Triggering manual service worker update check...");
        try {
          await registration.update();
        } catch (err) {
          console.error("[PWA] Manual SW update check failed:", err);
        }
      }

      checkMandatoryUpdate();
    }, [registration, fetchServerVersion, SAFE_APP_VERSION, checkMandatoryUpdate]),
    performNuclearPurge: handleUpdate,
  };
}
