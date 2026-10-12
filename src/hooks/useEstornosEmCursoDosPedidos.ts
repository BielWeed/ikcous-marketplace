import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";

/**
 * L3e' (lacunas de pagamento, 02/10/2026): o balde "Devolver agora" pedia ao
 * lojista o TOTAL do pedido mesmo quando o próprio app já tinha pedido o
 * estorno ao Mercado Pago — cancelar um pedido pago que ainda não saiu grava
 * a linha `solicitado` em `order_refunds` na mesma transação, e o cron
 * `reconciliar-pagamentos` a executa em alguns minutos. Quem lia "devolver
 * R$ 100" e devolvia por fora pagava o cliente duas vezes.
 *
 * Este hook só LÊ o que já existe: as linhas `solicitado`/`em_processamento`/
 * `concluido` de `order_refunds` dos pedidos da lista — a mesma tabela e o
 * mesmo vocabulário de `useEstornosDoPedido` (o card de UM pedido), com a
 * mesma permissão (RLS `order_refunds_admin_all`, a mesma régua `is_admin()`
 * da RPC que monta a lista). Nenhuma RPC nova, nenhuma escrita.
 *
 * Por que `concluido` também (rodada 2, revisão financeira): a linha que
 * conclui some do "em curso", mas `valor_estornado`/`payment_status` do
 * pedido na lista só mudam quando a lista recarrega (realtime). Sem ler a
 * concluída, um realtime perdido fazia a lista voltar a pedir o total sem
 * aviso nenhum — o mesmo PIX em dobro. A tela desconta
 * `max(0, Σconcluido − valorEstornado)`: `concluir_estorno`
 * (2026110000100) é o ÚNICO caminho que soma em `valor_estornado`, e soma
 * cada linha concluída exatamente uma vez.
 *
 * Três respostas por pedido, de propósito — "não sei" nunca vira "nada em
 * curso" calado (o fallback que protege é o mesmo que esconde):
 *   - `conferindo`: a primeira leitura deste pedido ainda não voltou;
 *   - `nao_conferido`: a leitura falhou;
 *   - `conferido`: os valores, em reais (0 = nenhum).
 *
 * SEM REALTIME (mesmo motivo de `useEstornosDoPedido`: `order_refunds` não
 * está na publication). No lugar (rodada 4, "a leitura velha"):
 *   - a CHAVE da leitura é `id:valorEstornado` de cada pedido, não só o id.
 *     Quando a lista recarrega e o `valorEstornado` de um pedido muda, a
 *     leitura antiga deixa de valer PARA ELE (volta a "conferindo") e uma
 *     nova sai sozinha — o retrato misturado ("30 estornado" da lista + "30
 *     em curso" da leitura velha = R$ 40) não chega a existir na tela. Mais
 *     robusto que reler na mudança de identidade da lista: não é uma corrida
 *     entre a releitura e o render, é um estado que não se representa;
 *   - `recarregar()`: quem mostra a lista relê ao ABRIR o painel — devolução
 *     que começa num pedido que já estava na lista (card "Devolver", outro
 *     admin) não muda `marketplace_orders`, então não há realtime nem chave
 *     nova que a denuncie;
 *   - `conferirAgora(id)`: leitura FRESCA de um pedido só, para o ponto de
 *     DECISÃO ("Já estornei"), com prazo de 8 s (passou = "não conferido",
 *     nunca um botão preso);
 *   - relê a cada 15s só ENQUANTO houver devolução em curso que ainda pode
 *     andar (linha travada não conta) ou a última leitura tiver falhado — e
 *     só com a tela ativa.
 */
export type EstornoEmCurso =
  | { tipo: "conferindo" }
  | { tipo: "nao_conferido" }
  | {
      tipo: "conferido";
      /** Tudo que está em curso (= pedidoPeloApp + sistema + semConfirmacao). */
      emCurso: number;
      /** Em curso, pedido pelo app (cancelamento, "Devolver", devolução). */
      pedidoPeloApp: number;
      /** Em curso, aberto pelo próprio Mercado Pago (`solicitado_por =
       * 'sistema'`, ex.: contestação em análise) — o app não pediu nada. */
      sistema: number;
      /** `em_processamento` com 5+ tentativas: o cron só consulta, nunca mais
       * posta (reconciliar-pagamentos, `tentativasAtuais >= 5`). */
      semConfirmacao: number;
      /** Soma das linhas `concluido` (já devolvido pelo Mercado Pago). */
      concluido: number;
    };

const ESTADOS_EM_CURSO = ["solicitado", "em_processamento"] as const;
const ESTADOS_LIDOS = [...ESTADOS_EM_CURSO, "concluido"] as const;

/** O mesmo teto do cron: `if (tentativasAtuais >= 5)` em
 * supabase/functions/reconciliar-pagamentos/index.ts (o ramo que grava
 * `TEXTO_LIMITE_DE_TENTATIVAS` e para de postar). */
