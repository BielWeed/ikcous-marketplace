// @ts-nocheck
/* eslint-disable security/detect-object-injection, security/detect-non-literal-require -- teste: as chaves vêm do cadastro (real ou sintético) e de constantes deste arquivo; os require são de arquivos fixos do repositório. */
/**
 * NENHUMA EXPRESSÃO DE WORKFLOW CRESCE COM LOJA NOVA (C2 da frota de 300, 26/11/2026).
 *
 * scripts/frota/lojas-nos-workflows.cjs gera blocos dos workflows a partir do
 * cadastro. Um bloco que põe TODAS as lojas numa expressão `${{ … }}` só cresce
 * a cada loja, e o GitHub recusa o workflow inteiro quando uma expressão passa
 * do teto ("Exceeded max expression length 21000" — o número não está na
 * documentação oficial de expressões; ver rhysd/actionlint#356). Quebra no dia
 * em que a loja N entra, em todas as lojas ao mesmo tempo.
 *
 * Este teste regera TODOS os workflows com um cadastro sintético de 300 lojas
 * no pior caso de tamanho (tests/fixtures/frota-cadastro-sintetico.ts) e mede:
 *  1. toda expressão `${{ … }}` ≤ 8.000 caracteres (folga de ~2,6× sobre o
 *     teto observado), salvo a exceção NOMEADA abaixo;
 *  2. a exceção, com o cadastro REAL de hoje, ≤ 8.000 (o alarme de verdade);
 *  3. cada workflow regerado ≤ 400 KB (o teto do GitHub é 500 KB por arquivo);
 *  4. cada linha por loja do bloco LOJAS-SEGREDOS ≤ 300 caracteres (o bloco
 *     cresce em LINHAS, uma por loja, nunca numa linha só).
 */
import { createRequire } from "node:module";
import { fromFileUrl, join } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  cadastroSintetico,
  cadastroSinteticoNaOrg,
} from "./fixtures/frota-cadastro-sintetico.ts";

const require = createRequire(import.meta.url);
const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const DIR_WF = join(RAIZ, ".github/workflows");
const lojasMod = require(join(RAIZ, "scripts/frota/lojas.cjs"));
const gerador = require(join(RAIZ, "scripts/frota/lojas-nos-workflows.cjs"));

const LOJAS_NA_META = 300;
const TETO_EXPRESSAO = 8_000;
const TETO_WORKFLOW_BYTES = 400 * 1024;
const TETO_LINHA_POR_LOJA = 300;

/**
 * Blocos cuja expressão AINDA cresce com loja, cada um com o seu prazo.
 * LOJAS-SEGREDO-UNICO (a cadeia de token de publicar-functions.yml): sai com a
 * saída D (segredo por loja fora do YAML); se a D não estiver no ar na 80ª
 * loja, T3 do plano PLANO-FROTA-300-C2-C4-C5-26-11 (uma linha por loja). Pela
 * conta do plano, a cadeia quebra entre ~198 e ~270 lojas.
 */
const EXPRESSOES_QUE_CRESCEM = ["LOJAS-SEGREDO-UNICO"];

const CADASTRO_REAL = lojasMod.carregarLojas();
const CADASTRO_300 = lojasMod.validarCadastro(cadastroSintetico(LOJAS_NA_META));
// O modelo da org central (01/12/2026): as 300 no MESMO segredo, o da org.
const SEGREDO_DA_ORG = require(
  join(RAIZ, "scripts/frota/org-central.cjs"),
).carregarOrgCentral().segredoDoGitHub;
const CADASTRO_300_NA_ORG = lojasMod.validarCadastro(
  cadastroSinteticoNaOrg(LOJAS_NA_META, SEGREDO_DA_ORG),
);
const CADASTRO_2_NA_ORG = lojasMod.validarCadastro(
  cadastroSinteticoNaOrg(2, SEGREDO_DA_ORG),
);

function workflows(): string[] {
  return [...Deno.readDirSync(DIR_WF)]
    .filter((e) => e.isFile && e.name.endsWith(".yml"))
    .map((e) => e.name)
    .sort();
}
const textoDe = (nome: string) => Deno.readTextFileSync(join(DIR_WF, nome));

/** Faixas [início, fim) de cada bloco gerado LOJAS-*, pelo nome do bloco. */
function blocos(texto: string) {
  const faixas = [];
  const re = /^[ \t]*# (LOJAS-[A-Z-]+)-INICIO\b.*$/gm;
  for (const m of texto.matchAll(re)) {
    const fim = texto.indexOf(`# ${m[1]}-FIM`, m.index);
    if (fim < 0) throw new Error(`falta o marcador ${m[1]}-FIM`);
    faixas.push({ nome: m[1], ini: m.index, fim });
  }
  return faixas;
}

