// @ts-nocheck
/**
 * send-order-confirmation — manda ao CLIENTE o comprovante do pedido dele
 * (PEDIDO-070, #106).
 *
 * QUEM CHAMA
 *   O navegador, logo depois de o pedido nascer, sem esperar a resposta. O
 *   corpo so' carrega `orderId`: nome, itens, valores e endereco sao lidos aqui
 *   do banco com service role. Ninguem de fora injeta texto no e-mail de
 *   ninguem — mesma regra da notify-new-order.
 *
 * A TRAVA CONTRA E-MAIL REPETIDO MORA NO BANCO
 *   `reivindicar_email_de_confirmacao` faz um UPDATE condicional atomico e
 *   devolve true so' para a PRIMEIRA chamada. Navegador repete — dois toques,
 *   recarregar, StrictMode montando duas vezes — e cada invocacao desta funcao
 *   e um processo novo, sem memoria da anterior; contador em memoria aqui nao
 *   seguraria nada. E o custo de repetir nao e cosmetico: a conta de Gmail da
 *   loja entrega ~100 mensagens por dia, e um laco esgota a cota e derruba
 *   tambem o codigo de verificacao de todo mundo pelo resto do dia.
 *
 * POR QUE NAO HA JANELA DE TEMPO, AO CONTRARIO DA notify-new-order
 *   La a janela de 15 min existe porque o push pode ser disparado infinitas
 *   vezes para o mesmo pedido. Aqui a reserva ja limita a UMA mensagem por
 *   pedido, para sempre — que e uma trava estritamente mais forte. Somar uma
 *   janela so' criaria um caso em que o cliente legitimo fica sem comprovante
 *   porque a rede dele demorou.
 *
 * O QUE ESTE E-MAIL NAO DIZ
 *   Nada que o sistema nao cumpra. Sem prazo de entrega, sem "envio expresso",
 *   sem promessa de troca — a release 1.4.0 inteira existiu para tirar essas
 *   frases da tela, e reintroduzi-las por e-mail seria o mesmo defeito com
 *   outro veiculo. Campo que falta simplesmente nao aparece, em vez de virar
 *   palpite: e a mesma regra do PR #231, que tirou do codigo a cidade cravada.
 *
 * IDENTIDADE DA LOJA VEM DO BANCO
 *   Nome e cidade saem de `store_config`. Este repositorio e o molde que se
 *   clona: o que for cravado aqui viaja para toda loja que existir.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enviarEmail, remetenteConfigurado } from "../_shared/smtp.ts";
import {
  escaparHtml,
  formatarBRL,
  montarEndereco,
  numeroDoPedido,
  rotuloDoPagamento,
} from "../_shared/pedido.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const pareceUuid = (valor: unknown): boolean =>
  typeof valor === "string" && UUID.test(valor);

/** Mascara para log. O endereco de quem compra nunca vai inteiro para o log. */
export function mascarar(email: string): string {
  const partes = String(email ?? "").split("@");
  if (partes.length !== 2) return "***";
  const [nome, dominio] = partes;
  const mascarado =
    nome.length > 2 ? `${nome[0]}***${nome[nome.length - 1]}` : "***";
  return `${mascarado}@${dominio}`;
}

/**
 * Onde mora o e-mail de quem comprou.
 *
 * Convidado guarda em `customer_data.email`; quem tem conta pode ter so' o
 * e-mail do cadastro. A ordem e essa porque o `customer_data` e o que a pessoa
 * digitou NAQUELE pedido — se ela informou outro endereco no checkout, o
 * comprovante daquele pedido vai para onde ela pediu.
 */
export function emailDoCliente(
  pedido: Record<string, unknown>,
  emailDaConta?: string | null,
): string {
  const doPedido = String(
    (pedido?.customer_data as Record<string, unknown> | null)?.email ?? "",
  ).trim();
  if (doPedido) return doPedido;
  return String(emailDaConta ?? "").trim();
}

/**
 * O assunto. Leva o numero do pedido porque e' por ele que a pessoa vai
 * procurar a mensagem depois, na caixa de entrada.
 */
export function assuntoDoEmail(
  idDoPedido: string,
  nomeDaLoja: string,
): string {
  const loja = String(nomeDaLoja ?? "").trim();
  return loja
    ? `Pedido ${numeroDoPedido(idDoPedido)} · ${loja}`
    : `Pedido ${numeroDoPedido(idDoPedido)}`;
}

/**
 * Uma linha por item comprado.
 *
 * `price` e' o preco UNITARIO gravado no pedido, e o que vai na linha e' o
 * total do item. Mostrar o unitario ao lado da quantidade sem multiplicar
 * obrigaria quem le a fazer a conta para conferir o total — e comprovante
 * existe justamente para nao precisar.
 */
