import { type DashboardStats, useAnalytics } from "@/hooks/useAnalytics";
import { useAuth } from "@/hooks/useAuth";
import { useLeaderElection } from "@/hooks/useLeaderElection";
import {
  lerClientesDoCrm,
  lerVisaoDoCrm,
  mensagemDeErroDoPainel,
} from "@/lib/crm";
import { supabase } from "@/lib/supabase";
import type {
  IntervaloDeDatas,
  ListaDeClientesDoCrm,
  SegmentoCrm,
  VisaoDoCrm,
} from "@/types/crm";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ═══ crm_visao ═══════════════════════════════════════════════════════════

const FRESCOR_MS = 30_000;
/** Toques rápidos nos chips de período viram UMA consulta. */
const ESPERA_DO_PERIODO_MS = 250;
const LIMITE_DO_CACHE = 12;

interface VisaoEmCache {
  readonly visao: VisaoDoCrm;
  readonly lidoEm: number;
}

// Cache por intervalo: voltar a um chip já visto mostra o número na hora.
const cacheDaVisao = new Map<string, VisaoEmCache>();

function guardarNoCache(chave: string, valor: VisaoEmCache) {
  cacheDaVisao.delete(chave);
  cacheDaVisao.set(chave, valor);
  if (cacheDaVisao.size > LIMITE_DO_CACHE) {
    const maisAntiga = cacheDaVisao.keys().next().value;
    if (maisAntiga !== undefined) cacheDaVisao.delete(maisAntiga);
  }
}

interface EstadoDaVisao {
  readonly visao: VisaoDoCrm | null;
  readonly carregando: boolean;
  readonly erro: string | null;
  readonly atualizar: () => void;
}

export function useCrmVisao(
  intervalo: IntervaloDeDatas,
  active: boolean,
): EstadoDaVisao {
  const { session } = useAuth();
  const temSessao = Boolean(session);
  const chave = `${intervalo.inicio}:${intervalo.fim}`;
  const [visao, setVisao] = useState<VisaoDoCrm | null>(
    () => cacheDaVisao.get(chave)?.visao ?? null,
  );
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pedidoDeRecarga, setPedidoDeRecarga] = useState(0);

  const atualizar = useCallback(() => {
    setPedidoDeRecarga((n) => n + 1);
  }, []);

  // O último pedido de recarga que já foi atendido: um número novo força a
  // consulta mesmo com o cache fresco.
  const recargaAtendidaRef = useRef(0);

  useEffect(() => {
    // Troca de período: o número do período anterior NUNCA fica na tela
    // fingindo ser do novo — ou mostra o cache do novo, ou esqueleto.
    const emCache = cacheDaVisao.get(chave);
    setVisao(emCache?.visao ?? null);
    setErro(null);
    if (!active || !temSessao) return;

    const forcar = pedidoDeRecarga !== recargaAtendidaRef.current;
    if (!forcar && emCache && Date.now() - emCache.lidoEm < FRESCOR_MS) {
      return;
    }

    // "Carregando" já no mesmo commit da troca (sem piscar "—" durante a
    // espera); a limpeza desta rodada e o início da próxima saem juntos.
    let cancelada = false;
    setCarregando(true);
    const timer = setTimeout(async () => {
      recargaAtendidaRef.current = pedidoDeRecarga;
      try {
        const { data, error } = await supabase.rpc("crm_visao", {
          p_inicio: intervalo.inicio,
          p_fim: intervalo.fim,
        });
        const lida = error ? null : lerVisaoDoCrm(data);
        // Resposta que chegou depois da troca de período ainda vale para o
        // período DELA: vai para o cache, mas não para a tela.
        if (lida) guardarNoCache(chave, { visao: lida, lidoEm: Date.now() });
        if (cancelada) return;
        if (error) {
          console.error("[useCrmVisao] crm_visao falhou:", error);
          setErro(mensagemDeErroDoPainel(error, "carregar o CRM"));
          return;
        }
        if (!lida) {
          setErro(
            "Os números do CRM chegaram num formato inesperado. Tente de novo em instantes.",
          );
          return;
        }
        setVisao(lida);
      } catch (falha) {
        if (cancelada) return;
        console.error("[useCrmVisao] consulta falhou:", falha);
        setErro(mensagemDeErroDoPainel(falha, "carregar o CRM"));
      } finally {
        if (!cancelada) setCarregando(false);
      }
    }, ESPERA_DO_PERIODO_MS);

    return () => {
      cancelada = true;
      clearTimeout(timer);
      setCarregando(false);
    };
  }, [
    chave,
    intervalo.inicio,
    intervalo.fim,
    active,
    temSessao,
    pedidoDeRecarga,
  ]);

  return { visao, carregando, erro, atualizar };
}

