/**
 * CARTÃO PELO APP (Fase 3.5, 26/09/2026 — spec
 * `docs/superpowers/specs/2026-09-26-cartao-online-design.md`, contrato em
 * `docs/superpowers/plans/2026-09-26-painel-cartao-e-devolucoes.md`, seção
 * "Cartão online").
 *
 * A linha única `config_pagamento_cartao` (id = 1, leitura pública) diz se a
 * loja aceita crédito, débito e em quantas parcelas no máximo. Nasce
 * DESLIGADA (crédito e débito `false`): o app envia `COEP: credentialless` e o
 * Card Payment Brick monta iframes do Mercado Pago que ainda não foram
 * provados sob esse cabeçalho — a lojista liga depois de pagar um pedido de
 * teste.
 *
 * Tudo aqui FALHA FECHADO: erro de rede, linha ausente ou campo com tipo
 * estranho viram "cartão desligado". Cartão escondido por engano custa uma
 * venda que ainda pode sair por PIX; cartão oferecido por engano manda o
 * cliente para um formulário que a loja não pediu.
 */
import { supabase } from "@/lib/supabase";

/** Os dois tipos que o Brick entende em `paymentMethods.types.included`. */
export type TipoDeCartao = "credit_card" | "debit_card";

export interface ConfigDoCartao {
  readonly credito: boolean;
  readonly debito: boolean;
  /** Teto de parcelas escolhido pela lojista — inteiro de 1 a 12. */
  readonly parcelasMax: number;
}

/** Teto do select "Parcelar em até" e do CHECK da coluna `parcelas_max`. */
export const PARCELAS_MAX_TETO = 12;

export const CONFIG_DO_CARTAO_DESLIGADA: ConfigDoCartao = Object.freeze({
  credito: false,
  debito: false,
  parcelasMax: 1,
});

function parcelasValidas(valor: unknown): valor is number {
  return (
    typeof valor === "number" &&
    Number.isInteger(valor) &&
    valor >= 1 &&
    valor <= PARCELAS_MAX_TETO
  );
}

/**
 * Traduz a linha do banco (ou o `jsonb` que a RPC de salvar devolve) para a
 * forma do front. Só o booleano `true` LITERAL liga um tipo — `"true"`, `1`
 * ou ausente ficam desligados. Parcelas fora de 1..12 caem em 1 (à vista).
 */
export function normalizarConfigDoCartao(linha: unknown): ConfigDoCartao {
  if (!linha || typeof linha !== "object") return CONFIG_DO_CARTAO_DESLIGADA;
  const campos = linha as Record<string, unknown>;
  return {
    credito: campos.credito === true,
    debito: campos.debito === true,
    parcelasMax: parcelasValidas(campos.parcelas_max) ? campos.parcelas_max : 1,
  };
}

/** A loja aceita ao menos um tipo de cartão pelo app. */
export function cartaoLigado(config: ConfigDoCartao): boolean {
  return config.credito || config.debito;
}

/** Os tipos que o Brick deve aceitar — nunca um que a loja desligou. */
export function tiposDeCartaoAceitos(config: ConfigDoCartao): TipoDeCartao[] {
  const tipos: TipoDeCartao[] = [];
  if (config.credito) tipos.push("credit_card");
  if (config.debito) tipos.push("debit_card");
  return tipos;
}

/**
 * Parcelas que o Brick oferece: o teto da lojista no crédito; débito é
 * sempre à vista.
 */
export function parcelasMaximasNoBrick(config: ConfigDoCartao): number {
  return config.credito ? config.parcelasMax : 1;
}

/** O rótulo da opção no checkout diz só o que a loja aceita de verdade. */
export function rotuloDaOpcaoDeCartao(config: ConfigDoCartao): string {
  if (config.credito && config.debito) return "Cartão de crédito ou débito";
  if (config.credito) return "Cartão de crédito";
  return "Cartão de débito";
}

export type LeituraDaConfigDoCartao =
  | { readonly ok: true; readonly config: ConfigDoCartao }
  | { readonly ok: false };

/**
 * Lê a linha AGORA, sem cache — é o que o painel usa para mostrar os
 * interruptores. `ok: false` quando a leitura falhou (o painel diz que não
 * conseguiu ler em vez de fingir "desligado").
 */
export async function buscarConfigDoCartao(): Promise<LeituraDaConfigDoCartao> {
  try {
    const { data, error } = await supabase
      .from("config_pagamento_cartao")
      .select("credito,debito,parcelas_max")
      .eq("id", 1)
      .maybeSingle();
    if (error) {
      console.warn("[config-do-cartao] leitura falhou:", error.message);
      return { ok: false };
    }
    // Linha ausente é "desligado" legítimo (loja sem a migration aplicada
    // ainda, ou linha apagada) — não é falha de leitura.
    return { ok: true, config: normalizarConfigDoCartao(data) };
  } catch (erro) {
    console.warn("[config-do-cartao] leitura falhou:", erro);
    return { ok: false };
  }
}

/**
 * Validade do cache do checkout — o mesmo "até 1 minuto" que a vitrine já
 * promete para o interruptor do PIX (cache fresco do porteiro). A lojista que
 * desliga o cartão no painel não espera um recarregamento de cada cliente; e
 * a trava de verdade é do servidor (`criar-pagamento` confere a mesma linha).
 */
const VALIDADE_DO_CACHE_MS = 60_000;

let cache: {
  readonly promessa: Promise<ConfigDoCartao>;
  readonly lidoEm: number;
} | null = null;

/**
 * A config para o CHECKOUT: com cache de módulo (a tela de pagamento remonta
 * sem pagar outra ida ao banco) e falha fechada — erro devolve
 * `CONFIG_DO_CARTAO_DESLIGADA` e NÃO fica em cache, para a próxima montagem
 * tentar de novo.
 */
export function lerConfigDoCartao(): Promise<ConfigDoCartao> {
  const agora = Date.now();
  if (cache && agora - cache.lidoEm < VALIDADE_DO_CACHE_MS) {
    return cache.promessa;
  }
  const promessa = buscarConfigDoCartao().then((leitura) => {
    if (leitura.ok) return leitura.config;
    if (cache?.promessa === promessa) cache = null;
    return CONFIG_DO_CARTAO_DESLIGADA;
  });
  cache = { promessa, lidoEm: agora };
  return promessa;
}

/** Descarta o cache — depois de o painel salvar, e entre testes. */
export function esquecerConfigDoCartao(): void {
  cache = null;
}

/**
 * Grava pela RPC de admin (`salvar_config_pagamento_cartao`, SECURITY
 * DEFINER com gate `is_admin()`) e devolve a linha GRAVADA — o painel mostra
 * o que o banco confirmou, nunca o que o clique pediu. Lança em qualquer
 * falha; a mensagem é curada aqui (o texto cru do Postgres fica no console).
 */
export async function salvarConfigDoCartao(
  desejada: ConfigDoCartao,
): Promise<ConfigDoCartao> {
  const { data, error } = await supabase.rpc("salvar_config_pagamento_cartao", {
    p_credito: desejada.credito,
    p_debito: desejada.debito,
    p_parcelas_max: desejada.parcelasMax,
  });
  if (error) {
    console.error("[config-do-cartao] salvar falhou:", error);
    throw new Error(
      error.code === "42501"
        ? "Só o administrador da loja pode mudar o cartão pelo app."
        : "Não foi possível salvar o cartão pelo app. Tente de novo.",
    );
  }
  esquecerConfigDoCartao();
  return normalizarConfigDoCartao(data);
}
