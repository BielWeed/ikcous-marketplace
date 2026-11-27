// @ts-nocheck
/**
 * Cópia do banco no PC antes da transferência (scripts/frota/copiar-banco.mjs),
 * A22 do plano da org central. O que este arquivo trava:
 *
 *  - sem --aplicar NADA roda: o executor de comando nunca é chamado e a pasta
 *    das cópias nem é criada; o ensaio diz o que faria;
 *  - com --aplicar: `supabase db dump --project-ref <ref>` duas vezes (esquema,
 *    depois dados com --data-only --use-copy), cada uma num arquivo
 *    `.parcial` que só vira o nome final depois que AS DUAS saíram com código
 *    0 e com conteúdo; qualquer falha apaga os `.parcial` desta rodada e não
 *    deixa cópia pela metade com cara de inteira;
 *  - a pasta é %LOCALAPPDATA%\ikcous\copias, conferida por exigirPastaSegura:
 *    dentro do repositório ou de qualquer árvore git = recusa sem rodar nada;
 *    LOCALAPPDATA ausente ou relativo = recusa;
 *  - o ref sai SÓ do cadastro (scripts/frota/lojas.json) pelo nome da loja:
 *    loja fora do cadastro, ref cru, `__proto__` = recusa sem rodar nada;
 *  - nunca imprime o endereço de conexão: o que o CLI escreve não chega à
 *    saída (o dublê devolve um endereço com senha de mentira e a saída é
 *    varrida), nem a mensagem de erro do executor;
 *  - arquivo final que já existe = recusa (nunca sobrescreve uma cópia);
 *  - argv fora da forma = uso errado (código 2), sem ecoar o argumento;
 *  - main sem executor injetado recusa neste processo de teste (sentinela
 *    IKCOUS_TESTE_SEM_COMANDO_REAL): esquecer a injeção nunca roda o CLI real.
 *
 * Nenhum comando real roda aqui: o executor é um dublê que só escreve no
 * arquivo pedido por `-f`, dentro de pastas temporárias.
 */
import { createRequire } from "node:module";
import { fromFileUrl, join } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { main, pastaDasCopias } from "../scripts/frota/copiar-banco.mjs";

// Sentinela: neste processo, main sem deps.executar recusa em vez de rodar o
// supabase de verdade.
Deno.env.set("IKCOUS_TESTE_SEM_COMANDO_REAL", "1");

const require = createRequire(import.meta.url);
const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const { carregarLojas } = require("../scripts/frota/lojas.cjs");
const REF_SAVY = carregarLojas().lojas.savy.ref;
const AGORA = new Date("2026-12-01T03:04:05Z");
const CARIMBO = "20261201-030405";
// Endereço de conexão FALSO, com uma senha de mentira: nunca pode aparecer.
const SENHA = "SENHA-FALSA-do-banco-9c1e";
const CONEXAO = `postgresql://cli_login_postgres.${REF_SAVY}:${SENHA}@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`;

async function pastaTemp() {
  return await Deno.makeTempDir({ prefix: "copiar-banco-teste-" });
}

async function existe(caminho) {
  try {
    await Deno.stat(caminho);
    return true;
  } catch {
    return false;
  }
}

function saidaFalsa() {
  const linhas = [];
  return {
    saida: { log: (l) => linhas.push(l), erro: (l) => linhas.push(l) },
    linhas,
    tudo: () => linhas.join("\n"),
  };
}

/** Executor dublê: anota a chamada e escreve no arquivo de `-f` (nada roda).
 * `falhar` = índice da chamada que sai com código 1; `vazio` = a que escreve
 * arquivo vazio. Toda chamada "fala" o endereço de conexão, como um CLI
 * tagarela, para provar que a fala não chega à saída. */
function executorFalso({ falhar = -1, vazio = -1, lancar = -1 } = {}) {
  const chamadas = [];
  const executar = async (args, opcoes) => {
    const i = chamadas.length;
    chamadas.push({ args: [...args], opcoes });
    if (i === lancar) {
      const e = new Error(`spawn falhou em ${CONEXAO}`);
      e.code = "ENOENT";
      throw e;
    }
    const f = args[args.indexOf("-f") + 1];
    if (i !== falhar) {
      await Deno.writeTextFile(
        f,
        i === vazio ? "" : `-- dump ${i} FALSO\nSET x = 1;\n`,
      );
    }
    return {
      codigo: i === falhar ? 1 : 0,
      saida: `Dumping from ${CONEXAO}`,
      erro: `connection to ${CONEXAO} ok`,
    };
  };
  return { executar, chamadas };
}

async function rodar(argv, { env, executar, saida } = {}) {
  return await main(argv, {
    env,
    executar,
    agora: () => AGORA,
    saida: saida.saida,
  });
}

async function arquivosEm(pasta) {
  if (!(await existe(pasta))) return [];
  const nomes = [];
  for await (const e of Deno.readDir(pasta)) nomes.push(e.name);
  return nomes.sort();
}

