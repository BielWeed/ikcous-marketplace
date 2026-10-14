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
 * `deps.enviarEmail`/`deps.resolverRemetente` SÃO INJETÁVEIS, E POR QUÊ
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
import { resolverRemetente as resolverRemetenteReal } from "./email-da-loja.ts";
import { enviarEmail as enviarEmailReal } from "./smtp.ts";
import {
  escaparHtml,
  formatarBRL,
  montarEndereco,
  numeroDoPedido,
  rotuloDoPagamento,
} from "./pedido.ts";
import { ehRetiradaNaLoja } from "./retirada-na-loja.ts";

// RETIRADA NA LOJA (release 1.5.3): texto NEUTRO — a loja nao promete prazo
// nem "pronto agora"; quem avisa quando buscar e a propria loja.
//
// ACENTOS (14/10/2026): o texto que o CLIENTE le tem acento. O comentario
// continua sem acento por convencao do arquivo; a string visivel, nao. O
// e-mail ja usa "×" e "·", entao nao ha problema de codificacao a evitar.
const AVISO_DA_RETIRADA = "Aguarde a confirmação da loja para retirar.";

// Sinal de menos TIPOGRAFICO (U+2212), nao hifen: some do olho quando o
// cliente de e-mail quebra a linha, e o hifen colado em "R$" parece traco de
// separacao. Escrito por escape para o fonte nao carregar o caractere cru.
const SINAL_DE_MENOS = "−";

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
 *
 * `variacao` (opcional, ja' montada por `variacoesDosItens`: "Tamanho: M")
 * vai depois do nome — "Vestido Midi Linho – Tamanho: M". O banco grava como
 * `product_name` so' o nome do produto; sem isto, o mesmo vestido em P e em G
 * saia em duas linhas identicas. Ausente ou so' com espacos = nome simples,
 * exatamente como sempre saiu.
 */
export function linhasDosItens(itens: Array<Record<string, unknown>>): string {
  return (itens ?? [])
    .map((item) => {
      const quantidade = Number(item?.quantity ?? 0) || 0;
      const unitario = Number(item?.price ?? 0) || 0;
      const variacao = String(item?.variacao ?? "").trim();
      const nome = escaparHtml(
        variacao
          ? `${item?.product_name ?? "Produto"} – ${variacao}`
          : (item?.product_name ?? "Produto"),
      );
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

/**
 * "Tamanho: M" para cada `variant_id` dos itens — UMA consulta em lote por
 * pedido, na MESMA loja (o `supabase` que quem chama ja' tem: uma loja por
 * projeto Supabase, nenhum filtro de loja a aplicar).
 *
 * NUNCA LANCA E NUNCA BLOQUEIA O ENVIO. A variacao e' um enfeite do
 * comprovante; o comprovante nao pode depender dela. Qualquer falha — erro
 * devolvido pelo banco, excecao, promessa rejeitada, variacao que nao veio na
 * resposta (pedido antigo, linha removida) — devolve mapa vazio ou sem aquele
 * id, e o item cai no nome simples, como saia antes. Sem nenhum `variant_id`
 * nos itens, nem consulta: o caminho do pedido sem variacao nao muda.
 *
 * O formato "<name>: <value>" e' o mesmo do carrinho (`CartItemsList`).
 */
export async function variacoesDosItens(
  supabase: ReturnType<typeof createClient>,
  itens: Array<Record<string, unknown>>,
): Promise<Map<string, string>> {
  const variacoes = new Map<string, string>();
  try {
    const ids = [
      ...new Set(
        (itens ?? [])
          .map((item) => String(item?.variant_id ?? "").trim())
          .filter(Boolean),
      ),
    ];
    if (ids.length === 0) return variacoes;

    const { data, error } = await supabase
      .from("product_variants")
      .select("id, name, value")
      .in("id", ids);
    if (error) {
      console.warn(
        "comprovante: busca de variacao falhou, itens saem com o nome simples:",
        error.message,
      );
      return variacoes;
    }
    for (const linha of Array.isArray(data) ? data : []) {
      const nome = String(linha?.name ?? "").trim();
      const valor = String(linha?.value ?? "").trim();
      // Sem valor nao ha o que dizer ("Tamanho: " solto seria pior que nada);
      // sem nome, o proprio valor ainda informa ("M", "Azul").
      if (!valor) continue;
      variacoes.set(String(linha.id), nome ? `${nome}: ${valor}` : valor);
    }
  } catch (e) {
    console.warn(
      "comprovante: busca de variacao lancou, itens saem com o nome simples:",
      e?.message,
    );
    return new Map();
  }
  return variacoes;
}

/**
 * Uma linha de total. Some inteira quando o valor e' zero ou ausente.
 *
 * `reducao` (so' o desconto): o valor sai como "− R$ 30,00". E' TEXTO de
 * e-mail — o numero gravado no pedido nao muda — e vale o modulo: desconto
 * gravado negativo nao vira "− −".
 */
function linhaDeValor(
  rotulo: string,
  valor: unknown,
  forte = false,
  reducao = false,
): string {
  const numero = Number(valor ?? 0);
  if (!Number.isFinite(numero) || numero === 0) return "";
  const peso = forte ? "700" : "400";
  const cor = forte ? "#18181b" : "#52525b";
  const texto = reducao
    ? `${SINAL_DE_MENOS} ${formatarBRL(Math.abs(numero))}`
    : formatarBRL(numero);
  return `
    <tr>
      <td style="padding: 4px 0; font-size: ${forte ? "16px" : "13px"}; color: ${cor}; font-weight: ${peso};">${escaparHtml(rotulo)}</td>
      <td style="padding: 4px 0; font-size: ${forte ? "16px" : "13px"}; color: ${cor}; font-weight: ${peso}; text-align: right; white-space: nowrap;">${escaparHtml(texto)}</td>
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
  // De onde a venda veio (D1, lote C4). Opcional: os chamadores de hoje
  // (site) nao passam e o comportamento continua o de sempre. So' importa o
  // valor "presencial" — qualquer outra coisa (undefined incluido) e' o
  // caminho online de sempre.
  canal?: string;
  // RETIRADA NA LOJA (release 1.5.3): presente quando o pedido e de
  // retirada (`store-pickup`). `endereco` e o RETRATO do endereco da loja
  // gravado no pedido (customer_data.pickup_address) — vazio quando o
  // pedido nao o trouxe: o e-mail nao inventa endereco, so manda esperar a
  // loja. Ausente = entrega de sempre.
  retirada?: { endereco: string } | null;
}): string {
  const {
    pedido,
    itens,
    endereco,
    nomeDaLoja,
    aguardandoPagamento,
    canal,
    retirada,
  } = dados;
  const total = pedido?.total ?? pedido?.total_amount;
  const frete = pedido?.shipping ?? pedido?.shipping_cost;
  // `canal` entra no rotulo: venda de balcao nao e' "na entrega" (D3).
  const pagamento = rotuloDoPagamento(
    pedido?.payment_method,
    pedido?.metodo_online,
    canal,
  );
  const loja = String(nomeDaLoja ?? "").trim();

  // O canal presencial VEM PRIMEIRO no if: venda de balcao nunca fica
  // "aguardando confirmacao de pagamento" (contrato de C1.3, o dinheiro ja
  // entrou na hora) — mesmo que `aguardandoPagamento` chegue true por engano,
  // o canal decide antes.
  const abertura =
    canal === "presencial"
      ? "Compra na loja. Obrigado pela preferência! Este e-mail é o resumo do que você levou hoje."
      : aguardandoPagamento
        ? "Recebemos seu pedido e ele está aguardando a confirmação do pagamento. Assim que o pagamento for confirmado, ele entra na fila de separação."
        : "Recebemos seu pedido. Guarde este e-mail: ele é o resumo do que você comprou.";

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
        ${linhaDeValor("Desconto", pedido?.discount, false, true)}
        ${linhaDeValor("Total", total, true)}
      </table>

      ${bloco("Forma de pagamento", pagamento)}
      ${
        retirada
          ? bloco(
              "Retirada na loja",
              retirada.endereco
                ? `${retirada.endereco}. ${AVISO_DA_RETIRADA}`
                : AVISO_DA_RETIRADA,
            ) + bloco("Endereço do cliente", endereco)
          : bloco("Entrega em", endereco)
      }

      <p style="margin: 24px 0 0; font-size: 11px; line-height: 16px; color: #a1a1aa;">
        Dúvida sobre este pedido? Responda este e-mail.
      </p>
    </div>
  `;
}

/**
 * O pedido e de retirada na loja? O id gravado pela RPC decide (contrato da
 * 20261169000000, comparacao exata); o endereco e o retrato que a RPC gravou
 * junto — nunca o endereco ATUAL da loja, que pode ter mudado depois.
 */
function retiradaDoPedido(
  customerData: unknown,
): { endereco: string } | null {
  const dados = (customerData ?? {}) as Record<string, unknown>;
  if (!ehRetiradaNaLoja(dados.shipping_option_id)) return null;
  const endereco =
    typeof dados.pickup_address === "string" ? dados.pickup_address.trim() : "";
  return { endereco };
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
    resolverRemetente?: typeof resolverRemetenteReal;
  };
}): Promise<DesfechoComprovante> {
  const { supabase, orderId } = args;
  const enviarEmail = args.deps?.enviarEmail ?? enviarEmailReal;
  const resolverRemetente = args.deps?.resolverRemetente ?? resolverRemetenteReal;

  // Falha fechada ANTES de reservar. Reservar sem poder enviar deixaria o
  // pedido marcado como "ja avisado" para sempre, e o cliente sem comprovante
  // nenhum — sem nem a chance de uma tentativa posterior dar certo.
  const remetente = await resolverRemetente(supabase);
  if (remetente.origem === "nenhum") {
    console.error("comprovante: SMTP nao configurado nesta loja");
    return { ok: false, motivo: "sem_remetente" };
  }

  const { data: pedido, error: erroPedido } = await supabase
    .from("marketplace_orders")
    .select(
      "id, user_id, customer_name, customer_data, subtotal, shipping, shipping_cost, discount, total, total_amount, payment_method, metodo_online, payment_status, address_id, canal",
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
    .select("product_name, quantity, price, variant_id")
    .eq("order_id", orderId);

  // Tamanho/cor de cada item (uma consulta em lote; nunca derruba o envio —
  // ver `variacoesDosItens`). Item sem variacao encontrada segue com o nome
  // simples.
  const listaDeItens = itens ?? [];
  const variacoes = await variacoesDosItens(supabase, listaDeItens);
  const itensComVariacao = listaDeItens.map((item) => {
    const variacao = variacoes.get(String(item?.variant_id ?? ""));
    return variacao ? { ...item, variacao } : item;
  });

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
        itens: itensComVariacao,
        endereco: montarEndereco(fonteDoEndereco),
        nomeDaLoja: config?.store_name ?? "",
        aguardandoPagamento,
        canal: String(pedido.canal ?? "online"),
        retirada: retiradaDoPedido(pedido.customer_data),
      }),
    }, remetente);
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
