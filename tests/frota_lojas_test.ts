// @ts-nocheck
/* eslint-disable security/detect-object-injection, security/detect-non-literal-require -- teste: chaves vêm de constantes e do cadastro de fixture; os caminhos são da árvore temporária criada aqui. */
/**
 * O CADASTRO DE LOJAS como dado (scripts/frota/lojas.json, lido por
 * scripts/frota/lojas.cjs) e os 8 workflows + 6 scripts que antes tinham a lista
 * de lojas e o nome de cada segredo escritos à mão (25/11/2026).
 *
 * O QUE ESTES TESTES MEDEM:
 *  1. O cadastro de hoje é EXATAMENTE o que os workflows tinham: mesmos refs,
 *     mesmos nomes de segredo, mesmas classes (loja, sandbox, ikcous-publicada,
 *     savy) — o comportamento de IKCOUS, Savy e dos alvos de teste não muda.
 *  2. O validador do cadastro falha FECHADO: ref torto, nome de segredo fora do
 *     regex, segredo repetido, assinante com o segredo legado, chave `__proto__`…
 *  3. "LOJA NOVA SÓ POR DADO": com um cadastro de fixture que tem uma loja inventada
 *     (`loja-teste-xyz`), os 6 scripts e os 8 workflows a aceitam sem NENHUMA outra
 *     edição (os workflows ganham só a linha de segredo GERADA, e o gerador
 *     devolve o arquivo idêntico ao de hoje quando a loja sai); e uma loja ausente
 *     do cadastro é recusada ("loja desconhecida") antes de qualquer segredo.
 *  4. REGRA DA CASA: nenhum workflow lê outro segredo de loja além do da loja
 *     escolhida — todo `secrets.SUPABASE_ACCESS_TOKEN*` tem a guarda da SUA loja
 *     (inline ou no `if` do passo), e nenhum workflow usa `secrets[...]`,
 *     `toJSON(secrets)` nem `secrets: inherit` (que entregariam TODOS os segredos
 *     do repositório ao job: ver o cabeçalho de scripts/frota/lojas-nos-workflows.cjs).
 *  5. O YAML dos workflows está em sincronia com o cadastro (o gerador, rodado de
 *     novo, não muda nada) e os dois cadastros da frota concordam.
 */
import { createRequire } from "node:module";
import { parse } from "https://deno.land/std@0.177.0/encoding/yaml.ts";
import { fromFileUrl, join } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const LOJAS_CJS = join(RAIZ, "scripts/frota/lojas.cjs");
const GERADOR_CJS = join(RAIZ, "scripts/frota/lojas-nos-workflows.cjs");
const DIR_WF = join(RAIZ, ".github/workflows");
const SEM_SANITIZAR = { sanitizeOps: false, sanitizeResources: false };

const lojasMod = require(LOJAS_CJS);
const gerador = require(GERADOR_CJS);
const CADASTRO_REAL = lojasMod.carregarLojas();

// As listas esperadas saem do cadastro (loja nova entra por dado, sem editar
// teste); a IKCOUS e a cliente real nunca somem de uma delas sem reprovar.
const AS_QUATRO_DE_SEMPRE = ["loja", "sandbox", "ikcous-publicada", "savy"];
function exigirIkcousESavy(lista: string[], onde: string) {
  for (const p of ["ikcous-publicada", "savy"])
    assert(lista.includes(p), `${onde}: ${p} sumiu (${lista.join(", ")})`);
}

// O 8º (login-da-loja.yml, 26/11/2026) nasceu já gerado do cadastro.
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

// A loja INVENTADA da fixture: ref, segredo e nome que não existem em lugar nenhum.
const NOVA = "loja-teste-xyz";
const REF_NOVA = "abcdefghijklmnopqrst";
const SEGREDO_NOVO = "SUPABASE_ACCESS_TOKEN_LOJA_TESTE_XYZ";
const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

const jsonDeHoje = () =>
  JSON.parse(Deno.readTextFileSync(join(RAIZ, "scripts/frota/lojas.json")));
function jsonComLojaNova() {
  const j = jsonDeHoje();
  j.lojas[NOVA] = {
    ref: REF_NOVA,
    classe: "assinante",
    apelido: "Loja Teste",
    segredoDoToken: SEGREDO_NOVO,
    functionsNomeadas: false,
  };
  return j;
}
const cadastroComLojaNova = () => lojasMod.validarCadastro(jsonComLojaNova());

const semComentarios = (yaml: string) =>
  yaml
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

