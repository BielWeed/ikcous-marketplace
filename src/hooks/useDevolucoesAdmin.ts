import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  AVISO_RESGATE_ETIQUETA,
  corpoDoErroDaEdge,
  formatarDia,
  formatarReais,
  lerDevolucaoDetalhe,
  lerDevolucoesDoPedido,
  lerListaAdmin,
  lerRespostaEtiquetaReversa,
  lerResultadoConclusao,
  lerResultadoDeStatus,
  mensagemDoErro,
  totalAbertas,
} from "@/lib/devolucao";
import { supabase } from "@/lib/supabase";
import type {
  ContagemPorStatus,
  DevolucaoDetalhe,
  InspecaoDoItem,
  LinhaDevolucaoAdmin,
  ResolucaoDevolucao,
  ResultadoConclusao,
  ResumoDevolucao,
  StatusDevolucao,
} from "@/types/devolucao";

const PAGINA = 50;
const ERRO_GENERICO = "Não foi possível concluir agora. Tente de novo.";

/** Mesmo texto do estorno do pedido (useEstornosDoPedido): a linha já existe
 * no ledger e o cron `reconciliar-pagamentos` a executa se o clique falhar. */
export const TEXTO_REEMBOLSO_NA_FILA =
  "Devolução concluída. O reembolso ficou registrado e o Mercado Pago é acionado em até 10 minutos.";

// ---------------------------------------------------------------------------
// Ponte "abrir esta devolução" (card do pedido → tela de Devoluções)
// ---------------------------------------------------------------------------

// A rota `admin-devolucoes` não recebe id. O card do pedido guarda aqui a
// devolução que quer ver aberta e a tela a consome UMA vez ao montar. Estado
// de módulo, não de storage: vale só para a navegação desta aba.
let devolucaoParaAbrir: string | null = null;

export function pedirParaAbrirDevolucao(id: string): void {
  devolucaoParaAbrir = id;
}

export function tomarDevolucaoParaAbrir(): string | null {
  const id = devolucaoParaAbrir;
  devolucaoParaAbrir = null;
  return id;
}

// ---------------------------------------------------------------------------
// Lista do painel
// ---------------------------------------------------------------------------

export interface ListaDoPainel {
  itens: LinhaDevolucaoAdmin[];
  total: number;
  contagem: ContagemPorStatus | null;
  carregando: boolean;
  erro: boolean;
  temMais: boolean;
  carregarMais: () => void;
  recarregar: () => void;
}

/**
 * `admin_devolucoes_listar` com filtro por status e busca (protocolo, nome do
 * cliente ou começo do id do pedido — a busca é do servidor). A contagem por
 * status vem sempre inteira, independente do filtro: é ela que pinta os chips.
 */
export function useDevolucoesAdmin(args: {
  status: StatusDevolucao | null;
  busca: string;
  ativo?: boolean;
}): ListaDoPainel {
  const { status, busca, ativo = true } = args;
  const [itens, setItens] = useState<LinhaDevolucaoAdmin[]>([]);
  const [total, setTotal] = useState(0);
  const [contagem, setContagem] = useState<ContagemPorStatus | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(false);
  const ativoRef = useRef(true);
  const rodadaRef = useRef(0);

  const buscar = useCallback(
    async (offset: number) => {
      const rodada = ++rodadaRef.current;
      const valeAinda = () => ativoRef.current && rodada === rodadaRef.current;
      setCarregando(true);
      try {
        const { data, error } = await supabase.rpc("admin_devolucoes_listar", {
          p_status: status,
          p_busca: busca.trim() || null,
          p_limite: PAGINA,
          p_offset: offset,
        });
        if (!valeAinda()) return;
        const lista = error ? null : lerListaAdmin(data);
        if (!lista) {
          setErro(true);
          return;
        }
        setItens((antes) =>
          offset === 0 ? lista.itens : [...antes, ...lista.itens],
        );
        setTotal(lista.total);
        setContagem(lista.contagem);
        setErro(false);
      } catch {
        if (valeAinda()) setErro(true);
      } finally {
        if (valeAinda()) setCarregando(false);
      }
    },
    [status, busca],
  );

  useEffect(() => {
    ativoRef.current = true;
    if (ativo) void buscar(0);
    return () => {
      ativoRef.current = false;
    };
  }, [ativo, buscar]);

  return {
    itens,
    total,
    contagem,
    carregando,
    erro,
    temMais: itens.length < total,
    carregarMais: () => void buscar(itens.length),
    recarregar: () => void buscar(0),
  };
}

