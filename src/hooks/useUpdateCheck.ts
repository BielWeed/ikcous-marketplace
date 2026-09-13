import { useRegisterSW } from "virtual:pwa-register/react";
import { useStore } from "@/contexts/StoreContext";
import { chaveSobreviveAPurga } from "@/lib/localStoragePurgeWhitelist";
import { gravaMotivoDeRecarga } from "@/lib/motivo-de-recarga";
import {
  apagarCachesDoApp,
  apagarIndexedDBAguardando,
  navegarPreservandoEndereco,
} from "@/lib/recuperacao-chunk";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

declare const __APP_VERSION__: string;
const SAFE_APP_VERSION =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0-dev";

// A versão do build sempre carrega sufixo ("1.0.0-sha.ef7b099", "1.0.0-build.36692"),
// então comparar com !== contra um min_app_version limpo ("1.0.0") nunca converge
// e gera loop infinito de purge + reload. Comparar só o núcleo semver.
const parseSemverCore = (version: string): [number, number, number] | null => {
  const core = version.trim().split(/[-+]/)[0];
  const parts = core.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length === 0 || parts.length > 3) return null;
  if (parts.some((n) => Number.isNaN(n))) return null;
  const [major = 0, minor = 0, patch = 0] = parts;
  return [major, minor, patch];
};

// true apenas quando `local` é comprovadamente MAIS ANTIGA que `required`.
// Formato desconhecido ou núcleo igual => false (nunca forçar purge por dúvida).
const isOlderThan = (local: string, required: string): boolean => {
  const a = parseSemverCore(local);
  const b = parseSemverCore(required);
  if (!a || !b) return false;
  const [aMajor, aMinor, aPatch] = a;
  const [bMajor, bMinor, bPatch] = b;
  if (aMajor !== bMajor) return aMajor < bMajor;
  if (aMinor !== bMinor) return aMinor < bMinor;
  return aPatch < bPatch;
};

// Trava anti-loop: se o purge já rodou para a mesma versão exigida e o app
// continua "desatualizado", purgar de novo não resolve — só trava o cliente.
// A chave começa com "pwa_" de propósito: está na whitelist do purge e sobrevive a ele.
const MANDATORY_PURGE_GUARD_KEY = "pwa_mandatory_purge_guard";
const MAX_MANDATORY_PURGES = 2;

