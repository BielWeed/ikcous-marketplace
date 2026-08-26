import { Button } from "@/components/ui/button";
import { branding } from "@/config/branding";
import { useAnalytics } from "@/hooks/useAnalytics";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { useLeaderElection } from "@/hooks/useLeaderElection";
import { useConnectionDiagnostics } from "@/hooks/useOnlineStatus";
import { useOrders } from "@/hooks/useOrders";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { useProducts } from "@/hooks/useProducts";
import {
  isViewTransitionSupported,
  useViewTransition,
} from "@/hooks/useViewTransition";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import {
  prefetchCouponsData,
  prefetchCustomersData,
  prefetchQAData,
  prefetchReviewsData,
} from "@/utils/admin_cache";
import { haptic } from "@/utils/haptic";
import { paiDaTelaDoAdmin } from "@/utils/pai-da-tela-do-admin";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  ArrowLeft,
  Bell,
  Layers,
  LayoutGrid,
  Megaphone,
  Package,
  Plus,
  Settings,
  ShoppingBag,
  Users,
} from "lucide-react";
import React from "react";

/**
 * Pedidos que ainda exigem ação do lojista — espelha o predicado de
 * `today_pending` na RPC `get_admin_analytics_v2` (o cartão "Ações
 * Pendentes" da tela de Pedidos). Um pedido em "Em Separação" ainda
 * precisa ser embalado e enviado, então conta igual a um pedido novo.
 *
 * Achado 10 da auditoria de 20/08/2026: o crachá desta barra e o cartão
 * contavam coisas diferentes ("pending" contra "pending"+"new"+"processing")
 * e discordavam na tela. Exportada para o mesmo texto ser usado nos dois
 * lados em vez de duas listas soltas voltarem a divergir.
 *
 * `"new"` é um valor histórico da coluna `status` no banco — o enum
 * `OrderStatus` do front nunca o modelou — mantido aqui só para bater com
 * o que a RPC de fato soma.
 */
export const STATUS_PEDIDOS_COM_ACAO_PENDENTE = [
  "pending",
  "new",
  "processing",
] as const;

/**
 * Retentativa automática quando a rodada de contagens FALHA — sem ela, a
 * bolinha vermelha acesa por dúvida (`naoConseguiuConferirAvisos`) não
 * apaga sozinha numa aba do painel aberta em primeiro plano, numa loja sem
 * movimento: nenhum dos gatilhos existentes (troca de foco, tempo real,
 * BroadcastChannel) dispara ali, e não há intervalo nenhum rodando.
 *
 * Só agenda quando a ÚLTIMA rodada falhou — rodada que deu certo não agenda
 * nada, senão troca-se um defeito por consumo de rede e bateria em toda aba
 * aberta. Recuo exponencial (4s, 8s, 16s) e teto de 3 tentativas: depois
 * disso o sino continua aceso, mas para de bater na rede sozinho — o
 * próximo gatilho natural (foco, tempo real, broadcast) resolve.
 */
const RETENTATIVA_BASE_MS = 4000;
const RETENTATIVA_MAX_TENTATIVAS = 3;

interface AdminLayoutProps {
  children: React.ReactNode;
  currentView: View;
  onNavigate: (view: View) => void;
  onBack?: () => void;
}

