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
import { formatCurrency } from "@/lib/utils";
import { AlertCircle, Check, Clock, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { CategoriaErroPagamento } from "./PagamentoOnline";
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
  | { readonly tipo: "em-analise" }
  | { readonly tipo: "desafio"; readonly url: string }
  | { readonly tipo: "recusado"; readonly motivo: string }
  | {
      readonly tipo: "erro";
      readonly mensagem: string;
      readonly categoria: CategoriaErroPagamento;
    };

type EtapaDoCartao =
  | { readonly tipo: "formulario" }
  | { readonly tipo: "confirmando-desafio" }
  | Exclude<ResultadoDoCartao, { tipo: "erro" }>;

const MOTIVO_PADRAO_DA_RECUSA =
  "O banco recusou este cartão. Tente outro cartão ou pague com PIX.";

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
}: {
  orderId: string;
  dados: DadosDoCartaoDoBrick | null | undefined;
  adicionais: DadosAdicionaisDoBrick | null | undefined;
  config: ConfigDoCartao;
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

  const email = textoNaoVazio(dados?.payer?.email);
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
    },
  };
}

/**
 * Traduz a resposta 200 da edge para o que a tela mostra. O contrato do
 * cartão só emite "pago" | "aguardando" | "recusado"; qualquer outra coisa é
 * falha TERMINAL (nunca sucesso silencioso — mesma rede de segurança do PIX,
 * CHECKOUT-080).
 */
export function classificarRespostaCartao(
  r: RespostaCriarPagamento,
): ResultadoDoCartao {
  if (r?.statusPagamento === "pago") return { tipo: "aprovado" };

  if (r?.statusPagamento === "aguardando") {
    if (!r.desafio3ds) return { tipo: "em-analise" };
    if (urlDoDesafioValida(r.desafio3ds.url)) {
      return { tipo: "desafio", url: r.desafio3ds.url };
    }
    // O banco pediu o desafio, mas a URL não é do Mercado Pago — não abrimos
    // endereço desconhecido dentro do checkout.
    return {
      tipo: "erro",
      mensagem:
        "Não foi possível abrir a confirmação do seu banco. Tente de novo ou pague com PIX.",
      categoria: "recuperavel",
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
  return {
    tipo: "erro",
    mensagem: "Não foi possível confirmar o pagamento.",
    categoria: "terminal",
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
}: {
  orderId: string;
  dados: DadosDoCartaoDoBrick | null | undefined;
  adicionais: DadosAdicionaisDoBrick | null | undefined;
  config: ConfigDoCartao;
  criarPagamento: CriarPagamento;
}): Promise<ResultadoDoCartao> {
  const montagem = montarCorpoDoCartao({ orderId, dados, adicionais, config });
  if (!montagem.ok) {
    return {
      tipo: "erro",
      mensagem: montagem.mensagem,
      categoria: "recuperavel",
    };
  }
  try {
    return classificarRespostaCartao(await criarPagamento(montagem.corpo));
  } catch (err: any) {
    // Mesmas fontes curadas do PIX (ver o catch de `dispararPagamentoPix`):
    // `criarPagamento` só lança texto da nossa edge ou o literal padrão.
    return {
      tipo: "erro",
      mensagem: err?.message ?? "Não foi possível gerar a cobrança.",
      categoria: err?.terminal === true ? "terminal" : "recuperavel",
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
      await carregarSdkMercadoPago();
      if (cancelado) return;

      const publicKey = chavePublicaMercadoPago();
      if (!publicKey) throw new Error("Pagamento indisponível.");

      // @ts-expect-error o SDK entra pelo global
      const mp = new globalThis.MercadoPago(publicKey, { locale: "pt-BR" });
      const email = textoNaoVazio(emailDoPagador);

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
  onPagarComPix,
}: {
  orderId: string;
  valor: number;
  config: ConfigDoCartao;
  emailDoPagador?: string | null;
  onErro: (msg: string, categoria: CategoriaErroPagamento) => void;
  onPagarComPix: () => void;
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
  useEffect(() => {
    onErroRef.current = onErro;
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
        onErroRef.current(
          "Não foi possível carregar o pagamento.",
          "recuperavel",
        ),
      onEnviar: async (dados, adicionais) => {
        const resultado = await enviarPagamentoComCartao({
          orderId,
          dados,
          adicionais,
          config: configDoBrick,
          criarPagamento,
        });
        if (!montadoRef.current) return;
        if (resultado.tipo === "erro") {
          onErroRef.current(resultado.mensagem, resultado.categoria);
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
      setEtapa({ tipo: "confirmando-desafio" });
    };
    globalThis.addEventListener("message", aoReceberMensagem);
    return () => globalThis.removeEventListener("message", aoReceberMensagem);
  }, [emDesafio]);

  const tentarOutroCartao = () => {
    setFormularioPronto(false);
    setTentativa((n) => n + 1);
    setEtapa({ tipo: "formulario" });
  };

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
          <p className="text-xs text-zinc-500">Pedido #{orderId.slice(0, 8)}</p>
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
                onClick={onPagarComPix}
                className="flex min-h-12 w-full items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-bold text-zinc-900 active:bg-zinc-50"
              >
                Pagar com PIX
              </button>
            </div>
          </div>
        )}

        {etapa.tipo === "aprovado" && (
          <p className="flex items-start gap-2 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">
            <Check aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            Pagamento aprovado! Confirmando seu pedido…
          </p>
        )}

        {etapa.tipo === "em-analise" && (
          <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-800">
            <Clock aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            Pagamento em análise pelo banco. Você será avisado quando for
            aprovado.
          </p>
        )}

        {etapa.tipo === "confirmando-desafio" && (
          <div className="space-y-3 rounded-xl border border-zinc-100 bg-zinc-50 p-3">
            <p className="flex items-center gap-2 text-sm font-medium text-zinc-800">
              <Loader2
                aria-hidden="true"
                className="size-5 shrink-0 animate-spin text-zinc-500"
              />
              Confirmando com o banco…
            </p>
            <p className="text-xs text-zinc-500">
              A confirmação aparece nesta tela. Se o banco não aprovar, você
              pode tentar outro cartão ou pagar com PIX.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={tentarOutroCartao}
                className="flex min-h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-xs font-bold text-zinc-800"
              >
                Tentar outro cartão
              </button>
              <button
                type="button"
                onClick={onPagarComPix}
                className="flex min-h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-xs font-bold text-zinc-800"
              >
                Pagar com PIX
              </button>
            </div>
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
          {/* credentialless: o app envia COEP credentialless, e nada garante
              que a página do desafio (Mercado Pago/banco) responda com
              COEP/CORP — sem o atributo o quadro seria barrado (mesmo caso do
              mapa da "Sobre a Loja"). NÃO provado contra o 3DS real. */}
          <iframe
            title="Autenticação do seu banco"
            src={etapa.url}
            credentialless=""
            className="h-[560px] max-h-[75dvh] w-full rounded-xl border border-zinc-200"
          />
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
