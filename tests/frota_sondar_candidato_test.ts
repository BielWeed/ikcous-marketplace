// @ts-nocheck
/* eslint-disable security/detect-object-injection -- dublês de teste: as chaves vêm de constantes e mapas fechados do próprio arquivo, nunca de entrada externa. */
/**
 * scripts/frota/sondar-candidato.mjs — a prova de que o deploy CANDIDATO (o `.vercel.app` ainda não
 * promovido) abre cada loja com o banco certo (plano PLANO-RESERVA-DA-CADERNETA-26-11.md, T12). Todas
 * as dependências são dublês: nenhuma rede, nenhum CLI, nenhuma espera de verdade. Domínios, refs e
 * chaves são INVENTADOS.
 *
 * O QUE ESTES TESTES MEDEM:
 *  - todas as lojas com o ref do inventário = SIM; um ref divergente = NÃO;
 *  - 404 (sonda desligada), 429 que não passa e rede caída = INCERTO, nunca SIM;
 *  - 429 seguido de resposta boa conta como resposta boa;
 *  - o ritmo de 1 sonda por segundo (o teto da sonda é 60 por minuto por instância), provado pela
 *    espera injetada num relógio de mentira;
 *  - host fora da forma normalizada no inventário recusa ANTES de qualquer pedido;
 *  - a régua de host do script concorda com a da própria sonda (`hostDaSonda`).
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  CAMINHO_DA_SONDA,
  RITMO_MS,
  alvosDoInventario,
  executar,
  hostSondavel,
  sondarCandidato,
  urlDoCandidato,
} from "../scripts/frota/sondar-candidato.mjs";
import {
  CAMINHO_DA_SONDA as CAMINHO_DA_SONDA_NO_PORTEIRO,
  hostDaSonda,
} from "../src/hospedagem/sondaDoCandidato.ts";

const REF_A = `lojaum${"a".repeat(14)}`;
const REF_B = `lojadois${"b".repeat(12)}`;
const REF_C = `lojatres${"c".repeat(12)}`;
const CANDIDATO = "https://ickous-inventado-abc123-escopo-inventado.vercel.app";

const politicaBase = () => ({
  projetoVercel: { id: "prj_inventado", time: "team_inventado", escopo: "x" },
  lojasSemBackendGerenciado: [],
  enderecosEsperados: [],
  aliasesDePreview: [],
});
const canaisBase = () => ({
  canais: { [REF_A]: { nome: "Loja Um" }, [REF_B]: { nome: "Loja Dois" } },
});

function sonda(dominio, opcoes = {}) {
  const {
    status = 200,
    caderneta = "hit",
    refs = [REF_A],
    estavel = true,
  } = opcoes;
  return {
    dominio,
    versao: null,
    ficha: { status, caderneta, refs, estavel, titulo: "Loja" },
    chavePublica: "sb_publishable_inventada",
    errosPagina: [],
    amostras: [],
  };
}
const inventario = (sondas, completo = true) => ({
  origem: completo ? "vercel" : "reserva",
  completo,
  motivoParcial: completo ? null : "sem --vercel",
  dominios: sondas.map((s) => s.dominio),
  vercel: completo ? { ok: true } : null,
  sondas,
});
const frotaBase = () =>
  inventario([
    sonda("loja-um.exemplo.test"),
    sonda("www.loja-um.exemplo.test"),
    sonda("loja-dois.exemplo.test", { refs: [REF_B] }),
  ]);
const ESPERADO = {
  "loja-um.exemplo.test": REF_A,
  "www.loja-um.exemplo.test": REF_A,
  "loja-dois.exemplo.test": REF_B,
};

const json = (corpo, status = 200, cabecalhos = {}) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json", ...cabecalhos },
  });
const respostaOk = (host, ref, caderneta = "hit") =>
  json({
    host,
    porteiro: "ok",
    caderneta,
    ref,
    destinoDaCaderneta: "caderneta.exemplo.test",
  });

/**
 * Relógio de mentira: `esperar(ms)` só avança o relógio. O `fetch` dublê anota o instante de cada
 * pedido; `responder(host, tentativa)` decide a resposta (padrão: ok com o ref esperado).
 */
function ambiente(responder = (host) => respostaOk(host, ESPERADO[host])) {
  const relogio = { agora: 0 };
  const esperas = [];
  const pedidos = [];
  const tentativas = new Map();
  const esperar = async (ms) => {
    esperas.push(ms);
    relogio.agora += ms;
  };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(String(url));
    const host = u.searchParams.get("host");
    const n = (tentativas.get(host) ?? 0) + 1;
    tentativas.set(host, n);
    pedidos.push({
      url: u,
      host,
      instante: relogio.agora,
      metodo: init.method ?? "GET",
    });
    return responder(host, n);
  };
  return { relogio, esperas, pedidos, esperar, fetchImpl };
}

