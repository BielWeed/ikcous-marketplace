// Leitura e escrita do Financeiro do painel (RPCs `fin_*`).
//
// SEM biblioteca de cache de consulta no projeto: cada leitura é um
// `useConsultaFinanceira` com três travas:
//   1. `chave === null` não busca nada — é assim que a tela desliga a busca
//      quando não está ativa (`active` do roteador) ou sem período válido;
//   2. resposta velha nunca sobrescreve a nova (troca rápida de período);
//   3. um cache POR TELA (Map no contexto, criado pela view) guarda a última
//      resposta de cada chave: voltar a uma aba mostra o que já se sabia e
//      atualiza por baixo, sem piscar o esqueleto.
// Depois de QUALQUER escrita a view sobe a `versao`, e toda consulta viva
// busca de novo — saldo, extrato, previstos, DRE e caixa mudam juntos.
//
// As escritas são funções simples (não hooks): devolvem o que a RPC
// devolveu, já validado, e deixam o erro cru subir — quem chama traduz com
// `mensagemDeErroFinanceiro` e mostra na folha.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  mensagemDeErroFinanceiro,
  parseCaixaAtual,
  parseCaixaHistorico,
  parseCategorias,
  parseContas,
  parseDre,
  parseExtrato,
  parseFechamento,
  parseIdsSalvos,
  parsePrevistos,
  parseResumo,
} from "@/lib/financeiro";
import { supabase } from "@/lib/supabase";
import type { Json } from "@/types/database.types";
import type {
  CaixaAtual,
  CategoriaFinanceira,
  ContaFinanceira,
  DataIso,
  DreFinanceira,
  FechamentoDeCaixa,
  IntervaloDeDatas,
  LancamentoPrevisto,
  LinhaDoExtrato,
  PayloadDaCategoria,
  PayloadDaConta,
  PayloadDoLancamento,
  ResumoFinanceiro,
  SessaoDeCaixa,
} from "@/types/financeiro";

// ---------------------------------------------------------------------------
// Consulta genérica
// ---------------------------------------------------------------------------

/** Cache da tela do Financeiro: criado pela view, vive enquanto ela vive. */
export const ContextoDoCacheFinanceiro = createContext<Map<
  string,
  unknown
> | null>(null);

export interface ConsultaFinanceira<T> {
  readonly dados: T | null;
  /** Buscando (a primeira vez OU atualizando por baixo de dados antigos). */
  readonly carregando: boolean;
  /** Frase pronta para a tela (nunca o erro cru). */
  readonly erro: string | null;
  readonly recarregar: () => void;
}

interface EstadoDaConsulta<T> {
  readonly chave: string | null;
  readonly dados: T | null;
  readonly erro: string | null;
  readonly carregando: boolean;
}

function lerCache<T>(
  cache: Map<string, unknown> | null,
  chave: string | null,
): T | null {
  if (!cache || chave === null) return null;
  return (cache.get(chave) as T | undefined) ?? null;
}

function useConsultaFinanceira<T>(
  chave: string | null,
  carregar: () => Promise<T>,
  versao: number,
): ConsultaFinanceira<T> {
  const cache = useContext(ContextoDoCacheFinanceiro);
  const [estado, setEstado] = useState<EstadoDaConsulta<T>>(() => ({
    chave,
    dados: lerCache<T>(cache, chave),
    erro: null,
    carregando: chave !== null,
  }));
  const [tentativa, setTentativa] = useState(0);
  const carregarRef = useRef(carregar);
  useEffect(() => {
    carregarRef.current = carregar;
  });

  useEffect(() => {
    if (chave === null) return;
    let viva = true;
    setEstado((anterior) =>
      anterior.chave === chave
        ? { ...anterior, carregando: true, erro: null }
        : {
            chave,
            dados: lerCache<T>(cache, chave),
            erro: null,
            carregando: true,
          },
    );
    carregarRef.current().then(
      (dados) => {
        if (!viva) return;
        cache?.set(chave, dados);
        setEstado({ chave, dados, erro: null, carregando: false });
      },
      (erro: unknown) => {
        if (!viva) return;
        setEstado((anterior) => ({
          chave,
          dados: anterior.chave === chave ? anterior.dados : null,
          erro: mensagemDeErroFinanceiro(erro),
          carregando: false,
        }));
      },
    );
    return () => {
      viva = false;
    };
  }, [chave, versao, tentativa, cache]);

  const recarregar = useCallback(() => setTentativa((t) => t + 1), []);

  if (estado.chave !== chave) {
    return {
      dados: lerCache<T>(cache, chave),
      carregando: chave !== null,
      erro: null,
      recarregar,
    };
  }
  return {
    dados: estado.dados,
    carregando: estado.carregando,
    erro: estado.erro,
    recarregar,
  };
}

// ---------------------------------------------------------------------------
// Leituras
// ---------------------------------------------------------------------------

