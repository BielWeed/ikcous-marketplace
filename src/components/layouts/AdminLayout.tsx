import React from 'react';
import {
    Bell,
    ArrowLeft,
    Activity,
    Package,
    ShoppingBag,
    Settings,
    Users
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { View } from '@/types';
import { cn } from '@/lib/utils';
import { Helmet } from 'react-helmet-async';
import { usePrefetchOnHover } from '@/hooks/usePrefetchOnHover';
import { haptic } from '@/utils/haptic';
import { motion, AnimatePresence } from 'framer-motion';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

interface AdminLayoutProps {
    children: React.ReactNode;
    currentView: View;
    onNavigate: (view: View) => void;
}

export function AdminLayout({ children, currentView, onNavigate }: AdminLayoutProps) {
    const { prefetchView } = usePrefetchOnHover();
    const isMainTab = ['admin-dashboard', 'admin', 'admin-products', 'admin-orders', 'admin-customers', 'admin-settings'].includes(currentView);

    const navItems = [
        { icon: Activity, label: 'Geral', view: 'admin-dashboard' },
        { icon: Package, label: 'Pedidos', view: 'admin-orders' },
        { icon: ShoppingBag, label: 'Produtos', view: 'admin-products' },
        { icon: Users, label: 'Clientes', view: 'admin-customers' },
        { icon: Settings, label: 'Ajustes', view: 'admin-settings' },
    ];

    const isOffline = useOnlineStatus();

    const getParentView = (view: View): View | 'profile' => {
        switch (view) {
            case 'admin-product-form':
                return 'admin-products';
            case 'admin-user-detail':
                return 'admin-customers';
            case 'admin-push':
                return 'admin-dashboard';
            case 'admin-coupons':
            case 'admin-banners':
            case 'admin-reviews':
            case 'admin-qa':
                return 'admin-settings';
            default:
                return 'profile';
        }
    };

    const parentView = getParentView(currentView);
    const isSubView = parentView !== 'profile';

    return (
        <div className="h-[100dvh] w-screen overflow-hidden bg-[#09090b] flex flex-col font-sans text-zinc-50">
            <Helmet>
                <title>IKCOUS | Admin Dashboard</title>
                <meta name="description" content="Sistema de navegação unificada e operação." />
                <meta property="og:title" content="IKCOUS Admin" />
            </Helmet>
            
            {/* Offline Alert Banner */}
            {isOffline && (
                <div className="bg-red-500/10 border-b border-red-500/20 text-red-400 text-[10px] font-black uppercase tracking-widest py-2.5 px-6 text-center animate-in fade-in slide-in-from-top duration-300 relative z-[70] flex items-center justify-center gap-2 select-none shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
                    <span>Conexão perdida. Algumas ações administrativas estão temporariamente bloqueadas.</span>
                </div>
            )}

            {/* Premium Header */}
            <header 
                className="px-6 py-4 md:py-6 relative top-0 z-50 border-b border-white/5 flex-shrink-0 bg-[#09090b]/80 backdrop-blur-xl"
                style={{ viewTransitionName: 'admin-header' } as React.CSSProperties}
            >
                <div className="max-w-7xl mx-auto flex items-center justify-between relative h-10 md:h-12">
                    {/* Left: Profile or Back Button */}
                    <div className="absolute left-0">
                        <Button
                            variant="ghost"
                            onClick={() => {
                                haptic.light();
                                onNavigate(parentView as View);
                            }}
                            onMouseEnter={() => prefetchView(parentView as any)}
                            onTouchStart={() => prefetchView(parentView as any)}
                            className="flex items-center gap-2 rounded-full bg-zinc-900 border border-white/5 font-bold text-[10px] md:text-xs text-white uppercase tracking-widest px-3 md:px-4 transition-all hover:bg-zinc-800 active:scale-95"
                        >
                            <ArrowLeft className="w-4 h-4" /> <span className="inline">{isSubView ? 'Voltar' : 'Perfil'}</span>
                        </Button>
                    </div>

                    {/* Center: Logo */}
                    <div className="flex-1 flex flex-col items-center justify-center text-center">
                        <h1 className="text-xl md:text-2xl font-black tracking-tight text-white leading-none">IKCOUS <span className="text-admin-gold">Admin</span></h1>
                        <p className="text-[9px] md:text-xs font-medium text-zinc-500 uppercase tracking-widest mt-1 leading-none">Navegação Unificada</p>
                    </div>

                    {/* Right: Notifications */}
                    <div className="absolute right-0">
                        <Button 
                            variant="ghost" 
                            size="icon" 
                            className="rounded-full bg-zinc-900 border border-white/5 hover:bg-zinc-800"
                            onClick={() => {
                                haptic.light();
                                onNavigate('admin-push');
                            }}
                            onMouseEnter={() => prefetchView('admin-push')}
                            onTouchStart={() => prefetchView('admin-push')}
                        >
                            <Bell className="w-5 h-5 text-admin-gold" />
                        </Button>
                    </div>
                </div>
            </header>

            {/* Main Content Area */}
            <main className="flex-1 overflow-hidden w-full bg-[#09090b] gpu-accelerated">
                <div className="w-full h-full max-w-7xl mx-auto py-0 overflow-hidden flex flex-col relative">
                    {(() => {
                        const isTransitionSupported = typeof document !== 'undefined' && 'startViewTransition' in document;

                        if (isTransitionSupported) {
                            return (
                                <div key="admin-content-wrapper" className="w-full h-full">
                                    {children}
                                </div>
                            );
                        }
                        return (
                            <AnimatePresence mode="wait">
                                <motion.div
                                    key="admin-content-wrapper-motion"
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -8 }}
                                    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                                    className="w-full h-full"
                                >
                                    {children}
                                </motion.div>
                            </AnimatePresence>
                        );
                    })()}
                </div>
            </main>

            {/* Floating Bottom Navigation */}
            <div className="flex-shrink-0 relative z-[60]">
                <AnimatePresence>
                    {isMainTab && (
                        <motion.nav 
                            initial={{ y: 120, x: '-50%', opacity: 0 }}
                            animate={{ y: 0, x: '-50%', opacity: 1 }}
                            exit={{ y: 120, x: '-50%', opacity: 0 }}
                            transition={{ type: 'spring', stiffness: 260, damping: 25 }}
                            className="fixed left-1/2 w-[90%] max-w-lg admin-glass border border-white/10 shadow-[0_20px_40px_rgba(0,0,0,0.8)] rounded-[2rem] p-2 flex items-center justify-between bg-zinc-900/80 backdrop-blur-2xl"
                            style={{ 
                                viewTransitionName: 'admin-bottom-nav',
                                bottom: 'calc(1.5rem + var(--safe-area-bottom-fixed, env(safe-area-inset-bottom, 0px)))'
                            } as React.CSSProperties}
                        >
                            {navItems.map((item, idx) => {
                                const Icon = item.icon;
                                const isActive = currentView === item.view;

                                return (
                                    <button
                                        key={idx}
                                        onClick={() => {
                                            haptic.light();
                                            onNavigate(item.view as View);
                                        }}
                                        onMouseEnter={() => prefetchView(item.view)}
                                        onTouchStart={() => prefetchView(item.view)}
                                        className={cn(
                                            "flex flex-col items-center gap-0.5 sm:gap-1 flex-1 py-2 rounded-2xl relative transition-all active:scale-95 group z-10",
                                            isActive ? "text-admin-gold" : "text-zinc-500 hover:text-zinc-300"
                                        )}
                                    >
                                        {isActive && (
                                            <motion.div
                                                layoutId="admin-active-pill"
                                                className="absolute inset-0 bg-zinc-800/60 border border-white/10 rounded-2xl -z-10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_8px_16px_rgba(0,0,0,0.4)]"
                                                transition={{ type: "spring", stiffness: 380, damping: 30 }}
                                            />
                                        )}
                                        <Icon className={cn("w-5 h-5 transition-transform group-hover:-translate-y-0.5", isActive && "scale-110")} />
                                        <span className={cn("text-[9px] font-black uppercase tracking-tighter transition-all hidden sm:inline-block", isActive ? "opacity-100" : "opacity-60")}>
                                            {item.label}
                                        </span>
                                        {isActive && (
                                            <span className="w-1 h-1 rounded-full bg-admin-gold sm:hidden mt-0.5 animate-in zoom-in duration-300" />
                                        )}
                                    </button>
                                );
                            })}
                        </motion.nav>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}
