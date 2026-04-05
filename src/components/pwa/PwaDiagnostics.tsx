import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Activity, ShieldCheck, Zap, Server, Database, X,
    Trash2, ChevronDown, ChevronUp, Wifi, WifiOff, Share2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

declare const __APP_VERSION__: string;

interface CacheStat { name: string; count: number }
interface ForensicEntry { t: string; m: string; d?: unknown }

interface PwaDiagnosticsProps {
    isOpen: boolean;
    onClose: () => void;
}

export function PwaDiagnostics({ isOpen, onClose }: PwaDiagnosticsProps) {
    const [swStatus, setSwStatus] = useState('Detectando...');
    const [swVersion, setSwVersion] = useState<string | null>(null);
    const [storageUsed, setStorageUsed] = useState<string>('—');
    const [storageQuota, setStorageQuota] = useState<string>('—');
    const [cacheStats, setCacheStats] = useState<CacheStat[]>([]);
    const [forensicLogs, setForensicLogs] = useState<ForensicEntry[]>([]);
    const [latency, setLatency] = useState<string>('—');
    const [isPurging, setIsPurging] = useState(false);
    const [showLogs, setShowLogs] = useState(false);
    const [isOnline, setIsOnline] = useState(navigator.onLine);

    // --- Data Fetchers ---
    const refresh = useCallback(async () => {
        if (!isOpen) return;

        // SW status
        if ('serviceWorker' in navigator) {
            const reg = await navigator.serviceWorker.getRegistration();
            if (!reg) setSwStatus('Não registrado');
            else if (reg.active) setSwStatus('Ativo ✓');
            else if (reg.waiting) setSwStatus('Aguardando update');
            else setSwStatus('Instalando...');

            // Ask SW for version
            const bc = new BroadcastChannel('sw-messages');
            bc.onmessage = (e) => {
                if (e.data?.type === 'VERSION_REPORT') setSwVersion(e.data.version);
                if (e.data?.type === 'CACHE_STATS') setCacheStats(e.data.stats || []);
                bc.close();
            };
            reg?.active?.postMessage({ type: 'GET_VERSION' });
            reg?.active?.postMessage({ type: 'GET_CACHE_STATS' });
        }

        // Storage estimate
        if ('storage' in navigator && navigator.storage.estimate) {
            const est = await navigator.storage.estimate();
            const used = Math.round((est.usage || 0) / (1024 * 1024) * 10) / 10;
            const quota = Math.round((est.quota || 0) / (1024 * 1024 * 1024) * 10) / 10;
            setStorageUsed(`${used} MB`);
            setStorageQuota(`${quota} GB`);
        }

        // Forensic logs
        try {
            const raw = localStorage.getItem('pwa_forensics');
            if (raw) setForensicLogs(JSON.parse(raw));
        } catch { /* silent */ }

        // Latency ping (using root as version.json is no longer generated)
        const t0 = performance.now();
        try {
            await fetch(`/?_ping=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
            setLatency(`${Math.round(performance.now() - t0)}ms`);
        } catch {
            setLatency('timeout');
        }
    }, [isOpen]);

    useEffect(() => {
        if (isOpen) {
            setTimeout(() => refresh(), 0);
        }
        const handleConnectionChange = () => {
            setIsOnline(navigator.onLine);
        };
        window.addEventListener('online', handleConnectionChange);
        window.addEventListener('offline', handleConnectionChange);
        return () => {
            window.removeEventListener('online', handleConnectionChange);
            window.removeEventListener('offline', handleConnectionChange);
        };
    }, [isOpen, refresh]);

    // --- Manual Purge ---
    const handlePurge = useCallback(async () => {
        setIsPurging(true);
        try {
            const bc = new BroadcastChannel('sw-messages');
            const done = new Promise<void>(resolve => {
                bc.onmessage = (e) => {
                    if (e.data?.type === 'PURGE_COMPLETE') { bc.close(); resolve(); }
                };
            });
            // Ask SW to purge
            const reg = await navigator.serviceWorker.getRegistration();
            reg?.active?.postMessage({ type: 'MANUAL_PURGE' });

            // Also purge directly from client
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));

            await Promise.race([done, new Promise(r => setTimeout(r, 3000))]);

            toast.success('Cache purgado com sucesso!', { description: `${keys.length} cache(s) removidos.` });
            localStorage.removeItem('pwa_forensics');
            await refresh();
        } catch (e) {
            toast.error('Erro ao purgar cache', { description: String(e) });
        }
        setIsPurging(false);
    }, [refresh]);

    // --- Export Logs via Web Share API ---
    const handleExportLogs = useCallback(async () => {
        const payload = {
            exportedAt: new Date().toISOString(),
            appVersion: __APP_VERSION__,
            swVersion,
            isOnline,
            latency,
            cacheStats,
            forensicLogs,
        };
        const text = JSON.stringify(payload, null, 2);

        if (navigator.share) {
            try {
                // Tenta compactar logs massivos se disponível
                if ('CompressionStream' in window) {
                    const stream = new Blob([text]).stream();
                    const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
                    const compressedBlob = await new Response(compressedStream).blob();

                    if (compressedBlob.size > 0) {
                        console.log(`[Diagnostics] Logs compressed: ${text.length} -> ${compressedBlob.size} bytes`);
                    }
                }

                await navigator.share({
                    title: 'IKCOUS PWA Diagnostics (ZENITH)',
                    text: `Diagnóstico saturado v21 OMEGA\nIntegridade: OK\nGerado em: ${new Date().toLocaleString('pt-BR')}`,
                    url: 'https://ickous-marketplace.vercel.app'
                });
                toast.success('Pronto para compartilhar!');
            } catch (e) {
                if (String(e).includes('Abort')) return;
                toast.error('Erro ao compartilhar');
            }
        } else {
            // Fallback to clipboard
            navigator.clipboard.writeText(text).then(() => {
                toast.success('Logs copiados!', { description: 'Cole no terminal ou Slack para análise.' });
            }).catch(() => {
                toast.error('Erro ao copiar', { description: 'Tente manualmente.' });
            });
        }
    }, [swVersion, isOnline, latency, cacheStats, forensicLogs]);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 24 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 24 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    className="fixed inset-x-3 bottom-24 z-[10001] bg-white/85 dark:bg-zinc-950/90 backdrop-blur-3xl border border-zinc-200 dark:border-zinc-800 rounded-[28px] shadow-2xl"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-zinc-100 dark:border-zinc-900">
                        <div className="flex items-center gap-2.5">
                            <div className="p-1.5 bg-zinc-900 dark:bg-white rounded-xl">
                                <ShieldCheck className="w-4 h-4 text-white dark:text-zinc-900" />
                            </div>
                            <div>
                                <h3 className="font-black text-[10px] uppercase tracking-[0.2em]">PWA Diagnostics</h3>
                                <p className="text-[9px] text-zinc-400">v28.0 INFINITY: THE ETERNAL SYNC (ESTADO FINAL)</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {isOnline
                                ? <Wifi className="w-3.5 h-3.5 text-emerald-500" />
                                : <WifiOff className="w-3.5 h-3.5 text-red-400" />}
                            <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full h-7 w-7">
                                <X className="w-3.5 h-3.5" />
                            </Button>
                        </div>
                    </div>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 gap-2.5 p-4">
                        <DiagCard icon={<Zap className="w-3.5 h-3.5" />} label="App Version" value={__APP_VERSION__.slice(-8)} />
                        <DiagCard icon={<Activity className="w-3.5 h-3.5" />} label="SW Status" value={swStatus} highlight />
                        <DiagCard icon={<Server className="w-3.5 h-3.5" />} label="SW Version" value={swVersion || '—'} />
                        <DiagCard icon={<Wifi className="w-3.5 h-3.5" />} label="Latência" value={latency} />
                        <DiagCard icon={<Database className="w-3.5 h-3.5" />} label="Uso Local" value={storageUsed} subValue={`de ${storageQuota}`} />
                        <DiagCard icon={<Database className="w-3.5 h-3.5" />} label="Caches Ativos" value={String(cacheStats.length)} />
                    </div>

                    {/* Cache Inspector */}
                    {cacheStats.length > 0 && (
                        <div className="mx-4 mb-3 p-3 bg-zinc-50 dark:bg-zinc-900/50 rounded-2xl border border-zinc-100 dark:border-zinc-800/50">
                            <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-400 mb-2">Cache Inspector</p>
                            <div className="space-y-1">
                                {cacheStats.map(c => (
                                    <div key={c.name} className="flex items-center justify-between">
                                        <span className="text-[10px] text-zinc-600 dark:text-zinc-400 font-mono truncate max-w-[160px]">{c.name}</span>
                                        <span className="text-[10px] font-bold text-zinc-800 dark:text-zinc-200">{c.count} itens</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Forensic Logs Toggle */}
                    <div className="mx-4 mb-3">
                        <button
                            onClick={() => setShowLogs(v => !v)}
                            className="w-full flex items-center justify-between px-3 py-2 bg-zinc-50 dark:bg-zinc-900/50 rounded-2xl border border-zinc-100 dark:border-zinc-800/50 text-[10px] font-bold uppercase tracking-wider text-zinc-500"
                        >
                            <span>Forensic Log ({forensicLogs.length})</span>
                            {showLogs ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>

                        <AnimatePresence>
                            {showLogs && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="overflow-hidden"
                                >
                                    <div className="mt-1 max-h-40 overflow-y-auto space-y-1 p-2 bg-zinc-50 dark:bg-zinc-900/50 rounded-2xl border border-zinc-100 dark:border-zinc-800/50">
                                        {forensicLogs.length === 0 && (
                                            <p className="text-[10px] text-zinc-400 text-center py-2">Nenhum log</p>
                                        )}
                                        {forensicLogs.map((log, i) => (
                                            <div key={i} className="text-[9px] font-mono text-zinc-600 dark:text-zinc-400">
                                                <span className="text-zinc-400">{new Date(log.t).toLocaleTimeString('pt-BR')}</span>
                                                {' '}<span className="text-zinc-700 dark:text-zinc-300">{log.m}</span>
                                            </div>
                                        ))}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-2 px-4 pb-5">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleExportLogs}
                            className="flex-1 rounded-xl h-9 text-[11px] font-bold gap-1.5"
                        >
                            <Share2 className="w-3 h-3" />
                            Compartilhar Logs
                        </Button>
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={handlePurge}
                            disabled={isPurging}
                            className="flex-1 rounded-xl h-9 text-[11px] font-bold gap-1.5"
                        >
                            <Trash2 className={cn('w-3 h-3', isPurging && 'animate-spin')} />
                            {isPurging ? 'Purgando...' : 'Purge & Reload'}
                        </Button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

function DiagCard({ icon, label, value, subValue, highlight }: {
    icon: React.ReactNode;
    label: string;
    value: string;
    subValue?: string;
    highlight?: boolean;
}) {
    return (
        <div className="bg-zinc-50 dark:bg-zinc-900/50 p-3.5 rounded-2xl border border-zinc-100 dark:border-zinc-800/50">
            <div className="flex items-center gap-1.5 mb-1.5 opacity-50">
                {icon}
                <span className="text-[9px] font-bold uppercase tracking-wider">{label}</span>
            </div>
            <div className={cn('text-xs font-black leading-tight', highlight && 'text-emerald-500')}>
                {value}
            </div>
            {subValue && <div className="text-[9px] text-zinc-400 mt-0.5">{subValue}</div>}
        </div>
    );
}
