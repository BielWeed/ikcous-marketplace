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
 * banco ao mesmo tempo. Isso pede exclusão POR BANCO. O grupo é
 * `banco-da-loja-<nome canônico do banco>`, GERADO de scripts/frota/lojas.json
 * (bloco LOJAS-GRUPO-DO-BANCO, por scripts/frota/lojas-nos-workflows.cjs). Desde
 * o C2 da frota de 300 (26/11/2026) o mapa da expressão guarda SÓ as lojas que
 * dividem banco (`loja` → `ikcous-publicada`, a CAF); as outras usam o próprio
 * nome, e a expressão não cresce com loja nova. `queue: max` continua: FIFO por
 * banco = a ordem dos lotes de cada loja.
 *
 * O QUE ESTES TESTES MEDEM:
 *  1. Todo job de workflow cujo grupo cita `banco-da-loja` usa a linha gerada
 *     (nenhum sobra no grupo único da frota), com `queue: max` e sem cancelar o
 *     que está rodando; e são exatamente o apply e o ledger.
 *  2. A expressão gerada, avaliada para cada loja, cumpre MESMO REF ⇔ MESMA
 *     CHAVE para todo par de lojas — no cadastro real, num sintético de 300
 *     lojas e num sintético com um legado dividindo banco com uma assinante.
 *  3. Loja nova de banco próprio deixa a linha `group:` byte a byte igual.
 *  4. O bloco gerado está em dia com o cadastro.
 */
import { createRequire } from "node:module";
import { parse } from "https://deno.land/std@0.177.0/encoding/yaml.ts";
import { fromFileUrl, join } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  cadastroSintetico,
  nomeSintetico,
  refSintetico,
} from "./fixtures/frota-cadastro-sintetico.ts";

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
  /^banco-da-loja-\$\{\{ fromJSON\('(\{[^']*\})'\)\[inputs\.projeto\] \|\| inputs\.projeto \}\}$/;

/** Avalia o grupo como o GitHub avaliaria para um `inputs.projeto`: índice
 * ausente no objeto dá null, e `null || x` dá x. */
function avaliarGrupo(grupo: string, projeto: string): string {
  const m = RE_GRUPO.exec(grupo);
  if (!m) throw new Error(`grupo fora da forma gerada: ${grupo}`);
  const mapa = JSON.parse(m[1]);
  const v = Object.hasOwn(mapa, projeto) ? mapa[projeto] : null;
  return `banco-da-loja-${v || projeto}`;
}

function workflows() {
  return [...Deno.readDirSync(DIR_WF)]
    .filter((e) => e.isFile && e.name.endsWith(".yml"))
    .map((e) => e.name)
    .sort();
}

const textoDe = (nome: string) => Deno.readTextFileSync(join(DIR_WF, nome));
const grupoDe = (texto: string, job: string) =>
  parse(texto).jobs[job].concurrency.group;

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

/** Para TODO par de lojas do cadastro: mesmo ref ⇔ mesmo grupo avaliado. */
function afirmarUmBancoUmGrupo(grupo: string, cadastro, rotulo: string) {
  const lojas = Object.values(cadastro.lojas) as any[];
  const grupos = lojas.map((l) => avaliarGrupo(grupo, l.projeto));
  for (let i = 0; i < lojas.length; i++)
    for (let j = i + 1; j < lojas.length; j++)
      assertEquals(
        grupos[i] === grupos[j],
        lojas[i].ref === lojas[j].ref,
        `${rotulo}: ${lojas[i].projeto} (${grupos[i]}) × ${lojas[j].projeto} (${grupos[j]})`,
      );
  return grupos;
}

