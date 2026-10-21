import type { StatusDaFaixaFrete } from "@/components/admin/shipping/FreteResumoFaixa";
import { lerEnderecoConferido } from "@/lib/endereco-da-loja";
import {
  type ConfigDeFreteNacional,
  resumoDaEstrategiaNacional,
} from "@/lib/estrategias-de-frete";
import { modoDaEntregaNaCidade } from "@/lib/guarda-de-frete";
import {
  alcanceSemNumeros,
  cepCompleto,
  resumoDoAlcance,
} from "@/lib/loja-pronta";
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
  | "localCepRange"
  | "freeShippingMin"
  | "localDeliveryFee"
  | "shippingCoverage"
  | "storeCity"
  | "storeState"
  | "storeAddress"
  | "localDeliveryEnabled"
  | "enabledShippingMethods"
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

  // "Só retiro": a loja não entrega nem manda por transportadora; a cliente
  // retira e quem é de fora também. Só falta o endereço para saber onde. O
  // critério é o MESMO do passo "entrega" da loja pronta: endereço conferido
  // (formato novo, com o CEP da loja), não qualquer texto.
  const soRetiro = modoDaEntregaNaCidade(config) === "so_retiro";
  const temEndereco =
    lerEnderecoConferido(config?.storeAddress, config?.originCep) !== null;

  const local: StatusDaFaixaFrete = !config?.originCep
    ? {
        rotulo: "Na sua cidade",
        valor: "Parado — falta o CEP da loja",
        detalhe: "Cadastre o CEP em Minha loja para abrir as vendas",
        tom: "atencao",
      }
    : soRetiro
      ? {
          rotulo: "Na sua cidade",
          valor: "Só retiro",
          detalhe: temEndereco
            ? "o cliente retira na loja"
            : "falta confirmar o endereço da loja em Minha loja",
          tom: temEndereco ? "positivo" : "atencao",
        }
      : {
          rotulo: "Na sua cidade",
          valor:
            localFee > 0
              ? `R$ ${reais(localFee)} por entrega`
              : "Grátis na cidade",
          // A abrangência REAL, nunca o nome da cidade: com o alcance vazio a
          // entrega própria vale só para os CEPs que começam com os 5 números
          // do CEP da loja (um pedaço de bairro), e "em Uberlândia/MG" prometia
          // a cidade inteira.
          detalhe: `Entrega própria em ${resumoDoAlcance(config.originCep, config.localCepRange)}`,
          // Texto escrito sem número nenhum: o servidor não entrega para ninguém.
          tom: alcanceSemNumeros(config.localCepRange) ? "atencao" : "positivo",
        };

  const resumoNacional =
    config != null ? resumoDaEstrategiaNacional(config) : "desligado";
  const detalheNacional = (base: string): string =>
    resumoNacional === "desligado" ? base : `${base} · ${resumoNacional}`;

  const nacional: StatusDaFaixaFrete = soRetiro
    ? {
        rotulo: "Fora da cidade",
        valor: "Só retirada",
        detalhe: "quem é de fora também pode retirar na loja",
        tom: "neutro",
      }
    : (config?.shippingCoverage || "national") === "local"
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
            detalhe: "confira o painel Transportadoras, logo abaixo",
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

  // "Só retiro" vale sobre qualquer regra de grátis: não há entrega para dar
  // desconto, e a retirada nunca tem custo.
  const gratis: StatusDaFaixaFrete = soRetiro
    ? {
        rotulo: "Frete grátis local",
        valor: "Retirada grátis",
        detalhe: "a retirada na loja não tem custo",
        tom: "positivo",
      }
    : presetSalvo === "acima_de_valor"
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

/** Estado da tela de perguntas. Recebe o rascunho, sem gravar nem cotar. */
export function situacaoDaEntrega(
  config: ConfigDaEntrega | null,
  nomesLigados: readonly string[] | null,
  semPagamento: boolean,
) {
  const faltaCep = !cepCompleto(config?.originCep);
  const fora = config?.shippingCoverage !== "local";
  const confirmarTransportadoras = fora && nomesLigados === null;
  const faltaTransportadora =
    fora && nomesLigados !== null && nomesLigados.length === 0;
  const faltaEndereco =
    modoDaEntregaNaCidade(config) !== "entrego" &&
    !(config?.storeAddress ?? "").trim();
  const faltaAlcance =
    config?.localDeliveryEnabled !== false &&
    alcanceSemNumeros(config?.localCepRange);
  const pendencias =
    Number(faltaCep) +
    Number(faltaTransportadora) +
    Number(semPagamento) +
    Number(faltaEndereco) +
    Number(faltaAlcance);
  return {
    faltaCep,
    faltaTransportadora,
    faltaEndereco,
    faltaAlcance,
    confirmarTransportadoras,
    pendencias,
  };
}