/**
 * Cada `${{ … }}` do texto, com a posição. Respeita string entre aspas simples
 * (com `''` escapado, como no GitHub): um `}}` dentro de string não fecha.
 */
function expressoes(texto: string) {
  const achadas = [];
  let i = texto.indexOf("${{");
  while (i >= 0) {
    let j = i + 3;
    let emString = false;
    for (; j < texto.length; j++) {
      const c = texto[j];
      if (c === "'") {
        if (emString && texto[j + 1] === "'") j++;
        else emString = !emString;
      } else if (!emString && c === "}" && texto[j + 1] === "}") break;
    }
    if (j >= texto.length)
      throw new Error(`expressão sem fechamento na posição ${i}`);
    achadas.push({ ini: i, texto: texto.slice(i, j + 2) });
    i = texto.indexOf("${{", j + 2);
  }
  return achadas;
}

/** As expressões do workflow regerado com `cadastro`, com o bloco de cada uma. */
function expressoesRegeradas(nome: string, cadastro) {
  const texto = gerador.sincronizar(textoDe(nome), cadastro);
  const faixas = blocos(texto);
  return {
    texto,
    expressoes: expressoes(texto).map((e) => ({
      ...e,
      bloco: faixas.find((f) => e.ini > f.ini && e.ini < f.fim)?.nome ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Controles: o cadastro sintético é o pior caso e o gerador de fato cresce com ele
// ---------------------------------------------------------------------------
Deno.test("controle: o cadastro sintético tem 300 lojas válidas no tamanho máximo do formato, e o gerador põe todas nos workflows", () => {
  const lojas = Object.values(CADASTRO_300.lojas);
  assertEquals(lojas.length, LOJAS_NA_META);
  for (const l of lojas) {
    assertEquals(l.projeto.length, 40, "nome no máximo de RE_PROJETO");
    assert(lojasMod.RE_PROJETO.test(l.projeto));
    assertEquals(l.segredoDoToken.length, "SUPABASE_ACCESS_TOKEN_".length + 24);
  }
  // nenhum ref real entra na fixture
  const refsReais = new Set(
    Object.values(CADASTRO_REAL.lojas).map((l) => l.ref),
  );
  assert(lojas.every((l) => !refsReais.has(l.ref)));
  // o menu de pelo menos um workflow ganhou as 300 (o gerador rodou de fato)
  const algum = workflows().some((n) => {
    const t = gerador.sincronizar(textoDe(n), CADASTRO_300);
    return lojas.every((l) => t.includes(`- ${l.projeto}`));
  });
  assert(algum, "nenhum workflow recebeu as 300 lojas");
});

Deno.test("controle: cada exceção nomeada existe num workflow (a lista não envelhece em silêncio)", () => {
  for (const nome of EXPRESSOES_QUE_CRESCEM) {
    const usada = workflows().some((n) =>
      expressoesRegeradas(n, CADASTRO_REAL).expressoes.some(
        (e) => e.bloco === nome,
      ),
    );
    assert(
      usada,
      `${nome} está em EXPRESSOES_QUE_CRESCEM mas nenhum workflow o gera`,
    );
  }
});

// ---------------------------------------------------------------------------
// 1. Com 300 lojas, nenhuma expressão (fora das exceções) passa de 8.000
// ---------------------------------------------------------------------------
Deno.test("com 300 lojas, nenhuma expressão de workflow passa de 8.000 caracteres (fora as exceções nomeadas)", () => {
  const estouros = [];
  for (const n of workflows()) {
    for (const e of expressoesRegeradas(n, CADASTRO_300).expressoes) {
      if (EXPRESSOES_QUE_CRESCEM.includes(e.bloco)) continue;
      if (e.texto.length > TETO_EXPRESSAO)
        estouros.push(
          `${n} (bloco ${e.bloco ?? "fora de bloco"}): ${e.texto.length} caracteres — ${e.texto.slice(0, 80)}…`,
        );
    }
  }
  assertEquals(
    estouros,
    [],
    `expressões que crescem com loja:\n${estouros.join("\n")}`,
  );
});

// ---------------------------------------------------------------------------
// 2. A exceção, com o cadastro de hoje, ainda cabe (o alarme real)
// ---------------------------------------------------------------------------
Deno.test("as exceções nomeadas, com o cadastro REAL de hoje, ainda cabem em 8.000 caracteres", () => {
  for (const n of workflows()) {
    for (const e of expressoesRegeradas(n, CADASTRO_REAL).expressoes) {
      if (!EXPRESSOES_QUE_CRESCEM.includes(e.bloco)) continue;
      assert(
        e.texto.length <= TETO_EXPRESSAO,
        `${n}: ${e.bloco} já tem ${e.texto.length} caracteres com o cadastro real — hora da T3 (ou da saída D)`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 3 e 4. O arquivo e a linha por loja
// ---------------------------------------------------------------------------
Deno.test("com 300 lojas, cada workflow regerado fica em até 400 KB (o teto do GitHub é 500 KB)", () => {
  for (const n of workflows()) {
    const { texto } = expressoesRegeradas(n, CADASTRO_300);
    const bytes = new TextEncoder().encode(texto).length;
    assert(bytes <= TETO_WORKFLOW_BYTES, `${n}: ${bytes} bytes com 300 lojas`);
  }
});

Deno.test("com 300 lojas, cada linha por loja do bloco LOJAS-SEGREDOS tem até 300 caracteres", () => {
  let vistas = 0;
  for (const n of workflows()) {
    const texto = gerador.sincronizar(textoDe(n), CADASTRO_300);
    for (const f of blocos(texto).filter((b) => b.nome === "LOJAS-SEGREDOS")) {
      const linhas = texto.slice(f.ini, f.fim).split(/\r?\n/).slice(1, -1);
      assertEquals(linhas.length, LOJAS_NA_META, `${n}: uma linha por loja`);
      for (const l of linhas) {
        vistas++;
        assert(
          l.length <= TETO_LINHA_POR_LOJA,
          `${n}: linha de ${l.length}: ${l}`,
        );
      }
    }
  }
  assert(vistas > 0, "nenhum bloco LOJAS-SEGREDOS encontrado");
});

// ---------------------------------------------------------------------------
// 5. A org central: 300 lojas no MESMO segredo (o da org) e nenhuma expressão
//    cresce — nem a cadeia única, que aqui não precisa da exceção
// ---------------------------------------------------------------------------
Deno.test("org central: com 300 lojas no segredo da org, NENHUMA expressão passa de 8.000 caracteres (sem exceção nenhuma)", () => {
  assertEquals(Object.keys(CADASTRO_300_NA_ORG.lojas).length, LOJAS_NA_META);
  assert(
    Object.values(CADASTRO_300_NA_ORG.lojas).every(
      (l) => l.segredoDoToken === SEGREDO_DA_ORG,
    ),
  );
  const estouros = [];
  let vistas = 0;
  for (const n of workflows()) {
    for (const e of expressoesRegeradas(n, CADASTRO_300_NA_ORG).expressoes) {
      if (e.bloco === "LOJAS-SEGREDOS" || e.bloco === "LOJAS-SEGREDO-UNICO")
        vistas++;
      if (e.texto.length > TETO_EXPRESSAO)
        estouros.push(
          `${n} (bloco ${e.bloco ?? "fora de bloco"}): ${e.texto.length}`,
        );
    }
  }
  assertEquals(estouros, [], estouros.join("\n"));
  assert(vistas > 0, "nenhuma expressão de segredo regerada");
});

Deno.test("org central: as expressões de segredo são IDÊNTICAS com 2 e com 300 lojas na org (tamanho fixo), e o bloco LOJAS-SEGREDOS tem UMA linha", () => {
  const deSegredo = (cad) =>
    workflows().flatMap((n) =>
      expressoesRegeradas(n, cad)
        .expressoes.filter(
          (e) =>
            e.bloco === "LOJAS-SEGREDOS" || e.bloco === "LOJAS-SEGREDO-UNICO",
        )
        .map((e) => `${n}: ${e.texto}`),
    );
  const com2 = deSegredo(CADASTRO_2_NA_ORG);
  assert(com2.length > 0);
  assertEquals(deSegredo(CADASTRO_300_NA_ORG), com2);
  for (const e of com2) {
    assert(!e.includes("inputs.projeto"), `guarda por loja: ${e}`);
    assert(e.includes(`secrets.${SEGREDO_DA_ORG}`), e);
  }
  let blocos = 0;
  for (const n of workflows()) {
    const texto = gerador.sincronizar(textoDe(n), CADASTRO_300_NA_ORG);
    for (const f of blocosDeSegredos(texto)) {
      blocos++;
      const linhas = texto.slice(f.ini, f.fim).split(/\r?\n/).slice(1, -1);
      assertEquals(linhas.length, 1, `${n}: uma linha só para a org`);
      assert(linhas[0].length <= TETO_LINHA_POR_LOJA, linhas[0]);
    }
  }
  assert(blocos > 0, "nenhum bloco LOJAS-SEGREDOS encontrado");
});

/** Só os blocos LOJAS-SEGREDOS do texto. */
const blocosDeSegredos = (texto: string) =>
  blocos(texto).filter((b) => b.nome === "LOJAS-SEGREDOS");
