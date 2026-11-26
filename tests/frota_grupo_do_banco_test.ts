// @ts-nocheck
/* eslint-disable security/detect-object-injection, security/detect-non-literal-require -- teste: as chaves vêm do cadastro (real ou de fixture) e de constantes deste arquivo; os require são de arquivos fixos do repositório. */
/**
 * A FILA DO BANCO É POR BANCO, não pela frota (26/11/2026).
 *
 * Antes, o apply (`aplicar-migrations.yml`, job `aplicar`) e a gravação do ledger
 * (`conferir-banco-da-loja.yml`, job `ledger`) dividiam UM grupo de concorrência,
 * `banco-da-loja`, para a frota inteira, com `queue: max`. A documentação do
 * GitHub (workflow-syntax, chave `queue`): até 100 runs ficam `pending` no grupo
 * e, com a fila cheia, os seguintes são CANCELADOS. O ensaio da release imprime
 * um `gh workflow run aplicar-migrations.yml` por loja e por lote: com lojas ×
 * lotes > 101 a fila transborda, e um lote cancelado no meio da fila de uma loja
 * deixa o lote seguinte dela entrar fora de ordem. E tudo andava em fila única
 * (uma loja espera o apply de todas as outras).
 *
 * O que o grupo protege (comentário dos dois workflows): nunca gravar o ledger
 * enquanto uma migration é aplicada NO MESMO BANCO, nem dois applies no mesmo
 * banco ao mesmo tempo. Isso pede exclusão POR BANCO. O grupo agora é
 * `banco-da-loja-<ref>`, GERADO de scripts/frota/lojas.json (bloco
 * LOJAS-GRUPO-DO-BANCO, por scripts/frota/lojas-nos-workflows.cjs): dois nomes de
 * loja que apontam para o MESMO banco (`loja` e `ikcous-publicada` → a CAF) caem
 * no mesmo grupo; bancos diferentes, em grupos diferentes. `queue: max` continua:
 * FIFO por banco = a ordem dos lotes de cada loja.
 *
 * O QUE ESTES TESTES MEDEM:
 *  1. Todo job de workflow cujo grupo cita `banco-da-loja` usa a linha gerada
 *     (nenhum sobra no grupo único da frota), com `queue: max` e sem cancelar o
 *     que está rodando; e são exatamente o apply e o ledger.
 *  2. A expressão gerada, avaliada para cada loja do cadastro, dá
 *     `banco-da-loja-<ref da loja>`: aliases do mesmo banco → mesmo grupo;
 *     bancos diferentes → grupos diferentes; loja nova do cadastro → o grupo do
 *     banco dela, sem nenhuma outra edição.
 *  3. O bloco gerado está em dia com o cadastro.
 */
import { createRequire } from "node:module";
import { parse } from "https://deno.land/std@0.177.0/encoding/yaml.ts";
import { fromFileUrl, join } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const DIR_WF = join(RAIZ, ".github/workflows");
const lojasMod = require(join(RAIZ, "scripts/frota/lojas.cjs"));
const gerador = require(join(RAIZ, "scripts/frota/lojas-nos-workflows.cjs"));
const CADASTRO_REAL = lojasMod.carregarLojas();

/** Os jobs que tocam o banco e por isso dividem a fila POR BANCO. */
const JOBS_DO_BANCO = [
  ["aplicar-migrations.yml", "aplicar"],
  ["conferir-banco-da-loja.yml", "ledger"],
];

/** A forma EXATA da linha gerada (qualquer outra forma não é avaliada aqui). */
const RE_GRUPO =
  /^banco-da-loja-\$\{\{ fromJSON\('(\{[^']*\})'\)\[inputs\.projeto\] \|\| 'sem-cadastro' \}\}$/;

/** Avalia o grupo como o GitHub avaliaria para um `inputs.projeto`. */
function avaliarGrupo(grupo: string, projeto: string): string {
  const m = RE_GRUPO.exec(grupo);
  if (!m) throw new Error(`grupo fora da forma gerada: ${grupo}`);
  const mapa = JSON.parse(m[1]);
  const v = Object.hasOwn(mapa, projeto) ? mapa[projeto] : null;
  return `banco-da-loja-${v || "sem-cadastro"}`;
}

function workflows() {
  return [...Deno.readDirSync(DIR_WF)]
    .filter((e) => e.isFile && e.name.endsWith(".yml"))
    .map((e) => e.name)
    .sort();
}

const textoDe = (nome: string) => Deno.readTextFileSync(join(DIR_WF, nome));

/** `concurrency` de cada job (e do topo) que cita banco-da-loja no grupo. */
function gruposDoBanco(nome: string, doc: any) {
  const achados = [];
  const ver = (onde: string, c: any) => {
    if (c === undefined || c === null) return;
    const grupo = typeof c === "string" ? c : c.group;
    if (String(grupo).includes("banco-da-loja"))
      achados.push({ onde, grupo: String(grupo), c });
  };
  ver(`${nome} (topo)`, doc.concurrency);
  for (const [id, job] of Object.entries(doc.jobs ?? {}) as any)
    ver(`${nome}:${id}`, job.concurrency);
  return achados;
}

