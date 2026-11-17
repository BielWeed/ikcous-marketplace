// @ts-nocheck
/**
 * Testes de `comTempoLimite` (Achado N2, 3ª revisão de risco, 26/09/2026).
 *
 * Não existia suíte para este arquivo antes desta correção — `comTempoLimite`
 * só era exercitada indiretamente, por dentro dos testes de
 * `criar-pagamento`/`webhook-mercadopago` que injetam `alertarAdminCartaoOrfao`/
 * `enviarPush` como stubs rápidos. Nenhum desses testes prova as DUAS metades
 * do Achado N2: o `setTimeout` sendo limpo (a suíte fica verde de qualquer
 * jeito, porque os sanitizers do Deno só acusam recurso vazado se ele
 * sobreviver ao FIM do teste) e o `EdgeRuntime.waitUntil` sendo chamado
 * quando o ambiente o expõe.
 */
import * as webpush from "jsr:@negrel/webpush@0.3.0";
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  carregarChavesVapid,
  comTempoLimite,
  dispararSemEsperarCliente,
  enviarParaInscritos,
  MOTIVO_ENDPOINT_INVALIDO,
  resumir,
} from "./webpush.ts";
import { inscricaoDeTeste, parVapidDeTeste } from "./webpush_fixtures.ts";

Deno.test("comTempoLimite: promessa rápida vence a corrida e devolve o valor, sem vazar o setTimeout (sanitizeResources padrão do Deno.test)", async () => {
  const resultado = await comTempoLimite(Promise.resolve("ok"), 50);
  assertEquals(resultado, "ok");
  // Sem `clearTimeout` no `finally`, o temporizador agendado para 50ms
  // continuaria vivo até estourar sozinho — inofensivo para ESTE teste (o
  // sanitizer só reprova recurso que sobrevive ao teste), mas confirma que a
  // correção não regrediu o caminho feliz.
});

Deno.test("comTempoLimite: promessa lenta perde a corrida contra o teto -> devolve undefined, nunca lança", async () => {
  const nuncaAssenta = new Promise<string>(() => {});
  const resultado = await comTempoLimite(nuncaAssenta, 10);
  assertEquals(resultado, undefined);
});

Deno.test("comTempoLimite: com EdgeRuntime.waitUntil disponível (feature-detectado), registra a promessa para sobreviver à resposta", async () => {
  const registradas: Promise<unknown>[] = [];
  (globalThis as Record<string, unknown>).EdgeRuntime = {
    waitUntil: (p: Promise<unknown>) => {
      registradas.push(p);
    },
  };
  try {
    const resultado = await comTempoLimite(Promise.resolve("push-enviado"), 10);
    assertEquals(resultado, "push-enviado");
    assertEquals(registradas.length, 1, "a promessa foi registrada no waitUntil do Edge Runtime");
  } finally {
    delete (globalThis as Record<string, unknown>).EdgeRuntime;
  }
});

Deno.test("comTempoLimite: sem EdgeRuntime no ambiente (o caso do `deno test`), não lança e comporta-se como antes", async () => {
  assertEquals((globalThis as Record<string, unknown>).EdgeRuntime, undefined);
  const resultado = await comTempoLimite(Promise.resolve(42), 10);
  assertEquals(resultado, 42);
});

// --- dispararSemEsperarCliente (Menor, 4ª revisão de risco, 26/09/2026) ---

Deno.test("dispararSemEsperarCliente: com EdgeRuntime.waitUntil disponível, registra a promessa e devolve undefined SEM esperar por ela", async () => {
  const registradas: Promise<unknown>[] = [];
  let assentou = false;
  (globalThis as Record<string, unknown>).EdgeRuntime = {
    waitUntil: (p: Promise<unknown>) => {
      registradas.push(p);
    },
  };
  try {
    // A promessa NUNCA assenta dentro do teste — se `dispararSemEsperarCliente`
    // esperasse por ela (como `comTempoLimite` faz), este `await` penduraria
    // até o teto de tempo do runner. Devolver undefined IMEDIATAMENTE é a
    // prova que importa: o cliente (o navegador do outro lado da requisição)
    // não fica esperando o push.
    const nuncaAssenta = new Promise<string>((resolve) => {
      setTimeout(() => {
        assentou = true;
        resolve("push-enviado-depois");
      }, 50);
    });
    const resultado = await dispararSemEsperarCliente(nuncaAssenta, 5);
    assertEquals(resultado, undefined, "devolve na hora, não espera a promessa");
    assertEquals(assentou, false, "a promessa ainda não assentou quando dispararSemEsperarCliente já devolveu");
    assertEquals(registradas.length, 1, "a promessa foi registrada no waitUntil do Edge Runtime");
    // Deixa a promessa assentar antes do teste acabar, para não vazar timer
    // (sanitizeResources padrão do Deno.test).
    await nuncaAssenta;
  } finally {
    delete (globalThis as Record<string, unknown>).EdgeRuntime;
  }
});

