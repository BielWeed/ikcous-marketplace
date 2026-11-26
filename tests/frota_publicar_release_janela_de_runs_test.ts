// @ts-nocheck
/* eslint-disable security/detect-object-injection -- dublês de teste: as chaves vêm de constantes e mapas fechados do próprio arquivo, nunca de entrada externa. */
/**
 * scripts/frota/publicar-release.mjs — a leitura de runs do GitHub EM FAIXAS.
 *
 * O GitHub entrega no máximo 1000 runs por busca. Com ~60-70 lojas × 8 lotes,
 * a lista de 1000 mais novos deixa de cobrir a evidência (plano L9, item 2,
 * 26/11/2026), e o portão falhava dos DOIS jeitos:
 *  - FECHADO por engano: a prova de banco antiga sai da lista ("sem run");
 *  - ABERTO: um apply ainda em execução, criado antes dos 1000 mais novos,
 *    some da lista e a evidência que ele venceu passa como POSITIVA.
 *
 * O conserto lê por faixas de `created` (dividindo ao meio sempre que uma
 * busca volta com 1000), lê à parte os runs que não terminaram, confere a
 * leitura por faixas contra a lista sem filtro e, quando a faixa não divide
 * mais (ou o filtro não foi respeitado), devolve JANELA_ESTOUROU: o lote
 * PARA, sem comando. Com menos de 1000 runs nada muda: uma busca só, a mesma
 * de antes.
 *
 * Dublê do `gh run list` que obedece `--created`, `--status` e `--limit` com
 * o teto de 1000 do GitHub. Dados inventados: nenhuma rede, nenhum token.
 */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  decidirLote,
  dependenciasReais,
  evidenciaDaProva,
} from "../scripts/frota/publicar-release.mjs";

const SHA = "1".repeat(40);
const OUTRO = "3".repeat(40);
const TOPO = "4".repeat(40);
const REF_ALVO = "b".repeat(20);
const LOJA_ALVO = "loja-alvo";
const AGORA = Date.parse("2026-11-26T12:00:00Z");
const PROVA = "9a-fixture-aplicado";
const CONFERIR = "conferir-banco-da-loja.yml";
const APLICAR = "aplicar-migrations.yml";
const TETO_DO_GITHUB = 1000;
const DIA = 24 * 3600 * 1000;
const RE_FAIXA =
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00\.\.\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00$/;

const valorDe = (args, flag) => {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
};
const segundo = (iso) => Math.floor(Date.parse(iso) / 1000) * 1000;

/**
 * Dublê do GitHub: devolve do mais novo ao mais antigo, aplica `--created`
 * (faixa inclusiva, precisão de segundo, no formato da busca do GitHub) e
 * `--status`, e nunca mais de 1000 por busca. `ignoraCreated` simula um
 * filtro que o GitHub não aplicou; `createdVazio`, um filtro mal lido que
 * devolve nada.
 */
function githubComFiltros(
  runsPorWorkflow,
  { ignoraCreated = false, createdVazio = false } = {},
) {
  const chamadas = [];
  const rodarGh = async (args) => {
    chamadas.push(args);
    assertEquals(args.slice(0, 2), ["run", "list"]);
    const workflow = valorDe(args, "--workflow");
    const limite = Number(valorDe(args, "--limit"));
    const created = valorDe(args, "--created");
    const status = valorDe(args, "--status");
    let runs = [...(runsPorWorkflow[workflow] ?? [])].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
    if (created !== undefined) {
      assert(RE_FAIXA.test(created), `faixa fora do formato: ${created}`);
      const [de, ate] = created.split("..").map((s) => Date.parse(s));
      if (createdVazio) runs = [];
      else if (!ignoraCreated)
        runs = runs.filter(
          (r) => segundo(r.createdAt) >= de && segundo(r.createdAt) <= ate,
        );
    }
    if (status !== undefined) runs = runs.filter((r) => r.status === status);
    return JSON.stringify(runs.slice(0, Math.min(limite, TETO_DO_GITHUB)));
  };
  return { chamadas, rodarGh };
}

const comFiltro = (chamadas, flag) =>
  chamadas.filter((args) => args.includes(flag));
const doWorkflow = (chamadas, workflow) =>
  chamadas.filter((args) => valorDe(args, "--workflow") === workflow);

/** No Windows o resolverCliVercel só confere se `vercel.cmd` e o vc.js EXISTEM
 * no PATH (nunca os executa): arquivos vazios numa pasta temporária bastam. */
