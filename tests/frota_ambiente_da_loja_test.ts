// @ts-nocheck
/* eslint-disable security/detect-object-injection, security/detect-non-literal-require, security/detect-unsafe-regex -- teste: as chaves vêm do cadastro (real ou de fixture) e de constantes deste arquivo; os require são de arquivos fixos do repositório; as regex têm âncoras e rodam sobre arquivos fixos do repositório. */
/**
 * O TOKEN DE CADA LOJA OAUTH MORA NA GAVETA DA LOJA (26/11/2026).
 *
 * O repositório guarda no máximo 100 segredos; um GitHub Environment guarda mais
 * 100 cada, e o repositório aceitou 310 environments. Por isso o token OAuth de
 * cada loja sai do nível do repositório e vai para um environment `loja-<projeto>`
 * com o MESMO nome de segredo (plano PLANO-AMBIENTE-POR-LOJA-26-11, T7/T8). Um job
 * só enxerga o segredo de um environment se DECLARAR esse environment
 * (`jobs.<id>.environment`); sem a declaração, a linha gerada
 * `inputs.projeto == 'x' && secrets.NOME || ''` lê vazio e a loja OAuth para em
 * "sem acesso legítimo".
 *
 * O que a documentação do GitHub garante (citado no relatório do T7):
 *  - `name` aceita expressão com `inputs` e `matrix`;
 *  - `deployment: false` usa os segredos do environment sem criar deployment;
 *  - environment que não existe é CRIADO na execução, sem regra de proteção nem
 *    segredo — e o segredo do environment ganha do segredo de repositório com o
 *    mesmo nome (o de nível mais baixo vence). IKCOUS e Savy, que seguem com o
 *    segredo no repositório, continuam lendo-o pela gaveta vazia.
 *
 * O QUE ESTES TESTES MEDEM, nos 8 workflows por loja:
 *  1. Todo job que tem um bloco gerado `# LOJAS-SEGREDO*`, ou que lê
 *     `secrets.<token de loja OAuth>` (o `segredoDoToken` das assinantes com
 *     `acesso: "oauth"` no cadastro, as mesmas que o gerador escreve), declara
 *     `environment: { name: loja-${{ inputs.projeto }}, deployment: false }`
 *     (ou `matrix.<x>` se o job roda numa matriz); e esse conjunto é exatamente
 *     JOBS_COM_AMBIENTE.
 *  2. Nenhum job declara environment com nome fixo (ou em forma de texto).
 *  3. Nenhum job fora de JOBS_COM_AMBIENTE ganhou environment.
 *  E, com um cadastro de fixture que marca a Savy como OAuth, a regra 1 acha os
 *  jobs pelo segredo (não só pelo marcador) e acusa um job que lê o token sem a
 *  gaveta.
 */
import { createRequire } from "node:module";
import { parse } from "https://deno.land/std@0.177.0/encoding/yaml.ts";
import { fromFileUrl, join } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const DIR_WF = join(RAIZ, ".github/workflows");
const lojasMod = require(join(RAIZ, "scripts/frota/lojas.cjs"));
const CADASTRO_REAL = lojasMod.carregarLojas();

const OITO_WORKFLOWS = [
  "aplicar-migrations.yml",
  "conferir-banco-da-loja.yml",
  "publicar-functions.yml",
  "instalar-chave-da-loja.yml",
  "medir-auth-da-loja.yml",
  "ativar-email-do-login.yml",
  "ativar-google-do-login.yml",
  "login-da-loja.yml",
];

/** Os jobs que leem o token da loja pedida e por isso abrem a gaveta dela. */
const JOBS_COM_AMBIENTE = [
  ["aplicar-migrations.yml", "aplicar"],
  ["conferir-banco-da-loja.yml", "conferir"],
  ["conferir-banco-da-loja.yml", "ledger"],
  ["publicar-functions.yml", "publicar"],
  ["instalar-chave-da-loja.yml", "instalar"],
  ["medir-auth-da-loja.yml", "medir"],
  ["ativar-email-do-login.yml", "email"],
  ["ativar-google-do-login.yml", "google"],
  ["login-da-loja.yml", "login"],
].map(([wf, job]) => `${wf}:${job}`);

/** A forma EXATA do nome: loja- + UMA referência a inputs.projeto ou matrix.<x>. */
const RE_NOME_DA_GAVETA =
  /^loja-\$\{\{ (inputs\.projeto|matrix\.[a-z_]+) \}\}$/;

const textoDe = (nome: string) => Deno.readTextFileSync(join(DIR_WF, nome));