const alvosBase = () =>
  alvosDoInventario(frotaBase(), politicaBase(), [
    { ref: REF_A, nome: "Loja Um" },
    { ref: REF_B, nome: "Loja Dois" },
  ]);

// ------------------------------------------------------------------ veredito

Deno.test("todas as lojas com o ref do inventário: SIM", async () => {
  const amb = ambiente();
  const r = await sondarCandidato({
    candidato: urlDoCandidato(CANDIDATO).origem,
    ...alvosBase(),
    fetchImpl: amb.fetchImpl,
    esperar: amb.esperar,
  });
  assertEquals(r.veredito, "SIM");
  assertEquals(r.resultados.length, 3);
  assert(r.resultados.every((x) => x.tipo === "ok"));
  // Cada pedido é um GET na rota da sonda do candidato, com o host da loja.
  for (const p of amb.pedidos) {
    assertEquals(p.url.origin, CANDIDATO);
    assertEquals(p.url.pathname, CAMINHO_DA_SONDA);
    assertEquals(p.metodo, "GET");
  }
  assertEquals(
    amb.pedidos.map((p) => p.host).sort(),
    Object.keys(ESPERADO).sort(),
  );
});

Deno.test("um ref divergente: NÃO, com o host no motivo", async () => {
  const amb = ambiente((host) =>
    respostaOk(
      host,
      host === "loja-dois.exemplo.test" ? REF_C : ESPERADO[host],
    ),
  );
  const r = await sondarCandidato({
    candidato: CANDIDATO,
    ...alvosBase(),
    fetchImpl: amb.fetchImpl,
    esperar: amb.esperar,
  });
  assertEquals(r.veredito, "NÃO");
  const errado = r.resultados.find((x) => x.host === "loja-dois.exemplo.test");
  assertEquals(errado.tipo, "divergente");
  assertStringIncludes(errado.motivo, REF_B);
  assertStringIncludes(errado.motivo, REF_C);
});

Deno.test("porteiro que não abriu a loja (ref null): NÃO", async () => {
  const amb = ambiente((host) =>
    host === "loja-um.exemplo.test"
      ? json({
          host,
          porteiro: "erro",
          caderneta: "erro",
          ref: null,
          destinoDaCaderneta: null,
        })
      : respostaOk(host, ESPERADO[host]),
  );
  const r = await sondarCandidato({
    candidato: CANDIDATO,
    ...alvosBase(),
    fetchImpl: amb.fetchImpl,
    esperar: amb.esperar,
  });
  assertEquals(r.veredito, "NÃO");
});

Deno.test("porteiro diferente de ok com o ref certo: NÃO, nunca SIM", async () => {
  const amb = ambiente((host) =>
    host === "loja-um.exemplo.test"
      ? json({
          host,
          porteiro: "erro",
          caderneta: "hit",
          ref: REF_A,
          destinoDaCaderneta: "caderneta.exemplo.test",
        })
      : respostaOk(host, ESPERADO[host]),
  );
  const r = await sondarCandidato({
    candidato: CANDIDATO,
    ...alvosBase(),
    fetchImpl: amb.fetchImpl,
    esperar: amb.esperar,
  });
  assertEquals(r.veredito, "NÃO");
  const errado = r.resultados.find((x) => x.host === "loja-um.exemplo.test");
  assertEquals(errado.tipo, "divergente");
  assertStringIncludes(errado.motivo, "porteiro erro");
});

Deno.test("401 e 403 (proteção de deploy da Vercel): INCERTO e para de sondar", async () => {
  for (const status of [401, 403]) {
    const amb = ambiente(
      () => new Response("<html>login da Vercel</html>", { status }),
    );
    const r = await sondarCandidato({
      candidato: CANDIDATO,
      ...alvosBase(),
      fetchImpl: amb.fetchImpl,
      esperar: amb.esperar,
    });
    assertEquals(r.veredito, "INCERTO", `HTTP ${status}`);
    // A proteção vale para o deploy inteiro: não insiste nas outras lojas.
    assertEquals(amb.pedidos.length, 1, `HTTP ${status}`);
    assert(
      r.motivos.some((m) => m.includes(String(status))),
      `HTTP ${status}`,
    );
    assertEquals(r.naoSondados, 3);
  }
});