// ═══ crm_clientes ════════════════════════════════════════════════════════

interface FiltroDeClientes {
  readonly segmento: SegmentoCrm | null;
  readonly busca: string;
  readonly pagina: number;
  readonly porPagina: number;
  readonly active: boolean;
}

interface EstadoDosClientes {
  readonly lista: ListaDeClientesDoCrm | null;
  readonly carregando: boolean;
  readonly erro: string | null;
  readonly atualizar: () => void;
}

const ESPERA_DOS_CLIENTES_MS = 150;

export function useCrmClientes({
  segmento,
  busca,
  pagina,
  porPagina,
  active,
}: FiltroDeClientes): EstadoDosClientes {
  const { session } = useAuth();
  const temSessao = Boolean(session);
  const [lista, setLista] = useState<ListaDeClientesDoCrm | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pedidoDeRecarga, setPedidoDeRecarga] = useState(0);

  const atualizar = useCallback(() => {
    setPedidoDeRecarga((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!active || !temSessao) return;
    let cancelada = false;
    const termo = busca.trim();
    setCarregando(true);
    setErro(null);
    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase.rpc("crm_clientes", {
          p_segmento: segmento,
          p_busca: termo === "" ? null : termo,
          p_limite: porPagina,
          p_offset: pagina * porPagina,
        });
        if (cancelada) return;
        if (error) {
          console.error("[useCrmClientes] crm_clientes falhou:", error);
          setErro(mensagemDeErroDoPainel(error, "carregar os clientes"));
          return;
        }
        const lida = lerClientesDoCrm(data);
        if (!lida) {
          setErro(
            "A lista de clientes chegou num formato inesperado. Tente de novo em instantes.",
          );
          return;
        }
        setLista(lida);
      } catch (falha) {
        if (cancelada) return;
        console.error("[useCrmClientes] consulta falhou:", falha);
        setErro(mensagemDeErroDoPainel(falha, "carregar os clientes"));
      } finally {
        if (!cancelada) setCarregando(false);
      }
    }, ESPERA_DOS_CLIENTES_MS);

    return () => {
      cancelada = true;
      clearTimeout(timer);
      setCarregando(false);
    };
  }, [segmento, busca, pagina, porPagina, active, temSessao, pedidoDeRecarga]);

  return { lista, carregando, erro, atualizar };
}

// ═══ Visão geral clássica (o dashboard que era o Início) ═════════════════

interface CategoriaDoDashboard {
  name: string;
  value: number;
  avg_ticket?: number;
  orders?: number;
}

interface EstadoDoDashboardClassico {
  readonly stats: DashboardStats | null;
  readonly categorias: CategoriaDoDashboard[];
  readonly carregando: boolean;
  readonly erro: string | null;
  readonly erroDeCategoria: string | null;
  readonly carregar: (forcar?: boolean) => Promise<void>;
}

/**
 * A lógica do dashboard que morava em `AdminDashboardView` até 26/09/2026,
 * movida INTACTA para a aba "Visão geral" do CRM: `get_admin_analytics_v2`
 * + `get_category_analytics` (via `useAnalytics`), tempo real em pedidos,
 * `produtos` (nunca "products" — achado A2), avaliações e perguntas, com
 * eleição de líder entre abas + BroadcastChannel e recarga com espera de
 * 1,5 s para não martelar o banco. `aoMudarNoBanco` avisa quem chama (o CRM
 * recarrega `crm_visao` junto, na mesma espera).
 */