const semConexao = (texto) => {
  assert(!texto.includes(SENHA), `a senha vazou: ${texto}`);
  assert(!texto.includes("postgresql://"), `o endereço vazou: ${texto}`);
  assert(!texto.includes("pooler.supabase.com"), `o host vazou: ${texto}`);
};

Deno.test("a pasta das cópias é %LOCALAPPDATA%\\ikcous\\copias; LOCALAPPDATA ausente ou relativo recusa", () => {
  assertEquals(
    pastaDasCopias({ LOCALAPPDATA: "C:\\Users\\X\\AppData\\Local" }),
    join("C:\\Users\\X\\AppData\\Local", "ikcous", "copias"),
  );
  for (const env of [{}, { LOCALAPPDATA: "" }, { LOCALAPPDATA: "relativo" }]) {
    let recusou = false;
    try {
      pastaDasCopias(env);
    } catch {
      recusou = true;
    }
    assert(recusou, JSON.stringify(env));
  }
});

Deno.test("sem --aplicar nada roda: nenhum comando, a pasta nem é criada, e o ensaio diz o que faria", async () => {
  const base = await pastaTemp();
  const ex = executorFalso();
  const s = saidaFalsa();
  const codigo = await rodar(["--loja", "savy"], {
    env: { LOCALAPPDATA: base },
    executar: ex.executar,
    saida: s,
  });
  assertEquals(codigo, 0, s.tudo());
  assertEquals(ex.chamadas.length, 0, "nenhum comando sem --aplicar");
  assertEquals(await arquivosEm(base), [], "nada criado");
  assertStringIncludes(s.tudo(), "ENSAIO");
  assertStringIncludes(s.tudo(), REF_SAVY);
  assertStringIncludes(s.tudo(), `savy-${REF_SAVY}-${CARIMBO}-esquema.sql`);
  assertStringIncludes(s.tudo(), `savy-${REF_SAVY}-${CARIMBO}-dados.sql`);
  assertStringIncludes(s.tudo(), "--aplicar");
  await Deno.remove(base, { recursive: true });
});

Deno.test("com --aplicar: esquema e dados pelo supabase db dump do ref do cadastro, .parcial vira o nome final só no fim", async () => {
  const base = await pastaTemp();
  const pasta = join(base, "ikcous", "copias");
  const ex = executorFalso();
  const s = saidaFalsa();
  const codigo = await rodar(["--loja", "savy", "--aplicar"], {
    env: { LOCALAPPDATA: base },
    executar: ex.executar,
    saida: s,
  });
  assertEquals(codigo, 0, s.tudo());
  const nome = `savy-${REF_SAVY}-${CARIMBO}`;
  assertEquals(ex.chamadas.length, 2, "esquema e dados");
  assertEquals(ex.chamadas[0].args, [
    "db",
    "dump",
    "--project-ref",
    REF_SAVY,
    "-f",
    join(pasta, `${nome}-esquema.sql.parcial`),
  ]);
  assertEquals(ex.chamadas[1].args, [
    "db",
    "dump",
    "--project-ref",
    REF_SAVY,
    "--data-only",
    "--use-copy",
    "-f",
    join(pasta, `${nome}-dados.sql.parcial`),
  ]);
  for (const c of ex.chamadas) {
    assertEquals(c.opcoes.cwd, pasta, "roda dentro da pasta das cópias");
    // nenhum endereço de conexão nem senha nos argumentos
    assert(!c.args.some((a) => /--db-url|--password|-p$|postgres/.test(a)));
  }
  assertEquals(await arquivosEm(pasta), [
    `${nome}-dados.sql`,
    `${nome}-esquema.sql`,
  ]);
  const tudo = s.tudo();
  semConexao(tudo);
  assertStringIncludes(tudo, "SIM");
  assertStringIncludes(tudo, `${nome}-esquema.sql`);
  await Deno.remove(base, { recursive: true });
});

Deno.test("pasta dentro de uma árvore git é recusada sem rodar nada nem criar a pasta", async () => {
  const base = await pastaTemp();
  await Deno.mkdir(join(base, ".git"));
  for (const argv of [
    ["--loja", "savy"],
    ["--loja", "savy", "--aplicar"],
  ]) {
    const ex = executorFalso();
    const s = saidaFalsa();
    const codigo = await rodar(argv, {
      env: { LOCALAPPDATA: base },
      executar: ex.executar,
      saida: s,
    });
    assertEquals(codigo, 1, s.tudo());
    assertEquals(ex.chamadas.length, 0);
    assertStringIncludes(s.tudo(), "árvore git");
    assertEquals(await arquivosEm(base), [".git"], "nada criado");
  }
  await Deno.remove(base, { recursive: true });
});

Deno.test("pasta dentro do repositório é recusada sem rodar nada", async () => {
  // nome único por rodada: um mutante que crie a pasta não contamina a próxima
  const dentro = join(RAIZ, `nao-existe-copiar-banco-${crypto.randomUUID()}`);
  try {
    const ex = executorFalso();
    const s = saidaFalsa();
    const codigo = await rodar(["--loja", "savy", "--aplicar"], {
      env: { LOCALAPPDATA: dentro },
      executar: ex.executar,
      saida: s,
    });
    assertEquals(codigo, 1, s.tudo());
    assertEquals(ex.chamadas.length, 0);
    assertStringIncludes(s.tudo(), "repositório");
    assert(!(await existe(dentro)), "nada criado dentro do repositório");
  } finally {
    // só a pasta DESTA rodada, se um defeito a tiver criado
    if (await existe(dentro)) await Deno.remove(dentro, { recursive: true });
  }
});

