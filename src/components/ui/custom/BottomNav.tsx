import { useCartState } from "@/hooks/useCart";
import { useFavorites } from "@/hooks/useFavorites";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { isViewTransitionSupported } from "@/hooks/useViewTransition";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import { haptic } from "@/utils/haptic";
import { motion } from "framer-motion";
import { Heart, Home, ShoppingCart, User } from "lucide-react";
import { memo, useMemo } from "react";

interface BottomNavProps {
  currentView: View;
  onNavigate: (view: View) => void;
}

export const BottomNav = memo(function BottomNav({
  currentView,
  onNavigate,
}: Readonly<BottomNavProps>) {
  const { cartCount } = useCartState();
  const { favorites } = useFavorites();
  const favoritesCount = favorites?.length ?? 0;
  const { prefetchView } = usePrefetchOnHover();
  const isAdminView = currentView.startsWith("admin");

  const navItems = useMemo(
    () => [
      { view: "home" as View, icon: Home, label: "Início" },
      {
        view: "favorites" as View,
        icon: Heart,
        label: "Favoritos",
        badge: favoritesCount,
      },
      {
        view: "cart" as View,
        icon: ShoppingCart,
        label: "Carrinho",
        badge: cartCount,
      },
      { view: "profile" as View, icon: User, label: "Perfil" },
    ],
    [favoritesCount, cartCount],
  );

  // Hide BottomNav on admin views
  if (isAdminView) return null;

  return (
    <nav
      aria-label="Navegação principal"
      className="pb-safe fixed inset-x-0 bottom-0 z-[120] flex-shrink-0 border-t border-rose-100/70 bg-white/95 shadow-[0_-4px_25px_rgba(199,65,86,0.08)] backdrop-blur-xl md:bottom-6 md:left-1/2 md:right-auto md:w-full md:max-w-md md:-translate-x-1/2 md:rounded-2xl md:border md:border-rose-200/60 md:shadow-[0_8px_30px_rgba(199,65,86,0.12)]"
      style={
        (isViewTransitionSupported
          ? { viewTransitionName: "bottom-nav" }
          : undefined) as React.CSSProperties
      }
    >
      <div className="flex h-[64px] items-center justify-around px-2">
        {navItems.map((item) => {
          const isActive =
            currentView === item.view ||
            (item.view === "cart" &&
              ["cart", "orders", "order-details", "checkout"].includes(
                currentView,
              )) ||
            (item.view === "profile" &&
              [
                "profile",
                "account-settings",
                "address-form",
                "login",
                "auth",
              ].includes(currentView));
          const Icon = item.icon;

          return (
            <button
              key={item.view}
              id={item.view === "cart" ? "bottom-nav-cart" : undefined}
              type="button"
              onClick={() => {
                haptic.light();
                onNavigate(item.view);
              }}
              onMouseEnter={() => {
                prefetchView(item.view);
              }}
              onTouchStart={() => {
                prefetchView(item.view);
              }}
              className={cn(
                "flex flex-col items-center justify-center py-1 px-3.5 rounded-xl relative group active:scale-95 outline-none focus-visible:ring-2 focus-visible:ring-rose-500/50 transition-[color,background-color,transform] duration-150",
                isActive
                  ? "text-[#C74156] bg-rose-50/70"
                  : "text-slate-400 hover:text-[#C74156]/70 hover:bg-rose-50/30",
              )}
            >
              <div className="relative transition-transform duration-300 group-hover:scale-110">
                <Icon
                  className={`size-5 transition-[stroke-width,opacity] duration-300 md:size-6 ${isActive ? "stroke-[2.5px]" : "stroke-2 opacity-70"}`}
                />
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="pointer-events-none absolute -right-2 -top-2 z-10 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-white bg-gradient-to-r from-[#C74156] to-[#5C061E] px-1 text-[10px] font-black text-white shadow-[0_2px_8px_rgba(199,65,86,0.35)]">
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                )}
              </div>
              <span
                className={`mt-1.5 text-[10px] font-bold tracking-tight transition-[opacity,transform,font-weight] duration-300 sm:text-[11px] ${isActive ? "scale-105 font-black opacity-100" : "opacity-60 grayscale-[0.5]"}`}
              >
                {item.label}
              </span>
              {isActive && (
                <motion.div
                  layoutId="activeBottomNavDot"
                  className="absolute -bottom-1 size-1.5 rounded-full bg-[#C74156] shadow-[0_0_8px_rgba(199,65,86,0.5)]"
                  transition={{ type: "spring", stiffness: 350, damping: 25 }}
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
});
