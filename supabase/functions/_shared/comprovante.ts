// @ts-nocheck
/**
 * O miolo do comprovante de pedido ao CLIENTE (PEDIDO-070, #106) —
 * compartilhado entre `send-order-confirmation` (chamada HTTP, do
 * navegador) e `webhook-mercadopago` (import direto, sem HTTP).
 *
 * POR QUE ESTE ARQUIVO EXISTE (redesenho, 25/08/2026)
 *   O comprovante de PIX foi consertado três vezes no mesmo lugar: (1) não
 *   saía — faltava a chamada; (2) texto errado no pagamento atrasado —
 *   incompatibilidade de CONTRATO com `send-order-confirmation`; (3) chave
 *   errada — incompatibilidade de contrato de AUTENTICAÇÃO com a mesma
 *   function. As rodadas 2 e 3 são o mesmo defeito com roupa diferente: o
 *   webhook entrava na `send-order-confirmation` pela porta pública,
 *   desenhada para o navegador — e cada volta descobria mais um jeito de
 *   essa porta não servir a um chamador servidor.
 *
 *   A correção não é a quarta tentativa de acertar o contrato da porta: é
 *   não passar por ela. `webhook-mercadopago` importa esta função e chama
 *   direto — mesmo padrão que `_shared/webpush.ts` já usa para a
 *   `notify-new-order` reusar a `send-push` (ver o cabeçalho daquele
 *   arquivo). Some o HTTP, o `verify_jwt`, o header de autenticação forçado
 *   e a dependência do calendário de desligamento das chaves legadas
 *   (INFRA-260, #126) — porque não há mais fronteira nenhuma para
 *   autenticar: é uma chamada de função dentro do mesmo processo, com o
 *   `supabase` que quem chama já tem na mão.
 *
 * POR QUE `send-order-confirmation/index.ts` NÃO PODE SER IMPORTADO DIRETO
 *   Ele chama `serve()` no topo (guardado só contra o runner de teste) —
 *   importar de lá levantaria um segundo servidor HTTP dentro da outra
 *   function. Por isso o miolo saiu para cá, e `send-order-confirmation`
 *   virou um invólucro HTTP fino sobre esta função.
 *
 * A TRAVA CONTRA E-MAIL REPETIDO CONTINUA NO BANCO, SEM MUDAR UMA LINHA
 *   `reivindicar_email_de_confirmacao` é um UPDATE condicional atômico que
 *   devolve `true` só para a PRIMEIRA chamada — chamar esta função direto,
 *   por import, não muda isso: é a MESMA RPC, chamada da mesma forma. Dois
 *   chamadores (navegador e webhook) competindo pelo mesmo pedido continuam
 *   protegidos pela trava do banco, não por acordo entre os dois lados do
 *   código.
 *
 * `deps.enviarEmail`/`deps.remetenteConfigurado` SÃO INJETÁVEIS, E POR QUÊ
 *   Nem o `send-order-confirmation` original nem o SMTP (`_shared/smtp.ts`)
 *   tinham esse ponto de injeção — a suíte antiga só provava HTML/texto,
 *   nunca o fluxo (reserva → leitura → envio → liberação em falha), porque
 *   provar isso exigiria tocar SMTP de verdade. Como este módulo agora é
 *   testado como MIOLO (não só como HTTP), a injeção existe para o teste
 *   conseguir observar o fluxo inteiro sem rede — mesmo padrão que
 *   `webhook-mercadopago/handler` já usa para `enviarPush`. Os dois
 *   chamadores de produção (`send-order-confirmation` e
 *   `webhook-mercadopago`) chamam sem `deps`, e caem nos defaults reais.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  enviarEmail as enviarEmailReal,
  remetenteConfigurado as remetenteConfiguradoReal,
} from "./smtp.ts";
import {
  escaparHtml,
  formatarBRL,
  montarEndereco,
  numeroDoPedido,
  rotuloDoPagamento,
} from "./pedido.ts";

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

export type DesfechoComprovante =
  | { ok: true }
  | {
      ok: false;
      motivo:
        | "sem_remetente"
        | "envio_falhou"
        | "sem_pedido"
        | "sem_destinatario"
        | "ja_enviado";
    };

/**
 * Manda ao cliente o comprovante de UM pedido. Não valida a FORMA de
 * `orderId` — quem chama já validou (o corpo HTTP em `send-order-
 * confirmation/index.ts`, o `external_reference` autenticado pelo MP em
 * `webhook-mercadopago/index.ts`): duplicar a checagem aqui não muda o
 * resultado, e um `orderId` malformado simplesmente não bate linha nenhuma
 * nas leituras abaixo.
 *
 * `deps` é opcional e defasa para o SMTP real — ver o comentário do topo do
 * arquivo para o porquê de existir.
 */