/** O sintético de 300 lojas com um LEGADO extra no banco da assinante nº 7. */
function sinteticoComLegadoDividindo() {
  const bruto = cadastroSintetico(300);
  bruto.lojas["legado-sintetico"] = {
    ref: refSintetico(7),
    classe: "legado",
    apelido: "Legado",
    segredoDoToken: "SUPABASE_ACCESS_TOKEN",
  };
  return lojasMod.validarCadastro(bruto);
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

Deno.test("o grupo do apply e o do ledger são a MESMA expressão (o ledger nunca grava durante um apply no mesmo banco), também com 300 lojas", () => {
  for (const cadastro of [CADASTRO_REAL, sinteticoComLegadoDividindo()]) {
    const grupos = JOBS_DO_BANCO.map(([wf, job]) =>
      grupoDe(gerador.sincronizar(textoDe(wf), cadastro), job),
    );
    assertEquals(grupos[0], grupos[1]);
  }
});

// ---------------------------------------------------------------------------
// 2. Avaliada por loja: um banco, um grupo
// ---------------------------------------------------------------------------
Deno.test("cadastro real: mesmo ref ⇔ mesmo grupo; loja e ikcous-publicada (a CAF) dividem o grupo da assinante; savy e sandbox têm o seu", () => {
  for (const [wf, job] of JOBS_DO_BANCO) {
    const grupo = grupoDe(textoDe(wf), job);
    afirmarUmBancoUmGrupo(grupo, CADASTRO_REAL, `${wf}:${job}`);
    // o nome canônico do banco dividido é o da ASSINANTE
    assertEquals(avaliarGrupo(grupo, "loja"), "banco-da-loja-ikcous-publicada");
    assertEquals(
      avaliarGrupo(grupo, "ikcous-publicada"),
      "banco-da-loja-ikcous-publicada",
    );
    assertEquals(avaliarGrupo(grupo, "savy"), "banco-da-loja-savy");
    assertEquals(avaliarGrupo(grupo, "sandbox"), "banco-da-loja-sandbox");
    // o mapa guarda SÓ a exceção (quem divide banco), nunca um ref
    assertEquals(JSON.parse(RE_GRUPO.exec(grupo)[1]), {
      loja: "ikcous-publicada",
    });
    // Nome fora do cadastro (o menu já o recusa no disparo e o 1º passo de
    // novo): nunca cai no grupo de um banco real nem herda chave do protótipo.
    const reais = new Set(
      Object.values(CADASTRO_REAL.lojas).map((l: any) =>
        avaliarGrupo(grupo, l.projeto),
      ),
    );
    for (const x of [
      "nao-existe",
      "__proto__",
      "constructor",
      "toString",
      "",
    ]) {
      assertEquals(avaliarGrupo(grupo, x), `banco-da-loja-${x}`, x);
      assert(!reais.has(avaliarGrupo(grupo, x)), x);
    }
  }
});

Deno.test("300 lojas sintéticas + um legado dividindo banco com uma delas: mesmo ref ⇔ mesmo grupo, e o legado cai no grupo da assinante", () => {
  const cadastro = sinteticoComLegadoDividindo();
  for (const [wf, job] of JOBS_DO_BANCO) {
    const grupo = grupoDe(gerador.sincronizar(textoDe(wf), cadastro), job);
    const grupos = afirmarUmBancoUmGrupo(grupo, cadastro, `${wf}:${job}`);
    assertEquals(new Set(grupos).size, 300);
    assertEquals(
      avaliarGrupo(grupo, "legado-sintetico"),
      `banco-da-loja-${nomeSintetico(7)}`,
    );
    // e o mapa continua só com a exceção
    assertEquals(JSON.parse(RE_GRUPO.exec(grupo)[1]), {
      "legado-sintetico": nomeSintetico(7),
    });
  }
});

Deno.test("banco dividido SEM assinante: o canônico é o primeiro do cadastro, e os dois caem no mesmo grupo", () => {
  const j = JSON.parse(
    Deno.readTextFileSync(join(RAIZ, "scripts/frota/lojas.json")),
  );
  j.lojas["legado-dois"] = {
    ref: j.lojas.sandbox.ref,
    classe: "legado",
    apelido: "Legado dois",
    segredoDoToken: "SUPABASE_ACCESS_TOKEN",
  };
  const cadastro = lojasMod.validarCadastro(j);
  for (const [wf, job] of JOBS_DO_BANCO) {
    const grupo = grupoDe(gerador.sincronizar(textoDe(wf), cadastro), job);
    afirmarUmBancoUmGrupo(grupo, cadastro, `${wf}:${job}`);
    assertEquals(avaliarGrupo(grupo, "legado-dois"), "banco-da-loja-sandbox");
  }
});

Deno.test("o gerador recusa (falha fechada) um cadastro em que a chave do grupo não é um-para-um com o banco", () => {
  // Só um cadastro montado à mão, fora de validarCadastro, chega aqui: dois
  // registros com o MESMO nome e bancos diferentes.
  const torto = {
    lojas: {
      a: { projeto: "dupla", ref: "a".repeat(20), classe: "assinante" },
      b: { projeto: "dupla", ref: "b".repeat(20), classe: "assinante" },
    },
  };
  assertThrows(
    () => gerador.mapaDoGrupoDoBanco(torto),
    Error,
    "grupo do banco ambíguo",
  );
  assertThrows(
    () => gerador.BLOCOS["LOJAS-GRUPO-DO-BANCO"](torto),
    Error,
    "grupo do banco ambíguo",
  );
});

// ---------------------------------------------------------------------------
// 3. Loja nova de banco próprio não mexe na linha do grupo
// ---------------------------------------------------------------------------
Deno.test("loja nova de banco próprio: a linha group: fica BYTE A BYTE igual, e a loja nova cai no grupo com o nome dela", () => {
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
  const linhaDoGrupo = (t: string) =>
    t.split(/\r?\n/).filter((l) => /^\s*group: banco-da-loja-/.test(l));
  for (const [wf, job] of JOBS_DO_BANCO) {
    const atual = textoDe(wf);
    const comNova = gerador.sincronizar(atual, nova);
    assertEquals(linhaDoGrupo(atual).length, 1, wf);
    assertEquals(linhaDoGrupo(comNova), linhaDoGrupo(atual), wf);
    const grupo = grupoDe(comNova, job);
    assertEquals(
      avaliarGrupo(grupo, "loja-teste-xyz"),
      "banco-da-loja-loja-teste-xyz",
    );
    afirmarUmBancoUmGrupo(grupo, nova, `${wf}:${job}`);
  }
  // e com mais 300 lojas de banco próprio a linha continua a de hoje
  const com300 = gerador.sincronizar(
    textoDe("aplicar-migrations.yml"),
    lojasMod.validarCadastro({
      lojas: { ...j.lojas, ...cadastroSintetico(300).lojas },
    }),
  );
  assertEquals(
    linhaDoGrupo(com300),
    linhaDoGrupo(textoDe("aplicar-migrations.yml")),
  );
});

// ---------------------------------------------------------------------------
// 4. O bloco gerado
// ---------------------------------------------------------------------------
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
