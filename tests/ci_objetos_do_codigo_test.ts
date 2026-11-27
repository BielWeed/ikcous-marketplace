import { createRequire } from "node:module";
import { parse } from "https://deno.land/std@0.177.0/encoding/yaml.ts";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
// @ts-nocheck
/**
 * A FIAÇÃO de scripts/db-check-objetos-do-codigo.mjs — o que os testes das
 * funções puras não provam sobre `main()` e o `ci.yml`:
 *
 *   (a) o CI usa SUPABASE_ACCESS_TOKEN_IKCOUS e o ref da loja no endpoint somente
 *       leitura; não depende do DATABASE_URL antigo;
 *   (b) no uso LOCAL por DATABASE_URL, o script RODADO DE VERDADE
 *       recusa um projeto errado ANTES de abrir conexão — prova de que
 *       `main()` de fato chama `conferirProjeto()` e sai 1 sem passar por
 *       `lerCatalogo()` — E também DEIXA PASSAR o projeto certo, para que o
 *       guard não vire uma recusa cega (comparar o campo errado, ou inverter
 *       a condição, ainda recusaria sempre e passaria batido se só houvesse
 *       o teste do "errado").
 *
 * (b) usa DATABASE_URL apontando para 127.0.0.1:1 (porta baixa, fechada:
 * medido — connect ECONNREFUSED em ~0.2-0.4s). Se o guard NÃO disparasse
 * antes no caso do projeto errado, a tentativa de conexão real apareceria no
 * log como "ECONNREFUSED"; se o guard recusasse INDEVIDAMENTE no caso do
 * projeto certo, o log NUNCA chegaria a "ECONNREFUSED". As duas combinações
 * ("sai 1, com ::error::, sem ECONNREFUSED" e "sai 1, sem ::error::, com
 * ECONNREFUSED") só acontecem se a decisão de aceitar/recusar for a certa —
 * é isso que os dois casos abaixo verificam, e não a mensagem de erro de
 * conexão do driver `pg`.
 *
 * Prova ao vivo de que os testes locais pegam mutações do guard: comentei o bloco
 * do `if (esperado)` de `main()` — os 18 casos de
 * tests/db_check_objetos_do_codigo_test.ts continuaram 18/18 verdes (eles
 * nunca chamam main()), e o caso (b) do projeto errado falhou (achou
 * "ECONNREFUSED" e não achou "::error::"). Testei também, à parte, trocar
 * `conferirProjeto(ref, esperado)` por `conferirProjeto(host, esperado)` e
 * trocar `if (!conferencia.ok)` por `if (true)` — as duas quebram o caso do
 * projeto CERTO (ele passa a recusar sempre, então nunca chega a
 * "ECONNREFUSED"). Revertidas as três mutações, os dois arquivos voltam a
 * 100%.
 *
 * URLs de teste NUNCA levam senha: uma connection string com usuário:senha@
 * host aciona o secretlint do pre-commit mesmo sendo fictícia — foi por isso
 * que a rodada 1 desta frente teve 3 URLs de teste barradas no commit.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const CI_YML = fromFileUrl(
  new URL("../.github/workflows/ci.yml", import.meta.url),
);
const SCRIPT = fromFileUrl(
  new URL("../scripts/db-check-objetos-do-codigo.mjs", import.meta.url),
);

// O ref real só verifica a fiação do CI; os testes de conexão usam refs fictícios.
const REF_LOJA = "cafkrminfnokvgjqtkle";
// Refs fictícios para o processo real — nunca o da loja.
const REF_FICTICIO_CONECTADO = "aaaaaaaaaaaaaaaaaaaa";
const REF_FICTICIO_ESPERADO = "bbbbbbbbbbbbbbbbbbbb";
// Para o caso "aceita o banco certo": o MESMO ref dos dois lados.
const REF_FICTICIO_IGUAL = "cccccccccccccccccccc";

Deno.test("ci.yml passa token existente e ref da loja ao detector pela API", async () => {
  const yaml = await Deno.readTextFile(CI_YML);
  assertStringIncludes(
    yaml,
    `SUPABASE_ACCESS_TOKEN: \${{ secrets.SUPABASE_ACCESS_TOKEN_IKCOUS }}\n          SUPABASE_PROJECT_REF: ${REF_LOJA}\n        run: node scripts/db-check-objetos-do-codigo.mjs`,
  );
});

/** Roda o detector como processo de verdade (o jeito que o CI roda), com
 * timeout curto: se o guard não disparar, a tentativa de conexão a
 * 127.0.0.1:1 falha rápido (ECONNREFUSED, medido em ~0.2s) — 5s é folga de
 * sobra sem deixar o teste pendurado numa regressão que trave. */
