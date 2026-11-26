// @ts-nocheck
/* eslint-disable security/detect-object-injection -- dublês de teste: as chaves vêm de constantes e mapas fechados do próprio arquivo, nunca de entrada externa. */
/**
 * scripts/frota/publicar-release.mjs — o passo 4b (a reserva da caderneta,
 * PLANO-RESERVA-DA-CADERNETA-26-11, T9) e a exigência de `x-ikcous-reserva:
 * ligada` no candidato.
 *
 * O QUE ESTES TESTES MEDEM (dublês para tudo: nenhuma rede, nenhum CLI,
 * nenhuma Vercel; lojas, domínios, refs e chaves inventados):
 *  - reserva desligada (politica.json globalConfigId null): o portão avisa e
 *    segue, sem ler nem gravar, e o candidato sem `x-ikcous-reserva` passa;
 *  - lista de lojas igual à da store (sha e gerada_em diferentes): nenhuma
 *    gravação, promove sem esperar;
 *  - lista diferente: UMA gravação, a espera da propagação e SÓ ENTÃO o
 *    promote;
 *  - gravação que falha, cota (mensagem própria) e endereço indeterminado:
 *    NÃO promove e diz por quê;
 *  - o ensaio só lê (GET) e mostra a diferença;
 *  - candidato sem `x-ikcous-reserva: ligada` com a reserva configurada:
 *    bloqueia antes de tocar na store;
 *  - loja obrigatória adormecida não trava a reserva (a reserva só leva loja
 *    ativa, D3).
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  ESPERA_DA_RESERVA_MS,
  publicarRelease,
} from "../scripts/frota/publicar-release.mjs";

const SHA = "5".repeat(40);
const BASE = "6".repeat(40);
const TOPO = "7".repeat(40);
const OUTRO_SHA = "8".repeat(40);
const IDENT = "e".repeat(64);
const LOJA_A = "a".repeat(20);
const LOJA_B = "b".repeat(20);
const LOJA_C = "c".repeat(20);
const DPL = "dpl_NovoInventado1";
const DPL_ANTERIOR = "dpl_AnteriorInventado2";
const AGORA = Date.parse("2026-11-26T15:00:00Z");
const ID_DA_STORE = "ecfg_inventada123";
const DOM_A = "loja-a-inventada.vercel.app";
const DOM_B = "loja-b-inventada.vercel.app";
const DOM_C = "loja-c-inventada.vercel.app";
const CHAVE_A = "sb_publishable_inventadaA";
const CHAVE_B = "sb_publishable_inventadaB";
const ARQUIVO_NOTAS = "src/novidades/notas-das-versoes.json";

const politicaCom = (reservaDaCaderneta) => ({
  projetoVercel: { id: "prj_X", time: "team_Inventado", escopo: "time-x" },
  lojasSemBackendGerenciado: [],
  enderecosEsperados: [{ dominio: "manut.vercel.app", estado: "manutencao" }],
  migrationsForaDaRelease: [],
  lojasQueNuncaDormem: [{ ref: LOJA_A }],
  ...(reservaDaCaderneta === undefined ? {} : { reservaDaCaderneta }),
});
const LIGADA = { globalConfigId: ID_DA_STORE, chave: "reserva_v1" };
const DESLIGADA = { globalConfigId: null, chave: "reserva_v1" };

const canal = (nome) => ({
  nome,
  migrations: nome,
  functions: nome,
  projetosNoMesmoBanco: [],
  functionsPublicaveis: [],
});
const CANAIS = {
  ramoDaRelease: "claude/ramo-inventado",
  funcoesNaoPublicadas: [],
  validadeDaEvidenciaHoras: 6,
  provasDeObjetos: [],
  canais: { [LOJA_A]: canal("loja-a"), [LOJA_B]: canal("loja-b") },
};

function versao(sha = SHA) {
  return JSON.stringify({
    version: `1.5.18-sha.${sha.slice(0, 7)}-identity.${IDENT}`,
    codeVersion: "1.5.18",
    codeSha: sha,
    identityRevision: IDENT,
    source: "database",
    promotable: true,
  });
}

/** Sonda de uma loja ativa: ficha estável 200 hit de UM ref, com a chave pública. */
function sonda(dominio, ref, chavePublica, extra = {}) {
  return {
    dominio,
    versao: { codeSha: BASE },
    chavePublica,
    ficha: {
      status: 200,
      caderneta: "hit",
      titulo: `Loja ${ref.slice(0, 1)}`,
      refs: [ref],
      estavel: true,
      ...extra,
    },
  };
}

