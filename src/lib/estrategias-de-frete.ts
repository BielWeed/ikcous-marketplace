/**
 * ESTRATÉGIAS DE FRETE — LOCAL e NACIONAL (23/09/2026, plano
 * docs/superpowers/plans/2026-09-23-estrategias-de-frete-local-e-nacional.md).
 *
 * FONTE ÚNICA da regra local (o preset de `freeShippingMin`, que agora vale
 * SÓ para `local-delivery`/`store-pickup`) e do ESPELHO LEGADO que a lê para
 * banco/edge ainda sem as 5 colunas nacionais. A regra NACIONAL não é
 * recalculada aqui: a edge já manda `ShippingOption.price` FINAL (grátis ou
 * desconto já aplicados) e `precoCheio` (o preço antes da estratégia) — o
 * front só EXIBE, nunca reprecifica transportadora (contrato do plano, §3:
 * "o front nunca recalcula preço nacional").
 *
 * Lição #53 (regra escrita em dois lugares diverge): antes desta frente
 * `CartContext`, `ShippingCalculator`, `CheckoutView`, `CartView`,
 * `CartReminder`, `FreeShippingBlock` e `utils/regra-de-frete.ts` liam
 * `presetDoConfig(config.freeShippingMin)` cada um por conta própria e
 * aplicavam o resultado a QUALQUER modalidade (inclusive transportadora) —
 * o bug que esta frente corrige. Daqui para frente, todos passam por aqui.
 */
import { ehModalidadeDaLoja } from "@/lib/guarda-de-frete";
import {
  type PresetFreteGratis,
  presetDoConfig,
} from "@/lib/presets-de-frete-gratis";
import type {
  EstrategiaDeFreteNacional,
  ShippingOption,
  StoreConfig,
} from "@/types";

/** O que basta de `ShippingOption` para as contas deste arquivo. */
export type OpcaoParaPreco = Pick<
  ShippingOption,
  "id" | "price" | "precoCheio" | "estrategiaNacional"
>;

/** O que basta de `StoreConfig` para as contas deste arquivo. */
export type ConfigDeFrete = Pick<
  StoreConfig,
  | "freeShippingMin"
  | "nationalShippingStrategy"
  | "nationalShippingMin"
  | "nationalDiscountType"
  | "nationalDiscountValue"
  | "nationalBenefitScope"
>;

/**
 * O que a cópia legada da migration produziria a partir de
 * `free_shipping_min` — MESMA tabela do bloco `DO` da migration
 * `20261171000000` e do fallback que a edge usa quando as 5 colunas nacionais
 * ainda não existem. Usada aqui pelo `StoreContext` (banco antes da
 * migration) e por quem precisar da mesma conta sem esperar o banco.
 */
export function espelhoLegado(freeShippingMin: number): {
  estrategia: EstrategiaDeFreteNacional;
  minimo: number;
  alcance: "mais_barata" | "todas";
} {
  const preset = presetDoConfig(freeShippingMin);
  if (preset === "sempre")
    return { estrategia: "sempre", minimo: 0, alcance: "todas" };
  if (preset === "por_produto")
    return { estrategia: "por_produto", minimo: 0, alcance: "todas" };
  if (preset === "acima_de_valor")
    return {
      estrategia: "acima_de_valor",
      minimo: freeShippingMin,
      alcance: "todas",
    };
  return { estrategia: "desligado", minimo: 0, alcance: "todas" };
}

export interface ContextoDoPrecoDeFrete {
  config: Pick<StoreConfig, "freeShippingMin">;
  /** Subtotal do carrinho (preço do banco × quantidade — mesma conta de `precoVendido`). */
  subtotal: number;
  /** `cart.some(item => item.product.freeShipping)` — algum item do carrinho marcado. */
  temItemMarcado: boolean;
}

/**
 * A regra LOCAL de hoje (preset de `freeShippingMin`) aplicada em cima de um
 * preço qualquer — mesma conta para `local-delivery`/`store-pickup` E para
 * uma opção NACIONAL sem carimbo (ver `precoFinalDaOpcao` abaixo: RPC
 * `create_marketplace_order_v25`, migration 20261171000000 ~linha 1195, usa
 * exatamente esta sentinela como REGRA LEGADA quando `estrategiaNacional`
 * não veio na cotação).
 */
