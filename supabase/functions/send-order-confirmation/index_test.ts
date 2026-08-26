import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  assuntoDoEmail,
  emailDoCliente,
  handler,
  htmlDoPedido,
  linhasDosItens,
  mascarar,
  montarResposta,
  pareceUuid,
} from "./index.ts";

/**
 * O que esta suite prova, e o que ela NAO prova.
 *
 * PROVA: o que o comprovante DIZ e o que ele se recusa a dizer — os valores, o
 * texto que muda quando o pagamento esta pendente, a ausencia de promessa que o
 * sistema nao cumpre, e o escape do texto digitado.
 *
 * NAO PROVA: que o e-mail sai. Isso depende do SMTP da loja e so' se prova no
 * ar, com pedido de verdade. Fingir que da' para provar aqui seria pior que nao
 * testar.
 */

const PEDIDO = {
  id: "d77c6616-c389-4caa-b5c1-9a8d7af77f72",
  customer_name: "Ana",
  customer_data: { email: "ana@exemplo.com" },
  subtotal: 100,
  shipping: 15,
  discount: 10,
  total: 105,
  payment_method: "pix",
  payment_status: "aguardando",
};

const ITENS = [
  { product_name: "Blusa", quantity: 2, price: 30 },
  { product_name: "Bolsa", quantity: 1, price: 40 },
];

const base = (extra: Record<string, unknown> = {}) =>
  htmlDoPedido({
    pedido: PEDIDO,
    itens: ITENS,
    endereco: "Rua A, 1 · Centro",
    nomeDaLoja: "Loja Teste",
    aguardandoPagamento: false,
    ...extra,
  });

Deno.test("pareceUuid recusa o que nao tem forma de UUID", () => {
  assertEquals(pareceUuid("d77c6616-c389-4caa-b5c1-9a8d7af77f72"), true);
  assertEquals(pareceUuid("' OR 1=1 --"), false);
  assertEquals(pareceUuid(""), false);
  assertEquals(pareceUuid(null), false);
  assertEquals(pareceUuid(42), false);
});

Deno.test("mascarar nunca deixa o endereco inteiro ir para o log", () => {
  assertEquals(mascarar("gabriel@gmail.com"), "g*****l@gmail.com".replace("*****", "***"));
  assertEquals(mascarar("ab@x.com"), "***@x.com");
  assertEquals(mascarar("sem-arroba"), "***");
});

Deno.test("emailDoCliente prefere o e-mail digitado NAQUELE pedido", () => {
  assertEquals(
    emailDoCliente(PEDIDO, "outro@conta.com"),
    "ana@exemplo.com",
  );
});

Deno.test("emailDoCliente cai para o e-mail da conta quando o pedido nao tem", () => {
  const semEmail = { ...PEDIDO, customer_data: { whatsapp: "34999" } };
  assertEquals(emailDoCliente(semEmail, "conta@exemplo.com"), "conta@exemplo.com");
  assertEquals(emailDoCliente(semEmail, null), "");
});

Deno.test("assuntoDoEmail leva o numero do pedido, com e sem nome de loja", () => {
  assertEquals(assuntoDoEmail(PEDIDO.id, "Loja Teste"), "Pedido #F77F72 · Loja Teste");
  // Loja sem nome cadastrado nao vira " · " orfao no fim do assunto.
  assertEquals(assuntoDoEmail(PEDIDO.id, ""), "Pedido #F77F72");
  assertEquals(assuntoDoEmail(PEDIDO.id, "   "), "Pedido #F77F72");
});

Deno.test("linhasDosItens mostra o TOTAL do item, nao o preco unitario", () => {
  const html = linhasDosItens(ITENS);
  // 2 x R$ 30 = R$ 60,00. Se sair "R$ 30,00" a conta ficou para quem le.
  assertStringIncludes(html, "2× Blusa");
  assertStringIncludes(html, "R$ 60,00");
  assertStringIncludes(html, "1× Bolsa");
  assertStringIncludes(html, "R$ 40,00");
});

Deno.test("linhasDosItens aguenta lista vazia sem quebrar", () => {
  assertEquals(linhasDosItens([]), "");
  assertEquals(linhasDosItens(undefined as never), "");
});

Deno.test("o comprovante traz os valores do pedido", () => {
  const html = base();
  assertStringIncludes(html, "#F77F72");
  assertStringIncludes(html, "Loja Teste");
  assertStringIncludes(html, "R$ 105,00"); // total
  assertStringIncludes(html, "R$ 15,00"); // entrega
  assertStringIncludes(html, "R$ 10,00"); // desconto
  assertStringIncludes(html, "PIX na entrega");
  assertStringIncludes(html, "Rua A, 1 · Centro");
});