Deno.test("404 (sonda desligada neste deploy): INCERTO e para de sondar", async () => {
  const amb = ambiente(() => json({ sonda: "desligada" }, 404));
  const r = await sondarCandidato({
    candidato: CANDIDATO,
    ...alvosBase(),
    fetchImpl: amb.fetchImpl,
    esperar: amb.esperar,
  });
  assertEquals(r.veredito, "INCERTO");
  // A sonda desligada vale para o deploy inteiro: não insiste nas outras lojas.
  assertEquals(amb.pedidos.length, 1);
  assert(r.motivos.some((m) => m.includes("404")));
});

Deno.test("429 e depois resposta boa: conta a resposta boa (SIM)", async () => {
  const amb = ambiente((host, n) =>
    host === "www.loja-um.exemplo.test" && n === 1
      ? json({ sonda: "limite" }, 429, { "retry-after": "60" })
      : respostaOk(host, ESPERADO[host]),
  );
  const r = await sondarCandidato({
    candidato: CANDIDATO,
    ...alvosBase(),
    fetchImpl: amb.fetchImpl,
    esperar: amb.esperar,
  });
  assertEquals(r.veredito, "SIM");
  assertEquals(amb.pedidos.length, 4);
  // Antes de repetir, esperou o que o retry-after pediu (60 s).
  assert(amb.esperas.includes(60_000));
});

Deno.test("429 que não passa: INCERTO, nunca SIM, e para", async () => {
  const amb = ambiente(() =>
    json({ sonda: "limite" }, 429, { "retry-after": "60" }),
  );
  const r = await sondarCandidato({
    candidato: CANDIDATO,
    ...alvosBase(),
    fetchImpl: amb.fetchImpl,
    esperar: amb.esperar,
  });
  assertEquals(r.veredito, "INCERTO");
  // Só a primeira loja foi tentada (3 vezes); as outras não foram sondadas.
  assertEquals(new Set(amb.pedidos.map((p) => p.host)).size, 1);
  assertEquals(amb.pedidos.length, 3);
  assert(r.motivos.some((m) => m.includes("429")));
});

Deno.test("rede caída: INCERTO, nunca SIM", async () => {
  const amb = ambiente((host) => {
    if (host === "loja-dois.exemplo.test")
      throw new TypeError("error sending request: connection refused");
    return respostaOk(host, ESPERADO[host]);
  });
  const r = await sondarCandidato({
    candidato: CANDIDATO,
    ...alvosBase(),
    fetchImpl: amb.fetchImpl,
    esperar: amb.esperar,
  });
  assertEquals(r.veredito, "INCERTO");
  const caiu = r.resultados.find((x) => x.host === "loja-dois.exemplo.test");
  assertEquals(caiu.tipo, "incerto");
});

Deno.test("resposta 200 fora do contrato (outro host, corpo não JSON): INCERTO", async () => {
  for (const ruim of [
    () => respostaOk("outra.exemplo.test", REF_A),
    () => new Response("<html>loja</html>", { status: 200 }),
  ]) {
    const amb = ambiente((host) =>
      host === "loja-um.exemplo.test"
        ? ruim()
        : respostaOk(host, ESPERADO[host]),
    );
    const r = await sondarCandidato({
      candidato: CANDIDATO,
      ...alvosBase(),
      fetchImpl: amb.fetchImpl,
      esperar: amb.esperar,
    });
    assertEquals(r.veredito, "INCERTO");
  }
});

Deno.test("caderneta esperada (prova 1/2): hit quando se esperava reserva = NÃO", async () => {
  const amb = ambiente((host) =>
    respostaOk(
      host,
      ESPERADO[host],
      host === "loja-um.exemplo.test" ? "hit" : "reserva",
    ),
  );
  const r = await sondarCandidato({
    candidato: CANDIDATO,
    ...alvosBase(),
    fetchImpl: amb.fetchImpl,
    esperar: amb.esperar,
    cadernetaEsperada: "reserva",
  });
  assertEquals(r.veredito, "NÃO");
  const amb2 = ambiente((host) => respostaOk(host, ESPERADO[host], "reserva"));
  const r2 = await sondarCandidato({
    candidato: CANDIDATO,
    ...alvosBase(),
    fetchImpl: amb2.fetchImpl,
    esperar: amb2.esperar,
    cadernetaEsperada: "reserva",
  });
  assertEquals(r2.veredito, "SIM");
});

// ------------------------------------------------------------------ ritmo

