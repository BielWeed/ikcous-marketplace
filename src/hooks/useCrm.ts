import { type DashboardStats, useAnalytics } from "@/hooks/useAnalytics";
import { useAuth } from "@/hooks/useAuth";
import { useLeaderElection } from "@/hooks/useLeaderElection";
import { useRevalidarAoVoltar } from "@/hooks/useRevalidarAoVoltar";
import {
  cacheDaVisao,
  lerGeracaoDaVisaoDoCrm,
} from "@/lib/cache-da-visao-do-crm";
import { criarCanalDeAbas } from "@/lib/canal-de-abas";
import {
  lerClientesDoCrm,
  lerVisaoDoCrm,
  lerVisitasDoCrm,
  mensagemDeErroDoPainel,
} from "@/lib/crm";
import {
  PRAZO_DA_CONSULTA_DO_PAINEL_MS,
  aguardarComPrazo,
  erroDeConsultaSemResposta,
} from "@/lib/prazo-da-requisicao";
import { supabase } from "@/lib/supabase";
import type {
  IntervaloDeDatas,
  ListaDeClientesDoCrm,
  SegmentoCrm,
  VisaoDoCrm,
  VisitasDoCrm,
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
const leiturasDaVisaoEmVoo = new Map<string, symbol>();

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
  const consultasEmVooRef = useRef(0);
  const [revalidacao, setRevalidacao] = useState(0);
  useRevalidarAoVoltar(
    active && temSessao,
    () => setRevalidacao((n) => n + 1),
    () => consultasEmVooRef.current === 0,
  );

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
    setCarregando(!emCache);
    const timer = setTimeout(async () => {
      consultasEmVooRef.current += 1;
      const geracao = lerGeracaoDaVisaoDoCrm();
      const rodada = Symbol();
      leiturasDaVisaoEmVoo.set(chave, rodada);
      recargaAtendidaRef.current = pedidoDeRecarga;
      try {
        // Rede que conecta e não responde: sem prazo, `consultasEmVooRef` ficava
        // em 1 para sempre (o "carregando" não saía, o Sincronizar ficava preso
        // e a volta ao app nunca relia). Estourou: cai no `catch` abaixo, que
        // mostra o erro com "Tentar de novo"; o `finally` solta a vaga.
        const { data, error } = await aguardarComPrazo(
          Promise.resolve(
            supabase.rpc("crm_visao", {
              p_inicio: intervalo.inicio,
              p_fim: intervalo.fim,
            }),
          ),
          PRAZO_DA_CONSULTA_DO_PAINEL_MS,
          () => erroDeConsultaSemResposta(),
        );
        // Cancelamento/estorno durante a consulta invalida também a resposta
        // em voo: ela não pode devolver o retrato antigo ao cache ou à tela.
        if (geracao !== lerGeracaoDaVisaoDoCrm()) return;
        const lida = error ? null : lerVisaoDoCrm(data);
        // Guarda no período dela, mesmo após trocar de chip. Uma leitura
        // mais nova DO MESMO período continua tendo preferência no cache.
        if (lida && leiturasDaVisaoEmVoo.get(chave) === rodada) {
          guardarNoCache(chave, { visao: lida, lidoEm: Date.now() });
        }
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
        consultasEmVooRef.current -= 1;
        if (leiturasDaVisaoEmVoo.get(chave) === rodada)
          leiturasDaVisaoEmVoo.delete(chave);
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
    revalidacao,
  ]);

  return { visao, carregando, erro, atualizar };
}

// ═══ crm_visitas ═════════════════════════════════════════════════════════

// A leitura de cada período (`null` = função ainda ausente nesta loja).
const cacheDasVisitas = new Map<
  string,
  { visitas: VisitasDoCrm | null; lidoEm: number }
>();

/**
 * Separado de `useCrmVisao`: o número de visitas nunca atrasa nem derruba a
 * visão. Função ausente (PGRST202/42883) some em silêncio; outro erro só
 * marca `erro`.
 */
export function useCrmVisitas(intervalo: IntervaloDeDatas, active: boolean) {
  const { session } = useAuth();
  const temSessao = Boolean(session);
  const chave = `${intervalo.inicio}:${intervalo.fim}`;
  const [falha, setFalha] = useState({ chave: "", erro: false });

  useEffect(() => {
    const emCache = cacheDasVisitas.get(chave);
    if (!active || !temSessao) return;
    if (emCache && Date.now() - emCache.lidoEm < FRESCOR_MS) return;
    let cancelada = false;
    const timer = setTimeout(async () => {
      let visitas: VisitasDoCrm | null = null;
      let erro = false;
      try {
        const { data, error } = await supabase.rpc("crm_visitas", {
          p_inicio: intervalo.inicio,
          p_fim: intervalo.fim,
        });
        if (error) erro = !["PGRST202", "42883"].includes(error.code);
        else erro = (visitas = lerVisitasDoCrm(data)) === null;
      } catch {
        erro = true;
      }
      if (!erro) cacheDasVisitas.set(chave, { visitas, lidoEm: Date.now() });
      if (!cancelada) setFalha({ chave, erro });
    }, ESPERA_DO_PERIODO_MS);
    return () => {
      cancelada = true;
      clearTimeout(timer);
    };
  }, [chave, intervalo.inicio, intervalo.fim, active, temSessao]);

  return {
    visitas: cacheDasVisitas.get(chave)?.visitas ?? null,
    erro: falha.chave === chave && falha.erro,
  };
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
        const { data, error } = await aguardarComPrazo(
          Promise.resolve(
            supabase.rpc("crm_clientes", {
              p_segmento: segmento,
              p_busca: termo === "" ? null : termo,
              p_limite: porPagina,
              p_offset: pagina * porPagina,
            }),
          ),
          PRAZO_DA_CONSULTA_DO_PAINEL_MS,
          erroDeConsultaSemResposta,
        );
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
  readonly carregandoCategorias: boolean;
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
  // Só "há sessão ou não": o AuthContext troca o OBJETO a cada SIGNED_IN
  // (reanunciado ao voltar ao app) e isso recriaria os 4 canais ao vivo.
  const temSessao = Boolean(session);
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

  const leiturasEmVooRef = useRef(0);
  const loadDashboardData = useCallback(
    async (force = false, silencioso = false) => {
      leiturasEmVooRef.current += 1;
      const hasData = !!statsRef.current && !!categoryDataRef.current;
      if (!silencioso && (!hasData || force)) {
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
        leiturasEmVooRef.current -= 1;
        setIsLoading(false);
      }
    },
    [fetchExecutiveSummary, fetchCategoryAnalytics],
  );

  useRevalidarAoVoltar(
    active && temSessao,
    () => loadDashboardData(false, true),
    () => leiturasEmVooRef.current === 0,
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
    if (!temSessao || !active) return;

    const bc = criarCanalDeAbas("ikcous_admin_dashboard_realtime");
    let ordersChannel: ReturnType<typeof supabase.channel> | null = null;
    let productsChannel: ReturnType<typeof supabase.channel> | null = null;
    let reviewsChannel: ReturnType<typeof supabase.channel> | null = null;
    let qaChannel: ReturnType<typeof supabase.channel> | null = null;

    if (isLeader) {
      const handleDbChange = () => {
        triggerRealtimeRefresh();
        bc?.postMessage({ type: "dashboard_refresh" });
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
    } else if (bc) {
      bc.onmessage = (event) => {
        if (event.data?.type === "dashboard_refresh") {
          triggerRealtimeRefresh();
        }
      };
    }

    return () => {
      bc?.close();
      if (ordersChannel) supabase.removeChannel(ordersChannel);
      if (productsChannel) supabase.removeChannel(productsChannel);
      if (reviewsChannel) supabase.removeChannel(reviewsChannel);
      if (qaChannel) supabase.removeChannel(qaChannel);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [temSessao, active, isLeader, triggerRealtimeRefresh]);

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
    if (temSessao && active) {
      const timer = setTimeout(() => {
        loadDashboardData(false);
      }, 320);
      return () => clearTimeout(timer);
    }
  }, [loadDashboardData, temSessao, active]);

  return {
    stats,
    categorias,
    carregandoCategorias: isLoading && categoryData == null && !categoryError,
    carregando: isLoading,
    erro: error,
    erroDeCategoria: categoryError,
    carregar: loadDashboardData,
  };
}
