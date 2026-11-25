// @ts-nocheck
/**
 * Caça por mutação (25/11/2026) em `webpush.ts` — o que envia o aviso de
 * pedido, pagamento, estorno e contestação ao celular do lojista. 51 mutantes
 * plantados; 30 sobreviviam à suíte de `webpush_test.ts`, e 3 são equivalentes
 * (o `instanceof PushMessageError`, que o `.response` solto já cobre; a fronteira
 * `ms <= 0` de um prazo que nunca vale exatamente zero; o
 * `inscricaoMorta && aoDetectarMorta`, que só muda o log). Os outros 27 mudam o
 * comportamento e viram os casos abaixo:
 *
 *   * a chave VAPID: variável nova (JSON com `default`) vence a antiga, JSON
 *     ruim cai na antiga, sem nenhuma devolve ""; base64url com tamanho
 *     múltiplo de 3 (sem `=`), com espaço nas pontas, e a volta sem o `=` do
 *     final; ponto P-256 só vale com 65 bytes E primeiro byte 0x04 (cada falha
 *     sozinha recusa); chave ausente diz QUAL falta; JWK com base64url misturados
 *     recusa; a chave importada não é extraível;
 *   * `endpointResumido` mostra o ÚLTIMO trecho e só os 8 últimos caracteres;
 *   * `classificarFalha`: só 404 e 410 são "inscrição morta" (403, 429 e 500 não
 *     são: apagar inscrição viva cala o lojista), status que não é número é
 *     ignorado e o texto do status vai junto;
 *   * `comTempoLimite` devolve `undefined` no prazo pedido (e não no dobro) e
 *     limpa o relógio; `resumir` separa falhas pelo STATUS e ordena por
 *     quantidade e depois pelo motivo;
 *   * `enviarParaInscritos`: lote de 100 em paralelo (101 inscrições não saem
 *     todas juntas), prazo por envio de 10 s no padrão e nunca além do prazo
 *     final, `p256dh` e `auth` cada um no seu lugar, e remoção da inscrição
 *     morta que só vale com o DELETE SEM erro.
 */
import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  base64UrlParaBytes,
  bytesParaBase64Url,
  carregarChavesVapid,
  classificarFalha,
  comTempoLimite,
  endpointResumido,
  enviarParaInscritos,
  jwkDoParVapidCru,
  readKey,
  resumir,
} from "./webpush.ts";
import { parVapidDeTeste } from "./webpush_fixtures.ts";

// ─── readKey ─────────────────────────────────────────────────────────────────

function comAmbiente(valores: Record<string, string | undefined>, fn: () => void) {
  const anteriores = Object.keys(valores).map((n) => [n, Deno.env.get(n)] as const);
  for (const [nome, valor] of Object.entries(valores)) {
    if (valor === undefined) Deno.env.delete(nome);
    else Deno.env.set(nome, valor);
  }
  try {
    fn();
  } finally {
    for (const [nome, valor] of anteriores) {
      if (valor === undefined) Deno.env.delete(nome);
      else Deno.env.set(nome, valor);
    }
  }
}

Deno.test("readKey: a variável nova (JSON com default) vence; JSON ruim ou sem default cai na antiga; sem nenhuma devolve vazio", () => {
  const NOVA = "H34_CHAVE_NOVA";
  const ANTIGA = "H34_CHAVE_ANTIGA";
  comAmbiente({ [NOVA]: '{"default":"da-nova"}', [ANTIGA]: "da-antiga" }, () => {
    assertEquals(readKey(NOVA, ANTIGA), "da-nova");
  });
  comAmbiente({ [NOVA]: "isto nao e json", [ANTIGA]: "da-antiga" }, () => {
    assertEquals(readKey(NOVA, ANTIGA), "da-antiga");
  });
  comAmbiente({ [NOVA]: "{}", [ANTIGA]: "da-antiga" }, () => {
    assertEquals(readKey(NOVA, ANTIGA), "da-antiga");
  });
  comAmbiente({ [NOVA]: undefined, [ANTIGA]: undefined }, () => {
    assertEquals(readKey(NOVA, ANTIGA), "");
  });
});

