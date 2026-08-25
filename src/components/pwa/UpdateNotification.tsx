import { branding } from "@/config/branding";
import { useStore } from "@/contexts/StoreContext";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Rocket } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface UpdateNotificationProps {
  readonly show: boolean;
  readonly onUpdate: () => void;
  readonly currentVersion?: string;
  readonly newVersion?: string | null;
}

declare const __APP_VERSION__: string;

const SHORT_VERSION = (v: string) => v.slice(-6);

export function UpdateNotification({
  show,
  onUpdate,
  currentVersion,
  newVersion,
}: UpdateNotificationProps) {
  // Nome da loja em runtime: banco (config.storeName) com fallback no branding do build
  const { config } = useStore();
  const appName = config.storeName ?? branding.appName;
  const [isUpdating, setIsUpdating] = useState(false);
  const [progress, setProgress] = useState(0);

  const fromVer = SHORT_VERSION(currentVersion || __APP_VERSION__);
  const toVer = newVersion ? SHORT_VERSION(newVersion) : null;

  const handleUpdate = useCallback(() => {
    setIsUpdating(true);
    setTimeout(() => onUpdate(), 1200);
  }, [onUpdate]);

  // Animated progress bar during update
  useEffect(() => {
    if (!isUpdating) return;
    setTimeout(() => setProgress(0), 0);
    const steps = [15, 35, 55, 75, 90, 100];
    const timers: ReturnType<typeof setTimeout>[] = [];
    steps.forEach((p, i) => {
      timers.push(setTimeout(() => setProgress(p), i * 250));
    });
    return () => timers.forEach(clearTimeout);
  }, [isUpdating]);

  return (
    <AnimatePresence>
      {show && (
        <div className="pointer-events-none fixed inset-0 z-[10000] flex items-center justify-center p-4">
          {/* Mandatory backdrop for all updates now */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-auto absolute inset-0 bg-black/60 backdrop-blur-md"
          />

          {/* Notification Card */}
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ type: "spring", stiffness: 350, damping: 30 }}
            className={cn(
              "relative pointer-events-auto mx-4 overflow-hidden",
              "backdrop-blur-2xl border shadow-2xl",
              "w-full max-w-[340px] rounded-[2rem] p-6 bg-zinc-950/95 border-amber-500/30 text-white",
            )}
          >
            {/* Top shine */}
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/50 to-transparent" />

            <div className="flex flex-col items-center space-y-5 text-center">
              <div className="relative">
                <div className="absolute inset-0 animate-pulse rounded-full bg-amber-500/20 blur-2xl" />
                <div className="relative rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
                  <Rocket className="size-8 text-amber-400 animate-bounce" />
                </div>
              </div>

              <div className="space-y-1.5 px-2">
                <h3 className="text-lg font-black tracking-tight text-white">
                  Nova Versão Disponível
                </h3>
                <p className="text-xs leading-relaxed text-zinc-300">
                  Uma nova atualização do {appName} está pronta para ser
                  instalada com melhorias de desempenho.
                </p>
              </div>

              {/* Version De→Para */}
              {toVer && (
                <div className="flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3.5 py-1.5 font-mono text-xs">
                  <span className="text-zinc-400">{fromVer}</span>
                  <ArrowRight className="size-3 text-amber-400" />
                  <span className="font-black text-amber-300">{toVer}</span>
                </div>
              )}

              {/* Action Button & Progress */}
              <div className="w-full space-y-3 pt-2">
                {isUpdating ? (
                  <>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-900 border border-amber-500/20">
                      <motion.div
                        className="h-full bg-gradient-to-r from-amber-500 to-yellow-400 shadow-[0_0_12px_rgba(245,158,11,0.5)]"
                        initial={{ width: 0 }}
                        animate={{ width: `${progress}%` }}
                        transition={{ duration: 0.3, ease: "easeOut" }}
                      />
                    </div>
                    <div className="flex items-center justify-between px-1">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400/80">
                        Instalando atualização...
                      </p>
                      <p className="font-mono text-[11px] font-black text-amber-400">
                        {progress}%
                      </p>
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={handleUpdate}
                    className="w-full h-12 rounded-2xl bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-500 text-zinc-950 font-black text-xs uppercase tracking-wider transition-all duration-200 hover:brightness-110 active:scale-[0.98] shadow-lg shadow-amber-500/25 flex items-center justify-center gap-2 cursor-pointer border border-amber-300/40"
                  >
                    <Rocket className="size-4 text-zinc-950" />
                    Atualizar Agora
                  </button>
                )}
              </div>
            </div>

            {/* Bottom shine */}
            <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-amber-400/30 to-transparent" />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
