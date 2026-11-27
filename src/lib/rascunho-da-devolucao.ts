// O RASCUNHO DO PEDIDO DE DEVOLUÇÃO/TROCA — a aba descartada não leva junto.
//
// O DEFEITO: no celular, tocar em "Adicionar" foto abre a câmera ou a galeria e
// a aba vai para segundo plano. Android e iPhone descartam a aba quando falta
// memória; ao voltar ela RECARREGA, a folha nascia fechada e itens marcados,
// motivo, texto, solução e forma de devolver sumiam — justamente no passo em
// que a cliente estava anexando a prova do defeito.
//
// POR QUE sessionStorage: é da ABA. Sobrevive ao recarregar (inclusive o da aba
// descartada que volta), morre ao fechar a aba. Mesmo motivo do rascunho do
// checkout (src/lib/rascunho-do-checkout.ts).
//
// O QUE ENTRA: só o que a cliente vê na folha (passo, itens e quantidades,
// motivo, texto, solução, forma de devolver) e QUANTAS fotos havia, para pedir
// que escolha de novo. Nunca a foto, o nome do arquivo, a prévia ou o caminho
// no bucket.
//
// DE QUEM É: a chave leva a conta e o pedido, e o valor repete os dois — a
// leitura confere e ignora o rascunho de outra conta ou de outro pedido (outra
// caça achou um sessionStorage que mostrava o resumo da pessoa anterior na
// mesma aba). Vale por VALIDADE_MS; vencido, a leitura apaga.
//
// O armazenamento é injetado (ArmazenamentoSimples): a folha passa
// `sessionStorageSeguro()`, que nunca lança. Tudo aqui é melhor esforço: o
// pedido de devolução nunca depende do rascunho.

import type {
  MetodoDevolucao,
  MotivoDevolucao,
  ResolucaoDevolucao,
} from "@/types/devolucao";
import type { ArmazenamentoSimples } from "./chave-do-pedido";
import {
  GRUPOS_DE_MOTIVO,
  MAXIMO_DE_FOTOS,
  METODOS_LOCAIS,
  METODOS_NACIONAIS,
} from "./devolucao";
import { PREFIXO_DO_RASCUNHO_DA_DEVOLUCAO as PREFIXO } from "./limpar-rascunhos-da-devolucao";

// Escolher as fotos leva minutos; duas horas cobrem a volta e não deixam um
// rascunho esquecido reabrindo a folha no dia seguinte (mesma régua do
// rascunho do checkout).
const VALIDADE_MS = 2 * 60 * 60 * 1000;
const MAXIMO_DO_TEXTO = 1000;

const MOTIVOS: readonly string[] = GRUPOS_DE_MOTIVO.flatMap((g) => g.motivos);
const RESOLUCOES: readonly string[] = ["reembolso", "troca", "vale"];
const METODOS: readonly string[] = [...METODOS_LOCAIS, ...METODOS_NACIONAIS];

export type PassoDoRascunho = 1 | 2 | 3 | 4;

export interface RascunhoDaDevolucao {
  passo: PassoDoRascunho;
  /** `[order_item_id, quantidade]`, só quantidades positivas. */
  itens: Array<[string, number]>;
  motivo: MotivoDevolucao | null;
  detalhe: string;
  resolucao: ResolucaoDevolucao | null;
  metodo: MetodoDevolucao | null;
  /** Quantas fotos estavam escolhidas (elas mesmas não são guardadas). */
  fotos: number;
}

interface Guardado extends RascunhoDaDevolucao {
  conta: string;
  pedido: string;
  salvoEm: number;
}

const chaveDe = (conta: string, pedido: string) =>
  `${PREFIXO}${conta}:${pedido}`;

function umDe<T extends string>(
  lista: readonly string[],
  valor: unknown,
): T | null {
  return typeof valor === "string" && lista.includes(valor)
    ? (valor as T)
    : null;
}