Deno.test("dispararSemEsperarCliente: sem EdgeRuntime no ambiente (o caso do `deno test`), cai em comTempoLimite byte a byte (mesmo teto de espera de antes)", async () => {
  assertEquals((globalThis as Record<string, unknown>).EdgeRuntime, undefined);
  const resultado = await dispararSemEsperarCliente(Promise.resolve("ok"), 50);
  assertEquals(resultado, "ok");
  const nuncaAssenta = new Promise<string>(() => {});
  const resultadoLento = await dispararSemEsperarCliente(nuncaAssenta, 10);
  assertEquals(resultadoLento, undefined, "sem waitUntil, o teto de espera continua valendo — mesmo comportamento de comTempoLimite");
});

Deno.test("enviarParaInscritos: envio pendurado falha temporariamente e libera o próximo lote", async () => {
  const tentadas: string[] = [];
  const removidas: string[] = [];
  const inscricoes = ["pendurada", "rapida", "proximo-lote"].map((id) => ({
    endpoint: `https://push.example/${id}`,
    p256dh: "x",
    auth: "y",
  }));
  const resultado = await comTempoLimite(enviarParaInscritos({
    servidor: {
      subscribe: ({ endpoint }: { endpoint: string }) => ({
        pushTextMessage: () => {
          tentadas.push(endpoint);
          return endpoint.endsWith("/pendurada")
            ? new Promise<void>(() => {})
            : Promise.resolve();
        },
      }),
    },
    inscricoes,
    mensagem: "{}",
    tamanhoDoLote: 2,
    tempoLimitePorEnvioMs: 5,
    aoDetectarMorta: (endpoint: string) => {
      removidas.push(endpoint);
      return Promise.resolve({ error: null });
    },
  }), 1_000);

  assertEquals(resultado?.length, 3, "o envio pendurado não prende o Promise.all");
  assertEquals(tentadas, inscricoes.map((sub) => sub.endpoint));
  assertEquals(resultado?.map((item: { ok: boolean }) => item.ok), [false, true, true]);
  assertEquals(resultado?.[0].status, null, "timeout é falha temporária");
  assertEquals(removidas, [], "timeout não invalida a inscrição");
});

Deno.test("enviarParaInscritos: DELETE resolvido com error não conta como inscrição removida", async () => {
  const erroDoBanco = { message: "DELETE recusado" };
  const logs: unknown[][] = [];
  const consoleError = console.error;
  console.error = (...args: unknown[]) => { logs.push(args); };
  try {
    const itens = await enviarParaInscritos({
      servidor: {
        subscribe: () => ({
          pushTextMessage: () => Promise.reject({ response: new Response(null, { status: 410 }) }),
        }),
      },
      inscricoes: ["falhou", "apagada"].map((id) => ({
        endpoint: `https://push.example/${id}`,
        p256dh: "x",
        auth: "y",
      })),
      mensagem: "{}",
      aoDetectarMorta: (endpoint: string) => Promise.resolve({
        error: endpoint.endsWith("/falhou") ? erroDoBanco : null,
      }),
    });

    assertEquals(itens.map((item: { removida: boolean }) => item.removida), [false, true]);
    assertEquals(resumir(itens).removidas, 1);
    assertEquals(resumir(itens).falharam, 2);
    assertEquals(logs.length, 1, "falha de remoção precisa ser registrada");
    assertEquals(logs[0][2], erroDoBanco);
  } finally {
    console.error = consoleError;
  }
});

// --- Endereço do aparelho: nunca se faz fetch para destino interno (SSRF cego) ---
//
// Qualquer conta autenticada grava em `push_subscriptions` uma linha com o
// próprio `user_id` e um `endpoint` ARBITRÁRIO (a policy só olha o dono), e a
// campanha sem alvo ou o aviso de status do pedido dava `fetch(endpoint)` direto.
// ATENÇÃO: este arquivo NÃO liga `aceitarPushServiceLocalSoNosTestes` (a brecha
// que os testes ponta a ponta da `send-push` usam para falar com um push service
// em localhost) — se ligasse, o teste abaixo deixaria de provar a trava.

// Montada em tempo de execução: dado de teste, não credencial (o secretlint
// leria o literal `esquema://usuario:senha@host` como BasicAuth).
const URL_COM_USUARIO_E_SENHA = ["https://", "user", ":", "senha", "@fcm.googleapis.com/x"].join("");

