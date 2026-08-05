// @ts-nocheck
/**
 * Testes da send-push (PUSH-010, #80).
 *
 * Nada aqui toca a internet: o "push service" é um servidor HTTP local que
 * responde o status que o teste mandar. O que se prova é o que dá para provar
 * sem produção — que a biblioteca é chamada pela API que ela tem, que a
 * requisição sai com os cabeçalhos do RFC 8291, que 410 apaga a inscrição e que
 * a contagem devolvida bate com o que aconteceu.
 *
 * O que NÃO se prova aqui, e continua sendo a PUSH-030: se as chaves VAPID
 * existem no ambiente da função em produção.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import * as webpush from "jsr:@negrel/webpush@0.3.0";
import {
  base64UrlParaBytes,
  bytesParaBase64Url,
  carregarChavesVapid,
  classificarFalha,
  endpointResumido,
  enviarParaInscritos,
  jwkDoParVapidCru,
  resumir,
} from "./index.ts";

// ---------------------------------------------------------------------------
// O bug que originou a PUSH-010
// ---------------------------------------------------------------------------

Deno.test("a biblioteca não tem sendNotification — era o que o código antigo chamava", () => {
  // Este teste é o registro do defeito. Até 05/08/2026 a função fazia
  // `await webpush.sendNotification(...)`, que estourava
  // `TypeError: webpush.sendNotification is not a function` em TODA inscrição.
  // Se um dia a biblioteca ganhar esse export, este teste falha e alguém
  // reavalia — mas o caminho certo continua sendo ApplicationServer.
  assertEquals(typeof (webpush as any).sendNotification, "undefined");
  assertEquals(typeof webpush.ApplicationServer, "function");
  assertEquals(typeof webpush.importVapidKeys, "function");
});

// ---------------------------------------------------------------------------
// base64url
// ---------------------------------------------------------------------------

Deno.test("base64url vai e volta sem perder byte", () => {
  const original = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  assertEquals([...base64UrlParaBytes(bytesParaBase64Url(original))], [
    ...original,
  ]);
});

Deno.test("base64url não emite +, / nem =", () => {
  // 0xFB 0xFF 0xBF em base64 padrão é "+/+/" — o teste existe para pegar
  // exatamente a troca de alfabeto que quebraria a assinatura VAPID.
  const texto = bytesParaBase64Url(new Uint8Array([251, 255, 191, 251, 255]));
  assertEquals(/[+/=]/.test(texto), false);
});

// ---------------------------------------------------------------------------
// Chaves VAPID
// ---------------------------------------------------------------------------

/** Gera um par VAPID e devolve nos dois formatos que o ambiente pode ter. */
async function parVapidDeTeste() {
  const par = await webpush.generateVapidKeys({ extractable: true });
  const publicaCrua = new Uint8Array(
    await crypto.subtle.exportKey("raw", par.publicKey),
  );
  const jwkPrivada = await crypto.subtle.exportKey("jwk", par.privateKey);
  return {
    par,
    base64url: {
      publica: bytesParaBase64Url(publicaCrua),
      privada: jwkPrivada.d,
    },
    jwk: await webpush.exportVapidKeys(par),
  };
}

Deno.test("chave em base64url vira um par que assina e verifica", async () => {
  const { base64url } = await parVapidDeTeste();
  const importado = await carregarChavesVapid(
    base64url.publica,
    base64url.privada,
  );

  // A prova de que a conversão preservou o par: assina com a privada
  // reconstruída e verifica com a pública reconstruída. Se X, Y ou d tivessem
  // sido fatiados errado, a verificação daria falso em vez de estourar.
  const mensagem = new TextEncoder().encode("ikcous");
  const assinatura = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    importado.privateKey,
    mensagem,
  );
  const confere = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    importado.publicKey,
    assinatura,
    mensagem,
  );
  assert(confere, "a assinatura da chave convertida não verificou");
});

