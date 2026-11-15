import { IlhaDeAtualizacao } from "@/components/pwa/IlhaDeAtualizacao";
import { SearchBar } from "@/components/ui/custom/SearchBar";
import { HEADER_CENTER_SLOT_ID } from "@/constants/header";
import { useNotificationCenter } from "@/contexts/NotificationContextCore";
import { useStore } from "@/contexts/StoreContext";
import { useCartState } from "@/hooks/useCart";
import { useCategories } from "@/hooks/useCategories";
import { categoriaValidaDaHome } from "@/lib/categoria-valida-da-home";
import { imagemRedimensionada, usarImagemOriginal } from "@/lib/imageUrl";
import { nomeDaLoja } from "@/lib/nome-da-loja";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import { haptic } from "@/utils/haptic";
import { ArrowLeft, Bell, ShoppingCart } from "lucide-react";
import { useEffect, useState } from "react";
import type { CabecalhoClienteProps } from "./CabecalhoCliente";
import { CONTAINER_DO_COMPUTADOR } from "./medidas";

const FOCO =
  "outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2";
const LINKS: { view: View; label: string; relacionadas: View[] }[] = [
  { view: "home", label: "Início", relacionadas: [] },
  { view: "favorites", label: "Favoritos", relacionadas: [] },
  { view: "orders", label: "Pedidos", relacionadas: ["order-details"] },
  {
    view: "profile",
    label: "Perfil",
    relacionadas: [
      "about-store",
      "account-settings",
      "address-form",
      "login",
      "auth",
    ],
  },
];

