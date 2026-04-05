import { ArrowLeft, Bell } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import type { View } from '@/types';
import { haptic } from '@/utils/haptic';
import { cn } from '@/lib/utils';
import { SearchBar } from './SearchBar';

import { useStore } from '@/contexts/StoreContext';
import { useNotificationCenter } from '@/contexts/NotificationContextCore';

interface HeaderProps {
  onNavigate: (view: View, id?: string) => void;
  showBackButton?: boolean;
  onBack?: () => void;
  onOpenNotifications?: () => void;
  hideSearch?: boolean;
  searchQuery?: string;
  onSearch?: (query: string) => void;
  scrollProgress?: number;
}

export function Header({
  onNavigate,
  showBackButton,
  onBack,
  onOpenNotifications,
  hideSearch = false,
  searchQuery = '',
  onSearch = () => { },
  scrollProgress = 0,
}: Readonly<HeaderProps>) {
  const { config } = useStore();
  const { unreadCount } = useNotificationCenter();
  const isScrolled = scrollProgress > 20;

  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isChecking, setIsChecking] = useState(false);

  const updateTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    const handleUpdateCheck = () => {
      setIsChecking(true);
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
      updateTimerRef.current = setTimeout(() => setIsChecking(false), 2000);
    };

    globalThis.addEventListener('online', handleOnline);
    globalThis.addEventListener('offline', handleOffline);
    globalThis.addEventListener('pwa-update-available', handleUpdateCheck);

    return () => {
      globalThis.removeEventListener('online', handleOnline);
      globalThis.removeEventListener('offline', handleOffline);
      globalThis.removeEventListener('pwa-update-available', handleUpdateCheck);
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
    };
  }, []);


  // -- CUSTOMER HEADER --
  return (
      <header
        className={cn(
          "relative top-0 left-0 right-0 z-[100] transition-[background-color,border-color,box-shadow] duration-200 border-b flex-shrink-0",
          isScrolled
            ? "bg-white border-zinc-100/50 shadow-sm"
            : "bg-white border-transparent"
        )}
        style={{
          paddingTop: 'var(--safe-area-top)',
        }}
      >
        <div className="h-[var(--header-height)] px-4 flex items-center justify-between gap-4 relative">

          {/* LEFT: Logo and optional Back Button */}
          <div className="flex items-center gap-3 flex-shrink-0 z-[70]">
            {showBackButton && (
              <button
                onClick={() => {
                  haptic.light();
                  if (onBack) onBack();
                  else onNavigate('home');
                }}
                className="w-10 h-10 bg-white/50 hover:bg-white rounded-full shadow-sm border border-zinc-100 flex items-center justify-center transition-all active:scale-90"
                aria-label="Voltar"
              >
                <ArrowLeft className="w-5 h-5 text-zinc-900" />
              </button>
            )}

            <button
              className="flex items-center gap-2 cursor-pointer transition-opacity hover:opacity-80 flex-shrink-0 appearance-none border-none bg-transparent p-0 text-left outline-none"
              onClick={() => {
                haptic.light();
                onNavigate('home');
              }}
              aria-label="Ir para o Início"
            >
              {config.logoUrl ? (
                <div className="h-8 max-w-[120px] rounded-[8px] overflow-hidden flex items-center">
                  <img
                    src={config.logoUrl}
                    alt="Store Logo"
                    className="h-full w-full object-contain"
                  />
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-zinc-900 rounded-[8px] flex items-center justify-center shadow-lg relative">
                    <span className="text-white font-black italic">I</span>
                    {/* Extreme Sync Status Dot */}
                    {(() => {
                      let statusColor = "bg-emerald-500";
                      if (!isOnline) statusColor = "bg-red-500";
                      else if (isChecking) statusColor = "bg-amber-400 animate-pulse";

                      return (
                        <div className={cn(
                          "absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-white transition-all duration-500",
                          statusColor,
                          isChecking && "scale-125"
                        )} />
                      );
                    })()}
                  </div>
                  <div className="flex flex-col -gap-1">
                    <span className="text-xl font-black tracking-tighter text-zinc-900 leading-none">IKCOUS</span>
                    <span className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 leading-none mt-0.5">imports</span>
                  </div>
                </div>
              )}
            </button>
          </div>

          {/* MIDDLE: Search Bar (Hidden/Simplified on extra small) */}
          {!hideSearch && (
            <div className="flex-auto flex justify-center px-1 sm:px-4 min-w-0 max-w-lg mx-auto">
              <SearchBar
                value={searchQuery}
                onChange={onSearch}
                onProductClick={(id) => onNavigate('product-detail', id)}
                placeholder="O que busca hoje?"
                className="w-full"
              />
            </div>
          )}

          {/* RIGHT: Actions */}
          <div className="flex items-center gap-2 flex-shrink-0 z-[70]">



            <button
              onClick={() => { haptic.light(); onOpenNotifications?.(); }}
              className="relative w-10 h-10 flex items-center justify-center rounded-full bg-zinc-50 hover:bg-zinc-100 transition-colors active:scale-90"
            >
              <Bell className="w-5 h-5 text-zinc-700" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-amber-500 text-white text-[10px] font-bold h-4 w-4 flex items-center justify-center rounded-full shadow-sm animate-pulse-subtle">
                  {unreadCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>
  );
}
