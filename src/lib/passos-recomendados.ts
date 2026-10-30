import {
  type StatusDoEmail,
  seloDoEmail,
} from "@/components/admin/settings/email-da-loja-conteudo";
import { modoDaEntregaNaCidade } from "@/lib/guarda-de-frete";
import type { EstadoDoItem } from "@/lib/loja-pronta";
import type { View } from "@/types";

/**
 * Os passos RECOMENDADOS do cartão "Sua loja está pronta para vender?" do
 * Início (30/10/2026, vistoria da Savy). Os seis passos de `loja-pronta.ts`
 * dizem se a loja ABRE; estes três dizem se ela VENDE de verdade:
 *
 *  - e-mail da loja: sem remetente, o cliente não recebe e-mail do pedido;
 *  - pagamento pelo app (PIX): sem ele, só se paga na entrega;
 *  - transportadora: sem nenhuma ligada, quem é de fora não compra.
 *
 * Regras de convivência com o resto:
 *  - NÃO entram na conta "N de 6" nem travam nada (checkout, pagamento e frete
 *    não mudam): são só avisos com atalho para o ajuste certo;
 *  - NÃO calculam o estado do zero — recebem os fatos que as telas de Ajustes e
 *    de Frete já leem (`seloDoEmail`, `pixOk`, `nomesLigados` da régua do Frete);
 *  - só falam o que SABEM: leitura que falhou (`desconhecido`, `null`) faz o
 *    passo sumir, nunca virar "pendente" por chute;
 *  - passo que não se aplica à loja some (loja só da cidade ou só de retirada
 *    não precisa de transportadora).
 */

export type ChaveDoRecomendado = "email" | "pagamentoApp" | "transportadora";

export interface PassoRecomendado {
  readonly chave: ChaveDoRecomendado;
  /** Ação no imperativo — texto da linha que leva ao ajuste. */
  readonly rotuloPendente: string;
  readonly estado: EstadoDoItem;
  readonly destino: View;
  /** Uma frase para a lojista: o que acontece enquanto o passo está pendente. */
  readonly explicacaoPendente: string;
}

/** O resumo do selo do e-mail (`seloDoEmail`) em cinco valores. */
export type FatoDoEmail =
  | "carregando"
  | "configurado"
  | "nao_configurado"
  | "com_problema"
  | "desconhecido";

/**
 * A leitura do e-mail (`useEmailDaLoja`) no fato do passo, com a MESMA régua do
 * selo da tela de Ajustes (`seloDoEmail`): "Não configurado" e "Com problema"
 * pedem ação; "Funcionando", "Configurado no servidor" e "Salvo, ainda não
 * testado" não. Leitura que falhou ou ainda não existe não é pendência.
 */
export function fatoDoEmail(
  carga: "carregando" | "pronto" | "indisponivel" | "erro",
  status: StatusDoEmail | null,
): FatoDoEmail {
  if (carga === "carregando") return "carregando";
  if (carga !== "pronto" || status === null) return "desconhecido";
  const tipo = seloDoEmail(status).tipo;
  if (tipo === "nao_configurado") return "nao_configurado";
  return tipo === "problema" ? "com_problema" : "configurado";
}

export interface FatosDosRecomendados {
  readonly email: FatoDoEmail;
  /** O mesmo `pixOk` dos seis passos: flag ligada E chave pública no deploy. */
  readonly pixOk: boolean;
  /** Nomes das transportadoras com cotação real ligada; `null` = não sei. */
  readonly nomesLigados: readonly string[] | null;
  readonly config: {
    readonly shippingCoverage?: string | null;
    readonly localDeliveryEnabled?: boolean | null;
    readonly enabledShippingMethods?: readonly string[] | null;
  };
  readonly configCarregando: boolean;
}

/** A loja oferece frete para fora da cidade? (A transportadora só importa aí.) */
function lojaVendeParaFora(config: FatosDosRecomendados["config"]): boolean {
  if ((config.shippingCoverage || "national") === "local") return false;
  return modoDaEntregaNaCidade(config) !== "so_retiro";
}

export function passosRecomendados(
  fatos: FatosDosRecomendados,
): readonly PassoRecomendado[] {
  const passos: PassoRecomendado[] = [];

  if (fatos.email !== "desconhecido") {
    const comProblema = fatos.email === "com_problema";
    passos.push({
      chave: "email",
      rotuloPendente: comProblema
        ? "Corrigir o e-mail da loja"
        : "Cadastrar o e-mail da loja",
      estado:
        fatos.email === "carregando"
          ? "carregando"
          : fatos.email === "configurado"
            ? "feito"
            : "pendente",
      destino: "admin-settings",
      explicacaoPendente: comProblema
        ? "O último envio falhou: seus clientes podem não receber o e-mail do pedido"
        : "Sem ele, seus clientes não recebem e-mail do pedido",
    });
  }

  passos.push({
    chave: "pagamentoApp",
    rotuloPendente: "Ligar o pagamento pelo app (PIX)",
    // A flag vem da config da loja: antes dela chegar, "não sei".
    estado: fatos.pixOk
      ? "feito"
      : fatos.configCarregando
        ? "carregando"
        : "pendente",
    destino: "admin-settings",
    explicacaoPendente: "Sem ele, seus clientes só podem pagar na entrega",
  });

  if (fatos.nomesLigados !== null && lojaVendeParaFora(fatos.config)) {
    passos.push({
      chave: "transportadora",
      rotuloPendente: "Ligar uma transportadora",
      estado: fatos.nomesLigados.length > 0 ? "feito" : "pendente",
      destino: "admin-shipping",
      explicacaoPendente:
        "Nenhuma transportadora ligada: quem é de fora não compra",
    });
  }

  return passos;
}

/** Só o que ainda falta (é o que o cartão desenha), na ordem dos passos. */
export function pendentesRecomendados(
  fatos: FatosDosRecomendados,
): readonly PassoRecomendado[] {
  return passosRecomendados(fatos).filter((p) => p.estado === "pendente");
}