/** Quantas devoluções estão em andamento (botão da tela de Pedidos). */
export function useDevolucoesAbertas(ativo = true): {
  abertas: number | null;
  solicitadas: number;
} {
  const [contagem, setContagem] = useState<ContagemPorStatus | null>(null);

  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("admin_devolucoes_listar", {
          p_limite: 1,
        });
        const lista = error ? null : lerListaAdmin(data);
        if (vivo && lista) setContagem(lista.contagem);
      } catch {
        // Botão continua existindo, só sem o número: a tela de Devoluções
        // diz a verdade quando aberta.
      }
    })();
    return () => {
      vivo = false;
    };
  }, [ativo]);

  return {
    abertas: contagem ? totalAbertas(contagem) : null,
    solicitadas: contagem?.solicitada ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Devoluções de UM pedido (card na ficha do pedido)
// ---------------------------------------------------------------------------

export function useDevolucoesDoPedidoAdmin(
  orderId: string,
  habilitado: boolean,
): {
  devolucoes: ResumoDevolucao[];
  carregando: boolean;
  erro: boolean;
  recarregar: () => void;
} {
  const [devolucoes, setDevolucoes] = useState<ResumoDevolucao[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(false);
  const ativoRef = useRef(true);

  const carregar = useCallback(async () => {
    if (!habilitado) return;
    setCarregando(true);
    try {
      const { data, error } = await supabase.rpc("devolucoes_do_pedido", {
        p_order_id: orderId,
      });
      if (!ativoRef.current) return;
      const lista = error ? null : lerDevolucoesDoPedido(data);
      if (!lista) {
        setErro(true);
        return;
      }
      setDevolucoes(lista);
      setErro(false);
    } catch {
      if (ativoRef.current) setErro(true);
    } finally {
      if (ativoRef.current) setCarregando(false);
    }
  }, [orderId, habilitado]);

  useEffect(() => {
    ativoRef.current = true;
    if (habilitado) void carregar();
    return () => {
      ativoRef.current = false;
    };
  }, [habilitado, carregar]);

  return { devolucoes, carregando, erro, recarregar: () => void carregar() };
}

// ---------------------------------------------------------------------------
// Ficha de UMA devolução + ações do lojista
// ---------------------------------------------------------------------------

export type AcaoEmVoo =
  | "decidir"
  | "registrar"
  | "etiqueta"
  | "concluir"
  | "reprovar";

export interface FichaDaDevolucao {
  detalhe: DevolucaoDetalhe | null;
  /** URL assinada (10 min) por caminho de foto; `null` = não abriu. */
  fotos: ReadonlyMap<string, string | null>;
  carregando: boolean;
  erro: boolean;
  emVoo: AcaoEmVoo | null;
  recarregar: () => Promise<void>;
  aprovar: (args: {
    mensagem: string;
    coletaEm: string | null;
  }) => Promise<boolean>;
  recusar: (mensagem: string) => Promise<boolean>;
  marcarEmTransito: (codigo: string) => Promise<boolean>;
  marcarRecebida: () => Promise<boolean>;
  gerarEtiquetaReversa: () => Promise<boolean>;
  concluir: (args: {
    resolucao: ResolucaoDevolucao;
    itens: InspecaoDoItem[];
    valorReembolso: number | null;
    observacao: string;
  }) => Promise<ResultadoConclusao | null>;
  reprovar: (motivo: string) => Promise<boolean>;
}

async function assinarFotos(
  caminhos: readonly string[],
): Promise<Map<string, string | null>> {
  const pares = await Promise.all(
    caminhos.map(async (caminho) => {
      try {
        const { data, error } = await supabase.storage
          .from("devolucoes")
          .createSignedUrl(caminho, 600);
        return [caminho, error ? null : (data?.signedUrl ?? null)] as const;
      } catch {
        return [caminho, null] as const;
      }
    }),
  );
  return new Map(pares);
}

/**
 * Lê `devolucao_detalhe` e executa as ações do lojista. Cada ação chama a
 * RPC (que valida a máquina de estados com FOR UPDATE — nunca o status da
 * tela), avisa o resultado e relê a ficha. A trava `emVoo` é por ref E por
 * estado: o ref impede o clique duplo no mesmo tick; o estado pinta o botão.
 */
export function useDevolucaoAdmin(
  id: string | null,
  aoMudar?: () => void,
): FichaDaDevolucao {
  const [detalhe, setDetalhe] = useState<DevolucaoDetalhe | null>(null);
  const [fotos, setFotos] = useState<ReadonlyMap<string, string | null>>(
    () => new Map(),
  );
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(false);
  const [emVoo, setEmVoo] = useState<AcaoEmVoo | null>(null);
  const emVooRef = useRef(false);
  const idRef = useRef(id);
  const aoMudarRef = useRef(aoMudar);

  useEffect(() => {
    idRef.current = id;
    aoMudarRef.current = aoMudar;
  }, [id, aoMudar]);

  const carregar = useCallback(async () => {
    if (!id) return;
    setCarregando(true);
    try {
      const { data, error } = await supabase.rpc("devolucao_detalhe", {
        p_id: id,
      });
      if (idRef.current !== id) return;
      const lida = error ? null : lerDevolucaoDetalhe(data);
      if (!lida) {
        setErro(true);
        return;
      }
      setDetalhe(lida);
      setErro(false);
      const assinadas = await assinarFotos(lida.fotos);
      if (idRef.current === id) setFotos(assinadas);
    } catch {
      if (idRef.current === id) setErro(true);
    } finally {
      if (idRef.current === id) setCarregando(false);
    }
  }, [id]);

  useEffect(() => {
    setDetalhe(null);
    setFotos(new Map());
    setErro(false);
    if (id) void carregar();
  }, [id, carregar]);

  /** Envelope comum: trava, RPC, aviso, releitura. */
  const executar = useCallback(
    async <T>(
      qual: AcaoEmVoo,
      chamada: () => PromiseLike<{ data: unknown; error: unknown }>,
      ler: (data: unknown) => T | null,
    ): Promise<T | null> => {
      if (emVooRef.current) return null;
      emVooRef.current = true;
      setEmVoo(qual);
      try {
        const { data, error } = await chamada();
        if (error) {
          toast.error(mensagemDoErro(error, ERRO_GENERICO));
          await carregar();
          return null;
        }
        const lido = ler(data);
        if (lido === null) toast.error(ERRO_GENERICO);
        await carregar();
        aoMudarRef.current?.();
        return lido;
      } catch (e) {
        toast.error(mensagemDoErro(e, ERRO_GENERICO));
        return null;
      } finally {
        emVooRef.current = false;
        setEmVoo(null);
      }
    },
    [carregar],
  );

  const aprovar = useCallback(
    async ({
      mensagem,
      coletaEm,
    }: { mensagem: string; coletaEm: string | null }) => {
      if (!id) return false;
      const r = await executar(
        "decidir",
        () =>
          supabase.rpc("admin_devolucao_decidir", {
            p_id: id,
            p_aprovar: true,
            p_mensagem: mensagem.trim() || null,
            p_coleta_em: coletaEm,
          }),
        lerResultadoDeStatus,
      );
      if (r) toast.success("Devolução aprovada. O cliente foi avisado.");
      return r !== null;
    },
    [id, executar],
  );

  const recusar = useCallback(
    async (mensagem: string) => {
      if (!id) return false;
      const r = await executar(
        "decidir",
        () =>
          supabase.rpc("admin_devolucao_decidir", {
            p_id: id,
            p_aprovar: false,
            p_mensagem: mensagem.trim(),
          }),
        lerResultadoDeStatus,
      );
      if (r) toast.success("Devolução recusada. O cliente vê o seu motivo.");
      return r !== null;
    },
    [id, executar],
  );

  const marcarEmTransito = useCallback(
    async (codigo: string) => {
      if (!id) return false;
      const r = await executar(
        "registrar",
        () =>
          supabase.rpc("admin_devolucao_registrar", {
            p_id: id,
            p_evento: "em_transito",
            p_codigo: codigo.trim() || null,
          }),
        lerResultadoDeStatus,
      );
      if (r) toast.success("Marcada como a caminho.");
      return r !== null;
    },
    [id, executar],
  );

  const marcarRecebida = useCallback(async () => {
    if (!id) return false;
    const r = await executar(
      "registrar",
      () =>
        supabase.rpc("admin_devolucao_registrar", {
          p_id: id,
          p_evento: "recebida",
        }),
      lerResultadoDeStatus,
    );
    if (r) toast.success("Produto recebido. Agora confira e conclua.");
    return r !== null;
  }, [id, executar]);

  const reprovar = useCallback(
    async (motivo: string) => {
      if (!id) return false;
      const r = await executar(
        "reprovar",
        () =>
          supabase.rpc("admin_devolucao_reprovar", {
            p_id: id,
            p_motivo: motivo.trim(),
          }),
        lerResultadoDeStatus,
      );
      if (r) toast.success("Devolução reprovada. O cliente vê o seu motivo.");
      return r !== null;
    },
    [id, executar],
  );

  const gerarEtiquetaReversa = useCallback(async () => {
    if (!id || emVooRef.current) return false;
    emVooRef.current = true;
    setEmVoo("etiqueta");
    try {
      const { data, error } = await supabase.functions.invoke(
        "melhor-envio-etiqueta",
        { body: { action: "gerar_devolucao_reversa", devolucao_id: id } },
      );
      // Fora de 2xx o corpo vem em `error.context`; em 2xx, em `data`. Os
      // dois passam pelo mesmo leitor — `resgate` pode vir em qualquer um.
      const corpo = error ? await corpoDoErroDaEdge(error) : data;
      const resposta = lerRespostaEtiquetaReversa(corpo);
      if (!resposta.ok) {
        const base =
          error && !corpo
            ? "Não consegui gerar o código de postagem. Tente de novo em instantes."
            : resposta.erro;
        if (resposta.resgate) {
          // A cobrança pode ter saído: o lojista confere antes de repetir,
          // e a ficha relê (o código pode ter sido gravado mesmo assim).
          toast.error(`${base} ${AVISO_RESGATE_ETIQUETA}`, {
            duration: 15_000,
          });
          await carregar();
        } else {
          toast.error(base);
        }
        return false;
      }
      const { codigo_postagem, ja_existia, validade_ate } = resposta.dados;
      toast.success(
        ja_existia
          ? `Este pedido já tinha código de postagem: ${codigo_postagem}.`
          : `Código de postagem gerado: ${codigo_postagem}${validade_ate ? ` (vale até ${formatarDia(validade_ate)})` : ""}. O cliente já vê no pedido.`,
      );
      await carregar();
      aoMudarRef.current?.();
      return true;
    } catch (e) {
      toast.error(mensagemDoErro(e, ERRO_GENERICO));
      return false;
    } finally {
      emVooRef.current = false;
      setEmVoo(null);
    }
  }, [id, carregar]);

  const concluir = useCallback(
    async ({
      resolucao,
      itens,
      valorReembolso,
      observacao,
    }: {
      resolucao: ResolucaoDevolucao;
      itens: InspecaoDoItem[];
      valorReembolso: number | null;
      observacao: string;
    }) => {
      if (!id) return null;
      const r = await executar(
        "concluir",
        () =>
          supabase.rpc("admin_devolucao_concluir", {
            p_id: id,
            p_resolucao: resolucao,
            p_itens: itens.map((i) => ({
              item_id: i.item_id,
              condicao: i.condicao,
              reestocar: i.reestocar,
            })),
            p_valor_reembolso:
              resolucao === "reembolso" ? valorReembolso : null,
            p_observacao: observacao.trim() || null,
          }),
        lerResultadoConclusao,
      );
      if (!r) return null;

      const estoque =
        r.reestocados > 0
          ? ` ${r.reestocados} ${r.reestocados === 1 ? "unidade voltou" : "unidades voltaram"} ao estoque.`
          : "";
      const valor = formatarReais(r.valor_reembolso ?? 0);

      if (r.refund_id) {
        // Ledger primeiro, execução depois — o mesmo caminho do EstornoCard.
        // Falha aqui NÃO é falha da devolução: a linha está em
        // `order_refunds` e o cron a executa com a mesma idempotência.
        try {
          const { error } = await supabase.functions.invoke(
            "estornar-pagamento",
            { body: { refund_id: r.refund_id } },
          );
          if (error) toast.info(TEXTO_REEMBOLSO_NA_FILA + estoque);
          else {
            toast.success(
              `Devolução concluída. Reembolso de ${valor} enviado ao Mercado Pago.${estoque}`,
            );
          }
        } catch {
          toast.info(TEXTO_REEMBOLSO_NA_FILA + estoque);
        }
        await carregar();
      } else if (r.reembolso_manual) {
        toast.warning(
          `Devolução concluída. Devolva ${valor} ao cliente em mãos ou por PIX — este pedido não foi pago pelo app.${estoque}`,
          { duration: 12_000 },
        );
      } else {
        toast.success(`Devolução concluída.${estoque}`);
      }
      return r;
    },
    [id, executar, carregar],
  );

  return {
    detalhe,
    fotos,
    carregando,
    erro,
    emVoo,
    recarregar: carregar,
    aprovar,
    recusar,
    marcarEmTransito,
    marcarRecebida,
    gerarEtiquetaReversa,
    concluir,
    reprovar,
  };
}
