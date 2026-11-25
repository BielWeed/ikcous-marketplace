// @ts-nocheck
/**
 * send-push — buracos que a caça por mutação de 25/11/2026 achou depois dos
 * testes `index_leitura_em_paginas_e_resumo_test.ts` e `index_status_sem_alvo_test.ts`.
 *
 * Parte 1 (sem rede, relógio falso onde dá): as CONSTANTES do envio em lotes.
 *  - lote de 20 envios simultâneos (era 200 e ninguém notava);
 *  - orçamento de 50 s por campanha e limite de 10 s por aparelho (valores
 *    padrão, conferidos no instante exato com `FakeTime`);
 *  - `tempoLimitePorEnvioMs` chega até o envio (sem isso um aparelho pendurado
 *    seguraria o lote pelo padrão e não pelo valor pedido);
 *  - o prazo do lote em voo respeita o relógio injetado E o relógio real.
 *
 * Parte 2 (handler de ponta a ponta, push service local): o que só aparece na
 * borda — pré-voo OPTIONS (sem ele o navegador nunca deixa o painel chamar a
 * função), CORS e log na falha, o rótulo "send-push" nos logs de falha (é por
 * ele que se acha a função no painel de logs), e `VAPID_SUBJECT` que vira o
 * `sub` do JWT que o push service lê.
 *
 * MUTANTES EQUIVALENTES (anotados, não viram teste):
 *  - `ehAvisoDeStatusDoPedido` / `opcoesDeEnvioDoAviso` sem o `!Array.isArray`:
 *    JSON não tem array com a propriedade `type`, então `data` em array dá
 *    `type === undefined` do mesmo jeito.
 *  - `paginarTudo` sem `pagina.length === 0`: página vazia cai no `length <
 *    tamanho` logo abaixo e para igual.
 *  - `tamanhoDoLote: lote.length` -> `tamanhoDoLote` e a omissão de
 *    `tamanhoDoLote`/`orcamentoMs` na chamada do handler: os padrões de
 *    `enviarComOrcamentoDeTempo` SÃO as mesmas constantes.
 *  - `linhas || []` -> `linhas`: `paginarTudo` já trata página nula.
 *
 * ACHADO (não corrigido aqui, só relatado): `tokens` que não é lista (ex.:
 * texto ou objeto) é ignorado e a campanha cai na leitura do banco — vai para
 * TODOS os inscritos (só o aviso de status de pedido é barrado pela trava
 * `targetUserId`). Nenhum teste fixa isso de propósito.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { FakeTime } from "https://deno.land/std@0.177.0/testing/time.ts";
import * as webpush from "jsr:@negrel/webpush@0.3.0";
import { aceitarPushServiceLocalSoNosTestes } from "../_shared/endpoint-de-push.ts";
import { comTempoLimite } from "../_shared/webpush.ts";
import { bytesParaBase64Url, enviarComOrcamentoDeTempo, handler } from "./index.ts";

// ───────────────────────── Parte 1: o envio em lotes ─────────────────────────

const inscricoesFicticias = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ endpoint: `https://push.example/p/${i}`, p256dh: "x", auth: "y" }));

const servidorPendurado = () => ({
  subscribe: () => ({ pushTextMessage: () => new Promise<void>(() => {}) }),
});

/** Deixa as promessas (inclusive a rejeição do prazo) andarem até o fim. */
async function drenar() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

Deno.test("lote padrão: no máximo 20 envios ao mesmo tempo (45 inscritos = 20 + 20 + 5)", async () => {
  let emVoo = 0;
  let maximo = 0;
  const servidor = {
    subscribe: () => ({
      pushTextMessage: async () => {
        emVoo++;
        maximo = Math.max(maximo, emVoo);
        await new Promise((r) => setTimeout(r, 5));
        emVoo--;
      },
    }),
  };
  const { itens, naoTentados } = await enviarComOrcamentoDeTempo({
    servidor,
    inscricoes: inscricoesFicticias(45),
    mensagem: "{}",
  });
  assertEquals(itens.length, 45);
  assertEquals(naoTentados, 0);
  assertEquals(maximo, 20);
});