// ---------------------------------------------------------------------------
// 1. Todo grupo de banco é o grupo POR BANCO, e só o apply e o ledger o usam
// ---------------------------------------------------------------------------
Deno.test("todo job com grupo de banco usa o grupo POR BANCO gerado (nenhum fica no grupo único da frota), com queue: max e sem cancelar o que roda", () => {
  const achados = workflows().flatMap((n) =>
    gruposDoBanco(n, parse(textoDe(n))),
  );
  assertEquals(
    achados.map((a) => a.onde).sort(),
    JOBS_DO_BANCO.map(([wf, job]) => `${wf}:${job}`).sort(),
  );
  for (const a of achados) {
    assert(
      RE_GRUPO.test(a.grupo),
      `${a.onde}: o grupo não é o gerado por banco: ${a.grupo}`,
    );
    assertEquals(a.c["cancel-in-progress"], false, a.onde);
    assertEquals(a.c.queue, "max", a.onde);
  }
  // O grupo único da frota não sobra em lugar nenhum (nem como texto solto).
  for (const n of workflows())
    assert(
      !/^\s*group:\s*["']?banco-da-loja["']?\s*$/m.test(textoDe(n)),
      `${n}: ainda usa o grupo único banco-da-loja`,
    );
});

Deno.test("o grupo do apply e o do ledger são a MESMA expressão (o ledger nunca grava durante um apply no mesmo banco)", () => {
  const grupos = JOBS_DO_BANCO.map(
    ([wf, job]) => parse(textoDe(wf)).jobs[job].concurrency.group,
  );
  assertEquals(grupos[0], grupos[1]);
});

// ---------------------------------------------------------------------------
// 2. Avaliada por loja: um banco, um grupo
// ---------------------------------------------------------------------------
Deno.test("por loja do cadastro: o grupo é banco-da-loja-<ref>; loja e ikcous-publicada (a CAF) dividem o grupo; savy e sandbox têm o seu", () => {
  for (const [wf, job] of JOBS_DO_BANCO) {
    const grupo = parse(textoDe(wf)).jobs[job].concurrency.group;
    for (const l of Object.values(CADASTRO_REAL.lojas) as any[])
      assertEquals(
        avaliarGrupo(grupo, l.projeto),
        `banco-da-loja-${l.ref}`,
        `${wf}:${job} ${l.projeto}`,
      );
    assertEquals(
      avaliarGrupo(grupo, "loja"),
      avaliarGrupo(grupo, "ikcous-publicada"),
    );
    assertNotEquals(avaliarGrupo(grupo, "savy"), avaliarGrupo(grupo, "loja"));
    assertNotEquals(
      avaliarGrupo(grupo, "sandbox"),
      avaliarGrupo(grupo, "loja"),
    );
    // Nome fora do cadastro (o menu já o recusa no disparo e o 1º passo de
    // novo): nunca cai no grupo de um banco real nem herda chave do protótipo.
    for (const x of ["nao-existe", "__proto__", "constructor", ""])
      assertEquals(avaliarGrupo(grupo, x), "banco-da-loja-sem-cadastro", x);
  }
});

Deno.test("loja nova só por dado: o gerador põe a loja nova no grupo do banco DELA, e um alias do mesmo banco cai no mesmo grupo", () => {
  const j = JSON.parse(
    Deno.readTextFileSync(join(RAIZ, "scripts/frota/lojas.json")),
  );
  j.lojas["loja-teste-xyz"] = {
    ref: "abcdefghijklmnopqrst",
    classe: "assinante",
    apelido: "Loja Teste",
    segredoDoToken: "SUPABASE_ACCESS_TOKEN_LOJA_TESTE_XYZ",
    functionsNomeadas: false,
  };
  const nova = lojasMod.validarCadastro(j);
  for (const [wf, job] of JOBS_DO_BANCO) {
    const comNova = parse(gerador.sincronizar(textoDe(wf), nova));
    const grupo = comNova.jobs[job].concurrency.group;
    assertEquals(
      avaliarGrupo(grupo, "loja-teste-xyz"),
      "banco-da-loja-abcdefghijklmnopqrst",
    );
    assertEquals(
      avaliarGrupo(grupo, "savy"),
      "banco-da-loja-gnjsrucsmjkajijrakzr",
    );
    assertEquals(
      avaliarGrupo(grupo, "loja"),
      avaliarGrupo(grupo, "ikcous-publicada"),
    );
  }
});

Deno.test("o bloco gerado: a linha do grupo mora entre os marcadores LOJAS-GRUPO-DO-BANCO e está em dia com o cadastro", () => {
  for (const [wf] of JOBS_DO_BANCO) {
    const texto = textoDe(wf);
    const linhas = texto.split(/\r?\n/);
    const ini = linhas.findIndex((l) =>
      /^\s*# LOJAS-GRUPO-DO-BANCO-INICIO\b/.test(l),
    );
    const fim = linhas.findIndex(
      (l) => l.trim() === "# LOJAS-GRUPO-DO-BANCO-FIM",
    );
    assert(
      ini >= 0 && fim === ini + 2,
      `${wf}: bloco LOJAS-GRUPO-DO-BANCO ausente ou torto`,
    );
    assert(/^\s*group: banco-da-loja-\$\{\{/.test(linhas[ini + 1]), wf);
    assertEquals(gerador.sincronizar(texto, CADASTRO_REAL), texto, wf);
  }
});