/** Sonda de loja adormecida (o contrato de cabeçalhos do porteiro, L8). */
function sondaAdormecida(dominio, ref) {
  const amostra = {
    status: 503,
    caderneta: "hit",
    porteiro: "adormecida",
    estado: "adormecida",
    refPorteiro: ref,
    titulo: "Loja fechada",
    refs: [],
  };
  return {
    dominio,
    versao: { codeSha: BASE },
    amostras: [amostra, amostra, amostra],
    ficha: { ...amostra, estavel: true },
  };
}

/** A reserva que a frota padrão (A e B ativas) produz, com sha/gerada_em à escolha. */
function reservaDaFrota({ sha = SHA, geradaEm = AGORA } = {}) {
  return {
    v: 1,
    gerada_em: new Date(geradaEm).toISOString(),
    sha,
    hosts: {
      [DOM_A]: { u: `https://${LOJA_A}.supabase.co`, k: CHAVE_A },
      [DOM_B]: { u: `https://${LOJA_B}.supabase.co`, k: CHAVE_B },
    },
  };
}

function montar(ajuste = {}) {
  const ordem = [];
  const chamadas = { promover: [], reserva: [], esperas: [] };
  const estado = {
    politica: politicaCom(LIGADA),
    canais: CANAIS,
    sondas: [
      sonda(DOM_A, LOJA_A, CHAVE_A),
      sonda(DOM_B, LOJA_B, CHAVE_B),
      {
        dominio: "manut.vercel.app",
        ficha: { status: 503, caderneta: "miss", refs: [] },
      },
    ],
    // O "/" do candidato: endereço que não é loja = `miss`, e o porteiro diz
    // se havia reserva para tentar.
    reservaNoCandidato: "ligada",
    // O que a store guarda hoje (null = a chave não existe).
    naStore: null,
    falhaNaLeitura: null,
    falhaNaGravacao: null,
    ...ajuste,
  };
  const reservaApi = {
    get: async (caminho) => {
      chamadas.reserva.push(["GET", caminho]);
      ordem.push("GET");
      if (estado.falhaNaLeitura) throw new Error(estado.falhaNaLeitura);
      return estado.naStore === null
        ? null
        : { key: "reserva_v1", value: estado.naStore };
    },
    patch: async (caminho, corpo) => {
      chamadas.reserva.push(["PATCH", caminho]);
      ordem.push("PATCH");
      if (estado.falhaNaGravacao) {
        const e = new Error(estado.falhaNaGravacao.mensagem);
        e.cota = estado.falhaNaGravacao.cota === true;
        throw e;
      }
      estado.naStore = corpo.items[0].value;
      return {};
    },
  };
  const d = {
    politica: estado.politica,
    canais: estado.canais,
    agora: () => AGORA,
    fetchImpl: async (url) => {
      const u = new URL(url);
      if (u.pathname === "/") {
        const headers = {
          "x-ikcous-porteiro": "sem-loja",
          "x-ikcous-caderneta": "miss",
        };
        if (estado.reservaNoCandidato !== null)
          headers["x-ikcous-reserva"] = estado.reservaNoCandidato;
        return new Response("<html></html>", { status: 503, headers });
      }
      return new Response(versao(), { status: 200 });
    },
    vercelApi: async () => ({
      id: DPL,
      url: "cand-inventado.vercel.app",
      target: "production",
      readyState: "READY",
      projectId: "prj_X",
    }),
    inventariar: async () => ({
      origem: "vercel",
      completo: true,
      motivoParcial: null,
      dominios: estado.sondas.map((s) => s.dominio),
      vercel: { ok: true, producaoOficial: DPL_ANTERIOR },
      sondas: estado.sondas,
    }),
    conferirFrota: async (_p, _sha, inventario) =>
      inventario
        ? {
            ok: false,
            resultados: estado.sondas.map((s) => ({
              dominio: s.dominio,
              classe: "ENDERECO_ANTIGO",
            })),
            relatorio: "(antes)",
          }
        : {
            ok: true,
            resultados: [],
            relatorio: "(relatório da frota)",
            vercel: { ok: true, producaoOficial: DPL },
          },
    promover: async (id) => {
      chamadas.promover.push(id);
      ordem.push("promover");
    },
    reservaApi,
    esperar: async (ms) => {
      chamadas.esperas.push(ms);
      ordem.push(`esperar ${ms}`);
    },
    listarMigrationsNoSha: async () => [],
    listarFuncoesNoSha: async () => [],
    lerArquivoNoSha: (sha, caminho) =>
      sha === SHA && caminho === ARQUIVO_NOTAS
        ? JSON.stringify({
            "1.5.18": {
              titulo: "Atualização do app",
              novidades: [],
              correcoes: ["Correções de estabilidade."],
              melhorias: [],
            },
          })
        : null,
    arvoreIgual: async () => true,
    topoDoRamo: async () => TOPO,
    listarRuns: async () => [],
    logDoRun: async () => "",
    // A tabela do `supabase migration list` (a release não traz migration).
    migrationList: async () =>
      [
        "   Local | Remote           | Time (UTC)            ",
        "  -------|------------------|-----------------------",
        "   ` `   | `20261190000000` | `20261190000000`      ",
      ].join("\n"),
    listarFuncoes: async () => [],
    baixarFuncao: async () => [],
  };
  return { d, chamadas, estado, ordem };
}