function precoComRegraLocal(
  preco: number,
  ctx: ContextoDoPrecoDeFrete,
): number {
  const preset = presetDoConfig(ctx.config.freeShippingMin);
  if (preset === "sempre") return 0;
  if (preset === "por_produto") return ctx.temItemMarcado ? 0 : preco;
  if (preset === "acima_de_valor")
    return ctx.subtotal >= ctx.config.freeShippingMin ? 0 : preco;
  return preco;
}

/**
 * O preço FINAL de uma opção, dado o carrinho de agora.
 *
 * - `local-delivery`/`store-pickup`: a regra LOCAL de hoje (preset de
 *   `freeShippingMin`), aplicada em cima do preço que a edge devolveu (a
 *   retirada já chega em R$ 0; a entrega local chega com a taxa cheia —
 *   `local_delivery_fee` — e só este cálculo a zera).
 * - Nacional COM carimbo (`estrategiaNacional` presente): o preço já é
 *   FINAL — devolvido como veio, sem tocar (contrato §3: front nunca
 *   recalcula preço nacional).
 * - Nacional SEM carimbo (edge antiga, loja sem migration, leitura nacional
 *   que falhou, rollback): a RPC aplica a REGRA LEGADA neste caso (mesma
 *   sentinela do preset local, migration 20261171000000 ~linha 1195) — sem
 *   espelhar isso aqui, o front mostraria o preço cheio numa opção que o
 *   servidor vai zerar (ou o contrário), divergindo do que o pedido cobra.
 */
export function precoFinalDaOpcao(
  opcao: OpcaoParaPreco,
  ctx: ContextoDoPrecoDeFrete,
): number {
  if (!ehModalidadeDaLoja(opcao.id)) {
    if (opcao.estrategiaNacional) return opcao.price;
    return precoComRegraLocal(opcao.price, ctx);
  }
  return precoComRegraLocal(opcao.price, ctx);
}

/**
 * Quanto esta opção economizou em relação ao preço cheio.
 *
 * - Nacional COM carimbo: `precoCheio − price` quando `precoCheio` existe e
 *   é maior que `price` (opção beneficiada pela estratégia nacional); senão
 *   zero.
 * - Nacional SEM carimbo (regra legada) e local/retirada: o preço cheio que
 *   deixou de ser cobrado quando a regra local zerou o preço; zero quando
 *   não zerou (nada foi economizado — a cliente vai pagar a taxa mesmo).
 */
export function economiaDaOpcao(
  opcao: OpcaoParaPreco,
  ctx: ContextoDoPrecoDeFrete,
): number {
  if (!ehModalidadeDaLoja(opcao.id) && opcao.estrategiaNacional) {
    const cheio = opcao.precoCheio;
    if (typeof cheio === "number" && cheio > opcao.price) {
      return cheio - opcao.price;
    }
    return 0;
  }
  const final = precoFinalDaOpcao(opcao, ctx);
  return final === 0 ? opcao.price : 0;
}

export interface PromessaDeCanal {
  estrategia: PresetFreteGratis | EstrategiaDeFreteNacional;
  /** Limiar de valor — só significa algo quando `estrategia === "acima_de_valor"`. */
  minimo: number;
}

export interface PromessasDeFrete {
  local: PromessaDeCanal;
  nacional: PromessaDeCanal;
  /**
   * `true` quando local e nacional prometem exatamente o mesmo (mesma
   * estratégia e, quando é por valor, o mesmo limiar) — aí a frase de hoje
   * ("Frete grátis...") continua valendo sem dizer ONDE. Desconto nacional
   * (`desconto_na_mais_barata`) NUNCA é igual: não existe estratégia local
   * equivalente a "desconto na mais barata".
   */
  iguais: boolean;
}

