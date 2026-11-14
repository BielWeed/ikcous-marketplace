// @ts-nocheck
/* eslint-disable security/detect-object-injection -- dublês de teste: as chaves vêm de constantes e mapas fechados do próprio arquivo, nunca de entrada externa. */
/* eslint-disable security/detect-non-literal-require -- carrega o script (real ou mutante) de um arquivo temporário criado aqui. */
/**
 * O workflow `instalar-chave-da-loja.yml` e o script
 * `scripts/publicacao/instalar-chave-da-loja.cjs` (14/11/2026): instalam o HASH
 * (SHA-256 em hex minúsculo, 64 caracteres) da chave de envio de uma loja REAL no
 * banco dela, chamando só `public.assinatura_da_loja_definir_chave(hash, substituir)`
 * (migration 20261399998000) pela Management API, com o token de gestão da loja.
 *
 * O RISCO É PERMISSÃO + SEGREDO DE INFRAESTRUTURA: o token de gestão vale para a
 * conta inteira, e quem instala o hash decide qual chave abre a porta de escrita
 * do plano da loja. O que estes testes medem:
 *  - o workflow: só `workflow_dispatch`, permissões mínimas, concorrência por
 *    projeto SEM cancelar, projeto FECHADO nas duas lojas reais (nunca Almeida,
 *    Brand Meliz, Space nem `loja`/`sandbox`), `expected_sha` obrigatório no 1º
 *    passo, o hash validado (`^[0-9a-f]{64}$`) em passo PRÓPRIO antes de checkout e
 *    de segredo (o bloco `run:` é EXTRAÍDO e rodado em bash), nenhuma entrada
 *    interpolada em `run:`, cada alvo enxerga SÓ o seu segredo, ações pinadas por
 *    SHA, e o título do run sem o hash inteiro;
 *  - o script: a SQL de escrita é EXATAMENTE `select
 *    public.assinatura_da_loja_definir_chave('<hash>', <true|false>)`, montada só
 *    depois de provar o hash; a leitura de conferência devolve só um booleano;
 *    401/403 PARAM; o corpo cru e o token nunca vão ao log; `chave_ja_definida`
 *    vira mensagem clara; o veredito sai só quando o estado é conhecido.
 *
 * MUTANTES (a prova de que o teste enxerga o defeito): `verificarWorkflow` e
 * `verificarScript`/`verificarComportamento` são as MESMAS funções que julgam os
 * arquivos de verdade; o bloco "mutantes" planta cada defeito de volta num texto e
 * exige que a verificação fique VERMELHA.
 */
import { createRequire } from "node:module";
import { parse } from "https://deno.land/std@0.177.0/encoding/yaml.ts";
import { fromFileUrl, join } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const WORKFLOW = join(RAIZ, ".github/workflows/instalar-chave-da-loja.yml");
const SCRIPT = join(RAIZ, "scripts/publicacao/instalar-chave-da-loja.cjs");
const CONFERIR_BANCO = join(RAIZ, "scripts/publicacao/conferir-banco.cjs");

const REF_SAVY = "gnjsrucsmjkajijrakzr";
const REF_CAF = "cafkrminfnokvgjqtkle";
const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const HASH = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const TRES_TOKENS = {
  SUPABASE_ACCESS_TOKEN: "tk-legado",
  SUPABASE_ACCESS_TOKEN_IKCOUS: "tk-caf",
  SUPABASE_ACCESS_TOKEN_SAVY: "tk-savy",
};
const SEM_ACESSO_SAVY =
  "sem acesso legítimo à Savy por SUPABASE_ACCESS_TOKEN_SAVY — bloqueio concreto";
const SEM_ACESSO_CAF =
  "sem acesso legítimo à CAF por SUPABASE_ACCESS_TOKEN_IKCOUS — bloqueio concreto";
const JA_DEFINIDA =
  "já existe chave nesta loja: use substituir=true para rotacionar";
const SEM_SANITIZAR = { sanitizeOps: false, sanitizeResources: false };

// A SQL esperada, escrita À MÃO aqui (o oráculo é independente do script).
const SQL_EXISTIA =
  "select exists (select 1 from public.assinatura_da_loja_chave) as existia";
const sqlDefinir = (hash: string, substituir: boolean) =>
  `select public.assinatura_da_loja_definir_chave('${hash}', ${substituir})`;
const sqlConferir = (hash: string) =>
  `select coalesce(count(*) = 1 and bool_or(chave_hash = '${hash}'), false) as bate from public.assinatura_da_loja_chave`;

// ---------------------------------------------------------------- utilitários

/** O arquivo sem as linhas de comentário (os cabeçalhos explicam o que NÃO fazem). */
function semComentariosYaml(yaml: string): string {
  return yaml
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
}

// O código JS sem comentários de linha inteira nem blocos de comentário.
function semComentariosJs(js: string): string {
  return js
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
}