Deno.test("chave em base64url e chave em JWK produzem a MESMA pública", async () => {
  const { base64url, jwk } = await parVapidDeTeste();

  const porCru = await carregarChavesVapid(base64url.publica, base64url.privada);
  const porJson = await carregarChavesVapid(
    JSON.stringify(jwk.publicKey),
    JSON.stringify(jwk.privateKey),
  );

  const cru = new Uint8Array(await crypto.subtle.exportKey("raw", porCru.publicKey));
  const json = new Uint8Array(
    await crypto.subtle.exportKey("raw", porJson.publicKey),
  );
  assertEquals([...cru], [...json]);
});

Deno.test("chave ausente diz QUAL variável falta", async () => {
  const erro = await carregarChavesVapid(undefined, "qualquer").catch((e) => e);
  assertStringIncludes(erro.message, "VAPID_PUBLIC_KEY");

  const erroDois = await carregarChavesVapid("qualquer", "").catch((e) => e);
  assertStringIncludes(erroDois.message, "VAPID_PRIVATE_KEY");
});

Deno.test("formato misto é recusado antes de virar erro de curva", async () => {
  const { base64url, jwk } = await parVapidDeTeste();
  const erro = await carregarChavesVapid(
    JSON.stringify(jwk.publicKey),
    base64url.privada,
  ).catch((e) => e);
  assertStringIncludes(erro.message, "formatos diferentes");
});

Deno.test("pública com tamanho errado é recusada com o tamanho medido", () => {
  let erro: Error | null = null;
  try {
    jwkDoParVapidCru(bytesParaBase64Url(new Uint8Array(64)), "x".repeat(43));
  } catch (e) {
    erro = e as Error;
  }
  assert(erro, "esperava recusa");
  assertStringIncludes(erro.message, "65 bytes");
  assertStringIncludes(erro.message, "veio 64");
});

Deno.test("privada com tamanho errado é recusada", async () => {
  const { base64url } = await parVapidDeTeste();
  let erro: Error | null = null;
  try {
    jwkDoParVapidCru(base64url.publica, bytesParaBase64Url(new Uint8Array(31)));
  } catch (e) {
    erro = e as Error;
  }
  assert(erro, "esperava recusa");
  assertStringIncludes(erro.message, "32 bytes");
});

// ---------------------------------------------------------------------------
// Classificação de falha
// ---------------------------------------------------------------------------

Deno.test("410 e 404 marcam a inscrição como morta; 401 e 429 não", () => {
  const paraStatus = (status: number) =>
    classificarFalha(new webpush.PushMessageError(new Response(null, { status })));

  assertEquals(paraStatus(410).inscricaoMorta, true);
  assertEquals(paraStatus(404).inscricaoMorta, true);
  assertEquals(paraStatus(401).inscricaoMorta, false);
  assertEquals(paraStatus(429).inscricaoMorta, false);
  assertEquals(paraStatus(410).status, 410);
});

Deno.test("erro que não é do push service vira motivo legível", () => {
  const classificado = classificarFalha(
    new TypeError("webpush.sendNotification is not a function"),
  );
  assertEquals(classificado.status, null);
  assertEquals(classificado.inscricaoMorta, false);
  assertStringIncludes(classificado.motivo, "is not a function");
});

Deno.test("erro só com response no formato certo também é reconhecido", () => {
  // Sem instanceof: cobre o caso de a biblioteca ser carregada duas vezes e o
  // PushMessageError das duas cópias não ser o mesmo construtor. Sem este
  // caminho, uma inscrição expirada deixaria de ser removida e ficaria falhando
  // para sempre.
  const classificado = classificarFalha({
    response: new Response(null, { status: 410 }),
  });
  assertEquals(classificado.inscricaoMorta, true);
});

// ---------------------------------------------------------------------------
// Endpoint e resumo
// ---------------------------------------------------------------------------

Deno.test("endpoint é encurtado e não publica o token inteiro", () => {
  const inteiro =
    "https://fcm.googleapis.com/fcm/send/cTOKENsecretoMUITOlongo123456789";
  const curto = endpointResumido(inteiro);
  assertEquals(curto, "https://fcm.googleapis.com/…23456789");
  assertEquals(curto.includes("cTOKENsecreto"), false);
});