Deno.test("limite por aparelho: o padrão é 10 s EXATOS (9,999 s ainda espera, 10 s desiste)", async () => {
  const tempo = new FakeTime();
  try {
    let resultado: any = null;
    enviarComOrcamentoDeTempo({
      servidor: servidorPendurado(),
      inscricoes: inscricoesFicticias(1),
      mensagem: "{}",
    }).then((r: unknown) => {
      resultado = r;
    });
    await tempo.tickAsync(9_999);
    await drenar();
    assertEquals(resultado, null, "aos 9,999 s o aparelho ainda tem tempo");
    await tempo.tickAsync(1);
    await drenar();
    assert(resultado, "aos 10 s o aparelho pendurado já deve ter virado falha");
    assertEquals(resultado.itens.length, 1);
    assertEquals(resultado.itens[0].ok, false);
    assertEquals(resultado.naoTentados, 0);
  } finally {
    tempo.restore();
  }
});

Deno.test("orçamento padrão da campanha: 50 s EXATOS, mesmo que o limite por aparelho seja maior", async () => {
  const tempo = new FakeTime();
  try {
    let resultado: any = null;
    enviarComOrcamentoDeTempo({
      servidor: servidorPendurado(),
      inscricoes: inscricoesFicticias(1),
      mensagem: "{}",
      tempoLimitePorEnvioMs: 1_000_000,
    }).then((r: unknown) => {
      resultado = r;
    });
    await tempo.tickAsync(49_999);
    await drenar();
    assertEquals(resultado, null, "aos 49,999 s a campanha ainda está dentro do orçamento");
    await tempo.tickAsync(1);
    await drenar();
    assert(resultado, "aos 50 s o orçamento acaba e a espera é cortada");
    assertEquals(resultado.itens[0].ok, false);
  } finally {
    tempo.restore();
  }
});

Deno.test("tempoLimitePorEnvioMs pedido pela chamada chega ao envio (30 ms, não o padrão de 10 s)", async () => {
  const resultado = await comTempoLimite(
    enviarComOrcamentoDeTempo({
      servidor: servidorPendurado(),
      inscricoes: inscricoesFicticias(1),
      mensagem: "{}",
      tempoLimitePorEnvioMs: 30,
      orcamentoMs: 60_000,
    }),
    1_000,
  );
  assert(resultado, "o aparelho pendurado deveria ter sido cortado em ~30 ms");
  assertEquals(resultado.itens[0].ok, false);
});

Deno.test("o prazo do lote em voo também obedece o relógio injetado: restam 20 ms pelo relógio => o envio pendurado é cortado em ~20 ms", async () => {
  let chamadas = 0;
  // 1ª chamada marca o início (0); da 2ª em diante o relógio diz que restam 20 ms de 100 s.
  const agora = () => (++chamadas === 1 ? 0 : 99_980);
  const resultado = await comTempoLimite(
    enviarComOrcamentoDeTempo({
      servidor: servidorPendurado(),
      inscricoes: inscricoesFicticias(1),
      mensagem: "{}",
      orcamentoMs: 100_000,
      tempoLimitePorEnvioMs: 10_000,
      agora,
    }),
    1_000,
  );
  assert(resultado, "o lote ficou esperando além do que o orçamento restante permitia");
  assertEquals(resultado.itens.map((i: { ok: boolean }) => i.ok), [false]);
});

Deno.test("relógio injetado parado NÃO desliga o limite real: com 300 ms de orçamento e envios de 200 ms, os últimos lotes não saem", async () => {
  const servidor = {
    subscribe: () => ({ pushTextMessage: () => new Promise<void>((r) => setTimeout(r, 200)) }),
  };
  const { itens, naoTentados } = await enviarComOrcamentoDeTempo({
    servidor,
    inscricoes: inscricoesFicticias(6),
    mensagem: "{}",
    tamanhoDoLote: 1,
    orcamentoMs: 300,
    agora: () => 0, // relógio de mentira que nunca anda; só o relógio real corta
  });
  assert(itens.length < 6, `todos os 6 saíram (${itens.length}): o orçamento real foi ignorado`);
  assertEquals(itens.length + naoTentados, 6);
  assert(naoTentados >= 1);
  assertEquals(itens[0].ok, true);
});

// ──────────────────── Parte 2: o handler pela porta da frente ────────────────────

const VARIAVEIS = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEYS",
  "SUPABASE_SECRET_KEYS",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
];

