import { motion, AnimatePresence } from 'framer-motion';
import { Rocket, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState, useEffect, useCallback } from 'react';

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
                <div className="fixed inset-x-0 bottom-0 z-[10000] pointer-events-none flex items-end justify-center pb-safe mb-28">
                    {/* Mandatory backdrop for all updates now */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-black/40 backdrop-blur-sm pointer-events-auto"
                    />

                    {/* Notification Card */}
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0, y: 40 }}
                        animate={{ scale: 1, opacity: 1, y: -20 }}
                        exit={{ scale: 0.9, opacity: 0, y: 40 }}
                        transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                        className={cn(
                            'relative pointer-events-auto mx-4 overflow-hidden',
                            'backdrop-blur-2xl border shadow-2xl',
                            'w-full max-w-[340px] rounded-[2rem] p-6 bg-zinc-950/90 border-white/10 text-white'
                        )}
                    >
                        {/* Top shine */}
                        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />

                        <div className="flex flex-col items-center text-center space-y-5">
                            <div className="relative">
                                <div className="absolute inset-0 bg-primary/20 blur-2xl rounded-full animate-pulse" />
                                <div className="relative bg-primary/10 p-4 rounded-2xl border border-primary/20">
                                    <Rocket className="w-8 h-8 text-primary" />
                                </div>
                            </div>

                            <div className="space-y-1.5 px-2">
                                <h3 className="text-lg font-bold tracking-tight">Otimizando sua Experiência</h3>
                                <p className="text-xs text-zinc-400 leading-relaxed">
                                    Uma nova versão está sendo sincronizada automaticamente para garantir performance máxima.
                                </p>
                            </div>

                            {/* Version De→Para */}
                            {toVer && (
                                <div className="flex items-center gap-2 text-[10px] font-mono bg-white/5 px-3 py-1.5 rounded-full border border-white/10">
                                    <span className="text-zinc-500">{fromVer}</span>
                                    <ArrowRight className="w-2.5 h-2.5 text-zinc-700" />
                                    <span className="text-primary font-bold">{toVer}</span>
                                </div>
                            )}

                            {/* Progress bar */}
                            <div className="w-full space-y-3">
                                <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                                    <motion.div
                                        className="h-full bg-primary shadow-[0_0_10px_rgba(234,179,8,0.3)]"
                                        initial={{ width: 0 }}
                                        animate={{ width: `${isUpdating ? progress : 0}%` }}
                                        transition={{ duration: 0.3, ease: 'easeOut' }}
                                    />
                                </div>
                                <div className="flex justify-between items-center px-1">
                                    <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest">
                                        {isUpdating ? 'Sincronizando' : 'Aguardando'}
                                    </p>
                                    <p className="text-[10px] font-bold text-primary font-mono">
                                        {isUpdating ? `${progress}%` : 'Iniciando...'}
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