Deno.test("endpoint inválido não estoura o resumo", () => {
  assertEquals(endpointResumido("nao-e-url"), "(endpoint inválido)");
});

Deno.test("resumir agrupa por motivo e conta certo", () => {
  const resumo = resumir([
    { endpoint: "https://a.example/p/aaaaaaaa1", ok: true },
    { endpoint: "https://a.example/p/aaaaaaaa2", ok: true },
    {
      endpoint: "https://a.example/p/aaaaaaaa3",
      ok: false,
      motivo: "push service respondeu 401",
      status: 401,
    },
    {
      endpoint: "https://a.example/p/aaaaaaaa4",
      ok: false,
      motivo: "push service respondeu 401",
      status: 401,
    },
    {
      endpoint: "https://a.example/p/aaaaaaaa5",
      ok: false,
      motivo: "push service respondeu 410",
      status: 410,
      removida: true,
    },
  ]);

  assertEquals(resumo.total, 5);
  assertEquals(resumo.enviados, 2);
  assertEquals(resumo.falharam, 3);
  assertEquals(resumo.removidas, 1);
  assertEquals(resumo.falhas.length, 2);
  // Ordenado por quantidade: o 401 (2) vem antes do 410 (1).
  assertEquals(resumo.falhas[0].status, 401);
  assertEquals(resumo.falhas[0].quantidade, 2);
  assertEquals(resumo.falhas[1].status, 410);
  assertEquals(resumo.falhas[1].quantidade, 1);
});

Deno.test("resumo de envio 100% falho não tem nenhum enviado", () => {
  const resumo = resumir([
    { endpoint: "https://a.example/p/x", ok: false, motivo: "boom", status: null },
  ]);
  assertEquals(resumo.enviados, 0);
  assertEquals(resumo.falharam, 1);
});

// ---------------------------------------------------------------------------
// Envio ponta a ponta contra um push service local
// ---------------------------------------------------------------------------

/** Gera uma inscrição de navegador válida (p256dh de verdade, auth de 16 bytes). */
async function inscricaoDeTeste(endpoint: string) {
  const par = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey", "deriveBits"],
  );
  const bruta = new Uint8Array(
    await crypto.subtle.exportKey("raw", par.publicKey),
  );
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    endpoint,
    p256dh: bytesParaBase64Url(bruta),
    auth: bytesParaBase64Url(auth),
  };
}

/**
 * Sobe um push service falso. `statusPorCaminho` decide o que responder para
 * cada endpoint, e `recebidas` guarda o que chegou para o teste inspecionar.
 */
function pushServiceFalso(statusPorCaminho: Record<string, number>) {
  // Map, e não indexação de objeto: `obj[variavel]` dispara
  // security/detect-object-injection e sobe a catraca de lint.
  const status = new Map(Object.entries(statusPorCaminho));
  const recebidas: { caminho: string; headers: Headers; corpo: Uint8Array }[] =
    [];
  const servidor = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    const caminho = new URL(req.url).pathname;
    recebidas.push({
      caminho,
      headers: req.headers,
      corpo: new Uint8Array(await req.arrayBuffer()),
    });
    return new Response(null, { status: status.get(caminho) ?? 201 });
  });
  return {
    recebidas,
    base: `http://localhost:${servidor.addr.port}`,
    encerrar: () => servidor.shutdown(),
  };
}

async function servidorDeAplicacao() {
  const { base64url } = await parVapidDeTeste();
  return await webpush.ApplicationServer.new({
    contactInformation: "mailto:teste@ikcous.local",
    vapidKeys: await carregarChavesVapid(base64url.publica, base64url.privada),
  });
}