async function comDependenciasReais(corpo, opcoes) {
  if (Deno.build.os !== "windows")
    return await corpo(dependenciasReais(opcoes));
  const dir = Deno.makeTempDirSync();
  Deno.mkdirSync(`${dir}/node_modules/vercel/dist`, { recursive: true });
  Deno.writeTextFileSync(`${dir}/vercel.cmd`, "");
  Deno.writeTextFileSync(`${dir}/node_modules/vercel/dist/vc.js`, "");
  const antes = Deno.env.get("PATH") ?? "";
  Deno.env.set("PATH", `${dir};${antes}`);
  try {
    return await corpo(dependenciasReais(opcoes));
  } finally {
    Deno.env.set("PATH", antes);
    Deno.removeSync(dir, { recursive: true });
  }
}

/** Um run de conferência de outra loja (não é a prova procurada). */
const conferenciaDeOutra = (i, createdAt) => ({
  databaseId: 100_000 + i,
  displayTitle: `conferir 1a-fixture-outra em loja-${String(i % 70).padStart(2, "0")}`,
  headSha: OUTRO,
  createdAt: new Date(createdAt).toISOString(),
  updatedAt: new Date(createdAt + 30_000).toISOString(),
  conclusion: "success",
  status: "completed",
});

/** A prova procurada, verde, criada em `createdAt`. */
const provaDoAlvo = (databaseId, createdAt) => ({
  databaseId,
  displayTitle: `conferir ${PROVA} em ${LOJA_ALVO}`,
  headSha: OUTRO,
  createdAt: new Date(createdAt).toISOString(),
  updatedAt: new Date(createdAt + 30_000).toISOString(),
  conclusion: "success",
  status: "completed",
});

/** Um apply terminado em OUTRA loja (não toca o banco do alvo). */
const applyDeOutra = (i, createdAt) => ({
  databaseId: 500_000 + i,
  displayTitle: `aplicar em loja-${String(i % 70).padStart(2, "0")}: 20261190000000_fixture.sql`,
  headSha: OUTRO,
  createdAt: new Date(createdAt).toISOString(),
  updatedAt: new Date(createdAt + 60_000).toISOString(),
  conclusion: "success",
  status: "completed",
});

function provar(reais, { loja = LOJA_ALVO, ref = REF_ALVO } = {}) {
  return evidenciaDaProva({
    consulta: PROVA,
    projeto: loja,
    projetosNoMesmoBanco: [],
    ref,
    sha: SHA,
    topo: TOPO,
    validadeHoras: 6,
    agora: AGORA,
    deps: {
      listarRuns: reais.listarRuns,
      arvoreIgual: async () => true,
      logDoRun: async () =>
        `VEREDITO-CONSULTA consulta=${PROVA} ref=${ref} sha=${OUTRO} linhas=5 ok_false=0 ok_nao_booleano=0 rol=ok\n`,
    },
  });
}

// ====================================================================
// 1) 2500 runs de conferência: a prova antiga é achada dividindo a faixa
// ====================================================================

Deno.test("janela: 2500 conferências nas últimas 5 h — a leitura divide a faixa e ACHA a prova da posição 2400 (antes: 'sem run')", async () => {
  const conferir = [];
  for (let i = 0; i < 2500; i++) {
    const quando = AGORA - 60_000 - i * 7_000; // 2500 × 7 s ≈ 4,9 h
    conferir.push(
      i === 2400 ? provaDoAlvo(42, quando) : conferenciaDeOutra(i, quando),
    );
  }
  const gh = githubComFiltros({ [CONFERIR]: conferir, [APLICAR]: [] });
  await comDependenciasReais(
    async (reais) => {
      const r = await provar(reais);
      assertEquals(r.estado, "POSITIVA", r.motivo);
      assertEquals(r.run.databaseId, 42);
      // outra loja pedindo a mesma janela não lê de novo (cache por janela)
      await provar(reais, { loja: "loja-07", ref: "c".repeat(20) });
    },
    { rodarGh: gh.rodarGh },
  );
  const doConferir = doWorkflow(gh.chamadas, CONFERIR);
  assert(
    comFiltro(doConferir, "--created").length >= 3,
    "2500 runs pedem pelo menos 3 buscas por faixa",
  );
  // sem nenhum apply, a lista de applies é UMA busca (e a segunda loja usa o cache)
  assertEquals(doWorkflow(gh.chamadas, APLICAR).length, 1);
  const repetidas = new Set(doConferir.map((a) => a.join(" "))).size;
  assertEquals(repetidas, doConferir.length, "nenhuma busca repetida");
});

// ====================================================================
// 2) apply em andamento fora dos 1000 mais novos É contado
// ====================================================================

function cenarioDoApplyAntigo(applyDoAlvo, quantosDeOutras) {
  const conferir = [provaDoAlvo(42, AGORA - 3_600_000)];
  const aplicar = [];
  for (let i = 0; i < quantosDeOutras; i++) {
    aplicar.push(applyDeOutra(i, AGORA - 2 * 3_600_000 - i * 60_000));
  }
  aplicar.push(applyDoAlvo);
  return { [CONFERIR]: conferir, [APLICAR]: aplicar };
}