Deno.test("ritmo: no máximo 1 sonda por segundo, pela espera injetada", async () => {
  const sondas = Array.from({ length: 70 }, (_, i) =>
    sonda(`loja-${i}.exemplo.test`),
  );
  const alvos = alvosDoInventario(inventario(sondas), politicaBase(), []);
  assertEquals(alvos.alvos.length, 70);
  const amb = ambiente((host) => respostaOk(host, REF_A));
  const r = await sondarCandidato({
    candidato: CANDIDATO,
    ...alvos,
    fetchImpl: amb.fetchImpl,
    esperar: amb.esperar,
  });
  assertEquals(r.veredito, "SIM");
  assertEquals(RITMO_MS, 1000);
  assertEquals(amb.pedidos.length, 70);
  for (let i = 1; i < amb.pedidos.length; i++)
    assert(
      amb.pedidos[i].instante - amb.pedidos[i - 1].instante >= RITMO_MS,
      `pedido ${i} saiu ${amb.pedidos[i].instante - amb.pedidos[i - 1].instante} ms depois do anterior`,
    );
  // Em qualquer janela de 60 s cabem no máximo 60 pedidos (o teto da sonda).
  for (const p of amb.pedidos) {
    const naJanela = amb.pedidos.filter(
      (q) => q.instante >= p.instante && q.instante < p.instante + 60_000,
    ).length;
    assert(naJanela <= 60, `${naJanela} pedidos numa janela de 60 s`);
  }
});

// ------------------------------------------------------------------ inventário

Deno.test("host inválido no inventário: recusa antes de qualquer pedido", async () => {
  const inv = frotaBase();
  inv.sondas.push(sonda("Loja-Tres.Exemplo.test:8443"));
  const alvos = alvosDoInventario(inv, politicaBase(), []);
  assertEquals(alvos.invalidos, ["Loja-Tres.Exemplo.test:8443"]);
  const amb = ambiente();
  const r = await sondarCandidato({
    candidato: CANDIDATO,
    ...alvos,
    fetchImpl: amb.fetchImpl,
    esperar: amb.esperar,
  });
  assertEquals(r.veredito, "INCERTO");
  assertEquals(amb.pedidos.length, 0);
  assertEquals(amb.esperas.length, 0);
  assert(r.motivos.some((m) => m.includes("Loja-Tres.Exemplo.test:8443")));
});

Deno.test("inventário: só entra loja hit estável; o resto definitivo fica fora", () => {
  const inv = inventario([
    sonda("loja-um.exemplo.test"),
    sonda("sem-loja.exemplo.test", {
      status: 404,
      caderneta: "miss",
      refs: [],
    }),
  ]);
  const a = alvosDoInventario(inv, politicaBase(), []);
  assertEquals(a.alvos, [{ host: "loja-um.exemplo.test", ref: REF_A }]);
  assertEquals(a.problemas, []);
});

Deno.test("inventário parcial, endereço indeterminado ou loja obrigatória ausente: INCERTO mesmo com tudo ok", async () => {
  const casos = [
    alvosDoInventario(
      inventario(frotaBase().sondas, false),
      politicaBase(),
      [],
    ),
    alvosDoInventario(
      inventario([
        ...frotaBase().sondas,
        sonda("instavel.exemplo.test", { estavel: false }),
      ]),
      politicaBase(),
      [],
    ),
    alvosDoInventario(frotaBase(), politicaBase(), [
      { ref: REF_C, nome: "Loja Três" },
    ]),
  ];
  for (const alvos of casos) {
    assert(alvos.problemas.length > 0);
    const amb = ambiente();
    const r = await sondarCandidato({
      candidato: CANDIDATO,
      ...alvos,
      fetchImpl: amb.fetchImpl,
      esperar: amb.esperar,
    });
    assertEquals(r.veredito, "INCERTO");
  }
});

Deno.test("nenhuma loja para sondar: INCERTO", async () => {
  const amb = ambiente();
  const r = await sondarCandidato({
    candidato: CANDIDATO,
    ...alvosDoInventario(inventario([]), politicaBase(), []),
    fetchImpl: amb.fetchImpl,
    esperar: amb.esperar,
  });
  assertEquals(r.veredito, "INCERTO");
});

// ------------------------------------------------------------------ réguas