// ─── base64url e chave VAPID ─────────────────────────────────────────────────

Deno.test("base64url: múltiplo de 3 bytes (sem preenchimento), espaço nas pontas e a volta sem '=' no final", () => {
  assertEquals([...base64UrlParaBytes("QUJD")], [65, 66, 67]);
  assertEquals([...base64UrlParaBytes("  QUJD\n")], [65, 66, 67]);
  assertEquals([...base64UrlParaBytes("QQ")], [65]);
  assertEquals(bytesParaBase64Url(new Uint8Array([65])), "QQ");
  assertEquals(bytesParaBase64Url(new Uint8Array([65, 66])), "QUI");
  assertEquals(bytesParaBase64Url(new Uint8Array([251, 255])), "-_8");
});

Deno.test("ponto P-256 da chave VAPID: 65 bytes E primeiro byte 0x04 — cada falha sozinha recusa", () => {
  const privada = bytesParaBase64Url(new Uint8Array(32).fill(7));
  const publica = (tamanho: number, primeiro: number) => {
    const b = new Uint8Array(tamanho).fill(9);
    b[0] = primeiro;
    return bytesParaBase64Url(b);
  };
  assertThrows(() => jwkDoParVapidCru(publica(65, 0x03), privada), Error, "65 bytes começando em 0x04");
  assertThrows(() => jwkDoParVapidCru(publica(64, 0x04), privada), Error, "65 bytes começando em 0x04");
  assertThrows(() => jwkDoParVapidCru(publica(65, 0x04), bytesParaBase64Url(new Uint8Array(31))), Error, "32 bytes");
  assertThrows(() => jwkDoParVapidCru(publica(65, 0x04), bytesParaBase64Url(new Uint8Array(33))), Error, "32 bytes");
  const ok = jwkDoParVapidCru(publica(65, 0x04), privada);
  assertEquals(ok.publicKey.x, bytesParaBase64Url(new Uint8Array(32).fill(9)));
  assertEquals(ok.publicKey.y, bytesParaBase64Url(new Uint8Array(32).fill(9)));
});

Deno.test("carregarChavesVapid: diz QUAL chave falta, recusa formatos misturados e devolve chaves NÃO extraíveis", async () => {
  const par = await parVapidDeTeste();
  await assertRejects(() => carregarChavesVapid(undefined, par.privada), Error, "VAPID_PUBLIC_KEY");
  await assertRejects(() => carregarChavesVapid(par.publica, ""), Error, "VAPID_PRIVATE_KEY");
  await assertRejects(() => carregarChavesVapid("", undefined), Error, "VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY");

  const jwk = jwkDoParVapidCru(par.publica, par.privada);
  await assertRejects(
    () => carregarChavesVapid(JSON.stringify(jwk.publicKey), par.privada),
    Error,
    "formatos diferentes",
  );
  await assertRejects(
    () => carregarChavesVapid(par.publica, JSON.stringify(jwk.privateKey)),
    Error,
    "formatos diferentes",
  );

  for (
    const [publica, privada] of [
      [par.publica, par.privada],
      [JSON.stringify(jwk.publicKey), JSON.stringify(jwk.privateKey)],
    ]
  ) {
    const chaves = await carregarChavesVapid(publica, privada);
    assertEquals(chaves.privateKey.extractable, false);
    assertEquals(chaves.publicKey.type, "public");
    assertEquals(chaves.privateKey.type, "private");
  }
});

// ─── endpointResumido e classificarFalha ─────────────────────────────────────

Deno.test("endpointResumido: origem + os 8 últimos caracteres do ÚLTIMO trecho do caminho; lixo vira texto fixo", () => {
  assertEquals(
    endpointResumido("https://fcm.googleapis.com/fcm/send/abcdefghijklmnop"),
    "https://fcm.googleapis.com/…ijklmnop",
  );
  assertEquals(endpointResumido("https://web.push.apple.com/curto"), "https://web.push.apple.com/…curto");
  assertEquals(endpointResumido("https://web.push.apple.com/"), "https://web.push.apple.com/…");
  assertEquals(endpointResumido("não é url"), "(endpoint inválido)");
});