const ENDPOINTS_INTERNOS = [
  "http://127.0.0.1:8080/x",
  "https://127.0.0.1/x",
  "https://[::1]/x",
  "https://10.0.0.5/x",
  "https://169.254.169.254/latest/meta-data",
  "https://localhost/x",
  "https://servico.internal/x",
  "https://fcm.googleapis.com:8443/x",
  URL_COM_USUARIO_E_SENHA,
  "",
  "não é url",
];
const ENDPOINT_LEGITIMO = "https://fcm.googleapis.com/fcm/send/legitimo-1";

Deno.test("enviarParaInscritos: endpoint interno ou sem https NÃO chega ao subscribe, vira falha tratada, e o inscrito legítimo da mesma lista é enviado", async () => {
  const chamadasDeSubscribe: string[] = [];
  const mortasChamadas: string[] = [];
  const inscricoes = [
    ...ENDPOINTS_INTERNOS.slice(0, 5),
    ENDPOINT_LEGITIMO,
    ...ENDPOINTS_INTERNOS.slice(5),
  ].map((endpoint) => ({ endpoint, p256dh: "x", auth: "y" }));

  const itens = await enviarParaInscritos({
    servidor: {
      subscribe: ({ endpoint }: { endpoint: string }) => {
        chamadasDeSubscribe.push(endpoint);
        return { pushTextMessage: () => Promise.resolve() };
      },
    },
    inscricoes,
    mensagem: "{}",
    // Lote pequeno de propósito: provar também que a ordem e a contagem
    // sobrevivem a lotes que misturam endereço bom e ruim.
    tamanhoDoLote: 4,
    aoDetectarMorta: (endpoint: string) => {
      mortasChamadas.push(endpoint);
      return Promise.resolve({ error: null });
    },
  });

  assertEquals(chamadasDeSubscribe, [ENDPOINT_LEGITIMO], "só o legítimo chega ao subscribe");
  assertEquals(itens.length, inscricoes.length, "o lote não perde nem derruba ninguém");
  assertEquals(
    itens.map((i: { endpoint: string }) => i.endpoint),
    inscricoes.map((i) => i.endpoint),
    "um item por inscrição, na ordem de entrada",
  );
  for (const item of itens) {
    if (item.endpoint === ENDPOINT_LEGITIMO) {
      assertEquals(item.ok, true);
      continue;
    }
    assertEquals(item.ok, false, `recusado: ${JSON.stringify(item.endpoint)}`);
    assertEquals(item.motivo, MOTIVO_ENDPOINT_INVALIDO);
    assertEquals(item.status, null);
    assertEquals(item.removida, false, "endereço inválido não apaga a linha, só conta");
  }
  assertEquals(mortasChamadas, [], "recusa de endereço não é inscrição morta: nada é apagado");

  const resumo = resumir(itens);
  assertEquals(resumo.enviados, 1);
  assertEquals(resumo.falharam, ENDPOINTS_INTERNOS.length);
  assertEquals(resumo.removidas, 0);
  assertEquals(resumo.falhas.length, 1, "agrupado num motivo só");
  assertEquals(resumo.falhas[0].motivo, MOTIVO_ENDPOINT_INVALIDO);
  assertEquals(resumo.falhas[0].quantidade, ENDPOINTS_INTERNOS.length);
});

Deno.test("enviarParaInscritos com a biblioteca de verdade: nenhum fetch sai para destino interno; o endereço legítimo faz exatamente um fetch", async () => {
  const { publica, privada } = await parVapidDeTeste();
  const servidor = await webpush.ApplicationServer.new({
    contactInformation: "mailto:teste@ikcous.local",
    vapidKeys: await carregarChavesVapid(publica, privada),
  });
  const internos = await Promise.all(
    ENDPOINTS_INTERNOS.filter((e) => e !== "").map((e) => inscricaoDeTeste(e)),
  );
  const legitimo = await inscricaoDeTeste(ENDPOINT_LEGITIMO);

  const fetchOriginal = globalThis.fetch;
  const destinos: string[] = [];
  globalThis.fetch = ((entrada: Request | URL | string) => {
    destinos.push(String(entrada instanceof Request ? entrada.url : entrada));
    return Promise.resolve(new Response(null, { status: 201 }));
  }) as typeof fetch;
  try {
    const itens = await enviarParaInscritos({
      servidor,
      inscricoes: [...internos, legitimo],
      mensagem: "{}",
    });
    assertEquals(destinos, [ENDPOINT_LEGITIMO], "o único fetch é o do push service legítimo");
    assertEquals(itens.filter((i: { ok: boolean }) => i.ok).length, 1);
    assertEquals(itens.filter((i: { ok: boolean }) => !i.ok).length, internos.length);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});
