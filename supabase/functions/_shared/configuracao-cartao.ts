/**
 * Configuração do cartão do lojista — FONTE ÚNICA da regra (plano
 * docs/superpowers/plans/2026-09-30-cartao-de-credito-e-debito.md, T1).
 *
 * POR QUE MORA AQUI E É IMPORTADA PELA TELA: a mesma regra decide duas
 * coisas em dois lugares — o que o Payment Brick OFERECE (tela do cliente) e
 * o que `criar-pagamento` ACEITA (servidor). Duas cópias divergem (#53, a
 * regra de frete grátis que chegou a morar em sete lugares); aqui a
 * divergência seria o Brick oferecer 12x e o servidor recusar, ou o
 * contrário — o servidor aceitar um débito que o lojista desligou. Este
 * arquivo é TypeScript puro, sem import nenhum, para servir aos dois: o Deno
 * das edge functions e o Vite da tela (`src/lib/configuracaoCartao.ts`
 * reexporta daqui).
 *
 * ONDE O VALOR MORA: `app_settings`, linha `key = 'pagamentos_cartao'`,
 * `value` em JSON: `{"credito": true, "debito": true, "parcelas_max": null}`.
 * Linha AUSENTE é o padrão (decisão do dono, 30/09/2026): crédito e débito
 * ligados, parcelas até o máximo que o Mercado Pago oferecer (o app não
 * limita). Linha PRESENTE mas ilegível NÃO vira o padrão — vira recusa
 * (`ok: false`): o padrão libera mais do que um lojista que salvou um limite
 * quis liberar, e a divergência tem de aparecer, não ser engolida.
 *
 * O QUE ESTE ARQUIVO NÃO DECIDE: parcelamento SEM JUROS. Isso é configuração
 * da conta do Mercado Pago do lojista ("Parcelado vendedor") e vale sozinho
 * para o Checkout Transparente — a API não tem campo para isso (medido na
 * central de ajuda do MP em 30/09/2026).
 */

/** Chave da linha em `app_settings`. */
export const CHAVE_CONFIGURACAO_CARTAO = "pagamentos_cartao";

/**
 * Teto de parcelas que o painel oferece. 12 é o máximo que o Mercado Pago
 * oferece no Brasil para cartão de crédito no checkout (e o máximo do
 * "Parcelado vendedor"); a Orders API aceita até 36 no campo, mas oferecer
 * um número que o MP não entrega seria prometer ao lojista o que não existe.
 */
export const PARCELAS_MAXIMO_CONFIGURAVEL = 12;

export type ConfiguracaoCartao = {
  readonly credito: boolean;
  readonly debito: boolean;
  /** `null` = sem limite do app (o máximo que o Mercado Pago oferecer). */
  readonly parcelasMax: number | null;
};

export const CONFIGURACAO_CARTAO_PADRAO: ConfiguracaoCartao = {
  credito: true,
  debito: true,
  parcelasMax: null,
};

export type TipoCartao = "credit_card" | "debit_card";

function ehParcelasValidas(valor: unknown): valor is number {
  return (
    typeof valor === "number" &&
    Number.isInteger(valor) &&
    valor >= 1 &&
    valor <= PARCELAS_MAXIMO_CONFIGURAVEL
  );
}

/**
 * Lê o `value` cru de `app_settings`. `null`/`undefined` (linha ausente) é o
 * padrão; qualquer coisa presente precisa ser um objeto com os TRÊS campos no
 * tipo certo — campo faltando é ilegível, não "usa o padrão daquele campo".
 */
export function lerConfiguracaoCartao(
  valorBruto: string | null | undefined,
): { ok: true; config: ConfiguracaoCartao } | { ok: false } {
  if (valorBruto === null || valorBruto === undefined) {
    return { ok: true, config: CONFIGURACAO_CARTAO_PADRAO };
  }

  let dado: unknown;
  try {
    dado = JSON.parse(valorBruto);
  } catch {
    return { ok: false };
  }
  if (typeof dado !== "object" || dado === null || Array.isArray(dado)) {
    return { ok: false };
  }

  const { credito, debito, parcelas_max } = dado as Record<string, unknown>;
  if (typeof credito !== "boolean" || typeof debito !== "boolean") {
    return { ok: false };
  }
  if (parcelas_max !== null && !ehParcelasValidas(parcelas_max)) {
    return { ok: false };
  }

  return { ok: true, config: { credito, debito, parcelasMax: parcelas_max } };
}

/** O inverso de `lerConfiguracaoCartao` — o que o painel grava. */
export function escreverConfiguracaoCartao(config: ConfiguracaoCartao): string {
  if (config.parcelasMax !== null && !ehParcelasValidas(config.parcelasMax)) {
    throw new Error(
      `escreverConfiguracaoCartao: parcelasMax fora de 1..${PARCELAS_MAXIMO_CONFIGURAVEL}`,
    );
  }
  return JSON.stringify({
    credito: config.credito,
    debito: config.debito,
    parcelas_max: config.parcelasMax,
  });
}

/**
 * Decide se UMA tentativa de pagamento cabe na configuração. Devolve a
 * mensagem para o cliente quando não cabe — texto curado, nunca do gateway.
 *
 * Débito é SEMPRE à vista: parcela de débito não existe, e um `installments`
 * maior que 1 num débito só chega aqui por corpo adulterado.
 */
export function tentativaCabeNaConfiguracao(
  config: ConfiguracaoCartao,
  tipo: TipoCartao,
  parcelas: number,
): { ok: true } | { ok: false; motivo: string } {
  if (!Number.isInteger(parcelas) || parcelas < 1) {
    return { ok: false, motivo: "Número de parcelas inválido." };
  }
  if (tipo === "debit_card") {
    if (!config.debito) {
      return { ok: false, motivo: "Esta loja não aceita cartão de débito." };
    }
    if (parcelas !== 1) {
      return { ok: false, motivo: "Cartão de débito é só à vista." };
    }
    return { ok: true };
  }
  if (!config.credito) {
    return { ok: false, motivo: "Esta loja não aceita cartão de crédito." };
  }
  if (config.parcelasMax !== null && parcelas > config.parcelasMax) {
    return {
      ok: false,
      motivo: `Esta loja parcela em até ${config.parcelasMax}x.`,
    };
  }
  return { ok: true };
}

/** Se o Brick deve oferecer algum cartão. */
export function aceitaAlgumCartao(config: ConfiguracaoCartao): boolean {
  return config.credito || config.debito;
}
