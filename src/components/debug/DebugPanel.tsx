import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, RefreshCw, Trash2, Wifi, WifiOff, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStore } from '@/hooks/useStore';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

declare const __APP_VERSION__: string;

interface DebugPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

export function DebugPanel({ isOpen, onClose }: DebugPanelProps) {
    const { config } = useStore();
    const { user } = useAuth();
    const [swStatus, setSwStatus] = useState<string>('unknown');
    const [networkStatus, setNetworkStatus] = useState<string>('online');
    const [lastCheck, setLastCheck] = useState<string>('-');
    const [remoteVersion, setRemoteVersion] = useState<string>('checking...');

    const checkEverything = useCallback(async () => {
        // 1. Check Network
        setNetworkStatus(navigator.onLine ? 'online' : 'offline');

        // 2. Check SW
        if ('serviceWorker' in navigator) {
            const reg = await navigator.serviceWorker.getRegistration();
            if (reg) {
                setSwStatus(reg.active ? 'active' : reg.waiting ? 'waiting' : 'installing');
            } else {
                setSwStatus('not_registered');
            }
        } else {
            setSwStatus('unsupported');
        }

        // 3. Remote Version check (handled by PWA Engine)
        setRemoteVersion('PWA engine active');

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
        if (!confirm('ISSO VAI RESETAR TUDO E RECARREGAR. TEM CERTEZA?')) return;

        toast.info('Iniciando protocolo nuclear...');

        try {
            // 1. Unregister SW
            if ('serviceWorker' in navigator) {
                const regs = await navigator.serviceWorker.getRegistrations();
                for (const r of regs) await r.unregister();
            }

            // 2. Clear Caches
            if ('caches' in window) {
                const keys = await caches.keys();
                for (const k of keys) await caches.delete(k);
            }

            // 3. Clear LocalStorage (Warning: clears auth too if not careful, but maybe necessary for "nuclear")
            // We will keep 'sb-' keys (Supabase) to try and save auth, but clear others
            Object.keys(localStorage).forEach(key => {
                if (!key.startsWith('sb-')) localStorage.removeItem(key);
            });

            // 4. Force Reload with Timestamp to bust cache
            window.location.href = window.location.origin + '?nuclear=' + Date.now();

        } catch {
            toast.error('Falha no reset');
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
                        className="relative w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-2xl p-6 shadow-2xl overflow-hidden"
                    >
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-2">
                                <ShieldAlert className="w-5 h-5 text-red-500" />
                                <h2 className="font-mono text-lg font-bold text-white">SYSTEM DIAGNOSTICS</h2>
                            </div>
                            <Button size="icon" variant="ghost" onClick={onClose} className="h-8 w-8 text-zinc-400">
                                <X className="w-4 h-4" />
                            </Button>
                        </div>

                        <div className="space-y-4 font-mono text-xs">

                            {/* STATUS GRID */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
                                    <div className="text-zinc-500 mb-1">APP VERSION</div>
                                    <div className="text-emerald-400 font-bold">{__APP_VERSION__}</div>
                                </div>
                                <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
                                    <div className="text-zinc-500 mb-1">REMOTE VER</div>
                                    <div className={remoteVersion === __APP_VERSION__ ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>
                                        {remoteVersion}
                                    </div>
                                </div>
                                <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
                                    <div className="text-zinc-500 mb-1">SW STATUS</div>
                                    <div className="text-blue-400 font-bold">{swStatus}</div>
                                </div>
                                <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
                                    <div className="text-zinc-500 mb-1">NETWORK</div>
                                    <div className="flex items-center gap-2">
                                        {networkStatus === 'online' ? <Wifi className="w-3 h-3 text-emerald-500" /> : <WifiOff className="w-3 h-3 text-red-500" />}
                                        <span className="text-white">{networkStatus}</span>
                                    </div>
                                </div>
                            </div>

                            {/* STORE CONFIG */}
                            <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
                                <div className="text-zinc-500 mb-1 flex justify-between">
                                    <span>STORE ID</span>
                                    <span className="text-[10px] text-zinc-600">MinAppVer: {config?.minAppVersion || 'N/A'}</span>
                                </div>
                                <div className="text-white truncate">{config?.minAppVersion ? 'CONFIG LOADED' : 'NO CONFIG'}</div>
                                <div className="text-zinc-600 mt-1 truncate">User: {user?.id || 'ANONYMOUS'}</div>
                            </div>

                            {/* ACTIONS */}
                            <div className="grid grid-cols-2 gap-3 mt-6">
                                <Button
                                    variant="outline"
                                    onClick={checkEverything}
                                    className="h-12 bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-zinc-300"
                                >
                                    <RefreshCw className="w-4 h-4 mr-2" />
                                    Refresh Stats
                                </Button>

                                <Button
                                    variant="destructive"
                                    onClick={forceNuclearReset}
                                    className="h-12 bg-red-900/20 border-red-900/50 hover:bg-red-900/40 text-red-400"
                                >
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    NUCLEAR RESET
                                </Button>
                            </div>

                            <div className="text-center text-zinc-700 mt-4 text-[10px]">
                                Last check: {lastCheck}
                            </div>

                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
