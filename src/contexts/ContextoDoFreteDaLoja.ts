import {
  DIAS_DA_ENTREGA_PROPRIA_PADRAO,
  diasDaEntregaPropria,
  entregaPropriaLigada,
  listaComRetirada,
  retiradaLigadaNaLista,
} from "@/lib/guarda-de-frete";
import type { StoreConfig } from "@/types";
import { createContext, useContext } from "react";

/**
 * Versão do CONTRATO da cotação de frete (release 1.5.7). Entra no contexto
 * abaixo, e com ele no envelope do cache do navegador: quando a edge muda o
 * que a cotação significa, o envelope gravado pela versão anterior do app
 * deixa de casar e a tela recota. A 1.5.7 muda o SIGNIFICADO da resposta
 * (vários provedores ao mesmo tempo, `contratoCliente: 3`, prazo 0 canônico,
 * `revisaoConfig` no envelope) — sem bumpar esta versão, a tela 1.5.7
 * serviria por até 2 h uma lista cotada pela 1.5.6, que não tem os campos
 * novos (`transportadora`, `servico`, `provedorRotulo`) nem a revisão para
 * validar contra mudança na configuração da loja. A chave
 * (`ikcous_shipping_cache_v2_<CEP>`) não muda: o logout continua limpando
 * pelo prefixo (`ikcous_shipping_cache_`).
 */
export const VERSAO_DO_CONTRATO_DE_COTACAO = "cotacao-3";

const TAXA_DA_ENTREGA_PROPRIA_PADRAO = 10;

/** Número finito (ou texto numérico do banco); o resto lê como a taxa padrão. */
function taxaDaEntregaPropria(valor: unknown): number {
  const n =
    typeof valor === "string" && valor.trim() !== "" ? Number(valor) : valor;
  return typeof n === "number" && Number.isFinite(n)
    ? n
    : TAXA_DA_ENTREGA_PROPRIA_PADRAO;
}

/**
 * O CONTEXTO DA LOJA que uma cotação de frete responde (release 1.5.3 —
 * retirada na loja): provedor, transportadoras habilitadas, retirada ligada
 * e o endereço da loja (aparado). A edge `calculate-shipping` decide a lista
 * com esses campos; a ShippingCalculator carimba o cache do navegador com
 * este texto e recota quando ele muda — senão a tela ofereceria, por até
 * 2 h, a retirada que a loja desligou ou o endereço de onde ela saiu.
 * Lista NULL lê como a edge (`["sedex","pac"]`, via `listaComRetirada`).
 *
 * "COMO ENTREGO NA MINHA CIDADE" (16/10/2026): a entrega própria desligada
 * ("Só retiro") e o prazo dela mudam o que a edge responde, então entram no
 * carimbo — mas SÓ quando diferem do padrão (ligada, 1 dia). Com os padrões
 * o texto é BYTE A BYTE o de antes (provado em
 * `tests/front/contexto-do-frete-modo-e-prazo.test.ts`): o deploy não
 * invalida o cache de ninguém que não mudou nada. O trecho vai DEPOIS da
 * versão do contrato, para a posição dos campos antigos não andar. A troca
 * entre "Entrego" e "Entrego e retiro" já muda o carimbo pela retirada.
 *
 * A TAXA da entrega própria (12/11/2026) é o preço da "Entrega Local": a
 * lojista muda de R$ 10 para R$ 20 e a cliente com o carrinho aberto seguia
 * vendo R$ 10 até o cache vencer. Entra no fim, num trecho próprio, SÓ com a
 * entrega ligada e a taxa diferente de R$ 10 (a que a edge assume quando a
 * coluna é nula): ausente, inválida ou igual à padrão = texto de antes.
 * R$ 0 é taxa de verdade (entrega grátis) e entra.
 */
export function contextoDaLojaParaFrete(
  config:
    | Pick<
        StoreConfig,
        | "shippingProvider"
        | "enabledShippingMethods"
        | "storeAddress"
        | "localDeliveryEnabled"
        | "localDeliveryDays"
        | "localDeliveryFee"
      >
    | null
    | undefined,
): string {
  const metodos = config?.enabledShippingMethods;
  const carimbo: unknown[] = [
    config?.shippingProvider ?? "",
    [...listaComRetirada(metodos, false)].sort(),
    retiradaLigadaNaLista(metodos),
    (config?.storeAddress ?? "").trim(),
    VERSAO_DO_CONTRATO_DE_COTACAO,
  ];
  const entregaLigada = entregaPropriaLigada(config?.localDeliveryEnabled);
  const dias = diasDaEntregaPropria(config?.localDeliveryDays);
  if (!entregaLigada || dias !== DIAS_DA_ENTREGA_PROPRIA_PADRAO) {
    carimbo.push(["entrega-propria", entregaLigada, dias]);
  }
  const taxa = taxaDaEntregaPropria(config?.localDeliveryFee);
  if (entregaLigada && taxa !== TAXA_DA_ENTREGA_PROPRIA_PADRAO) {
    carimbo.push(["taxa-da-entrega-propria", taxa]);
  }
  return JSON.stringify(carimbo);
}

/**
 * Contexto React PRÓPRIO (e não um campo do `useStore`): o StoreProvider o
 * fornece com o config real; sem provider — a calculadora montada sozinha,
 * ou um teste que troca o `@/contexts/StoreContext` inteiro por um dublê —
 * vale o contexto "sem config", estável, e nada quebra.
 */
export const ContextoDoFreteDaLoja = createContext<string>(
  contextoDaLojaParaFrete(undefined),
);

export function useContextoDoFreteDaLoja(): string {
  return useContext(ContextoDoFreteDaLoja);
}
