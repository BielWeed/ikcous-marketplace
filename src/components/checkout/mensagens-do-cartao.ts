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
  | "parcelamento"
  | "desabilitado"
  | "geral";

/**
 * O servidor NÃO devolve o código do motivo ao navegador: `criar-pagamento`
 * traduz o `status_detail` do Mercado Pago para uma FRASE CURADA
 * (`MOTIVOS_DE_RECUSA` em `supabase/functions/_shared/mercadopago.ts`) e só
 * ela viaja em `motivoRecusa`. Desde a rodada de 16/10 a resposta também traz
 * `categoriaDaRecusa` (conjunto fechado, `categoriaDoServidor`); o mapa por
 * frase, por igualdade EXATA, também separa as ações que o servidor ainda
 * agrupa em "outra".
 *
 * Frase que não está aqui (o servidor mudou o texto, ou é um motivo sem
 * categoria própria — banco emissor, segurança, 3DS) cai em "geral".
 * ATENÇÃO: "geral" afirma que nada foi
 * cobrado; isso só é verdade porque hoje o servidor SÓ devolve `recusado`
 * depois de soltar a vaga (recusa definitiva); o front só chega a "geral"
 * quando a categoria do servidor é "outra" ou a frase é desconhecida num
 * servidor antigo. O teste
 * `cartao-redesenho-mensagens.test.ts` lê o arquivo do servidor e reprova se
 * uma destas frases sumir de lá.
 */
export const FRASES_DO_SERVIDOR_POR_CATEGORIA: ReadonlyArray<
  readonly [frase: string, categoria: CategoriaDaRecusa]
> = [
  ["Confira os dados do cartão e tente de novo.", "dados"],
  ["Os dados do cartão expiraram. Digite de novo.", "dados"],
  ["Saldo ou limite insuficiente neste cartão.", "sem-limite"],
  ["Cartão desabilitado. Fale com o seu banco.", "desabilitado"],
  ["Esse parcelamento não está disponível para este cartão.", "parcelamento"],
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

/**
 * A categoria que o SERVIDOR já classificou (`categoriaDaRecusa` na resposta de
 * `criar-pagamento`, conjunto fechado). Valor fora do conjunto (ausente, lixo,
 * servidor antigo) devolve `null`: quem chama cai no mapa por frase. "O banco
 * pediu confirmação" (3DS não concluído) lê-se como o aviso geral.
 */
export function categoriaDoServidor(
  valor: unknown,
  motivo?: unknown,
): CategoriaDaRecusa | null {
  switch (valor) {
    case "dados_do_cartao":
      return "dados";
    case "sem_limite":
      return "sem-limite";
    case "banco_pediu_autorizacao":
      return "autorizacao";
    // "O banco pediu confirmação" (3DS não concluído) fica no aviso geral, que
    // mantém "Tentar outro cartão": mandar a pessoa ao app do banco para tentar o
    // MESMO cartão falharia igual.
    case "banco_pediu_confirmacao":
      return "geral";
    case "outra":
      // O servidor ainda agrupa parcelamento/cartão desabilitado em "outra".
      // Só a frase curada EXATA permite uma orientação mais específica.
      return categoriaDaRecusa(motivo);
    default:
      return null;
  }
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
    "Seu banco precisa autorizar esta compra. Entre em contato com o banco e tente de novo, ou use outro cartão ou PIX.",
  parcelamento:
    "Este parcelamento não está disponível. Escolha menos parcelas ou use outro cartão.",
  desabilitado:
    "Este cartão não aceita compras online; use outro cartão ou PIX",
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