async function bash(script: string, env: Record<string, string>, cwd = RAIZ) {
  const r = await new Deno.Command("bash", {
    args: ["-c", script],
    cwd,
    env: { PATH: Deno.env.get("PATH") ?? "", ...env },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const dec = new TextDecoder();
  return { codigo: r.code, saida: dec.decode(r.stdout) + dec.decode(r.stderr) };
}

/** O corpo do `run:` do passo (por prefixo do `name`), do YAML parseado. */
function runDoPasso(doc: any, prefixo: string): string {
  for (const job of Object.values(doc.jobs) as any[])
    for (const p of job.steps ?? [])
      if (String(p.name ?? "").startsWith(prefixo)) return p.run;
  throw new Error(`passo não achado: ${prefixo}`);
}
const docDe = (nome: string) =>
  parse(Deno.readTextFileSync(join(DIR_WF, nome)));

// ---------------------------------------------------------------------------
// 1. O cadastro de hoje é o que os workflows tinham
// ---------------------------------------------------------------------------
Deno.test("o cadastro de hoje: loja, sandbox, ikcous-publicada e savy, com os refs, segredos e classes de sempre", () => {
  const l = CADASTRO_REAL.lojas;
  // 26/11/2026: a lista sai do cadastro (loja nova entra por dado, sem editar
  // este teste). Fixo continua: os dois legados primeiro e só eles (loja nova
  // nunca é `legado`), e as quatro de sempre com os mesmos refs e segredos.
  const assinantesDoCadastro = lojasMod
    .assinantes(CADASTRO_REAL)
    .map((x) => x.projeto);
  exigirIkcousESavy(assinantesDoCadastro, "assinantes do cadastro");
  assertEquals(Object.keys(l), ["loja", "sandbox", ...assinantesDoCadastro]);
  const refs = lojasMod.refsPorProjeto(CADASTRO_REAL);
  assertEquals(Object.keys(refs), Object.keys(l));
  assertEquals(
    Object.fromEntries(AS_QUATRO_DE_SEMPRE.map((p) => [p, refs[p]])),
    {
      loja: "cafkrminfnokvgjqtkle",
      sandbox: "lofznuxcvezrhxsgjqyg",
      "ikcous-publicada": "cafkrminfnokvgjqtkle",
      savy: "gnjsrucsmjkajijrakzr",
    },
  );
  assertEquals(l.loja.refDasFunctions, "dekxabvqdsuukijblazl");
  assertEquals(l.sandbox.refDasFunctions, "lofznuxcvezrhxsgjqyg");
  assertEquals(l["ikcous-publicada"].refDasFunctions, "cafkrminfnokvgjqtkle");
  assertEquals(l.savy.refDasFunctions, "gnjsrucsmjkajijrakzr");
  assertEquals(
    AS_QUATRO_DE_SEMPRE.map((p) => [
      l[p].projeto,
      l[p].classe,
      l[p].segredoDoToken,
    ]),
    [
      ["loja", "legado", "SUPABASE_ACCESS_TOKEN"],
      ["sandbox", "legado", "SUPABASE_ACCESS_TOKEN"],
      ["ikcous-publicada", "assinante", "SUPABASE_ACCESS_TOKEN_IKCOUS"],
      ["savy", "assinante", "SUPABASE_ACCESS_TOKEN_SAVY"],
    ],
  );
  // as oito functions nomeadas: IKCOUS e Savy, como antes, e nunca um legado
  // (a loja nova decide a sua no cadastro)
  const comNomeadas = Object.values(l)
    .filter((x) => x.functionsNomeadas)
    .map((x) => x.projeto);
  exigirIkcousESavy(comNomeadas, "functionsNomeadas");
  for (const leg of ["loja", "sandbox"])
    assert(!comNomeadas.includes(leg), `${leg} não tem functions nomeadas`);
  // o alvo dos scripts: só as assinantes, e o texto de parada de sempre
  const alvos = lojasMod.alvosDasAssinantes(CADASTRO_REAL);
  assertEquals(Object.keys(alvos), assinantesDoCadastro);
  assertEquals(
    {
      "ikcous-publicada": alvos["ikcous-publicada"],
      savy: alvos.savy,
    },
    {
      "ikcous-publicada": {
        segredo: "SUPABASE_ACCESS_TOKEN_IKCOUS",
        semAcesso:
          "sem acesso legítimo à CAF por SUPABASE_ACCESS_TOKEN_IKCOUS — bloqueio concreto",
      },
      savy: {
        segredo: "SUPABASE_ACCESS_TOKEN_SAVY",
        semAcesso:
          "sem acesso legítimo à Savy por SUPABASE_ACCESS_TOKEN_SAVY — bloqueio concreto",
      },
    },
  );
});

Deno.test("os cadastros da frota concordam: todo canal de canais-de-backend.json é uma loja assinante do lojas.json, no mesmo ref e alvo", () => {
  const canais = JSON.parse(
    Deno.readTextFileSync(join(RAIZ, "scripts/frota/canais-de-backend.json")),
  ).canais;
  assert(Object.keys(canais).length >= 2);
  for (const [ref, c] of Object.entries(canais)) {
    for (const alvo of [c.migrations, c.functions]) {
      const loja = lojasMod.lojaDoProjeto(alvo, CADASTRO_REAL);
      assert(loja, `canal ${ref}: alvo ${alvo} não está no lojas.json`);
      assertEquals(loja.classe, "assinante");
      assertEquals(loja.ref, ref, `canal ${ref}: ref diferente do lojas.json`);
      assertEquals(loja.refDasFunctions, ref);
    }
    // as oito nomeadas valem no workflow só onde o canal as publica
    const nomeadas = [
      "send-order-confirmation",
      "calculate-shipping",
      "notify-new-order",
      "send-otp-email",
      "melhor-envio-etiqueta",
      "send-push",
      "credenciais-email",
      "auth-send-email",
    ];
    const publica = nomeadas.every((n) => c.functionsPublicaveis.includes(n));
    assertEquals(
      lojasMod.lojaDoProjeto(c.functions, CADASTRO_REAL).functionsNomeadas,
      publica,
      `canal ${ref}: functionsNomeadas do lojas.json e functionsPublicaveis do canal divergem`,
    );
  }
});

// ---------------------------------------------------------------------------
// 2. O validador falha fechado
// ---------------------------------------------------------------------------
Deno.test("validarCadastro recusa cadastro torto (fecha em falha, nunca vira lista vazia)", () => {
  const ruim = (alterar: (j: any) => void, trecho: string) => {
    const j = jsonComLojaNova();
    alterar(j);
    let msg = "";
    try {
      lojasMod.validarCadastro(j);
    } catch (e) {
      msg = e.message;
    }
    assertStringIncludes(msg, trecho);
  };
  ruim(
    (j) => (j.lojas[NOVA].ref = "ABCDEFGHIJKLMNOPQRST"),
    "ref precisa casar",
  );
  ruim((j) => (j.lojas[NOVA].ref = "abc"), "ref precisa casar");
  ruim(
    (j) => (j.lojas[NOVA].segredoDoToken = "VERCEL_TOKEN"),
    "segredoDoToken precisa casar",
  );
  ruim(
    (j) => (j.lojas[NOVA].segredoDoToken = "SUPABASE_ACCESS_TOKEN_x"),
    "segredoDoToken precisa casar",
  );
  ruim(
    (j) => (j.lojas[NOVA].segredoDoToken = "SUPABASE_ACCESS_TOKEN_A-B"),
    "segredoDoToken precisa casar",
  );
  ruim(
    (j) => (j.lojas[NOVA].segredoDoToken = "SUPABASE_ACCESS_TOKEN"),
    "segredo PRÓPRIO",
  );
  ruim(
    (j) => (j.lojas[NOVA].segredoDoToken = "SUPABASE_ACCESS_TOKEN_SAVY"),
    "já é de savy",
  );
  ruim(
    (j) => (j.lojas[NOVA].ref = "gnjsrucsmjkajijrakzr"),
    "um banco, uma loja",
  );
  ruim(
    (j) => (j.lojas[NOVA].classe = "legado"),
    "classe legado usa só o segredo",
  );
  ruim((j) => (j.lojas[NOVA].classe = "teste"), "classe precisa ser");
  ruim(
    (j) => (j.lojas[NOVA].functionsNomeadas = undefined),
    "functionsNomeadas",
  );
  ruim((j) => (j.lojas[NOVA].extra = 1), "campo desconhecido");
  ruim((j) => (j.lojas["Loja Nova"] = j.lojas[NOVA]), "fora do formato");
  ruim((j) => (j.lojas.x = j.lojas[NOVA]), "fora do formato");
  ruim(
    (j) => (j.lojas[`${NOVA}\n::error::x`] = j.lojas[NOVA]),
    "fora do formato",
  );
  ruim((j) => (j.lojas = {}), "vazio");
  ruim((j) => (j.lojas = []), "precisa ser um objeto");
  ruim(
    (j) => (j.lojas.loja.segredoDoToken = "SUPABASE_ACCESS_TOKEN_LEGADO2"),
    "classe legado usa só",
  );
  let msg = "";
  try {
    lojasMod.validarCadastro(null);
  } catch (e) {
    msg = e.message;
  }
  assertStringIncludes(msg, "raiz");
  // JSON torto no disco também falha fechado
  const dir = Deno.makeTempDirSync({ prefix: "lojas-" });
  Deno.writeTextFileSync(join(dir, "lojas.json"), "{ nao e json");
  let lancou = false;
  try {
    lojasMod.carregarLojas(join(dir, "lojas.json"));
  } catch {
    lancou = true;
  }
  assert(lancou);
  Deno.removeSync(dir, { recursive: true });
});

Deno.test("lojaDoProjeto: só chaves do cadastro (nada de __proto__, constructor, maiúsculas, espaço, vazio, não texto)", () => {
  for (const ok of ["loja", "sandbox", "ikcous-publicada", "savy"])
    assert(lojasMod.lojaDoProjeto(ok, CADASTRO_REAL), ok);
  for (const ruim of [
    "__proto__",
    "constructor",
    "toString",
    "hasOwnProperty",
    "SAVY",
    "Savy",
    "savy ",
    " savy",
    "savy\n",
    "ikcous",
    "almeida",
    "",
    undefined,
    null,
    42,
    ["savy"],
    { toString: () => "savy" },
  ])
    assertEquals(
      lojasMod.lojaDoProjeto(ruim, CADASTRO_REAL),
      null,
      String(ruim),
    );
});

// ---------------------------------------------------------------------------
// o CLI dos passos de workflow
// ---------------------------------------------------------------------------
function cli(args: string[], env = {}, cad = CADASTRO_REAL) {
  const out: string[] = [];
  const codigo = lojasMod.cli(args, {
    saida: { out: (l) => out.push(l), err: (l) => out.push(l) },
    cadastro: cad,
    env,
  });
  return { codigo, texto: out.join("\n") };
}

Deno.test("CLI: validar aceita só o cadastro, recusa com 'loja desconhecida' e sanea o texto de quem chamou", () => {
  assertEquals(cli(["validar", "savy"]).codigo, 0);
  assertEquals(cli(["validar", "loja"]).codigo, 0);
  assertEquals(cli(["validar", "savy", "--assinante"]).codigo, 0);
  const naoAssinante = cli(["validar", "loja", "--assinante"]);
  assertEquals(naoAssinante.codigo, 1);
  assertStringIncludes(naoAssinante.texto, "não é loja assinante");
  const r = cli(["validar", "almeida"]);
  assertEquals(r.codigo, 1);
  assertStringIncludes(r.texto, "::error::loja desconhecida");
  assertStringIncludes(r.texto, "projeto desconhecido: almeida");
  // uma quebra de linha no input não pode forjar comando de workflow no log
  const forja = cli(["validar", "x\n::add-mask::segredo\n::set-env name=A::b"]);
  assertEquals(forja.codigo, 1);
  assertEquals(forja.texto.split("\n").length, 1, "uma linha só");
  assert(!forja.texto.includes("\n::"));
  assert(!/::add-mask::|::set-env/.test(forja.texto));
  assertEquals(cli(["validar", ""]).codigo, 1);
  assertEquals(cli(["validar"]).codigo, 1);
  assertEquals(cli(["validar", "__proto__"]).codigo, 1);
  assertEquals(cli(["comando-que-nao-existe", "savy"]).codigo, 1);
  // o ref vem do cadastro (e o das functions da `loja` é o antigo DEK)
  assertEquals(cli(["ref", "savy"]).texto, "gnjsrucsmjkajijrakzr");
  assertEquals(cli(["ref", "loja"]).texto, "cafkrminfnokvgjqtkle");
  assertEquals(
    cli(["ref", "loja", "--functions"]).texto,
    "dekxabvqdsuukijblazl",
  );
  // campo: lista fechada
  assertEquals(
    cli(["campo", "savy", "segredoDoToken"]).texto,
    "SUPABASE_ACCESS_TOKEN_SAVY",
  );
  assertEquals(cli(["campo", "savy", "classe"]).texto, "assinante");
  assertEquals(cli(["campo", "loja", "functionsNomeadas"]).texto, "false");
  assertEquals(
    cli(["campo", "savy", "ref"]).codigo,
    1,
    "ref não é campo consultável",
  );
  assertEquals(cli(["campo", "savy", "__proto__"]).codigo, 1);
});

Deno.test("CLI exigir-segredo: só o token DA LOJA conta, a mensagem de parada é a de sempre e o valor nunca é impresso", () => {
  const tk = "tk-segredo-que-nao-pode-vazar";
  const ok = cli(["exigir-segredo", "savy"], {
    SUPABASE_ACCESS_TOKEN_SAVY: tk,
  });
  assertEquals(ok.codigo, 0);
  assert(!ok.texto.includes(tk));
  // o da CAF e o legado presentes NÃO servem a Savy
  const sem = cli(["exigir-segredo", "savy"], {
    SUPABASE_ACCESS_TOKEN: tk,
    SUPABASE_ACCESS_TOKEN_IKCOUS: tk,
  });
  assertEquals(sem.codigo, 1);
  assertStringIncludes(
    sem.texto,
    "sem acesso legítimo à Savy por SUPABASE_ACCESS_TOKEN_SAVY — bloqueio concreto",
  );
  assertStringIncludes(
    cli(["exigir-segredo", "ikcous-publicada"], {}).texto,
    "sem acesso legítimo à CAF por SUPABASE_ACCESS_TOKEN_IKCOUS — bloqueio concreto",
  );
  const leg = cli(["exigir-segredo", "loja"], {
    SUPABASE_ACCESS_TOKEN_SAVY: tk,
  });
  assertEquals(leg.codigo, 1);
  assertStringIncludes(leg.texto, "segredo SUPABASE_ACCESS_TOKEN ausente");
  assertEquals(
    cli(["exigir-segredo", "loja"], { SUPABASE_ACCESS_TOKEN: tk }).codigo,
    0,
  );
  assertEquals(
    cli(["exigir-segredo", "savy"], { SUPABASE_ACCESS_TOKEN_SAVY: "" }).codigo,
    1,
  );
  // loja desconhecida: recusa ANTES de olhar qualquer segredo
  const desc = cli(["exigir-segredo", "almeida"], {
    SUPABASE_ACCESS_TOKEN: tk,
  });
  assertEquals(desc.codigo, 1);
  assertStringIncludes(desc.texto, "loja desconhecida");
});

// ---------------------------------------------------------------------------
// A marca `acesso: "oauth"` (plano do portão OAuth, T1, 26/11/2026): a loja
// aberta pelo nova-loja só tem acesso OAuth (refresh no cofre do PC do dono). O
// campo só vale em assinante, o único valor escrito é "oauth", e sem ele a
// normalização devolve "cli" — IKCOUS, Savy e os alvos de teste seguem iguais.
// ---------------------------------------------------------------------------
const NOVA_OAUTH = "loja-oauth-xyz";
const REF_OAUTH = "zyxwvutsrqponmlkjihg";
const SEGREDO_OAUTH = "SUPABASE_ACCESS_TOKEN_LOJA_OAUTH_XYZ";
/** O cadastro de hoje + uma loja OAuth nova (sem `comAcesso`, a mesma loja sem o campo). */
function jsonComLojaOAuth(comAcesso = true) {
  const j = jsonDeHoje();
  j.lojas[NOVA_OAUTH] = {
    ref: REF_OAUTH,
    classe: "assinante",
    apelido: "Loja OAuth",
    segredoDoToken: SEGREDO_OAUTH,
    functionsNomeadas: true,
    ...(comAcesso ? { acesso: "oauth" } : {}),
  };
  return j;
}
const msgDe = (j: any) => {
  try {
    lojasMod.validarCadastro(j);
  } catch (e) {
    return e.message;
  }
  return "";
};

Deno.test("acesso: 'oauth' vale numa loja assinante e sai na normalização", () => {
  const cad = lojasMod.validarCadastro(jsonComLojaOAuth());
  assertEquals(cad.lojas[NOVA_OAUTH].acesso, "oauth");
  assert(Object.isFrozen(cad.lojas[NOVA_OAUTH]));
});

Deno.test("acesso: recusado em loja legado (o legado divide o segredo e lê pelo CLI)", () => {
  const j = jsonDeHoje();
  j.lojas.loja.acesso = "oauth";
  assertStringIncludes(msgDe(j), "loja: acesso só existe em assinante");
  const k = jsonDeHoje();
  k.lojas.sandbox.acesso = "cli";
  assertStringIncludes(msgDe(k), "sandbox: acesso só existe em assinante");
});

Deno.test("acesso: qualquer valor fora de 'oauth' é recusado — inclusive 'cli' escrito à mão", () => {
  for (const ruim of [
    "cli",
    "OAuth",
    "OAUTH",
    "oauth ",
    "",
    "pat",
    null,
    true,
    1,
    ["oauth"],
    { oauth: true },
  ]) {
    const j = jsonComLojaOAuth();
    j.lojas[NOVA_OAUTH].acesso = ruim;
    assertStringIncludes(
      msgDe(j),
      `${NOVA_OAUTH}: acesso só aceita "oauth"`,
      JSON.stringify(ruim),
    );
  }
});

Deno.test("acesso: sem o campo a normalização devolve 'cli' — toda loja de hoje continua pelo CLI", () => {
  for (const l of Object.values(CADASTRO_REAL.lojas))
    assertEquals(l.acesso, "cli", l.projeto);
  // o lojas.json de hoje não escreve o campo em loja nenhuma
  for (const [nome, l] of Object.entries(jsonDeHoje().lojas))
    assert(!Object.hasOwn(l, "acesso"), nome);
  const semCampo = lojasMod.validarCadastro(jsonComLojaOAuth(false));
  assertEquals(semCampo.lojas[NOVA_OAUTH].acesso, "cli");
  // o campo não muda mais nada da loja: só o `acesso` difere
  const comCampo = lojasMod.validarCadastro(jsonComLojaOAuth(true));
  assertEquals(
    { ...comCampo.lojas[NOVA_OAUTH], acesso: "cli" },
    { ...semCampo.lojas[NOVA_OAUTH] },
  );
  // e as lojas de sempre saem idênticas nos dois cadastros
  for (const nome of Object.keys(CADASTRO_REAL.lojas))
    assertEquals(
      JSON.stringify(comCampo.lojas[nome]),
      JSON.stringify(CADASTRO_REAL.lojas[nome]),
      nome,
    );
});

Deno.test("acesso: o gerador de workflows não lê o campo — com e sem ele, o mesmo texto em todo workflow", () => {
  const com = lojasMod.validarCadastro(jsonComLojaOAuth(true));
  const sem = lojasMod.validarCadastro(jsonComLojaOAuth(false));
  for (const caminho of gerador.workflowsComBlocos()) {
    const atual = Deno.readTextFileSync(caminho);
    const comOAuth = gerador.sincronizar(atual, com);
    // controle: a loja nova de fato entra no arquivo (senão o teste não prova nada)
    assertStringIncludes(comOAuth, NOVA_OAUTH, caminho);
    assertEquals(comOAuth, gerador.sincronizar(atual, sem), caminho);
  }
});

Deno.test({
  name: "acesso: a prova de banco de um run de ANTES do campo continua valendo com uma loja OAuth nova no topo (C6)",
  ...SEM_SANITIZAR,
  fn: async () => {
    const { workflowSoGanhouLojas } = await import(
      "../scripts/frota/publicar-release.mjs"
    );
    const wf = Deno.readTextFileSync(
      join(DIR_WF, "conferir-banco-da-loja.yml"),
    );
    const lojasDoRun = Deno.readTextFileSync(
      join(RAIZ, "scripts/frota/lojas.json"),
    );
    assert(!lojasDoRun.includes('"acesso"'), "o run é de antes do campo");
    const lojasDoTopo = JSON.stringify(jsonComLojaOAuth(true), null, 2);
    const ymlDoTopo = gerador.sincronizar(
      wf,
      lojasMod.validarCadastro(JSON.parse(lojasDoTopo)),
    );
    assert(ymlDoTopo !== wf, "controle: o topo ganhou a loja nos blocos");
    assertEquals(
      workflowSoGanhouLojas({
        ymlDoRun: wf,
        lojasDoRun,
        ymlDoTopo,
        lojasDoTopo,
      }),
      { ok: true, motivo: null },
    );
    // e uma loja que JÁ existia trocar de caminho (CLI → OAuth) é alteração
    const trocou = JSON.parse(lojasDoTopo);
    trocou.lojas.savy.acesso = "oauth";
    const r = workflowSoGanhouLojas({
      ymlDoRun: wf,
      lojasDoRun,
      ymlDoTopo,
      lojasDoTopo: JSON.stringify(trocou, null, 2),
    });
    assertEquals(r.ok, false);
    assertStringIncludes(r.motivo, "savy");
    assertStringIncludes(r.motivo, "alterada");
  },
});

Deno.test("CLI exigir-segredo de loja OAuth sem token: manda disparar dentro da sessão de publicação, e nunca imprime valor", () => {
  const cad = lojasMod.validarCadastro(jsonComLojaOAuth());
  // canário montado em tempo de execução (literal no fonte dispara o secretlint)
  const canario = `sbp_oauth_${"ab".repeat(20)}`;
  const sem = cli(
    ["exigir-segredo", NOVA_OAUTH],
    // o token de OUTRA loja presente não serve a esta
    { SUPABASE_ACCESS_TOKEN_SAVY: canario, SUPABASE_ACCESS_TOKEN: canario },
    cad,
  );
  assertEquals(sem.codigo, 1);
  assertStringIncludes(sem.texto, "::error::");
  assertStringIncludes(
    sem.texto,
    "loja OAuth: dispare dentro da sessão de publicação (publicar-release.mjs --sessao)",
  );
  assertStringIncludes(sem.texto, SEGREDO_OAUTH);
  // a gaveta: o token da loja OAuth mora no environment dela, não no repositório
  assertStringIncludes(
    sem.texto,
    `o segredo ${SEGREDO_OAUTH} da loja ${NOVA_OAUTH} fica no environment loja-${NOVA_OAUTH} (Settings → Environments → loja-${NOVA_OAUTH})`,
  );
  assertStringIncludes(
    sem.texto,
    "o segredo de repositório com o mesmo nome é legado",
  );
  assert(!sem.texto.includes(canario));
  assert(!sem.texto.includes("sbp_"));
  assertEquals(sem.texto.split("\n").length, 1, "uma linha só");
  // com o token da loja presente (vazio não conta): passa e não o imprime
  assertEquals(
    cli(["exigir-segredo", NOVA_OAUTH], { [SEGREDO_OAUTH]: "" }, cad).codigo,
    1,
  );
  const ok = cli(
    ["exigir-segredo", NOVA_OAUTH],
    { [SEGREDO_OAUTH]: canario },
    cad,
  );
  assertEquals(ok.codigo, 0);
  assert(!ok.texto.includes(canario));
  // a mesma loja SEM a marca: a mensagem de sempre, sem falar de sessão
  const cli2 = cli(
    ["exigir-segredo", NOVA_OAUTH],
    {},
    lojasMod.validarCadastro(jsonComLojaOAuth(false)),
  );
  assertEquals(cli2.codigo, 1);
  assertEquals(
    cli2.texto,
    `::error::sem acesso legítimo à Loja OAuth por ${SEGREDO_OAUTH} — bloqueio concreto`,
  );
});

// ---------------------------------------------------------------------------
// 4/5. O YAML dos workflows: em sincronia com o cadastro, sem segredo dinâmico,
//      cada segredo de loja só com a guarda da SUA loja
// ---------------------------------------------------------------------------
Deno.test("os workflows estão em sincronia com o cadastro: o gerador, rodado de novo, não muda nada", () => {
  const comBlocos = gerador
    .workflowsComBlocos()
    .map((p) => p.split(/[\\/]/).pop());
  for (const nome of OITO_WORKFLOWS)
    assert(comBlocos.includes(nome), `${nome} não tem blocos LOJAS-SEGREDO*`);
  for (const caminho of gerador.workflowsComBlocos()) {
    const atual = Deno.readTextFileSync(caminho);
    assertEquals(
      gerador.sincronizar(atual, CADASTRO_REAL),
      atual,
      `${caminho} fora de sincronia com lojas.json: rode node scripts/frota/lojas-nos-workflows.cjs --escrever`,
    );
  }
});

Deno.test("nenhum workflow usa segredo de nome dinâmico, o contexto inteiro ou herança (entregariam TODOS os segredos ao job)", () => {
  for (const nome of Deno.readDirSync(DIR_WF)) {
    if (!nome.name.endsWith(".yml")) continue;
    const yaml = semComentarios(Deno.readTextFileSync(join(DIR_WF, nome.name)));
    assert(!/secrets\s*\[/.test(yaml), `${nome.name}: secrets[...] dinâmico`);
    assert(
      !/toJSON\(\s*secrets\s*\)/i.test(yaml),
      `${nome.name}: toJSON(secrets)`,
    );
    assert(!/secrets:\s*inherit/.test(yaml), `${nome.name}: secrets: inherit`);
    assert(
      !/fromJSON\([^)]*secrets/i.test(yaml),
      `${nome.name}: fromJSON(secrets…)`,
    );
  }
});

/** Os projetos da guarda que vem IMEDIATAMENTE antes do `secrets.X` (`inputs.projeto
 * == 'a' && ` ou `(inputs.projeto == 'a' || inputs.projeto == 'b') && `), ou null. */
function guardaImediata(antes: string): string[] | null {
  const m = antes.match(
    // eslint-disable-next-line security/detect-unsafe-regex -- teste: o texto é o YAML versionado deste repositório, nunca entrada externa.
    /(?:inputs\.projeto == '([a-z0-9-]+)'|\(((?:inputs\.projeto == '[a-z0-9-]+'(?: \|\| )?)+)\)) && $/,
  );
  if (!m) return null;
  if (m[1]) return [m[1]];
  return [...m[2].matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]);
}
const mesmoConjunto = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

/** Os jobs que usam o segredo sem guarda de projeto, por `if` de JOB sobre outros
 * inputs (pagamentos IKCOUS: um só segredo fixo, nada a ver com `projeto`). */
const JOBS_COM_SEGREDO_FIXO = new Set([
  "verificar-ikcous-original",
  "verificar-ikcous-publicado",
]);

Deno.test("REGRA DA CASA: todo segredo de loja de cada workflow tem a guarda da SUA loja (inline ou no if do passo); nenhum passo lê o segredo de outra", () => {
  const dono = (segredo: string): string[] =>
    Object.values(CADASTRO_REAL.lojas)
      .filter((l) => l.segredoDoToken === segredo)
      .map((l) => l.projeto);
  let referencias = 0;
  for (const nome of OITO_WORKFLOWS) {
    const doc = docDe(nome);
    for (const [idJob, job] of Object.entries(doc.jobs) as any) {
      for (const passo of job.steps ?? []) {
        const textoDoPasso = JSON.stringify(passo);
        for (const m of textoDoPasso.matchAll(
          /secrets\.(SUPABASE_ACCESS_TOKEN\w*)/g,
        )) {
          referencias++;
          const segredo = m[1];
          const donos = dono(segredo);
          assert(
            donos.length > 0,
            `${nome}: segredo sem dono no cadastro: ${segredo}`,
          );
          const antes = textoDoPasso.slice(0, m.index);
          // a guarda IMEDIATAMENTE antes do segredo é a da SUA loja (e de nenhuma outra)
          const g = guardaImediata(antes);
          const guardaInline = g !== null && mesmoConjunto(g, donos);
          const guardaNoIf =
            typeof passo.if === "string" &&
            donos.every((d) => passo.if.includes(`inputs.projeto == '${d}'`)) &&
            // e o `if` não abre o passo para outro projeto por `!=`/`||` solto
            !/inputs\.projeto != /.test(
              passo.if.replace(
                /inputs\.projeto != '(?:ikcous-publicada|loja|sandbox)'/g,
                "",
              ),
            );
          const jobFixo = JOBS_COM_SEGREDO_FIXO.has(idJob);
          assert(
            guardaInline || guardaNoIf || jobFixo,
            `${nome} / ${idJob} / ${passo.name}: ${segredo} sem a guarda da loja (${donos.join(",")})`,
          );
        }
      }
    }
  }
  assert(
    referencias >= 20,
    `poucas referências para ser um teste sério: ${referencias}`,
  );
});

Deno.test("cada passo com segredo de loja só vê o da loja pedida: as linhas geradas para uma loja nova NUNCA citam o segredo de outra", () => {
  const cad = cadastroComLojaNova();
  for (const nome of OITO_WORKFLOWS) {
    const novo = gerador.sincronizar(
      Deno.readTextFileSync(join(DIR_WF, nome)),
      cad,
    );
    const doc = parse(novo);
    for (const [idJob, job] of Object.entries(doc.jobs) as any) {
      // (os dois jobs de pagamentos IKCOUS usam um segredo fixo, sem `projeto`)
      if (JOBS_COM_SEGREDO_FIXO.has(idJob)) continue;
      for (const passo of job.steps ?? []) {
        const t = JSON.stringify(passo);
        if (!/secrets\.SUPABASE_ACCESS_TOKEN/.test(t)) continue;
        for (const m of t.matchAll(/secrets\.(SUPABASE_ACCESS_TOKEN\w*)/g)) {
          const donos = Object.values(cad.lojas)
            .filter((l) => l.segredoDoToken === m[1])
            .map((l) => l.projeto);
          const antes = t.slice(0, m.index);
          const g = guardaImediata(antes);
          const inline = g !== null && mesmoConjunto(g, donos);
          const noIf =
            typeof passo.if === "string" &&
            donos.every((d) => passo.if.includes(`inputs.projeto == '${d}'`));
          assert(inline || noIf, `${nome}: ${m[1]} sem guarda`);
          // e a guarda é de UMA loja só: o segredo da loja nova só com a loja nova
          if (m[1] === SEGREDO_NOVO)
            assert(inline, `${nome}: ${SEGREDO_NOVO} precisa da guarda inline`);
        }
      }
    }
  }
});

/** O menu `projeto` que cada workflow tem de ter, a partir do cadastro: todas as
 * lojas (banco), só as assinantes (chave, auth, login) ou assinantes primeiro
 * (publicar-functions). O GitHub recusa no disparo um valor fora dele. */
function menuEsperado(nome: string, cad = CADASTRO_REAL): string[] {
  const todas = Object.values(cad.lojas);
  const ass = todas.filter((l) => l.classe === "assinante");
  const leg = todas.filter((l) => l.classe === "legado");
  const p = (ls) => ls.map((l) => l.projeto);
  if (
    nome === "aplicar-migrations.yml" ||
    nome === "conferir-banco-da-loja.yml"
  )
    return p(todas);
  if (nome === "publicar-functions.yml") return p([...ass, ...leg]);
  return p(ass);
}
const inputsDe = (doc: any) => (doc.on ?? doc[true]).workflow_dispatch.inputs;

Deno.test("todo workflow por loja tem `projeto` como menu FECHADO (choice) gerado do cadastro, com o padrão dentro dele — o mesmo menu de antes para IKCOUS e Savy", () => {
  const padraoDeSempre = {
    "aplicar-migrations.yml": "loja",
    "conferir-banco-da-loja.yml": "loja",
    "publicar-functions.yml": "ikcous-publicada",
    "instalar-chave-da-loja.yml": "savy",
    "medir-auth-da-loja.yml": "savy",
    "ativar-email-do-login.yml": "ikcous-publicada",
    "ativar-google-do-login.yml": "ikcous-publicada",
    "login-da-loja.yml": "ikcous-publicada",
  };
  for (const nome of OITO_WORKFLOWS) {
    const p = inputsDe(docDe(nome)).projeto;
    assertEquals(p.type, "choice", `${nome}: projeto voltou a ser texto livre`);
    assertEquals(p.options, menuEsperado(nome), nome);
    assertEquals(p.default, padraoDeSempre[nome], nome);
    assert(p.options.includes(p.default), `${nome}: padrão fora do menu`);
  }
  // a forma dos menus de sempre (o que existia antes do cadastro, exceto a
  // ordem loja/sandbox no fim do menu de publicar-functions), com as
  // assinantes lidas do cadastro: IKCOUS e Savy obrigatórias em todos
  const ass = lojasMod.assinantes(CADASTRO_REAL).map((l) => l.projeto);
  exigirIkcousESavy(ass, "assinantes do cadastro");
  assertEquals(menuEsperado("aplicar-migrations.yml"), [
    "loja",
    "sandbox",
    ...ass,
  ]);
  assertEquals(menuEsperado("medir-auth-da-loja.yml"), ass);
  assertEquals(menuEsperado("publicar-functions.yml"), [
    ...ass,
    "loja",
    "sandbox",
  ]);
});

Deno.test("todo workflow por loja confere a loja no cadastro ANTES do primeiro passo que vê segredo", () => {
  for (const nome of OITO_WORKFLOWS) {
    const doc = docDe(nome);
    const passos = Object.values(doc.jobs).flatMap((j: any) =>
      (j.steps ?? []).map((p) => [j, p]),
    );
    // por job: o passo do cadastro vem antes de qualquer passo com `secrets.SUPABASE_ACCESS_TOKEN*` de loja
    for (const [idJob, job] of Object.entries(doc.jobs) as any) {
      if (JOBS_COM_SEGREDO_FIXO.has(idJob)) continue;
      const lista = job.steps ?? [];
      const iPrimeiroSegredo = lista.findIndex((p) =>
        /secrets\.SUPABASE_ACCESS_TOKEN/.test(JSON.stringify(p)),
      );
      if (iPrimeiroSegredo < 0) continue;
      const iCadastro = lista.findIndex(
        (p) =>
          String(p.name ?? "").startsWith("Confere a loja no cadastro") ||
          // publicar-functions resolve o alvo no próprio passo "Resolve o projeto"
          String(p.run ?? "").includes("scripts/frota/lojas.cjs validar"),
      );
      assert(
        iCadastro >= 0 && iCadastro < iPrimeiroSegredo,
        `${nome} / ${idJob}: o cadastro precisa ser conferido antes do primeiro passo com segredo`,
      );
      // e o passo do cadastro não vê nenhum segredo
      assert(
        !/secrets\./.test(JSON.stringify(lista[iCadastro])),
        `${nome}: passo do cadastro com segredo`,
      );
    }
    assert(passos.length > 0);
  }
});

Deno.test("o sha: toda loja fora de loja|sandbox (as do cadastro e as que ainda não existem) o exige no 1º passo de aplicar, conferir e ledger", async () => {
  for (const nome of ["aplicar-migrations.yml", "conferir-banco-da-loja.yml"]) {
    const doc = docDe(nome);
    for (const job of Object.values(doc.jobs) as any[]) {
      const primeiro = (job.steps ?? [])[0];
      if (
        !primeiro ||
        !String(primeiro.name ?? "").startsWith("Confere o alvo")
      )
        continue;
      for (const projeto of [
        "ikcous-publicada",
        "savy",
        NOVA,
        "qualquer-outra",
      ]) {
        const r = await bash(primeiro.run, {
          PROJETO: projeto,
          EXPECTED_SHA: "",
          GITHUB_SHA: SHA,
        });
        assertEquals(r.codigo, 1, `${nome}/${projeto}: sem sha devia recusar`);
        const ok = await bash(primeiro.run, {
          PROJETO: projeto,
          EXPECTED_SHA: SHA,
          GITHUB_SHA: SHA,
        });
        assertEquals(ok.codigo, 0, `${nome}/${projeto}: ${ok.saida}`);
      }
      for (const projeto of ["loja", "sandbox"])
        assertEquals(
          (
            await bash(primeiro.run, {
              PROJETO: projeto,
              EXPECTED_SHA: "",
              GITHUB_SHA: SHA,
            })
          ).codigo,
          0,
        );
      assertEquals(
        (
          await bash(primeiro.run, {
            PROJETO: "__proto__",
            EXPECTED_SHA: SHA,
            GITHUB_SHA: SHA,
          })
        ).codigo,
        1,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 3. LOJA NOVA SÓ POR DADO — os 8 workflows
// ---------------------------------------------------------------------------
Deno.test("loja nova só por dado (workflows): o gerador acrescenta SÓ a linha de segredo da loja, e sem a loja o arquivo volta idêntico", () => {
  const nova = cadastroComLojaNova();
  for (const nome of OITO_WORKFLOWS) {
    const atual = Deno.readTextFileSync(join(DIR_WF, nome));
    const comNova = gerador.sincronizar(atual, nova);
    assert(comNova !== atual, `${nome}: a loja nova devia gerar uma linha`);
    // só linhas ACRESCENTADAS (a cadeia de publicar-functions e o grupo POR BANCO
    // de aplicar/ledger são uma linha reescrita, com a loja nova no mapa)
    const a = atual.split("\n");
    const n = comNova.split("\n");
    const novasLinhas = n.filter((l) => !a.includes(l));
    const GRUPO_DO_BANCO = "group: banco-da-loja-${{ fromJSON('";
    assert(
      novasLinhas.length >= 1 &&
        novasLinhas.every(
          (l) =>
            l.includes(SEGREDO_NOVO) ||
            l.includes("SUPABASE_ACCESS_TOKEN: ${{") ||
            l === `          - ${NOVA}` ||
            (l.includes(GRUPO_DO_BANCO) &&
              l.includes(`"${NOVA}":"${REF_NOVA}"`)),
        ),
      `${nome}: linhas novas inesperadas:\n${novasLinhas.join("\n")}`,
    );
    // o menu ganha a loja nova (assinante: entra em todos os oito menus)
    assertEquals(
      inputsDe(parse(comNova)).projeto.options,
      menuEsperado(nome, nova),
      nome,
    );
    assert(menuEsperado(nome, nova).includes(NOVA), nome);
    for (const l of novasLinhas.filter((x) => x.includes(SEGREDO_NOVO)))
      assertStringIncludes(
        l,
        `inputs.projeto == '${NOVA}' && secrets.${SEGREDO_NOVO}`,
      );
    // nenhuma linha de hoje some, exceto a cadeia única de publicar-functions e
    // o grupo por banco (reescritos com a nova)
    const sumiram = a.filter((l) => !n.includes(l));
    assert(
      sumiram.every(
        (l) =>
          l.includes(
            "SUPABASE_ACCESS_TOKEN: ${{ inputs.projeto == 'ikcous-publicada'",
          ) || l.includes(GRUPO_DO_BANCO),
      ),
      `${nome}: linhas sumiram`,
    );
    // idempotente, e voltar ao cadastro real devolve o arquivo de hoje
    assertEquals(gerador.sincronizar(comNova, nova), comNova);
    assertEquals(gerador.sincronizar(comNova, CADASTRO_REAL), atual);
    // o YAML gerado continua válido
    parse(comNova);
  }
});

/** Uma cópia da árvore mínima (scripts de loja + cadastro de FIXTURE + 1 consulta +
 * uma function) para rodar os passos e scripts com a loja inventada, sem nenhuma
 * outra edição. */
function arvoreComLojaNova() {
  const raiz = Deno.makeTempDirSync({ prefix: "loja-nova-" });
  const copiar = (rel: string) => {
    const destino = join(raiz, rel);
    Deno.mkdirSync(join(destino, ".."), { recursive: true });
    Deno.copyFileSync(join(RAIZ, rel), destino);
  };
  for (const rel of [
    "scripts/frota/lojas.cjs",
    "scripts/publicacao/conferir-banco.cjs",
    "scripts/publicacao/medir-auth-da-loja.cjs",
    "scripts/publicacao/instalar-chave-da-loja.cjs",
    "scripts/publicacao/ativar-email-do-login.cjs",
    "scripts/publicacao/ativar-google-do-login.cjs",
    "scripts/publicacao/login-da-loja.cjs",
    "scripts/publicacao/login-da-loja-regras.cjs",
    "scripts/publicacao/consultas/8f-conferir-201.sql",
    "supabase/functions/criar-pagamento/index.ts",
  ])
    copiar(rel);
  Deno.writeTextFileSync(
    join(raiz, "scripts/frota/lojas.json"),
    JSON.stringify(jsonComLojaNova(), null, 2),
  );
  return raiz;
}

Deno.test({
  name: "loja nova só por dado (passos dos 8 workflows): a validação aceita a loja inventada e recusa a ausente do cadastro, sem nenhum token no ambiente",
  ...SEM_SANITIZAR,
  fn: async () => {
    const raiz = arvoreComLojaNova();
    try {
      // grupo A (só assinantes) e grupo B (qualquer loja do cadastro)
      for (const nome of [
        "instalar-chave-da-loja.yml",
        "medir-auth-da-loja.yml",
        "ativar-email-do-login.yml",
        "ativar-google-do-login.yml",
        "login-da-loja.yml",
        "aplicar-migrations.yml",
        "conferir-banco-da-loja.yml",
      ]) {
        const doc = docDe(nome);
        const validar = runDoPasso(doc, "Confere a loja no cadastro");
        const ok = await bash(validar, { PROJETO: NOVA }, raiz);
        assertEquals(ok.codigo, 0, `${nome}: ${ok.saida}`);
        const fora = await bash(validar, { PROJETO: "loja-ausente" }, raiz);
        assertEquals(fora.codigo, 1, nome);
        assertStringIncludes(fora.saida, "loja desconhecida");
        // o 1º passo (formato): a loja nova passa; texto com lixo não
        const primeiro = Object.values(doc.jobs)[0].steps[0].run;
        const fmt = (p: string) =>
          bash(
            primeiro,
            {
              PROJETO: p,
              EXPECTED_SHA: SHA,
              GITHUB_SHA: SHA,
              // cada workflow recusa ação fora do SEU menu no 1º passo
              ACAO: nome === "login-da-loja.yml" ? "conferir" : "medir",
              TURMA: "turma-1",
            },
            raiz,
          );
        assertEquals(
          (await fmt(NOVA)).codigo,
          0,
          `${nome}: formato da loja nova`,
        );
        for (const lixo of [
          "Loja Nova",
          "loja;rm -rf",
          "$(touch x)",
          "../x",
          "a\nb",
          "x",
        ])
          assertEquals(
            (await fmt(lixo)).codigo,
            1,
            `${nome}: ${JSON.stringify(lixo)}`,
          );
      }
      // publicar-functions: resolve o ref da loja nova pelo cadastro
      const alvo = runDoPasso(
        docDe("publicar-functions.yml"),
        "Resolve o projeto",
      );
      const saida = join(raiz, "gh-output.txt");
      Deno.writeTextFileSync(saida, "");
      const pub = await bash(
        alvo,
        {
          PROJETO: NOVA,
          PEDIDAS: "criar-pagamento",
          EXPECTED_SHA: SHA,
          GITHUB_SHA: SHA,
          GITHUB_OUTPUT: saida,
        },
        raiz,
      );
      assertEquals(pub.codigo, 0, pub.saida);
      const out = Deno.readTextFileSync(saida);
      assertStringIncludes(out, `ref=${REF_NOVA}`);
      assertStringIncludes(out, `segredo=${SEGREDO_NOVO}`);
      assertStringIncludes(out, "nomes=criar-pagamento");
      // sem a decisão de `functionsNomeadas`, as oito nomeadas ficam FECHADAS para ela
      const nomeada = await bash(
        alvo,
        {
          PROJETO: NOVA,
          PEDIDAS: "send-push",
          EXPECTED_SHA: SHA,
          GITHUB_SHA: SHA,
          GITHUB_OUTPUT: saida,
        },
        raiz,
      );
      assertEquals(nomeada.codigo, 1);
      assertStringIncludes(
        nomeada.saida,
        "só admite as cinco Functions financeiras",
      );
      // sha igual obrigatório (é loja assinante)
      const semSha = await bash(
        alvo,
        {
          PROJETO: NOVA,
          PEDIDAS: "criar-pagamento",
          EXPECTED_SHA: "",
          GITHUB_SHA: SHA,
          GITHUB_OUTPUT: saida,
        },
        raiz,
      );
      assertEquals(semSha.codigo, 1);
      // loja ausente: recusa antes de qualquer coisa
      const ausente = await bash(
        alvo,
        {
          PROJETO: "loja-ausente",
          PEDIDAS: "criar-pagamento",
          EXPECTED_SHA: SHA,
          GITHUB_SHA: SHA,
          GITHUB_OUTPUT: saida,
        },
        raiz,
      );
      assertEquals(ausente.codigo, 1);
      assertStringIncludes(ausente.saida, "projeto desconhecido: loja-ausente");
      // o segredo é conferido pelo NOME que o cadastro deu (passo de conferência do conferir-banco)
      const exigir = runDoPasso(
        docDe("conferir-banco-da-loja.yml"),
        "Confere o segredo",
      );
      const semToken = await bash(
        exigir,
        {
          PROJETO: NOVA,
          SUPABASE_ACCESS_TOKEN: "tk-legado",
          SUPABASE_ACCESS_TOKEN_SAVY: "tk-savy",
        },
        raiz,
      );
      assertEquals(semToken.codigo, 1);
      assertStringIncludes(
        semToken.saida,
        `sem acesso legítimo à Loja Teste por ${SEGREDO_NOVO} — bloqueio concreto`,
      );
      const comToken = await bash(
        exigir,
        { PROJETO: NOVA, [SEGREDO_NOVO]: "tk-xyz" },
        raiz,
      );
      assertEquals(comToken.codigo, 0, comToken.saida);
    } finally {
      Deno.removeSync(raiz, { recursive: true });
    }
  },
});

// ---------------------------------------------------------------------------
// 3. LOJA NOVA SÓ POR DADO — os scripts
// ---------------------------------------------------------------------------
const saidaCaptura = () => {
  const linhas: string[] = [];
  return {
    linhas,
    erro: (l) => linhas.push(`erro ${l}`),
    log: (l) => linhas.push(`log ${l}`),
    resumo: (l) => linhas.push(`resumo ${l}`),
    mascarar: (_l) => linhas.push("mascarar"),
    tudo: () => linhas.join("\n"),
  };
};
const fetchQueNaoPodeSerChamado = () => {
  throw new Error("rede não podia ser tocada");
};

Deno.test({
  name: "loja nova só por dado (scripts): conferir-banco, medir-auth, instalar-chave, ativar-email, ativar-google e login-da-loja a aceitam pelo cadastro e recusam a ausente",
  ...SEM_SANITIZAR,
  fn: async () => {
    const raiz = arvoreComLojaNova();
    try {
      const pub = (n: string) => require(join(raiz, "scripts/publicacao", n));
      const conferir = pub("conferir-banco.cjs");
      const medir = pub("medir-auth-da-loja.cjs");
      const instalar = pub("instalar-chave-da-loja.cjs");
      const email = pub("ativar-email-do-login.cjs");
      const google = pub("ativar-google-do-login.cjs");
      const login = pub("login-da-loja.cjs");

      // conferir-banco: o ref vem do cadastro
      assertEquals(conferir.resolverRef(NOVA), REF_NOVA);
      assertEquals(conferir.REFS_POR_PROJETO[NOVA], REF_NOVA);
      assertEquals(conferir.REFS_POR_PROJETO.savy, "gnjsrucsmjkajijrakzr");
      for (const ausente of [
        "loja-ausente",
        "__proto__",
        "constructor",
        "",
        undefined,
      ]) {
        let lancou = false;
        try {
          conferir.resolverRef(ausente);
        } catch {
          lancou = true;
        }
        assert(lancou, String(ausente));
      }

      // os quatro scripts de alvo: a loja nova está nos ALVOS, com o segredo do
      // cadastro, depois das assinantes de hoje (lidas do lojas.json real)
      const assDeHoje = lojasMod
        .assinantes(CADASTRO_REAL)
        .map((l) => l.projeto);
      exigirIkcousESavy(assDeHoje, "assinantes do cadastro");
      for (const alvos of [medir.ALVOS, instalar.ALVOS]) {
        assertEquals(Object.keys(alvos), [...assDeHoje, NOVA]);
        assertEquals(alvos[NOVA].segredo, SEGREDO_NOVO);
        assertEquals(
          alvos[NOVA].semAcesso,
          `sem acesso legítimo à Loja Teste por ${SEGREDO_NOVO} — bloqueio concreto`,
        );
      }

      // medir-auth, caminho feliz inteiro: a chamada vai ao ref da loja nova, com o token do segredo NOVO
      const chamadas: any[] = [];
      const fetchOk = async (url, init) => {
        chamadas.push({ url, auth: init.headers.Authorization });
        return {
          status: 200,
          ok: true,
          text: async () =>
            JSON.stringify({
              mailer_autoconfirm: false,
              external_email_enabled: true,
              disable_signup: false,
              rate_limit_email_sent: 30,
            }),
        };
      };
      const s1 = saidaCaptura();
      assertEquals(
        await medir.medir({
          projeto: NOVA,
          env: {
            [SEGREDO_NOVO]: "tk-xyz",
            SUPABASE_ACCESS_TOKEN_SAVY: "tk-savy",
            SUPABASE_ACCESS_TOKEN: "tk-legado",
          },
          fetchImpl: fetchOk,
          saida: s1,
        }),
        0,
        s1.tudo(),
      );
      assertEquals(chamadas.length, 1);
      assertEquals(
        chamadas[0].url,
        `https://api.supabase.com/v1/projects/${REF_NOVA}/config/auth`,
      );
      assertEquals(chamadas[0].auth, "Bearer tk-xyz");
      // sem o token da loja nova (e COM o da Savy e o legado): PARA com a mensagem dela, sem rede
      for (const env of [
        {
          SUPABASE_ACCESS_TOKEN_SAVY: "tk-savy",
          SUPABASE_ACCESS_TOKEN: "tk-legado",
        },
        {},
      ]) {
        const s2 = saidaCaptura();
        assertEquals(
          await medir.medir({
            projeto: NOVA,
            env,
            fetchImpl: fetchQueNaoPodeSerChamado,
            saida: s2,
          }),
          1,
        );
        assertStringIncludes(
          s2.tudo(),
          `sem acesso legítimo à Loja Teste por ${SEGREDO_NOVO}`,
        );
      }
      // ausente do cadastro: recusa, sem rede
      for (const ausente of ["loja-ausente", "loja", "sandbox", "__proto__"]) {
        const s3 = saidaCaptura();
        assertEquals(
          await medir.medir({
            projeto: ausente,
            env: { [SEGREDO_NOVO]: "x", SUPABASE_ACCESS_TOKEN: "x" },
            fetchImpl: fetchQueNaoPodeSerChamado,
            saida: s3,
          }),
          1,
        );
        assertStringIncludes(s3.tudo(), "projeto desconhecido");
        assertStringIncludes(
          s3.tudo(),
          `use ${lojasMod.listaLegivel([...assDeHoje, NOVA])}`,
        );
      }

      // instalar-chave: aceita a loja nova até o token (que falta) e recusa a ausente; nunca toca a rede
      const HASH = "a".repeat(64);
      const s4 = saidaCaptura();
      assertEquals(
        await instalar.instalar({
          projeto: NOVA,
          hash: HASH,
          substituir: "false",
          sha: SHA,
          env: {},
          fetchImpl: fetchQueNaoPodeSerChamado,
          saida: s4,
        }),
        1,
      );
      assertStringIncludes(
        s4.tudo(),
        `sem acesso legítimo à Loja Teste por ${SEGREDO_NOVO}`,
      );
      const s5 = saidaCaptura();
      assertEquals(
        await instalar.instalar({
          projeto: "loja-ausente",
          hash: HASH,
          substituir: "false",
          sha: SHA,
          env: { [SEGREDO_NOVO]: "x" },
          fetchImpl: fetchQueNaoPodeSerChamado,
          saida: s5,
        }),
        1,
      );
      assertStringIncludes(s5.tudo(), "projeto desconhecido");

      // ativar-email / ativar-google: a loja nova passa da checagem de alvo e para NO TOKEN (o da loja nova); a ausente para no alvo
      for (const [exec, nome] of [
        [email.executar, "email"],
        [google.executar, "google"],
      ]) {
        const base = { acao: "medir", fetchImpl: fetchQueNaoPodeSerChamado };
        const envBase = {
          EXPECTED_SHA: SHA,
          GITHUB_SHA: SHA,
          TURMA: "turma-1",
        };
        const s6 = saidaCaptura();
        const r6 = await exec({
          ...base,
          projeto: NOVA,
          env: { ...envBase, SUPABASE_ACCESS_TOKEN_SAVY: "tk-savy" },
          saida: s6,
        });
        assertEquals(r6, 1, nome);
        assertStringIncludes(
          s6.tudo(),
          `sem acesso legítimo à Loja Teste por ${SEGREDO_NOVO}`,
        );
        const s7 = saidaCaptura();
        const r7 = await exec({
          ...base,
          projeto: "loja-ausente",
          env: { ...envBase, [SEGREDO_NOVO]: "tk" },
          saida: s7,
        });
        assertEquals(r7, 1, nome);
        assertStringIncludes(s7.tudo(), "projeto desconhecido");
      }

      // login-da-loja: sem o token da loja nova PARA nela (sem rede); com ele, a
      // 1ª chamada vai ao ref da loja nova com o token dela (401 aqui = PARA)
      const envLogin = { EXPECTED_SHA: SHA, GITHUB_SHA: SHA };
      const s8 = saidaCaptura();
      assertEquals(
        await login.executar({
          projeto: NOVA,
          acao: "conferir",
          env: { ...envLogin, SUPABASE_ACCESS_TOKEN_SAVY: "tk-savy" },
          fetchImpl: fetchQueNaoPodeSerChamado,
          saida: s8,
        }),
        1,
      );
      assertStringIncludes(
        s8.tudo(),
        `sem acesso legítimo à Loja Teste por ${SEGREDO_NOVO}`,
      );
      const chamadasLogin: any[] = [];
      const s9 = saidaCaptura();
      assertEquals(
        await login.executar({
          projeto: NOVA,
          acao: "conferir",
          env: { ...envLogin, [SEGREDO_NOVO]: "tk-xyz" },
          fetchImpl: async (url, init) => {
            chamadasLogin.push({ url, auth: init.headers.Authorization });
            return { status: 401, text: async () => "" };
          },
          saida: s9,
        }),
        1,
      );
      assertEquals(chamadasLogin, [
        {
          url: `https://api.supabase.com/v1/projects/${REF_NOVA}/config/auth`,
          auth: "Bearer tk-xyz",
        },
      ]);
      const s10 = saidaCaptura();
      assertEquals(
        await login.executar({
          projeto: "loja-ausente",
          acao: "conferir",
          env: { ...envLogin, [SEGREDO_NOVO]: "tk" },
          fetchImpl: fetchQueNaoPodeSerChamado,
          saida: s10,
        }),
        1,
      );
      assertStringIncludes(s10.tudo(), "projeto desconhecido");
    } finally {
      // (require em cache de um caminho temporário não atrapalha: cada árvore tem caminho próprio)
      Deno.removeSync(raiz, { recursive: true });
    }
  },
});

// conferir-banco.cjs `main()` de verdade (processo filho), contra um servidor stub local
Deno.test({
  name: "loja nova só por dado (conferir-banco main): a requisição vai ao ref e com o token da loja nova; sem o token PARA; 401 PARA com a mensagem dela; ausente é recusada; o ledger nunca roda nela",
  ...SEM_SANITIZAR,
  fn: async () => {
    const raiz = arvoreComLojaNova();
    const chamadas: { url: string; auth: string | null }[] = [];
    let status = 201;
    const srv = Deno.serve(
      { port: 0, hostname: "127.0.0.1", onListen() {} },
      (req) => {
        chamadas.push({
          url: new URL(req.url).pathname,
          auth: req.headers.get("authorization"),
        });
        return new Response(
          JSON.stringify([{ item: "x", esperado: "1", vivo: "1", ok: true }]),
          {
            status,
            headers: { "content-type": "application/json" },
          },
        );
      },
    );
    const base = `http://127.0.0.1:${srv.addr.port}`;
    const rodar = async (env: Record<string, string>) => {
      const r = await new Deno.Command("node", {
        args: [join(raiz, "scripts/publicacao/conferir-banco.cjs")],
        cwd: raiz,
        env: {
          PATH: Deno.env.get("PATH") ?? "",
          GITHUB_STEP_SUMMARY: "",
          CONFERIR_BANCO_API_BASE: base,
          CONSULTA: "8f-conferir-201",
          ...env,
        },
        stdout: "piped",
        stderr: "piped",
      }).output();
      const dec = new TextDecoder();
      return {
        codigo: r.code,
        saida: dec.decode(r.stdout) + dec.decode(r.stderr),
      };
    };
    try {
      // sem o token da loja nova (mesmo com o legado, o da Savy e o da CAF): PARA, nenhuma requisição
      const sem = await rodar({
        PROJETO: NOVA,
        SUPABASE_ACCESS_TOKEN: "tk-legado",
        SUPABASE_ACCESS_TOKEN_SAVY: "tk-savy",
        SUPABASE_ACCESS_TOKEN_IKCOUS: "tk-caf",
      });
      assertEquals(sem.codigo, 1, sem.saida);
      assertStringIncludes(
        sem.saida,
        `sem acesso legítimo à Loja Teste por ${SEGREDO_NOVO} — bloqueio concreto`,
      );
      assertEquals(
        chamadas.length,
        0,
        "nenhuma requisição sem o token da própria loja",
      );
      // com o token: uma leitura, no ref da loja nova, com o token dela e nenhum outro
      const ok = await rodar({
        PROJETO: NOVA,
        [SEGREDO_NOVO]: "tk-xyz",
        SUPABASE_ACCESS_TOKEN: "tk-legado",
        SUPABASE_ACCESS_TOKEN_SAVY: "tk-savy",
      });
      assertEquals(ok.codigo, 0, ok.saida);
      assert(chamadas.length >= 1);
      for (const c of chamadas) {
        assertStringIncludes(c.url, `/v1/projects/${REF_NOVA}/database/query`);
        assertEquals(c.auth, "Bearer tk-xyz");
      }
      assert(!ok.saida.includes("tk-xyz"), "token nunca no log");
      // 401: PARA com a mensagem da loja, sem tentar outro segredo
      chamadas.length = 0;
      status = 401;
      const nao = await rodar({
        PROJETO: NOVA,
        [SEGREDO_NOVO]: "tk-xyz",
        SUPABASE_ACCESS_TOKEN: "tk-legado",
      });
      assertEquals(nao.codigo, 1, nao.saida);
      assertStringIncludes(
        nao.saida,
        `sem acesso legítimo à Loja Teste por ${SEGREDO_NOVO}`,
      );
      assert(
        chamadas.every((c) => c.auth === "Bearer tk-xyz"),
        "nenhum outro segredo tentado",
      );
      status = 201;
      // loja ausente do cadastro: recusada ANTES de qualquer requisição
      chamadas.length = 0;
      const ausente = await rodar({
        PROJETO: "loja-ausente",
        SUPABASE_ACCESS_TOKEN: "tk-legado",
      });
      assertEquals(ausente.codigo, 1);
      assertStringIncludes(ausente.saida, "projeto desconhecido");
      assertEquals(chamadas.length, 0);
      // o ledger (que GRAVA) não roda na loja nova, em nenhuma faixa (os backfills são de CAF/Savy)
      for (const faixa of ["72-74", "92-202", "60-66"]) {
        const l = await rodar({
          PROJETO: NOVA,
          [SEGREDO_NOVO]: "tk-xyz",
          LEDGER: faixa,
          CONSULTA: "",
        });
        assertEquals(l.codigo, 1, `${faixa}: ${l.saida}`);
        assertStringIncludes(l.saida, "o ledger não roda para loja-teste-xyz");
      }
      assertEquals(chamadas.length, 0, "o ledger recusado não faz requisição");
    } finally {
      await srv.shutdown();
      Deno.removeSync(raiz, { recursive: true });
    }
  },
});