/**
 * O que a loja PROMETE, antes de a cliente escolher uma opção — para selos
 * de produto, banners da Home e o lembrete do carrinho. Nunca usada para
 * cobrar (isso é `precoFinalDaOpcao`/o preço da opção escolhida).
 */
export function promessasDeFrete(config: ConfigDeFrete): PromessasDeFrete {
  const preset = presetDoConfig(config.freeShippingMin);
  const local: PromessaDeCanal = {
    estrategia: preset,
    minimo: preset === "acima_de_valor" ? config.freeShippingMin : 0,
  };
  // Defesa em tempo de execução (o tipo `ConfigDeFrete` diz que estas 5
  // colunas SEMPRE existem — StoreContext garante isso, mirror do
  // `espelhoLegado` incluso): configs hand-rolled em teste (ou qualquer
  // outro objeto que não passou pelo StoreContext) podem chegar sem elas.
  // Sem este fallback, `undefined` nunca bateria com o preset local e todo
  // config "cru" pareceria uma loja com regras DIVERGENTES entre local e
  // nacional — falso positivo, não o "sem info ainda = espelha o local" que
  // o resto do sistema assume.
  const estrategiaNacional =
    config.nationalShippingStrategy ??
    espelhoLegado(config.freeShippingMin).estrategia;
  const minimoNacional =
    config.nationalShippingStrategy === undefined
      ? espelhoLegado(config.freeShippingMin).minimo
      : config.nationalShippingMin;
  const nacional: PromessaDeCanal = {
    estrategia: estrategiaNacional,
    minimo: estrategiaNacional === "acima_de_valor" ? minimoNacional : 0,
  };
  const iguais =
    local.estrategia === nacional.estrategia &&
    (local.estrategia !== "acima_de_valor" || local.minimo === nacional.minimo);
  return { local, nacional, iguais };
}

/** A promessa daquele canal vale para ESTE produto (marcado ou não)? */
function promessaValeParaOProduto(
  canal: PromessaDeCanal,
  produtoMarcado: boolean,
): boolean {
  return (
    canal.estrategia === "sempre" ||
    (canal.estrategia === "por_produto" && produtoMarcado)
  );
}

/**
 * O selo "Frete Grátis" deste produto vale em algum canal (local OU
 * nacional)? Usada pelos 7 pontos de selo (ProductCard e as telas que o
 * alimentam) — substitui a leitura direta de `presetDoConfig`.
 */
export function produtoTemFreteGratisPrometido(
  promessas: PromessasDeFrete,
  produtoMarcado: boolean,
): boolean {
  return (
    promessaValeParaOProduto(promessas.local, produtoMarcado) ||
    promessaValeParaOProduto(promessas.nacional, produtoMarcado)
  );
}

/**
 * A frase do selo: "Frete grátis" quando os dois canais concordam (frase de
 * hoje, sem dizer onde); "Frete grátis na cidade" / "Frete grátis para todo
 * o Brasil" quando só um promete — decisão D4 do `socio` (23/09): desconto
 * nacional nunca vira selo (não é grátis, é desconto). `null` quando nenhum
 * canal promete para este produto.
 */
export function fraseDoSeloDeFreteGratis(
  promessas: PromessasDeFrete,
  produtoMarcado: boolean,
): string | null {
  const local = promessaValeParaOProduto(promessas.local, produtoMarcado);
  const nacional = promessaValeParaOProduto(promessas.nacional, produtoMarcado);
  if (!local && !nacional) return null;
  if (local && nacional) return "Frete grátis";
  return local ? "Frete grátis na cidade" : "Frete grátis para todo o Brasil";
}

export interface MetaDeFreteGratisPorValor {
  /** `null` = nenhum canal aplicável tem meta por valor para mostrar aqui. */
  minimo: number | null;
  /** De onde a meta vale — só quando `minimo` não é `null`. */
  alcance: "local" | "nacional" | "ambos" | null;
}