Deno.test("classificarFalha: só 404 e 410 são inscrição morta; o texto do status vai junto; status que não é número é ignorado", () => {
  const com = (status: unknown, statusText = "") => classificarFalha({ response: { status, statusText } });
  assertEquals(com(404, "Not Found"), {
    status: 404,
    motivo: "push service respondeu 404 Not Found",
    inscricaoMorta: true,
  });
  assertEquals(com(410, "Gone").inscricaoMorta, true);
  for (const status of [400, 401, 403, 413, 429, 500, 503, 201]) {
    assertEquals(com(status).inscricaoMorta, false, String(status));
  }
  assertEquals(com(429), { status: 429, motivo: "push service respondeu 429", inscricaoMorta: false });
  assertEquals(com(429, "Too Many Requests").motivo, "push service respondeu 429 Too Many Requests");
  // `status` que não é número: não é resposta HTTP, cai no texto do erro
  assertEquals(
    classificarFalha(Object.assign(new Error("rede caiu"), { response: { status: "abc" } })),
    { status: null, motivo: "rede caiu", inscricaoMorta: false },
  );
  assertEquals(classificarFalha(new Error("boom")).motivo, "boom");
  assertEquals(classificarFalha("texto solto").motivo, "texto solto");
});

// ─── comTempoLimite e resumir ────────────────────────────────────────────────

Deno.test("comTempoLimite: devolve undefined NO prazo pedido (não no dobro) e o relógio é limpo", async () => {
  // a promessa leva 30 ms e o prazo é 20: se o prazo virasse o dobro (40), ela venceria
  const trintaMs = () => new Promise<string>((resolve) => setTimeout(() => resolve("tarde"), 30));
  assertEquals(await comTempoLimite(trintaMs(), 20), undefined);
  assertEquals(await comTempoLimite(Promise.resolve("a tempo"), 500), "a tempo");

  const setOriginal = globalThis.setTimeout;
  const clearOriginal = globalThis.clearTimeout;
  const pendentes = new Set<unknown>();
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    const id = setOriginal(() => {
      pendentes.delete(id);
      fn();
    }, ms);
    if (ms === 60_000) pendentes.add(id);
    return id;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id?: number) => {
    pendentes.delete(id);
    return clearOriginal(id);
  }) as typeof clearTimeout;
  try {
    assertEquals(await comTempoLimite(Promise.resolve("ok"), 60_000), "ok");
    assertEquals(pendentes.size, 0);
  } finally {
    globalThis.setTimeout = setOriginal;
    globalThis.clearTimeout = clearOriginal;
    for (const id of pendentes) clearOriginal(id as number);
  }
});

Deno.test("resumir: separa falhas pelo STATUS, ordena por quantidade e depois pelo motivo, e conta as removidas", () => {
  const falha = (endpoint: string, motivo: string, status: number | null, removida = false) => ({
    endpoint,
    ok: false,
    motivo,
    status,
    removida,
  });
  const itens = [
    { endpoint: "https://a.exemplo.com/1", ok: true },
    falha("https://a.exemplo.com/2", "igual", 500),
    falha("https://a.exemplo.com/3", "igual", 502),
    falha("https://a.exemplo.com/4", "zeta", 404, true),
    falha("https://a.exemplo.com/5", "alfa", 404, true),
    falha("https://a.exemplo.com/6", "alfa", 404, true),
    falha("https://a.exemplo.com/7", "beta", null),
  ];
  const r = resumir(itens);
  assertEquals([r.total, r.enviados, r.falharam, r.removidas], [7, 1, 6, 3]);
  // alfa(404) tem 2; os de 1 vêm em ordem alfabética do motivo: beta, igual(500), igual(502), zeta
  assertEquals(r.falhas.map((f) => [f.motivo, f.status, f.quantidade]), [
    ["alfa", 404, 2],
    ["beta", null, 1],
    ["igual", 500, 1],
    ["igual", 502, 1],
    ["zeta", 404, 1],
  ]);
});