export function useDashboardClassico(
  active: boolean,
  aoMudarNoBanco?: () => void,
): EstadoDoDashboardClassico {
  const { session } = useAuth();
  const {
    fetchExecutiveSummary,
    fetchCategoryAnalytics,
    stats,
    categoryData,
    error,
    categoryError,
  } = useAnalytics();

  const [isLoading, setIsLoading] = useState(() => !stats || !categoryData);

  const statsRef = useRef(stats);
  const categoryDataRef = useRef(categoryData);
  const aoMudarNoBancoRef = useRef(aoMudarNoBanco);

  useEffect(() => {
    statsRef.current = stats;
    categoryDataRef.current = categoryData;
  }, [stats, categoryData]);

  useEffect(() => {
    aoMudarNoBancoRef.current = aoMudarNoBanco;
  }, [aoMudarNoBanco]);

  const loadDashboardData = useCallback(
    async (force = false) => {
      const hasData = !!statsRef.current && !!categoryDataRef.current;
      if (!hasData || force) {
        setIsLoading(true);
      }
      try {
        await Promise.all([
          fetchExecutiveSummary(force),
          fetchCategoryAnalytics(
            "2020-01-01T00:00:00.000Z",
            new Date().toISOString(),
            force,
          ),
        ]);
      } catch (err) {
        console.error("Error loading dashboard data:", err);
      } finally {
        setIsLoading(false);
      }
    },
    [fetchExecutiveSummary, fetchCategoryAnalytics],
  );

  const { isLeader } = useLeaderElection();
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerRealtimeRefresh = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      loadDashboardData(true);
      aoMudarNoBancoRef.current?.();
    }, 1500); // 1.5s protection buffer to safeguard DB
  }, [loadDashboardData]);

  // Real-time synchronization subscription for the active CRM overview
  useEffect(() => {
    if (!session || !active) return;

    const bc = new BroadcastChannel("ikcous_admin_dashboard_realtime");
    let ordersChannel: ReturnType<typeof supabase.channel> | null = null;
    let productsChannel: ReturnType<typeof supabase.channel> | null = null;
    let reviewsChannel: ReturnType<typeof supabase.channel> | null = null;
    let qaChannel: ReturnType<typeof supabase.channel> | null = null;

    if (isLeader) {
      const handleDbChange = () => {
        triggerRealtimeRefresh();
        bc.postMessage({ type: "dashboard_refresh" });
      };

      ordersChannel = supabase
        .channel("admin-dashboard-orders")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "marketplace_orders" },
          handleDbChange,
        )
        .subscribe();

      productsChannel = supabase
        .channel("admin-dashboard-products")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "produtos" },
          handleDbChange,
        )
        .subscribe();

      reviewsChannel = supabase
        .channel("admin-dashboard-reviews")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "reviews" },
          handleDbChange,
        )
        .subscribe();

      qaChannel = supabase
        .channel("admin-dashboard-qa")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "questions" },
          handleDbChange,
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "answers" },
          handleDbChange,
        )
        .subscribe();
    } else {
      bc.onmessage = (event) => {
        if (event.data?.type === "dashboard_refresh") {
          triggerRealtimeRefresh();
        }
      };
    }

    return () => {
      bc.close();
      if (ordersChannel) supabase.removeChannel(ordersChannel);
      if (productsChannel) supabase.removeChannel(productsChannel);
      if (reviewsChannel) supabase.removeChannel(reviewsChannel);
      if (qaChannel) supabase.removeChannel(qaChannel);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [session, active, isLeader, triggerRealtimeRefresh]);

  const categorias = useMemo<CategoriaDoDashboard[]>(() => {
    if (!categoryData) return [];
    return categoryData.map(
      (c: {
        name: string;
        value: string | number;
        avg_ticket?: number;
        orders?: number;
      }) => ({
        name: c.name,
        value: Number(c.value),
        avg_ticket: c.avg_ticket ? Number(c.avg_ticket) : undefined,
        orders: c.orders ? Number(c.orders) : undefined,
      }),
    );
  }, [categoryData]);

  useEffect(() => {
    if (session && active) {
      const timer = setTimeout(() => {
        loadDashboardData(false);
      }, 320);
      return () => clearTimeout(timer);
    }
  }, [loadDashboardData, session, active]);

  return {
    stats,
    categorias,
    carregando: isLoading,
    erro: error,
    erroDeCategoria: categoryError,
    carregar: loadDashboardData,
  };
}