/**
 * A meta "faltam R$ X para o frete grátis" (barra de progresso), dado o que
 * se sabe sobre o CEP da cliente:
 *  - CEP conhecido e é da cidade (`true`): só a regra LOCAL.
 *  - CEP conhecido e é de fora (`false`): só a regra NACIONAL.
 *  - CEP desconhecido (`null`): só afirma quando as duas metas EXISTEM e são
 *    a MESMA — senão mostraria uma promessa que pode não valer para o CEP
 *    real da cliente.
 */
export function metaDeFreteGratisPorValor(
  promessas: PromessasDeFrete,
  cepLocal: boolean | null,
): MetaDeFreteGratisPorValor {
  const localTemMeta = promessas.local.estrategia === "acima_de_valor";
  const nacionalTemMeta = promessas.nacional.estrategia === "acima_de_valor";

  if (cepLocal === true) {
    return localTemMeta
      ? { minimo: promessas.local.minimo, alcance: "local" }
      : { minimo: null, alcance: null };
  }
  if (cepLocal === false) {
    return nacionalTemMeta
      ? { minimo: promessas.nacional.minimo, alcance: "nacional" }
      : { minimo: null, alcance: null };
  }

  // CEP desconhecido: só afirma quando os dois canais têm a MESMA meta.
  if (
    localTemMeta &&
    nacionalTemMeta &&
    promessas.local.minimo === promessas.nacional.minimo
  ) {
    return { minimo: promessas.local.minimo, alcance: "ambos" };
  }
  return { minimo: null, alcance: null };
}

// ─────────────────────────────────────────────────────────────────────────
// TAREFA T4 (23/09/2026) — funções puras do ADMIN: a tela
// `AdminShippingNationalView` e o botão de estado salvo em
// `FreteNacionalBloco` usam daqui. Nenhuma reprecifica transportadora de
// verdade (isso é proibido — §3: "o front nunca recalcula preço nacional");
// `precoComDescontoNacional` é só a PRÉVIA com um preço de EXEMPLO fixo, com
// a MESMA conta em centavos de `aplicarEstrategiaNacional`
// (supabase/functions/calculate-shipping/estrategia-nacional.ts) — divergir
// da conta da edge faria a prévia mentir sobre o preço real.
// ─────────────────────────────────────────────────────────────────────────

/** As 3 estratégias de GRÁTIS cujo alcance (mais barata / todas as opções) é
 * uma escolha da lojista. O desconto não entra: é sempre "mais_barata" por
 * definição da própria estratégia (o servidor ignora a coluna nesse caso —
 * EMENDA revisão T1). */
const ESTRATEGIAS_DE_GRATIS_NACIONAL: ReadonlySet<EstrategiaDeFreteNacional> =
  new Set(["acima_de_valor", "sempre", "por_produto"]);

/** O alcance (mais barata / todas as opções) só faz sentido para as
 * estratégias de GRÁTIS — desconto não mostra o painel de alcance. */
export function estrategiaTemAlcanceEditavel(
  estrategia: EstrategiaDeFreteNacional,
): boolean {
  return ESTRATEGIAS_DE_GRATIS_NACIONAL.has(estrategia);
}

/** Dinheiro sem símbolo, como a pessoa escreve: "199", "49,90" — nunca "49.9". */
function reaisSemSimbolo(valor: number): string {
  const seguro = Number.isFinite(valor) ? valor : 0;
  return Number.isInteger(seguro)
    ? `${seguro}`
    : seguro.toFixed(2).replace(".", ",");
}

/**
 * O preço de UM exemplo (preço cheio fixo, dado pela view) com o desconto
 * nacional aplicado — MESMA conta em centavos inteiros de
 * `aplicarEstrategiaNacional` na edge: `percentual` → `cheioC −
 * Math.round(cheioC × pct / 100)`; `fixo` → `cheioC − min(valorC, cheioC)`.
 * Nunca negativo. Só serve para a PRÉVIA da tela — o preço real de verdade
 * sempre vem de `ShippingOption.price` (a edge já aplicou a estratégia).
 */
export function precoComDescontoNacional(
  precoCheio: number,
  tipo: "percentual" | "fixo",
  valor: number,
): number {
  const cheioC = Math.round((Number(precoCheio) || 0) * 100);
  const valorC = Math.round((Number(valor) || 0) * 100);
  let finalC =
    tipo === "percentual"
      ? cheioC - Math.round((cheioC * valor) / 100)
      : cheioC - Math.min(valorC, cheioC);
  if (finalC < 0) finalC = 0;
  return finalC / 100;
}