Deno.test("linha de valor zerada SOME, em vez de mostrar R$ 0,00", () => {
  const html = htmlDoPedido({
    pedido: { ...PEDIDO, discount: 0, shipping: 0 },
    itens: ITENS,
    endereco: "Rua A, 1",
    nomeDaLoja: "Loja Teste",
    aguardandoPagamento: false,
  });
  assertEquals(html.includes("Desconto"), false);
  assertEquals(html.includes("Entrega em"), true); // o bloco de endereco fica
  assertEquals(html.includes("R$ 0,00"), false);
});

Deno.test("pagamento pendente NAO diz que o pedido esta confirmado", () => {
  const html = htmlDoPedido({
    pedido: { ...PEDIDO, payment_method: "online" },
    itens: ITENS,
    endereco: "Rua A, 1",
    nomeDaLoja: "Loja Teste",
    aguardandoPagamento: true,
  });
  // No caminho online o pedido e uma RESERVA que o pg_cron cancela em 30 min.
  assertStringIncludes(html, "aguardando a confirmacao do pagamento");
  assertEquals(html.includes("Guarde este e-mail"), false);
  assertStringIncludes(html, "PIX pelo site");
});

Deno.test("o comprovante NAO promete o que o sistema nao cumpre", () => {
  // A release 1.4.0 tirou estas frases da tela; elas nao podem voltar por
  // e-mail. Nem prazo de entrega, que o app nao calcula.
  const html = base({ aguardandoPagamento: true }).toLowerCase();
  for (const proibida of [
    "expresso",
    "rastreio automatico",
    "devolucao facil",
    "troca garantida",
    "prazo de entrega",
    "chega em",
  ]) {
    assertEquals(html.includes(proibida), false, `prometeu "${proibida}"`);
  }
});

Deno.test("o comprovante nao cola cidade nem estado que nao vieram do dado", () => {
  const html = base({ endereco: "" });
  assertEquals(html.includes("Entrega em"), false);
  assertEquals(html.includes("undefined"), false);
  assertEquals(html.includes("null"), false);
});

Deno.test("texto digitado entra ESCAPADO no corpo do e-mail", () => {
  const html = htmlDoPedido({
    pedido: PEDIDO,
    itens: [{ product_name: "<script>alert(1)</script>", quantity: 1, price: 10 }],
    endereco: "Rua <b>A</b>",
    nomeDaLoja: "Loja & Cia",
    aguardandoPagamento: false,
  });
  assertEquals(html.includes("<script>"), false);
  assertStringIncludes(html, "&lt;script&gt;");
  assertStringIncludes(html, "Loja &amp; Cia");
  assertEquals(html.includes("Rua <b>A</b>"), false);
});

Deno.test("montarResposta traduz cada desfecho para o status certo", () => {
  assertEquals(montarResposta({ ok: true }).status, 200);
  // 502: a loja falhou, e nao ha nada que quem compra possa corrigir.
  assertEquals(montarResposta({ ok: false, motivo: "envio_falhou" }).status, 502);
  assertEquals(montarResposta({ ok: false, motivo: "sem_remetente" }).status, 502);
  // 400: o corpo veio malformado — nao e caso de cliente.
  assertEquals(montarResposta({ ok: false, motivo: "pedido_invalido" }).status, 400);
  // 200: "ja enviado" e caminho normal, nao erro. Devolver 4xx/5xx aqui faria
  // o front registrar falha a cada recarregar de pagina.
  assertEquals(montarResposta({ ok: false, motivo: "ja_enviado" }).status, 200);
  assertEquals(montarResposta({ ok: false, motivo: "sem_destinatario" }).status, 200);
  assertEquals(montarResposta({ ok: false, motivo: "sem_pedido" }).status, 200);
});

// --- handler: a chave de service role sumindo do ambiente -----------------

/** Devolve a variavel ao estado anterior. Ternario como comando e erro de lint. */
function restaurar(nome: string, valor: string | undefined): void {
  if (valor === undefined) {
    Deno.env.delete(nome);
  } else {
    Deno.env.set(nome, valor);
  }
}