const chaveDoIntervalo = (prefixo: string, intervalo: IntervaloDeDatas) =>
  `${prefixo}:${intervalo.inicio}:${intervalo.fim}`;

export function useResumoFinanceiro(
  intervalo: IntervaloDeDatas | null,
  ativo: boolean,
  versao: number,
): ConsultaFinanceira<ResumoFinanceiro> {
  return useConsultaFinanceira(
    ativo && intervalo ? chaveDoIntervalo("resumo", intervalo) : null,
    async () => {
      if (!intervalo) throw new Error("sem período");
      const { data, error } = await supabase.rpc("fin_resumo", {
        p_inicio: intervalo.inicio,
        p_fim: intervalo.fim,
      });
      if (error) throw error;
      return parseResumo(data);
    },
    versao,
  );
}

export function useExtratoFinanceiro(
  intervalo: IntervaloDeDatas | null,
  contaId: string | null,
  ativo: boolean,
  versao: number,
): ConsultaFinanceira<LinhaDoExtrato[]> {
  return useConsultaFinanceira(
    ativo && intervalo
      ? `${chaveDoIntervalo("extrato", intervalo)}:${contaId ?? "todas"}`
      : null,
    async () => {
      if (!intervalo) throw new Error("sem período");
      const { data, error } = await supabase.rpc("fin_extrato", {
        p_inicio: intervalo.inicio,
        p_fim: intervalo.fim,
        p_conta_id: contaId,
      });
      if (error) throw error;
      return parseExtrato(data);
    },
    versao,
  );
}

export function usePrevistosFinanceiros(
  tipo: "entrada" | "saida",
  ativo: boolean,
  versao: number,
): ConsultaFinanceira<LancamentoPrevisto[]> {
  return useConsultaFinanceira(
    ativo ? `previstos:${tipo}` : null,
    async () => {
      const { data, error } = await supabase.rpc("fin_previstos", {
        p_tipo: tipo,
      });
      if (error) throw error;
      return parsePrevistos(data);
    },
    versao,
  );
}

export function useDreFinanceira(
  intervalo: IntervaloDeDatas | null,
  ativo: boolean,
  versao: number,
): ConsultaFinanceira<DreFinanceira> {
  return useConsultaFinanceira(
    ativo && intervalo ? chaveDoIntervalo("dre", intervalo) : null,
    async () => {
      if (!intervalo) throw new Error("sem período");
      return lerDre(intervalo);
    },
    versao,
  );
}

async function lerDre(intervalo: IntervaloDeDatas): Promise<DreFinanceira> {
  const { data, error } = await supabase.rpc("fin_dre", {
    p_inicio: intervalo.inicio,
    p_fim: intervalo.fim,
  });
  if (error) throw error;
  return parseDre(data);
}

/** Uma DRE por mês do período (colunas mês a mês), na ordem dos meses. */
export function useDreMensal(
  meses: readonly IntervaloDeDatas[],
  ativo: boolean,
  versao: number,
): ConsultaFinanceira<DreFinanceira[]> {
  const primeiro = meses.at(0);
  const ultimo = meses.at(-1);
  return useConsultaFinanceira(
    ativo && primeiro && ultimo && meses.length > 1
      ? `dre-mensal:${primeiro.inicio}:${ultimo.fim}`
      : null,
    () => Promise.all(meses.map((mes) => lerDre(mes))),
    versao,
  );
}

export function useContasFinanceiras(
  ativo: boolean,
  versao: number,
): ConsultaFinanceira<ContaFinanceira[]> {
  return useConsultaFinanceira(
    ativo ? "contas" : null,
    async () => {
      const { data, error } = await supabase.rpc("fin_contas_listar");
      if (error) throw error;
      return parseContas(data);
    },
    versao,
  );
}

export function useCategoriasFinanceiras(
  ativo: boolean,
  versao: number,
): ConsultaFinanceira<CategoriaFinanceira[]> {
  return useConsultaFinanceira(
    ativo ? "categorias" : null,
    async () => {
      const { data, error } = await supabase.rpc("fin_categorias_listar");
      if (error) throw error;
      return parseCategorias(data);
    },
    versao,
  );
}

/**
 * O caixa vem EMBRULHADO (`{sessao}`): `dados === null` é "ainda não sei";
 * `dados.sessao === null` é "sei, e está FECHADO" — sem o envelope as duas
 * coisas seriam o mesmo `null`.
 */
export function useCaixaAtual(
  ativo: boolean,
  versao: number,
): ConsultaFinanceira<{ readonly sessao: CaixaAtual | null }> {
  return useConsultaFinanceira(
    ativo ? "caixa-atual" : null,
    async () => {
      const { data, error } = await supabase.rpc("fin_caixa_atual");
      if (error) throw error;
      return { sessao: parseCaixaAtual(data) };
    },
    versao,
  );
}

