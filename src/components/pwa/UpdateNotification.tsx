import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Rocket } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface UpdateNotificationProps {
  show: boolean;
  onUpdate: () => void;
  currentVersion?: string;
  newVersion?: string | null;
}

declare const __APP_VERSION__: string;

const SHORT_VERSION = (v: string) => v.slice(-6);

export function UpdateNotification({
  show,
  onUpdate,
  currentVersion,
  newVersion,
}: UpdateNotificationProps) {
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

  // Auto-update effect
  useEffect(() => {
    if (show && !isUpdating) {
      const timer = setTimeout(() => {
        handleUpdate();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [show, isUpdating, handleUpdate]);

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
              "w-full max-w-[340px] rounded-[2rem] p-6 bg-zinc-950/90 border-white/10 text-white",
            )}
          >
            {/* Top shine */}
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />

            <div className="flex flex-col items-center space-y-5 text-center">
              <div className="relative">
                <div className="absolute inset-0 animate-pulse rounded-full bg-primary/20 blur-2xl" />
                <div className="relative rounded-2xl border border-primary/20 bg-primary/10 p-4">
                  <Rocket className="size-8 text-primary" />
                </div>
              </div>

              <div className="space-y-1.5 px-2">
                <h3 className="text-lg font-bold tracking-tight">
                  Otimizando sua Experiência
                </h3>
                <p className="text-xs leading-relaxed text-zinc-400">
                  Uma nova versão está sendo sincronizada automaticamente para
                  garantir performance máxima.
                </p>
              </div>

              {/* Version De→Para */}
              {toVer && (
                <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-[10px]">
                  <span className="text-zinc-500">{fromVer}</span>
                  <ArrowRight className="size-2.5 text-zinc-700" />
                  <span className="font-bold text-primary">{toVer}</span>
                </div>
              )}

              {/* Progress bar */}
              <div className="w-full space-y-3">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                  <motion.div
                    className="h-full bg-primary shadow-[0_0_10px_rgba(234,179,8,0.3)]"
                    initial={{ width: 0 }}
                    animate={{ width: `${isUpdating ? progress : 0}%` }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                  />
                </div>
                <div className="flex items-center justify-between px-1">
                  <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                    {isUpdating ? "Sincronizando" : "Aguardando"}
                  </p>
                  <p className="font-mono text-[10px] font-bold text-primary">
                    {isUpdating ? `${progress}%` : "Iniciando..."}
                  </p>
                </div>
              </div>
            </div>

            {/* Bottom shine */}
            <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