async function rodarBash(script: string, env: Record<string, string>) {
  const r = await new Deno.Command("bash", {
    args: ["-c", script],
    cwd: RAIZ,
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const dec = new TextDecoder();
  return { codigo: r.code, saida: dec.decode(r.stdout) + dec.decode(r.stderr) };
}

/** O arquivo do evento do disparo (o que o runner do GitHub grava em
 * GITHUB_EVENT_PATH): é de onde o hash é lido, nunca de `env:`. */
function arquivoDoEvento(hash: unknown, dir: string): string {
  const arquivo = join(dir, "evento.json");
  Deno.writeTextFileSync(arquivo, JSON.stringify({ inputs: { hash } }));
  return arquivo;
}

/** Carrega o script a partir de um TEXTO (o real ou um mutante), numa cópia
 * temporária cujo `require("./conferir-banco.cjs")` aponta para o arquivo real. */
function carregarScript(fonte: string) {
  const dir = Deno.makeTempDirSync({ prefix: "instalar-chave-" });
  const arquivo = join(dir, "instalar-chave-da-loja.cjs");
  const ajustada = fonte.replaceAll(
    '"./conferir-banco.cjs"',
    JSON.stringify(CONFERIR_BANCO),
  );
  Deno.writeTextFileSync(arquivo, ajustada);
  try {
    return require(arquivo);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
}

/** Um fetch falso que anota cada chamada e responde pela fila. */
function fetchFalso(respostas: Array<Record<string, unknown> | Error>) {
  const chamadas: Array<{ url: string; init: Record<string, any> }> = [];
  const fila = [...respostas];
  const impl = (url: string, init: Record<string, any>) => {
    chamadas.push({ url: String(url), init });
    const r = fila.shift();
    if (r === undefined)
      throw new Error("fetch chamado a mais do que o esperado");
    if (r instanceof Error) return Promise.reject(r);
    const status = r.status ?? 200;
    return Promise.resolve({
      status,
      ok: status >= 200 && status < 300,
      text: () => Promise.resolve(String(r.corpo ?? "")),
    });
  };
  const queries = () => chamadas.map((c) => JSON.parse(c.init.body).query);
  return { impl, chamadas, queries };
}

function saidaFalsa() {
  const linhas: string[] = [];
  const resumo: string[] = [];
  return {
    saida: {
      log: (l: string) => {
        linhas.push(l);
      },
      erro: (l: string) => {
        linhas.push(l);
      },
      resumo: (m: string) => {
        resumo.push(m);
      },
    },
    linhas,
    resumo,
    tudo: () => [...linhas, ...resumo].join("\n"),
  };
}

const ok = (corpo: unknown) => ({ status: 201, corpo: JSON.stringify(corpo) });
const existia = (v: boolean) => ok([{ existia: v }]);
const definiuOk = ok([{ assinatura_da_loja_definir_chave: "" }]);
const bate = (v: unknown) => ok([{ bate: v }]);
const erroDoBanco = (msg: string, status = 400) => ({
  status,
  corpo: JSON.stringify({ message: msg }),
});

/** Chama `instalar` com os valores de um caminho feliz, sobrescrevendo o que o caso muda. */
function chamarInstalar(
  mod,
  f,
  s,
  extra: Record<string, unknown> = {},
  env = TRES_TOKENS,
) {
  return mod.instalar({
    projeto: "savy",
    hash: HASH,
    substituir: "false",
    sha: SHA,
    env: { ...env },
    fetchImpl: f.impl,
    saida: s.saida,
    ...extra,
  });
}

// ------------------------------------------------- verificação do WORKFLOW

/** Julga um texto de workflow (o real ou um mutante). Lança no 1º defeito. */
async function verificarWorkflow(yamlCru: string) {
  const yaml = semComentariosYaml(yamlCru);
  const doc = parse(yamlCru);

  // gatilho: SÓ workflow_dispatch
  const gatilhos = doc.on ?? doc[true];
  assertEquals(Object.keys(gatilhos), ["workflow_dispatch"], "só dispatch");
  for (const proibido of [
    "pull_request_target",
    "pull_request",
    "push:",
    "schedule",
    "workflow_run",
    "issue_comment",
    "workflow_call",
  ]) {
    assert(!yaml.includes(proibido), `gatilho proibido: ${proibido}`);
  }

  assertEquals(doc.permissions, { contents: "read" }, "permissões mínimas");
  assert(!yaml.includes("continue-on-error"), "sem continue-on-error");

  // concorrência: por projeto, NUNCA cancela (um 2º pedido espera a vez)
  assertEquals(doc.concurrency.group, "chave-da-loja-${{ inputs.projeto }}");
  assertEquals(doc.concurrency["cancel-in-progress"], false);
  assertEquals(doc.concurrency.queue, "max", "fila: nenhum pedido se perde");

  // título do run: projeto e modo; o hash NÃO entra (o Actions não tem função de
  // recorte, então "os 8 primeiros" é impossível, e o hash inteiro não é preciso)
  assertEquals(
    doc["run-name"],
    "instalar chave em ${{ inputs.projeto }} (${{ inputs.substituir && 'rotacao' || 'nova' }})",
  );
  assert(
    !String(doc["run-name"]).includes("hash"),
    "o título nunca leva o hash",
  );

  // só funções que o Actions TEM (uma função inventada, como substr, só falha no
  // GitHub, nunca aqui): lista da documentação de expressões, conferida em 14/11/2026
  const FUNCOES_DO_ACTIONS = new Set([
    "contains",
    "startsWith",
    "endsWith",
    "format",
    "join",
    "toJSON",
    "fromJSON",
    "hashFiles",
    "case",
    "success",
    "always",
    "cancelled",
    "failure",
  ]);
  for (const [, expressao] of yaml.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
    for (const [, nome] of expressao.matchAll(
      /([A-Za-z_][A-Za-z0-9_]*)\s*\(/g,
    )) {
      assert(
        FUNCOES_DO_ACTIONS.has(nome),
        `função inexistente no Actions: ${nome}()`,
      );
    }
  }

  // entradas: projeto FECHADO, hash texto, substituir booleano (padrão false)
  const entradas = gatilhos.workflow_dispatch.inputs;
  assertEquals(Object.keys(entradas).sort(), [
    "expected_sha",
    "hash",
    "projeto",
    "substituir",
  ]);
  assertEquals(entradas.projeto.type, "choice", "projeto é escolha fechada");
  assertEquals(entradas.projeto.options, ["ikcous-publicada", "savy"]);
  assertEquals(entradas.projeto.required, true);
  assertEquals(entradas.hash.type, "string");
  assertEquals(entradas.hash.required, true);
  assertEquals(entradas.substituir.type, "boolean");
  assertEquals(entradas.substituir.default, false, "rotação é opt-in");
  assertEquals(
    entradas.expected_sha.required,
    true,
    "expected_sha obrigatório",
  );
  for (const proibida of ["loja", "sandbox", "almeida", "brand", "space"]) {
    assert(
      !JSON.stringify([entradas.projeto.options, entradas.projeto.default])
        .toLowerCase()
        .includes(proibida),
      `loja de teste/legado no projeto: ${proibida}`,
    );
  }
  assert(!("permitir_reaplicar" in entradas), "sem permitir_reaplicar");

  assertEquals(Object.keys(doc.jobs), ["instalar"]);
  const job = doc.jobs.instalar;
  assert(job["timeout-minutes"] <= 10, "timeout curto");
  const passos = job.steps;

  // 1º passo: alvo + expected_sha, sem `uses`, sem rede, sem segredo
  const primeiro = passos[0];
  assert(primeiro.run && !primeiro.uses, "o 1º passo é a conferência do sha");
  assertEquals(primeiro.env.EXPECTED_SHA, "${{ inputs.expected_sha }}");
  assertEquals(primeiro.env.PROJETO, "${{ inputs.projeto }}");
  assert(!/curl|fetch|api\.supabase/.test(primeiro.run), "sem rede antes");
  assert(
    !JSON.stringify(primeiro).includes("secrets."),
    "o passo do sha não vê segredo",
  );

  // 2º passo, PRÓPRIO: valida o hash (e o booleano) antes de checkout e de segredo
  const segundo = passos[1];
  assert(segundo.run && !segundo.uses, "o 2º passo é a validação do hash");
  assertEquals(segundo.env, { SUBSTITUIR: "${{ inputs.substituir }}" });
  // O HASH NUNCA entra por `env:` nem por `run:` em passo nenhum: o GitHub imprime o
  // bloco env: de cada passo no log (repo público), e o valor sairia em claro.
  for (const p of passos) {
    assert(!("HASH" in (p.env ?? {})), `HASH em env: no passo ${p.name}`);
    // (ler `.inputs.hash` do arquivo do evento é o caminho certo; expressão
    // `${{ inputs.hash }}` em env:/run:/with: é o que não pode existir)
    assert(
      !/\$\{\{[^}]*inputs\.hash/.test(JSON.stringify(p)),
      `\${{ inputs.hash }} dentro do passo ${p.name}`,
    );
  }
  assert(!/\$\{\{[^}]*inputs\.hash/.test(yaml), "inputs.hash em expressão");
  // o mascaramento vem ANTES da validação e de qualquer saída de erro
  const iMascara = segundo.run.indexOf("::add-mask::");
  assert(iMascara > 0, "o passo do hash mascara o valor");
  assert(
    iMascara < segundo.run.indexOf("=~") &&
      iMascara < segundo.run.indexOf("exit 1") &&
      iMascara < segundo.run.indexOf("::error::"),
    "add-mask antes da validação",
  );
  assertStringIncludes(segundo.run, "$GITHUB_EVENT_PATH");
  assert(
    !/curl|fetch|api\.supabase|secrets\./.test(JSON.stringify(segundo)),
    "a validação não toca rede nem segredo",
  );
  const iCheckout = passos.findIndex((p) =>
    String(p.uses ?? "").startsWith("actions/checkout"),
  );
  assert(iCheckout > 1, "o checkout vem depois das duas conferências");

  // o bloco do 1º passo, RODADO: 40 hex, igual ao GITHUB_SHA, projeto fechado
  for (const projeto of ["ikcous-publicada", "savy"]) {
    const rodar = (esperado: string) =>
      rodarBash(primeiro.run, {
        PATH: Deno.env.get("PATH") ?? "",
        PROJETO: projeto,
        EXPECTED_SHA: esperado,
        GITHUB_SHA: SHA,
      });
    assertEquals((await rodar(SHA)).codigo, 0, `${projeto}: sha igual`);
    const recusas: [string, string][] = [
      ["vazio", ""],
      ["curto (7)", SHA.slice(0, 7)],
      ["41 caracteres", `${SHA}a`],
      ["40 hex de OUTRO commit", "b".repeat(40)],
      ["com espaço no fim", `${SHA.slice(0, 39)} `],
    ];
    for (const [caso, esperado] of recusas) {
      const r = await rodar(esperado);
      assertEquals(r.codigo, 1, `${projeto} / ${caso}: ${r.saida}`);
      assertStringIncludes(
        r.saida,
        "expected_sha completo e igual ao GITHUB_SHA",
      );
    }
  }
  for (const projeto of ["loja", "sandbox", "almeida", "", "savy ", "SAVY"]) {
    const r = await rodarBash(primeiro.run, {
      PATH: Deno.env.get("PATH") ?? "",
      PROJETO: projeto,
      EXPECTED_SHA: SHA,
      GITHUB_SHA: SHA,
    });
    assertEquals(r.codigo, 1, `projeto "${projeto}" devia ser recusado`);
  }

  // o bloco do 2º passo, RODADO: só 64 hex MINÚSCULOS passam, e o valor nunca é ecoado
  const dirEvento = Deno.makeTempDirSync({ prefix: "evento-" });
  const validar = (hash: string, substituir = "false") =>
    rodarBash(segundo.run, {
      PATH: Deno.env.get("PATH") ?? "",
      GITHUB_EVENT_PATH: arquivoDoEvento(hash, dirEvento),
      SUBSTITUIR: substituir,
    });
  /** O que o runner veria: tira os comandos `::add-mask::` (consumidos por ele). */
  const semMascaras = (saida: string) =>
    saida
      .split("\n")
      .filter((l) => !l.startsWith("::add-mask::"))
      .join("\n");
  {
    const r = await validar(HASH);
    assertEquals(r.codigo, 0, "hash válido passa");
    assertEquals(
      r.saida.split("\n")[0].trim(),
      `::add-mask::${HASH}`,
      "o hash é mascarado já na primeira linha",
    );
    assert(
      !semMascaras(r.saida).includes(HASH),
      "e não aparece fora da máscara",
    );
  }
  assertEquals(
    (await validar(HASH, "true")).codigo,
    0,
    "substituir=true passa",
  );
  const hashesRuins: [string, string][] = [
    ["maiúsculas", HASH.toUpperCase()],
    ["uma maiúscula no meio", `${HASH.slice(0, 20)}A${HASH.slice(21)}`],
    ["vazio", ""],
    ["63 caracteres", HASH.slice(0, 63)],
    ["65 caracteres", `${HASH}a`],
    ["espaço no começo", ` ${HASH.slice(0, 63)}`],
    ["espaço no fim", `${HASH.slice(0, 63)} `],
    ["quebra de linha no fim", `${HASH}\n`],
    ["duas linhas de 64", `${HASH}\n${HASH}`],
    ["caractere não hex (g)", `g${HASH.slice(1)}`],
    ["prefixo 0x", `0x${HASH.slice(2)}`],
    ["aspas e SQL", `${"a".repeat(40)}');drop table t;--`.slice(0, 64)],
    ["substituição de comando", `$(touch x)${HASH.slice(8)}`],
    ["a chave em texto puro", "sk_live_UMA-CHAVE-QUALQUER-EM-TEXTO-PURO"],
  ];
  for (const [caso, hash] of hashesRuins) {
    const r = await validar(hash);
    assertEquals(r.codigo, 1, `hash ${caso} devia ser recusado: ${r.saida}`);
    assertStringIncludes(r.saida, "hash inválido");
    // o valor recusado (a chave colada por engano, por exemplo) é MASCARADO, linha
    // a linha, ANTES da mensagem de erro, e a mensagem não o repete
    const linhas = r.saida.split("\n").map((l) => l.replace(/\r$/, ""));
    const iErro = linhas.findIndex((l) => l.includes("hash inválido"));
    for (const linhaDoHash of hash.split("\n").filter((l) => l !== "")) {
      const iMask = linhas.indexOf(`::add-mask::${linhaDoHash}`);
      assert(
        iMask >= 0 && iMask < iErro,
        `sem máscara antes do erro (${caso})`,
      );
      assert(
        !semMascaras(r.saida).includes(linhaDoHash),
        `o valor recusado não pode ser ecoado (${caso})`,
      );
    }
  }
  for (const substituir of ["TRUE", "1", "", "sim", "true ", "false\n"]) {
    const r = await validar(HASH, substituir);
    assertEquals(r.codigo, 1, `substituir "${substituir}" devia ser recusado`);
  }
  Deno.removeSync(dirEvento, { recursive: true });

  // checkout sem credencial gravada; ações PINADAS por SHA; o passo final
  const checkout = passos[iCheckout];
  assertEquals(checkout.with?.["persist-credentials"], false);
  for (const p of passos.filter((x) => x.uses)) {
    assert(
      /@[0-9a-f]{40}(\s|$)/.test(p.uses),
      `ação sem pin por SHA: ${p.uses}`,
    );
  }
  const ultimo = passos[passos.length - 1];
  assertEquals(
    ultimo.run,
    "node scripts/publicacao/instalar-chave-da-loja.cjs",
  );

  // nenhuma entrada interpolada num `run:` (injeção de comando)
  for (const p of passos) {
    assert(
      !String(p.run ?? "").includes("${{"),
      `\${{ }} dentro de run: ${p.name}`,
    );
  }

  // SEGREDOS: só no passo final, cada alvo enxerga SÓ o seu
  const comSegredo = passos.filter((p) =>
    JSON.stringify(p).includes("secrets."),
  );
  assertEquals(comSegredo.length, 1, "um único passo vê segredo");
  assertEquals(comSegredo[0], ultimo, "e é o passo do script");
  assertEquals(ultimo.env, {
    SUPABASE_ACCESS_TOKEN_IKCOUS:
      "${{ inputs.projeto == 'ikcous-publicada' && secrets.SUPABASE_ACCESS_TOKEN_IKCOUS || '' }}",
    SUPABASE_ACCESS_TOKEN_SAVY:
      "${{ inputs.projeto == 'savy' && secrets.SUPABASE_ACCESS_TOKEN_SAVY || '' }}",
    PROJETO: "${{ inputs.projeto }}",
    SUBSTITUIR: "${{ inputs.substituir }}",
  });
  const usos = yaml.match(/secrets[.[]/g) ?? [];
  assertEquals(usos.length, 2, "exatamente dois segredos referenciados");
  assert(!/secrets\.SUPABASE_ACCESS_TOKEN\s*[}|]/.test(yaml), "sem o legado");
  assert(!/toJSON\(secrets\)|secrets\[/.test(yaml), "sem coleção de segredos");
  assert(!/echo[^\n]*\$\{?(HASH|SUPABASE)/.test(yaml), "nada ecoa hash/token");
}

// ---------------------------------------------------- verificação do SCRIPT (texto)

function verificarScript(fonte: string) {
  const js = semComentariosJs(fonte);
  assertEquals(
    (js.match(/fetchImpl\(/g) ?? []).length,
    1,
    "um único ponto de chamada de rede",
  );
  assert(!/\bfetch\(/.test(js), "nenhum fetch direto fora do injetado");
  assertStringIncludes(js, 'method: "POST"');
  assertStringIncludes(js, 'redirect: "error"');
  assert(
    !/\b(PUT|PATCH|DELETE)\b/.test(js),
    "só POST na Management API, nenhum outro método",
  );
  assert(!js.includes("/read-only"), "tudo pelo endpoint de consulta comum");
  assert(
    !/process\.env\.[A-Z_]*API_BASE/.test(js),
    "sem desvio de host por env",
  );
  assertStringIncludes(js, 'require("./conferir-banco.cjs")');
  assertStringIncludes(js, "resolverRef(");
  // o hash vem do arquivo do evento, nunca de variável de ambiente
  assertStringIncludes(js, "process.env.GITHUB_EVENT_PATH");
  assert(!/process\.env\.HASH/.test(js), "hash lido de process.env");
  // a ÚNICA escrita é a função, e só ela: nenhum verbo de escrita solto no código
  assertEquals(
    (js.match(/assinatura_da_loja_definir_chave/g) ?? []).length,
    1,
    "a função aparece uma vez, na SQL de escrita",
  );
  assert(
    !/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke)\b/i.test(
      js,
    ),
    "nenhum verbo de escrita/DDL além da função",
  );
  assert(!/console\.(log|error)\([^)]*(token|hash)/i.test(js), "sem log cru");
}

// ------------------------------------------- verificação do COMPORTAMENTO do script

async function verificarComportamento(mod) {
  // (a) Savy, caminho feliz (instalação nova): 3 chamadas, SQL exata, veredito
  {
    const f = fetchFalso([existia(false), definiuOk, bate(true)]);
    const s = saidaFalsa();
    const codigo = await chamarInstalar(mod, f, s);
    assertEquals(codigo, 0, s.tudo());
    assertEquals(f.chamadas.length, 3, "leitura, escrita, conferência");
    assertEquals(f.queries(), [
      SQL_EXISTIA,
      sqlDefinir(HASH, false),
      sqlConferir(HASH),
    ]);
    for (const { url, init } of f.chamadas) {
      assertEquals(
        url,
        `https://api.supabase.com/v1/projects/${REF_SAVY}/database/query`,
      );
      assertEquals(init.method, "POST");
      assertEquals(init.redirect, "error");
      assertEquals(init.headers.Authorization, "Bearer tk-savy");
      assertEquals(Object.keys(JSON.parse(init.body)), ["query"]);
    }
    const tudo = s.tudo();
    assertEquals(
      s.linhas[s.linhas.length - 1],
      `VEREDITO-INSTALAR-CHAVE projeto=savy sha=${SHA} definida=true substituiu=false`,
      "o run termina com o veredito",
    );
    assert(!tudo.includes(HASH), "o hash inteiro não vai ao log");
    for (const t of Object.values(TRES_TOKENS)) {
      assert(!tudo.includes(t), "token nunca impresso");
    }
    assertEquals(s.resumo.length, 1, "um resumo do run");
    assert(!s.resumo[0].includes(HASH), "nem ao resumo");
  }

  // (b) a CAF: token e ref da CAF; rotação de verdade (já havia chave)
  {
    const f = fetchFalso([existia(true), definiuOk, bate(true)]);
    const s = saidaFalsa();
    assertEquals(
      await chamarInstalar(mod, f, s, {
        projeto: "ikcous-publicada",
        substituir: "true",
      }),
      0,
      s.tudo(),
    );
    assertEquals(f.queries()[1], sqlDefinir(HASH, true));
    assertEquals(f.chamadas[0].init.headers.Authorization, "Bearer tk-caf");
    assertEquals(
      f.chamadas[0].url,
      `https://api.supabase.com/v1/projects/${REF_CAF}/database/query`,
    );
    assertEquals(
      s.linhas[s.linhas.length - 1],
      `VEREDITO-INSTALAR-CHAVE projeto=ikcous-publicada sha=${SHA} definida=true substituiu=true`,
    );
  }

  // (b2) substituir=true numa loja SEM chave: é instalação, não troca
  {
    const f = fetchFalso([existia(false), definiuOk, bate(true)]);
    const s = saidaFalsa();
    assertEquals(await chamarInstalar(mod, f, s, { substituir: "true" }), 0);
    assertEquals(
      s.linhas[s.linhas.length - 1],
      `VEREDITO-INSTALAR-CHAVE projeto=savy sha=${SHA} definida=true substituiu=false`,
    );
  }

  // (c) projeto FECHADO: qualquer outro valor é recusado antes de qualquer rede
  for (const projeto of [
    "loja",
    "sandbox",
    "almeida",
    "__proto__",
    "constructor",
    "toString",
    REF_SAVY,
    "",
    undefined,
    "savy/../x",
    "SAVY",
    "savy ",
  ]) {
    const f = fetchFalso([]);
    const s = saidaFalsa();
    assertEquals(
      await chamarInstalar(mod, f, s, { projeto }),
      1,
      `projeto ${String(projeto)} devia ser recusado`,
    );
    assertEquals(f.chamadas.length, 0, `sem rede para ${String(projeto)}`);
  }

  // (d) o hash é provado ANTES de qualquer rede (defesa em profundidade do passo do workflow)
  for (const hash of [
    HASH.toUpperCase(),
    `${HASH.slice(0, 20)}A${HASH.slice(21)}`,
    "",
    undefined,
    null,
    123,
    HASH.slice(0, 63),
    `${HASH}a`,
    ` ${HASH.slice(0, 63)}`,
    `${HASH}\n`,
    `${"a".repeat(40)}');drop table t;--`.slice(0, 64),
  ]) {
    const f = fetchFalso([]);
    const s = saidaFalsa();
    assertEquals(
      await chamarInstalar(mod, f, s, { hash }),
      1,
      `hash ${String(hash)} devia ser recusado`,
    );
    assertEquals(f.chamadas.length, 0, "sem rede com hash ruim");
    assert(!s.tudo().includes("drop table"), "valor recusado não é ecoado");
  }

  // (e) `substituir` só aceita as palavras true/false
  for (const substituir of [
    "TRUE",
    "1",
    "",
    "sim",
    undefined,
    true,
    "false ",
  ]) {
    const f = fetchFalso([]);
    const s = saidaFalsa();
    assertEquals(
      await chamarInstalar(mod, f, s, { substituir }),
      1,
      `substituir ${String(substituir)} devia ser recusado`,
    );
    assertEquals(f.chamadas.length, 0);
  }

  // (e2) o sha do run é exigido (40 hex): é o que vai no veredito
  for (const sha of ["", undefined, "abc", "g".repeat(40)]) {
    const f = fetchFalso([]);
    const s = saidaFalsa();
    assertEquals(await chamarInstalar(mod, f, s, { sha }), 1);
    assertEquals(f.chamadas.length, 0);
  }

  // (f) cada alvo enxerga SÓ o seu segredo: sem o dele, PARA (sem usar o vizinho)
  for (const [projeto, proprio, msg] of [
    ["savy", "SUPABASE_ACCESS_TOKEN_SAVY", SEM_ACESSO_SAVY],
    ["ikcous-publicada", "SUPABASE_ACCESS_TOKEN_IKCOUS", SEM_ACESSO_CAF],
  ]) {
    const env = { ...TRES_TOKENS };
    delete env[proprio];
    const f = fetchFalso([]);
    const s = saidaFalsa();
    assertEquals(await chamarInstalar(mod, f, s, { projeto }, env), 1);
    assertEquals(f.chamadas.length, 0, "sem token próprio, sem nenhuma rede");
    assertStringIncludes(s.tudo(), msg);
    for (const t of ["tk-legado", "tk-caf", "tk-savy"]) {
      assert(!s.tudo().includes(t), "token nunca impresso");
    }
  }

  // (g) 401/403 na LEITURA PRÉVIA: PARA, nada foi escrito
  for (const status of [401, 403]) {
    const f = fetchFalso([
      { status, corpo: '{"message":"CORPO-DO-ERRO-NAO-IMPRIMIR tk-savy"}' },
      definiuOk,
    ]);
    const s = saidaFalsa();
    assertEquals(await chamarInstalar(mod, f, s), 1);
    assertEquals(f.chamadas.length, 1, `${status}: nada escrito`);
    assertStringIncludes(s.tudo(), SEM_ACESSO_SAVY);
    assertStringIncludes(s.tudo(), `HTTP ${status}`);
    assert(!s.tudo().includes("CORPO-DO-ERRO"), "corpo do erro não impresso");
    assert(!s.tudo().includes("VEREDITO"), "sem veredito sem estado conhecido");
  }

  // (g2) 401/403 na ESCRITA: PARA, sem conferência e sem outra tentativa
  for (const status of [401, 403]) {
    const f = fetchFalso([
      existia(false),
      { status, corpo: "CORPO-DO-ERRO-NAO-IMPRIMIR" },
      bate(true),
    ]);
    const s = saidaFalsa();
    assertEquals(
      await chamarInstalar(mod, f, s, { projeto: "ikcous-publicada" }),
      1,
    );
    assertEquals(f.chamadas.length, 2);
    assertStringIncludes(s.tudo(), SEM_ACESSO_CAF);
    assert(!s.tudo().includes("CORPO-DO-ERRO"));
    assert(!s.tudo().includes("VEREDITO"));
  }

  // (h) já existe chave e substituir=false: mensagem clara, nada mudou, veredito falso
  {
    const f = fetchFalso([
      existia(true),
      erroDoBanco(
        `ERROR: 23505: chave_ja_definida\nCONTEXT: PL/pgSQL function ${HASH}`,
      ),
      bate(true),
    ]);
    const s = saidaFalsa();
    assertEquals(await chamarInstalar(mod, f, s), 1);
    assertEquals(f.chamadas.length, 2, "sem conferência depois da recusa");
    assertStringIncludes(s.tudo(), JA_DEFINIDA);
    assertEquals(
      s.linhas[s.linhas.length - 1],
      `VEREDITO-INSTALAR-CHAVE projeto=savy sha=${SHA} definida=false substituiu=false`,
    );
    assert(!s.tudo().includes("CONTEXT"), "corpo do erro não impresso");
    assert(!s.tudo().includes(HASH), "hash do corpo não impresso");
  }

  // (h2) `chave_ja_definida` com substituir=true não pede substituir=true (não faz sentido)
  {
    const f = fetchFalso([existia(true), erroDoBanco("chave_ja_definida")]);
    const s = saidaFalsa();
    assertEquals(await chamarInstalar(mod, f, s, { substituir: "true" }), 1);
    assert(!s.tudo().includes("use substituir=true"));
    assert(!s.tudo().includes("definida=true"));
  }

  // (i) outro erro do banco ou 5xx na escrita: estado DESCONHECIDO, sem veredito, só o status
  for (const resposta of [
    { status: 500, corpo: `corpo-secreto-${HASH}` },
    erroDoBanco("ERROR: 22023: hash_invalido"),
    { status: 202, corpo: "[]" },
    { status: 201, corpo: '{"message":"corpo-secreto de 201"}' },
  ]) {
    const f = fetchFalso([existia(false), resposta, bate(true)]);
    const s = saidaFalsa();
    assertEquals(await chamarInstalar(mod, f, s), 1);
    assertEquals(f.chamadas.length, 2, "sem retry nem conferência cega");
    assertStringIncludes(s.tudo(), "ESTADO DESCONHECIDO");
    assert(!s.tudo().includes("corpo-secreto"), "corpo não impresso");
    assert(!s.tudo().includes("VEREDITO"), "sem veredito sem estado conhecido");
  }

  // (j) a escrita que lança (queda de rede/timeout): não carrega token nem mensagem ao log
  {
    const f = fetchFalso([
      existia(false),
      new Error("falhou com Bearer tk-savy e hash"),
      bate(true),
    ]);
    const s = saidaFalsa();
    assertEquals(await chamarInstalar(mod, f, s), 1);
    assertEquals(f.chamadas.length, 2);
    assertStringIncludes(s.tudo(), "ESTADO DESCONHECIDO");
    assert(!s.tudo().includes("tk-savy"), "token fora do log");
    assert(!s.tudo().includes("e hash"), "mensagem do erro fora do log");
    assert(!s.tudo().includes("VEREDITO"));
  }

  // (k) a leitura prévia falha ou vem torta: PARA ANTES de escrever
  for (const resposta of [
    { status: 500, corpo: "x" },
    { status: 201, corpo: "não é json" },
    ok([]),
    ok([{ existia: "sim" }]),
    ok([{ existia: true }, { existia: false }]),
    ok({ existia: true }),
    new Error("queda"),
  ]) {
    const f = fetchFalso([resposta, definiuOk]);
    const s = saidaFalsa();
    assertEquals(await chamarInstalar(mod, f, s), 1);
    assertEquals(f.chamadas.length, 1, "nenhuma escrita sem a leitura prévia");
    assert(!s.tudo().includes("VEREDITO"));
  }

  // (l) a conferência NÃO bate (ou vem torta): falha, sem dizer definida=true
  for (const resposta of [
    bate(false),
    bate(null),
    bate("true"),
    ok([]),
    ok([{ bate: true }, { bate: true }]),
    ok([{ outra: true }]),
    { status: 500, corpo: "x" },
    new Error("queda"),
  ]) {
    const f = fetchFalso([existia(false), definiuOk, resposta]);
    const s = saidaFalsa();
    assertEquals(await chamarInstalar(mod, f, s), 1);
    assertEquals(f.chamadas.length, 3);
    assertStringIncludes(s.tudo(), "conferência");
    assert(!s.tudo().includes("definida=true"), "sem veredito verdadeiro");
    assert(!s.tudo().includes("VEREDITO"), "sem veredito sem prova");
  }

  // (m) o hash é lido do ARQUIVO DO EVENTO, só se for texto; o resto vira undefined
  {
    const dir = Deno.makeTempDirSync({ prefix: "evento-ler-" });
    assertEquals(mod.lerHashDoEvento(arquivoDoEvento(HASH, dir)), HASH);
    assertEquals(
      mod.lerHashDoEvento(arquivoDoEvento(`${HASH}\n`, dir)),
      `${HASH}\n`,
      "a quebra de linha final é preservada (a validação a recusa)",
    );
    for (const valor of [123, null, undefined, ["a"], { a: 1 }, true]) {
      assertEquals(
        mod.lerHashDoEvento(arquivoDoEvento(valor, dir)),
        undefined,
        `valor ${JSON.stringify(valor)} não é texto`,
      );
    }
    const torto = join(dir, "torto.json");
    Deno.writeTextFileSync(torto, "isto não é json");
    for (const caminho of [
      undefined,
      "",
      join(dir, "nao-existe.json"),
      torto,
    ]) {
      assertEquals(mod.lerHashDoEvento(caminho), undefined);
    }
    Deno.removeSync(dir, { recursive: true });
  }
}

// --------------------------------------------------------------- os testes reais

const FONTE_SCRIPT = () => Deno.readTextFileSync(SCRIPT);
const FONTE_WORKFLOW = () => Deno.readTextFileSync(WORKFLOW);

Deno.test({
  name: "o workflow: dispatch só, 2 lojas reais, expected_sha e hash validados antes do segredo, cada alvo com o seu",
  ...SEM_SANITIZAR,
  fn: async () => {
    await verificarWorkflow(FONTE_WORKFLOW());
  },
});

Deno.test("o script: a única escrita é a função, só POST, sem redirecionamento, ref por resolverRef", () => {
  verificarScript(FONTE_SCRIPT());
});

Deno.test({
  name: "o script: SQL exata, hash provado antes da rede, 401/403 param, corpo cru e token nunca impressos, veredito só com estado conhecido",
  ...SEM_SANITIZAR,
  fn: async () => {
    await verificarComportamento(carregarScript(FONTE_SCRIPT()));
  },
});

Deno.test("o script exporta o necessário e não roda ao ser importado", () => {
  const mod = carregarScript(FONTE_SCRIPT());
  assertEquals(typeof mod.instalar, "function");
  assertEquals(typeof mod.main, "function");
  assertEquals(typeof mod.lerHashDoEvento, "function");
  assertEquals(Object.keys(mod.ALVOS).sort(), ["ikcous-publicada", "savy"]);
});

Deno.test({
  name: "o main() real, sem nenhum token: sai 1 (nos dois alvos e em loja) sem tocar a rede",
  ...SEM_SANITIZAR,
  fn: async () => {
    const dirEvento = Deno.makeTempDirSync({ prefix: "evento-main-" });
    for (const projeto of ["savy", "ikcous-publicada", "loja"]) {
      const r = await new Deno.Command("node", {
        args: [SCRIPT],
        cwd: RAIZ,
        env: {
          PATH: Deno.env.get("PATH") ?? "",
          PROJETO: projeto,
          GITHUB_EVENT_PATH: arquivoDoEvento(HASH, dirEvento),
          SUBSTITUIR: "false",
          GITHUB_SHA: SHA,
        },
        stdout: "piped",
        stderr: "piped",
      }).output();
      const dec = new TextDecoder();
      assertEquals(r.code, 1, dec.decode(r.stderr));
    }
    Deno.removeSync(dirEvento, { recursive: true });
  },
});

Deno.test({
  name: "ponta a ponta: o main() real (node, fetch trocado por um stub) manda as 3 consultas na ordem, só com o token do alvo, e termina com o veredito",
  ...SEM_SANITIZAR,
  fn: async () => {
    const dir = Deno.makeTempDirSync({ prefix: "instalar-chave-e2e-" });
    const stub = join(dir, "stub-fetch.cjs");
    const resumo = join(dir, "resumo.md");
    Deno.writeTextFileSync(
      stub,
      `const respostas = JSON.parse(process.env.STUB_RESPOSTAS);
globalThis.fetch = async (url, init) => {
  const r = respostas.shift();
  process.stderr.write("STUB " + init.method + " " + url + " " + init.headers.Authorization + " " + JSON.parse(init.body).query + "\\n");
  return { status: r.status, ok: r.status < 300, text: async () => r.corpo };
};`,
    );
    const rodar = async (env: Record<string, string>, respostas: unknown[]) => {
      const r = await new Deno.Command("node", {
        args: ["--require", stub, SCRIPT],
        cwd: RAIZ,
        env: {
          PATH: Deno.env.get("PATH") ?? "",
          GITHUB_STEP_SUMMARY: resumo,
          GITHUB_SHA: SHA,
          // o hash vem do arquivo do evento; o HASH do ambiente é um ISCA que o
          // script não pode ler (a SQL esperada usa o do arquivo)
          GITHUB_EVENT_PATH: arquivoDoEvento(HASH, dir),
          HASH: "f".repeat(64),
          SUBSTITUIR: "false",
          STUB_RESPOSTAS: JSON.stringify(respostas),
          ...env,
        },
        stdout: "piped",
        stderr: "piped",
      }).output();
      const dec = new TextDecoder();
      return {
        codigo: r.code,
        out: dec.decode(r.stdout),
        err: dec.decode(r.stderr),
      };
    };
    const base = `https://api.supabase.com/v1/projects/${REF_SAVY}/database/query`;

    const feliz = await rodar(
      {
        PROJETO: "savy",
        SUPABASE_ACCESS_TOKEN_SAVY: "tk-savy",
        SUPABASE_ACCESS_TOKEN_IKCOUS: "tk-caf",
      },
      [
        { status: 201, corpo: '[{"existia":false}]' },
        { status: 201, corpo: '[{"assinatura_da_loja_definir_chave":""}]' },
        { status: 201, corpo: '[{"bate":true}]' },
      ],
    );
    assertEquals(feliz.codigo, 0, feliz.err);
    const chamadas = feliz.err.split("\n").filter((l) => l.startsWith("STUB "));
    assertEquals(chamadas, [
      `STUB POST ${base} Bearer tk-savy ${SQL_EXISTIA}`,
      `STUB POST ${base} Bearer tk-savy ${sqlDefinir(HASH, false)}`,
      `STUB POST ${base} Bearer tk-savy ${sqlConferir(HASH)}`,
    ]);
    const linhas = feliz.out.trim().split("\n");
    assertEquals(
      linhas[linhas.length - 1],
      `VEREDITO-INSTALAR-CHAVE projeto=savy sha=${SHA} definida=true substituiu=false`,
    );
    assert(!feliz.out.includes(HASH), "o hash não está no stdout");
    assert(!feliz.out.includes("tk-"), "o token não está no stdout");
    const md = Deno.readTextFileSync(resumo);
    assert(!md.includes(HASH) && !md.includes("tk-"), "nem no resumo do run");
    assertStringIncludes(md, "definida");

    // a recusa por chave já definida: exit 1, mensagem clara, veredito falso
    const recusada = await rodar(
      { PROJETO: "savy", SUPABASE_ACCESS_TOKEN_SAVY: "tk-savy" },
      [
        { status: 201, corpo: '[{"existia":true}]' },
        { status: 400, corpo: '{"message":"ERROR: 23505: chave_ja_definida"}' },
      ],
    );
    assertEquals(recusada.codigo, 1);
    assertStringIncludes(recusada.err, JA_DEFINIDA);
    assertStringIncludes(recusada.out, "definida=false substituiu=false");
    Deno.removeSync(dir, { recursive: true });
  },
});

// ------------------------------------------------------------------- MUTANTES

/** Aplica a troca e exige que ela tenha acontecido (senão o mutante é fantasma). */
function mutar(fonte: string, de: string | RegExp, para: string): string {
  const mutante = fonte.replace(de, para);
  assert(mutante !== fonte, `o mutante não mudou nada: ${String(de)}`);
  return mutante;
}

async function exigirVermelhoNoScript(nome: string, mutante: string) {
  let vermelho = false;
  try {
    verificarScript(mutante);
    await verificarComportamento(carregarScript(mutante));
  } catch {
    vermelho = true;
  }
  assert(vermelho, `mutante "${nome}" sobreviveu: o teste não o enxerga`);
}

async function exigirVermelhoNoWorkflow(nome: string, mutante: string) {
  let vermelho = false;
  try {
    await verificarWorkflow(mutante);
  } catch {
    vermelho = true;
  }
  assert(vermelho, `mutante "${nome}" sobreviveu: o teste não o enxerga`);
}

Deno.test({
  name: "mutantes do SCRIPT: cada defeito plantado de volta deixa a verificação VERMELHA",
  ...SEM_SANITIZAR,
  fn: async () => {
    const real = FONTE_SCRIPT();
    const mutantes: Record<string, string> = {
      "aceitar maiúsculas no hash": mutar(
        real,
        "/^[0-9a-f]{64}$/",
        "/^[0-9a-fA-F]{64}$/",
      ),
      "hash sem validação (vai direto para a SQL)": mutar(
        real,
        /if \(typeof hash !== "string" \|\| !HASH_VALIDO\.test\(hash\)\) \{/g,
        "if (false) {",
      ),
      "validar o hash com regex sem âncora de fim": mutar(
        real,
        "/^[0-9a-f]{64}$/",
        "/^[0-9a-f]{64}/",
      ),
      "SQL de escrita com substituir sempre true": mutar(
        real,
        '${substituir ? "true" : "false"}',
        "true",
      ),
      "SQL de escrita sem o segundo argumento": mutar(
        real,
        ', ${substituir ? "true" : "false"})`',
        ")`",
      ),
      "escrever em outra tabela (INSERT direto)": mutar(
        real,
        "`select public.assinatura_da_loja_definir_chave(",
        "`insert into public.assinatura_da_loja_chave values (1, '${hash}') -- (",
      ),
      "hash lido de process.env.HASH em vez do evento": mutar(
        real,
        "hash: lerHashDoEvento(process.env.GITHUB_EVENT_PATH),",
        "hash: process.env.HASH,",
      ),
      "lerHashDoEvento devolve o que vier (sem exigir texto)": mutar(
        real,
        'return typeof hash === "string" ? hash : undefined;',
        "return hash;",
      ),
      "método de escrita (PATCH)": mutar(
        real,
        'method: "POST"',
        'method: "PATCH"',
      ),
      "escrever pelo endpoint read-only": mutar(
        real,
        "/database/query`",
        "/database/query/read-only`",
      ),
      "projeto de texto livre (cai na Savy)": mutar(
        real,
        /const alvo = Object\.hasOwn\(ALVOS, projeto\) \? ALVOS\[projeto\] : null;/,
        "const alvo = ALVOS[projeto] ?? ALVOS.savy;",
      ),
      "segredo do vizinho como reserva": mutar(
        real,
        "const token = env[alvo.segredo];",
        "const token = env[alvo.segredo] || env.SUPABASE_ACCESS_TOKEN_IKCOUS || env.SUPABASE_ACCESS_TOKEN;",
      ),
      "o segredo do alvo trocado (Savy usa o da CAF)": mutar(
        real,
        'segredo: "SUPABASE_ACCESS_TOKEN_SAVY"',
        'segredo: "SUPABASE_ACCESS_TOKEN_IKCOUS"',
      ),
      "siga o redirecionamento": mutar(
        real,
        'redirect: "error"',
        'redirect: "follow"',
      ),
      "imprimir o corpo do erro HTTP": mutar(
        real,
        "const status = Number.isInteger(r.status) ? r.status : 0;",
        "const status = Number.isInteger(r.status) ? r.status : 0; saida.erro(await r.text());",
      ),
      "401/403 não param": mutar(
        real,
        /if \(status === 401 \|\| status === 403\) return/,
        "if (false) return",
      ),
      "chave_ja_definida sem a mensagem clara": mutar(
        real,
        "já existe chave nesta loja: use substituir=true para rotacionar",
        "falhou",
      ),
      "veredito sem conferir a leitura (bate ignorado)": mutar(
        real,
        /if \(conferencia\.valor !== true\) \{/,
        "if (false) {",
      ),
      "escrever sem a leitura prévia sobreviver à falha": mutar(
        real,
        /if \(!previa\.ok\) \{/,
        "if (false) {",
      ),
      "substituiu vira o valor da entrada, não o fato": mutar(
        real,
        "substituiu: trocar && previa.valor === true,",
        "substituiu: trocar,",
      ),
      "hash inteiro no log": mutar(
        real,
        "const resumoDoRun = ",
        "saida.log(`hash ${hash}`); const resumoDoRun = ",
      ),
      "token no log": mutar(
        real,
        "const status = Number.isInteger(r.status) ? r.status : 0;",
        "const status = Number.isInteger(r.status) ? r.status : 0; saida.log(token);",
      ),
      "mensagem do erro de rede vai ao log": mutar(
        real,
        "nome: nomeSeguro(erro)",
        "nome: erro.message",
      ),
      "host por variável de ambiente": mutar(
        real,
        'const API_BASE = "https://api.supabase.com";',
        'const API_BASE = process.env.API_BASE || "https://api.supabase.com";',
      ),
      "veredito mesmo com estado desconhecido": mutar(
        real,
        "ESTADO DESCONHECIDO",
        "VEREDITO-INSTALAR-CHAVE definida=true substituiu=true ESTADO",
      ),
    };
    for (const [nome, mutante] of Object.entries(mutantes)) {
      await exigirVermelhoNoScript(nome, mutante);
    }
  },
});

Deno.test({
  name: "mutantes do WORKFLOW: cada defeito plantado de volta deixa a verificação VERMELHA",
  ...SEM_SANITIZAR,
  fn: async () => {
    const real = FONTE_WORKFLOW();
    const mutantes: Record<string, string> = {
      "pull_request_target como gatilho": mutar(
        real,
        /\non:\n/,
        "\non:\n  pull_request_target:\n    branches: [main]\n",
      ),
      "projeto em texto livre": mutar(real, /type: choice/, "type: string"),
      "opção a mais no projeto (loja)": mutar(
        real,
        /(\n\s+- savy\n)/,
        "$1          - loja\n",
      ),
      "opção a mais no projeto (almeida)": mutar(
        real,
        /(\n\s+- savy\n)/,
        "$1          - almeida\n",
      ),
      "sem expected_sha obrigatório": mutar(
        real,
        /(expected_sha:[\s\S]*?required: )true/,
        "$1false",
      ),
      "sem o passo do expected_sha": mutar(
        real,
        /\n {6}- name: Confere o alvo[\s\S]*?(?=\n {6}- name: Valida o hash)/,
        "",
      ),
      "expected_sha não comparado ao GITHUB_SHA": mutar(
        real,
        /\|\| \[ "\$\{EXPECTED_SHA,,\}" != "\$\{GITHUB_SHA,,\}" \]/,
        "",
      ),
      "hash aceita maiúsculas": mutar(
        real,
        "^[0-9a-f]{64}$",
        "^[0-9a-fA-F]{64}$",
      ),
      "hash sem âncora de fim": mutar(real, "^[0-9a-f]{64}$", "^[0-9a-f]{64}"),
      "hash sem âncora de início": mutar(
        real,
        "^[0-9a-f]{64}$",
        "[0-9a-f]{64}$",
      ),
      "hash de qualquer tamanho": mutar(
        real,
        "^[0-9a-f]{64}$",
        "^[0-9a-f]{1,64}$",
      ),
      "validação do hash só depois do checkout": mutar(
        mutar(
          real,
          /\n {6}- name: Valida o hash[\s\S]*?(?=\n {6}- uses: actions\/checkout)/,
          "",
        ),
        /(\n {6}- uses: actions\/setup-node@[^\n]*\n[^\n]*\n[^\n]*\n)/,
        '$1\n      - name: Valida o hash tarde\n        env:\n          HASH: ${{ inputs.hash }}\n          SUBSTITUIR: ${{ inputs.substituir }}\n        run: |\n          [[ "$HASH" =~ ^[0-9a-f]{64}$ ]] || exit 1\n',
      ),
      "o passo do hash ecoa o valor recusado": mutar(
        real,
        "hash inválido:",
        "hash inválido ($HASH):",
      ),
      "sem validar o booleano substituir": mutar(
        real,
        /case "\$SUBSTITUIR" in true\|false\) ;;/,
        'case "$SUBSTITUIR" in *) ;;',
      ),
      // (o `export LC_ALL=C` do passo do hash e cinto e suspensorio: em nenhum locale
      // desta maquina o intervalo [0-9a-f] casa maiuscula, entao remove-lo nao muda
      // o resultado observavel aqui e nao ha mutante honesto para ele.)
      "Savy cai no segredo da CAF": mutar(
        real,
        /secrets\.SUPABASE_ACCESS_TOKEN_SAVY \|\| ''/,
        "secrets.SUPABASE_ACCESS_TOKEN_SAVY || secrets.SUPABASE_ACCESS_TOKEN_IKCOUS",
      ),
      "a CAF enxerga o segredo da Savy": mutar(
        real,
        /inputs\.projeto == 'ikcous-publicada' && secrets\.SUPABASE_ACCESS_TOKEN_IKCOUS/,
        "inputs.projeto == 'ikcous-publicada' && secrets.SUPABASE_ACCESS_TOKEN_SAVY",
      ),
      "segredo legado no passo": mutar(
        real,
        /(\n\s+PROJETO: \$\{\{ inputs\.projeto \}\}\n\s+SUBSTITUIR: [^\n]*\n\s+run: node)/,
        "\n          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}$1",
      ),
      "permissão de escrita": mutar(real, /contents: read/, "contents: write"),
      "concorrência cancela o que está rodando": mutar(
        real,
        /cancel-in-progress: false/,
        "cancel-in-progress: true",
      ),
      "concorrência única para todas as lojas": mutar(
        real,
        /group: chave-da-loja-\$\{\{ inputs\.projeto \}\}/,
        "group: chave-da-loja",
      ),
      "entrada interpolada num run:": mutar(
        real,
        /run: node scripts\/publicacao\/instalar-chave-da-loja\.cjs/,
        "run: HASH=${{ inputs.hash }} node scripts/publicacao/instalar-chave-da-loja.cjs",
      ),
      "checkout guarda a credencial": mutar(
        real,
        /persist-credentials: false/,
        "persist-credentials: true",
      ),
      "ação sem pin por SHA": mutar(
        real,
        /actions\/checkout@[0-9a-f]{40}[^\n]*/,
        "actions/checkout@v4",
      ),
      "run-name com o hash inteiro": mutar(
        real,
        /(run-name: "[^"\n]*)"/,
        '$1 hash ${{ inputs.hash }}"',
      ),
      "função inexistente no Actions (substr) numa variável": mutar(
        real,
        "SUBSTITUIR: ${{ inputs.substituir }}",
        "SUBSTITUIR: ${{ substr(inputs.substituir, 0, 4) }}",
      ),
      "hash volta a passar por env: no passo da validação": mutar(
        real,
        "SUBSTITUIR: ${{ inputs.substituir }}",
        "SUBSTITUIR: ${{ inputs.substituir }}\n          HASH: ${{ inputs.hash }}",
      ),
      "hash por env: no passo do script": mutar(
        real,
        /(\n\s+SUBSTITUIR: [^\n]*\n)(\s+run: node)/,
        "$1          HASH: ${{ inputs.hash }}\n$2",
      ),
      "sem o add-mask do hash": mutar(
        real,
        /\n\s+while IFS=[\s\S]*?done <<< "\$HASH"/,
        "",
      ),
      "add-mask só depois da validação": mutar(
        mutar(real, /\n\s+while IFS=[\s\S]*?done <<< "\$HASH"/, ""),
        /(sem espaço nem maiúsculas"; exit 1\n\s+fi\n)/,
        '$1          echo "::add-mask::$HASH"\n',
      ),
      "hash lido sem preservar a quebra de linha final": mutar(
        real,
        "; printf x)",
        ")",
      ),
      "hash não lido do arquivo do evento": mutar(
        real,
        '"$GITHUB_EVENT_PATH"',
        "/dev/null",
      ),
      "run-name sem o projeto": mutar(
        real,
        /run-name: .*\n/,
        'run-name: "instalar chave"\n',
      ),
      "substituir ligado por padrão": mutar(
        real,
        /(substituir:[\s\S]*?default: )false/,
        "$1true",
      ),
      "permitir_reaplicar escondido": mutar(
        real,
        /(\n {6}expected_sha:)/,
        "\n      permitir_reaplicar:\n        type: boolean\n        default: false$1",
      ),
      "timeout longo demais": mutar(
        real,
        /timeout-minutes: \d+/,
        "timeout-minutes: 360",
      ),
    };
    for (const [nome, mutante] of Object.entries(mutantes)) {
      await exigirVermelhoNoWorkflow(nome, mutante);
    }
  },
});

Deno.test("o teste não é vazio: o verificador de comportamento RECUSA um módulo falso", async () => {
  await assertRejects(() =>
    verificarComportamento({
      instalar: () => Promise.resolve(0),
    }),
  );
});