Deno.test("envia de verdade: 201 conta como entregue e a requisição segue o RFC 8291", async () => {
  const service = pushServiceFalso({ "/p/ok": 201 });
  try {
    const servidor = await servidorDeAplicacao();
    const inscricao = await inscricaoDeTeste(`${service.base}/p/ok`);

    const itens = await enviarParaInscritos({
      servidor,
      inscricoes: [inscricao],
      mensagem: JSON.stringify({ title: "Oi", body: "tudo certo" }),
    });

    assertEquals(itens.length, 1);
    assertEquals(itens[0].ok, true);

    assertEquals(service.recebidas.length, 1);
    const req = service.recebidas[0];
    assertEquals(req.headers.get("content-encoding"), "aes128gcm");
    assertStringIncludes(req.headers.get("authorization") ?? "", "vapid t=");
    assertStringIncludes(req.headers.get("authorization") ?? "", ", k=");
    assert(req.corpo.length > 0, "o corpo cifrado não pode ir vazio");
    // O corpo TEM de estar cifrado: o título não pode aparecer em claro.
    assertEquals(new TextDecoder().decode(req.corpo).includes("tudo certo"), false);
  } finally {
    await service.encerrar();
  }
});

Deno.test("410 apaga a inscrição; 401 não apaga", async () => {
  const service = pushServiceFalso({
    "/p/morta": 410,
    "/p/semchave": 401,
    "/p/ok": 201,
  });
  const apagadas: string[] = [];
  try {
    const servidor = await servidorDeAplicacao();
    const inscricoes = [
      await inscricaoDeTeste(`${service.base}/p/morta`),
      await inscricaoDeTeste(`${service.base}/p/semchave`),
      await inscricaoDeTeste(`${service.base}/p/ok`),
    ];

    const itens = await enviarParaInscritos({
      servidor,
      inscricoes,
      mensagem: "{}",
      aoDetectarMorta: (endpoint: string) => {
        apagadas.push(endpoint);
        return Promise.resolve();
      },
    });

    assertEquals(itens.map((i: any) => i.ok), [false, false, true]);
    assertEquals(itens[0].status, 410);
    assertEquals(itens[0].removida, true);
    assertEquals(itens[1].status, 401);
    assertEquals(itens[1].removida, false);
    assertEquals(apagadas, [inscricoes[0].endpoint]);

    const resumo = resumir(itens);
    assertEquals(resumo.enviados, 1);
    assertEquals(resumo.falharam, 2);
    assertEquals(resumo.removidas, 1);
  } finally {
    await service.encerrar();
  }
});

Deno.test("falha ao apagar a inscrição não derruba o envio", async () => {
  const service = pushServiceFalso({ "/p/morta": 410 });
  // O caminho testado LOGA o erro de propósito; sem silenciar, a saída do CI
  // fica com um stack trace que parece teste quebrado e não é.
  const console_error = console.error;
  console.error = () => {};
  try {
    const servidor = await servidorDeAplicacao();
    const itens = await enviarParaInscritos({
      servidor,
      inscricoes: [await inscricaoDeTeste(`${service.base}/p/morta`)],
      mensagem: "{}",
      aoDetectarMorta: () => Promise.reject(new Error("banco fora do ar")),
    });
    assertEquals(itens[0].ok, false);
    assertEquals(itens[0].removida, false);
  } finally {
    console.error = console_error;
    await service.encerrar();
  }
});

Deno.test("lote não perde nem embaralha inscrição", async () => {
  const service = pushServiceFalso({ "/p/2": 410 });
  try {
    const servidor = await servidorDeAplicacao();
    const inscricoes = [
      await inscricaoDeTeste(`${service.base}/p/1`),
      await inscricaoDeTeste(`${service.base}/p/2`),
      await inscricaoDeTeste(`${service.base}/p/3`),
      await inscricaoDeTeste(`${service.base}/p/4`),
      await inscricaoDeTeste(`${service.base}/p/5`),
    ];

    const itens = await enviarParaInscritos({
      servidor,
      inscricoes,
      mensagem: "{}",
      tamanhoDoLote: 2,
    });

    assertEquals(itens.length, 5);
    assertEquals(
      itens.map((i: any) => i.endpoint),
      inscricoes.map((i) => i.endpoint),
    );
    assertEquals(itens.map((i: any) => i.ok), [true, false, true, true, true]);
  } finally {
    await service.encerrar();
  }
});
