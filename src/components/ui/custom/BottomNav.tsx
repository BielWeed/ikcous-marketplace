import { Home, Heart, ShoppingCart, User } from 'lucide-react';
import { useMemo } from 'react';
import { haptic } from '@/utils/haptic';
import { cn } from '@/lib/utils';
import type { View } from '@/types';

interface BottomNavProps {
  currentView: View;
  onNavigate: (view: View) => void;
  cartCount: number;
}

export function BottomNav({ currentView, onNavigate, cartCount }: Readonly<BottomNavProps>) {
  const isAdminView = currentView.startsWith('admin');

  const navItems = useMemo(() => [
    { view: 'home' as View, icon: Home, label: 'Início' },
    { view: 'favorites' as View, icon: Heart, label: 'Favoritos' },
    { view: 'cart' as View, icon: ShoppingCart, label: 'Carrinho', badge: cartCount },
    { view: 'profile' as View, icon: User, label: 'Perfil' },
  ], [cartCount]);

  // Hide BottomNav on admin views
  if (isAdminView) return null;

  return (
    <nav
      role="navigation"
      aria-label="Navegação principal"
      className="fixed bottom-0 left-0 right-0 z-[100] bg-white/95 backdrop-blur-xl border-t border-zinc-100 pb-safe shadow-[0_-4px_24px_rgba(0,0,0,0.04)] md:hidden flex-shrink-0"
    >
      <div className="flex items-center justify-around px-2 h-[64px]">
        {navItems.map((item) => {
          const isActive = currentView === item.view;
          const Icon = item.icon;

          return (
            <button
              key={item.view}
              type="button"
              onClick={() => {
                haptic.light();
                onNavigate(item.view);
              }}
              className={cn(
                "flex flex-col items-center justify-center py-1 px-4 rounded-xl relative group active:scale-95 outline-none focus-visible:ring-2 focus-visible:ring-primary/50 transition-[color,background-color,transform] duration-300",
                isActive ? "text-primary" : "text-slate-400 hover:text-primary/70"
              )}
            >
              <div className="relative transition-transform duration-300 group-hover:scale-110">
                <Icon className={`w-5 h-5 md:w-6 md:h-6 transition-[stroke-width,opacity] duration-300 ${isActive ? 'stroke-[2.5px]' : 'stroke-2 opacity-70'}`} />
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="absolute -top-2 -right-2 min-w-[18px] h-[18px] bg-black text-white text-[10px] font-black rounded-full flex items-center justify-center border-2 border-white shadow-sm px-1 z-10 pointer-events-none">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
              </div>
              <span className={`text-[10px] sm:text-[11px] mt-1.5 font-bold tracking-tight transition-[opacity,transform,font-weight] duration-300 ${isActive ? 'opacity-100 scale-105 font-black' : 'opacity-60 grayscale-[0.5]'}`}>
                {item.label}
              </span>
              {isActive && (
                <div className="absolute -bottom-1 w-1 h-1 bg-primary rounded-full animate-bounce-subtle" />
              )}
            </button>
          );
        })}
      </div>
    </nav >
  );
}