async function chavesDeNavegador() {
  const par = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
  return {
    p256dh: bytesParaBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", par.publicKey))),
    auth: bytesParaBase64Url(crypto.getRandomValues(new Uint8Array(16))),
  };
}

type Opcoes = {
  metodo?: string;
  autorizacao?: string | null;
  inscricoes?: number;
  statusDoPush?: (caminho: string) => number;
  deleteDaInscricaoFalha?: boolean;
  semChavePublica?: boolean;
  vapidSubject?: string;
  payload?: Record<string, unknown>;
};

async function chamar(o: Opcoes = {}) {
  const parVapid = await webpush.generateVapidKeys({ extractable: true });
  const vapid = await webpush.exportVapidKeys(parVapid);
  const chaves = await chavesDeNavegador();
  const autorizacoesDoPush: Array<string | null> = [];
  const desfazerBrecha = aceitarPushServiceLocalSoNosTestes();
  const servidor = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    await req.arrayBuffer();
    autorizacoesDoPush.push(req.headers.get("authorization"));
    return new Response(null, { status: o.statusDoPush?.(new URL(req.url).pathname) ?? 201 });
  });
  const base = `http://localhost:${servidor.addr.port}`;
  const fetchAnterior = globalThis.fetch;
  const anteriores = VARIAVEIS.map((chave) => [chave, Deno.env.get(chave)] as const);
  const saiu: string[] = [];
  const originais = { error: console.error, warn: console.warn, log: console.log };
  const anota = (...args: unknown[]) =>
    saiu.push(args.map((a) => (a instanceof Error ? `${a.message}` : typeof a === "object" ? JSON.stringify(a) : String(a))).join(" "));
  try {
    for (const v of VARIAVEIS) Deno.env.delete(v);
    Deno.env.set("SUPABASE_URL", "https://supa-fake.local");
    if (!o.semChavePublica) Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: "anon-de-teste" }));
    Deno.env.set("SUPABASE_SECRET_KEYS", JSON.stringify({ default: "service-role-de-teste" }));
    Deno.env.set("VAPID_PUBLIC_KEY", JSON.stringify(vapid.publicKey));
    Deno.env.set("VAPID_PRIVATE_KEY", JSON.stringify(vapid.privateKey));
    if (o.vapidSubject) Deno.env.set("VAPID_SUBJECT", o.vapidSubject);

    const banco = Array.from({ length: o.inscricoes ?? 1 }, (_, i) => ({
      id: String(i).padStart(5, "0"),
      user_id: "cliente-x",
      endpoint: `${base}/p/${i}`,
      p256dh: chaves.p256dh,
      auth: chaves.auth,
    }));
    globalThis.fetch = async (entrada, opcoes) => {
      const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
      if (url.origin === base) return await fetchAnterior(entrada, opcoes);
      if (url.origin !== "https://supa-fake.local") throw new Error("Requisição fora do roteiro do teste");
      const json = (dados: unknown, status = 200) =>
        new Response(JSON.stringify(dados), { status, headers: { "Content-Type": "application/json" } });
      if (url.pathname === "/auth/v1/user") {
        return json({ id: "admin-de-teste", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email", role: "admin" } });
      }
      if (url.pathname === "/rest/v1/profiles") return json({ id: "admin-de-teste", role: "admin" });
      if (url.pathname === "/rest/v1/push_subscriptions") {
        const metodo = opcoes?.method ?? (entrada instanceof Request ? entrada.method : "GET");
        if (metodo === "GET") {
          const inicio = Number(url.searchParams.get("offset") ?? 0);
          return json(banco.slice(inicio, inicio + Number(url.searchParams.get("limit") ?? 1000)));
        }
        if (metodo === "DELETE") {
          return o.deleteDaInscricaoFalha ? json({ message: "falha simulada", code: "XX000" }, 500) : new Response(null, { status: 204 });
        }
      }
      throw new Error("Operação fora do roteiro do banco");
    };

    console.error = anota;
    console.warn = anota;
    console.log = anota;
    const metodo = o.metodo ?? "POST";
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const autorizacao = o.autorizacao === undefined ? "Bearer jwt-de-teste" : o.autorizacao;
    if (autorizacao) headers.Authorization = autorizacao;
    const resposta = await handler(
      new Request("http://local/send-push", {
        method: metodo,
        headers,
        body: metodo === "POST" ? JSON.stringify(o.payload ?? { title: "Promoção", body: "Texto fictício" }) : undefined,
      }),
    );
    const texto = await resposta.text();
    return { resposta, texto, logs: saiu.join("\n"), autorizacoesDoPush, base };
  } finally {
    console.error = originais.error;
    console.warn = originais.warn;
    console.log = originais.log;
    globalThis.fetch = fetchAnterior;
    for (const [chave, valor] of anteriores) {
      if (valor === undefined) Deno.env.delete(chave);
      else Deno.env.set(chave, valor);
    }
    desfazerBrecha();
    await servidor.shutdown();
  }
}