const TENTATIVAS_SEM_CONFIRMACAO = 5;

const INTERVALO_DE_RECARGA_MS = 15_000;

// Limite de ids por consulta: o filtro `in` vai na URL do PostgREST — 100
// uuids (~3,7 KB) cabem com folga em qualquer proxy.
const IDS_POR_CONSULTA = 100;

// Dinheiro sempre em CENTAVOS inteiros antes de somar (mesma régua de
// `useEstornosDoPedido`): `0.1 + 0.2` em ponto flutuante não é `0.3`.
const paraCentavos = (valor: number) => Math.round(valor * 100);

interface LinhaDoLedger {
  order_id: string;
  amount: number;
  status: string;
  solicitado_por: string | null;
  tentativas: number | null;
}

interface CentavosDoPedido {
  pedidoPeloApp: number;
  sistema: number;
  semConfirmacao: number;
  concluido: number;
}

const ZERADO: CentavosDoPedido = {
  pedidoPeloApp: 0,
  sistema: 0,
  semConfirmacao: 0,
  concluido: 0,
};

interface Leitura {
  /** As chaves `id:valorEstornado` que ESTA leitura cobriu. */
  chaves: ReadonlySet<string>;
  /** Centavos por pedido (só os com alguma linha); `null` = falhou. */
  porPedido: ReadonlyMap<string, CentavosDoPedido> | null;
}

function mesmosCentavos(a: CentavosDoPedido, b: CentavosDoPedido) {
  return (
    a.pedidoPeloApp === b.pedidoPeloApp &&
    a.sistema === b.sistema &&
    a.semConfirmacao === b.semConfirmacao &&
    a.concluido === b.concluido
  );
}

function mesmaLeitura(a: Leitura | null, b: Leitura): boolean {
  if (!a || a.chaves.size !== b.chaves.size) return false;
  for (const chave of b.chaves) if (!a.chaves.has(chave)) return false;
  if (a.porPedido === null || b.porPedido === null) {
    return a.porPedido === b.porPedido;
  }
  if (a.porPedido.size !== b.porPedido.size) return false;
  for (const [id, centavos] of b.porPedido) {
    const antes = a.porPedido.get(id);
    if (!antes || !mesmosCentavos(antes, centavos)) return false;
  }
  return true;
}

function somarLinhas(
  linhas: readonly LinhaDoLedger[],
  cobertos: ReadonlySet<string>,
): Map<string, CentavosDoPedido> {
  const porPedido = new Map<string, CentavosDoPedido>();
  for (const linha of linhas) {
    // Filtros repetidos aqui de propósito: o que decide "em curso" é esta
    // tela, não a confiança de que o servidor filtrou.
    if (!cobertos.has(linha.order_id)) continue;
    const centavos = paraCentavos(Number(linha.amount) || 0);
    if (centavos <= 0) continue;
    const atual = { ...(porPedido.get(linha.order_id) ?? ZERADO) };
    if (linha.status === "concluido") {
      atual.concluido += centavos;
    } else if ((ESTADOS_EM_CURSO as readonly string[]).includes(linha.status)) {
      if (
        linha.status === "em_processamento" &&
        (Number(linha.tentativas) || 0) >= TENTATIVAS_SEM_CONFIRMACAO
      ) {
        atual.semConfirmacao += centavos;
      } else if (linha.solicitado_por === "sistema") {
        atual.sistema += centavos;
      } else {
        atual.pedidoPeloApp += centavos;
      }
    } else {
      continue;
    }
    porPedido.set(linha.order_id, atual);
  }
  return porPedido;
}

/** Lê o ledger dos pedidos; `null` = a leitura falhou (erro ou exceção). */
async function lerLedger(
  ids: readonly string[],
): Promise<Map<string, CentavosDoPedido> | null> {
  try {
    const lotes: string[][] = [];
    for (let i = 0; i < ids.length; i += IDS_POR_CONSULTA) {
      lotes.push(ids.slice(i, i + IDS_POR_CONSULTA));
    }
    const respostas = await Promise.all(
      lotes.map((lote) =>
        supabase
          .from("order_refunds")
          .select("order_id, amount, status, solicitado_por, tentativas")
          .in("order_id", lote)
          .in("status", [...ESTADOS_LIDOS]),
      ),
    );
    if (respostas.some((resposta) => resposta.error)) return null;
    const linhas = respostas.flatMap(
      (resposta) => (resposta.data ?? []) as LinhaDoLedger[],
    );
    return somarLinhas(linhas, new Set(ids));
  } catch {
    return null;
  }
}

function paraSituacao(c: CentavosDoPedido): EstornoEmCurso {
  return {
    tipo: "conferido",
    emCurso: (c.pedidoPeloApp + c.sistema + c.semConfirmacao) / 100,
    pedidoPeloApp: c.pedidoPeloApp / 100,
    sistema: c.sistema / 100,
    semConfirmacao: c.semConfirmacao / 100,
    concluido: c.concluido / 100,
  };
}

