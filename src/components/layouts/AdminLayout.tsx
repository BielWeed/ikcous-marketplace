import { EstadoDeOperacaoProvider } from "@/components/admin/PontoDeOperacao";
import { ConexaoDoPainel } from "@/components/layouts/ConexaoDoPainel";
import { IlhaDeAtualizacao } from "@/components/pwa/IlhaDeAtualizacao";
import { Button } from "@/components/ui/button";
import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";
import { useStore } from "@/contexts/StoreContext";
import { useAnalytics } from "@/hooks/useAnalytics";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { useLeaderElection } from "@/hooks/useLeaderElection";
import { useConnectionDiagnostics } from "@/hooks/useOnlineStatus";
import { useOrders } from "@/hooks/useOrders";
import { prefetchPainelInicio } from "@/hooks/usePainelInicio";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { useProducts } from "@/hooks/useProducts";
import {
  isViewTransitionSupported,
  useViewTransition,
} from "@/hooks/useViewTransition";
import { contagemDe, lerListaAdmin } from "@/lib/devolucao";
import { nomeDaLoja } from "@/lib/nome-da-loja";
import {
  FILTRO_POSTGREST_PARA_PREPARAR,
  STATUS_PARA_PREPARAR,
} from "@/lib/pedidos-para-preparar";
import {
  FILTRO_POSTGREST_PAGAMENTO_NA_ENTREGA,
  inicioDaJanelaDoSino,
} from "@/lib/recebimentos-por-marcar";
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
  ArrowLeft,
  Bell,
  Layers,
  LayoutGrid,
  Lock,
  Package,
  Plus,
  ScanBarcode,
  Settings,
  ShoppingBag,
  Store,
  TriangleAlert,
  Users,
  WifiOff,
} from "lucide-react";
import React from "react";

/**
 * Pedidos que ainda exigem ação do lojista — alias de `STATUS_PARA_PREPARAR`
 * (`src/lib/pedidos-para-preparar.ts`), mesmo nome e valor de antes para
 * quem já importava daqui.
 *
 * Achado 10 da auditoria de 20/08/2026: o crachá desta barra e o cartão de
 * Pedidos contavam coisas diferentes e discordavam na tela. Onda F do painel
 * simples (F2): a lista de status sozinha ainda contava o PIX/cartão que
 * espera a CLIENTE pagar; o crachá agora aplica a regra inteira de
 * `painel_inicio` (status + `FILTRO_POSTGREST_PARA_PREPARAR`) — o mesmo
 * número do "Pedidos para preparar" do Início.
 */
export const STATUS_PEDIDOS_COM_ACAO_PENDENTE = STATUS_PARA_PREPARAR;

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

/** Registra o fim anormal de um canal de avisos do painel (só log, sem efeito na tela). */
function aoMudarOStatusDoCanal(nome: string) {
  return (status: any, err?: any) => {
    if (status !== "CHANNEL_ERROR") return;
    const errMessage = err?.message || (typeof err === "string" ? err : "");
    if (errMessage.includes("1000") || errMessage.includes("normal")) {
      console.log(
        `[AdminLayout] ${nome} badge channel closed normally (socket closed: 1000)`,
      );
    } else if (errMessage.includes("1006") || errMessage.includes("abnormal")) {
      console.warn(
        `[AdminLayout] ${nome} badge channel abnormally closed (socket closed: 1006). SDK will auto-reconnect.`,
      );
    } else {
      console.error(
        `[AdminLayout] ${nome} badge channel error:`,
        err?.message || err,
      );
    }
  };
}

