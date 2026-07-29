import { isViewTransitionSupported } from "@/hooks/useViewTransition";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import { haptic } from "@/utils/haptic";
import { ArrowLeft, Bell, ShoppingCart } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { SearchBar } from "./SearchBar";

import { branding } from "@/config/branding";
import { useNotificationCenter } from "@/contexts/NotificationContextCore";
import { useStore } from "@/contexts/StoreContext";
import { useCartState } from "@/hooks/useCart";

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

export const Header = memo(function Header({
  onNavigate,
  showBackButton,
  onBack,
  onOpenNotifications,
  hideSearch = false,
  searchQuery = "",
  onSearch = () => {},
  scrollProgress = 0,
}: Readonly<HeaderProps>) {
  const { config } = useStore();
  const { cartCount } = useCartState();
  const { unreadCount } = useNotificationCenter();
  const isScrolled = scrollProgress > 20;

  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isChecking, setIsChecking] = useState(false);
  const [logoState, setLogoState] = useState<"db" | "svg" | "png" | "text">(
    config.logoUrl ? "db" : "svg",
  );

  const updateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const logoSrc =
    logoState === "db"
      ? config.logoUrl
      : logoState === "svg"
        ? "/branding/logo.svg"
        : logoState === "png"
          ? "/branding/logo.png"
          : null;

  const appName = branding.appName || "IKCOUS Marketplace";
  const parts = appName.split(/[|-]/);
  const mainName = parts[0]?.trim() || "IKCOUS";
  const subName =
    parts[1]?.trim() || (parts[0]?.includes(" ") ? "" : "imports");
  const storeLetter = mainName.charAt(0).toUpperCase();

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    const handleUpdateCheck = () => {
      setIsChecking(true);
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
      updateTimerRef.current = setTimeout(() => setIsChecking(false), 2000);
    };

    globalThis.addEventListener("online", handleOnline);
    globalThis.addEventListener("offline", handleOffline);
    globalThis.addEventListener("pwa-update-available", handleUpdateCheck);

    return () => {
      globalThis.removeEventListener("online", handleOnline);
      globalThis.removeEventListener("offline", handleOffline);
      globalThis.removeEventListener("pwa-update-available", handleUpdateCheck);
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
          : "bg-white border-transparent",
      )}
      style={
        {
          paddingTop: "var(--safe-area-top)",
          viewTransitionName: isViewTransitionSupported
            ? "app-header"
            : undefined,
        } as React.CSSProperties
      }
    >
      <div className="relative flex md:grid md:grid-cols-[180px,1fr,100px] h-[var(--header-height)] items-center justify-between gap-4 px-4">
        {/* LEFT: Logo and optional Back Button */}
        <div className="z-[70] flex md:w-[180px] flex-shrink-0 items-center gap-3">
          {showBackButton && (
            <button
              onClick={() => {
                haptic.light();
                if (onBack) onBack();
                else onNavigate("home");
              }}
              className="flex size-10 items-center justify-center rounded-full border border-zinc-100 bg-white/50 shadow-sm transition-all hover:bg-white active:scale-90"
              aria-label="Voltar"
            >
              <ArrowLeft className="size-5 text-zinc-900" />
            </button>
          )}

          <button
            className="flex flex-shrink-0 cursor-pointer appearance-none items-center gap-2 border-none bg-transparent p-0 text-left outline-none transition-all duration-150 hover:opacity-80 active:scale-95"
            onClick={() => {
              haptic.light();
              onNavigate("home");
            }}
            aria-label="Ir para o Início"
          >
            {logoSrc ? (
              <div className="flex h-8 max-w-[120px] items-center overflow-hidden rounded-[8px]">
                <img
                  src={logoSrc}
                  alt={branding.appName || "Store Logo"}
                  className="size-full object-contain"
                  onError={() => {
                    if (logoState === "db") {
                      setLogoState("svg");
                    } else if (logoState === "svg") {
                      setLogoState("png");
                    } else if (logoState === "png") {
                      setLogoState("text");
                    }
                  }}
                />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="relative flex size-8 items-center justify-center rounded-[8px] bg-zinc-900 shadow-lg">
                  <span className="font-black italic text-white">
                    {storeLetter}
                  </span>
                  {/* Extreme Sync Status Dot */}
                  {(() => {
                    let statusColor = "bg-emerald-500";
                    if (!isOnline) statusColor = "bg-red-500";
                    else if (isChecking)
                      statusColor = "bg-amber-400 animate-pulse";

                    return (
                      <div
                        className={cn(
                          "absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-white transition-all duration-500",
                          statusColor,
                          isChecking && "scale-125",
                        )}
                      />
                    );
                  })()}
                </div>
                <div className="-gap-1 flex flex-col">
                  <span className="text-xl font-black leading-none tracking-tighter text-zinc-900">
                    {mainName}
                  </span>
                  {subName && (
                    <span className="mt-0.5 text-[9px] font-black uppercase leading-none tracking-[0.2em] text-zinc-600">
                      {subName}
                    </span>
                  )}
                </div>
              </div>
            )}
          </button>
        </div>

        {/* MIDDLE: Search Bar (Hidden/Simplified on extra small) */}
        {!hideSearch && (
          <div className="mx-auto flex min-w-0 max-w-lg flex-auto justify-center px-1 sm:px-4 md:w-full">
            <SearchBar
              value={searchQuery}
              onChange={onSearch}
              onProductClick={(id) => onNavigate("product-detail", id)}
              placeholder="O que busca hoje?"
              className="w-full"
            />
          </div>
        )}

        {/* RIGHT: Actions */}
        <div className="z-[70] flex md:w-[100px] flex-shrink-0 items-center md:justify-end gap-2">
          <button
            id="header-cart"
            onClick={() => {
              haptic.light();
              onNavigate("cart");
            }}
            className="relative hidden size-10 items-center justify-center rounded-full bg-zinc-50 transition-colors hover:bg-zinc-100 active:scale-90 md:flex"
            aria-label="Carrinho"
          >
            <ShoppingCart className="size-5 text-zinc-700" />
            {cartCount > 0 && (
              <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-bold text-white shadow-sm">
                {cartCount}
              </span>
            )}
          </button>

          <button
            onClick={() => {
              haptic.light();
              onOpenNotifications?.();
            }}
            aria-label="Notificações"
            className="relative flex size-10 items-center justify-center rounded-full bg-zinc-50 transition-colors hover:bg-zinc-100 active:scale-90"
          >
            <Bell className="size-5 text-zinc-700" />
            {unreadCount > 0 && (
              <span className="animate-pulse-subtle absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white shadow-sm">
                {unreadCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
});