export function linhasDosItens(itens: Array<Record<string, unknown>>): string {
  return (itens ?? [])
    .map((item) => {
      const quantidade = Number(item?.quantity ?? 0) || 0;
      const unitario = Number(item?.price ?? 0) || 0;
      const nome = escaparHtml(item?.product_name ?? "Produto");
      return `
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #f4f4f5; font-size: 14px; color: #18181b;">
            ${quantidade}× ${nome}
          </td>
          <td style="padding: 10px 0; border-bottom: 1px solid #f4f4f5; font-size: 14px; color: #18181b; text-align: right; white-space: nowrap;">
            ${escaparHtml(formatarBRL(quantidade * unitario))}
          </td>
        </tr>`;
    })
    .join("");
}

/** Uma linha de total. Some inteira quando o valor e' zero ou ausente. */
function linhaDeValor(rotulo: string, valor: unknown, forte = false): string {
  const numero = Number(valor ?? 0);
  if (!Number.isFinite(numero) || numero === 0) return "";
  const peso = forte ? "700" : "400";
  const cor = forte ? "#18181b" : "#52525b";
  return `
    <tr>
      <td style="padding: 4px 0; font-size: ${forte ? "16px" : "13px"}; color: ${cor}; font-weight: ${peso};">${escaparHtml(rotulo)}</td>
      <td style="padding: 4px 0; font-size: ${forte ? "16px" : "13px"}; color: ${cor}; font-weight: ${peso}; text-align: right; white-space: nowrap;">${escaparHtml(formatarBRL(numero))}</td>
    </tr>`;
}

/**
 * O corpo do comprovante.
 *
 * `aguardandoPagamento` muda o texto de abertura, e nao so' um selo no rodape:
 * no caminho de PIX pelo site o pedido nasce como RESERVA e o pg_cron cancela
 * em 30 minutos se ninguem pagar. Dizer "pedido confirmado" ali seria o app
 * afirmando o que ele mesmo pode desfazer daqui a meia hora.
 */