export async function enviarComprovantePedido(args: {
  supabase: ReturnType<typeof createClient>;
  orderId: string;
  deps?: {
    enviarEmail?: typeof enviarEmailReal;
    remetenteConfigurado?: typeof remetenteConfiguradoReal;
  };
}): Promise<DesfechoComprovante> {
  const { supabase, orderId } = args;
  const enviarEmail = args.deps?.enviarEmail ?? enviarEmailReal;
  const remetenteConfigurado = args.deps?.remetenteConfigurado ?? remetenteConfiguradoReal;

  // Falha fechada ANTES de reservar. Reservar sem poder enviar deixaria o
  // pedido marcado como "ja avisado" para sempre, e o cliente sem comprovante
  // nenhum — sem nem a chance de uma tentativa posterior dar certo.
  if (!remetenteConfigurado()) {
    console.error("comprovante: SMTP nao configurado nesta loja");
    return { ok: false, motivo: "sem_remetente" };
  }

  const { data: pedido, error: erroPedido } = await supabase
    .from("marketplace_orders")
    .select(
      "id, user_id, customer_name, customer_data, subtotal, shipping, shipping_cost, discount, total, total_amount, payment_method, payment_status, address_id",
    )
    .eq("id", orderId)
    .maybeSingle();

  if (erroPedido) {
    console.error("comprovante: leitura do pedido falhou:", erroPedido.message);
    return { ok: false, motivo: "envio_falhou" };
  }
  // "sem_pedido" e nao um erro: para quem chama isto e "nao ha o que enviar",
  // nao um caso que mereca retentativa.
  if (!pedido) return { ok: false, motivo: "sem_pedido" };

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
      `comprovante: ${numeroDoPedido(String(pedido.id))} sem e-mail de cliente`,
    );
    return { ok: false, motivo: "sem_destinatario" };
  }

  // A TRAVA anti-duplicata: UPDATE condicional atomico, so' a PRIMEIRA
  // chamada ganha. Chamar esta funcao direto (por import) nao muda nada
  // aqui — e a MESMA RPC, alcancada da mesma forma.
  const { data: reservou, error: erroReserva } = await supabase.rpc(
    "reivindicar_email_de_confirmacao",
    { p_order_id: orderId },
  );
  if (erroReserva) {
    console.error("comprovante: reserva falhou:", erroReserva.message);
    return { ok: false, motivo: "envio_falhou" };
  }
  if (reservou !== true) {
    // Caminho NORMAL, nao erro: o e-mail deste pedido ja saiu.
    return { ok: false, motivo: "ja_enviado" };
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
    // nada e uma tentativa posterior tem de ser possivel.
    await supabase
      .rpc("liberar_email_de_confirmacao", { p_order_id: orderId })
      .then(undefined, (erro: unknown) => {
        console.error("comprovante: liberar reserva falhou", erro);
      });
    console.error(
      `comprovante: envio falhou para ${mascarar(destinatario)}: ${e?.message}`,
    );
    return { ok: false, motivo: "envio_falhou" };
  }

  console.log(
    `comprovante: ${numeroDoPedido(String(pedido.id))} enviado para ${mascarar(destinatario)}`,
  );
  return { ok: true };
}