const applyDoAlvo = (status, createdAt) => ({
  databaseId: 777,
  displayTitle: `aplicar em ${LOJA_ALVO}: 20261199000000_fixture.sql`,
  headSha: OUTRO,
  createdAt: new Date(createdAt).toISOString(),
  updatedAt: new Date(createdAt + 60_000).toISOString(),
  conclusion: status === "completed" ? "success" : null,
  status,
});

Deno.test("janela: apply EM ANDAMENTO no banco do alvo, criado há 3 dias e atrás de 2500 applies mais novos, VENCE a evidência (antes: POSITIVA, falha aberta)", async () => {
  const gh = githubComFiltros(
    cenarioDoApplyAntigo(applyDoAlvo("in_progress", AGORA - 3 * DIA), 2500),
  );
  await comDependenciasReais(
    async (reais) => {
      const r = await provar(reais);
      assertEquals(r.ok, false);
      assertEquals(r.estado, "SEM_EVIDENCIA", r.motivo);
      assertStringIncludes(r.motivo, "evidência vencida: apply 777");
    },
    { rodarGh: gh.rodarGh },
  );
});

Deno.test("janela: apply criado há 2 dias, RE-EXECUTADO e terminado DEPOIS da prova, atrás de 2500 applies mais novos, VENCE a evidência (a faixa dos applies volta a vida máxima de um run)", async () => {
  const reexecutado = {
    ...applyDoAlvo("completed", AGORA - 2 * DIA),
    updatedAt: new Date(AGORA - 30 * 60_000).toISOString(), // prova: AGORA − 1 h
  };
  const gh = githubComFiltros(cenarioDoApplyAntigo(reexecutado, 2500));
  await comDependenciasReais(
    async (reais) => {
      const r = await provar(reais);
      assertEquals(r.estado, "SEM_EVIDENCIA", r.motivo);
      assertStringIncludes(r.motivo, "evidência vencida: apply 777");
    },
    { rodarGh: gh.rodarGh },
  );
});

Deno.test("janela: apply na FILA criado há 70 dias (antes da faixa de 65 dias) é lido à parte, pelo estado, e VENCE a evidência", async () => {
  const gh = githubComFiltros(
    cenarioDoApplyAntigo(applyDoAlvo("queued", AGORA - 70 * DIA), 1500),
  );
  await comDependenciasReais(
    async (reais) => {
      const r = await provar(reais);
      assertEquals(r.estado, "SEM_EVIDENCIA", r.motivo);
      assertStringIncludes(r.motivo, "evidência vencida: apply 777");
    },
    { rodarGh: gh.rodarGh },
  );
  const porEstado = comFiltro(doWorkflow(gh.chamadas, APLICAR), "--status");
  assert(
    porEstado.some((a) => valorDe(a, "--status") === "queued") &&
      porEstado.some((a) => valorDe(a, "--status") === "in_progress"),
    "queued e in_progress são lidos à parte",
  );
});

Deno.test("janela (controle): o MESMO apply de 70 dias, já TERMINADO há 70 dias, não vence a evidência", async () => {
  const gh = githubComFiltros(
    cenarioDoApplyAntigo(applyDoAlvo("completed", AGORA - 70 * DIA), 1500),
  );
  await comDependenciasReais(
    async (reais) => {
      const r = await provar(reais);
      assertEquals(r.estado, "POSITIVA", r.motivo);
    },
    { rodarGh: gh.rodarGh },
  );
});

// ====================================================================
// 3) faixa que não divide mais: JANELA_ESTOUROU, nunca aprova
// ====================================================================

function applysNoMesmoSegundo(n) {
  const quando = AGORA - 2 * 3_600_000;
  return Array.from({ length: n }, (_, i) => applyDeOutra(i, quando));
}

Deno.test("janela: 1200 applies criados no MESMO segundo — a faixa não divide mais e a prova volta JANELA_ESTOUROU (antes: POSITIVA)", async () => {
  const gh = githubComFiltros({
    [CONFERIR]: [provaDoAlvo(42, AGORA - 3_600_000)],
    [APLICAR]: applysNoMesmoSegundo(1200),
  });
  await comDependenciasReais(
    async (reais) => {
      const r = await provar(reais);
      assertEquals(r.ok, false);
      assertEquals(r.estado, "JANELA_ESTOUROU", r.motivo);
      assertStringIncludes(r.motivo, "JANELA_ESTOUROU");
      assertStringIncludes(r.motivo, "mesmo segundo");
    },
    { rodarGh: gh.rodarGh },
  );
});

