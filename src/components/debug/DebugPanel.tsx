import { Button } from "@/components/ui/button";
import { useStore } from "@/contexts/StoreContext";
import { useAuth } from "@/hooks/useAuth";
import { AnimatePresence, motion } from "framer-motion";
import { RefreshCw, ShieldAlert, Trash2, Wifi, WifiOff, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

declare const __APP_VERSION__: string;

interface DebugPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DebugPanel({ isOpen, onClose }: DebugPanelProps) {
  const { config } = useStore();
  const { user } = useAuth();
  const [swStatus, setSwStatus] = useState<string>("unknown");
  const [networkStatus, setNetworkStatus] = useState<string>("online");
  const [lastCheck, setLastCheck] = useState<string>("-");
  const [remoteVersion, setRemoteVersion] = useState<string>("checking...");

  const checkEverything = useCallback(async () => {
    // 1. Check Network
    setNetworkStatus(navigator.onLine ? "online" : "offline");

    // 2. Check SW
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        setSwStatus(
          reg.active ? "active" : reg.waiting ? "waiting" : "installing",
        );
      } else {
        setSwStatus("not_registered");
      }
    } else {
      setSwStatus("unsupported");
    }

    // 3. Remote Version check (handled by PWA Engine)
    setRemoteVersion("PWA engine active");

    setLastCheck(new Date().toLocaleTimeString());
  }, []);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        checkEverything();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isOpen, checkEverything]);

  const forceNuclearReset = async () => {
    if (!confirm("ISSO VAI RESETAR TUDO E RECARREGAR. TEM CERTEZA?")) return;

    toast.info("Iniciando protocolo nuclear...");

    try {
      // 1. Unregister SW
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) await r.unregister();
      }

      // 2. Clear Caches
      if ("caches" in window) {
        const keys = await caches.keys();
        for (const k of keys) await caches.delete(k);
      }

      // 3. Clear LocalStorage (Warning: clears auth too if not careful, but maybe necessary for "nuclear")
      // We will keep 'sb-' keys (Supabase) to try and save auth, but clear others
      Object.keys(localStorage).forEach((key) => {
        if (!key.startsWith("sb-")) localStorage.removeItem(key);
      });

      // 4. Force Reload with Timestamp to bust cache
      window.location.href = `${window.location.origin}?nuclear=${Date.now()}`;
    } catch {
      toast.error("Falha no reset");
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />

          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl"
          >
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="size-5 text-red-500" />
                <h2 className="font-mono text-lg font-bold text-white">
                  SYSTEM DIAGNOSTICS
                </h2>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={onClose}
                className="size-8 text-zinc-400"
              >
                <X className="size-4" />
              </Button>
            </div>

            <div className="space-y-4 font-mono text-xs">
              {/* STATUS GRID */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                  <div className="mb-1 text-zinc-500">APP VERSION</div>
                  <div className="font-bold text-emerald-400">
                    {__APP_VERSION__}
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                  <div className="mb-1 text-zinc-500">REMOTE VER</div>
                  <div
                    className={
                      remoteVersion === __APP_VERSION__
                        ? "font-bold text-emerald-400"
                        : "font-bold text-amber-400"
                    }
                  >
                    {remoteVersion}
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                  <div className="mb-1 text-zinc-500">SW STATUS</div>
                  <div className="font-bold text-blue-400">{swStatus}</div>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                  <div className="mb-1 text-zinc-500">NETWORK</div>
                  <div className="flex items-center gap-2">
                    {networkStatus === "online" ? (
                      <Wifi className="size-3 text-emerald-500" />
                    ) : (
                      <WifiOff className="size-3 text-red-500" />
                    )}
                    <span className="text-white">{networkStatus}</span>
                  </div>
                </div>
              </div>

              {/* STORE CONFIG */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                <div className="mb-1 flex justify-between text-zinc-500">
                  <span>STORE ID</span>
                  <span className="text-[10px] text-zinc-600">
                    MinAppVer: {config?.minAppVersion || "N/A"}
                  </span>
                </div>
                <div className="truncate text-white">
                  {config?.minAppVersion ? "CONFIG LOADED" : "NO CONFIG"}
                </div>
                <div className="mt-1 truncate text-zinc-600">
                  User: {user?.id || "ANONYMOUS"}
                </div>
              </div>

              {/* ACTIONS */}
              <div className="mt-6 grid grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  onClick={checkEverything}
                  className="h-12 border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                >
                  <RefreshCw className="mr-2 size-4" />
                  Refresh Stats
                </Button>

                <Button
                  variant="destructive"
                  onClick={forceNuclearReset}
                  className="h-12 border-red-900/50 bg-red-900/20 text-red-400 hover:bg-red-900/40"
                >
                  <Trash2 className="mr-2 size-4" />
                  NUCLEAR RESET
                </Button>
              </div>

              <div className="mt-4 text-center text-[10px] text-zinc-700">
                Last check: {lastCheck}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