/** O que basta de `StoreConfig` para o texto curto e a validação do admin. */
export type ConfigDeFreteNacional = Pick<
  StoreConfig,
  | "nationalShippingStrategy"
  | "nationalShippingMin"
  | "nationalDiscountType"
  | "nationalDiscountValue"
  | "nationalBenefitScope"
>;

/**
 * O texto curto do estado SALVO da estratégia nacional — o botão "Estratégias
 * do frete nacional →" em `FreteNacionalBloco` (dentro de "Fora da cidade")
 * mostra este texto ao lado, para a lojista saber o que está valendo sem
 * abrir a tela nova.
 */
export function resumoDaEstrategiaNacional(
  config: ConfigDeFreteNacional,
): string {
  const {
    nationalShippingStrategy: estrategia,
    nationalShippingMin: minimo,
    nationalDiscountType: tipoDesconto,
    nationalDiscountValue: valorDesconto,
    nationalBenefitScope: alcance,
  } = config;
  const alcanceTexto =
    alcance === "todas" ? "todas as opções" : "só a mais barata";

  switch (estrategia) {
    case "desligado":
      return "desligado";
    case "acima_de_valor":
      return `grátis acima de R$ ${reaisSemSimbolo(minimo)} · ${alcanceTexto}`;
    case "sempre":
      return `sempre grátis · ${alcanceTexto}`;
    case "por_produto":
      return `grátis por produto marcado · ${alcanceTexto}`;
    case "desconto_na_mais_barata": {
      const valorTexto =
        tipoDesconto === "percentual"
          ? `${reaisSemSimbolo(valorDesconto)}%`
          : `R$ ${reaisSemSimbolo(valorDesconto)}`;
      const minimoTexto =
        minimo > 0 ? ` acima de R$ ${reaisSemSimbolo(minimo)}` : "";
      return `${valorTexto} na mais barata${minimoTexto}`;
    }
    default:
      return "desligado";
  }
}

/** O formulário da tela `AdminShippingNationalView` — só os 4 campos que a
 * lojista edita (o alcance não entra: nenhuma combinação dele é INVÁLIDA). */
export interface FormularioEstrategiaNacional {
  estrategia: EstrategiaDeFreteNacional;
  minimo: number;
  tipoDesconto: "percentual" | "fixo" | null;
  valorDesconto: number;
}

/**
 * O erro do formulário nacional ANTES de salvar — espelha, no cliente, os
 * mesmos CHECKs de linha da migration `20261171000000` (contrato do plano):
 * `acima_de_valor ⇒ min > 0`; `desconto_na_mais_barata ⇒ tipo NOT NULL AND
 * valor > 0 AND (tipo='fixo' OR (valor<=100 AND valor=trunc(valor)))`.
 * `null` = pode salvar. Espelhar aqui não substitui o CHECK do banco — só
 * evita a viagem ao servidor com um valor que o banco recusaria de qualquer
 * forma, com a mensagem em português.
 */
export function erroDoFormularioNacional(
  form: FormularioEstrategiaNacional,
): string | null {
  if (form.estrategia === "acima_de_valor" && !(form.minimo > 0)) {
    return "Informe um valor mínimo maior que R$ 0 para o grátis acima de um valor.";
  }
  if (form.estrategia === "desconto_na_mais_barata") {
    if (form.tipoDesconto === null) {
      return "Escolha o tipo de desconto: percentual ou valor fixo.";
    }
    if (!(form.valorDesconto > 0)) {
      return "Informe um valor de desconto maior que R$ 0.";
    }
    if (
      form.tipoDesconto === "percentual" &&
      (form.valorDesconto > 100 ||
        form.valorDesconto !== Math.trunc(form.valorDesconto))
    ) {
      return "O desconto percentual precisa ser um número inteiro até 100.";
    }
  }
  return null;
}