export function htmlDoPedido(dados: {
  pedido: Record<string, unknown>;
  itens: Array<Record<string, unknown>>;
  endereco: string;
  nomeDaLoja: string;
  aguardandoPagamento: boolean;
}): string {
  const { pedido, itens, endereco, nomeDaLoja, aguardandoPagamento } = dados;
  const total = pedido?.total ?? pedido?.total_amount;
  const frete = pedido?.shipping ?? pedido?.shipping_cost;
  const pagamento = rotuloDoPagamento(pedido?.payment_method);
  const loja = String(nomeDaLoja ?? "").trim();

  const abertura = aguardandoPagamento
    ? "Recebemos seu pedido e ele esta aguardando a confirmacao do pagamento. Assim que o PIX for confirmado, ele entra na fila de separacao."
    : "Recebemos seu pedido. Guarde este e-mail: ele e o resumo do que voce comprou.";

  const bloco = (rotulo: string, conteudo: string): string =>
    conteudo
      ? `
      <p style="margin: 0 0 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #a1a1aa;">${escaparHtml(rotulo)}</p>
      <p style="margin: 0 0 20px; font-size: 14px; color: #3f3f46; line-height: 20px;">${escaparHtml(conteudo)}</p>`
      : "";

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; border: 1px solid #e4e4e7; border-radius: 24px; color: #18181b;">
      <p style="margin: 0 0 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #a1a1aa;">
        Pedido ${escaparHtml(numeroDoPedido(String(pedido?.id ?? "")))}
      </p>
      ${loja ? `<p style="margin: 0 0 20px; font-size: 18px; font-weight: 800;">${escaparHtml(loja)}</p>` : ""}
      <p style="margin: 0 0 24px; font-size: 14px; line-height: 20px; color: #3f3f46;">
        ${escaparHtml(abertura)}
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
        ${linhasDosItens(itens)}
      </table>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        ${linhaDeValor("Subtotal", pedido?.subtotal)}
        ${linhaDeValor("Entrega", frete)}
        ${linhaDeValor("Desconto", pedido?.discount)}
        ${linhaDeValor("Total", total, true)}
      </table>

      ${bloco("Forma de pagamento", pagamento)}
      ${bloco("Entrega em", endereco)}

      <p style="margin: 24px 0 0; font-size: 11px; line-height: 16px; color: #a1a1aa;">
        Duvida sobre este pedido? Responda este e-mail.
      </p>
    </div>
  `;
}

export function montarResposta(desfecho): Response {
  const status = desfecho.ok
    ? 200
    : desfecho.motivo === "envio_falhou" || desfecho.motivo === "sem_remetente"
      ? 502
      : desfecho.motivo === "pedido_invalido"
        ? 400
        : 200;
  return new Response(JSON.stringify(desfecho), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const emTeste =
  Deno.mainModule.endsWith("_test.ts") ||
  Deno.mainModule.endsWith("_test.js") ||
  Deno.mainModule.includes("index_test");

if (!emTeste) {
  serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const corpo = await req.json().catch(() => null);
    const orderId = corpo?.orderId;
    if (!pareceUuid(orderId)) {
      return montarResposta({ ok: false, motivo: "pedido_invalido" });
    }

    // Falha fechada ANTES de reservar. Reservar sem poder enviar deixaria o
    // pedido marcado como "ja avisado" para sempre, e o cliente sem comprovante
    // nenhum — sem nem a chance de uma tentativa posterior dar certo.
    if (!remetenteConfigurado()) {
      console.error("send-order-confirmation: SMTP nao configurado nesta loja");
      return montarResposta({ ok: false, motivo: "sem_remetente" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    );

    const { data: pedido, error: erroPedido } = await supabase
      .from("marketplace_orders")
      .select(
        "id, user_id, customer_name, customer_data, subtotal, shipping, shipping_cost, discount, total, total_amount, payment_method, payment_status, address_id",
      )
      .eq("id", orderId)
      .maybeSingle();

    if (erroPedido) {
      console.error("send-order-confirmation: leitura do pedido falhou:", erroPedido.message);
      return montarResposta({ ok: false, motivo: "envio_falhou" });
    }
    // 200 e nao 404: para o front isto e "nao ha o que enviar", nao um erro que
    // mereca retentativa.
    if (!pedido) return montarResposta({ ok: false, motivo: "sem_pedido" });

    // O e-mail da conta so' e' consultado quando o pedido nao traz um. Uma
    // chamada de admin a menos no caminho do convidado, que e a maioria.
    let emailDaConta: string | null = null;
    if (!emailDoCliente(pedido) && pedido.user_id) {
      const { data: conta } = await supabase.auth.admin.getUserById(
        String(pedido.user_id),
      );
      emailDaConta = conta?.user?.email ?? null;
    }

    const destinatario = emailDoCliente(pedido, emailDaConta);
    if (!destinatario) {
      // Pedido sem e-mail nenhum e caso real: o checkout de convidado nao
      // exige e-mail. Nao ha falha aqui, so' nao ha para onde mandar — e a
      // reserva NAO e' gasta, para o dia em que o dado aparecer.
      console.warn(
        `send-order-confirmation: ${numeroDoPedido(String(pedido.id))} sem e-mail de cliente`,
      );
      return montarResposta({ ok: false, motivo: "sem_destinatario" });
    }

    const { data: reservou, error: erroReserva } = await supabase.rpc(
      "reivindicar_email_de_confirmacao",
      { p_order_id: orderId },
    );
    if (erroReserva) {
      console.error("send-order-confirmation: reserva falhou:", erroReserva.message);
      return montarResposta({ ok: false, motivo: "envio_falhou" });
    }
    if (reservou !== true) {
      // Caminho NORMAL, nao erro: o e-mail deste pedido ja saiu. Acontece a
      // cada recarregar de pagina e a cada montagem dupla do StrictMode.
      return montarResposta({ ok: false, motivo: "ja_enviado" });
    }

    const { data: itens } = await supabase
      .from("marketplace_order_items")
      .select("product_name, quantity, price")
      .eq("order_id", orderId);

    // Endereco: a linha de `user_addresses` quando ha conta e endereco salvo;
    // senao o que a pessoa digitou no checkout, que mora no proprio pedido.
    let fonteDoEndereco: Record<string, unknown> | null =
      (pedido.customer_data as Record<string, unknown> | null) ?? null;
    if (pedido.address_id) {
      const { data: endereco } = await supabase
        .from("user_addresses")
        .select("street, number, complement, neighborhood, city, state, cep")
        .eq("id", String(pedido.address_id))
        .maybeSingle();
      if (endereco) fonteDoEndereco = endereco;
    }

    const { data: config } = await supabase
      .from("store_config")
      .select("store_name")
      .limit(1)
      .maybeSingle();

    const aguardandoPagamento =
      String(pedido.payment_method ?? "") === "online" &&
      String(pedido.payment_status ?? "") !== "pago";

    try {
      await enviarEmail({
        para: destinatario,
        assunto: assuntoDoEmail(String(pedido.id), config?.store_name ?? ""),
        html: htmlDoPedido({
          pedido,
          itens: itens ?? [],
          endereco: montarEndereco(fonteDoEndereco),
          nomeDaLoja: config?.store_name ?? "",
          aguardandoPagamento,
        }),
      });
    } catch (e) {
      // Devolve a reserva: o SMTP RECUSOU a mensagem, entao ninguem recebeu
      // nada e uma tentativa posterior tem de ser possivel. O lado do erro que
      // se escolheu aqui esta escrito na propria migration — cliente sem
      // comprovante nenhum e pior que cliente com dois.
      await supabase
        .rpc("liberar_email_de_confirmacao", { p_order_id: orderId })
        .then(undefined, (erro: unknown) => {
          console.error("send-order-confirmation: liberar reserva falhou", erro);
        });
      console.error(
        `send-order-confirmation: envio falhou para ${mascarar(destinatario)}: ${e?.message}`,
      );
      return montarResposta({ ok: false, motivo: "envio_falhou" });
    }

    console.log(
      `send-order-confirmation: ${numeroDoPedido(String(pedido.id))} enviado para ${mascarar(destinatario)}`,
    );
    return montarResposta({ ok: true });
  });
}