export function useHistoricoDoCaixa(
  ativo: boolean,
  versao: number,
): ConsultaFinanceira<SessaoDeCaixa[]> {
  return useConsultaFinanceira(
    ativo ? "caixa-historico" : null,
    async () => {
      const { data, error } = await supabase.rpc("fin_caixa_historico", {
        p_limite: 30,
      });
      if (error) throw error;
      return parseCaixaHistorico(data);
    },
    versao,
  );
}

// ---------------------------------------------------------------------------
// Escritas (a view sobe a `versao` depois de cada uma)
// ---------------------------------------------------------------------------

/** Os payloads são objetos simples; o supabase-js pede `Json`. */
const comoJson = (valor: object): Json => valor as unknown as Json;

export async function salvarLancamento(
  payload: PayloadDoLancamento,
): Promise<string[]> {
  const { data, error } = await supabase.rpc("fin_lancamento_salvar", {
    p: comoJson(payload),
  });
  if (error) throw error;
  return parseIdsSalvos(data);
}

export async function baixarLancamento(args: {
  id: string;
  data: DataIso;
  contaId: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc("fin_lancamento_baixar", {
    p_id: args.id,
    p_data: args.data,
    p_conta_id: args.contaId,
  });
  if (error) throw error;
}

export async function cancelarLancamento(args: {
  id: string;
  motivo: string;
}): Promise<void> {
  const { error } = await supabase.rpc("fin_lancamento_cancelar", {
    p_id: args.id,
    p_motivo: args.motivo,
  });
  if (error) throw error;
}

export async function abrirCaixa(args: {
  valorAbertura: number;
  contaId: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc("fin_caixa_abrir", {
    p_valor_abertura: args.valorAbertura,
    p_conta_id: args.contaId,
  });
  if (error) throw error;
}

export async function movimentarCaixa(args: {
  tipo: "sangria" | "suprimento";
  valor: number;
  descricao: string;
  contaContrapartida: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc("fin_caixa_movimentar", {
    p_tipo: args.tipo,
    p_valor: args.valor,
    p_descricao: args.descricao,
    p_conta_contrapartida: args.contaContrapartida,
  });
  if (error) throw error;
}

export async function fecharCaixa(args: {
  valorContado: number;
  observacao: string | null;
}): Promise<FechamentoDeCaixa> {
  const { data, error } = await supabase.rpc("fin_caixa_fechar", {
    p_valor_contado: args.valorContado,
    p_observacao: args.observacao,
  });
  if (error) throw error;
  return parseFechamento(data);
}

export async function salvarConta(payload: PayloadDaConta): Promise<void> {
  const { error } = await supabase.rpc("fin_conta_salvar", {
    p: comoJson(payload),
  });
  if (error) throw error;
}

export async function salvarCategoria(
  payload: PayloadDaCategoria,
): Promise<void> {
  const { error } = await supabase.rpc("fin_categoria_salvar", {
    p: comoJson(payload),
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Preferências da tela
// ---------------------------------------------------------------------------

/** Prefixo `ikcous_` sobrevive à purga do aparelho (localStoragePurgeWhitelist). */
export const CHAVE_VALORES_OCULTOS = "ikcous_financeiro_valores_ocultos";

function lerValoresOcultos(): boolean {
  try {
    return globalThis.localStorage?.getItem(CHAVE_VALORES_OCULTOS) === "1";
  } catch {
    // Aba anônima/armazenamento bloqueado: a tela funciona sem lembrar.
    return false;
  }
}

/** O "olho" que esconde os valores — lembrado neste aparelho. */
export function useValoresOcultos(): readonly [boolean, () => void] {
  const [ocultos, setOcultos] = useState(lerValoresOcultos);
  const alternar = useCallback(() => {
    setOcultos((atual) => {
      const novo = !atual;
      try {
        if (novo) globalThis.localStorage?.setItem(CHAVE_VALORES_OCULTOS, "1");
        else globalThis.localStorage?.removeItem(CHAVE_VALORES_OCULTOS);
      } catch {
        // Sem armazenamento: vale só nesta visita.
      }
      return novo;
    });
  }, []);
  return [ocultos, alternar] as const;
}

const CONSULTA_TELA_LARGA = "(min-width: 1024px)";

function telaLargaAgora(): boolean {
  return (
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia(CONSULTA_TELA_LARGA).matches
  );
}

/**
 * ≥ 1024 px (computador). Sem `matchMedia` (teste/SSR) = celular. Lido já
 * no primeiro render: a folha não pode nascer "de baixo" e pular para a
 * direita no computador.
 */
export function useTelaLarga(): boolean {
  const [larga, setLarga] = useState(telaLargaAgora);
  useEffect(() => {
    if (typeof globalThis.matchMedia !== "function") return;
    const consulta = globalThis.matchMedia(CONSULTA_TELA_LARGA);
    setLarga(consulta.matches);
    const aoMudar = (evento: MediaQueryListEvent) => setLarga(evento.matches);
    consulta.addEventListener?.("change", aoMudar);
    return () => consulta.removeEventListener?.("change", aoMudar);
  }, []);
  return larga;
}