const executar = (d, promover) =>
  publicarRelease({ sha: SHA, deploymentId: DPL, promover }, d);

const motivos = (r) => r.bloqueios.map((b) => `${b.alvo}: ${b.motivo}`);
const gravacoes = (chamadas) =>
  chamadas.reserva.filter(([m]) => m === "PATCH").length;

// ------------------------------------------------------------------ controle

Deno.test("controle: a frota de teste está pronta no ensaio (sem bloqueio fora da reserva)", async () => {
  const { d } = montar({ naStore: reservaDaFrota() });
  const r = await executar(d, false);
  assertEquals(r.bloqueios, [], r.relatorio);
  assertEquals(r.codigo, 0);
});

// ------------------------------------------------------------------ desligada

for (const promover of [false, true]) {
  Deno.test(`reserva desligada (globalConfigId null): avisa e não bloqueia — ${promover ? "promove" : "ensaio"}`, async () => {
    const { d, chamadas } = montar({ politica: politicaCom(DESLIGADA) });
    const r = await executar(d, promover);
    assertEquals(r.codigo, 0, r.relatorio);
    assertEquals(r.bloqueios, []);
    assertEquals(chamadas.reserva, [], "nada lido nem gravado na store");
    assertStringIncludes(r.relatorio, "Reserva da caderneta");
    assertStringIncludes(r.relatorio, "não está configurada");
    assertStringIncludes(r.relatorio, "segue sem a reserva");
    assertEquals(chamadas.promover, promover ? [DPL] : []);
  });
}

Deno.test("reserva desligada: o candidato sem x-ikcous-reserva NÃO bloqueia", async () => {
  const { d, chamadas } = montar({
    politica: politicaCom(DESLIGADA),
    reservaNoCandidato: null,
  });
  const r = await executar(d, true);
  assertEquals(r.codigo, 0, r.relatorio);
  assertEquals(chamadas.promover, [DPL]);
});

Deno.test("reserva desligada: o candidato com x-ikcous-reserva: desligada NÃO bloqueia", async () => {
  const { d, chamadas } = montar({
    politica: politicaCom(DESLIGADA),
    reservaNoCandidato: "desligada",
  });
  const r = await executar(d, true);
  assertEquals(r.codigo, 0, r.relatorio);
  assertEquals(chamadas.promover, [DPL]);
});

Deno.test("política sem o bloco reservaDaCaderneta conta como desligada: avisa e segue", async () => {
  const { d, chamadas } = montar({
    politica: politicaCom(undefined),
    reservaNoCandidato: null,
  });
  const r = await executar(d, true);
  assertEquals(r.codigo, 0, r.relatorio);
  assertEquals(chamadas.reserva, []);
  assertEquals(chamadas.promover, [DPL]);
});

Deno.test("reserva com o id da store fora do formato: bloqueia (não é 'desligada')", async () => {
  const { d, chamadas } = montar({
    politica: politicaCom({ globalConfigId: "lixo", chave: "reserva_v1" }),
  });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(chamadas.promover, []);
  assertEquals(chamadas.reserva, []);
  assert(motivos(r).some((m) => m.includes("globalConfigId fora do formato")));
});

// ------------------------------------------------------------------ --promover