export function CabecalhoDoComputador({
  currentView,
  onNavigate,
  searchQuery,
  onSearch,
  selectedCategory,
  onCategorySelect,
  onCategoryChange,
  onOpenNotifications,
  hideSearch,
  showBackButton,
  onBack,
}: CabecalhoClienteProps) {
  // Mesma condição do Header do celular: sinal do navegador, sem sondar banco.
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  useEffect(() => {
    const online = () => setIsOnline(true);
    const offline = () => setIsOnline(false);
    globalThis.addEventListener("online", online);
    globalThis.addEventListener("offline", offline);
    return () => {
      globalThis.removeEventListener("online", online);
      globalThis.removeEventListener("offline", offline);
    };
  }, []);
  const { config } = useStore();
  const { unreadCount } = useNotificationCenter();
  const { cartCount } = useCartState();
  const { categories, isLoading } = useCategories();
  const ativas = categories.filter((category) => category.isActive);
  const selecionada = categoriaValidaDaHome(
    selectedCategory,
    categories,
    isLoading,
  );
  const nome = nomeDaLoja(config);
  const navegar = (view: View, id?: string) => {
    haptic.light();
    onNavigate(view, id);
  };

  return (
    <header className="hidden lg:sticky lg:top-0 lg:z-[100] lg:block lg:min-h-[121px] lg:shrink-0 lg:border-b lg:border-border lg:bg-white">
      <div
        className={cn(
          CONTAINER_DO_COMPUTADOR,
          "lg:flex lg:h-[72px] lg:items-center lg:gap-4",
        )}
      >
        {showBackButton && (
          <button
            type="button"
            aria-label="Voltar"
            onClick={() => {
              haptic.light();
              if (onBack) onBack();
              else onNavigate("home");
            }}
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-muted",
              FOCO,
            )}
          >
            <ArrowLeft aria-hidden="true" className="size-5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => navegar("home")}
          aria-label="Ir para o Início"
          className={cn(
            "flex min-h-11 max-w-[180px] shrink-0 items-center gap-3 rounded-lg text-left xl:max-w-[220px]",
            FOCO,
          )}
        >
          {config.logoUrl && (
            <img
              src={imagemRedimensionada(config.logoUrl, {
                width: 160,
                quality: 80,
              })}
              onError={(e) =>
                usarImagemOriginal(e.currentTarget, config.logoUrl ?? "")
              }
              alt=""
              className="max-h-10 max-w-20 shrink-0 object-contain"
            />
          )}
          <span className="line-clamp-2 text-sm font-bold leading-tight">
            {nome}
          </span>
        </button>

        {hideSearch ? (
          <div
            id={HEADER_CENTER_SLOT_ID}
            className="flex min-w-0 flex-1 items-center justify-center"
          />
        ) : (
          <div className="min-w-0 flex-1">
            <SearchBar
              value={searchQuery}
              onChange={onSearch}
              onCategorySelect={onCategorySelect}
              onProductClick={(id) => navegar("product-detail", id)}
              placeholder="Buscar produtos"
              className="h-12 max-w-screen-sm rounded-full bg-muted lg:[&>div:first-child]:border-transparent lg:[&>div:first-child]:bg-muted lg:[&>div:first-child]:shadow-none lg:[&>div:nth-child(2)]:h-12 lg:[&_button[aria-label='Limpar_busca']]:size-11"
            />
          </div>
        )}

        <nav
          aria-label="Navegação do computador"
          className="flex shrink-0 items-center gap-1"
        >
          {LINKS.map(({ view, label, relacionadas }) => {
            const ativo =
              currentView === view || relacionadas.includes(currentView);
            return (
              <button
                key={view}
                type="button"
                onClick={() => navegar(view)}
                aria-current={ativo ? "page" : undefined}
                className={cn(
                  "h-11 rounded-full px-3.5 text-sm hover:bg-muted",
                  FOCO,
                  ativo && "bg-muted font-bold",
                )}
              >
                {label}
              </button>
            );
          })}
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <IlhaDeAtualizacao />
          <button
            type="button"
            onClick={() => {
              haptic.light();
              onOpenNotifications();
            }}
            aria-label={
              unreadCount > 0
                ? `Notificações, ${unreadCount} não ${unreadCount === 1 ? "lida" : "lidas"}`
                : "Notificações"
            }
            className={cn(
              "relative flex size-11 items-center justify-center rounded-full hover:bg-muted",
              FOCO,
            )}
          >
            <Bell aria-hidden="true" className="size-5" />
            {unreadCount > 0 && (
              <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-foreground text-[10px] font-bold text-background">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </button>
          <button
            id="header-cart"
            type="button"
            onClick={() => navegar("cart")}
            aria-label={
              cartCount > 0
                ? `Carrinho, ${cartCount} ${cartCount === 1 ? "item" : "itens"}`
                : "Carrinho"
            }
            aria-current={
              currentView === "cart" || currentView === "checkout"
                ? "page"
                : undefined
            }
            className={cn(
              "relative flex size-11 items-center justify-center rounded-full hover:bg-muted",
              FOCO,
            )}
          >
            <ShoppingCart aria-hidden="true" className="size-5" />
            {cartCount > 0 && (
              <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-foreground text-[10px] font-bold text-background">
                {cartCount > 99 ? "99+" : cartCount}
              </span>
            )}
          </button>
        </div>
      </div>
      {ativas.length > 0 && (
        <nav
          aria-label="Categorias da loja"
          className={cn(
            CONTAINER_DO_COMPUTADOR,
            "no-scrollbar flex h-12 items-stretch gap-6 overflow-x-auto",
          )}
        >
          {["Todas", ...ativas.map((category) => category.name)].map(
            (nomeDaCategoria) => (
              <button
                type="button"
                key={nomeDaCategoria}
                aria-current={
                  currentView === "home" && selecionada === nomeDaCategoria
                    ? "true"
                    : undefined
                }
                onClick={() => {
                  haptic.light();
                  onCategoryChange(nomeDaCategoria);
                }}
                className={cn(
                  "min-h-11 shrink-0 border-b-2 px-1 text-sm hover:text-foreground",
                  FOCO,
                  currentView === "home" && selecionada === nomeDaCategoria
                    ? "border-foreground font-bold"
                    : "border-transparent text-muted-foreground",
                )}
              >
                {nomeDaCategoria}
              </button>
            ),
          )}
        </nav>
      )}
      <div
        role="status"
        className="pointer-events-none absolute inset-x-0 top-full"
      >
        {!isOnline && (
          <p className="border-b border-amber-200 bg-amber-50 px-3 py-1 text-center text-xs font-medium text-amber-900">
            Sem internet — mostrando o que já foi carregado
          </p>
        )}
      </div>
    </header>
  );
}