// ─── enviarParaInscritos ─────────────────────────────────────────────────────

const inscricao = (n: number) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/token${n}`,
  p256dh: `p256dh-${n}`,
  auth: `auth-${n}`,
});

Deno.test("envio em lotes de 100: com 101 inscrições nunca há mais de 100 envios ao mesmo tempo", async () => {
  let emVoo = 0;
  let maximo = 0;
  const servidor = {
    subscribe: () => ({
      pushTextMessage: async () => {
        emVoo++;
        maximo = Math.max(maximo, emVoo);
        await new Promise((r) => setTimeout(r, 2));
        emVoo--;
      },
    }),
  };
  const itens = await enviarParaInscritos({
    servidor,
    inscricoes: Array.from({ length: 101 }, (_, i) => inscricao(i)),
    mensagem: "x",
  });
  assertEquals(itens.length, 101);
  assertEquals(itens.every((i) => i.ok), true);
  assertEquals(maximo, 100);
});

Deno.test("envio: p256dh e auth vão cada um no seu lugar", async () => {
  const vistas: unknown[] = [];
  const servidor = {
    subscribe: (s: unknown) => {
      vistas.push(s);
      return { pushTextMessage: () => Promise.resolve() };
    },
  };
  await enviarParaInscritos({ servidor, inscricoes: [inscricao(1)], mensagem: "x" });
  assertEquals(vistas, [{
    endpoint: "https://fcm.googleapis.com/fcm/send/token1",
    keys: { p256dh: "p256dh-1", auth: "auth-1" },
  }]);
});

Deno.test("envio: prazo por envio de 10 s no padrão, e nunca além do prazo final", async () => {
  const setOriginal = globalThis.setTimeout;
  const prazos: number[] = [];
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    prazos.push(ms as number);
    return setOriginal(fn, ms);
  }) as typeof setTimeout;
  const servidor = { subscribe: () => ({ pushTextMessage: () => Promise.resolve() }) };
  try {
    await enviarParaInscritos({ servidor, inscricoes: [inscricao(1)], mensagem: "x" });
    await enviarParaInscritos({
      servidor,
      inscricoes: [inscricao(2)],
      mensagem: "x",
      prazoFinalMs: Date.now() + 5_000,
    });
  } finally {
    globalThis.setTimeout = setOriginal;
  }
  assertEquals(prazos[0], 10_000);
  assert(prazos[1] > 0 && prazos[1] <= 5_000, `prazo ${prazos[1]}`);
});

Deno.test("envio: sem resposta do push service dentro do prazo por envio vira falha, não trava o lote", async () => {
  const servidor = {
    subscribe: () => ({ pushTextMessage: () => new Promise((r) => setTimeout(r, 40)) }),
  };
  const itens = await enviarParaInscritos({
    servidor,
    inscricoes: [inscricao(1)],
    mensagem: "x",
    tempoLimitePorEnvioMs: 10,
  });
  assertEquals(itens[0].ok, false);
  assertEquals(itens[0].motivo.startsWith("Sem resposta do serviço de push"), true);
});

Deno.test("inscrição morta: só é removida com o DELETE sem erro (resposta com erro NÃO conta como removida)", async () => {
  const morta = {
    subscribe: () => ({
      pushTextMessage: () => Promise.reject({ response: { status: 410, statusText: "Gone" } }),
    }),
  };
  const silenciar = console.error;
  console.error = () => {};
  try {
    for (
      const [resposta, esperada] of [
        [{ error: null }, true],
        [undefined, true],
        [{ error: { message: "rls negou" } }, false],
      ] as const
    ) {
      const apagadas: string[] = [];
      const itens = await enviarParaInscritos({
        servidor: morta,
        inscricoes: [inscricao(1)],
        mensagem: "x",
        aoDetectarMorta: (endpoint: string) => {
          apagadas.push(endpoint);
          return Promise.resolve(resposta);
        },
      });
      assertEquals(apagadas, [inscricao(1).endpoint]);
      assertEquals(itens[0].removida, esperada, JSON.stringify(resposta));
    }
  } finally {
    console.error = silenciar;
  }
});
