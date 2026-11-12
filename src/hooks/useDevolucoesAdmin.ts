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
  lerResultadoLiberacaoVinculo,
  mensagemDoErro,
  reaisComVirgula,
  totalAbertas,
} from "@/lib/devolucao";
import {
  PRAZO_DA_CONSULTA_DO_PAINEL_MS,
  aguardarComPrazo,
  ehConsultaSemResposta,
  erroDeConsultaSemResposta,
} from "@/lib/prazo-da-requisicao";
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
/** Teto de `p_limite` na RPC (LEAST(..., 200)). */
const LIMITE_MAXIMO = 200;
const ERRO_GENERICO = "Não foi possível concluir agora. Tente de novo.";

// Prazos da ESPERA da tela (a gravação pode chegar ao servidor depois — por
// isso, no estouro, a ficha é relida e o aviso manda conferir, nunca diz que
// "não foi feito"). Rede pendurada conecta e não responde: sem prazo a ficha
// inteira ficava com os botões apagados, sem frase e sem saída.
/** RPC de gravação (decidir, registrar, reprovar, concluir, liberar vínculo). */
const PRAZO_DA_GRAVACAO_MS = 20_000;
/** Edge com provedor externo por trás (Melhor Envio, Mercado Pago). */
const PRAZO_DA_EDGE_MS = 30_000;
/** Releitura da ficha depois de uma ação. */
const PRAZO_DA_RELEITURA_MS = 15_000;

const TEXTO_SEM_RESPOSTA_DA_ACAO =
  "Sem resposta da rede. Confira na ficha se a mudança apareceu antes de tentar de novo.";
const TEXTO_SEM_RESPOSTA_DA_CONCLUSAO =
  "Sem resposta da rede. Confira na ficha se a devolução foi concluída e se o reembolso aparece antes de tentar de novo.";

/** O AdminLayout escuta este evento e reconta a bolinha vermelha do sino. */
const EVENTO_RECONTAR_AVISOS = "admin:recontar-avisos";

function pedirRecontagemDoSino() {
  window.dispatchEvent(new Event(EVENTO_RECONTAR_AVISOS));
}

/** Mesmo texto do estorno do pedido (useEstornosDoPedido): a linha já existe
 * no ledger e o cron `reconciliar-pagamentos` a executa se o clique falhar. */
export const TEXTO_REEMBOLSO_NA_FILA =
  "Devolução concluída. O reembolso ficou registrado e o Mercado Pago é acionado em até 10 minutos.";

/** O `status` que a edge `estornar-pagamento` devolve numa resposta 2xx:
 * `concluido` (200), `falhou`/`recusado` (200) ou `em_processamento` (202).
 * Nenhum deles chega como `error` no supabase-js — só o corpo diz o que houve. */
function statusDaEdge(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const status = (data as { status?: unknown }).status;
  return typeof status === "string" ? status : null;
}

/** O aviso do reembolso conta o que o Mercado Pago de fato respondeu: só
 * `concluido` diz "enviado". Sem status legível, não afirma nada. */