Deno.test("lista igual à da store (sha e gerada_em diferentes): nenhuma gravação, promove sem esperar", async () => {
  const { d, chamadas, ordem } = montar({
    naStore: reservaDaFrota({ sha: OUTRO_SHA, geradaEm: AGORA - 86400000 }),
  });
  const r = await executar(d, true);
  assertEquals(r.codigo, 0, r.relatorio);
  assertEquals(gravacoes(chamadas), 0);
  assertEquals(chamadas.esperas, []);
  assertEquals(ordem, ["GET", "promover"]);
  assertStringIncludes(r.relatorio, "nada gravado");
});

Deno.test("lista diferente: UMA gravação, a espera da propagação e só então o promote", async () => {
  const atual = reservaDaFrota();
  delete atual.hosts[DOM_B];
  const { d, chamadas, ordem, estado } = montar({ naStore: atual });
  const r = await executar(d, true);
  assertEquals(r.codigo, 0, r.relatorio);
  assertEquals(gravacoes(chamadas), 1);
  assertEquals(ESPERA_DA_RESERVA_MS, 10000);
  assertEquals(ordem, [
    "GET",
    "PATCH",
    "GET",
    `esperar ${ESPERA_DA_RESERVA_MS}`,
    "promover",
  ]);
  assertEquals(Object.keys(estado.naStore.hosts), [DOM_A, DOM_B]);
  assertEquals(estado.naStore.sha, SHA);
  assertStringIncludes(r.relatorio, `- entra: ${DOM_B}`);
  assertStringIncludes(r.relatorio, "Gravada e conferida");
});

Deno.test("store sem reserva nenhuma: grava antes do promote", async () => {
  const { d, chamadas, ordem } = montar({ naStore: null });
  const r = await executar(d, true);
  assertEquals(r.codigo, 0, r.relatorio);
  assertEquals(gravacoes(chamadas), 1);
  assertEquals(ordem.at(-1), "promover");
  assert(ordem.indexOf("PATCH") < ordem.indexOf("promover"));
});

Deno.test("gravação falhou: NÃO promove e diz por quê", async () => {
  const { d, chamadas } = montar({
    naStore: null,
    falhaNaGravacao: { mensagem: "vercel api falhou: erro inventado" },
  });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(chamadas.promover, []);
  assertEquals(chamadas.esperas, []);
  const texto = motivos(r).join("\n");
  assertStringIncludes(texto, "gravação recusada");
  assertStringIncludes(texto, "erro inventado");
  assertStringIncludes(r.relatorio, "o front NÃO foi promovido");
});

Deno.test("cota de gravações: NÃO promove, com a mensagem própria da cota", async () => {
  const { d, chamadas } = montar({
    naStore: null,
    falhaNaGravacao: {
      mensagem: "vercel api falhou: 402 payment required",
      cota: true,
    },
  });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(chamadas.promover, []);
  const cota = r.bloqueios.filter((b) => b.alvo.includes("cota"));
  assertEquals(cota.length, 1, motivos(r).join("\n"));
  assertStringIncludes(cota[0].motivo, "limite de gravações");
  assertStringIncludes(cota[0].motivo, "100 gravações por mês");
  // A mensagem da cota não é a da falha comum.
  assert(!cota[0].motivo.includes("gravação recusada"));
});

Deno.test("falha comum NÃO sai com a mensagem da cota", async () => {
  const { d } = montar({
    naStore: null,
    falhaNaGravacao: { mensagem: "vercel api falhou: erro inventado" },
  });
  const r = await executar(d, true);
  assert(!r.bloqueios.some((b) => b.alvo.includes("cota")));
  assert(!motivos(r).join("\n").includes("limite de gravações"));
});

Deno.test("reserva atual não lida: NÃO promove", async () => {
  const { d, chamadas } = montar({ falhaNaLeitura: "sem login inventado" });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(chamadas.promover, []);
  assertEquals(gravacoes(chamadas), 0);
  assertStringIncludes(motivos(r).join("\n"), "sem login inventado");
});

// Ficha sem `estavel` passa no inventário do portão (refDaLojaSondada só
// recusa `estavel: false`), mas a reserva não sabe se ela é estável.
const COM_INDETERMINADO = () => ({
  naStore: null,
  sondas: [
    sonda(DOM_A, LOJA_A, CHAVE_A),
    sonda(DOM_B, LOJA_B, CHAVE_B),
    sonda("loja-a-outro.vercel.app", LOJA_A, CHAVE_A, { estavel: undefined }),
  ],
});

