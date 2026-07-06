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
import { useAnalytics } from '@/hooks/useAnalytics';
import { useProducts } from '@/hooks/useProducts';
import { useOrders } from '@/hooks/useOrders';
import { prefetchCustomersData } from '@/utils/admin_cache';

interface AdminLayoutProps {
    children: React.ReactNode;
    currentView: View;
    onNavigate: (view: View) => void;
}

export function AdminLayout({ children, currentView, onNavigate }: AdminLayoutProps) {
    const { prefetchView } = usePrefetchOnHover();
    const { fetchExecutiveSummary, fetchCategoryAnalytics } = useAnalytics();
    const { loadProducts } = useProducts({ autoFetch: false });
    const { loadOrders } = useOrders(false, true);
    
    const handleHoverTab = React.useCallback((view: string) => {
        if (view === currentView || (view === 'admin-dashboard' && currentView === 'admin') || (view === 'admin' && currentView === 'admin-dashboard')) {
            return;
        }
        prefetchView(view);
        if (view === 'admin-dashboard' || view === 'admin') {
            fetchExecutiveSummary(false).catch(() => {});
            fetchCategoryAnalytics(
                '2020-01-01T00:00:00.000Z',
                new Date().toISOString(),
                false
            ).catch(() => {});
        } else if (view === 'admin-products') {
            loadProducts(0, 12, { silent: true }).catch(() => {});
        } else if (view === 'admin-orders') {
            loadOrders(0, 12, 'all', '', '', '', true).catch(() => {});
        } else if (view === 'admin-customers') {
            prefetchCustomersData().catch(() => {});
        } else if (view === 'admin-settings') {
            prefetchView('admin-coupons');
            prefetchView('admin-banners');
            prefetchView('admin-reviews');
            prefetchView('admin-qa');
        }
    }, [currentView, prefetchView, fetchExecutiveSummary, fetchCategoryAnalytics, loadProducts, loadOrders]);

    const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleMouseEnter = React.useCallback((view: string, isImmediate = false) => {
        if (hoverTimerRef.current) {
            clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = null;
        }

        if (isImmediate) {
            handleHoverTab(view);
            return;
        }

        hoverTimerRef.current = setTimeout(() => {
            handleHoverTab(view);
            hoverTimerRef.current = null;
        }, 180);
    }, [handleHoverTab]);

    const handleMouseLeave = React.useCallback(() => {
        if (hoverTimerRef.current) {
            clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = null;
        }
    }, []);

    React.useEffect(() => {
        return () => {
            if (hoverTimerRef.current) {
                clearTimeout(hoverTimerRef.current);
            }
        };
    }, []);

    React.useEffect(() => {
        // Close any open Radix UI dropdowns/popovers/dialogs on view transitions
        // by dispatching Escape key event to window/document/activeElement.
        // We use a small timeout to let the view transition and focus change settle.
        const timer = setTimeout(() => {
            console.log(`[AdminLayout] currentView changed to: ${currentView}. Dispatching Escape events after timeout...`);
            const dispatchEscape = (target: any, name: string) => {
                if (!target) return;
                const escapeEvent = new KeyboardEvent('keydown', {
                    key: 'Escape',
                    code: 'Escape',
                    keyCode: 27,
                    which: 27,
                    bubbles: true,
                    cancelable: true
                });
                target.dispatchEvent(escapeEvent);
                console.log(`[AdminLayout] Dispatched Escape to: ${name}`);
            };
            
            dispatchEscape(document.activeElement, 'activeElement');
            dispatchEscape(document, 'document');
            dispatchEscape(window, 'window');
        }, 50);

        return () => clearTimeout(timer);
    }, [currentView]);




    const isMainTab = ['admin-dashboard', 'admin', 'admin-products', 'admin-orders', 'admin-customers', 'admin-settings'].includes(currentView);

    const navItems = [
        { icon: Activity, label: 'Geral', view: 'admin-dashboard' },
        { icon: Package, label: 'Pedidos', view: 'admin-orders' },
        { icon: ShoppingBag, label: 'Produtos', view: 'admin-products' },
        { icon: Users, label: 'Clientes', view: 'admin-customers' },
        { icon: Settings, label: 'Ajustes', view: 'admin-settings' },
    ];

    const isOffline = useOnlineStatus();

    const [isKeyboardOpen, setIsKeyboardOpen] = React.useState(false);

    React.useEffect(() => {
        if (typeof window === 'undefined') return;
        const viewport = window.visualViewport;
        if (!viewport) return;

        let rafId: number;
        const handleResize = () => {
            cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                const keyboardActive = viewport.height < window.innerHeight * 0.85;
                setIsKeyboardOpen(keyboardActive);
            });
        };

        viewport.addEventListener('resize', handleResize);
        return () => {
            cancelAnimationFrame(rafId);
            viewport.removeEventListener('resize', handleResize);
        };
    }, []);

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
        <div className="h-[100dvh] w-screen overflow-hidden bg-[#09090b] flex flex-col lg:flex-row font-sans text-zinc-50">
            <Helmet>
                <title>IKCOUS | Admin Dashboard</title>
                <meta name="description" content="Sistema de navegação unificada e operação." />
                <meta property="og:title" content="IKCOUS Admin" />
            </Helmet>
            
            {/* Desktop Sidebar */}
            <aside className="hidden lg:flex flex-col w-64 border-r border-white/5 bg-[#09090b]/80 backdrop-blur-xl p-6 justify-between flex-shrink-0 z-50">
                <div className="space-y-8">
                    <div className="flex flex-col select-none">
                        <div className="flex items-center gap-2">
                            <h1 className="text-xl font-black tracking-tight text-white leading-none">IKCOUS <span className="text-admin-gold">Admin</span></h1>
                            {isOffline && (
                                <span className="text-[8px] font-black bg-red-500/10 border border-red-500/30 text-red-400 rounded-full px-2 py-0.5 animate-pulse uppercase tracking-wider shrink-0">Offline</span>
                            )}
                        </div>
                        <p className="text-[9px] font-medium text-zinc-500 uppercase tracking-widest mt-1.5 leading-none">Navegação Unificada</p>
                    </div>

                    <nav className="flex flex-col gap-1.5">
                        {navItems.map((item, idx) => {
                            const Icon = item.icon;
                            const isActive = currentView === item.view || (item.view === 'admin-dashboard' && currentView === 'admin');

                            return (
                                <button
                                    key={idx}
                                    onClick={() => {
                                        haptic.light();
                                        onNavigate(item.view as View);
                                    }}
                                    onMouseEnter={() => handleMouseEnter(item.view)}
                                    onMouseLeave={handleMouseLeave}
                                    onTouchStart={() => handleMouseEnter(item.view, true)}
                                    className={cn(
                                        "flex items-center gap-3.5 px-4 py-3.5 rounded-2xl relative transition-all active:scale-95 group z-10 text-left font-black uppercase text-[10px] tracking-widest transform-gpu",
                                        isActive ? "text-admin-gold" : "text-zinc-500 hover:text-zinc-300"
                                    )}
                                >
                                    {isActive && (
                                        <motion.div
                                            layoutId="admin-active-pill-desktop"
                                            className="absolute inset-0 bg-zinc-800/40 border border-white/5 rounded-2xl -z-10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_8px_16px_rgba(0,0,0,0.3)]"
                                            transition={{ type: "spring", stiffness: 380, damping: 30 }}
                                        />
                                    )}
                                    <Icon className={cn("w-4.5 h-4.5 transition-transform group-hover:scale-105", isActive && "scale-110")} />
                                    <span>{item.label}</span>
                                </button>
                            );
                        })}
                    </nav>
                </div>

                <div className="space-y-4 pt-4 border-t border-white/5 flex flex-col gap-2">
                    <Button
                        variant="ghost"
                        onClick={() => {
                            haptic.light();
                            onNavigate(parentView as View);
                        }}
                        onMouseEnter={() => handleMouseEnter(parentView as any)}
                        onMouseLeave={handleMouseLeave}
                        className="w-full flex items-center justify-start gap-3 rounded-2xl bg-zinc-900/60 border border-white/5 font-bold text-[10px] text-white uppercase tracking-widest px-4 py-3.5 h-11 hover:bg-zinc-800 hover:text-white transition-all active:scale-95 transform-gpu"
                    >
                        <ArrowLeft className="w-4 h-4 text-zinc-400" /> <span>{isSubView ? 'Voltar' : 'Perfil'}</span>
                    </Button>
                    <Button
                        variant="ghost"
                        onClick={() => {
                            haptic.light();
                            onNavigate('admin-push');
                        }}
                        onMouseEnter={() => handleMouseEnter('admin-push')}
                        onMouseLeave={handleMouseLeave}
                        className="w-full flex items-center justify-start gap-3 rounded-2xl bg-zinc-900/60 border border-white/5 font-bold text-[10px] text-white uppercase tracking-widest px-4 py-3.5 h-11 hover:bg-zinc-800 hover:text-white transition-all active:scale-95 transform-gpu"
                    >
                        <Bell className="w-4 h-4 text-admin-gold" /> <span>Push</span>
                    </Button>
                </div>
            </aside>

            {/* Main Area Wrapper */}
            <div className="flex-1 flex flex-col h-full overflow-hidden relative">
                {/* Offline Alert Banner */}
                {isOffline && (
                    <div className="bg-red-500/10 border-b border-red-500/20 text-red-400 text-[10px] font-black uppercase tracking-widest py-2.5 px-6 text-center animate-in fade-in slide-in-from-top duration-300 relative z-[70] flex items-center justify-center gap-2 select-none shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
                        <span>Conexão perdida. Criação, edição e exclusão de dados estão temporariamente bloqueadas.</span>
                    </div>
                )}

                {/* Premium Header - Mobile Only */}
                <header 
                    className="lg:hidden px-6 py-4 md:py-6 relative top-0 z-50 border-b border-white/5 flex-shrink-0 bg-[#09090b]/80 backdrop-blur-xl"
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
                                onMouseEnter={() => handleMouseEnter(parentView as any)}
                                onMouseLeave={handleMouseLeave}
                                onTouchStart={() => handleMouseEnter(parentView as any, true)}
                                className="flex items-center gap-2 rounded-full bg-zinc-900 border border-white/5 font-bold text-[10px] md:text-xs text-white uppercase tracking-widest px-3 md:px-4 transition-all hover:bg-zinc-800 active:scale-95 transform-gpu"
                            >
                                <ArrowLeft className="w-4 h-4" /> <span className="inline">{isSubView ? 'Voltar' : 'Perfil'}</span>
                            </Button>
                        </div>

                        {/* Center: Logo */}
                        <div className="flex-1 flex flex-col items-center justify-center text-center">
                            <div className="flex items-center gap-1.5 justify-center">
                                <h1 className="text-xl md:text-2xl font-black tracking-tight text-white leading-none">IKCOUS <span className="text-admin-gold">Admin</span></h1>
                                {isOffline && (
                                    <span className="text-[8px] font-black bg-red-500/10 border border-red-500/30 text-red-400 rounded-full px-1.5 py-0.5 animate-pulse uppercase tracking-wider shrink-0">Offline</span>
                                )}
                            </div>
                            <p className="text-[9px] md:text-xs font-medium text-zinc-500 uppercase tracking-widest mt-1 leading-none">Navegação Unificada</p>
                        </div>

                        {/* Right: Notifications */}
                        <div className="absolute right-0">
                            <Button 
                                variant="ghost" 
                                size="icon" 
                                className="rounded-full bg-zinc-900 border border-white/5 hover:bg-zinc-800 active:scale-95 transform-gpu"
                                onClick={() => {
                                    haptic.light();
                                    onNavigate('admin-push');
                                }}
                                onMouseEnter={() => handleMouseEnter('admin-push')}
                                onMouseLeave={handleMouseLeave}
                                onTouchStart={() => handleMouseEnter('admin-push', true)}
                            >
                                <Bell className="w-5 h-5 text-admin-gold" />
                            </Button>
                        </div>
                    </div>
                </header>

                {/* Main Content Area */}
                <main className="flex-1 overflow-hidden w-full bg-[#09090b] gpu-accelerated">
                    <div 
                        className="w-full h-full max-w-7xl mx-auto py-0 overflow-hidden flex flex-col relative"
                        style={{ contain: 'layout paint style' } as React.CSSProperties}
                    >
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

                {/* Floating Bottom Navigation - Mobile Only */}
                <div className="lg:hidden flex-shrink-0 relative z-[60]">
                    <AnimatePresence>
                        {isMainTab && !isKeyboardOpen && (
                            <motion.nav 
                                initial={{ y: 120, x: '-50%', opacity: 0 }}
                                animate={{ y: 0, x: '-50%', opacity: 1 }}
                                exit={{ y: 120, x: '-50%', opacity: 0 }}
                                transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                                className="fixed left-1/2 w-[90%] max-w-lg admin-glass border border-white/10 shadow-[0_20px_40px_rgba(0,0,0,0.8)] rounded-[2rem] p-2 flex items-center justify-between bg-zinc-900/80 backdrop-blur-2xl"
                                style={{ 
                                    viewTransitionName: 'admin-bottom-nav',
                                    bottom: 'calc(0.75rem + var(--safe-area-bottom-fixed, env(safe-area-inset-bottom, 0px)) * 0.5)'
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
                                            onMouseEnter={() => handleMouseEnter(item.view)}
                                            onMouseLeave={handleMouseLeave}
                                            onTouchStart={() => handleMouseEnter(item.view, true)}
                                            className={cn(
                                                "flex flex-col items-center gap-0.5 sm:gap-1 flex-1 py-2.5 rounded-2xl relative transition-all active:scale-95 group z-10 transform-gpu",
                                                isActive ? "text-admin-gold" : "text-zinc-500 hover:text-zinc-300"
                                            )}
                                        >
                                            {isActive && (
                                                <motion.div
                                                    layoutId="admin-active-pill"
                                                    className="absolute inset-0 bg-zinc-800/60 border border-white/10 rounded-2xl -z-10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_8px_16px_rgba(0,0,0,0.4)]"
                                                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                                                />
                                            )}
                                            <Icon className={cn("w-5 h-5 transition-transform group-hover:-translate-y-0.5", isActive && "scale-110")} />
                                            <span className={cn("text-[9px] font-black uppercase tracking-tighter transition-all hidden sm:inline-block", isActive ? "opacity-100" : "opacity-60")}>
                                                {item.label}
                                            </span>
                                            {isActive && (
                                                <span className="w-1.5 h-1.5 rounded-full bg-admin-gold sm:hidden mt-0.5 animate-in zoom-in duration-300" />
                                            )}
                                        </button>
                                    );
                                })}
                            </motion.nav>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
}