// INFRA-260 (#126), última das sete funções migradas: no dia em que as
// chaves LEGADAS do Supabase forem desligadas, `Deno.env.get(
// "SUPABASE_SERVICE_ROLE_KEY")` volta undefined, `readKey` cai para "" (ela
// nunca lança — ver o comentário dela em `_shared/webpush.ts`), mas
// `createClient(url, "")` lança "supabaseKey is required.". Antes desta
// correção essa chamada ficava FORA de qualquer try/catch, direto no corpo
// do `serve()`: o throw escapava o handler inteiro — 500 cru, sem o JSON que
// `montarResposta` produz — e o comprovante do pedido simplesmente parava de
// sair, sem ninguém perceber (e-mail que não chega não reclama).
Deno.test("handler: nenhuma chave de service role no ambiente (nem a nova SUPABASE_SECRET_KEYS, nem a legada SUPABASE_SERVICE_ROLE_KEY) vira resposta tratada, não um throw que escapa do handler", async () => {
  const urlAnterior = Deno.env.get("SUPABASE_URL");
  const legadaAnterior = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const novaAnterior = Deno.env.get("SUPABASE_SECRET_KEYS");
  Deno.env.set("SUPABASE_URL", "https://xyz.supabase.co");
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.delete("SUPABASE_SECRET_KEYS");

  try {
    // Sem `supabase` em deps: força o handler a montar o client real a
    // partir do ambiente, em vez do cliente falso que os outros testes
    // usariam.
    const resposta = await handler(
      new Request("http://localhost/", {
        method: "POST",
        body: JSON.stringify({ orderId: PEDIDO.id }),
      }),
      {},
    );
    const corpo = await resposta.json();

    // Reusa o motivo que este MESMO arquivo já emite para outra falha de
    // infraestrutura (leitura do pedido, em `_shared/comprovante.ts`) — não
    // inventa categoria nova, e o par (status, motivo) é o que
    // `montarResposta` já traduz para 502 no teste acima.
    assertEquals(resposta.status, 502);
    assertEquals(corpo.ok, false);
    assertEquals(corpo.motivo, "envio_falhou");
  } finally {
    restaurar("SUPABASE_URL", urlAnterior);
    restaurar("SUPABASE_SERVICE_ROLE_KEY", legadaAnterior);
    restaurar("SUPABASE_SECRET_KEYS", novaAnterior);
  }
});

// A suíte acima prova que a FALTA de qualquer chave não escapa o handler —
// mas com as duas variáveis apagadas, `readKey` (migrado) e
// `Deno.env.get(legada)` (pré-migração) devolvem a MESMA coisa ("" e
// undefined, respectivamente) e `createClient` lança nos dois casos, pelo
// MESMO motivo. Esse par não discrimina a migração: revertendo só a troca
// de `readKey` por `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")` em
// `index.ts`, a suíte inteira continua verde.
//
// O par abaixo discrimina. Com SUPABASE_SECRET_KEYS presente (a variável
// NOVA) e SUPABASE_SERVICE_ROLE_KEY ausente (a LEGADA, como fica no dia em
// que ela for desligada):
//   - código migrado (`readKey`): acha a chave em SUPABASE_SECRET_KEYS,
//     `createClient` NÃO lança, o handler segue para
//     `enviarComprovantePedido`, que recusa por falta de SMTP configurado
//     no ambiente de teste → 502 / "sem_remetente".
//   - código pré-migração (`Deno.env.get` direto na legada): a variável
//     está apagada, `createClient(url, undefined)` lança "supabaseKey is
//     required.", cai no catch → 502 / "envio_falhou".
// Medido nas duas versões antes de escrever esta asserção (cópia isolada em
// scratchpad, nunca neste arquivo): real → sem_remetente; mutante (a troca
// revertida para a chamada legada) → envio_falhou.
Deno.test("handler: com a chave NOVA presente e só a legada ausente, o client se monta (prova que leu SUPABASE_SECRET_KEYS, não a variável legada) e a falha vira sem_remetente, não envio_falhou", async () => {
  const urlAnterior = Deno.env.get("SUPABASE_URL");
  const legadaAnterior = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const novaAnterior = Deno.env.get("SUPABASE_SECRET_KEYS");
  const smtpUserAnterior = Deno.env.get("SMTP_USER");
  const smtpPassAnterior = Deno.env.get("SMTP_PASSWORD");
  Deno.env.set("SUPABASE_URL", "https://xyz.supabase.co");
  Deno.env.set("SUPABASE_SECRET_KEYS", '{"default":"sb_secret_abc"}');
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  // Sem remetente configurado: é o segundo desfecho possível depois que o
  // client se monta, e é o que diferencia "leu a chave nova" de "morreu no
  // createClient" sem precisar de rede nem de banco de verdade.
  Deno.env.delete("SMTP_USER");
  Deno.env.delete("SMTP_PASSWORD");

  try {
    const resposta = await handler(
      new Request("http://localhost/", {
        method: "POST",
        body: JSON.stringify({ orderId: PEDIDO.id }),
      }),
      {},
    );
    const corpo = await resposta.json();

    assertEquals(resposta.status, 502);
    assertEquals(corpo.ok, false);
    assertEquals(corpo.motivo, "sem_remetente");
  } finally {
    restaurar("SUPABASE_URL", urlAnterior);
    restaurar("SUPABASE_SERVICE_ROLE_KEY", legadaAnterior);
    restaurar("SUPABASE_SECRET_KEYS", novaAnterior);
    restaurar("SMTP_USER", smtpUserAnterior);
    restaurar("SMTP_PASSWORD", smtpPassAnterior);
  }
});