function avisarDesfechoDoReembolso(
  status: string | null,
  valor: string,
  estoque: string,
) {
  switch (status) {
    case "concluido":
      toast.success(
        `Devolução concluída. Reembolso de ${valor} enviado ao Mercado Pago.${estoque}`,
      );
      return;
    case "em_processamento":
      toast.info(
        `Devolução concluída. O reembolso de ${valor} está em andamento no Mercado Pago. Acompanhe logo abaixo, nesta devolução.${estoque}`,
      );
      return;
    case "falhou":
      toast.warning(
        `Devolução concluída, mas o Mercado Pago não conseguiu devolver ${valor}. Logo abaixo, nesta devolução, veja a situação do reembolso e, se aparecer o botão Tentar de novo, toque nele.${estoque}`,
        { duration: 15_000 },
      );
      return;
    case "recusado":
      toast.warning(
        `Devolução concluída, mas o Mercado Pago recusou o reembolso de ${valor}. Logo abaixo, nesta devolução, veja a situação do reembolso e, se aparecer o botão Tentar de novo, toque nele.${estoque}`,
        { duration: 15_000 },
      );
      return;
    default:
      toast.info(
        `Devolução concluída. Não consegui confirmar o reembolso de ${valor} agora. Veja a situação logo abaixo, nesta devolução.${estoque}`,
      );
  }
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
  // Começa carregando quando ativo: o primeiro render não pode afirmar
  // "Nenhuma devolução ainda" antes de o efeito disparar a busca.
  const [carregando, setCarregando] = useState(ativo);
  const [erro, setErro] = useState(false);
  const ativoRef = useRef(true);
  const rodadaRef = useRef(0);
  // Offset do SERVIDOR: soma das linhas cruas recebidas. `itens.length` fica
  // menor depois do dedupe e faria "Mostrar mais" repetir a mesma página.
  const [lidas, setLidas] = useState(0);
  const lidasRef = useRef(0);
  // Total visto na última leitura aceita: se ele muda durante o "Mostrar
  // mais", entrou/saiu devolução no servidor e o offset já não aponta onde
  // apontava (a página repete uma linha e a nova nunca seria alcançada).
  const totalRef = useRef(0);
  const chaveRef = useRef(`${status ?? ""}|${busca}`);

  const buscar = useCallback(
    async (offset: number, limite = PAGINA) => {
      const rodada = ++rodadaRef.current;
      const valeAinda = () => ativoRef.current && rodada === rodadaRef.current;
      setCarregando(true);
      try {
        const { data, error } = await aguardarComPrazo(
          Promise.resolve(
            supabase.rpc("admin_devolucoes_listar", {
              p_status: status,
              p_busca: busca.trim() || null,
              p_limite: limite,
              p_offset: offset,
            }),
          ),
          PRAZO_DA_CONSULTA_DO_PAINEL_MS,
          () => erroDeConsultaSemResposta(),
        );
        if (!valeAinda()) return;
        const lista = error ? null : lerListaAdmin(data);
        if (!lista) {
          setErro(true);
          return;
        }
        if (offset > 0 && lista.total !== totalRef.current) {
          // A lista andou sob nós: relê do início, com o que já estava na
          // tela mais uma página, em vez de anexar a um offset deslocado.
          void buscar(0, Math.min(LIMITE_MAXIMO, lidasRef.current + PAGINA));
          return;
        }
        setItens((antes) => {
          if (offset === 0) return lista.itens;
          // Item novo no servidor desloca a paginação: não repete id.
          const vistos = new Set(antes.map((i) => i.id));
          return [...antes, ...lista.itens.filter((i) => !vistos.has(i.id))];
        });
        lidasRef.current =
          offset === 0
            ? lista.itens.length
            : lidasRef.current + lista.itens.length;
        setLidas(lidasRef.current);
        totalRef.current = lista.total;
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
    if (ativo) {
      // Filtro novo: as linhas do filtro anterior não ficam à mostra (nem
      // clicáveis) e o "Mostrar mais" dele não anexaria página errada.
      const chave = `${status ?? ""}|${busca}`;
      if (chave !== chaveRef.current) {
        chaveRef.current = chave;
        setItens([]);
        setTotal(0);
        setLidas(0);
        lidasRef.current = 0;
        totalRef.current = 0;
      }
      // Volta a ativa com a lista paginada: relê tudo, não encolhe a 50.
      void buscar(
        0,
        Math.min(LIMITE_MAXIMO, Math.max(PAGINA, lidasRef.current)),
      );
    }
    return () => {
      ativoRef.current = false;
    };
  }, [ativo, buscar, status, busca]);

  return {
    itens,
    total,
    contagem,
    carregando,
    erro,
    temMais: lidas < total,
    carregarMais: () => void buscar(lidas),
    // Releitura no lugar: mantém o que já foi paginado (até o teto da RPC).
    recarregar: () =>
      void buscar(0, Math.min(LIMITE_MAXIMO, Math.max(PAGINA, lidas))),
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
  | "reprovar"
  | "liberar_vinculo";

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
  /**
   * Achado 1 (rodada 6b, revisão de risco): a "saída" de painel para um
   * vínculo real preso sem código de postagem —
   * `admin_devolucao_liberar_vinculo_reverso` (20261179000000). SEMPRE com
   * `p_conferi_no_melhor_envio: true` — a RPC nega por padrão para qualquer
   * id real, então quem chama aqui já passou pela confirmação explícita no
   * componente (o "Conferi em Meus envios..."); a RPC ainda recusa sozinha
   * se um marcador de pagamento CONFIRMADO existir (sem exceção possível).
   */
  liberarVinculoReverso: () => Promise<boolean>;
  concluir: (args: {
    resolucao: ResolucaoDevolucao;
    itens: InspecaoDoItem[];
    valorReembolso: number | null;
    observacao: string;
  }) => Promise<ResultadoConclusao | null>;
  reprovar: (motivo: string) => Promise<boolean>;
}

/** Renova as fotos antes dos 10 min (600 s) da assinatura vencerem. */
const RENOVAR_FOTOS_MS = 8 * 60 * 1000;

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
  const rodadaRef = useRef(0);

  useEffect(() => {
    idRef.current = id;
    aoMudarRef.current = aoMudar;
  }, [id, aoMudar]);

  const carregar = useCallback(async () => {
    if (!id || idRef.current !== id) return;
    const rodada = ++rodadaRef.current;
    const valeAinda = () =>
      idRef.current === id && rodada === rodadaRef.current;
    setCarregando(true);
    try {
      const { data, error } = await aguardarComPrazo(
        Promise.resolve(supabase.rpc("devolucao_detalhe", { p_id: id })),
        PRAZO_DA_CONSULTA_DO_PAINEL_MS,
        () => erroDeConsultaSemResposta(),
      );
      if (!valeAinda()) return;
      const lida = error ? null : lerDevolucaoDetalhe(data);
      if (!lida) {
        setErro(true);
        return;
      }
      setDetalhe(lida);
      setErro(false);
      const assinadas = await assinarFotos(lida.fotos);
      if (valeAinda()) setFotos(assinadas);
    } catch {
      if (valeAinda()) setErro(true);
    } finally {
      if (valeAinda()) setCarregando(false);
    }
  }, [id]);

  useEffect(() => {
    setDetalhe(null);
    setFotos(new Map());
    setErro(false);
    setCarregando(false);
    if (id) void carregar();
    return () => {
      rodadaRef.current += 1;
    };
  }, [id, carregar]);

  // O endereço assinado vale 10 min (600 s, política da casa): com a ficha
  // aberta por mais tempo, o link e a miniatura da foto da cliente morreriam.
  // Renova SÓ as fotos (sem reler a ficha) a cada 8 min e quando a aba
  // volta ao primeiro plano (o navegador congela o intervalo em aba escondida).
  // Depende do array de caminhos: cada `carregar()` troca o array, o que
  // reinicia o relógio junto com a assinatura recém-feita.
  const caminhosDasFotos = detalhe?.fotos ?? null;
  useEffect(() => {
    if (!caminhosDasFotos || caminhosDasFotos.length === 0) return;
    let ativo = true;
    let renovando = false;
    const renovar = async () => {
      if (renovando) return;
      renovando = true;
      const rodada = rodadaRef.current;
      // Vale enquanto a ficha for a mesma e nenhuma releitura tiver começado.
      const valeAinda = () => ativo && rodada === rodadaRef.current;
      try {
        const novas = await assinarFotos(caminhosDasFotos);
        if (!valeAinda()) return;
        // Falha na renovação não apaga o que já está na tela: mantém o
        // endereço antigo daquele caminho e tenta de novo na próxima.
        setFotos((atuais) => {
          const mescladas = new Map<string, string | null>();
          for (const caminho of caminhosDasFotos) {
            mescladas.set(
              caminho,
              novas.get(caminho) ?? atuais.get(caminho) ?? null,
            );
          }
          return mescladas;
        });
      } finally {
        renovando = false;
      }
    };
    const aoMudarAba = () => {
      if (document.visibilityState === "visible") void renovar();
    };
    const intervalo = setInterval(() => void renovar(), RENOVAR_FOTOS_MS);
    document.addEventListener("visibilitychange", aoMudarAba);
    return () => {
      ativo = false;
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", aoMudarAba);
    };
  }, [caminhosDasFotos]);

  /**
   * Relê a ficha SEM poder prender a trava: a leitura também pode ficar
   * pendurada, e quem espera por ela (a ação em voo) soltaria os botões só
   * depois. O prazo limita a espera; a leitura segue e, se chegar, ainda vale
   * (`carregar` descarta o que ficou velho pela rodada).
   */
  const relerFicha = useCallback(async () => {
    try {
      await aguardarComPrazo(carregar(), PRAZO_DA_RELEITURA_MS, () =>
        erroDeConsultaSemResposta(),
      );
    } catch {
      // Sem resposta: a ficha segue como estava e o aviso da ação já disse
      // para conferir. `carregar` em si nunca rejeita.
    }
  }, [carregar]);

  /** Envelope comum: trava, RPC, aviso, releitura. */
  const executar = useCallback(
    async <T>(
      qual: AcaoEmVoo,
      chamada: () => PromiseLike<{ data: unknown; error: unknown }>,
      ler: (data: unknown) => T | null,
      textoDoPrazo: string = TEXTO_SEM_RESPOSTA_DA_ACAO,
    ): Promise<T | null> => {
      if (emVooRef.current) return null;
      emVooRef.current = true;
      setEmVoo(qual);
      try {
        const { data, error } = await aguardarComPrazo(
          Promise.resolve(chamada()),
          PRAZO_DA_GRAVACAO_MS,
          () => erroDeConsultaSemResposta(),
        );
        if (error) {
          // O servidor escreve valores crus ("R$ 120.00"): vira real brasileiro.
          toast.error(reaisComVirgula(mensagemDoErro(error, ERRO_GENERICO)));
          await relerFicha();
          return null;
        }
        const lido = ler(data);
        if (lido === null) toast.error(ERRO_GENERICO);
        await relerFicha();
        aoMudarRef.current?.();
        pedirRecontagemDoSino();
        return lido;
      } catch (e) {
        if (ehConsultaSemResposta(e)) {
          // A gravação pode ter chegado ao servidor: nunca dizer "não foi
          // feito", nunca repetir sozinho. A trava só solta depois da
          // releitura, para a repetição só ser possível olhando a ficha real.
          // A resposta que chegar tarde foi descartada pelo prazo: não vira
          // aviso de sucesso.
          toast.warning(textoDoPrazo, { duration: 12_000 });
          await relerFicha();
          aoMudarRef.current?.();
          pedirRecontagemDoSino();
          return null;
        }
        toast.error(reaisComVirgula(mensagemDoErro(e, ERRO_GENERICO)));
        return null;
      } finally {
        emVooRef.current = false;
        setEmVoo(null);
      }
    },
    [relerFicha],
  );

  const aprovar = useCallback(
    async ({
      mensagem,
      coletaEm,
    }: {
      mensagem: string;
      coletaEm: string | null;
    }) => {
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
      const { data, error } = await aguardarComPrazo(
        supabase.functions.invoke("melhor-envio-etiqueta", {
          body: { action: "gerar_devolucao_reversa", devolucao_id: id },
        }),
        PRAZO_DA_EDGE_MS,
        () => erroDeConsultaSemResposta(),
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
          await relerFicha();
        } else {
          toast.error(base);
        }
        return false;
      }
      const { codigo_postagem, ja_existia, validade_ate, aviso } =
        resposta.dados;
      // Achado N1 (revisão de risco, rodada 2): "o cliente já vê no pedido"
      // é falso quando o `aviso` diz que a devolução deixou de estar
      // aprovada durante o checkout (achado A1) — o cliente pode nem ver
      // mais a etiqueta na tela dele. Só entra quando não há aviso nenhum.
      toast.success(
        ja_existia
          ? `Este pedido já tinha código de postagem: ${codigo_postagem}.`
          : `Código de postagem gerado: ${codigo_postagem}${validade_ate ? ` (vale até ${formatarDia(validade_ate)})` : ""}.${aviso ? "" : " O cliente já vê no pedido."}`,
      );
      // Achado A2 (revisão de risco de 26/09/2026): a edge nunca devolve
      // `ok: true` mudo — DC-e pendente (R6), código vencido (R8) ou a
      // devolução ter mudado de status durante o checkout (A1) chegam aqui.
      // Antes este campo era lido e descartado; o painel só via o toast de
      // sucesso e o lojista nunca sabia que faltava buscar a DC-e ou avisar
      // o cliente do código vencido.
      if (aviso) toast.warning(aviso, { duration: 15_000 });
      await relerFicha();
      aoMudarRef.current?.();
      return true;
    } catch (e) {
      if (ehConsultaSemResposta(e)) {
        // A compra do código pode ter saído (e ter sido cobrada): a ficha é
        // relida (o código pode ter sido gravado) e o lojista confere antes
        // de repetir. Nunca "não foi feito".
        toast.warning(
          `Sem resposta da rede. Confira na ficha se o código de postagem apareceu. ${AVISO_RESGATE_ETIQUETA}`,
          { duration: 15_000 },
        );
        await relerFicha();
        return false;
      }
      toast.error(mensagemDoErro(e, ERRO_GENERICO));
      return false;
    } finally {
      emVooRef.current = false;
      setEmVoo(null);
    }
  }, [id, relerFicha]);

  const liberarVinculoReverso = useCallback(async () => {
    if (!id) return false;
    // Achado 1 (rodada 6b): SEMPRE `true` — quem chegou até aqui já marcou
    // a confirmação explícita no componente. A RPC nega por padrão qualquer
    // id real sem esse parâmetro (achado 1, rodada 5) e continua recusando
    // sozinha, sem exceção nenhuma, se o marcador de pagamento CONFIRMADO
    // existir (achado R5, rodada 3) — a mensagem dela chega ao toast como
    // veio, sem esconder o motivo.
    const r = await executar(
      "liberar_vinculo",
      () =>
        supabase.rpc("admin_devolucao_liberar_vinculo_reverso", {
          p_id: id,
          p_conferi_no_melhor_envio: true,
        }),
      lerResultadoLiberacaoVinculo,
    );
    if (r) {
      toast.success(
        "Vínculo liberado. A devolução pode ser cancelada, ou uma nova etiqueta pode ser gerada.",
      );
    }
    return r !== null;
  }, [id, executar]);

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
        TEXTO_SEM_RESPOSTA_DA_CONCLUSAO,
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
          const { data, error } = await aguardarComPrazo(
            supabase.functions.invoke("estornar-pagamento", {
              body: { refund_id: r.refund_id },
            }),
            PRAZO_DA_EDGE_MS,
            () => erroDeConsultaSemResposta(),
          );
          if (error) toast.info(TEXTO_REEMBOLSO_NA_FILA + estoque);
          else avisarDesfechoDoReembolso(statusDaEdge(data), valor, estoque);
        } catch (e) {
          if (ehConsultaSemResposta(e)) {
            // O Mercado Pago pode ter devolvido o dinheiro: nada de "não
            // saiu" nem de repetir às cegas. A ficha é relida logo abaixo e
            // mostra a situação real do reembolso.
            toast.info(
              `Devolução concluída. O Mercado Pago não respondeu a tempo: o reembolso de ${valor} pode já ter saído. Veja a situação logo abaixo, nesta devolução, antes de tentar de novo.${estoque}`,
              { duration: 15_000 },
            );
          } else {
            toast.info(TEXTO_REEMBOLSO_NA_FILA + estoque);
          }
        }
        await relerFicha();
      } else if (r.reembolso_manual) {
        toast.warning(
          `Devolução concluída. O reembolso não saiu pelo Mercado Pago: combine com o cliente a devolução de ${valor}, em mãos ou por PIX.${estoque}`,
          { duration: 12_000 },
        );
      } else {
        toast.success(`Devolução concluída.${estoque}`);
      }
      return r;
    },
    [id, executar, relerFicha],
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
    liberarVinculoReverso,
    concluir,
    reprovar,
  };
}