function exigirCors(r: Response, rotulo: string) {
  assertEquals(r.headers.get("Access-Control-Allow-Origin"), "*", rotulo);
  const permitidos = (r.headers.get("Access-Control-Allow-Headers") ?? "").split(",").map((c) => c.trim().toLowerCase());
  for (const cabecalho of ["authorization", "x-client-info", "apikey", "content-type"]) {
    assert(permitidos.includes(cabecalho), `${rotulo}: falta ${cabecalho}`);
  }
}

Deno.test("pré-voo OPTIONS: 200 'ok' com CORS, sem exigir sessão e sem tocar banco nem push", async () => {
  const r = await chamar({ metodo: "OPTIONS", autorizacao: null });
  assertEquals(r.resposta.status, 200);
  assertEquals(r.texto, "ok");
  exigirCors(r.resposta, "pré-voo");
  assertEquals(r.autorizacoesDoPush, []);
});

Deno.test("sem Authorization: 400 com a causa no corpo, CORS na resposta de erro e a falha vai para o log da função", async () => {
  const r = await chamar({ autorizacao: null });
  assertEquals(r.resposta.status, 400);
  assertEquals(JSON.parse(r.texto), { ok: false, error: "Missing Authorization header" });
  exigirCors(r.resposta, "400");
  assertStringIncludes(r.logs, "send-push: Missing Authorization header");
  assertStringIncludes(r.logs, "send-push: erro na requisição");
  assertEquals(r.autorizacoesDoPush, []);
});

Deno.test("a checagem de admin que quebra loga com o rótulo send-push (e recusa, sem enviar nada)", async () => {
  // Sem a chave pública o client de sessão nem nasce: cai no `catch` do admin-atual.
  const r = await chamar({ semChavePublica: true });
  assertEquals(r.resposta.status, 400);
  assertEquals(JSON.parse(r.texto).error, "Unauthorized: Admin access required");
  assertStringIncludes(r.logs, "send-push: Falha no check de admin:");
  assertEquals(r.autorizacoesDoPush, []);
});

Deno.test("inscrição morta (410) que o banco não consegue apagar: o log leva o rótulo send-push e o resumo conta a falha, sem remoção", async () => {
  const r = await chamar({
    inscricoes: 1,
    statusDoPush: () => 410,
    deleteDaInscricaoFalha: true,
  });
  assertEquals(r.resposta.status, 200);
  const corpo = JSON.parse(r.texto);
  assertEquals(corpo.enviados, 0);
  assertEquals(corpo.falharam, 1);
  assertEquals(corpo.removidas, 0);
  assertStringIncludes(r.logs, "send-push: falhou ao remover inscrição morta");
});

function subDoJwt(autorizacao: string | null): string {
  const jwt = /t=([^,\s]+)/.exec(autorizacao ?? "")?.[1] ?? "";
  const payload = jwt.split(".")[1] ?? "";
  const normal = payload.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(normal.padEnd(Math.ceil(normal.length / 4) * 4, "="))).sub;
}

Deno.test("VAPID_SUBJECT do ambiente vira o 'sub' do JWT que o push service recebe; sem ele vale o padrão mailto:admin@example.org", async () => {
  const com = await chamar({ vapidSubject: "mailto:loja.teste@example.com" });
  assertEquals(com.resposta.status, 200);
  assertEquals(com.autorizacoesDoPush.length, 1);
  assertEquals(subDoJwt(com.autorizacoesDoPush[0]), "mailto:loja.teste@example.com");

  const sem = await chamar({});
  assertEquals(sem.resposta.status, 200);
  assertEquals(subDoJwt(sem.autorizacoesDoPush[0]), "mailto:admin@example.org");
});