async function rodarDetector(env: Record<string, string>) {
  const comando = new Deno.Command("node", {
    args: [SCRIPT],
    env: { PATH: Deno.env.get("PATH") ?? "", ...env },
    stdout: "piped",
    stderr: "piped",
  });
  const filho = comando.spawn();
  const matadorPorTimeout = setTimeout(() => {
    try {
      filho.kill();
    } catch {
      // já pode ter saído sozinho
    }
  }, 5000);
  const { code, stdout, stderr } = await filho.output();
  clearTimeout(matadorPorTimeout);
  const dec = new TextDecoder();
  return { code, saida: dec.decode(stdout) + dec.decode(stderr) };
}

Deno.test("processo real: projeto errado recusa ANTES de conectar (sem ECONNREFUSED)", async () => {
  const { code, saida } = await rodarDetector({
    DATABASE_URL: `postgresql://postgres.${REF_FICTICIO_CONECTADO}@127.0.0.1:1/p`,
    PROJETO_REF_ESPERADO: REF_FICTICIO_ESPERADO,
  });
  assertEquals(code, 1, saida);
  assertStringIncludes(saida, "::error::");
  assert(
    !saida.includes("ECONNREFUSED"),
    `recusou tarde demais (chegou a tentar conectar): ${saida}`,
  );
});

// O lado que faltava: o guard também tem de DEIXAR PASSAR o banco certo — uma
// implementação que recusasse SEMPRE (ex.: comparar `host` em vez de `ref`, ou
// inverter a condição do `if`) deixaria o caso acima verde e este vermelho de
// forma diferente do esperado, mas passaria batido se só houvesse o teste do
// "errado". Aqui o ref do DATABASE_URL e o PROJETO_REF_ESPERADO são O MESMO
// (fictício) — o guard tem de deixar seguir para lerCatalogo(), que tenta
// conectar de verdade a 127.0.0.1:1 e falha com ECONNREFUSED (medido:
// ~290-415ms, dentro do timeout de 5s). "Sem ::error::, com ECONNREFUSED" só
// é possível se o guard aceitou e a tentativa de conexão aconteceu.
Deno.test("processo real: projeto CERTO passa do guard e tenta conectar (ECONNREFUSED, sem ::error::)", async () => {
  const { code, saida } = await rodarDetector({
    DATABASE_URL: `postgresql://postgres.${REF_FICTICIO_IGUAL}@127.0.0.1:1/p`,
    PROJETO_REF_ESPERADO: REF_FICTICIO_IGUAL,
  });
  assertEquals(code, 1, saida); // ainda sai 1 — mas por ECONNREFUSED, não pelo guard
  assert(
    !saida.includes("::error::"),
    `o guard recusou um projeto que deveria ter sido aceito: ${saida}`,
  );
  assertStringIncludes(saida, "ECONNREFUSED");
});

// ---------------------------------------------------------------------------
// objetos-da-frota.yml (A19 do plano da org central, 27/11/2026): a mesma
// conferência de objetos, para QUALQUER loja assinante, UMA loja por execução,
// escolhida no menu gerado do cadastro. O job `objetos` do ci.yml continua só
// na IKCOUS (a loja de desenvolvimento): 300 lojas a cada PR seria caro e
// instável. Só leitura, só disparo manual, segredo de cada loja só para ela.
// ---------------------------------------------------------------------------
const FROTA_YML = fromFileUrl(
  new URL("../.github/workflows/objetos-da-frota.yml", import.meta.url),
);
const RAIZ_REPO = fromFileUrl(new URL("..", import.meta.url));
const reqFrota = createRequire(import.meta.url);
const lojasFrota = reqFrota(
  fromFileUrl(new URL("../scripts/frota/lojas.cjs", import.meta.url)),
);
const geradorFrota = reqFrota(
  fromFileUrl(
    new URL("../scripts/frota/lojas-nos-workflows.cjs", import.meta.url),
  ),
);
const SEGREDO_ORG = reqFrota(
  fromFileUrl(new URL("../scripts/frota/org-central.cjs", import.meta.url)),
).carregarOrgCentral().segredoDoGitHub;

