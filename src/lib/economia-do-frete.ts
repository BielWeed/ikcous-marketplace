// ECONOMIA DO FRETE (pedido do Gabriel, 12/09/2026): a barra de baixo do
// checkout ganha uma pilula com o quanto o cliente ECONOMIZOU — cupom + o
// que deixou de pagar de frete quando ele saiu grátis. Este arquivo decide
// SÓ o valor do frete; o cupom já tem o dele em `appliedCoupon.discount`.
//
// Corrigido pelo crítico de desenho (Opus) antes de fechar — a tabela
// original (a/b/c do plano) tinha três furos:
//
//   1. Convidado fora da cidade não finaliza (REGRA DO CONVIDADO,
//      CheckoutView.tsx ~1345: `convidadoForaDaCidade` trava o botão) — mas
//      a pilula prometeria a economia de um pedido impossível de fechar.
//   2. Preset "por_produto" fora da cidade: a edge só zera o frete quando
//      TODO item está marcado (calculate-shipping/index.ts:736) e, se não,
//      cota só os itens NÃO marcados (:933-939) — o preço que voltaria não
//      é "quanto custaria entregar o carrinho inteiro", é outra conta.
//   3. TODA chamada à edge grava linha em `shipping_calculation_logs`
//      (index.ts:783-793, 880-891) — inclusive o caminho local. Cotar para
//      exibição custa uma linha no "Histórico de Cotações" da lojista que
//      ninguém pediu; por isso o CEP local nunca liga para a edge (o preço
//      já está gravado em `store_config.local_delivery_fee`, o MESMO que a
//      RPC cobra para `p_shipping_option_id = 'local-delivery'` —
//      migration 20261081000000, linha ~339).
//
// Regra final, nesta ordem (cada `if` é uma linha da tabela aprovada):
export type ModoDeEconomiaDoFrete =
  | { tipo: "zero" }
  | { tipo: "local"; valor: number }
  | { tipo: "cotar" };

import { cepEhLocal } from "@/lib/cep-local";
import { presetDoConfig } from "@/lib/presets-de-frete-gratis";
import { soDigitos } from "@/lib/reconciliacao-de-cep";

export function modoDeEconomiaDoFrete(params: {
  /** Veredito único do CartContext (`freteGratis`) — sem ele, não há o que economizar. */
  freteGratis: boolean;
  /** CEP de entrega do checkout (endereço do logado ou campo do convidado) — NUNCA o CEP da cotação de frete real. */
  cepDeEntrega: string | null;
  /** `!!user` — convidado só finaliza entrega local (P6/REGRA DO CONVIDADO). */
  temUsuario: boolean;
  originCep?: string;
  localCepRange?: string;
  /** `config.localDeliveryFee` — o mesmo valor que a RPC cobra para `local-delivery`. Ausente/nulo nunca vira 0 chutado nem o `shippingFee` de fábrica. */
  localDeliveryFee?: number;
  freeShippingMin: number;
}): ModoDeEconomiaDoFrete {
  const {
    freteGratis,
    cepDeEntrega,
    temUsuario,
    originCep,
    localCepRange,
    localDeliveryFee,
    freeShippingMin,
  } = params;

  // Linha 1.
  if (!freteGratis) return { tipo: "zero" };

  // Linha 2. CEP parcial é digitação em curso (mesma ressalva de
  // `cotacaoValeParaDestino`/reconciliacao-de-cep.ts) — decidir com ele
  // inventaria "local" ou "fora da cidade" no primeiro dígito.
  const cepLimpo = cepDeEntrega ? soDigitos(cepDeEntrega) : "";
  if (cepLimpo.length < 8) return { tipo: "zero" };

  // Linha 3. CEP local vale para TODOS os presets: a RPC só chega no CASE
  // `local-delivery` quando a condição de grátis NÃO bateu sozinha, e aqui
  // já estamos no ramo em que ela bateu — o preço "seria" o mesmo
  // independente de qual preset causou o grátis.
  const local = !!originCep && cepEhLocal(originCep, cepLimpo, localCepRange);
  if (local) {
    if (localDeliveryFee == null) return { tipo: "zero" };
    return { tipo: "local", valor: localDeliveryFee };
  }

  // Fora da cidade daqui para baixo.

  // Linha 4. Convidado fora da cidade nem finaliza o pedido — mostrar uma
  // economia aqui seria prometer um total que a tela vai recusar no clique.
  if (!temUsuario) return { tipo: "zero" };

  // Linha 5. Preset "por_produto": a edge não cota "o carrinho inteiro
  // fora da cidade" nesse preset — o número que voltaria não corresponde à
  // pergunta que a pílula está respondendo.
  const preset = presetDoConfig(freeShippingMin);
  if (preset === "por_produto") return { tipo: "zero" };

  // Linha 6. Só sobra logado, fora da cidade, preset "sempre" ou
  // "acima_de_valor" — aqui vale cotar de verdade.
  return { tipo: "cotar" };
}