Deno.test("janela: o GitHub ignora o filtro de data — JANELA_ESTOUROU, nunca a lista truncada (antes: POSITIVA)", async () => {
  const runs = cenarioDoApplyAntigo(
    applyDoAlvo("completed", AGORA - 70 * DIA),
    1500,
  );
  const gh = githubComFiltros(runs, { ignoraCreated: true });
  await comDependenciasReais(
    async (reais) => {
      const r = await provar(reais);
      assertEquals(r.estado, "JANELA_ESTOUROU", r.motivo);
      assertStringIncludes(r.motivo, "fora da faixa");
    },
    { rodarGh: gh.rodarGh },
  );
});

Deno.test("janela: o filtro de data devolve VAZIO para runs que existem — a conferência cruzada com a lista sem filtro acusa JANELA_ESTOUROU (antes: POSITIVA)", async () => {
  const runs = cenarioDoApplyAntigo(
    applyDoAlvo("completed", AGORA - 70 * DIA),
    1500,
  );
  const gh = githubComFiltros(runs, { createdVazio: true });
  await comDependenciasReais(
    async (reais) => {
      const r = await provar(reais);
      assertEquals(r.estado, "JANELA_ESTOUROU", r.motivo);
      assertStringIncludes(r.motivo, "lista sem filtro");
    },
    { rodarGh: gh.rodarGh },
  );
});

Deno.test("janela: listarRuns SEM faixa e com 1000+ runs recusa (JANELA_ESTOUROU), nunca devolve a lista cortada", async () => {
  const gh = githubComFiltros({ [APLICAR]: applysNoMesmoSegundo(1200) });
  await comDependenciasReais(
    async (reais) => {
      const erro = await assertRejects(
        () => reais.listarRuns(APLICAR),
        Error,
        "JANELA_ESTOUROU",
      );
      assertEquals(erro.code, "JANELA_ESTOUROU");
    },
    { rodarGh: gh.rodarGh },
  );
});

Deno.test("decidirLote: prova JANELA_ESTOUROU PARA o lote, sem comando de conferência (conferir de novo só engorda a lista)", () => {
  const lote = {
    consulta: PROVA,
    versoes: ["1", "2"],
    backfillLedger: "92-202",
  };
  const estouro = {
    ok: false,
    estado: "JANELA_ESTOUROU",
    motivo: "JANELA_ESTOUROU: 1000+ runs criados no mesmo segundo",
  };
  for (const caso of [
    { faltam: [], exigeProva: true },
    { faltam: ["1", "2"], exigeProva: false },
  ]) {
    const d = decidirLote({ lote, ...caso, prova: estouro });
    assertEquals(d.acao, "PARAR", JSON.stringify(caso));
    assertEquals(d.consultas, undefined);
    assertStringIncludes(d.motivo, "JANELA_ESTOUROU");
  }
  // diagnóstico que estourou também PARA (prova negativa + 8a sem leitura)
  const d = decidirLote({
    lote: { ...lote, ausenciaConfirmadaPor: "8a-fixture" },
    faltam: ["1", "2"],
    exigeProva: false,
    prova: {
      ok: false,
      estado: "NEGATIVA",
      motivo: "x",
      run: { createdAt: "2026-11-26T10:00:00Z" },
    },
    diagnostico: new Map([["8a-fixture", estouro]]),
  });
  assertEquals(d.acao, "PARAR");
  assertStringIncludes(d.motivo, "JANELA_ESTOUROU");
});

// ====================================================================
// 4) menos de 1000 runs: UMA busca, a mesma de antes, sem custo extra
// ====================================================================

Deno.test("janela: 999 conferências e 999 applies — UMA busca por workflow, sem --created nem --status, e a prova da posição 998 é achada", async () => {
  const conferir = [];
  const aplicar = [];
  for (let i = 0; i < 999; i++) {
    const quando = AGORA - 60_000 - i * 7_000;
    conferir.push(
      i === 998 ? provaDoAlvo(42, quando) : conferenciaDeOutra(i, quando),
    );
    aplicar.push(applyDeOutra(i, AGORA - 50 * DIA + i * 60_000));
  }
  const gh = githubComFiltros({ [CONFERIR]: conferir, [APLICAR]: aplicar });
  await comDependenciasReais(
    async (reais) => {
      const r = await provar(reais);
      assertEquals(r.estado, "POSITIVA", r.motivo);
      assertEquals(r.run.databaseId, 42);
    },
    { rodarGh: gh.rodarGh },
  );
  assertEquals(gh.chamadas.length, 2);
  for (const args of gh.chamadas) {
    assertEquals(args.includes("--created"), false);
    assertEquals(args.includes("--status"), false);
    assertEquals(valorDe(args, "--limit"), String(TETO_DO_GITHUB));
  }
});
