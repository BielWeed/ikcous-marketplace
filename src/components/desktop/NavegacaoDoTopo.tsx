import { MenuDaContaDoTopo } from "@/components/desktop/MenuDaContaDoTopo";
import { useNotificationCenter } from "@/contexts/NotificationContextCore";
import { useAuth } from "@/hooks/useAuth";
import { useCartState } from "@/hooks/useCart";
import { useFavorites } from "@/hooks/useFavorites";
import type { View } from "@/types";
import { Bell, Heart, ShoppingCart, Store } from "lucide-react";

interface NavegacaoDoTopoProps {
  currentView?: View;
  onNavigate: (view: View) => void;
  onOpenNotifications?: () => void;
}

const botao =
  "relative flex size-10 shrink-0 items-center justify-center rounded-xl text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-primary aria-[current=page]:bg-zinc-100 aria-[current=page]:text-zinc-950";
const selo =
  "absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-white bg-zinc-950 px-1 text-[10px] font-black text-white";
function rotuloComContagem(nome: string, quantidade: number) {
  return quantidade > 0
    ? `${nome}, ${quantidade} ${quantidade === 1 ? "item" : "itens"}`
    : nome;
}

export function NavegacaoDoTopo({
  currentView,
  onNavigate,
  onOpenNotifications,
}: Readonly<NavegacaoDoTopoProps>) {
  const { cartCount } = useCartState();
  const { favorites } = useFavorites();
  const { isAdmin } = useAuth();
  const { unreadCount } = useNotificationCenter();
  const favoritos = favorites?.length ?? 0;
  return (
    <nav
      aria-label="Navegação principal"
      className="hidden max-w-full items-center gap-1 lg:flex"
    >
      <button
        type="button"
        aria-label={rotuloComContagem("Favoritos", favoritos)}
        aria-current={currentView === "favorites" ? "page" : undefined}
        onClick={() => onNavigate("favorites")}
        className={botao}
      >
        <Heart aria-hidden="true" className="size-5" />
        {favoritos > 0 && (
          <span aria-hidden="true" className={selo}>
            {favoritos > 99 ? "99+" : favoritos}
          </span>
        )}
      </button>
      <MenuDaContaDoTopo currentView={currentView} onNavigate={onNavigate} />
      <button
        type="button"
        aria-label={
          unreadCount > 0
            ? `Notificações, ${unreadCount} não ${unreadCount === 1 ? "lida" : "lidas"}`
            : "Notificações"
        }
        onClick={onOpenNotifications}
        className={botao}
      >
        <Bell aria-hidden="true" className="size-5" />
        {unreadCount > 0 && (
          <span aria-hidden="true" className={selo}>
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      <button
        id="header-cart"
        type="button"
        aria-label={rotuloComContagem("Carrinho", cartCount)}
        aria-current={
          currentView &&
          ["cart", "orders", "order-details", "checkout"].includes(currentView)
            ? "page"
            : undefined
        }
        onClick={() => onNavigate("cart")}
        className={botao}
      >
        <ShoppingCart aria-hidden="true" className="size-5" />
        {cartCount > 0 && (
          <span aria-hidden="true" className={selo}>
            {cartCount > 99 ? "99+" : cartCount}
          </span>
        )}
      </button>
      {isAdmin && (
        <button
          type="button"
          aria-label="Painel da loja"
          title="Painel da loja"
          onClick={() => onNavigate("admin-dashboard")}
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-zinc-950 text-white hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Store aria-hidden="true" className="size-5" />
        </button>
      )}
    </nav>
  );
}