const readPurgeGuard = (): { required: string; count: number } => {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(MANDATORY_PURGE_GUARD_KEY) || "null",
    );
    if (parsed && typeof parsed.required === "string") {
      return { required: parsed.required, count: Number(parsed.count) || 0 };
    }
  } catch {
    // Valor corrompido: tratar como primeira tentativa.
  }
  return { required: "", count: 0 };
};

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
      // SEM carimbo de tempo: cada URL diferente virava uma entrada nova no
      // cache do Service Worker (20 polls = 20 entradas, medido em
      // 08/09/2026). O sw.ts agora ignora /version.json — ela é sonda de
      // frescor —, então quem fura o cache HTTP do navegador é o "no-store",
      // que não inventa URL nova a cada busca.
      const response = await fetch("/version.json", { cache: "no-store" });
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
        console.log(
          `[PWA] Server version (${ver}) differs from local (${SAFE_APP_VERSION}). Updating SW.`,
        );
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
      console.log(
        "[PWA] Clearing SW update check interval & visibility listener...",
      );
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [registration, fetchServerVersion, SAFE_APP_VERSION]);

  // ==============================
  // CORE: Nuclear Purge (mandatory)
  // ==============================
  // Issue #92: este é o purge de VERSÃO OBRIGATÓRIA (minAppVersion) — o
  // ÚNICO caminho que apaga IndexedDB de propósito, agora com o delete
  // AGUARDADO (prazo + onblocked). O disparado por ERRO DE CHUNK não passa
  // mais por aqui: é a escada de @/lib/recuperacao-chunk, que preserva o
  // IndexedDB e nunca roda sem rede verificada.
  const performNuclearPurge = useCallback(async (immediate = false) => {
    console.warn("[Update] 🔴 NUCLEAR_PURGE_START: Initiating full cleanup...");

    const doPurge = async () => {
      // 1. Service Worker cleanup
      if ("serviceWorker" in navigator) {
        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const r of regs) {
            await r.unregister();
          }
        } catch (e) {
          console.error("[Purge] SW error:", e);
        }
      }

      // 2. Cache storage cleanup — SELETIVO via módulo único: só os caches
      // `app-cache-*` morrem. `ikcous-identidade` e `supabase-images-cache`
      // sobrevivem (o activate do SW preserva num update normal; sem a
      // ficha, o fallback offline devolveria 503 "Loja em manutenção" para
      // a base instalada).
      await apagarCachesDoApp();

      // 2.5 IndexedDB cleanup (DataVault deletion) — AGUARDADO (aceite 5):
      // fire-and-forget corria com a navegação; await literal travaria com
      // conexão aberta. O módulo faz os dois com prazo + onblocked laudado.
      await apagarIndexedDBAguardando();

      // 3. Selective localStorage purge
      // Keep auth tokens, user data, brand specific keys and PENDING writes
      // — mesma lista branca de GlobalErrorBoundary.tsx
      // (@/lib/localStoragePurgeWhitelist): a Nuclear Purge dispara SOZINHA
      // no boot (checkMandatoryUpdate), então uma lista desatualizada aqui
      // apaga fila de escrita offline sem ninguém decidir nada — ver o
      // comentário do arquivo compartilhado.
      try {
        for (const key of Object.keys(localStorage)) {
          if (!chaveSobreviveAPurga(key)) {
            localStorage.removeItem(key);
          }
        }
      } catch (e) {
        console.error("[Purge] LocalStorage error:", e);
      }

      // 4. Set reload reason for next boot
      gravaMotivoDeRecarga("atualizacao-aplicada");

      // 5. Navegação honesta (aceite 6): location.replace não empilha
      // histórico; pathname+search preservados (?source=pwa da base
      // instalada sobrevive). A query de força da era antiga morreu sem
      // consumidor nenhum; recarregar de verdade vem do SW desregistrado,
      // não de parâmetro de URL que ninguém lê.
      navegarPreservandoEndereco();
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
      gravaMotivoDeRecarga("atualizacao-aplicada");

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

    // Versão local é anterior à mínima exigida (e não é timestamp de dev)
    if (
      config.minAppVersion &&
      !isTimestampVersion &&
      isOlderThan(SAFE_APP_VERSION, config.minAppVersion)
    ) {
      const guard = readPurgeGuard();
      const attempts =
        guard.required === config.minAppVersion ? guard.count : 0;

      if (attempts >= MAX_MANDATORY_PURGES) {
        console.error(
          `[Update] Purge obrigatório já tentado ${attempts}x para a versão ${config.minAppVersion} e o app continua em ${SAFE_APP_VERSION}. Abortando para não travar o cliente em loop.`,
        );
        return false;
      }

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
      localStorage.setItem(
        MANDATORY_PURGE_GUARD_KEY,
        JSON.stringify({
          required: config.minAppVersion,
          count: attempts + 1,
        }),
      );

      performNuclearPurge(true);
      return true;
    }

    // Versão local em dia: zerar a trava para não bloquear um update futuro legítimo.
    if (config.minAppVersion && readPurgeGuard().count > 0) {
      localStorage.removeItem(MANDATORY_PURGE_GUARD_KEY);
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
  // Issue #92: REMOVIDO daqui. Este hook vive num chunk LAZY
  // (PWAUpdateGate via React.lazy) — no boot inicial ele não existe, e se o
  // chunk que falhasse fosse o dele próprio, o mecanismo nem acordava. Os
  // canais 'error' e 'unhandledrejection' agora são instalados UMA vez no
  // main.tsx (chunk inicial) e decidem pela MESMA chave de
  // @/lib/recuperacao-chunk que o GlobalErrorBoundary — sem corrida entre
  // chaves, sem purge nuclear sem rede verificada.

  return {
    isMandatory,
    updateAvailable: needRefresh,
    newVersion,
    checkUpdate: useCallback(
      async (realtimeVersion?: string) => {
        let targetVer = realtimeVersion;
        if (!targetVer) {
          targetVer = (await fetchServerVersion()) || undefined;
        }

        if (targetVer && targetVer !== SAFE_APP_VERSION) {
          console.log(
            `[Update] Server version (${targetVer}) differs from local (${SAFE_APP_VERSION})`,
          );
          setNewVersion(targetVer);
        }

        if (registration) {
          console.log(
            "[Update] Triggering manual service worker update check...",
          );
          try {
            await registration.update();
          } catch (err) {
            console.error("[PWA] Manual SW update check failed:", err);
          }
        }

        checkMandatoryUpdate();
      },
      [
        registration,
        fetchServerVersion,
        SAFE_APP_VERSION,
        checkMandatoryUpdate,
      ],
    ),
    performNuclearPurge: handleUpdate,
  };
}