Deno.test("endereço indeterminado: NÃO promove e nada é gravado", async () => {
  const { d, chamadas } = montar(COM_INDETERMINADO());
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(chamadas.promover, []);
  assertEquals(gravacoes(chamadas), 0);
  const texto = motivos(r).join("\n");
  assertStringIncludes(texto, "loja-a-outro.vercel.app");
  assertStringIncludes(texto, "indeterminado");
});

Deno.test("loja obrigatória adormecida não trava a reserva: grava só as ativas e promove", async () => {
  const { d, chamadas, estado } = montar({
    naStore: null,
    canais: {
      ...CANAIS,
      canais: { ...CANAIS.canais, [LOJA_C]: canal("loja-c") },
    },
    sondas: [
      sonda(DOM_A, LOJA_A, CHAVE_A),
      sonda(DOM_B, LOJA_B, CHAVE_B),
      sondaAdormecida(DOM_C, LOJA_C),
    ],
  });
  const r = await executar(d, true);
  assertEquals(r.codigo, 0, r.relatorio);
  assertEquals(chamadas.promover, [DPL]);
  assertEquals(Object.keys(estado.naStore.hosts), [DOM_A, DOM_B]);
});

Deno.test("loja obrigatória ATIVA fora da reserva (sem chave pública): recusa e não promove", async () => {
  const { d, chamadas } = montar({
    naStore: null,
    sondas: [sonda(DOM_A, LOJA_A, CHAVE_A), sonda(DOM_B, LOJA_B, null)],
  });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(chamadas.promover, []);
  assertEquals(gravacoes(chamadas), 0);
  assertStringIncludes(motivos(r).join("\n"), DOM_B);
});

// ------------------------------------------------------------------ ensaio

Deno.test("ensaio: só lê a store (GET) e mostra a diferença; nunca grava", async () => {
  const atual = reservaDaFrota();
  delete atual.hosts[DOM_B];
  const { d, chamadas, estado } = montar({ naStore: atual });
  const r = await executar(d, false);
  assertEquals(r.codigo, 0, r.relatorio);
  assertEquals(
    chamadas.reserva.map(([m]) => m),
    ["GET"],
  );
  assertEquals(chamadas.esperas, []);
  assertEquals(Object.keys(estado.naStore.hosts), [DOM_A]);
  assertStringIncludes(r.relatorio, `- entra: ${DOM_B}`);
  assertStringIncludes(r.relatorio, "--promover gravaria");
});

Deno.test("ensaio com a lista igual: diz que o --promover não gravaria nada", async () => {
  const { d, chamadas } = montar({
    naStore: reservaDaFrota({ sha: OUTRO_SHA }),
  });
  const r = await executar(d, false);
  assertEquals(r.codigo, 0, r.relatorio);
  assertEquals(gravacoes(chamadas), 0);
  assertStringIncludes(r.relatorio, "não gravaria nada");
});

Deno.test("ensaio com endereço indeterminado: bloqueia (o --promover recusaria) e não grava", async () => {
  const { d, chamadas } = montar(COM_INDETERMINADO());
  const r = await executar(d, false);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(gravacoes(chamadas), 0);
  assertStringIncludes(motivos(r).join("\n"), "loja-a-outro.vercel.app");
});

Deno.test("ensaio com a reserva atual ilegível: bloqueia (o --promover não gravaria)", async () => {
  const { d } = montar({ falhaNaLeitura: "sem login inventado" });
  const r = await executar(d, false);
  assertEquals(r.codigo, 1, r.relatorio);
  assertStringIncludes(motivos(r).join("\n"), "sem login inventado");
});

// ------------------------------------------------------------------ candidato

for (const [nome, valor] of [
  ["sem x-ikcous-reserva", null],
  ["com x-ikcous-reserva: desligada", "desligada"],
  ["com x-ikcous-reserva de valor estranho", "LIGADA"],
]) {
  Deno.test(`reserva configurada e candidato ${nome}: bloqueia antes de tocar na store`, async () => {
    const { d, chamadas } = montar({ reservaNoCandidato: valor });
    const r = await executar(d, true);
    assertEquals(r.codigo, 1, r.relatorio);
    assertEquals(chamadas.promover, []);
    assertEquals(chamadas.reserva, []);
    const doCandidato = r.bloqueios.filter((b) =>
      b.alvo.includes(`deployment ${DPL}`),
    );
    assertEquals(doCandidato.length, 1, motivos(r).join("\n"));
    assertStringIncludes(doCandidato[0].motivo, "esperado ligada");
    assertStringIncludes(doCandidato[0].motivo, "GLOBAL_CONFIG");
  });
}