export function AdminLayout({
  children,
  currentView,
  onNavigate,
  onBack,
}: AdminLayoutProps) {
  const { isSupported: isTransitionSupported } = useViewTransition();
  const { prefetchView } = usePrefetchOnHover();
  const { fetchExecutiveSummary, fetchCategoryAnalytics } = useAnalytics();
  const { loadProducts } = useProducts({ autoFetch: false });
  const { loadOrders } = useOrders(false, true);
  const { isLeader } = useLeaderElection();

  React.useEffect(() => {
    document.documentElement.classList.add("admin-mode");
    return () => {
      document.documentElement.classList.remove("admin-mode");
    };
  }, []);

  const [pendingOrdersCount, setPendingOrdersCount] = React.useState(0);
  const [pendingQuestionsCount, setPendingQuestionsCount] = React.useState(0);
  const [pendingReviewsCount, setPendingReviewsCount] = React.useState(0);
  // Defeito medido em 25/08/2026: quando uma das tres consultas abaixo
  // falhava, a contagem dela ficava parada em 0 e o sino apagava — a mesma
  // tela de "nada pendente". Este estado guarda o terceiro caso, que nao e'
  // nem "tem pendencia" nem "nao tem": e' "nao consegui conferir". Ele zera
  // sozinho a cada nova rodada de `fetchInitialCounts` que der certo.
  const [naoConseguiuConferirAvisos, setNaoConseguiuConferirAvisos] =
    React.useState(false);

  React.useEffect(() => {
    let isMounted = true;
    let ordersChannel: any = null;
    let questionsChannel: any = null;
    // Numero da rodada corrente. Sem ele, a rodada VELHA que termina por
    // ULTIMO vence — inclusive escrevendo o veredito velho (falhou) por
    // cima do veredito novo (deu certo). Mesmo padrao de
    // `useAvisosDoLojista.ts:152-158`, que existe pelo mesmo motivo medido
    // la: duas rodadas em voo ao mesmo tempo, quatro gatilhos que podem
    // disparar `fetchInitialCounts` (visivel, realtime de pedidos, realtime
    // de perguntas/respostas, BroadcastChannel) e agora um quinto (a
    // retentativa abaixo).
    let rodadaAtual = 0;
    // Estado da retentativa automatica (ressalva 1). Vive aqui, e nao em
    // `React.useRef`, pelo mesmo motivo de `isMounted`: reinicia sozinho
    // quando o efeito inteiro reinicia (troca de `isLeader`), que e o
    // comportamento certo — uma nova rodada de assinaturas comeca um novo
    // ciclo de retentativa do zero.
    let tentativaDeRetentativa = 0;
    let timeoutDeRetentativa: ReturnType<typeof setTimeout> | null = null;
    const bc =
      typeof window !== "undefined"
        ? new BroadcastChannel("ikcous_admin_layout_badges")
        : null;
    let bcListener: ((event: MessageEvent) => void) | null = null;

    const fetchInitialCounts = async () => {
      const rodada = ++rodadaAtual;
      // Só esta rodada pode gravar estado: se uma rodada mais nova já
      // começou (ou o componente saiu), o veredito desta aqui chegou
      // atrasado e não vale mais nada.
      const podeGravar = () => isMounted && rodada === rodadaAtual;

      // Desconhecido nunca e' sucesso: se alguma das tres consultas falhar,
      // o sino tem que acender por causa da duvida, mesmo que as contagens
      // que DERAM certo estejam todas zeradas. `falhouAlgumaConsulta` comeca
      // limpo a cada rodada — uma rodada nova que der tudo certo apaga o
      // aviso de falha da rodada anterior.
      let falhouAlgumaConsulta = false;
      try {
        // Fetch pending orders count
        const { count: ordersCount, error: ordersErr } = await supabase
          .from("marketplace_orders")
          .select("*", { count: "exact", head: true })
          .in("status", STATUS_PEDIDOS_COM_ACAO_PENDENTE);

        if (ordersErr) {
          falhouAlgumaConsulta = true;
        } else if (ordersCount !== null && podeGravar()) {
          setPendingOrdersCount(ordersCount);
        }

        // Fetch pending questions count
        const { data: qData, error: qErr } = await (supabase.rpc as any)(
          "get_admin_questions_paged",
          {
            p_search: "",
            p_filter: "pending",
            p_page: 0,
            p_page_size: 1,
          },
        );

        if (qErr) {
          falhouAlgumaConsulta = true;
        } else if (qData && podeGravar()) {
          setPendingQuestionsCount(qData.total_count || 0);
        }

        // Avaliação sem resposta também acende o sino: ela entra na lista da
        // tela de Notificações e é trabalho parado esperando pelo lojista.
        // `.is(null)` é o mesmo critério de `useAvisosDoLojista` — duas
        // contagens diferentes para a mesma pergunta seria pior que nenhuma.
        const { count: reviewsCount, error: reviewsErr } = await supabase
          .from("reviews")
          .select("*", { count: "exact", head: true })
          .is("merchant_reply", null);

        if (reviewsErr) {
          falhouAlgumaConsulta = true;
        } else if (reviewsCount !== null && podeGravar()) {
          setPendingReviewsCount(reviewsCount);
        }
      } catch (err) {
        console.error("[AdminLayout] Error fetching initial counts:", err);
        falhouAlgumaConsulta = true;
      } finally {
        if (podeGravar()) {
          setNaoConseguiuConferirAvisos(falhouAlgumaConsulta);

          if (timeoutDeRetentativa) {
            clearTimeout(timeoutDeRetentativa);
            timeoutDeRetentativa = null;
          }

          if (falhouAlgumaConsulta) {
            if (tentativaDeRetentativa < RETENTATIVA_MAX_TENTATIVAS) {
              const tentativa = tentativaDeRetentativa;
              tentativaDeRetentativa = tentativa + 1;
              const atraso = RETENTATIVA_BASE_MS * 2 ** tentativa;
              timeoutDeRetentativa = setTimeout(() => {
                timeoutDeRetentativa = null;
                if (isMounted) {
                  fetchInitialCounts();
                }
              }, atraso);
            }
          } else {
            tentativaDeRetentativa = 0;
          }
        }
      }
    };

    // LIMITACAO CONHECIDA, de proposito: nao ha canal de tempo real para
    // `reviews`. A contagem de avaliacoes sem resposta so e' lida na busca
    // inicial e nas revalidacoes de `visibilitychange` — uma avaliacao que
    // chegue com o painel aberto so acende a bolinha na proxima vez que a
    // aba voltar ao foco. Assinar mais uma tabela mexe na eleicao de lider e
    // no ciclo de vida dos canais, que e' onde moram os defeitos de
    // concorrencia deste arquivo; o atraso ate o proximo foco custa menos.
    const subscribe = () => {
      if (ordersChannel || questionsChannel) return; // already subscribed

      if (isLeader) {
        console.log("[AdminLayout] Leader tab subscribing to badge updates...");
        ordersChannel = supabase
          .channel("admin-layout-orders-badge")
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "marketplace_orders" },
            () => {
              fetchInitialCounts();
              bc?.postMessage({ type: "badge_update" });
            },
          )
          .subscribe((status: any, err?: any) => {
            if (status === "CHANNEL_ERROR") {
              const errMessage =
                err?.message || (typeof err === "string" ? err : "");
              const isNormalClose =
                errMessage.includes("1000") || errMessage.includes("normal");
              const isAbnormalClose =
                errMessage.includes("1006") || errMessage.includes("abnormal");
              if (isNormalClose) {
                console.log(
                  "[AdminLayout] Orders badge channel closed normally (socket closed: 1000)",
                );
              } else if (isAbnormalClose) {
                console.warn(
                  "[AdminLayout] Orders badge channel abnormally closed (socket closed: 1006). SDK will auto-reconnect.",
                );
              } else {
                console.error(
                  "[AdminLayout] Orders badge channel error:",
                  err?.message || err,
                );
              }
            }
          });

        questionsChannel = supabase
          .channel("admin-layout-questions-badge")
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "questions" },
            () => {
              fetchInitialCounts();
              bc?.postMessage({ type: "badge_update" });
            },
          )
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "answers" },
            () => {
              fetchInitialCounts();
              bc?.postMessage({ type: "badge_update" });
            },
          )
          .subscribe((status: any, err?: any) => {
            if (status === "CHANNEL_ERROR") {
              const errMessage =
                err?.message || (typeof err === "string" ? err : "");
              const isNormalClose =
                errMessage.includes("1000") || errMessage.includes("normal");
              const isAbnormalClose =
                errMessage.includes("1006") || errMessage.includes("abnormal");
              if (isNormalClose) {
                console.log(
                  "[AdminLayout] Questions badge channel closed normally (socket closed: 1000)",
                );
              } else if (isAbnormalClose) {
                console.warn(
                  "[AdminLayout] Questions badge channel abnormally closed (socket closed: 1006). SDK will auto-reconnect.",
                );
              } else {
                console.error(
                  "[AdminLayout] Questions badge channel error:",
                  err?.message || err,
                );
              }
            }
          });
      } else {
        console.log(
          "[AdminLayout] Secondary tab listening to badge updates via BroadcastChannel...",
        );
        if (bc) {
          bcListener = (event: MessageEvent) => {
            if (event.data?.type === "badge_update") {
              console.log(
                "[AdminLayout-Secondary] Badge update received via BroadcastChannel",
              );
              fetchInitialCounts();
            }
          };
          bc.addEventListener("message", bcListener);
        }
      }
    };

    const unsubscribe = () => {
      if (ordersChannel) {
        supabase.removeChannel(ordersChannel);
        ordersChannel = null;
      }
      if (questionsChannel) {
        supabase.removeChannel(questionsChannel);
        questionsChannel = null;
      }
      if (bcListener && bc) {
        bc.removeEventListener("message", bcListener);
        bcListener = null;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchInitialCounts();
        subscribe();
      } else {
        unsubscribe();
      }
    };

    // Initial fetch and subscribe if visible
    if (document.visibilityState === "visible") {
      fetchInitialCounts();
      subscribe();
    }

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      isMounted = false;
      document.removeEventListener("visibilitychange", handleVisibility);
      unsubscribe();
      bc?.close();
      if (timeoutDeRetentativa) {
        clearTimeout(timeoutDeRetentativa);
        timeoutDeRetentativa = null;
      }
    };
  }, [isLeader]);

  const handleHoverTab = React.useCallback(
    (view: string) => {
      if (
        view === currentView ||
        (view === "admin-dashboard" && currentView === "admin") ||
        (view === "admin" && currentView === "admin-dashboard")
      ) {
        return;
      }
      prefetchView(view);
      if (view === "admin-dashboard" || view === "admin") {
        fetchExecutiveSummary(false).catch(() => {});
        fetchCategoryAnalytics(
          "2020-01-01T00:00:00.000Z",
          new Date().toISOString(),
          false,
        ).catch(() => {});
      } else if (view === "admin-products") {
        loadProducts(0, 12, { silent: true }).catch(() => {});
        prefetchView("admin-coupons");
        prefetchView("admin-shipping");
        prefetchCouponsData().catch(() => {});
      } else if (view === "admin-orders") {
        loadOrders(0, 12, "all", "", "", "", true).catch(() => {});
        prefetchView("admin-reviews");
        prefetchView("admin-qa");
        prefetchReviewsData().catch(() => {});
        prefetchQAData().catch(() => {});
      } else if (view === "admin-customers") {
        prefetchCustomersData().catch(() => {});
      } else if (view === "admin-settings") {
        // No longer prefetch coupons, banners, reviews, or QA from settings view
      }
    },
    [
      currentView,
      prefetchView,
      fetchExecutiveSummary,
      fetchCategoryAnalytics,
      loadProducts,
      loadOrders,
    ],
  );

  const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const handleMouseEnter = React.useCallback(
    (view: string, isImmediate = false) => {
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
      }, 250);
    },
    [handleHoverTab],
  );

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
      console.debug(
        `[AdminLayout] currentView changed to: ${currentView}. Dispatching Escape events after timeout...`,
      );
      const dispatchEscape = (target: any, name: string) => {
        if (!target) return;
        const escapeEvent = new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          keyCode: 27,
          which: 27,
          bubbles: true,
          cancelable: true,
        });
        target.dispatchEvent(escapeEvent);
        console.debug(`[AdminLayout] Dispatched Escape to: ${name}`);
      };

      dispatchEscape(document.activeElement, "activeElement");
      dispatchEscape(document, "document");
      dispatchEscape(window, "window");
    }, 50);

    return () => clearTimeout(timer);
  }, [currentView]);

  const navItems = [
    { icon: Activity, label: "Geral", view: "admin-dashboard" },
    { icon: Package, label: "Pedidos", view: "admin-orders" },
    { icon: ShoppingBag, label: "Produtos", view: "admin-products" },
    { icon: Users, label: "Clientes", view: "admin-customers" },
    { icon: Settings, label: "Ajustes", view: "admin-settings" },
  ];

  /**
   * Para onde o sino do cabeçalho leva: sempre a tela de Notificações, onde
   * os avisos ficam listados. Não há escolha de destino aqui de propósito —
   * o sino é a porta da tela, e quem decide o que olhar primeiro é o lojista
   * lendo a lista, não um `if` adivinhando qual alerta ele quis ver.
   */
  const notificationBellTarget: View = "admin-notifications";

  /**
   * A bolinha vermelha acende quando ha algo esperando pelo lojista — OU
   * quando o app nao conseguiu conferir se ha. `naoConseguiuConferirAvisos`
   * entra aqui pelo mesmo motivo da tela de Notificacoes (AdminNotifications
   * View) nunca mostrar "Tudo em dia" com uma fonte caida: falha e "nada
   * pendente" nao podem parecer a mesma tela, senao o lojista nao tem motivo
   * nenhum para abrir o sino e descobrir o pedido que estava esperando.
   *
   * Uma constante so, e nao a condicao repetida em cada porta: sao dois
   * lugares que levam a mesma tela (o sino do celular e a barra lateral do
   * computador), e duas copias da mesma regra e' onde elas divergem depois.
   */
  const temAvisoNoSino =
    naoConseguiuConferirAvisos ||
    pendingOrdersCount > 0 ||
    pendingQuestionsCount > 0 ||
    pendingReviewsCount > 0;

  const { isOffline, latency, quality } = useConnectionDiagnostics();
  const [showSyncFlash, setShowSyncFlash] = React.useState(false);
  const prevOfflineRef = React.useRef(isOffline);

  React.useEffect(() => {
    if (prevOfflineRef.current && !isOffline) {
      setShowSyncFlash(true);
      const timer = setTimeout(() => {
        setShowSyncFlash(false);
      }, 4000);
      return () => clearTimeout(timer);
    }
    prevOfflineRef.current = isOffline;
  }, [isOffline]);

  const [isKeyboardOpen, setIsKeyboardOpen] = React.useState(false);
  const [isStandalone, setIsStandalone] = React.useState(false);
  const [visualBottomOffset, setVisualBottomOffset] = React.useState(0);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery =
      window.location.search.includes("standalone") ||
      window.matchMedia("(display-mode: standalone)");
    const checkStandalone = () => {
      setIsStandalone(
        window.location.search.includes("standalone") ||
          (typeof mediaQuery === "object" && mediaQuery.matches) ||
          (window.navigator as any).standalone === true,
      );
    };
    checkStandalone();
    if (typeof mediaQuery === "object" && mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", checkStandalone);
      return () => mediaQuery.removeEventListener("change", checkStandalone);
    }
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const viewport = window.visualViewport;
    if (!viewport) {
      setVisualBottomOffset(isStandalone ? 0 : 56);
      return;
    }

    const updateOffset = () => {
      const layoutHeight = window.innerHeight;
      const visualBottom = viewport.offsetTop + viewport.height;
      const offset = Math.max(0, layoutHeight - visualBottom);

      // Only apply offsets under 150px to filter out keyboard height
      if (offset > 0 && offset < 150) {
        setVisualBottomOffset(offset);
      } else {
        setVisualBottomOffset(0);
      }
    };

    viewport.addEventListener("resize", updateOffset);
    viewport.addEventListener("scroll", updateOffset);
    window.addEventListener("resize", updateOffset);
    updateOffset();

    return () => {
      viewport.removeEventListener("resize", updateOffset);
      viewport.removeEventListener("scroll", updateOffset);
      window.removeEventListener("resize", updateOffset);
    };
  }, [isStandalone]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const viewport = window.visualViewport;
    if (!viewport) return;

    let rafId: number;
    const handleResize = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const activeEl = document.activeElement;
        const isInputActive =
          activeEl &&
          ((activeEl.tagName === "INPUT" &&
            ![
              "button",
              "submit",
              "checkbox",
              "radio",
              "file",
              "image",
              "range",
              "hidden",
            ].includes(activeEl.getAttribute("type") || "")) ||
            activeEl.tagName === "TEXTAREA" ||
            activeEl.getAttribute("contenteditable") === "true");
        const keyboardActive =
          isInputActive && viewport.height < window.innerHeight * 0.85;
        setIsKeyboardOpen(!!keyboardActive);
      });
    };

    viewport.addEventListener("resize", handleResize);
    return () => {
      cancelAnimationFrame(rafId);
      viewport.removeEventListener("resize", handleResize);
    };
  }, []);

  const isOrderDetailsSubView =
    currentView === "admin-orders" &&
    typeof globalThis !== "undefined" &&
    globalThis.location &&
    new URLSearchParams(globalThis.location.search).has("id");

  // Guarda a view ANTERIOR a `currentView`, para o botão "Voltar" de
  // "admin-push" saber de onde a pessoa veio (sidebar, menu do cliente,
  // banner...) em vez de sempre cair em "admin-settings". O sino NÃO está
  // mais nessa lista: ele leva às Notificações do lojista, não ao envio para
  // clientes. Só
  // atualiza quando a view muda de fato — a origem tem que continuar
  // apontando para a tela anterior enquanto "admin-push" está em foco.
  //
  // `origemDaView` fica em estado, não em ref: `getParentView` é chamado
  // durante a renderização (aqui embaixo, e dentro dos dois `navItems.map`
  // da sidebar), e a regra `react-hooks/refs` do eslint proíbe ler
  // `ref.current` em render — só em efeito ou handler. O `useRef` que o
  // efeito usa para lembrar a view anterior fica isolado dentro do próprio
  // `useEffect`, nunca lido em render.
  const [origemDaView, setOrigemDaView] = React.useState<View | null>(null);
  const viewAnteriorRef = React.useRef<View>(currentView);
  React.useEffect(() => {
    if (viewAnteriorRef.current !== currentView) {
      setOrigemDaView(viewAnteriorRef.current);
      viewAnteriorRef.current = currentView;
    }
  }, [currentView]);

  const getParentView = (view: View): View | "profile" =>
    paiDaTelaDoAdmin(view, origemDaView, !!isOrderDetailsSubView);

  const parentView = getParentView(currentView);
  const isSubView = parentView !== "profile" || isOrderDetailsSubView;

  useDocumentMeta({
    title: `${branding.appName} | Admin Dashboard`,
    names: { description: "Sistema de navegação unificada e operação." },
    properties: { "og:title": `${branding.appName} Admin` },
  });

  return (
    <div
      className="flex size-full flex-col overflow-hidden bg-[#09090b] font-sans text-zinc-50 lg:flex-row"
      style={
        {
          "--admin-tab-pb": isStandalone
            ? "calc(5.5rem + var(--safe-area-bottom-fixed, env(safe-area-inset-bottom, 0px)))"
            : `calc(6.25rem + ${visualBottomOffset}px + var(--safe-area-bottom-fixed, env(safe-area-inset-bottom, 0px)))`,
        } as React.CSSProperties
      }
    >
      {/* Desktop Sidebar */}
      <aside
        className="z-50 hidden w-64 flex-shrink-0 flex-col justify-between border-r border-white/5 bg-[#09090b]/80 p-6 backdrop-blur-xl lg:flex"
        style={
          {
            viewTransitionName: isViewTransitionSupported
              ? "admin-sidebar"
              : undefined,
          } as React.CSSProperties
        }
      >
        <div className="space-y-8">
          <div className="flex select-none flex-col">
            <div className="flex items-center justify-between gap-2">
              <h1 className="text-xl font-black leading-none tracking-tight text-white">
                IKCOUS <span className="text-admin-gold">Admin</span>
              </h1>
              <div
                className={cn(
                  "flex items-center gap-1.5 px-2 py-0.5 rounded-full border bg-zinc-950/80 border-white/5 select-none shrink-0 cursor-help transition-all duration-500",
                  showSyncFlash
                    ? "border-emerald-500/50 bg-emerald-500/10 shadow-[0_0_15px_rgba(16,185,129,0.2)] scale-105"
                    : "border-white/5",
                )}
                title={
                  isOffline
                    ? "Sem conexão com o servidor"
                    : showSyncFlash
                      ? "Sincronização concluída!"
                      : `Latência: ${latency}ms`
                }
              >
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full relative flex transition-colors duration-300",
                    isOffline
                      ? "bg-red-500"
                      : showSyncFlash
                        ? "bg-emerald-500"
                        : quality === "slow"
                          ? "bg-amber-500"
                          : quality === "good"
                            ? "bg-sky-500"
                            : "bg-emerald-500",
                  )}
                >
                  {!isOffline && (
                    <span
                      className={cn(
                        "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
                        showSyncFlash
                          ? "bg-emerald-400"
                          : quality === "slow"
                            ? "bg-amber-400"
                            : quality === "good"
                              ? "bg-sky-400"
                              : "bg-emerald-400",
                      )}
                    />
                  )}
                </span>
                <span
                  className={cn(
                    "text-[7px] font-black uppercase tracking-widest transition-colors",
                    showSyncFlash ? "text-emerald-400" : "text-zinc-400",
                  )}
                >
                  {isOffline
                    ? "Offline"
                    : showSyncFlash
                      ? "Sincronizado"
                      : quality === "slow"
                        ? "Lento"
                        : "Online"}
                </span>
              </div>
            </div>
            <p className="mt-1.5 text-[9px] font-medium uppercase leading-none tracking-widest text-zinc-500">
              Navegação Unificada
            </p>
          </div>

          <nav className="flex flex-col gap-1.5">
            {navItems.map((item, idx) => {
              const Icon = item.icon;
              const parentView = getParentView(currentView);
              const isActive =
                currentView === item.view ||
                (item.view === "admin-dashboard" && currentView === "admin") ||
                parentView === item.view;

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
                    "flex items-center gap-3.5 px-4 py-3.5 rounded-2xl relative transition-[color,transform] duration-200 active:scale-95 group z-10 text-left font-black uppercase text-[10px] tracking-widest transform-gpu w-full",
                    isActive
                      ? "text-admin-gold"
                      : "text-zinc-500 hover:text-zinc-300",
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId="admin-active-pill-desktop"
                      className="absolute inset-0 -z-10 rounded-2xl border border-white/5 bg-zinc-800/40 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_8px_16px_rgba(0,0,0,0.3)]"
                      style={
                        {
                          viewTransitionName: isViewTransitionSupported
                            ? "admin-active-pill-desktop"
                            : undefined,
                        } as React.CSSProperties
                      }
                      transition={{
                        type: "spring",
                        stiffness: 380,
                        damping: 30,
                      }}
                    />
                  )}
                  <Icon
                    className={cn(
                      "w-4.5 h-4.5 transition-transform group-hover:scale-105",
                      isActive && "scale-110",
                    )}
                  />
                  <span className="flex-grow">{item.label}</span>
                  {item.view === "admin-orders" && pendingOrdersCount > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[9px] font-black text-white shadow-[0_0_12px_rgba(239,68,68,0.4)] duration-200 animate-in zoom-in-95">
                      {pendingOrdersCount}
                    </span>
                  )}
                  {item.view === "admin-settings" &&
                    pendingQuestionsCount > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-admin-gold px-1.5 text-[9px] font-black text-black shadow-[0_0_12px_rgba(212,175,55,0.4)] duration-200 animate-in zoom-in-95">
                        {pendingQuestionsCount}
                      </span>
                    )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex flex-col gap-2 space-y-4 border-t border-white/5 pt-4">
          <Button
            variant="ghost"
            onClick={() => {
              haptic.light();
              if (onBack) {
                onBack();
              } else {
                onNavigate(parentView as View);
              }
            }}
            onMouseEnter={() => handleMouseEnter(parentView as any)}
            onMouseLeave={handleMouseLeave}
            className="flex h-11 w-full transform-gpu items-center justify-start gap-3 rounded-2xl border border-white/5 bg-zinc-900/60 px-4 py-3.5 text-[10px] font-bold uppercase tracking-widest text-white transition-[background-color,transform] duration-200 hover:bg-zinc-800 hover:text-white active:scale-95"
          >
            <ArrowLeft className="size-4 text-zinc-400" />{" "}
            <span>{isSubView ? "Voltar" : "Perfil"}</span>
          </Button>
          {/*
            A porta das Notificações no COMPUTADOR. O sino mora no cabeçalho
            `lg:hidden` e esta `<aside>` é `hidden ... lg:flex`: são larguras
            opostas, então uma porta só no sino deixaria a tela inalcançável
            acima de 1024px. Foi exatamente esse o defeito que a revisão de
            contexto limpo pegou — zero portas visíveis no computador.
          */}
          <Button
            variant="ghost"
            aria-label="Notificações"
            onClick={() => {
              haptic.light();
              onNavigate(notificationBellTarget);
            }}
            onMouseEnter={() => handleMouseEnter(notificationBellTarget)}
            onMouseLeave={handleMouseLeave}
            className="relative flex h-11 w-full transform-gpu items-center justify-start gap-3 rounded-2xl border border-white/5 bg-zinc-900/60 px-4 py-3.5 text-[10px] font-bold uppercase tracking-widest text-white transition-[background-color,transform] duration-200 hover:bg-zinc-800 hover:text-white active:scale-95"
          >
            <Bell className="size-4 text-admin-gold" />{" "}
            <span>Notificações</span>
            {temAvisoNoSino && (
              <span className="absolute right-4 size-1.5 animate-pulse rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]" />
            )}
          </Button>
          {/*
            "Avisar clientes" é a tela que ENVIA push para quem compra — o
            oposto da tela de cima, que só RECEBE. O rótulo "Push" dizia o
            mecanismo e não o efeito, e com dois sinos no mesmo bloco os dois
            botões se confundiriam: por isso o megafone.
          */}
          <Button
            variant="ghost"
            aria-label="Avisar clientes"
            onClick={() => {
              haptic.light();
              onNavigate("admin-push");
            }}
            onMouseEnter={() => handleMouseEnter("admin-push")}
            onMouseLeave={handleMouseLeave}
            className="flex h-11 w-full transform-gpu items-center justify-start gap-3 rounded-2xl border border-white/5 bg-zinc-900/60 px-4 py-3.5 text-[10px] font-bold uppercase tracking-widest text-white transition-[background-color,transform] duration-200 hover:bg-zinc-800 hover:text-white active:scale-95"
          >
            <Megaphone className="size-4 text-admin-gold" />{" "}
            <span>Avisar clientes</span>
          </Button>
        </div>
      </aside>

      {/* Main Area Wrapper */}
      <div className="relative flex h-full flex-1 flex-col overflow-hidden">
        {/* Offline Alert Banner */}
        {isOffline && (
          <div className="relative z-[70] flex shrink-0 select-none items-center justify-center gap-2 border-b border-red-500/20 bg-red-500/10 px-6 py-2.5 text-center text-[10px] font-black uppercase tracking-widest text-red-400 duration-300 animate-in fade-in slide-in-from-top">
            <span className="size-1.5 animate-pulse rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
            <span>
              Conexão perdida. Criação, edição e exclusão de dados estão
              temporariamente bloqueadas.
            </span>
          </div>
        )}

        {/* Compact Header - Mobile Only */}
        <header
          className="sticky top-0 z-50 flex-shrink-0 border-b border-white/5 bg-[#09090b]/95 px-3.5 py-0 backdrop-blur-xl shadow-md lg:hidden"
          style={
            {
              viewTransitionName: isViewTransitionSupported
                ? "admin-header"
                : undefined,
            } as React.CSSProperties
          }
        >
          <div className="mx-auto max-w-7xl">
            {/* Row 1: Top Navigation Bar */}
            <div className="flex h-11 items-center justify-between gap-2">
              {/* Left: Profile or Back Button */}
              <div className="flex shrink-0 items-center">
                <Button
                  variant="ghost"
                  onClick={() => {
                    haptic.light();
                    if (onBack) {
                      onBack();
                    } else {
                      onNavigate(parentView as View);
                    }
                  }}
                  onMouseEnter={() => handleMouseEnter(parentView as any)}
                  onMouseLeave={handleMouseLeave}
                  className="flex h-7 transform-gpu items-center gap-1.5 rounded-full border border-white/5 bg-zinc-900 px-2.5 text-[10px] font-bold uppercase tracking-widest text-white transition-[background-color,transform] duration-200 hover:bg-zinc-800 active:scale-95"
                >
                  <ArrowLeft className="size-3.5 text-zinc-400" />{" "}
                  <span className="inline">
                    {isSubView ? "Voltar" : "Perfil"}
                  </span>
                </Button>
              </div>

              {/* Center: Logo / Title */}
              <div className="flex items-center justify-center gap-1.5 text-center">
                <h1 className="text-xs font-black uppercase leading-none tracking-wider text-white">
                  <span className="text-admin-gold">Admin</span>
                </h1>
                <div
                  className={cn(
                    "flex items-center gap-1 px-1.5 py-0.5 rounded-full border bg-zinc-950/80 border-white/5 select-none shrink-0 cursor-help transition-all duration-500",
                    showSyncFlash
                      ? "border-emerald-500/50 bg-emerald-500/10 shadow-[0_0_12px_rgba(16,185,129,0.2)] scale-105"
                      : "border-white/5",
                  )}
                  title={
                    isOffline
                      ? "Offline"
                      : showSyncFlash
                        ? "Sincronizado"
                        : `Latência: ${latency}ms`
                  }
                >
                  <span
                    className={cn(
                      "w-1 h-1 rounded-full relative flex transition-colors duration-300",
                      isOffline
                        ? "bg-red-500"
                        : showSyncFlash
                          ? "bg-emerald-500"
                          : quality === "slow"
                            ? "bg-amber-500"
                            : quality === "good"
                              ? "bg-sky-500"
                              : "bg-emerald-500",
                    )}
                  >
                    {!isOffline && (
                      <span
                        className={cn(
                          "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
                          showSyncFlash
                            ? "bg-emerald-400"
                            : quality === "slow"
                              ? "bg-amber-400"
                              : quality === "good"
                                ? "bg-sky-400"
                                : "bg-emerald-400",
                        )}
                      />
                    )}
                  </span>
                  <span
                    className={cn(
                      "text-[6.5px] font-black uppercase tracking-widest transition-colors",
                      showSyncFlash ? "text-emerald-400" : "text-zinc-400",
                    )}
                  >
                    {isOffline
                      ? "Off"
                      : showSyncFlash
                        ? "Sync"
                        : quality === "slow"
                          ? "Slow"
                          : "On"}
                  </span>
                </div>
              </div>

              {/* Right: Notifications */}
              <div className="flex shrink-0 items-center">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Notificações"
                  className="relative size-7 transform-gpu rounded-full border border-white/5 bg-zinc-900 hover:bg-zinc-800 active:scale-95"
                  onClick={() => {
                    haptic.light();
                    onNavigate(notificationBellTarget);
                  }}
                  onMouseEnter={() => handleMouseEnter(notificationBellTarget)}
                  onMouseLeave={handleMouseLeave}
                >
                  <Bell className="size-3.5 text-admin-gold" />
                  {temAvisoNoSino && (
                    <span className="absolute right-1 top-1 size-1.5 animate-pulse rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]" />
                  )}
                </Button>
              </div>
            </div>

            {/* Row 2: Coupled Sub-Header Bar (Admin Banners) */}
            {currentView === "admin-banners" && (
              <div className="flex h-11 items-center justify-between border-t border-white/5 px-0">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex size-6 items-center justify-center rounded-md border border-[#FFBF00]/25 bg-[#FFBF00]/10 text-[#FFBF00] shadow-[0_0_8px_rgba(255,191,0,0.15)] shrink-0">
                    <LayoutGrid className="size-3" />
                  </div>
                  <h1 className="select-none text-xs font-black uppercase tracking-wider text-white truncate">
                    Gerenciador de Banners
                  </h1>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    haptic.light();
                    window.dispatchEvent(
                      new CustomEvent("admin:open-new-banner-dialog"),
                    );
                  }}
                  className="group flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[#FFBF00]/30 bg-gradient-to-r from-[#FFBF00] via-amber-450 to-amber-500 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-black shadow-[0_2px_10px_rgba(255,191,0,0.2)] transition-all active:scale-95"
                >
                  <Plus className="size-3 stroke-[3px]" />
                  <span>Novo Banner</span>
                </button>
              </div>
            )}

            {/* Row 2: Coupled Sub-Header Bar (Admin Carousels) */}
            {currentView === "admin-carousels" && (
              <div className="flex h-11 items-center justify-between border-t border-white/5 px-0">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex size-6 items-center justify-center rounded-md border border-[#FFBF00]/25 bg-[#FFBF00]/10 text-[#FFBF00] shadow-[0_0_8px_rgba(255,191,0,0.15)] shrink-0">
                    <Layers className="size-3" />
                  </div>
                  <h1 className="select-none text-xs font-black uppercase tracking-wider text-white truncate">
                    Vitrines & Carrosséis
                  </h1>
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Main Content Area */}
        <main
          className="w-full flex-1 overflow-x-hidden bg-[#09090b]"
          style={
            {
              viewTransitionName: isViewTransitionSupported
                ? "admin-content"
                : undefined,
            } as React.CSSProperties
          }
        >
          <div className="relative mx-auto flex size-full max-w-7xl flex-col overflow-x-hidden py-0">
            {(() => {
              // Using isTransitionSupported from parent scope

              if (isTransitionSupported) {
                return (
                  <div key="admin-content-wrapper" className="size-full">
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
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    className="size-full"
                  >
                    {children}
                  </motion.div>
                </AnimatePresence>
              );
            })()}
          </div>
        </main>

        {/* Floating Bottom Navigation - Mobile Only */}
        <AnimatePresence>
          {currentView.startsWith("admin") && !isKeyboardOpen && (
            <motion.nav
              initial={{ y: 120, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 120, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 28 }}
              className="admin-glass fixed left-4 right-4 z-[60] mx-auto flex max-w-lg items-center justify-between rounded-[2rem] border border-white/10 bg-zinc-900/80 p-2 shadow-[0_20px_40px_rgba(0,0,0,0.8)] backdrop-blur-2xl lg:hidden"
              style={
                {
                  bottom: `calc(0.75rem + ${visualBottomOffset}px + var(--safe-area-bottom-fixed, env(safe-area-inset-bottom, 0px)) * 0.5)`,
                  viewTransitionName: isViewTransitionSupported
                    ? "admin-bottom-nav"
                    : undefined,
                } as React.CSSProperties
              }
            >
              {navItems.map((item, idx) => {
                const Icon = item.icon;
                const parentView = getParentView(currentView);
                const isActive =
                  currentView === item.view ||
                  (item.view === "admin-dashboard" &&
                    currentView === "admin") ||
                  parentView === item.view;

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
                      "flex flex-col items-center gap-0.5 sm:gap-1 flex-1 py-2.5 rounded-2xl relative transition-[color,transform] duration-200 active:scale-95 group z-10 transform-gpu",
                      isActive
                        ? "text-admin-gold"
                        : "text-zinc-500 hover:text-zinc-300",
                    )}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="admin-active-pill-mobile"
                        className="absolute inset-0 rounded-2xl border border-white/10 bg-zinc-800/60 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_8px_16px_rgba(0,0,0,0.4)]"
                        style={
                          {
                            zIndex: -1,
                            viewTransitionName: isViewTransitionSupported
                              ? "admin-active-pill-mobile"
                              : undefined,
                          } as React.CSSProperties
                        }
                        transition={{
                          type: "spring",
                          stiffness: 380,
                          damping: 30,
                        }}
                      />
                    )}
                    <Icon
                      className={cn(
                        "w-5 h-5 transition-transform group-hover:-translate-y-0.5",
                        isActive && "scale-110",
                      )}
                    />
                    {item.view === "admin-orders" && pendingOrdersCount > 0 && (
                      <span className="absolute right-2 top-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-red-500 px-1 text-[8px] font-black text-white shadow-[0_0_8px_rgba(239,68,68,0.5)]">
                        {pendingOrdersCount}
                      </span>
                    )}
                    {item.view === "admin-settings" &&
                      pendingQuestionsCount > 0 && (
                        <span className="absolute right-2 top-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-admin-gold px-1 text-[8px] font-black text-black shadow-[0_0_8px_rgba(212,175,55,0.5)]">
                          {pendingQuestionsCount}
                        </span>
                      )}
                    <span
                      className={cn(
                        "text-[9px] font-black uppercase tracking-tighter transition-all hidden sm:inline-block",
                        isActive ? "opacity-100" : "opacity-60",
                      )}
                    >
                      {item.label}
                    </span>
                    {isActive && (
                      <span
                        className="mt-0.5 size-1.5 rounded-full bg-admin-gold duration-300 animate-in zoom-in sm:hidden"
                        style={
                          {
                            viewTransitionName: isViewTransitionSupported
                              ? "admin-active-dot-mobile"
                              : undefined,
                          } as React.CSSProperties
                        }
                      />
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