Deno.test("a régua de host do script concorda com a da sonda (hostDaSonda)", () => {
  assertEquals(CAMINHO_DA_SONDA, CAMINHO_DA_SONDA_NO_PORTEIRO);
  const casos = [
    "loja.com.br",
    "www.loja-um.exemplo.test",
    "a.b",
    "Loja.com.br",
    "loja.com.br:443",
    "loja.com.br.",
    "10.0.0.1",
    "localhost",
    "-loja.com.br",
    "loja-.com.br",
    "lo_ja.com.br",
    "loja..com.br",
    `${"a".repeat(64)}.com`,
    `${"a".repeat(63)}.com`,
    `${"a.".repeat(126)}com`,
    "",
    "xn--loja-9xa.com.br",
    "loja.123",
  ];
  for (const host of casos) {
    const daSonda =
      hostDaSonda(
        new URL(`https://x.test/?host=${encodeURIComponent(host)}`),
      ) !== null;
    assertEquals(hostSondavel(host), daSonda, `discordam em "${host}"`);
  }
});

Deno.test("endereço do candidato: só https://<algo>.vercel.app, sem caminho", () => {
  assertEquals(urlDoCandidato(CANDIDATO).origem, CANDIDATO);
  assertEquals(urlDoCandidato(`${CANDIDATO}/`).origem, CANDIDATO);
  // Sem protocolo, o dono cola do painel: vale como https.
  assertEquals(
    urlDoCandidato(CANDIDATO.replace("https://", "")).origem,
    CANDIDATO,
  );
  for (const ruim of [
    "http://x.vercel.app",
    "https://loja.com.br",
    "https://x.vercel.app/painel",
    "https://x.vercel.app/?a=1",
    // Montado por partes para o detector de segredo não confundir o fixture.
    ["https://", "usuario", ":", "inventado", "@x.vercel.app"].join(""),
    "https://vercel.app",
    "https://x.vercel.app.evil.test",
    "",
  ])
    assert(urlDoCandidato(ruim).erro, `aceitou ${ruim}`);
});

// ------------------------------------------------------------------ linha de comando

function depsDeComando(responder) {
  const amb = ambiente(responder);
  const progresso = [];
  return {
    amb,
    progresso,
    deps: {
      politica: politicaBase(),
      canais: canaisBase(),
      inventariar: async () => frotaBase(),
      fetchImpl: amb.fetchImpl,
      esperar: amb.esperar,
      progresso: (l) => progresso.push(l),
    },
  };
}

Deno.test("comando: SIM sai 0, NÃO sai 1, INCERTO sai 3, uso errado sai 2", async () => {
  const sim = depsDeComando();
  const r = await executar(["--candidato", CANDIDATO], sim.deps);
  assertEquals(r.codigo, 0);
  assertStringIncludes(r.saida.join("\n"), "RESULTADO: SIM");

  const nao = depsDeComando((host) => respostaOk(host, REF_C));
  const r2 = await executar(["--candidato", CANDIDATO], nao.deps);
  assertEquals(r2.codigo, 1);
  assertStringIncludes(r2.saida.join("\n"), "RESULTADO: NÃO");

  const incerto = depsDeComando(() => json({ sonda: "desligada" }, 404));
  const r3 = await executar(["--candidato", CANDIDATO], incerto.deps);
  assertEquals(r3.codigo, 3);
  assertStringIncludes(r3.saida.join("\n"), "RESULTADO: INCERTO");

  for (const argv of [
    [],
    ["--candidato"],
    ["--candidato", "https://loja.com.br"],
    ["--candidato", CANDIDATO, "--caderneta", "erro"],
    ["--candidato", CANDIDATO, "--outra"],
  ]) {
    const u = depsDeComando();
    const r4 = await executar(argv, u.deps);
    assertEquals(r4.codigo, 2, argv.join(" "));
    assertEquals(u.amb.pedidos.length, 0);
  }
});

Deno.test("comando: a saída não repete corpo de resposta nem campo fora da régua", async () => {
  const SEGREDO = ["sb", "secret", "inventada", "no", "corpo"].join("_");
  const c = depsDeComando((host) =>
    json({
      host,
      porteiro: `ok ${SEGREDO}`,
      caderneta: SEGREDO,
      ref: ESPERADO[host],
      destinoDaCaderneta: `${SEGREDO}.exemplo.test/caminho?token=1`,
      extra: SEGREDO,
    }),
  );
  const r = await executar(["--candidato", CANDIDATO], c.deps);
  const tudo = [...r.saida, ...r.erros, ...c.progresso].join("\n");
  assert(!tudo.includes(SEGREDO), tudo);
});

Deno.test("comando: avisa o tempo estimado antes de começar", async () => {
  const c = depsDeComando();
  await executar(["--candidato", CANDIDATO], c.deps);
  assert(c.progresso.length > 0);
  assertStringIncludes(c.progresso[0], "3 endereços");
});