function lerItens(valor: unknown): Array<[string, number]> {
  if (!Array.isArray(valor)) return [];
  const saida: Array<[string, number]> = [];
  for (const par of valor.slice(0, 200)) {
    if (!Array.isArray(par)) continue;
    const [id, qtd] = par;
    if (typeof id !== "string" || id === "") continue;
    if (!Number.isSafeInteger(qtd) || qtd <= 0) continue;
    saida.push([id, qtd]);
  }
  return saida;
}

export function salvarRascunhoDaDevolucao(
  armazenamento: ArmazenamentoSimples,
  conta: string,
  pedido: string,
  rascunho: RascunhoDaDevolucao,
): void {
  if (!conta || !pedido) return;
  try {
    const guardado: Guardado = {
      conta,
      pedido,
      salvoEm: Date.now(),
      passo: rascunho.passo,
      itens: rascunho.itens.filter(([, qtd]) => qtd > 0),
      motivo: rascunho.motivo,
      detalhe: rascunho.detalhe.slice(0, MAXIMO_DO_TEXTO),
      resolucao: rascunho.resolucao,
      metodo: rascunho.metodo,
      fotos: Math.min(Math.max(0, rascunho.fotos), MAXIMO_DE_FOTOS),
    };
    armazenamento.setItem(chaveDe(conta, pedido), JSON.stringify(guardado));
  } catch {
    // Melhor esforço: sem rascunho, a folha só não volta preenchida.
  }
}

/**
 * O rascunho DESTA conta para ESTE pedido, ou `null`. Ilegível ou vencido é
 * apagado; o de outra conta/pedido (mesmo adulterado para esta chave) é
 * ignorado.
 */
export function lerRascunhoDaDevolucao(
  armazenamento: ArmazenamentoSimples,
  conta: string,
  pedido: string,
): RascunhoDaDevolucao | null {
  if (!conta || !pedido) return null;
  const chave = chaveDe(conta, pedido);
  try {
    const cru = armazenamento.getItem(chave);
    if (!cru) return null;
    const v: unknown = JSON.parse(cru);
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
      armazenamento.removeItem(chave);
      return null;
    }
    const d = v as Record<string, unknown>;
    if (d.conta !== conta || d.pedido !== pedido) return null;
    const salvoEm = d.salvoEm;
    const idade =
      typeof salvoEm === "number" && Number.isFinite(salvoEm)
        ? Date.now() - salvoEm
        : Number.NaN;
    if (!(idade >= 0 && idade <= VALIDADE_MS)) {
      armazenamento.removeItem(chave);
      return null;
    }
    const passo = d.passo;
    const fotos = d.fotos;
    return {
      passo:
        passo === 1 || passo === 2 || passo === 3 || passo === 4 ? passo : 1,
      itens: lerItens(d.itens),
      motivo: umDe<MotivoDevolucao>(MOTIVOS, d.motivo),
      detalhe:
        typeof d.detalhe === "string"
          ? d.detalhe.slice(0, MAXIMO_DO_TEXTO)
          : "",
      resolucao: umDe<ResolucaoDevolucao>(RESOLUCOES, d.resolucao),
      metodo: umDe<MetodoDevolucao>(METODOS, d.metodo),
      fotos:
        Number.isSafeInteger(fotos) && (fotos as number) > 0
          ? Math.min(fotos as number, MAXIMO_DE_FOTOS)
          : 0,
    };
  } catch {
    try {
      armazenamento.removeItem(chave);
    } catch {
      // idem acima
    }
    return null;
  }
}

/** No envio aceito e no "Descartar": o rascunho deste pedido não volta. */
export function limparRascunhoDaDevolucao(
  armazenamento: ArmazenamentoSimples,
  conta: string,
  pedido: string,
): void {
  if (!conta || !pedido) return;
  try {
    armazenamento.removeItem(chaveDe(conta, pedido));
  } catch {
    // idem acima
  }
}

// No "Sair": todos os rascunhos da aba. Mora num módulo pequeno para o
// AuthContext não carregar `devolucao.ts` (ver o arquivo).
export { limparTodosOsRascunhosDaDevolucao } from "./limpar-rascunhos-da-devolucao";