export function AdminLayout({
  children,
  currentView,
  onNavigate,
  onBack,
}: AdminLayoutProps) {
  const { config } = useStore();
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
  const [devolucoesSolicitadasCount, setDevolucoesSolicitadasCount] =
    React.useState(0);
  // Pedidos de privacidade (exclusão de conta, correção de e-mail) que a loja
  // ainda não respondeu: têm prazo legal de 15 dias, então também acendem o sino.
  const [privacidadeAbertosCount, setPrivacidadeAbertosCount] =
    React.useState(0);
  const [recebimentosPorMarcarCount, setRecebimentosPorMarcarCount] =
    React.useState(0);
  // Defeito medido em 25/08/2026: quando uma das consultas abaixo
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
    // C4 (laudo novos-ângulos 01/09): uma rajada de eventos de pedido
    // (import, reconciliação, vários pagamentos) chamava fetchInitialCounts
    // — consultas de contagem — UMA VEZ POR EVENTO. A coalescência agenda a
    // primeira conferência e absorve as demais da janela: rajada inteira
    // custa UMA conferência. Montagem e retorno de foco continuam
    // imediatos (quem acabou de abrir/voltar precisa do número agora).
    const ATRASO_COALESCENCIA_BADGES_MS = 1000;
    let timerDeConferencia: ReturnType<typeof setTimeout> | null = null;
    const pedirConferenciaDeAvisos = () => {
      if (timerDeConferencia) return;
      timerDeConferencia = setTimeout(() => {
        timerDeConferencia = null;
        if (isMounted) {
          fetchInitialCounts();
        }
      }, ATRASO_COALESCENCIA_BADGES_MS);
    };
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

      // Desconhecido nunca e' sucesso: se alguma das consultas falhar,
      // o sino tem que acender por causa da duvida, mesmo que as contagens
      // que DERAM certo estejam todas zeradas. `falhouAlgumaConsulta` comeca
      // limpo a cada rodada — uma rodada nova que der tudo certo apaga o
      // aviso de falha da rodada anterior.
      let falhouAlgumaConsulta = false;
      try {
        // Pedidos para preparar — a regra de `painel_inicio`: status aberto
        // e pagamento que não espera a cliente (onda F, F2).
        const { count: ordersCount, error: ordersErr } = await supabase
          .from("marketplace_orders")
          .select("*", { count: "exact", head: true })
          .in("status", STATUS_PEDIDOS_COM_ACAO_PENDENTE)
          .or(FILTRO_POSTGREST_PARA_PREPARAR);

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

        // Mesmo critério da lista em useAvisosDoLojista: só solicitada
        // aguarda a resposta da loja. A contagem vem inteira, sem depender
        // da página retornada. Resposta inválida também é falha da fonte.
        const { data: devolucoesData, error: devolucoesErr } =
          await supabase.rpc("admin_devolucoes_listar", {
            p_status: "solicitada",
            p_limite: 1,
          });
        const devolucoes = lerListaAdmin(devolucoesData);
        if (devolucoesErr || !devolucoes) {
          falhouAlgumaConsulta = true;
        } else if (podeGravar()) {
          setDevolucoesSolicitadasCount(
            contagemDe(devolucoes.contagem, "solicitada"),
          );
        }

        // Mesmo critério da lista em useAvisosDoLojista: só `aberto` espera a
        // loja. Resposta sem número (nem erro) é falha da fonte, nunca "zero":
        // o prazo legal corre e a dúvida acende o sino como nas outras fontes.
        const { count: privacidadeCount, error: privacidadeErr } =
          await supabase
            .from("pedidos_de_privacidade")
            .select("id", { count: "exact", head: true })
            .eq("situacao", "aberto");
        if (privacidadeErr || typeof privacidadeCount !== "number") {
          falhouAlgumaConsulta = true;
        } else if (podeGravar()) {
          setPrivacidadeAbertosCount(privacidadeCount);
        }

        // Pedido entregue, pago na entrega, sem recebimento marcado (14/10):
        // a cliente nao consegue pedir devolucao ate a lojista marcar, entao
        // acende o sino. A MESMA regra da lista (`useAvisosDoLojista`), lida
        // de `@/lib/recebimentos-por-marcar` — duas contagens diferentes para
        // a mesma pergunta seria pior que nenhuma.
        const { count: recebimentosCount, error: recebimentosErr } =
          await supabase
            .from("marketplace_orders")
            .select("*", { count: "exact", head: true })
            .eq("status", "delivered")
            .or(FILTRO_POSTGREST_PAGAMENTO_NA_ENTREGA)
            .is("payment_status", null)
            .gte("updated_at", await inicioDaJanelaDoSino());

        if (recebimentosErr) {
          falhouAlgumaConsulta = true;
        } else if (recebimentosCount !== null && podeGravar()) {
          setRecebimentosPorMarcarCount(recebimentosCount);
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
    // `reviews`, `devolucoes` nem `pedidos_de_privacidade` (os pedidos de
    // privacidade dos clientes). Essas contagens são lidas na busca
    // inicial e nas revalidacoes de `visibilitychange` — uma pendência que
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
              pedirConferenciaDeAvisos();
              bc?.postMessage({ type: "badge_update" });
            },
          )
          .subscribe(aoMudarOStatusDoCanal("Orders"));

        questionsChannel = supabase
          .channel("admin-layout-questions-badge")
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "questions" },
            () => {
              pedirConferenciaDeAvisos();
              bc?.postMessage({ type: "badge_update" });
            },
          )
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "answers" },
            () => {
              pedirConferenciaDeAvisos();
              bc?.postMessage({ type: "badge_update" });
            },
          )
          .subscribe(aoMudarOStatusDoCanal("Questions"));
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
              pedirConferenciaDeAvisos();
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
    // A lojista salvou outro prazo de devolução: o corte do sino muda.
    window.addEventListener("admin:recontar-avisos", pedirConferenciaDeAvisos);

    return () => {
      isMounted = false;
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener(
        "admin:recontar-avisos",
        pedirConferenciaDeAvisos,
      );
      unsubscribe();
      bc?.close();
      if (timeoutDeRetentativa) {
        clearTimeout(timeoutDeRetentativa);
        timeoutDeRetentativa = null;
      }
      if (timerDeConferencia) {
        clearTimeout(timerDeConferencia);
        timerDeConferencia = null;
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
        // O Início lê `painel_inicio` (+ assinatura); o dashboard de
        // métricas que ele era foi para a Visão geral do CRM (26/09/2026).
        prefetchPainelInicio();
      } else if (view === "admin-crm") {
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
    {
      icon: Store,
      label: "Início",
      view: "admin-dashboard",
      cor: "text-[#91ABFF] bg-[#91ABFF]/10 border-[#91ABFF]/20",
    },
    {
      icon: Package,
      label: "Pedidos",
      view: "admin-orders",
      cor: "text-[#C4A7FF] bg-[#C4A7FF]/10 border-[#C4A7FF]/20",
    },
    {
      icon: ShoppingBag,
      label: "Produtos",
      view: "admin-products",
      cor: "text-[#FFA1C6] bg-[#FFA1C6]/10 border-[#FFA1C6]/20",
    },
    {
      icon: Users,
      label: "Clientes",
      view: "admin-customers",
      cor: "text-[#6DE0CF] bg-[#6DE0CF]/10 border-[#6DE0CF]/20",
    },
    {
      icon: Settings,
      label: "Ajustes",
      view: "admin-settings",
      cor: "text-[#75DBFF] bg-[#75DBFF]/10 border-[#75DBFF]/20",
    },
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
    pendingReviewsCount > 0 ||
    devolucoesSolicitadasCount > 0 ||
    privacidadeAbertosCount > 0 ||
    recebimentosPorMarcarCount > 0;

  const { isOffline, latency, quality } = useConnectionDiagnostics();
  const [showSyncFlash, setShowSyncFlash] = React.useState(false);
  const prevOfflineRef = React.useRef(isOffline);
  // Lida DENTRO do efeito, sem entrar nas deps: sair de "sem internet" para
  // "lenta" não sincronizou nada — o flash "Sincronizado" só vale para a volta
  // a uma conexão que responde.
  const qualityRef = React.useRef(quality);
  qualityRef.current = quality;

  React.useEffect(() => {
    if (prevOfflineRef.current && !isOffline && qualityRef.current !== "slow") {
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
    title: `${nomeDaLoja(config)} | Admin Dashboard`,
    names: { description: "Sistema de navegação unificada e operação." },
    properties: { "og:title": `${nomeDaLoja(config)} Admin` },
  });

  // Missão 06 (C3): a medição de conexão fica AQUI (uma instância só) e é
  // compartilhada com as telas via provider — o PontoDeOperacao delas consome
  // este estado em vez de abrir fetch de latência próprio.
  const estadoDeOperacao = React.useMemo(
    () => ({ isOffline, quality, latency, showSyncFlash }),
    [isOffline, quality, latency, showSyncFlash],
  );

  return (
    <div
      className="flex size-full flex-col overflow-hidden bg-[#09090b] font-sans text-zinc-50 lg:flex-row"
      style={
        {
          // iPhone instalado: o app desenha por baixo da barra de status/notch
          // (`black-translucent`); sem esta folga o cabeçalho do painel ficava
          // por baixo dela. Vale 0 fora disso.
          paddingTop: "var(--safe-area-top)",
          "--admin-tab-pb": isStandalone
            ? "calc(6.25rem + var(--safe-area-bottom-fixed, env(safe-area-inset-bottom, 0px)))"
            : `calc(6.25rem + ${visualBottomOffset}px + var(--safe-area-bottom-fixed, env(safe-area-inset-bottom, 0px)))`,
        } as React.CSSProperties
      }
    >
      {/* No computador, os mesmos destinos e estados ficam na lateral. */}
      <aside
        className="z-50 hidden w-64 shrink-0 flex-col justify-between gap-6 overflow-y-auto border-r border-white/5 bg-[#101013] p-5 lg:flex"
        style={
          {
            viewTransitionName: isViewTransitionSupported
              ? "admin-sidebar"
              : undefined,
          } as React.CSSProperties
        }
      >
        <div className="space-y-7">
          <div className="space-y-5">
            <h1 className="min-w-0 break-words text-xl font-semibold leading-tight text-zinc-50">
              {nomeDaLoja(config)}{" "}
              <span className="mt-1 block text-xs font-normal text-[#A1A1AD]">
                Admin
              </span>
            </h1>
            <ConexaoDoPainel estado={estadoDeOperacao} />
          </div>
          <nav
            aria-label="Navegação do painel"
            className="flex flex-col gap-1.5"
          >
            <button
              type="button"
              aria-label="Vender"
              aria-current={currentView === "admin-pdv" ? "page" : undefined}
              onClick={() => {
                haptic.light();
                onNavigate("admin-pdv" as View);
              }}
              onMouseEnter={() => handleMouseEnter("admin-pdv")}
              onMouseLeave={handleMouseLeave}
              onTouchStart={() => handleMouseEnter("admin-pdv", true)}
              className={cn(
                "mb-3 flex min-h-14 w-full items-center gap-3 rounded-2xl border border-white/10 px-3 text-left text-sm font-semibold transition-transform active:scale-95",
                currentView === "admin-pdv"
                  ? "bg-[#3B3016] text-admin-gold"
                  : "bg-[#17171C] text-zinc-50",
              )}
            >
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-xl border",
                  currentView === "admin-pdv"
                    ? "border-transparent"
                    : "border-emerald-400/20 bg-emerald-400/10 text-emerald-400",
                )}
              >
                <ScanBarcode aria-hidden="true" className="size-5" />
              </span>
              Vender
            </button>
            {navItems.map((item) => {
              const Icon = item.icon;
              const parentView = getParentView(currentView);
              const isActive =
                currentView === item.view ||
                (item.view === "admin-dashboard" && currentView === "admin") ||
                (parentView === item.view && currentView !== "admin-pdv");
              return (
                <button
                  key={item.view}
                  type="button"
                  aria-current={isActive ? "page" : undefined}
                  aria-label={
                    item.view === "admin-orders" && pendingOrdersCount > 0
                      ? `${item.label}, ${pendingOrdersCount} para preparar`
                      : item.label
                  }
                  onClick={() => {
                    haptic.light();
                    onNavigate(item.view as View);
                  }}
                  onMouseEnter={() => handleMouseEnter(item.view)}
                  onMouseLeave={handleMouseLeave}
                  onTouchStart={() => handleMouseEnter(item.view, true)}
                  className={cn(
                    "relative flex min-h-11 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-sm transition-[color,transform] active:scale-95",
                    isActive
                      ? "bg-[#3B3016] font-semibold text-admin-gold"
                      : "text-[#A1A1AD] hover:text-white",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-xl border",
                      isActive ? "border-transparent" : item.cor,
                    )}
                  >
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                  <span className="flex-1">{item.label}</span>
                  {item.view === "admin-orders" && pendingOrdersCount > 0 && (
                    <span
                      aria-hidden="true"
                      className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#B82243] px-1.5 text-[11px] font-bold text-white"
                    >
                      {pendingOrdersCount > 99 ? "99+" : pendingOrdersCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
        <div className="flex flex-col gap-2 pt-5">
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
            className="min-h-11 w-full justify-start gap-3 rounded-2xl border border-white/10 bg-[#17171C] px-3 text-xs text-zinc-50"
          >
            <ArrowLeft aria-hidden="true" className="size-5 text-violet-300" />
            {isSubView ? "Voltar" : "Perfil"}
          </Button>
          <Button
            variant="ghost"
            aria-label="Notificações"
            title={
              naoConseguiuConferirAvisos
                ? "Falha ao conferir avisos"
                : undefined
            }
            onClick={() => {
              haptic.light();
              onNavigate(notificationBellTarget);
            }}
            onMouseEnter={() => handleMouseEnter(notificationBellTarget)}
            onMouseLeave={handleMouseLeave}
            className="relative min-h-11 w-full justify-start gap-3 rounded-2xl border border-white/10 bg-[#17171C] px-3 text-xs text-zinc-50"
          >
            <Bell
              aria-hidden="true"
              className={cn(
                "size-5",
                naoConseguiuConferirAvisos
                  ? "text-[#FFA1B0]"
                  : "text-[#75DBFF]",
              )}
            />
            <span>Notificações</span>
            {temAvisoNoSino && (
              <span
                aria-hidden="true"
                className="ml-auto size-2 animate-pulse rounded-full bg-red-500"
              />
            )}
          </Button>
        </div>
      </aside>

      {/* Main Area Wrapper */}
      <div className="relative flex h-full flex-1 flex-col overflow-hidden">
        {/* Navegação compacta no celular; ilha também no desktop.
            Fundo SÓLIDO e sem blur: é `sticky` e
            a lista rola por baixo dele (mesmo caso da barra inferior); com
            95% + blur o texto de baixo ainda se lia atrás dos títulos. */}
        <header
          className="sticky top-0 z-50 flex-shrink-0 border-b border-white/5 bg-[#101013] px-5 py-0 shadow-md lg:border-0 lg:shadow-none"
          style={
            {
              viewTransitionName: isViewTransitionSupported
                ? "admin-header"
                : undefined,
            } as React.CSSProperties
          }
        >
          <div className="mx-auto max-w-7xl lg:hidden">
            <div className="flex min-h-14 items-center gap-3 py-1">
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
                className="min-h-11 min-w-11 shrink-0 gap-1.5 rounded-full border border-white/10 bg-[#17171C] px-2 text-xs font-semibold text-zinc-50 hover:bg-[#26262E]"
              >
                <span className="flex size-6 items-center justify-center rounded-full border border-violet-300/20 bg-violet-300/10">
                  <ArrowLeft
                    aria-hidden="true"
                    className="size-3.5 text-violet-300"
                  />
                </span>
                {isSubView ? "Voltar" : "Perfil"}
              </Button>
              <ConexaoDoPainel
                key={currentView}
                estado={estadoDeOperacao}
                nome={nomeDaLoja(config)}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Notificações"
                title={
                  naoConseguiuConferirAvisos
                    ? "Falha ao conferir avisos"
                    : temAvisoNoSino
                      ? "Há avisos para conferir"
                      : "Notificações"
                }
                className={cn(
                  "relative min-h-11 min-w-11 shrink-0 rounded-full border p-0 active:scale-95",
                  naoConseguiuConferirAvisos
                    ? "border-rose-300/25 bg-[#401A24] text-[#FFA1B0]"
                    : "border-sky-300/20 bg-[#192A31] text-[#75DBFF]",
                )}
                onClick={() => {
                  haptic.light();
                  onNavigate(notificationBellTarget);
                }}
                onMouseEnter={() => handleMouseEnter(notificationBellTarget)}
                onMouseLeave={handleMouseLeave}
              >
                <Bell aria-hidden="true" className="size-5" />
                {temAvisoNoSino && (
                  <span
                    aria-hidden="true"
                    className={
                      naoConseguiuConferirAvisos
                        ? "absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#B82243] px-1 text-[11px] font-bold text-white"
                        : "absolute right-0 top-0 size-2 animate-pulse rounded-full bg-red-500 ring-2 ring-[#101013]"
                    }
                  >
                    {naoConseguiuConferirAvisos ? "!" : null}
                  </span>
                )}
              </Button>
            </div>

            {/* Row 2: Coupled Sub-Header Bar (Admin Banners) */}
            {currentView === "admin-banners" && (
              <div className="border-t border-white/5 py-2">
                <div className="flex min-h-14 items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-pink-300/20 bg-pink-300/10 text-pink-300">
                      <LayoutGrid className="size-3" />
                    </div>
                    <h1 className="min-w-0 break-words text-sm font-semibold text-zinc-50">
                      {NOMES_DO_PAINEL["admin-banners"]}
                    </h1>
                  </div>

                  <button
                    type="button"
                    disabled={isOffline}
                    aria-describedby={
                      isOffline ? "motivo-banner-offline" : undefined
                    }
                    onClick={() => {
                      haptic.light();
                      window.dispatchEvent(
                        new CustomEvent("admin:open-new-banner-dialog"),
                      );
                    }}
                    className={cn(
                      "flex min-h-14 items-center justify-center gap-1.5 rounded-2xl px-4 text-xs font-bold transition-transform active:scale-95",
                      isOffline
                        ? "border border-white/15 bg-[#1E1E24] text-[#A1A1AD]"
                        : "bg-gradient-to-b from-[#F8D25A] to-[#E2A81E] text-[#1B1300] shadow-lg",
                    )}
                  >
                    {isOffline ? (
                      <Lock aria-hidden="true" className="size-4 shrink-0" />
                    ) : (
                      <Plus aria-hidden="true" className="size-4 shrink-0" />
                    )}
                    <span>
                      {isOffline ? "Novo Banner indisponível" : "Novo Banner"}
                    </span>
                  </button>
                </div>
                {isOffline && (
                  <p
                    id="motivo-banner-offline"
                    className="mt-2 text-xs text-[#A1A1AD]"
                  >
                    Disponível quando a conexão retornar.
                  </p>
                )}
              </div>
            )}

            {/* Row 2: Coupled Sub-Header Bar (Admin Carousels) */}
            {currentView === "admin-carousels" && (
              <div className="flex min-h-11 items-center gap-2 border-t border-white/5 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-violet-300/20 bg-violet-300/10 text-violet-300">
                    <Layers className="size-3" />
                  </div>
                  <h1 className="min-w-0 break-words text-sm font-semibold text-zinc-50">
                    {NOMES_DO_PAINEL["admin-carousels"]}
                  </h1>
                </div>
              </div>
            )}
          </div>
          {/* Sobreposta abaixo dos controles: não desloca a venda em curso.
              O z local fica abaixo das folhas; só a pílula recebe ponteiro. */}
          <div className="pointer-events-none absolute inset-x-0 top-full z-[100] flex min-w-0 justify-center">
            <IlhaDeAtualizacao
              variante="painel"
              className="pointer-events-auto mt-1"
            />
          </div>
        </header>

        {isOffline && (
          <div
            role="alert"
            className="z-40 mx-5 my-2 flex shrink-0 items-start gap-3 rounded-2xl border border-rose-300/20 bg-[#2B151D] p-3 text-xs leading-relaxed text-[#F5C1CC]"
          >
            <WifiOff
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-[#FFA1B0]"
            />
            <p>
              <strong className="block">Conexão perdida.</strong> Criação,
              edição e exclusão de dados estão temporariamente bloqueadas.
            </p>
          </div>
        )}
        {naoConseguiuConferirAvisos && currentView !== "admin-pdv" && (
          // Na venda em curso a faixa não empurra a tela (mesma regra da ilha de atualização).
          <div
            role="status"
            className="mx-5 my-2 flex shrink-0 flex-wrap items-center gap-3 rounded-2xl border border-rose-300/20 bg-[#2B151D] p-3 text-xs text-[#F5C1CC]"
          >
            <TriangleAlert
              aria-hidden="true"
              className="size-5 shrink-0 text-[#FFA1B0]"
            />
            <div className="min-w-0 flex-1 basis-32">
              <p className="font-semibold">Falha ao conferir avisos</p>
              <p className="mt-1">Contagem atual não confirmada.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                haptic.light();
                onNavigate(notificationBellTarget);
              }}
              className="min-h-11 rounded-xl border border-white/15 bg-[#1E1E24] px-4 font-semibold text-zinc-50"
            >
              Ver avisos
            </button>
          </div>
        )}

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
          <EstadoDeOperacaoProvider value={estadoDeOperacao}>
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
                      transition={{
                        type: "spring",
                        stiffness: 380,
                        damping: 30,
                      }}
                      className="size-full"
                    >
                      {children}
                    </motion.div>
                  </AnimatePresence>
                );
              })()}
            </div>
          </EstadoDeOperacaoProvider>
        </main>

        {/* Floating Bottom Navigation - Mobile Only */}
        <AnimatePresence>
          {currentView.startsWith("admin") && !isKeyboardOpen && (
            <motion.nav
              initial={{ y: 120, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 120, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 28 }}
              aria-label="Navegação inferior do painel"
              className="fixed inset-x-5 z-[60] mx-auto flex h-16 max-w-lg items-center rounded-[2rem] border border-white/15 bg-[#141418] p-1.5 shadow-[0_12px_28px_rgba(0,0,0,0.6)] lg:hidden"
              style={
                {
                  bottom: `calc(0.75rem + ${visualBottomOffset}px + var(--safe-area-bottom-fixed, env(safe-area-inset-bottom, 0px)) * 0.5)`,
                  viewTransitionName: isViewTransitionSupported
                    ? "admin-bottom-nav"
                    : undefined,
                } as React.CSSProperties
              }
            >
              {navItems.map((item) => {
                const Icon = item.icon;
                const parentView = getParentView(currentView);
                // O pai da venda continua valendo para Voltar, sem marcar Início.
                const isActive =
                  currentView === item.view ||
                  (item.view === "admin-dashboard" &&
                    currentView === "admin") ||
                  (parentView === item.view && currentView !== "admin-pdv");
                return (
                  <button
                    key={item.view}
                    type="button"
                    aria-current={isActive ? "page" : undefined}
                    aria-label={
                      item.view === "admin-orders" && pendingOrdersCount > 0
                        ? `${item.label}, ${pendingOrdersCount} para preparar`
                        : item.label
                    }
                    onClick={() => {
                      haptic.light();
                      onNavigate(item.view as View);
                    }}
                    onMouseEnter={() => handleMouseEnter(item.view)}
                    onMouseLeave={handleMouseLeave}
                    onTouchStart={() => handleMouseEnter(item.view, true)}
                    className={cn(
                      "relative flex h-[52px] min-w-11 flex-1 flex-col items-center justify-center gap-1 rounded-[22px] transition-[color,transform] active:scale-95",
                      isActive
                        ? "bg-[#3B3016] text-admin-gold"
                        : "text-[#A1A1AD] hover:text-white",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-6 items-center justify-center rounded-lg border",
                        isActive ? "border-transparent" : item.cor,
                      )}
                    >
                      <Icon aria-hidden="true" className="size-[18px]" />
                    </span>
                    <span className="text-center text-[11px] font-medium leading-3">
                      {item.label}
                    </span>
                    {item.view === "admin-orders" && pendingOrdersCount > 0 && (
                      <span
                        aria-hidden="true"
                        className="absolute -top-2 right-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#B82243] px-1 text-[11px] font-bold text-white ring-2 ring-[#141418]"
                      >
                        {pendingOrdersCount > 99 ? "99+" : pendingOrdersCount}
                      </span>
                    )}
                  </button>
                );
              })}
              {/* Ação separada das cinco abas; rótulo sempre visível. */}
              <button
                type="button"
                aria-current={currentView === "admin-pdv" ? "page" : undefined}
                onClick={() => {
                  haptic.light();
                  onNavigate("admin-pdv" as View);
                }}
                onMouseEnter={() => handleMouseEnter("admin-pdv")}
                onMouseLeave={handleMouseLeave}
                onTouchStart={() => handleMouseEnter("admin-pdv", true)}
                aria-label="Vender"
                className={cn(
                  "relative flex h-[52px] min-w-11 flex-1 flex-col items-center justify-center gap-1 rounded-[22px] transition-[color,transform] active:scale-95",
                  currentView === "admin-pdv"
                    ? "bg-[#3B3016] text-admin-gold"
                    : "text-[#A1A1AD] hover:text-white",
                )}
              >
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-lg border",
                    currentView === "admin-pdv"
                      ? "border-transparent"
                      : "border-emerald-400/20 bg-emerald-400/10 text-emerald-400",
                  )}
                >
                  <ScanBarcode aria-hidden="true" className="size-[18px]" />
                </span>
                <span className="text-center text-[11px] font-medium leading-3">
                  Vender
                </span>
              </button>
            </motion.nav>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
