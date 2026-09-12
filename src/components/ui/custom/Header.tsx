import { isViewTransitionSupported } from "@/hooks/useViewTransition";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import { haptic } from "@/utils/haptic";
import type { HeaderToastData } from "@/utils/headerToast";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  CheckCircle2,
  Info,
  OctagonX,
} from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { SearchBar } from "./SearchBar";

import { buildIdentity } from "@/config/buildIdentity";
import { useNotificationCenter } from "@/contexts/NotificationContextCore";
import { useStore } from "@/contexts/StoreContext";
import { nomeDaLoja } from "@/lib/nome-da-loja";

// Ponto de encaixe do centro da barra, usado quando não há busca (hoje:
// "address-form" e "checkout"). ID ESTÁVEL de propósito — o CheckoutView
// (D1, pedido do Gabriel 12/09/2026) porta ali o gatilho do resumo do
// pedido via `createPortal`, sem o Header saber nada de carrinho, frete ou
// total: ele só hospeda o espaço, o cálculo mora inteiro no CheckoutView.
export const HEADER_CENTER_SLOT_ID = "checkout-header-center-slot";

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
  const { unreadCount } = useNotificationCenter();
  const isScrolled = scrollProgress > 20;

  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isChecking, setIsChecking] = useState(false);
  const [activeToast, setActiveToast] = useState<HeaderToastData | null>(null);
  const logoUrl = config.logoUrl || null;
  const [logoSelection, setLogoSelection] = useState<{
    url: string | null;
    revision: number;
    stage: "db" | "local" | "text";
  }>({ url: logoUrl, revision: 0, stage: logoUrl ? "db" : "local" });

  // Cada troca ganha novas tentativas antes de atualizar o DOM, inclusive A -> B -> A.
  if (logoSelection.url !== logoUrl) {
    setLogoSelection({
      url: logoUrl,
      revision: logoSelection.revision + 1,
      stage: logoUrl ? "db" : "local",
    });
  }
  const logoState = logoSelection.stage;

  const updateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  let logoSrc: string | null = null;
  if (logoState === "db" && config.logoUrl) {
    logoSrc = config.logoUrl;
  } else if (logoState === "local") {
    logoSrc = buildIdentity.localUrls.header;
  }

  // A regra comum prefere o nome configurado pela loja à marca do build.
  const storeName = nomeDaLoja(config);
  const parts = storeName.split(/[|-]/);
  const mainName = parts[0]?.trim() || storeName;
  const subName = parts[1]?.trim() || "";
  const storeLetter = mainName.charAt(0).toUpperCase();

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    const handleUpdateCheck = () => {
      setIsChecking(true);
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
      updateTimerRef.current = setTimeout(() => setIsChecking(false), 2000);
    };

    const handleToastEvent = (e: Event) => {
      const customEvent = e as CustomEvent<HeaderToastData>;
      if (customEvent.detail?.message) {
        haptic.light();
        setActiveToast(customEvent.detail);
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => {
          setActiveToast(null);
        }, customEvent.detail.duration || 2600);
      }
    };

    globalThis.addEventListener("online", handleOnline);
    globalThis.addEventListener("offline", handleOffline);
    globalThis.addEventListener("pwa-update-available", handleUpdateCheck);
    globalThis.addEventListener("header-toast-event", handleToastEvent);

    return () => {
      globalThis.removeEventListener("online", handleOnline);
      globalThis.removeEventListener("offline", handleOffline);
      globalThis.removeEventListener("pwa-update-available", handleUpdateCheck);
      globalThis.removeEventListener("header-toast-event", handleToastEvent);
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Helper to render type icon inside dynamic island toast
  const renderToastIcon = (type: HeaderToastData["type"]) => {
    switch (type) {
      case "error":
        return (
          <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-rose-500/25 text-rose-300 ring-1 ring-rose-400/40">
            <OctagonX className="size-3.5" />
          </div>
        );
      case "warning":
        return (
          <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-500/25 text-amber-300 ring-1 ring-amber-400/40">
            <AlertTriangle className="size-3.5" />
          </div>
        );
      case "info":
        return (
          <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-pink-400/25 text-pink-200 ring-1 ring-pink-300/40">
            <Info className="size-3.5" />
          </div>
        );
      default:
        return (
          <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/25 text-emerald-300 ring-1 ring-emerald-400/40">
            <CheckCircle2 className="size-3.5" />
          </div>
        );
    }
  };

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
      <div className="relative flex h-[var(--header-height)] items-center justify-between gap-2.5 px-3 xs:px-4 md:grid md:grid-cols-[180px,1fr,auto]">
        {/* LEFT: Logo and optional Back Button */}
        <div className="z-[70] flex shrink-0 items-center gap-2 xs:gap-3 md:w-[180px]">
          {showBackButton && (
            <button
              onClick={() => {
                haptic.light();
                if (onBack) onBack();
                else onNavigate("home");
              }}
              className="relative flex size-9 items-center justify-center rounded-full border border-zinc-100 bg-white/50 shadow-sm transition-all after:absolute after:-inset-1 after:content-[''] hover:bg-white active:scale-90 xs:size-10"
              aria-label="Voltar"
            >
              <ArrowLeft className="size-4.5 text-zinc-900 xs:size-5" />
            </button>
          )}

          <button
            // Laudo 05/09, M3: `outline-none` apagava o anel de foco sem
            // repor — anel só para teclado, padrão do BottomNav (onda 1).
            className="relative flex shrink-0 cursor-pointer appearance-none items-center gap-2 border-none bg-transparent p-0 text-left outline-none transition-all duration-150 after:absolute after:-inset-x-1 after:-inset-y-2 after:content-[''] hover:opacity-80 focus-visible:ring-2 focus-visible:ring-zinc-900/50 active:scale-95"
            onClick={() => {
              haptic.light();
              onNavigate("home");
            }}
            aria-label="Ir para o Início"
          >
            {logoSrc ? (
              <div className="flex h-8 max-w-[100px] items-center overflow-hidden rounded-[8px] xs:max-w-[120px]">
                <img
                  key={`${logoSelection.revision}:${logoState}`}
                  src={logoSrc}
                  alt={storeName}
                  className="size-full object-contain"
                  onError={() => {
                    setLogoSelection((current) => {
                      // Falha só avança a candidata/revisão que a originou.
                      if (current !== logoSelection) return current;
                      const stage =
                        current.stage === "db" &&
                        logoSrc !== buildIdentity.localUrls.header
                          ? "local"
                          : "text";
                      return { ...current, stage };
                    });
                  }}
                />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="relative flex size-8 items-center justify-center rounded-[8px] bg-primary shadow-lg">
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
                  <span className="text-lg font-black leading-none tracking-tighter text-zinc-900 xs:text-xl">
                    {mainName}
                  </span>
                  {subName && (
                    <span className="mt-0.5 text-[8px] font-black uppercase leading-none tracking-[0.2em] text-zinc-600 xs:text-[9px]">
                      {subName}
                    </span>
                  )}
                </div>
              </div>
            )}
          </button>
        </div>

        {/* MIDDLE: Search Bar (Smoothly shrinks/compresses in sync when Notification Capsule expands) */}
        {hideSearch ? (
          // Sem busca (address-form, checkout): o centro ficava vazio.
          // Este slot é só um ponto de encaixe — vazio em toda tela que não
          // porta nada nele (Header idêntico ao de hoje ali).
          //
          // Achado 3 do BLOQUEANTE (12/09/2026): sem um orçamento PRÓPRIO,
          // o espaço "disponível" dependia só da largura da logo desta loja
          // (32px) — outra loja com logo de 100px (o próprio `max-w-[100px]`
          // que este Header permite, algumas linhas abaixo) cortava o
          // conteúdo portado no meio, e como a publicação vai para TODAS as
          // lojas isso vira defeito permanente em qualquer loja com logo
          // larga. `max-w-[140px]` é o teto medido para caber o gatilho
          // (texto em 2 linhas, ver CheckoutView.tsx) mesmo com o pior caso
          // (3+ produtos); com a cápsula de aviso do sino ativa
          // (`activeToast`) o espaço recolhe para `max-w-[72px]` — só cabe o
          // conjunto de miniaturas, mesmo mecanismo que a busca já usa
          // algumas linhas abaixo (`activeToast ? "max-w-[...]" : "max-w-lg"`).
          <div
            id={HEADER_CENTER_SLOT_ID}
            className={cn(
              "mx-auto flex min-w-0 flex-1 items-center justify-center overflow-hidden px-1 sm:px-4 md:w-full",
              activeToast ? "max-w-[72px]" : "max-w-[140px]",
            )}
          />
        ) : (
          <motion.div
            layout
            transition={{
              type: "spring",
              stiffness: 350,
              damping: 30,
              mass: 0.8,
            }}
            className={cn(
              "mx-auto flex min-w-0 flex-1 justify-center px-1 sm:px-4 md:w-full overflow-hidden",
              activeToast
                ? "max-w-[110px] xs:max-w-[145px] sm:max-w-[220px]"
                : "max-w-lg",
            )}
          >
            <SearchBar
              value={searchQuery}
              onChange={onSearch}
              onProductClick={(id) => onNavigate("product-detail", id)}
              placeholder="Buscar produtos"
              className="w-full"
            />
          </motion.div>
        )}

        {/* RIGHT: Notification Morphing Container (Bell expands into Vinho Nobre rounded capsule) */}
        <div className="z-[70] flex shrink-0 items-center justify-end gap-1.5 md:min-w-[100px]">
          <AnimatePresence mode="wait">
            {activeToast ? (
              <motion.button
                type="button"
                layout
                key={activeToast.id || "header-dynamic-island-toast"}
                initial={{ opacity: 0, scale: 0.8, width: 36 }}
                animate={{ opacity: 1, scale: 1, width: "auto" }}
                exit={{ opacity: 0, scale: 0.8, width: 36 }}
                transition={{
                  type: "spring",
                  stiffness: 350,
                  damping: 30,
                  mass: 0.8,
                }}
                onClick={() => {
                  haptic.light();
                  setActiveToast(null);
                }}
                // Laudo de acessibilidade 05/09 (onda 3, item B9): era um
                // motion.div com onClick — invisível para quem navega por
                // teclado. Virou <button> de verdade: Tab alcança, Enter
                // fecha nativo; falta só o Esc.
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setActiveToast(null);
                  }
                }}
                className="flex shrink-0 cursor-pointer items-center gap-2 overflow-hidden whitespace-nowrap rounded-full border border-zinc-800 bg-gradient-to-r from-zinc-950 via-zinc-900 to-zinc-950 py-1.5 pl-2 pr-3.5 text-white shadow-[0_8px_25px_rgba(0,0,0,0.4)] backdrop-blur-md transition-all hover:border-zinc-700 active:scale-95"
              >
                <motion.div
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 450, damping: 25 }}
                >
                  {renderToastIcon(activeToast.type)}
                </motion.div>

                <motion.span
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="max-w-[115px] truncate text-[11px] font-bold tracking-tight text-white/95 xs:max-w-[155px] xs:text-xs sm:max-w-[220px]"
                >
                  {activeToast.message}
                </motion.span>

                <motion.span
                  initial={{ opacity: 0, scale: 0.5, rotate: -15 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  transition={{
                    delay: 0.08,
                    type: "spring",
                    stiffness: 400,
                    damping: 20,
                  }}
                  className="shrink-0 select-none text-[10px] text-secondary/90"
                >
                  ✨
                </motion.span>
              </motion.button>
            ) : (
              <motion.div
                layout
                key="header-standard-actions"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{
                  type: "spring",
                  stiffness: 350,
                  damping: 30,
                  mass: 0.8,
                }}
                className="flex items-center gap-2"
              >
                {/*
                  O carrinho do topo saiu em 24/08/2026. Ele era `hidden ...
                  md:flex`, entao em tela larga aparecia AO MESMO TEMPO que o
                  da barra de baixo — dois carrinhos, medidos vivos em 1280px
                  nas posicoes (1176, 6) e (663, 716). A barra de baixo nunca
                  some (em `md` ela so vira flutuante), logo o do topo era o
                  que sobrava. Quem depende disto: `cartAnimation.ts`, que
                  mira `#bottom-nav-cart` sempre.
                */}
                <button
                  onClick={() => {
                    haptic.light();
                    onOpenNotifications?.();
                  }}
                  // Laudo de acessibilidade 03/09, achado 5: o contador de
                  // não lidas da bolinha era mudo para o leitor de tela.
                  aria-label={
                    unreadCount > 0
                      ? `Notificações, ${unreadCount} não ${unreadCount === 1 ? "lida" : "lidas"}`
                      : "Notificações"
                  }
                  className="relative flex size-9 items-center justify-center rounded-full bg-zinc-50 transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-zinc-100 active:scale-90 xs:size-10"
                >
                  <Bell className="size-4.5 text-zinc-700 xs:size-5" />
                  {unreadCount > 0 && (
                    <span className="animate-pulse-subtle absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white shadow-sm">
                      {unreadCount}
                    </span>
                  )}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
});