const textoFrota = () => Deno.readTextFileSync(FROTA_YML);
const docFrota = () => parse(textoFrota());
const gatilhosDe = (doc) => doc.on ?? doc[true];
const passosFrota = () => {
  const jobs = Object.values(docFrota().jobs);
  assertEquals(jobs.length, 1, "um job só: uma loja por execução");
  return jobs[0].steps;
};
const vêSegredo = (p) => /secrets\./.test(JSON.stringify(p));

async function bashFrota(script: string, env: Record<string, string>) {
  const r = await new Deno.Command("bash", {
    args: ["-c", script],
    cwd: RAIZ_REPO,
    env: { PATH: Deno.env.get("PATH") ?? "", ...env },
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const dec = new TextDecoder();
  return {
    codigo: r.code,
    saida: dec.decode(r.stdout) + dec.decode(r.stderr),
  };
}

Deno.test("objetos-da-frota: só leitura (contents: read), só disparo manual, nenhum gatilho com código de PR", () => {
  const doc = docFrota();
  assertEquals(doc.permissions, { contents: "read" });
  assertEquals(Object.keys(gatilhosDe(doc)), ["workflow_dispatch"]);
  for (const job of Object.values(doc.jobs))
    assertEquals(job.permissions, undefined, "permissão própria de job");
  assert(!/:\s*write\b/.test(textoFrota()), "alguma permissão de escrita");
});

Deno.test("objetos-da-frota: UMA loja por execução, pelo menu FECHADO gerado do cadastro (só assinantes), com expected_sha obrigatório", () => {
  const inputs = gatilhosDe(docFrota()).workflow_dispatch.inputs;
  assertEquals(inputs.projeto.type, "choice");
  assertEquals(
    inputs.projeto.options,
    lojasFrota.assinantes(lojasFrota.carregarLojas()).map((l) => l.projeto),
  );
  assert(inputs.projeto.options.includes(inputs.projeto.default));
  for (const p of ["ikcous-publicada", "savy"])
    assert(inputs.projeto.options.includes(p), `${p} fora do menu`);
  assertEquals(inputs.expected_sha.required, true);
  assertStringIncludes(textoFrota(), "# LOJAS-OPCOES-ASSINANTES-INICIO");
});

Deno.test("objetos-da-frota: na ordem, sha antes de tudo, loja no cadastro antes do segredo, e o detector com --loja e o segredo gerado", () => {
  const passos = passosFrota();
  const iSha = passos.findIndex((p) =>
    String(p.name ?? "").startsWith("Confere o alvo"),
  );
  const iLoja = passos.findIndex((p) => p.id === "loja");
  const iDetector = passos.findIndex(vêSegredo);
  assertEquals(iSha, 0, "o expected_sha é conferido no PRIMEIRO passo");
  assert(iLoja > iSha && iDetector > iLoja, "ordem: sha < cadastro < segredo");
  assertEquals(passos.filter(vêSegredo).length, 1, "um passo só vê segredo");
  const checkout = passos.find((p) =>
    String(p.uses ?? "").startsWith("actions/checkout"),
  );
  assertEquals(checkout.with?.["persist-credentials"], false);
  assertEquals(
    passos.at(iLoja).run,
    'node scripts/frota/lojas.cjs validar "$PROJETO" --assinante --saida-do-passo',
  );
  const detector = passos.at(iDetector);
  assertEquals(
    detector.run,
    'node scripts/db-check-objetos-do-codigo.mjs --loja "$PROJETO"',
  );
  assertEquals(detector.env.PROJETO, "${{ inputs.projeto }}");
  // o ref vem SÓ do cadastro: nenhum ref nem URL de banco no passo
  assert(!Object.hasOwn(detector.env, "SUPABASE_PROJECT_REF"));
  assert(!Object.hasOwn(detector.env, "DATABASE_URL"));
  // entrada por env: nenhum `${{ }}` dentro de nenhum `run`
  for (const p of passos)
    assert(!String(p.run ?? "").includes("${{"), `${p.name}: interpolação`);
  // as linhas de segredo são o bloco GERADO, sem o segredo legado
  const texto = textoFrota();
  assertStringIncludes(texto, "# LOJAS-SEGREDOS-INICIO");
  assert(!texto.includes("secrets.SUPABASE_ACCESS_TOKEN }}"));
});

Deno.test("objetos-da-frota: em sincronia com o cadastro, e o gerador cobre o arquivo (loja nova e lojas na org central entram por dado)", () => {
  const atual = textoFrota();
  const cadReal = lojasFrota.carregarLojas();
  assert(
    geradorFrota
      .workflowsComBlocos()
      .some((p) => p.split(/[\\/]/).pop() === "objetos-da-frota.yml"),
    "o gerador não enxerga o arquivo",
  );
  assertEquals(geradorFrota.sincronizar(atual, cadReal), atual);
  const bruto = JSON.parse(
    Deno.readTextFileSync(`${RAIZ_REPO}/scripts/frota/lojas.json`),
  );
  const assinante = (ref, apelido, segredoDoToken) => ({
    ref,
    classe: "assinante",
    apelido,
    segredoDoToken,
    functionsNomeadas: false,
  });
  bruto.lojas = {
    ...bruto.lojas,
    "loja-propria-x": assinante(
      "abcdefghijklmnopqrst",
      "Propria",
      "SUPABASE_ACCESS_TOKEN_PROPRIA_X",
    ),
    "loja-org-a": assinante("aaaaaaaaaaaaaaaaaaab", "Org A", SEGREDO_ORG),
    "loja-org-b": assinante("aaaaaaaaaaaaaaaaaaac", "Org B", SEGREDO_ORG),
  };
  const cad = lojasFrota.validarCadastro(bruto);
  const novo = geradorFrota.sincronizar(atual, cad);
  const inputs = gatilhosDe(parse(novo)).workflow_dispatch.inputs;
  for (const l of ["loja-propria-x", "loja-org-a", "loja-org-b"])
    assert(inputs.projeto.options.includes(l), `${l} fora do menu`);
  assertStringIncludes(
    novo,
    "SUPABASE_ACCESS_TOKEN_PROPRIA_X: ${{ inputs.projeto == 'loja-propria-x' && secrets.SUPABASE_ACCESS_TOKEN_PROPRIA_X || '' }}",
  );
  // a org central: UMA linha, de tamanho fixo, guardada pelo passo `id: loja`
  const daOrg = novo
    .split("\n")
    .filter((l) => l.includes(`secrets.${SEGREDO_ORG}`));
  assertEquals(daOrg.length, 1);
  assertStringIncludes(
    daOrg[0],
    `${SEGREDO_ORG}: \${{ steps.loja.outputs.segredo == '${SEGREDO_ORG}' && secrets.${SEGREDO_ORG} || '' }}`,
  );
  // idempotente, e de volta ao cadastro real fica igual byte a byte
  assertEquals(geradorFrota.sincronizar(novo, cad), novo);
  assertEquals(geradorFrota.sincronizar(novo, cadReal), atual);
});

Deno.test({
  name: "objetos-da-frota: os passos de verdade (bash) recusam sha errado, loja legado e desconhecida antes do segredo; a assinante deixa SÓ o nome do segredo dela",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const passos = passosFrota();
    const sha = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
    const primeiro = passos[0].run;
    const certo = await bashFrota(primeiro, {
      PROJETO: "savy",
      EXPECTED_SHA: sha,
      GITHUB_SHA: sha,
    });
    assertEquals(certo.codigo, 0, certo.saida);
    for (const [projeto, esperado] of [
      ["savy", ""],
      ["savy", "b".repeat(40)],
      ["Loja Nova", sha],
      ["$(touch x)", sha],
    ]) {
      const r = await bashFrota(primeiro, {
        PROJETO: projeto,
        EXPECTED_SHA: esperado,
        GITHUB_SHA: sha,
      });
      assertEquals(r.codigo, 1, `${projeto}/${esperado}: ${r.saida}`);
    }
    const loja = passos.find((p) => p.id === "loja").run;
    const dir = Deno.makeTempDirSync({ prefix: "objetos-frota-" });
    try {
      const saida = `${dir}/out.txt`;
      for (const projeto of ["loja", "sandbox", "loja-ausente"]) {
        Deno.writeTextFileSync(saida, "");
        const r = await bashFrota(loja, {
          PROJETO: projeto,
          GITHUB_OUTPUT: saida,
        });
        assertEquals(r.codigo, 1, `${projeto}: ${r.saida}`);
        assertEquals(Deno.readTextFileSync(saida), "", projeto);
      }
      Deno.writeTextFileSync(saida, "");
      const ok = await bashFrota(loja, {
        PROJETO: "savy",
        GITHUB_OUTPUT: saida,
      });
      assertEquals(ok.codigo, 0, ok.saida);
      assertEquals(
        Deno.readTextFileSync(saida),
        "segredo=SUPABASE_ACCESS_TOKEN_SAVY\n",
      );
    } finally {
      Deno.removeSync(dir, { recursive: true });
    }
  },
});