/** Os segredos de token das lojas OAuth de um cadastro (os nomes que o gerador escreve). */
function segredosOAuth(cadastro) {
  return Object.values(cadastro.lojas)
    .filter((l: any) => l.acesso === lojasMod.ACESSO_OAUTH)
    .map((l: any) => l.segredoDoToken);
}

/**
 * O TEXTO de cada job (o YAML parseado perde os comentários, e o marcador é
 * comentário): do `  <id>:` ao próximo job ou chave do topo.
 */
function textosDosJobs(texto: string): Map<string, string> {
  const linhas = texto.split(/\r?\n/);
  const inicio = linhas.findIndex((l) => /^jobs:\s*$/.test(l));
  if (inicio < 0) throw new Error("workflow sem `jobs:`");
  const jobs = new Map<string, string>();
  let atual: string | null = null;
  let corpo: string[] = [];
  const fechar = () => {
    if (atual !== null) jobs.set(atual, corpo.join("\n"));
  };
  for (const l of linhas.slice(inicio + 1)) {
    if (/^\S/.test(l)) break; // próxima chave do topo
    const m = /^ {2}([A-Za-z0-9_-]+):\s*(#.*)?$/.exec(l);
    if (m) {
      fechar();
      atual = m[1];
      corpo = [];
    } else corpo.push(l);
  }
  fechar();
  return jobs;
}

/** Os jobs (wf:id) que precisam da gaveta: marcador gerado ou token OAuth lido. */
function jobsQuePrecisamDaGaveta(
  nome: string,
  texto: string,
  oauth: string[],
): string[] {
  const achados = [];
  for (const [id, corpo] of textosDosJobs(texto)) {
    const temMarcador = /#\s*LOJAS-SEGREDO/.test(corpo);
    // Os nomes lidos por `secrets.<NOME>` (NOME inteiro: _IKCOUS não casa _IKCOUS_2).
    const lidos = [...corpo.matchAll(/\bsecrets\.([A-Za-z0-9_]+)/g)].map(
      (m) => m[1],
    );
    const leOAuth = lidos.some((s) => oauth.includes(s));
    if (temMarcador || leOAuth) achados.push(`${nome}:${id}`);
  }
  return achados;
}

/** Por que o environment de um job não é a gaveta certa (null = está certo). */
function defeitoDaGaveta(job: any): string | null {
  const env = job.environment;
  if (env === undefined || env === null) return "sem environment";
  if (typeof env !== "object" || Array.isArray(env))
    return `environment em forma de texto (${String(env)}), sem deployment: false`;
  const chaves = Object.keys(env).sort();
  if (chaves.join(",") !== "deployment,name")
    return `environment com chaves ${chaves.join(",")} (esperado: name e deployment)`;
  if (env.deployment !== false) return "deployment não é false";
  const m = RE_NOME_DA_GAVETA.exec(String(env.name));
  if (!m) return `nome fora da forma loja-\${{ ... }}: ${env.name}`;
  const naMatriz = job.strategy?.matrix !== undefined;
  if (naMatriz && !m[1].startsWith("matrix."))
    return "job em matriz precisa do nome pela variável da matriz";
  if (!naMatriz && m[1] !== "inputs.projeto")
    return "job sem matriz precisa do nome por inputs.projeto";
  return null;
}

/** Todas as violações das três regras, num conjunto de workflows. */
function violacoes(
  arquivos: { nome: string; texto: string }[],
  oauth: string[],
  lista: string[],
): string[] {
  const erros = [];
  for (const { nome, texto } of arquivos) {
    const doc = parse(texto) as any;
    const ids = Object.keys(doc.jobs ?? {}).sort();
    const fatiados = [...textosDosJobs(texto).keys()].sort();
    if (ids.join(",") !== fatiados.join(","))
      erros.push(`${nome}: o fatiador de jobs não bate com o YAML`);
    const precisam = jobsQuePrecisamDaGaveta(nome, texto, oauth);
    for (const id of ids) {
      const chave = `${nome}:${id}`;
      const job = doc.jobs[id];
      const tem = job.environment !== undefined;
      if (precisam.includes(chave) && !lista.includes(chave))
        erros.push(
          `${chave}: lê token de loja e não está em JOBS_COM_AMBIENTE`,
        );
      if (precisam.includes(chave) || lista.includes(chave)) {
        const d = defeitoDaGaveta(job);
        if (d) erros.push(`${chave}: ${d}`);
      } else if (tem) {
        erros.push(`${chave}: ganhou environment fora da lista`);
      }
      if (tem && !RE_NOME_DA_GAVETA.test(String(job.environment?.name)))
        erros.push(`${chave}: environment com nome fixo`);
    }
  }
  return erros;
}

const arquivosReais = () =>
  OITO_WORKFLOWS.map((nome) => ({ nome, texto: textoDe(nome) }));

// ---------------------------------------------------------------------------
Deno.test("os jobs que leem token de loja são exatamente JOBS_COM_AMBIENTE (marcador gerado ou token OAuth do cadastro)", () => {
  const oauth = segredosOAuth(CADASTRO_REAL);
  const precisam = arquivosReais().flatMap(({ nome, texto }) =>
    jobsQuePrecisamDaGaveta(nome, texto, oauth),
  );
  assertEquals(precisam.sort(), [...JOBS_COM_AMBIENTE].sort());
});

Deno.test("todo job da lista abre a gaveta loja-${{ inputs.projeto }} com deployment: false; nenhum nome fixo; nenhum job fora da lista ganhou environment", () => {
  assertEquals(
    violacoes(arquivosReais(), segredosOAuth(CADASTRO_REAL), JOBS_COM_AMBIENTE),
    [],
  );
});

Deno.test("o fatiador acha todos os jobs de cada um dos 8 workflows", () => {
  for (const { nome, texto } of arquivosReais()) {
    const ids = Object.keys((parse(texto) as any).jobs).sort();
    assert(ids.length > 0, nome);
    assertEquals([...textosDosJobs(texto).keys()].sort(), ids, nome);
  }
});

// ---------------------------------------------------------------------------
// Fixture: a regra pega o job pelo SEGREDO OAuth, não só pelo marcador.
// ---------------------------------------------------------------------------
function cadastroComSavyOAuth() {
  const j = JSON.parse(
    Deno.readTextFileSync(join(RAIZ, "scripts/frota/lojas.json")),
  );
  j.lojas.savy.acesso = lojasMod.ACESSO_OAUTH;
  return lojasMod.validarCadastro(j);
}

const WF_FIXTURE = `name: fixture
on:
  workflow_dispatch:
jobs:
  sem-marcador:
    runs-on: ubuntu-latest
    steps:
      - run: echo
        env:
          T: \${{ secrets.SUPABASE_ACCESS_TOKEN_SAVY }}
  inofensivo:
    runs-on: ubuntu-latest
    steps:
      - run: echo
`;

Deno.test("fixture com a Savy OAuth: o job que lê o token dela SEM marcador e SEM gaveta é acusado", () => {
  const oauth = segredosOAuth(cadastroComSavyOAuth());
  assertEquals(oauth, ["SUPABASE_ACCESS_TOKEN_SAVY"]);
  const erros = violacoes(
    [{ nome: "fixture.yml", texto: WF_FIXTURE }],
    oauth,
    [],
  );
  assertEquals(erros, [
    "fixture.yml:sem-marcador: lê token de loja e não está em JOBS_COM_AMBIENTE",
    "fixture.yml:sem-marcador: sem environment",
  ]);
  // No cadastro real (Savy no CLI), o mesmo job não precisa de gaveta.
  assertEquals(
    violacoes(
      [{ nome: "fixture.yml", texto: WF_FIXTURE }],
      segredosOAuth(CADASTRO_REAL),
      [],
    ),
    [],
  );
});

Deno.test("fixture com a Savy OAuth: os 8 workflows reais já abrem a gaveta em todo job que lê o token dela", () => {
  assertEquals(
    violacoes(
      arquivosReais(),
      segredosOAuth(cadastroComSavyOAuth()),
      JOBS_COM_AMBIENTE,
    ),
    [],
  );
});

Deno.test("fixture: nome fixo, forma de texto, deployment ausente e job em matriz por inputs são recusados", () => {
  const casos = [
    [{ environment: "loja-savy" }, /forma de texto/],
    [{ environment: { name: "loja-savy", deployment: false } }, /nome fora/],
    [{ environment: { name: "loja-${{ inputs.projeto }}" } }, /chaves name/],
    [
      { environment: { name: "loja-${{ inputs.projeto }}", deployment: true } },
      /deployment não é false/,
    ],
    [
      {
        strategy: { matrix: { loja: ["a"] } },
        environment: { name: "loja-${{ inputs.projeto }}", deployment: false },
      },
      /variável da matriz/,
    ],
  ];
  for (const [job, re] of casos) {
    const d = defeitoDaGaveta(job);
    assert(
      d !== null && (re as RegExp).test(d),
      `${JSON.stringify(job)} → ${d}`,
    );
  }
  assertEquals(
    defeitoDaGaveta({
      strategy: { matrix: { loja: ["a"] } },
      environment: { name: "loja-${{ matrix.loja }}", deployment: false },
    }),
    null,
  );
});