/** Prazo da leitura fresca do "Já estornei": passou, vira "não conferido". */
const PRAZO_DA_CONFERENCIA_MS = 8_000;

interface PedidoDaLeitura {
  readonly id: string;
  readonly valorEstornado?: number | null;
}

interface EstornosDosPedidos {
  porPedido: ReadonlyMap<string, EstornoEmCurso>;
  /** Relê a lista inteira agora (ex.: ao abrir o painel). */
  recarregar: () => void;
  /** Leitura FRESCA de um pedido só, para o ponto de decisão. */
  conferirAgora: (orderId: string) => Promise<EstornoEmCurso>;
}

export function useEstornosEmCursoDosPedidos(
  pedidos: readonly PedidoDaLeitura[],
  { ativo = true }: { ativo?: boolean } = {},
): EstornosDosPedidos {
  // A identidade do array muda a cada render do chamador; a CHAVE só muda
  // quando o conjunto de pedidos — ou o `valorEstornado` de algum — muda.
  const chave = [
    ...new Set(
      pedidos.map(
        (pedido) => `${pedido.id}:${paraCentavos(pedido.valorEstornado ?? 0)}`,
      ),
    ),
  ]
    .sort()
    .join(",");
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const ativoRef = useRef(true);
  // Só a resposta do voo MAIS RECENTE vale: uma releitura lenta da lista
  // antiga não pode sobrescrever a da lista nova.
  const vooRef = useRef(0);

  const carregar = useCallback(async () => {
    const chaves = chave === "" ? [] : chave.split(",");
    if (chaves.length === 0) return;
    const voo = ++vooRef.current;
    const ids = [...new Set(chaves.map((c) => c.slice(0, c.lastIndexOf(":"))))];
    const porPedido = await lerLedger(ids);
    if (!ativoRef.current || voo !== vooRef.current) return;
    const nova: Leitura = { chaves: new Set(chaves), porPedido };
    // Releitura igual à anterior não re-renderiza a tela de pedidos.
    setLeitura((antes) => (mesmaLeitura(antes, nova) ? antes : nova));
  }, [chave]);

  useEffect(() => {
    ativoRef.current = true;
    void carregar();
    return () => {
      ativoRef.current = false;
    };
  }, [carregar]);

  const recarregar = useCallback(() => {
    void carregar();
  }, [carregar]);

  const conferirAgora = useCallback(
    async (orderId: string): Promise<EstornoEmCurso> => {
      let prazo: ReturnType<typeof setTimeout> | undefined;
      const estourou = new Promise<"prazo">((resolve) => {
        prazo = setTimeout(() => resolve("prazo"), PRAZO_DA_CONFERENCIA_MS);
      });
      try {
        const resultado = await Promise.race([lerLedger([orderId]), estourou]);
        if (resultado === "prazo" || resultado === null) {
          return { tipo: "nao_conferido" };
        }
        return paraSituacao(resultado.get(orderId) ?? ZERADO);
      } finally {
        clearTimeout(prazo);
      }
    },
    [],
  );

  // Relê só o que ainda pode mudar sozinho: devolução em curso que o cron
  // ainda movimenta (linha travada com 5+ tentativas não segura o
  // intervalo), ou uma leitura que falhou. Lista vazia ou tela inativa:
  // nenhum intervalo.
  let precisaReler = false;
  if (ativo && chave !== "" && leitura !== null) {
    if (leitura.porPedido === null) {
      precisaReler = true;
    } else {
      for (const centavos of leitura.porPedido.values()) {
        if (centavos.pedidoPeloApp > 0 || centavos.sistema > 0) {
          precisaReler = true;
          break;
        }
      }
    }
  }

  useEffect(() => {
    if (!precisaReler) return;
    const id = setInterval(() => {
      void carregar();
    }, INTERVALO_DE_RECARGA_MS);
    return () => clearInterval(id);
  }, [precisaReler, carregar]);

  const porPedido = useMemo(() => {
    const mapa = new Map<string, EstornoEmCurso>();
    if (chave === "") return mapa;
    for (const entrada of chave.split(",")) {
      const id = entrada.slice(0, entrada.lastIndexOf(":"));
      if (!leitura || !leitura.chaves.has(entrada)) {
        mapa.set(id, { tipo: "conferindo" });
      } else if (leitura.porPedido === null) {
        mapa.set(id, { tipo: "nao_conferido" });
      } else {
        mapa.set(id, paraSituacao(leitura.porPedido.get(id) ?? ZERADO));
      }
    }
    return mapa;
  }, [chave, leitura]);

  return useMemo(
    () => ({ porPedido, recarregar, conferirAgora }),
    [porPedido, recarregar, conferirAgora],
  );
}
