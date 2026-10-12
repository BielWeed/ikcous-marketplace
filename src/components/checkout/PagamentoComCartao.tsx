import { chavePublicaMercadoPago } from "@/config/configuracaoDaLoja";
import type {
  ArgsCriarPagamento,
  RespostaCriarPagamento,
} from "@/hooks/useOrders";
import { useOrders } from "@/hooks/useOrders";
import {
  type ConfigDoCartao,
  type TipoDeCartao,
  parcelasMaximasNoBrick,
  tiposDeCartaoAceitos,
} from "@/lib/config-do-cartao";
import { numeroDoPedido } from "@/lib/numero-do-pedido";
import { formatCurrency } from "@/lib/utils";
import { AlertCircle, Check, Clock, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type {
  CategoriaErroPagamento,
  SinalDeErroPagamento,
} from "./PagamentoOnline";
import { comTempoLimite } from "./PagamentoOnline";
import type { PontoDePartidaDaVerificacao } from "./VerificacaoDoPagamento";
import {
  ESPERAS_DA_CONFIRMACAO_MS,
  ESPERAS_DA_RODADA_MANUAL_MS,
  ESPERA_ANTES_DO_AVISO_DO_APROVADO_MS,
  RETOMADAS_PELA_ABA_DA_CONFIRMACAO,
  RODADAS_MANUAIS_DA_CONFIRMACAO,
  TEMPO_LIMITE_DA_CONSULTA_DO_CARTAO_MS,
  desfechoDaConsultaDoCartao,
  desfechoDoErroDaConsulta,
} from "./confirmacao-do-cartao";
import {
  carregarDeviceIdMercadoPago,
  deviceIdValido,
  lerDeviceIdDoMercadoPago,
} from "./device-id-mercado-pago";
import { emailDeTesteDoMercadoPago } from "./email-de-teste-do-mercado-pago";
import { carregarSdkMercadoPago } from "./sdk-mercado-pago";

/**
 * CARTÃO PELO APP (Fase 3.5, 26/09/2026) — Card Payment Brick do Mercado
 * Pago (`mp.bricks().create("cardPayment", …)`, doc em
 * github.com/mercadopago/sdk-js/blob/main/docs/bricks/card-payment.md).
 *
 * O número, a validade e o CVV do cartão moram em iframes SEGUROS do Mercado
 * Pago dentro do Brick: o nosso código só recebe o `token` de uso único e os
 * metadados (bandeira, tipo, parcelas, documento do titular). NADA do que o
 * Brick entrega é logado — nem em erro.
 *
 * Estados da tela (spec `2026-09-26-cartao-online-design.md`):
 * formulário → (aprovado, confirmando | desafio 3DS → confirmando com o
 * banco | recusado: motivo + outro cartão / PIX | em análise pelo banco).
 * Quem declara o pedido PAGO continua sendo só o webhook/reconciliação — a
 * tela de sucesso vem do tempo real + consulta do CheckoutView, igual ao PIX.
 */

type CriarPagamento = (
  args: ArgsCriarPagamento,
) => Promise<RespostaCriarPagamento>;

type CorpoDoCartao = Extract<ArgsCriarPagamento, { metodo: "cartao" }>;

/** O que o Brick entrega no `onSubmit` (CardData) — lido sem confiar na forma. */
export type DadosDoCartaoDoBrick = {
  readonly token?: unknown;
  readonly payment_method_id?: unknown;
  readonly payment_type_id?: unknown;
  readonly installments?: unknown;
  readonly payer?: {
    readonly email?: unknown;
    readonly identification?: {
      readonly type?: unknown;
      readonly number?: unknown;
    };
  };
};

/** O segundo argumento do `onSubmit` (AdditionalData). */
export type DadosAdicionaisDoBrick = { readonly paymentTypeId?: unknown };

export type ResultadoDoCartao =
  | { readonly tipo: "aprovado" }
  // C6 (P1, 02/10/2026): `paymentId` é o TOKEN DE CERCA da tentativa — a
  // order que o servidor gravou na vaga ANTES de responder. Em análise só
  // existe com ele (C5); no desafio ele pode faltar (`null`), e aí a tela
  // nunca arma a detecção da recusa (ver `CartaoEmCurso`).
  | { readonly tipo: "em-analise"; readonly paymentId: string }
  | {
      readonly tipo: "desafio";
      readonly url: string;
      readonly paymentId: string | null;
    }
  | { readonly tipo: "recusado"; readonly motivo: string }
  | {
      readonly tipo: "erro";
      readonly mensagem: string;
      readonly categoria: CategoriaErroPagamento;
      // B1 (rodada 2 da revisão de risco pré-publicação, 26/09/2026): ver
      // `SinalDeErroPagamento`. Ausente = falha fechada, o CheckoutView não
      // oferece PIX nem some com "Cancelar pedido".
      readonly sinal?: SinalDeErroPagamento;
    }
  // Contrato "forma de cartão desligada" (01/10/2026): o 409 do portão da
  // edge (`codigo: "CARTAO_FORMA_DESLIGADA"`). NÃO afirma ausência de
  // cobrança — o portão roda antes do ramo "reconsultar" da edge —, por isso
  // não carrega `semCobranca` nem sinal nenhum. `tipoRecusado` é o tipo que
  // ESTA chamada enviou: a tela tira só ele, sem esconder o outro tipo que
  // ainda está ligado (ex.: só o débito desligado no meio do pagamento).
  | { readonly tipo: "forma-desligada"; readonly tipoRecusado: TipoDeCartao }
  // C5 (front B2, 02/10/2026): a resposta voltou SEM order confirmada e nada
  // prova que não houve cobrança. Nunca "em análise" (isso exige
  // `paymentId`), nunca PIX nem outro cartão: o pai abre a verificação do C4
  // a partir desta resposta.
  | {
      readonly tipo: "em-duvida";
      readonly pontoDePartida: PontoDePartidaDaVerificacao;
    };

/** O literal do contrato — o mesmo que `useOrders` transporta em `Error.codigo`. */
const CODIGO_FORMA_DESLIGADA = "CARTAO_FORMA_DESLIGADA";

/**
 * O que a tela mostra para a forma desligada ENQUANTO ela é tratada como o
 * erro recuperável de antes: a MESMA frase da edge, que era o `err.message`.
 */
const MENSAGEM_FORMA_DESLIGADA =
  "Esta forma de pagamento não está disponível nesta loja.";

type EtapaDoCartao =
  | { readonly tipo: "formulario" }
  | { readonly tipo: "confirmando-desafio"; readonly paymentId: string | null }
  // Confirmação do cartão sem fim (03/10/2026): a consulta sem cobrança
  // respondeu que o pedido não espera mais pagamento (prazo acabou, pedido
  // cancelado, não encontrado). Sem outro cartão e sem PIX — os dois só
  // bateriam no mesmo 409/404 terminal da edge.
  | { readonly tipo: "encerrado"; readonly mensagem: string }
  | Exclude<
      ResultadoDoCartao,
      { tipo: "erro" } | { tipo: "forma-desligada" } | { tipo: "em-duvida" }
    >;

/** As etapas em que a tela consulta o servidor sozinha (com limite). */
const ETAPAS_QUE_CONSULTAM: ReadonlySet<EtapaDoCartao["tipo"]> = new Set([
  "confirmando-desafio",
  "em-analise",
]);

const MOTIVO_PADRAO_DA_RECUSA =
  "O banco recusou este cartão. Tente outro cartão ou pague com PIX.";

/**
 * C6 (P1, achado B1, 02/10/2026): a vaga da tentativa foi SOLTA depois da
 * resposta do cartão (o banco recusou, ou o desafio 3DS expirou —
 * `canceled:expired` também vira recusa no servidor). A tela não sabe qual
 * dos dois: "não foi concluído", nunca "não foi aprovado" (veredito A2,
 * item 4).
 */
export const MOTIVO_DA_TENTATIVA_ENCERRADA =
  "O pagamento com cartão não foi concluído. Tente outro cartão ou pague com PIX.";

/**
 * C6 (P1): a tentativa de cartão que AINDA pode estar viva no banco. A chave
 * é PEDIDO + TOKEN DE CERCA (mudança obrigatória 2 do revisor financeiro, e
 * o bloqueio da revisão independente do front, 02/10/2026): o `paymentId` do
 * 200 é a order que o servidor gravou na vaga — único entre tentativas E
 * entre montagens desta tela. O contador local (`tentativa`) NÃO serve: ele
 * volta a 0 a cada remontagem ("Tentar de novo" depois de uma falha local,
 * forma desligada, escolha da forma depois da verificação), e a marca de uma
 * tentativa velha chegava a derrubar um 3DS VIVO novo. Marca de outro pedido
 * ou de outro token NUNCA encerra a tentativa atual.
 */
export type CartaoEmCurso = {
  readonly orderId: string;
  readonly paymentId: string;
};

/** As etapas em que a tentativa pode terminar sem o cliente fazer nada. */
const ETAPAS_COM_CARTAO_EM_CURSO: ReadonlySet<EtapaDoCartao["tipo"]> = new Set([
  "desafio",
  "confirmando-desafio",
  "em-analise",
]);

/**
 * O token de cerca da etapa — só não vazio (mudança obrigatória 1 do revisor
 * financeiro). Sem ele, a detecção da recusa NUNCA arma e a tela fica como
 * sempre foi.
 */
function tokenDeCercaDaEtapa(etapa: EtapaDoCartao): string | null {
  if (!ETAPAS_COM_CARTAO_EM_CURSO.has(etapa.tipo)) return null;
  const { paymentId } = etapa as { paymentId?: unknown };
  return textoNaoVazio(paymentId);
}

/**
 * C5: o que vai para o `onErro` de um pai que ainda não sabe abrir a
 * verificação (`onCobrancaEmDuvida` ausente) — com o sinal
 * `cartaoEmAnalise`, que nunca oferece PIX nem "Cancelar pedido".
 */
const MENSAGEM_COBRANCA_EM_DUVIDA =
  "Não conseguimos confirmar com o banco se o pagamento com cartão deste pedido foi feito.";

/**
 * B2 da revisão de risco pré-publicação (26/09/2026): a tela "em análise"
 * (sem desafio, `processing` no MP — antifraude/emissor decidindo) ficava
 * sem saída até a reserva de 30 minutos morrer sozinha. A maioria das
 * decisões sai em segundos; quem cai numa revisão manual mais longa não
 * pode ficar preso. Curto o bastante para sobrar tempo de pagar o PIX
 * dentro da MESMA reserva; longo o bastante para não competir com uma
 * aprovação normal do banco. Seguro por construção: a edge responde 409
 * enquanto o cartão segue `processing` (achado B3, tratado no CheckoutView),
 * nunca cria uma segunda cobrança.
 */
export const MINUTOS_ANTES_DE_OFERECER_PIX_EM_ANALISE = 3;

/**
 * Diagnóstico do checkout (29/09/2026): "Carregando o formulário do
 * cartão..." dependia do script do Mercado Pago carregar, SEM prazo — rede
 * presa deixava o spinner para sempre. O prazo é SÓ para a CARGA do SDK
 * (`Promise.race` local, mesmo helper do PIX): estourou, entra pelo MESMO
 * caminho de SDK que não carrega — `onFalhaDeMontagem` → `semCobranca`
 * (nenhum POST de cartão existiu; o CheckoutView oferece "Pagar com PIX").
 * A fase seguinte (create()/onReady do Brick) continua sem prazo — o Brick
 * tem `onError` próprio para falha crítica; um `create()` que pendura sem
 * nem errar continua sendo a limitação documentada deste arquivo.
 */
export const TEMPO_LIMITE_CARREGAMENTO_SDK_MS = 15_000;

/**
 * Domínios do Mercado Pago que podem hospedar o desafio 3-D Secure e mandar
 * o aviso de "concluído" — os mesmos do `frame-src` do vercel.json.
 */
const DOMINIOS_DO_MERCADO_PAGO = [
  "mercadopago.com",
  "mercadopago.com.br",
  "mercadolibre.com",
  "mercadolivre.com",
  "mercadolivre.com.br",
] as const;

function hostDoMercadoPago(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return DOMINIOS_DO_MERCADO_PAGO.some(
    (dominio) => host === dominio || host.endsWith(`.${dominio}`),
  );
}

/**
 * A origem de um `postMessage` é do Mercado Pago? Só HTTPS e só os domínios
 * da lista — "mercadopago.com.golpe.io" e "http://…" ficam de fora.
 */
export function origemDoMercadoPago(origem: string): boolean {
  try {
    return hostDoMercadoPago(new URL(origem));
  } catch {
    return false;
  }
}

/** A URL do desafio só entra num iframe da nossa tela se for do Mercado Pago. */
export function urlDoDesafioValida(url: unknown): url is string {
  if (typeof url !== "string" || url === "") return false;
  try {
    return hostDoMercadoPago(new URL(url));
  } catch {
    return false;
  }
}

/**
 * A página do desafio avisa o fim com `postMessage({ status: "COMPLETE" })`
 * (doc do 3DS na Orders API). Aceita também o JSON em texto, que alguns
 * navegadores/versões serializam.
 */
export function desafioConcluido(dados: unknown): boolean {
  let valor = dados;
  if (typeof valor === "string") {
    try {
      valor = JSON.parse(valor);
    } catch {
      return false;
    }
  }
  return (
    typeof valor === "object" &&
    valor !== null &&
    (valor as { status?: unknown }).status === "COMPLETE"
  );
}

function textoNaoVazio(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;
}

function tipoDeCartaoConhecido(valor: unknown): valor is TipoDeCartao {
  return valor === "credit_card" || valor === "debit_card";
}

/**
 * Monta o corpo da edge a partir do que o Brick entregou — ou devolve a
 * frase curada de por que não dá. Nada daqui vai para o console.
 */
export function montarCorpoDoCartao({
  orderId,
  dados,
  adicionais,
  config,
  deviceId,
  emailDeTeste = emailDeTesteDoMercadoPago(),
}: {
  orderId: string;
  dados: DadosDoCartaoDoBrick | null | undefined;
  adicionais: DadosAdicionaisDoBrick | null | undefined;
  config: ConfigDoCartao;
  // Device ID do comprador (antifraude do MP; ver `device-id-mercado-pago.ts`).
  // Opcional: ausente ou fora do formato SAI DO CORPO — nunca bloqueia nada.
  deviceId?: string | null;
  // Só a prévia de desenvolvimento (ver `email-de-teste-do-mercado-pago.ts`);
  // fora dela é sempre `null`. Parâmetro só para o teste injetar o ambiente.
  emailDeTeste?: string | null;
}): { ok: true; corpo: CorpoDoCartao } | { ok: false; mensagem: string } {
  const token = textoNaoVazio(dados?.token);
  const paymentMethodId = textoNaoVazio(dados?.payment_method_id);
  if (!token || !paymentMethodId) {
    return {
      ok: false,
      mensagem: "Não foi possível ler os dados do cartão. Tente de novo.",
    };
  }

  // Crédito ou débito: o AdditionalData do Brick é a fonte (o CardData não
  // traz o tipo); com um tipo só ligado na loja, é ele.
  const aceitos = tiposDeCartaoAceitos(config);
  const informado = [adicionais?.paymentTypeId, dados?.payment_type_id].find(
    tipoDeCartaoConhecido,
  );
  const paymentTypeId =
    informado ?? (aceitos.length === 1 ? aceitos[0] : undefined);
  if (!paymentTypeId || !aceitos.includes(paymentTypeId)) {
    return {
      ok: false,
      mensagem:
        paymentTypeId === "debit_card"
          ? "Esta loja não aceita cartão de débito pelo app. Use um cartão de crédito ou pague com PIX."
          : paymentTypeId === "credit_card"
            ? "Esta loja não aceita cartão de crédito pelo app. Use um cartão de débito ou pague com PIX."
            : "Não foi possível identificar se o cartão é de crédito ou débito. Tente de novo.",
    };
  }

  // Débito é sempre à vista; crédito respeita o teto da lojista (o Brick já
  // limita — aqui é a segunda trava, a primeira coisa que o servidor vê).
  const parcelasPedidas = Number(dados?.installments ?? 1);
  const teto = parcelasMaximasNoBrick(config);
  if (
    !Number.isInteger(parcelasPedidas) ||
    parcelasPedidas < 1 ||
    (paymentTypeId === "credit_card" && parcelasPedidas > teto)
  ) {
    return {
      ok: false,
      mensagem: "Escolha o número de parcelas de novo e tente outra vez.",
    };
  }
  const parcelas = paymentTypeId === "debit_card" ? 1 : parcelasPedidas;

  const tipoDoDocumento = textoNaoVazio(
    dados?.payer?.identification?.type,
  )?.toUpperCase();
  const numeroDoDocumento = (
    textoNaoVazio(dados?.payer?.identification?.number) ?? ""
  ).replace(/\D/g, "");
  if (
    (tipoDoDocumento !== "CPF" && tipoDoDocumento !== "CNPJ") ||
    numeroDoDocumento === ""
  ) {
    return {
      ok: false,
      mensagem: "Confira o CPF ou CNPJ do titular do cartão e tente de novo.",
    };
  }

  // Opção de teste ligada: o e-mail da tentativa É o literal de teste, diga o
  // Brick o que disser (omitido ou outro) — a garantia mora aqui, no corpo que
  // vai para a edge, e não no `initialization` do Brick.
  const email = emailDeTeste ?? textoNaoVazio(dados?.payer?.email);
  return {
    ok: true,
    corpo: {
      orderId,
      metodo: "cartao",
      token,
      paymentMethodId,
      paymentTypeId,
      parcelas,
      documento: { type: tipoDoDocumento, number: numeroDoDocumento },
      ...(email ? { email } : {}),
      // snake_case de propósito: é o nome que a edge `criar-pagamento` lê.
      ...(deviceIdValido(deviceId) ? { device_id: deviceId } : {}),
    },
  };
}

/**
 * Traduz a resposta 200 da edge para o que a tela mostra. O contrato do
 * cartão só emite "pago" | "aguardando" | "recusado"; qualquer outra coisa é
 * falha TERMINAL (nunca sucesso silencioso — mesma rede de segurança do PIX,
 * CHECKOUT-080).
 *
 * C5 (front B2, 02/10/2026): "em análise" SÓ com `paymentId` não vazio — a
 * order existe. Sem ela, a resposta é `em-duvida` (ver `ResultadoDoCartao`):
 * o `sem_registro` do C3 decide antes de qualquer status, e o `aguardando`
 * sem order (409 de chave já usada no MP) é o mesmo estado sem a data.
 */
export function classificarRespostaCartao(
  r: RespostaCriarPagamento,
): ResultadoDoCartao {
  const temOrder = textoNaoVazio(r?.paymentId) !== null;
  if (r?.verificacao === "sem_registro") {
    const cancelamento = textoNaoVazio(r.canceladoAutomaticamenteAte);
    return {
      tipo: "em-duvida",
      pontoDePartida: cancelamento
        ? {
            verificacao: "sem_registro",
            canceladoAutomaticamenteAte: cancelamento,
          }
        : { verificacao: "sem_registro" },
    };
  }

  if (r?.statusPagamento === "pago") return { tipo: "aprovado" };

  if (r?.statusPagamento === "aguardando") {
    const paymentId = textoNaoVazio(r.paymentId);
    if (!r.desafio3ds) {
      return paymentId !== null
        ? { tipo: "em-analise", paymentId }
        : {
            tipo: "em-duvida",
            pontoDePartida: { verificacao: "sem_registro" },
          };
    }
    if (urlDoDesafioValida(r.desafio3ds.url)) {
      return { tipo: "desafio", url: r.desafio3ds.url, paymentId };
    }
    // O banco pediu o desafio, mas a URL não é do Mercado Pago — não abrimos
    // endereço desconhecido dentro do checkout. `semCobranca`: a vaga fica em
    // `action_required`/`created`, que `criar-pagamento` CANCELA antes de
    // criar o PIX se o cliente pedir — seguro oferecer PIX aqui (achado B1,
    // rodada 2 da revisão de risco pré-publicação).
    //
    // ACHADO 3 (opcional, rodada 5 — addendum, NÃO CORRIGIDO, documentado de
    // propósito): diferente das outras duas origens de `semCobranca` (falha
    // de validação local em `montarCorpoDoCartao` e falha de montagem do
    // Brick, `onFalhaDeMontagem`) — nas quais NUNCA existiu POST de cartão,
    // logo NUNCA existe vaga `action_required` no servidor —, este caso É
    // diferente: o POST de cartão já aconteceu e a edge respondeu
    // `aguardando` com uma vaga de verdade. Pedir PIX daqui não é um "criar
    // do zero": é um CANCELAR-a-vaga-e-criar-o-PIX, uma operação composta.
    // Se a RESPOSTA desse POST de PIX se perder (rede caindo depois de
    // enviado — o mesmo 502 ambíguo que já cobre o cartão), não sabemos se
    // o servidor cancelou a vaga e criou o PIX, só cancelou, ou não fez
    // nada — e `CheckoutView` já trocou `metodoDoPedido` para "pix" no
    // clique (o botão "Pagar com PIX" da caixa vermelha, condicionado a
    // `erroPagamento.semCobranca`, é um `setMetodoDoPedido("pix")` direto,
    // fora da cadeia `onTrocarParaPix(cartaoAindaVivo)` do achado 2 da
    // rodada 4) — a regra "sem sinal + modo cartão é incerto" não alcança
    // mais este erro, e "Cancelar pedido" pode reaparecer sobre uma vaga
    // que talvez ainda exista.
    //
    // POR QUE NÃO CORRIGIDO AGORA: a correção certa (separar "pode oferecer
    // PIX" de "pode cancelar depois de oferecer") exige um sinal NOVO e
    // DISTINTO de `semCobranca` — só para ESTE branch, não para os outros
    // dois — porque marcar `pedidoTemCobrancaIncerta` para TODO `semCobranca`
    // bloquearia "Cancelar pedido" também nos dois casos onde nunca existiu
    // vaga nenhuma (falso positivo, UX pior sem ganho de segurança). Isso
    // pede: (1) alargar `SinalDeErroPagamento` com o sinal novo; (2)
    // `CheckoutView.onErro` guardar essa distinção num campo novo de
    // `erroPagamento` (hoje só tem `semCobranca`/`cartaoEmAnalise`
    // booleanos); (3) o `onClick` do botão "Pagar com PIX" da caixa
    // vermelha (hoje um `setMetodoDoPedido("pix")` cru) ler esse campo e
    // chamar `setPedidoTemCobrancaIncerta(true)` só quando ele for
    // verdadeiro; (4) testes que provem os TRÊS casos de `semCobranca`
    // separadamente, para não voltar a bloquear cancelar nos dois que não
    // precisam. Superfície comparável ao achado 2 da rodada 4 (que também
    // tocou 3 arquivos) — não é um ajuste de uma linha, e a janela desta
    // rodada não cobre isso com o mesmo rigor de teste-primeiro que o resto
    // do arquivo tem. Fica para uma rodada dedicada.
    return {
      tipo: "erro",
      mensagem:
        "Não foi possível abrir a confirmação do seu banco. Tente de novo ou pague com PIX.",
      categoria: "recuperavel",
      sinal: "semCobranca",
    };
  }

  if (r?.statusPagamento === "recusado") {
    const motivo = textoNaoVazio(r.motivoRecusa);
    // Recusa NÃO mata o pedido (spec, decisão 3): a vaga da cobrança é
    // liberada e o cliente tenta outro cartão ou PIX na mesma reserva. Só
    // quando o servidor diz que não dá mais (`podeTentarDeNovo: false` —
    // reserva vencida, limite de tentativas) a saída é o pedido novo.
    if (r.podeTentarDeNovo === false) {
      return {
        tipo: "erro",
        mensagem:
          motivo ??
          "O pagamento foi recusado e este pedido não aceita nova tentativa. Faça um pedido novo ou fale com a loja.",
        categoria: "terminal",
      };
    }
    return { tipo: "recusado", motivo: motivo ?? MOTIVO_PADRAO_DA_RECUSA };
  }

  if (r?.statusPagamento === "expirado") {
    return {
      tipo: "erro",
      mensagem:
        "O prazo para pagar este pedido acabou. Faça um pedido novo para tentar de novo.",
      categoria: "terminal",
    };
  }
  if (r?.statusPagamento === "estornado") {
    return {
      tipo: "erro",
      mensagem:
        "Este pagamento foi estornado e não pode ser confirmado neste pedido. Faça um pedido novo ou fale com a loja.",
      categoria: "terminal",
    };
  }
  // Achado 3, rodada 4 da revisão de risco pré-publicação (26/09/2026): um
  // status desconhecido ou ausente num 200 NÃO é o mesmo que "morto" — a
  // edge devolve o status CRU de um cartão vivo que ela ainda não sabe
  // mapear (branch (d), `criar-pagamento/index.ts`). Tratar como terminal
  // fechava a tela sem saída nenhuma (nem "Cancelar pedido", porque este
  // erro nem carrega o sinal `cartaoEmAnalise` que esconderia o botão — a
  // tela ficava com "Cancelar pedido" como ÚNICA ação sobre um cartão que
  // podia estar vivo). `sinal: "cartaoEmAnalise"` joga para a caixa âmbar
  // com "Tentar de novo" — seguro, porque a nova tentativa converge pela
  // MESMA branch (d): nunca uma segunda cobrança.
  //
  // C5: sem `paymentId` nem isso — nada diz que existe order, e nada prova
  // que não existe. Em dúvida, com a verificação começando de "não foi
  // possível consultar".
  if (!temOrder) {
    return {
      tipo: "em-duvida",
      pontoDePartida: { verificacao: "indisponivel" },
    };
  }
  return {
    tipo: "erro",
    mensagem: "Não foi possível confirmar o pagamento.",
    categoria: "recuperavel",
    sinal: "cartaoEmAnalise",
  };
}

/**
 * O `onSubmit` do Brick sem o Brick: valida, chama a edge e classifica.
 * Nunca lança — erro de rede/servidor vira `{ tipo: "erro" }` com a
 * categoria que a edge mandou (`.terminal`, CHECKOUT-050).
 *
 * Exportada para teste — não é API pública do componente.
 */
export async function enviarPagamentoComCartao({
  orderId,
  dados,
  adicionais,
  config,
  criarPagamento,
  deviceId,
}: {
  orderId: string;
  dados: DadosDoCartaoDoBrick | null | undefined;
  adicionais: DadosAdicionaisDoBrick | null | undefined;
  config: ConfigDoCartao;
  criarPagamento: CriarPagamento;
  deviceId?: string | null;
}): Promise<ResultadoDoCartao> {
  const montagem = montarCorpoDoCartao({
    orderId,
    dados,
    adicionais,
    config,
    deviceId,
  });
  if (!montagem.ok) {
    // `semCobranca`: a validação é LOCAL — nenhum POST chegou à edge (achado
    // B1, rodada 2 da revisão de risco pré-publicação). Seguro oferecer PIX.
    return {
      tipo: "erro",
      mensagem: montagem.mensagem,
      categoria: "recuperavel",
      sinal: "semCobranca",
    };
  }
  try {
    return classificarRespostaCartao(await criarPagamento(montagem.corpo));
  } catch (err: any) {
    // Mesmas fontes curadas do PIX (ver o catch de `dispararPagamentoPix`):
    // `criarPagamento` só lança texto da nossa edge ou o literal padrão.
    //
    // SEM `sinal: "semCobranca"` aqui de propósito (achado B1, rodada 2): um
    // POST de cartão JÁ chegou à edge — um 502 ambíguo pode significar que o
    // Mercado Pago aprovou e a resposta se perdeu (reproduzido: duas
    // cobranças vivas quando o front oferecia PIX cegamente aqui). Só
    // `cartaoEmAnalise`, quando a edge confirma isso explicitamente no corpo
    // do erro — nunca PIX nem "Cancelar pedido" nesse caso.
    //
    // Forma de cartão desligada: só com o código EXATO e quando o MESMO erro
    // não traz sinal mais forte — `terminal` ou `cartaoEmAnalise` vencem
    // (prioridade de segurança: nunca rebaixar um cartão em análise ou um
    // fim de linha para "forma desligada").
    //
    // C5: o 503 `verificacao: "indisponivel"` do C3 — a edge não conseguiu
    // conferir uma cobrança em dúvida. Nunca "tente de novo com o cartão"
    // (token novo sobre a dúvida): a verificação, que só consulta. O
    // `terminal` vence, como em toda a cadeia.
    if (err?.verificacao === "indisponivel" && err?.terminal !== true) {
      return {
        tipo: "em-duvida",
        pontoDePartida: { verificacao: "indisponivel" },
      };
    }
    if (
      err?.codigo === CODIGO_FORMA_DESLIGADA &&
      err?.terminal !== true &&
      err?.cartaoEmAnalise !== true
    ) {
      return {
        tipo: "forma-desligada",
        tipoRecusado: montagem.corpo.paymentTypeId,
      };
    }
    return {
      tipo: "erro",
      mensagem: err?.message ?? "Não foi possível gerar a cobrança.",
      categoria: err?.terminal === true ? "terminal" : "recuperavel",
      sinal: err?.cartaoEmAnalise === true ? "cartaoEmAnalise" : undefined,
    };
  }
}

/** `BrickError.type` — só o "critical" derruba a tela; o resto o Brick mostra. */
function erroCriticoDoBrick(erro: unknown): boolean {
  return (erro as { type?: unknown } | null)?.type !== "non_critical";
}

/**
 * Monta o Card Payment Brick e devolve a função de desmontagem do efeito.
 *
 * Mesmo desenho do antigo `montarBrick` (Payment Brick, aposentado com o
 * PIX direto de 25/09/2026): `cancelado` é checado antes do `create()` (a
 * montagem cancelada pelo StrictMode nunca cria nada) e depois dele (criação
 * que terminou com o efeito já cancelado é desmontada na hora — sem isso o
 * SDK reclama "Brick already initialized" na montagem seguinte).
 *
 * Exportada para teste — não é API pública do componente.
 */
export function montarBrickDeCartao({
  containerId,
  valor,
  config,
  emailDoPagador,
  onEnviar,
  onFalhaDeMontagem,
  onPronto,
}: {
  containerId: string;
  valor: number;
  config: ConfigDoCartao;
  emailDoPagador?: string | null;
  onEnviar: (
    dados: DadosDoCartaoDoBrick,
    adicionais?: DadosAdicionaisDoBrick,
  ) => Promise<void>;
  onFalhaDeMontagem: () => void;
  onPronto: () => void;
}): () => void {
  let cancelado = false;
  let controlador: { unmount: () => void } | null = null;

  (async () => {
    try {
      // Device ID do antifraude (03/10/2026): o security.js do MP entra AGORA,
      // em paralelo com o SDK — só quando o cartão vai ser montado (lazy; o
      // PIX e o boot do app não pagam por isso). Não se espera por ele: a
      // coleta é assíncrona, o valor é lido no envio (`onEnviar`) e a falta
      // dele nunca bloqueia o Brick nem o pagamento (o loader nunca lança).
      carregarDeviceIdMercadoPago();

      // Com prazo: a carga do SDK é a fase do "Carregando o formulário do
      // cartão..." — estourou, a falha de montagem de abaixo é o caminho que
      // o componente já tem para SDK que não carrega (ver
      // TEMPO_LIMITE_CARREGAMENTO_SDK_MS, acima). A promessa memoizada do
      // loader continua valendo: um "Tentar de novo" reusa o script se ele
      // terminou de carregar entre o estouro e o toque.
      await comTempoLimite(
        carregarSdkMercadoPago(),
        TEMPO_LIMITE_CARREGAMENTO_SDK_MS,
      );
      if (cancelado) return;

      const publicKey = chavePublicaMercadoPago();
      if (!publicKey) throw new Error("Pagamento indisponível.");

      // @ts-expect-error o SDK entra pelo global
      const mp = new globalThis.MercadoPago(publicKey, { locale: "pt-BR" });
      // Prévia de desenvolvimento com a opção de teste: o Brick já nasce com o
      // e-mail de teste (o corpo também o força — ver `montarCorpoDoCartao`).
      const email =
        emailDeTesteDoMercadoPago() ?? textoNaoVazio(emailDoPagador);

      const criado = await mp.bricks().create("cardPayment", containerId, {
        initialization: {
          amount: valor,
          // Com o e-mail da conta preenchido, o Brick esconde o campo — o
          // cliente logado não digita de novo o que a loja já sabe.
          ...(email ? { payer: { email } } : {}),
        },
        customization: {
          paymentMethods: {
            minInstallments: 1,
            maxInstallments: parcelasMaximasNoBrick(config),
            types: { included: tiposDeCartaoAceitos(config) },
          },
        },
        callbacks: {
          onReady: () => {
            if (!cancelado) onPronto();
          },
          onError: (erro: unknown) => {
            // Só o tipo e a causa — o objeto do Brick não é despejado inteiro.
            const { type, cause } = (erro ?? {}) as {
              type?: unknown;
              cause?: unknown;
            };
            console.error("brick de cartão:", type, cause);
            if (!cancelado && erroCriticoDoBrick(erro)) onFalhaDeMontagem();
          },
          onSubmit: (
            dados: DadosDoCartaoDoBrick,
            adicionais?: DadosAdicionaisDoBrick,
          ) => onEnviar(dados, adicionais),
        },
      });

      if (cancelado) {
        criado.unmount();
        return;
      }
      controlador = criado;
    } catch (err) {
      // SDK que não carregou, chave pública ausente ou create() que falhou:
      // nenhuma cobrança existe. NUNCA `err?.message` na tela (texto do
      // bundle do MP, em inglês — achado 2 do CHECKOUT-050); o erro vai só
      // para o console.
      console.error("montarBrickDeCartao:", err);
      if (!cancelado) onFalhaDeMontagem();
    }
  })();

  return () => {
    cancelado = true;
    controlador?.unmount();
    controlador = null;
  };
}

export function PagamentoComCartao({
  orderId,
  valor,
  config,
  emailDoPagador,
  onErro,
  onFormaDesligada,
  onPagarComPix,
  onCobrancaEmDuvida,
  onCartaoEmCurso,
  cartaoEncerrado = null,
  onCartaoEncerradoPelaConsulta,
  onVerMeusPedidos,
  sessaoAtiva = true,
  onEntrarDeNovo,
}: {
  orderId: string;
  valor: number;
  config: ConfigDoCartao;
  emailDoPagador?: string | null;
  // Terceiro parâmetro opcional — ver `SinalDeErroPagamento`.
  onErro: (
    msg: string,
    categoria: CategoriaErroPagamento,
    sinal?: SinalDeErroPagamento,
  ) => void;
  onFormaDesligada?: (tipoRecusado: TipoDeCartao) => void;
  // Achado 2, rodada 4 da revisão de risco pré-publicação (26/09/2026):
  // `cartaoAindaVivo` diz ao CheckoutView se a cobrança de cartão pode
  // AINDA existir no momento da troca — antes de qualquer erro do PIX
  // acontecer. Sem isso, o marcador `pedidoTemCobrancaIncerta` só nascia
  // dentro de `onErro`, e a troca em si (`metodoDoPedido` já vira "pix" NA
  // HORA do clique) escapava da regra "sem sinal em modo cartão é incerto":
  // se o pedido de PIX seguinte falhasse sem corpo (rede caiu), a tela já
  // não estava mais em modo cartão, e "Cancelar pedido" reaparecia sobre um
  // cartão que podia ter sido aprovado (desafio 3DS, "confirmando com o
  // banco" ou "em análise" — as três telas de onde dá pra chamar isto com o
  // cartão vivo). Só a tela "recusado" chama com `false`: o banco já
  // respondeu que o cartão morreu.
  onPagarComPix: (cartaoAindaVivo: boolean) => void;
  // C5: a resposta voltou sem order confirmada (`em-duvida`) — o pai abre a
  // verificação a partir dela. Ausente: cai no `onErro` com o sinal
  // `cartaoEmAnalise` (falha fechada: nunca PIX, nunca "Cancelar pedido").
  onCobrancaEmDuvida?: (pontoDePartida: PontoDePartidaDaVerificacao) => void;
  // C6 (P1): avisa o pai qual tentativa está em curso — `CartaoEmCurso` só
  // com o token de cerca (o `paymentId` da resposta 200), `null` fora disso.
  // O pai lê a vaga do pedido e devolve `cartaoEncerrado` quando ela foi
  // solta DEPOIS deste aviso.
  onCartaoEmCurso?: (cartao: CartaoEmCurso | null) => void;
  cartaoEncerrado?: CartaoEmCurso | null;
  // Confirmação do cartão sem fim (03/10/2026): a consulta sem cobrança
  // provou a vaga DESTA tentativa solta — o pai grava a mesma marca do C6
  // (`cartaoEncerrado`), que volta para cá como a recusa de sempre.
  onCartaoEncerradoPelaConsulta?: (cartao: CartaoEmCurso) => void;
  // Ausente = o botão "Ver meus pedidos" não aparece.
  onVerMeusPedidos?: () => void;
  // `false` = o cliente perdeu a sessão: a edge recusa a consulta (404 de
  // dono) e a verificação periódica do pai nem roda. A tela pede para entrar
  // de novo — nunca oferece PIX nem outro cartão (cobrança nova) nesse
  // estado, e não consulta nada sem conta.
  sessaoAtiva?: boolean;
  onEntrarDeNovo?: () => void;
}) {
  // Mesma escolha do PIX: só `criarPagamento`, sem realtime — quem vê o
  // pedido virar pago é o CheckoutView.
  const { criarPagamento } = useOrders(false, false);
  const [etapa, setEtapa] = useState<EtapaDoCartao>({ tipo: "formulario" });
  // Cada "Tentar outro cartão" remonta o Brick do zero: formulário limpo e
  // token novo (o anterior é de uso único).
  const [tentativa, setTentativa] = useState(0);
  const [formularioPronto, setFormularioPronto] = useState(false);

  // Padrão de ref para callback em recurso imperativo (ver o onErroRef do
  // PagamentoOnline): a identidade de `onErro` muda a cada render do pai e
  // não pode desmontar o Brick com o cliente no meio da digitação.
  const onErroRef = useRef(onErro);
  const onFormaDesligadaRef = useRef(onFormaDesligada);
  const onCobrancaEmDuvidaRef = useRef(onCobrancaEmDuvida);
  const onCartaoEmCursoRef = useRef(onCartaoEmCurso);
  const onCartaoEncerradoPelaConsultaRef = useRef(
    onCartaoEncerradoPelaConsulta,
  );
  useEffect(() => {
    onErroRef.current = onErro;
    onFormaDesligadaRef.current = onFormaDesligada;
    onCobrancaEmDuvidaRef.current = onCobrancaEmDuvida;
    onCartaoEmCursoRef.current = onCartaoEmCurso;
    onCartaoEncerradoPelaConsultaRef.current = onCartaoEncerradoPelaConsulta;
  });
  const montadoRef = useRef(false);
  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
    };
  }, []);

  // `useId` devolve algo como ":r3:" — o Brick procura o contêiner pelo id,
  // e dois-pontos atrapalham seletor CSS.
  const idCru = useId();
  const idDoContainer = `mp-cartao-${idCru.replace(/[^\w-]/g, "")}`;
  const idTitulo = useId();

  const { credito, debito, parcelasMax } = config;
  const formularioAtivo = etapa.tipo === "formulario";

  useEffect(() => {
    if (!formularioAtivo) return;
    const configDoBrick: ConfigDoCartao = { credito, debito, parcelasMax };
    return montarBrickDeCartao({
      containerId: idDoContainer,
      valor,
      config: configDoBrick,
      emailDoPagador,
      onPronto: () => setFormularioPronto(true),
      onFalhaDeMontagem: () =>
        // `semCobranca`: o Brick nem chegou a montar (SDK que não carregou,
        // chave pública ausente, `create()` que falhou, COEP bloqueando o
        // iframe) — nenhum POST de cartão foi feito. Seguro oferecer PIX
        // (achado B1, rodada 2 da revisão de risco pré-publicação).
        //
        // Rodada 7 (corrige o addendum da rodada 6): aquele addendum tirou
        // "COEP bloqueando o iframe" da lista dizendo que "o COEP saiu do
        // app" — falso NESTA branch: o COEP sai com a branch
        // `fix/coep-sai-do-app`, ainda não mesclada aqui. A causa volta pra
        // lista até esse merge acontecer. O teste do Brick contra o Mercado
        // Pago de verdade continua no runbook, não numa suíte deste
        // repositório.
        onErroRef.current(
          "Não foi possível carregar o pagamento.",
          "recuperavel",
          "semCobranca",
        ),
      onEnviar: async (dados, adicionais) => {
        const resultado = await enviarPagamentoComCartao({
          orderId,
          dados,
          adicionais,
          config: configDoBrick,
          criarPagamento,
          // Lido NO ENVIO: a coleta do security.js é assíncrona e termina
          // enquanto o cliente digita; ausente, o pagamento segue sem ele.
          deviceId: lerDeviceIdDoMercadoPago(),
        });
        if (!montadoRef.current) return;
        if (resultado.tipo === "forma-desligada") {
          // O pai atualiza a opção de pagamento sem transformar o código em
          // uma afirmação de que não há cobrança. Chamadores antigos seguem
          // pelo erro conservador até passarem o callback novo.
          if (onFormaDesligadaRef.current) {
            onFormaDesligadaRef.current(resultado.tipoRecusado);
          } else {
            onErroRef.current(MENSAGEM_FORMA_DESLIGADA, "recuperavel");
          }
          throw new Error(MENSAGEM_FORMA_DESLIGADA);
        }
        if (resultado.tipo === "em-duvida") {
          if (onCobrancaEmDuvidaRef.current) {
            onCobrancaEmDuvidaRef.current(resultado.pontoDePartida);
          } else {
            onErroRef.current(
              MENSAGEM_COBRANCA_EM_DUVIDA,
              "recuperavel",
              "cartaoEmAnalise",
            );
          }
          // Relança para o Brick sair do "processando" (mesmo motivo do erro).
          throw new Error(MENSAGEM_COBRANCA_EM_DUVIDA);
        }
        if (resultado.tipo === "erro") {
          if (resultado.sinal) {
            onErroRef.current(
              resultado.mensagem,
              resultado.categoria,
              resultado.sinal,
            );
          } else {
            onErroRef.current(resultado.mensagem, resultado.categoria);
          }
          // Relança para o Brick sair do "processando" — engolir prende o
          // botão.
          throw new Error(resultado.mensagem);
        }
        // Sair do formulário desmonta o Brick (limpeza deste efeito); o
        // contêiner continua no DOM, só escondido, até lá.
        setEtapa(resultado);
      },
    });
  }, [
    formularioAtivo,
    tentativa,
    idDoContainer,
    valor,
    credito,
    debito,
    parcelasMax,
    emailDoPagador,
    orderId,
    criarPagamento,
  ]);

  // 3-D Secure: a página do desafio avisa por `postMessage` quando o cliente
  // termina. O aviso só diz que TERMINOU — aprovado ou não quem diz é o
  // webhook (o CheckoutView troca a tela quando o pedido vira pago).
  const emDesafio = etapa.tipo === "desafio";
  useEffect(() => {
    if (!emDesafio) return;
    const aoReceberMensagem = (evento: MessageEvent) => {
      if (!origemDoMercadoPago(evento.origin)) return;
      if (!desafioConcluido(evento.data)) return;
      setEtapa((atual) => ({
        tipo: "confirmando-desafio",
        paymentId: atual.tipo === "desafio" ? atual.paymentId : null,
      }));
    };
    globalThis.addEventListener("message", aoReceberMensagem);
    return () => globalThis.removeEventListener("message", aoReceberMensagem);
  }, [emDesafio]);

  // C6 (P1, achado B1): a tentativa armada — só nas etapas em que o cartão
  // pode terminar sem o cliente fazer nada, e só com o token de cerca.
  const tokenDeCerca = tokenDeCercaDaEtapa(etapa);
  useEffect(() => {
    if (tokenDeCerca === null) return;
    onCartaoEmCursoRef.current?.({ orderId, paymentId: tokenDeCerca });
    return () => onCartaoEmCursoRef.current?.(null);
  }, [tokenDeCerca, orderId]);

  // O pai provou (leitura da vaga DEPOIS do aviso acima) que a vaga desta
  // tentativa foi solta: recusa visível, com as duas saídas da recusa — o
  // cartão está morto por prova, então "Pagar com PIX" aqui é `false`. Quem
  // decide é o TOKEN: a marca precisa ser deste pedido E desta order.
  const encerradoAqui =
    tokenDeCerca !== null &&
    cartaoEncerrado !== null &&
    cartaoEncerrado.orderId === orderId &&
    cartaoEncerrado.paymentId === tokenDeCerca;
  useEffect(() => {
    if (!encerradoAqui) return;
    setEtapa({ tipo: "recusado", motivo: MOTIVO_DA_TENTATIVA_ENCERRADA });
  }, [encerradoAqui]);

  // ── Confirmação do cartão sem fim (03/10/2026) ──────────────────────────
  // "Confirmando com o banco…" e "em análise" consultam o SERVIDOR sozinhos,
  // numa cadência limitada (`ESPERAS_DA_CONFIRMACAO_MS`), com a consulta SEM
  // COBRANÇA (`verificar`: só GET no Mercado Pago e a RPC de liberação por
  // prova). Antes, a tela só esperava o pedido virar `pago` no banco — sem
  // webhook válido ela girava para sempre (ver `confirmacao-do-cartao.ts`).
  //
  // O que esta consulta NUNCA faz: POST de cobrança, cancelamento, escrita
  // de status pelo front, ou conclusão de "aprovado" sem o servidor dizer
  // `pago`. Sem resposta final ao fim da cadência, a tela PARA de girar e diz
  // a verdade ("o banco ainda não respondeu"), com "Verificar de novo" — e o
  // cartão continua tratado como VIVO (a tentativa segue armada para o pai, e
  // "Pagar com PIX" continua `true`: a edge cancela o cartão ou responde 409).
  //
  // Cerca contra resposta velha: a consulta pertence à CHAVE (tentativa do
  // formulário + token de cerca) e à rodada; trocar qualquer um cancela a
  // consulta em voo (o `.then` não pinta nada) e o `setEtapa` só age se a
  // etapa ATUAL ainda for uma que consulta.
  const consultaAtiva =
    ETAPAS_QUE_CONSULTAM.has(etapa.tipo) && sessaoAtiva !== false;
  const chaveDaConsulta = `${tentativa}|${tokenDeCerca ?? ""}`;
  const [consultaParada, setConsultaParada] = useState<{
    readonly chave: string;
  } | null>(null);
  const [rodadaDaConsulta, setRodadaDaConsulta] = useState<{
    readonly chave: string;
    readonly numero: number;
  }>({ chave: "", numero: 0 });
  const paradaAqui = consultaParada?.chave === chaveDaConsulta;
  const rodadaAqui =
    rodadaDaConsulta.chave === chaveDaConsulta ? rodadaDaConsulta.numero : 0;
  const ultimaConsultaEmRef = useRef(0);

  // NO MÁXIMO UMA consulta REAL pendente por tela (achado 1 da revisão
  // independente, 03/10/2026): o tempo limite é só da TELA — ele não aborta
  // a chamada (o `functions.invoke` não recebe sinal de cancelamento aqui).
  // Estourado o limite, a cadência segue SEM ela: enquanto a chamada
  // pendurada não voltar, cada tentativa seguinte conta como "sem resposta"
  // e nenhuma outra chamada abre; e o ref atravessa as rodadas (trocar a
  // chave ou tocar "Verificar de novo" também não abre uma segunda chamada
  // em paralelo). Chamada que nunca volta: a cadência termina do mesmo jeito
  // no estado explícito "o banco ainda não confirmou", sem spinner.
  const consultaPendenteRef = useRef<Promise<unknown> | null>(null);

  useEffect(() => {
    if (!consultaAtiva || paradaAqui) return;
    const cerca = tokenDeCerca;
    const esperas =
      rodadaAqui === 0
        ? ESPERAS_DA_CONFIRMACAO_MS
        : ESPERAS_DA_RODADA_MANUAL_MS;
    let cancelado = false;
    let esperandoAAba = false;
    let indice = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const parar = () => {
      if (!cancelado) setConsultaParada({ chave: chaveDaConsulta });
    };
    const agendar = () => {
      if (cancelado) return;
      if (indice >= esperas.length) {
        parar();
        return;
      }
      timer = setTimeout(disparar, esperas.at(indice) ?? 0);
    };
    const aindaConsulta = (atual: EtapaDoCartao) =>
      ETAPAS_QUE_CONSULTAM.has(atual.tipo);

    // `podeAgendar = false`: a resposta chegou DEPOIS do limite da tela — a
    // cadência já seguiu sem ela (há outra espera agendada). Um desfecho
    // final ainda vale (é a resposta do servidor, e nenhuma outra chamada
    // rodou em paralelo); um "continue esperando" não agenda nada de novo.
    const aplicar = (
      resultado:
        | { readonly ok: true; readonly resposta: unknown }
        | { readonly ok: false; readonly erro: unknown },
      podeAgendar: boolean,
    ) => {
      const seguir = () => {
        if (podeAgendar) agendar();
      };
      if (!resultado.ok) {
        const doErro = desfechoDoErroDaConsulta(resultado.erro);
        if (doErro.tipo === "terminal") {
          setEtapa((atual) =>
            aindaConsulta(atual)
              ? { tipo: "encerrado", mensagem: doErro.mensagem }
              : atual,
          );
          return;
        }
        seguir();
        return;
      }
      const desfecho = desfechoDaConsultaDoCartao(resultado.resposta, {
        cerca,
      });
      switch (desfecho.tipo) {
        case "aprovado":
          setEtapa((atual) =>
            aindaConsulta(atual) ? { tipo: "aprovado" } : atual,
          );
          return;
        case "em-analise":
          // Ressalva B4 da revisão de risco: vindo do 3DS SEM token, o
          // `paymentId` desta resposta vira o token de cerca e arma o C6 do
          // pai. Seguro pela invariante da vaga: o arme acontece DEPOIS da
          // leitura que viu essa order na vaga, então uma vaga vazia depois
          // prova que ela foi solta. A chave da consulta muda uma vez só
          // (null → order); outra order depois disso vira `indefinida`.
          setEtapa((atual) =>
            atual.tipo === "confirmando-desafio"
              ? { tipo: "em-analise", paymentId: desfecho.paymentId }
              : atual,
          );
          seguir();
          return;
        case "aguardando-banco":
        case "sem-resposta":
          seguir();
          return;
        case "encerrada":
          // `cerca` não nula por construção (`desfechoDaConsultaDoCartao`).
          if (cerca !== null) {
            onCartaoEncerradoPelaConsultaRef.current?.({
              orderId,
              paymentId: cerca,
            });
          }
          setEtapa((atual) =>
            aindaConsulta(atual)
              ? { tipo: "recusado", motivo: MOTIVO_DA_TENTATIVA_ENCERRADA }
              : atual,
          );
          return;
        case "indefinida":
          parar();
          return;
      }
    };

    function disparar() {
      timer = undefined;
      if (cancelado) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        // Aba escondida: espera ela voltar, sem gastar a tentativa.
        esperandoAAba = true;
        return;
      }
      esperandoAAba = false;
      if (consultaPendenteRef.current !== null) {
        // Uma chamada (desta rodada ou de outra) ainda não voltou — e pode
        // NUNCA voltar. Não abre uma segunda: a tentativa conta como "sem
        // resposta" e o relógio segue, então a cadência SEMPRE termina no
        // estado explícito "o banco ainda não confirmou" (bloqueio da
        // revisão independente: esperar a pendente sem prazo deixava o
        // spinner infinito de novo).
        indice += 1;
        agendar();
        return;
      }
      indice += 1;
      ultimaConsultaEmRef.current = Date.now();
      let venceuOLimite = false;
      const limite = setTimeout(() => {
        venceuOLimite = true;
        // A tela não espera mais por esta chamada: conta como "sem
        // resposta" e a cadência segue (a próxima espera a pendente).
        agendar();
      }, TEMPO_LIMITE_DA_CONSULTA_DO_CARTAO_MS);
      const chamada = criarPagamento({ orderId, metodo: "verificar" }).then(
        (resposta) => ({ ok: true as const, resposta }),
        (erro: unknown) => ({ ok: false as const, erro }),
      );
      consultaPendenteRef.current = chamada;
      chamada.then((resultado) => {
        if (consultaPendenteRef.current === chamada) {
          consultaPendenteRef.current = null;
        }
        clearTimeout(limite);
        if (cancelado || !montadoRef.current) return;
        aplicar(resultado, !venceuOLimite);
      });
    }

    const aoVoltarAFicarVisivel = () => {
      if (
        esperandoAAba &&
        typeof document !== "undefined" &&
        document.visibilityState === "visible"
      ) {
        disparar();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", aoVoltarAFicarVisivel);
    }
    agendar();

    return () => {
      cancelado = true;
      if (timer !== undefined) clearTimeout(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", aoVoltarAFicarVisivel);
      }
    };
  }, [
    consultaAtiva,
    paradaAqui,
    rodadaAqui,
    chaveDaConsulta,
    tokenDeCerca,
    orderId,
    criarPagamento,
  ]);

  // Cadência parada sem resposta final: a volta para a aba (o cliente foi ao
  // app do banco e voltou) abre UMA rodada curta — no máximo uma a cada 30 s
  // e no máximo `RETOMADAS_PELA_ABA_DA_CONFIRMACAO` por tentativa (achado 2
  // da revisão independente: sem teto, idas e voltas repetidas consultavam
  // sem limite). Não gasta os toques do "Verificar de novo".
  const [retomadasPelaAba, setRetomadasPelaAba] = useState<{
    readonly chave: string;
    readonly vezes: number;
  }>({ chave: "", vezes: 0 });
  const retomadasAqui =
    retomadasPelaAba.chave === chaveDaConsulta ? retomadasPelaAba.vezes : 0;
  const podeRetomarPelaAba = retomadasAqui < RETOMADAS_PELA_ABA_DA_CONFIRMACAO;
  useEffect(() => {
    if (!consultaAtiva || !paradaAqui || !podeRetomarPelaAba) return;
    if (typeof document === "undefined") return;
    const aoVoltar = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - ultimaConsultaEmRef.current < 30_000) return;
      setRetomadasPelaAba({
        chave: chaveDaConsulta,
        vezes: retomadasAqui + 1,
      });
      setConsultaParada(null);
      setRodadaDaConsulta({ chave: chaveDaConsulta, numero: rodadaAqui + 1 });
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => document.removeEventListener("visibilitychange", aoVoltar);
  }, [
    consultaAtiva,
    paradaAqui,
    podeRetomarPelaAba,
    chaveDaConsulta,
    retomadasAqui,
    rodadaAqui,
  ]);

  // "Verificar de novo": uma rodada curta por toque, no máximo
  // `RODADAS_MANUAIS_DA_CONFIRMACAO` por tentativa.
  const [toquesDeVerificar, setToquesDeVerificar] = useState<{
    readonly chave: string;
    readonly toques: number;
  }>({ chave: "", toques: 0 });
  const toquesAqui =
    toquesDeVerificar.chave === chaveDaConsulta ? toquesDeVerificar.toques : 0;
  const podeVerificarDeNovo =
    paradaAqui && toquesAqui < RODADAS_MANUAIS_DA_CONFIRMACAO;
  const verificarDeNovo = () => {
    if (!podeVerificarDeNovo) return;
    setToquesDeVerificar({ chave: chaveDaConsulta, toques: toquesAqui + 1 });
    setConsultaParada(null);
    setRodadaDaConsulta({ chave: chaveDaConsulta, numero: rodadaAqui + 1 });
  };

  // Aprovado pelo banco, pedido ainda não confirmado no nosso banco (quem
  // grava é o servidor: a confirmação imediata que a criação dispara em
  // segundo plano pela prova do GET, o webhook ou a reconciliação): depois de
  // um minuto a tela avisa que pode demorar e oferece "Ver meus pedidos" —
  // sem nunca oferecer pagar de novo. A tela NÃO consulta nada nesta etapa.
  const aprovado = etapa.tipo === "aprovado";
  const [avisoDoAprovado, setAvisoDoAprovado] = useState(false);
  useEffect(() => {
    if (!aprovado) {
      setAvisoDoAprovado(false);
      return;
    }
    const id = setTimeout(
      () => setAvisoDoAprovado(true),
      ESPERA_ANTES_DO_AVISO_DO_APROVADO_MS,
    );
    return () => clearTimeout(id);
  }, [aprovado]);

  // Sem sessão depois que o banco já recebeu o cartão: nada de PIX nem de
  // outro cartão (cobrança nova sem dono confirmado) — só entrar de novo /
  // ver os pedidos. O desafio 3DS ABERTO fica de fora: ele é a página do
  // banco e não depende da nossa sessão para ser concluído.
  const semSessaoComCartaoVivo =
    sessaoAtiva === false &&
    (ETAPAS_QUE_CONSULTAM.has(etapa.tipo) || etapa.tipo === "aprovado");

  const tentarOutroCartao = () => {
    setFormularioPronto(false);
    setTentativa((n) => n + 1);
    setEtapa({ tipo: "formulario" });
  };

  // B2: depois de alguns minutos "em análise", oferece PIX como saída (ver o
  // comentário de MINUTOS_ANTES_DE_OFERECER_PIX_EM_ANALISE, acima). Mesmo
  // padrão do relógio do prazo do PIX (`PagamentoOnline.tsx`): um `setInterval`
  // que só reage ao relógio, nunca decide nada sozinho — quem aprova continua
  // sendo o banco/webhook. Estado, não ref: o valor entra na conta de
  // `pixDisponivelNaAnalise` durante o RENDER, e ref não pode ser lida ali
  // (react-hooks/refs — "Cannot access ref value during render").
  const emAnalise = etapa.tipo === "em-analise";
  const [inicioDaAnalise, setInicioDaAnalise] = useState<number | null>(null);
  const [agoraNaAnalise, setAgoraNaAnalise] = useState(() => Date.now());
  useEffect(() => {
    if (!emAnalise) {
      setInicioDaAnalise(null);
      return;
    }
    const agora = Date.now();
    setInicioDaAnalise(agora);
    setAgoraNaAnalise(agora);
    const id = setInterval(() => setAgoraNaAnalise(Date.now()), 10_000);
    return () => clearInterval(id);
  }, [emAnalise]);
  const pixDisponivelNaAnalise =
    inicioDaAnalise !== null &&
    agoraNaAnalise - inicioDaAnalise >=
      MINUTOS_ANTES_DE_OFERECER_PIX_EM_ANALISE * 60_000;

  const valorConhecido = Number.isFinite(valor) && valor > 0;

  return (
    <section
      aria-labelledby={idTitulo}
      className="mx-auto w-full max-w-md space-y-4 rounded-2xl border border-zinc-100 bg-white p-4 sm:p-6"
    >
      <header className="space-y-1 text-center">
        <h2
          id={idTitulo}
          className="text-xs font-bold uppercase tracking-wider text-zinc-500"
        >
          Pagamento com cartão
        </h2>
        {valorConhecido && (
          <p className="text-3xl font-black tabular-nums text-zinc-900">
            {formatCurrency(valor)}
          </p>
        )}
        {orderId && (
          <p className="text-xs text-zinc-500">
            Pedido #{numeroDoPedido(orderId)}
          </p>
        )}
      </header>

      {/* Região viva sempre montada: o leitor de tela só anuncia mudança em
          região que já existia (mesmo motivo do aviso de horário do PIX). */}
      <div aria-live="polite" className="space-y-3">
        {etapa.tipo === "recusado" && (
          <div className="space-y-3 rounded-xl border border-red-100 bg-red-50 p-3">
            <div className="flex items-start gap-2">
              <AlertCircle
                aria-hidden="true"
                className="mt-0.5 size-5 shrink-0 text-red-500"
              />
              <p className="text-sm font-medium text-red-700">{etapa.motivo}</p>
            </div>
            <div className="grid gap-2">
              <button
                type="button"
                onClick={tentarOutroCartao}
                className="flex min-h-12 w-full items-center justify-center rounded-xl bg-zinc-900 px-4 py-3 text-sm font-bold text-white active:bg-zinc-700"
              >
                Tentar outro cartão
              </button>
              <button
                type="button"
                // O banco já respondeu que este cartão morreu — nunca fica
                // "vivo" depois de uma recusa definitiva.
                onClick={() => onPagarComPix(false)}
                className="flex min-h-12 w-full items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-bold text-zinc-900 active:bg-zinc-50"
              >
                Pagar com PIX
              </button>
            </div>
          </div>
        )}

        {semSessaoComCartaoVivo && (
          // Confirmação do cartão sem fim (03/10/2026): sem sessão, a
          // consulta é recusada pela edge (404 de dono) e a verificação do
          // pai nem roda — a tela pararia num spinner sem fim. O cartão pode
          // estar vivo: nada de PIX nem de outro cartão aqui.
          <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="flex items-start gap-2 text-sm font-medium text-amber-800">
              <AlertCircle
                aria-hidden="true"
                className="mt-0.5 size-5 shrink-0"
              />
              Sua sessão expirou. Entre de novo para ver a confirmação deste
              pagamento. Não pague de novo enquanto isso.
            </p>
            <div className="grid gap-2">
              {onEntrarDeNovo && (
                <button
                  type="button"
                  onClick={onEntrarDeNovo}
                  className="flex min-h-11 w-full items-center justify-center rounded-xl bg-zinc-900 px-3 text-xs font-bold text-white active:bg-zinc-700"
                >
                  Entrar de novo
                </button>
              )}
              {onVerMeusPedidos && (
                <button
                  type="button"
                  onClick={onVerMeusPedidos}
                  className="flex min-h-11 w-full items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-xs font-bold text-zinc-800"
                >
                  Ver meus pedidos
                </button>
              )}
            </div>
          </div>
        )}

        {etapa.tipo === "aprovado" && !semSessaoComCartaoVivo && (
          <div className="space-y-3 rounded-xl border border-emerald-100 bg-emerald-50 p-3">
            <p className="flex items-start gap-2 text-sm font-medium text-emerald-800">
              <Check aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
              Pagamento aprovado! Confirmando seu pedido…
            </p>
            {/* Quem grava o pedido como pago é o webhook/reconciliação —
                pode levar alguns minutos. Nunca oferece pagar de novo. */}
            {avisoDoAprovado && (
              <>
                <p className="text-xs text-emerald-900">
                  O banco aprovou o pagamento; a loja ainda está registrando o
                  pedido como pago, e isso pode levar alguns minutos. Não pague
                  de novo — o pedido aparece como pago em Meus pedidos assim que
                  for registrado.
                </p>
                {onVerMeusPedidos && (
                  <button
                    type="button"
                    onClick={onVerMeusPedidos}
                    className="flex min-h-11 w-full items-center justify-center rounded-xl border border-emerald-200 bg-white px-3 text-xs font-bold text-emerald-900"
                  >
                    Ver meus pedidos
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {etapa.tipo === "encerrado" && (
          <div className="space-y-3 rounded-xl border border-red-100 bg-red-50 p-3">
            <div className="flex items-start gap-2">
              <AlertCircle
                aria-hidden="true"
                className="mt-0.5 size-5 shrink-0 text-red-500"
              />
              <p className="text-sm font-medium text-red-700">
                {etapa.mensagem}
              </p>
            </div>
            {onVerMeusPedidos && (
              <button
                type="button"
                onClick={onVerMeusPedidos}
                className="flex min-h-12 w-full items-center justify-center rounded-xl bg-zinc-900 px-4 py-3 text-sm font-bold text-white active:bg-zinc-700"
              >
                Ver meus pedidos
              </button>
            )}
          </div>
        )}

        {etapa.tipo === "em-analise" && !semSessaoComCartaoVivo && (
          <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="flex items-start gap-2 text-sm font-medium text-amber-800">
              <Clock aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
              Pagamento em análise pelo banco. Você será avisado quando for
              aprovado.
            </p>
            {paradaAqui && (
              <p className="text-xs text-amber-900">
                O banco ainda não deu a resposta final. Não pague de novo com
                cartão — se ele aprovar, a confirmação aparece aqui e em Meus
                pedidos.
              </p>
            )}
            {paradaAqui && podeVerificarDeNovo && (
              <button
                type="button"
                onClick={verificarDeNovo}
                className="flex min-h-11 w-full items-center justify-center rounded-xl bg-zinc-900 px-3 text-xs font-bold text-white active:bg-zinc-700"
              >
                Verificar de novo
              </button>
            )}
            {/* B2: só depois de alguns minutos — ver
                MINUTOS_ANTES_DE_OFERECER_PIX_EM_ANALISE. Antes disso a
                maioria das análises já teria decidido, e oferecer PIX cedo
                demais competiria com uma aprovação normal. */}
            {pixDisponivelNaAnalise && (
              <button
                type="button"
                // Em análise pelo emissor/antifraude: o cartão AINDA pode ser
                // aprovado.
                onClick={() => onPagarComPix(true)}
                className="flex min-h-11 w-full items-center justify-center rounded-xl border border-amber-300 bg-white px-3 text-xs font-bold text-amber-900"
              >
                Pagar com PIX
              </button>
            )}
            {paradaAqui && onVerMeusPedidos && (
              <button
                type="button"
                onClick={onVerMeusPedidos}
                className="flex min-h-11 w-full items-center justify-center rounded-xl border border-amber-300 bg-white px-3 text-xs font-bold text-amber-900"
              >
                Ver meus pedidos
              </button>
            )}
          </div>
        )}

        {etapa.tipo === "confirmando-desafio" && !semSessaoComCartaoVivo && (
          <div className="space-y-3 rounded-xl border border-zinc-100 bg-zinc-50 p-3">
            {paradaAqui ? (
              // A cadência terminou sem resposta final: a tela PARA de girar
              // e diz o que sabe. O cartão continua tratado como vivo.
              <>
                <p className="flex items-start gap-2 text-sm font-medium text-zinc-800">
                  <Clock
                    aria-hidden="true"
                    className="mt-0.5 size-5 shrink-0 text-zinc-500"
                  />
                  O banco ainda não confirmou este pagamento.
                </p>
                <p className="text-xs text-zinc-500">
                  Não pague de novo com cartão. Se o banco aprovar, a
                  confirmação aparece aqui e em Meus pedidos. Se tocar em
                  &quot;Pagar com PIX&quot;, este pagamento é conferido com o
                  banco antes: o PIX só é gerado se o banco confirmar que o
                  pagamento com cartão foi cancelado.
                </p>
              </>
            ) : (
              <>
                <p className="flex items-center gap-2 text-sm font-medium text-zinc-800">
                  <Loader2
                    aria-hidden="true"
                    className="size-5 shrink-0 animate-spin text-zinc-500"
                  />
                  Confirmando com o banco…
                </p>
                <p className="text-xs text-zinc-500">
                  A confirmação aparece nesta tela. Se o banco não aprovar, você
                  pode pagar com PIX.
                </p>
              </>
            )}
            {paradaAqui && podeVerificarDeNovo && (
              <button
                type="button"
                onClick={verificarDeNovo}
                className="flex min-h-11 w-full items-center justify-center rounded-xl bg-zinc-900 px-3 text-xs font-bold text-white active:bg-zinc-700"
              >
                Verificar de novo
              </button>
            )}
            {/* B2, rodada 2 da revisão de risco pré-publicação (26/09/2026):
                "Tentar outro cartão" saiu — com o cartão ainda em
                `action_required`, a edge NUNCA cria uma segunda cobrança
                (branch (d) de `criar-pagamento/index.ts`): um cartão novo só
                recebia de volta o MESMO desafio, sem trocar nada de verdade.
                "Pagar com PIX" continua sendo a única saída real: a edge
                cancela o cartão em `action_required`/`created` antes de criar
                o PIX, ou responde 409 `cartaoEmAnalise` se não conseguir. */}
            <button
              type="button"
              // O desafio 3DS acabou de ser concluído; o webhook ainda pode
              // aprovar o cartão a qualquer momento.
              onClick={() => onPagarComPix(true)}
              className="flex min-h-11 w-full items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-xs font-bold text-zinc-800"
            >
              Pagar com PIX
            </button>
            {paradaAqui && onVerMeusPedidos && (
              <button
                type="button"
                onClick={onVerMeusPedidos}
                className="flex min-h-11 w-full items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-xs font-bold text-zinc-800"
              >
                Ver meus pedidos
              </button>
            )}
          </div>
        )}
      </div>

      {etapa.tipo === "desafio" && (
        <div className="space-y-2">
          <p className="flex items-start gap-2 text-sm text-zinc-700">
            <ShieldCheck
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-zinc-500"
            />
            Seu banco pediu uma confirmação de segurança. Siga as instruções
            abaixo para concluir o pagamento.
          </p>
          {/* credentialless: mantido depois que o COEP saiu do app (26/09/2026,
              decisão do dono — travava o Card Payment Brick), mas NÃO provado
              contra o 3DS real. No Chromium 110+ o atributo abre o quadro num
              pote de cookies vazio e efêmero e faz todo popup aberto de dentro
              dele sair como noopener (fora do Chromium ele não vale). Um ACS
              que dependa de cookie de dispositivo ou de popup pode não
              concluir o desafio no Chrome. Por isso o teste 3DS do runbook
              (§6) é no Chrome, de preferência Android. Fica porque o fluxo foi
              escrito e testado com ele; se o 3DS do §6 falhar no Chrome, tire
              este atributo antes de desistir do cartão. */}
          <iframe
            title="Autenticação do seu banco"
            src={etapa.url}
            credentialless=""
            className="h-[560px] max-h-[75dvh] w-full rounded-xl border border-zinc-200"
          />
          {/* B2 da revisão de risco pré-publicação (26/09/2026): antes desta
              correção, o desafio 3DS não tinha saída — só o iframe. Quem
              abandona o SMS do banco (ou nunca recebe) ficava preso até a
              reserva de 30 min morrer. "Pagar com PIX" pede o MESMO
              {orderId, metodo: "pix"} de sempre: a edge já cancela o cartão
              em action_required/created antes de criar o PIX
              (criar-pagamento/index.ts).
              SEM "Tentar outro cartão" (rodada 2 da revisão): com o cartão em
              `action_required`, um cartão novo bate na branch (d) da edge e
              recebe de volta o MESMO desafio — nunca troca nada de verdade. */}
          <p className="text-xs text-zinc-500">
            Não conseguiu concluir com o banco? Você pode pagar com PIX.
          </p>
          <button
            type="button"
            // O desafio ainda está aberto — o cartão está vivo, esperando o
            // banco.
            onClick={() => onPagarComPix(true)}
            className="flex min-h-11 w-full items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-xs font-bold text-zinc-800"
          >
            Pagar com PIX
          </button>
        </div>
      )}

      {/* O Brick é dono deste nó — ele fica SEMPRE montado (só escondido
          fora do formulário) para a desmontagem do Brick nunca acontecer
          com o contêiner já arrancado da página. */}
      {formularioAtivo && !formularioPronto && (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-zinc-500">
          <Loader2 aria-hidden="true" className="size-5 animate-spin" />
          Carregando o formulário do cartão...
        </div>
      )}
      <div id={idDoContainer} hidden={!formularioAtivo} />
    </section>
  );
}
