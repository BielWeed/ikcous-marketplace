/**
 * Frases e categorias da tela do cartão (redesenho de 16/10/2026).
 *
 * Tudo aqui é PURO (sem React, sem DOM): a tela só escolhe uma categoria e
 * mostra a frase curada dela. Nada do que o Mercado Pago mandou chega ao
 * cliente — nem o texto cru, nem as palavras "antifraude" ou "high_risk".
 */

/** Por que o banco disse não (a categoria que a tela sabe separar). */
export type CategoriaDaRecusa =
  | "dados"
  | "sem-limite"
  | "autorizacao"
  | "geral";

/**
 * O servidor NÃO devolve o código do motivo ao navegador: `criar-pagamento`
 * traduz o `status_detail` do Mercado Pago para uma FRASE CURADA
 * (`MOTIVOS_DE_RECUSA` em `supabase/functions/_shared/mercadopago.ts`) e só
 * ela viaja em `motivoRecusa`. A categoria sai da frase, por igualdade EXATA
 * — a única informação que existe do lado de cá.
 *
 * Frase que não está aqui (o servidor mudou o texto, ou é um motivo sem
 * categoria própria — banco emissor, cartão desabilitado, parcelamento,
 * segurança, 3DS) cai em "geral". ATENÇÃO: "geral" afirma que nada foi
 * cobrado; isso só é verdade porque hoje o servidor SÓ devolve `recusado`
 * depois de soltar a vaga (recusa definitiva). Ao adotar `categoriaDaRecusa`
 * no front, essa frase deve depender de prova de recusa definitiva, não de a
 * frase ser desconhecida. O teste
 * `cartao-redesenho-mensagens.test.ts` lê o arquivo do servidor e reprova se
 * uma destas frases sumir de lá.
 */
export const FRASES_DO_SERVIDOR_POR_CATEGORIA: ReadonlyArray<
  readonly [frase: string, categoria: CategoriaDaRecusa]
> = [
  ["Confira os dados do cartão e tente de novo.", "dados"],
  ["Os dados do cartão expiraram. Digite de novo.", "dados"],
  ["Saldo ou limite insuficiente neste cartão.", "sem-limite"],
  [
    "Seu banco pede autorização: ligue para ele e tente de novo.",
    "autorizacao",
  ],
];

const CATEGORIA_POR_FRASE: ReadonlyMap<string, CategoriaDaRecusa> = new Map(
  FRASES_DO_SERVIDOR_POR_CATEGORIA,
);

export function categoriaDaRecusa(motivo: unknown): CategoriaDaRecusa {
  const frase = typeof motivo === "string" ? motivo.trim() : "";
  return CATEGORIA_POR_FRASE.get(frase) ?? "geral";
}

/** As frases que o cliente lê — uma por categoria, em português de gente. */
export const TEXTOS_DO_CARTAO = {
  titulo: "Pagamento com cartão",
  total: "Total",
  juros:
    "No parcelado, o cartão pode cobrar juros a partir de 2x. O valor de cada parcela e o total aparecem na escolha das parcelas.",
  confianca:
    "Pagamento processado pelo Mercado Pago. A loja não vê nem guarda os dados do seu cartão.",
  carregando: "Carregando o formulário do cartão...",
  dados: "Confira os dados do cartão",
  semLimite: "O cartão não tem limite para este valor",
  autorizacao:
    "Seu banco pediu autorização. Abra o app do banco e tente de novo",
  recusaGeral:
    "Não conseguimos concluir este pagamento. Nenhum valor foi cobrado",
  cargaFalhou: "Não foi possível carregar o formulário do cartão",
  emAnalise:
    "Seu banco está analisando. Não pague de novo. Avisamos aqui e por notificação",
  confirmacaoDoBanco: "Seu banco pediu uma confirmação",
  horarioPassou: "O horário previsto para pagar já passou.",
  horarioPassouDetalhe:
    "Se você já pagou, continue nesta tela: a confirmação aparece aqui.",
} as const;

/**
 * O prazo da reserva, do mesmo jeito que o PIX lê (`PagamentoOnline.tsx`): o
 * Postgres devolve de 1 a 6 dígitos de fração e o `Date.parse` interoperável
 * quer 3 — completar/truncar preserva o instante e o fuso. Ilegível = `null`
 * (nunca inventa horário).
 */
export function lerPrazoEmMs(expiraEm: unknown): number | null {
  if (typeof expiraEm !== "string" || expiraEm.trim() === "") return null;
  const ms = Date.parse(
    expiraEm.replace(
      /\.(\d+)(?=Z$|[+-]\d{2}:\d{2}$)/i,
      (_, fracao: string) => `.${fracao.padEnd(3, "0").slice(0, 3)}`,
    ),
  );
  return Number.isFinite(ms) ? ms : null;
}

export function formatarHoraDoPrazo(ms: number): string {
  return new Date(ms).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