Deno.test("loja fora do cadastro, ref cru e nome torto são recusados sem rodar nada", async () => {
  const base = await pastaTemp();
  for (const loja of [
    "loja-inexistente",
    REF_SAVY,
    "__proto__",
    "constructor",
    "SAVY",
    "savy ",
  ]) {
    const ex = executorFalso();
    const s = saidaFalsa();
    const codigo = await rodar(["--loja", loja, "--aplicar"], {
      env: { LOCALAPPDATA: base },
      executar: ex.executar,
      saida: s,
    });
    assertEquals(codigo, 1, `${loja}: ${s.tudo()}`);
    assertEquals(ex.chamadas.length, 0, loja);
  }
  assertEquals(await arquivosEm(base), [], "nada criado");
  await Deno.remove(base, { recursive: true });
});

Deno.test("argv fora da forma é uso errado (2), sem ecoar o argumento e sem rodar nada", async () => {
  const base = await pastaTemp();
  for (const argv of [
    [],
    ["--aplicar"],
    ["--loja"],
    ["--loja", "savy", "--loja", "savy"],
    ["--loja", "savy", `--db-url=${CONEXAO}`],
    ["--loja", "savy", "--aplicar", CONEXAO],
  ]) {
    const ex = executorFalso();
    const s = saidaFalsa();
    const codigo = await rodar(argv, {
      env: { LOCALAPPDATA: base },
      executar: ex.executar,
      saida: s,
    });
    assertEquals(codigo, 2, `${argv.join(" ")}: ${s.tudo()}`);
    assertEquals(ex.chamadas.length, 0);
    semConexao(s.tudo());
  }
  await Deno.remove(base, { recursive: true });
});

Deno.test("dump que falha (esquema ou dados), arquivo vazio ou executor que lança: NÃO, nenhuma cópia pela metade, nada do CLI na saída", async () => {
  const casos = [
    ["esquema falha", { falhar: 0 }, 1],
    ["dados falham depois do esquema", { falhar: 1 }, 2],
    ["esquema vazio", { vazio: 0 }, 1],
    ["dados vazios", { vazio: 1 }, 2],
    ["executor lança (supabase ausente)", { lancar: 0 }, 1],
  ];
  for (const [caso, opcoes, chamadasEsperadas] of casos) {
    const base = await pastaTemp();
    const pasta = join(base, "ikcous", "copias");
    const ex = executorFalso(opcoes);
    const s = saidaFalsa();
    const codigo = await rodar(["--loja", "savy", "--aplicar"], {
      env: { LOCALAPPDATA: base },
      executar: ex.executar,
      saida: s,
    });
    assertEquals(codigo, 1, `${caso}: ${s.tudo()}`);
    assertEquals(ex.chamadas.length, chamadasEsperadas, caso);
    assertEquals(await arquivosEm(pasta), [], `${caso}: sobrou arquivo`);
    assertStringIncludes(s.tudo(), "NÃO", caso);
    semConexao(s.tudo());
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("cópia que já existe com o mesmo nome é recusada (nunca sobrescreve) sem rodar nada", async () => {
  const base = await pastaTemp();
  const pasta = join(base, "ikcous", "copias");
  await Deno.mkdir(pasta, { recursive: true });
  const nome = `savy-${REF_SAVY}-${CARIMBO}-dados.sql`;
  await Deno.writeTextFile(join(pasta, nome), "COPIA-ANTERIOR");
  const ex = executorFalso();
  const s = saidaFalsa();
  const codigo = await rodar(["--loja", "savy", "--aplicar"], {
    env: { LOCALAPPDATA: base },
    executar: ex.executar,
    saida: s,
  });
  assertEquals(codigo, 1, s.tudo());
  assertEquals(ex.chamadas.length, 0);
  assertEquals(await Deno.readTextFile(join(pasta, nome)), "COPIA-ANTERIOR");
  await Deno.remove(base, { recursive: true });
});

Deno.test("main sem executor injetado neste processo de teste recusa (sentinela), sem rodar o CLI real", async () => {
  const base = await pastaTemp();
  const s = saidaFalsa();
  const codigo = await main(["--loja", "savy", "--aplicar"], {
    env: { LOCALAPPDATA: base, IKCOUS_TESTE_SEM_COMANDO_REAL: "1" },
    agora: () => AGORA,
    saida: s.saida,
  });
  assertEquals(codigo, 1, s.tudo());
  assertStringIncludes(s.tudo(), "IKCOUS_TESTE_SEM_COMANDO_REAL");
  assertEquals(await arquivosEm(base), [], "nada criado");
  await Deno.remove(base, { recursive: true });
});
