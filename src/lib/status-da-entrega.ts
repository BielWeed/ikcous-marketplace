import type { StatusDaFaixaFrete } from "@/components/admin/shipping/FreteResumoFaixa";
import {
  type ConfigDeFreteNacional,
  resumoDaEstrategiaNacional,
} from "@/lib/estrategias-de-frete";
import { presetDoConfig } from "@/lib/presets-de-frete-gratis";
import type { StoreConfig } from "@/types";

/**
 * A régua do status da entrega — as três linhas da faixa-resumo da tela
 * "Entrega e frete" ("Na sua cidade", "Fora da cidade", "Frete grátis
 * local"). Extraída de `AdminShippingView` (E2, painel simples) para morar
 * num lugar só: regra escrita em dois lugares diverge (lição #53).
 *
 * Descreve o config SALVO, nunca o formulário — a faixa conta a realidade da
 * loja. O CEP vem de "Minha loja" (P2: um CEP só), por isso a nota de "sem
 * CEP" aponta para lá, não para um campo desta tela.
 */

/** O que basta do config para contar a história da entrega. */
export type ConfigDaEntrega = Pick<
  StoreConfig,
  | "originCep"
  | "freeShippingMin"
  | "localDeliveryFee"
  | "shippingCoverage"
  | "storeCity"
  | "storeState"
> &
  ConfigDeFreteNacional;

export interface EntradaDaEntrega {
  /** Ausente (config ainda não chegou) conta como "sem CEP". */
  readonly config: ConfigDaEntrega | null | undefined;
  /** A leitura das transportadoras falhou — a faixa não finge saber. */
  readonly credsErro: boolean;
  /** Nomes das transportadoras com cotação REAL ligada (estado "ligado"). */
  readonly nomesLigados: readonly string[];
}

/** Dinheiro como a pessoa escreve: R$ 10, R$ 49,90 — nunca "R$ 49.9". */
export function reais(valor: number): string {
  const seguro = Number.isFinite(valor) ? valor : 0;
  return Number.isInteger(seguro)
    ? `${seguro}`
    : seguro.toFixed(2).replace(".", ",");
}

export function statusDaEntrega({
  config,
  credsErro,
  nomesLigados,
}: EntradaDaEntrega): readonly [
  StatusDaFaixaFrete,
  StatusDaFaixaFrete,
  StatusDaFaixaFrete,
] {
  const minSalvo = Number(config?.freeShippingMin ?? 0);
  const presetSalvo = presetDoConfig(minSalvo);
  const localFee = Number(config?.localDeliveryFee ?? 10);
  const cidade = config?.storeCity;
  const uf = config?.storeState;
  const ondeCidade =
    cidade && uf ? `${cidade}/${uf}` : cidade ? cidade : "sua cidade";

  const local: StatusDaFaixaFrete = !config?.originCep
    ? {
        rotulo: "Na sua cidade",
        valor: "Parado — falta o CEP da loja",
        detalhe: "Cadastre o CEP em Minha loja para abrir as vendas",
        tom: "atencao",
      }
    : {
        rotulo: "Na sua cidade",
        valor:
          localFee > 0
            ? `R$ ${reais(localFee)} por entrega`
            : "Grátis na cidade",
        detalhe: `Entrega própria em ${ondeCidade}`,
        tom: "positivo",
      };

  const resumoNacional =
    config != null ? resumoDaEstrategiaNacional(config) : "desligado";
  const detalheNacional = (base: string): string =>
    resumoNacional === "desligado" ? base : `${base} · ${resumoNacional}`;

  const nacional: StatusDaFaixaFrete =
    (config?.shippingCoverage || "national") === "local"
      ? {
          rotulo: "Fora da cidade",
          valor: "Só na sua cidade",
          detalhe: "fora dela, a loja não atende",
          tom: "neutro",
        }
      : credsErro
        ? {
            rotulo: "Fora da cidade",
            valor: "Conexão a confirmar",
            detalhe: "confira a transportadora em Ajustes",
            tom: "neutro",
          }
        : nomesLigados.length > 0
          ? {
              rotulo: "Fora da cidade",
              valor:
                nomesLigados.length === 1
                  ? `${nomesLigados[0]} ligado`
                  : `${nomesLigados.length} provedores ligados`,
              detalhe: detalheNacional("cotação real na hora"),
              tom: "positivo",
            }
          : {
              rotulo: "Fora da cidade",
              valor: "Sem transportadora",
              detalhe: "por enquanto, só entrega na cidade",
              tom: "atencao",
            };

  const gratis: StatusDaFaixaFrete =
    presetSalvo === "acima_de_valor"
      ? {
          rotulo: "Frete grátis local",
          valor: `Acima de R$ ${reais(minSalvo)}`,
          detalhe:
            "a compra que passa do valor não paga entrega na cidade nem retirada",
          tom: "positivo",
        }
      : presetSalvo === "sempre"
        ? {
            rotulo: "Frete grátis local",
            valor: "Em toda a loja",
            detalhe: "toda entrega na cidade e retirada saem grátis",
            tom: "positivo",
          }
        : presetSalvo === "por_produto"
          ? {
              rotulo: "Frete grátis local",
              valor: "Por produto marcado",
              detalhe:
                "produtos marcados saem sem custo na entrega da cidade e na retirada",
              tom: "positivo",
            }
          : {
              rotulo: "Frete grátis local",
              valor: "Desligado",
              detalhe: "nenhuma regra de grátis ativa",
              tom: "neutro",
            };

  return [local, nacional, gratis] as const;
}
