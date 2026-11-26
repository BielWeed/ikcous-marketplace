// @ts-nocheck
/**
 * Backup do cofre local (scripts/frota/backup-do-cofre.mjs), T10 do plano
 * "fechar o caminho de loja nova". O que este arquivo trava:
 *
 *  - ida e volta: --exportar de um cofre e --importar num cofre vazio dá o
 *    mesmo conteúdo (os dois cofres: acesso OAuth e senha do banco);
 *  - a frase só vem da leitura injetada (nunca de argv/env); duas digitações
 *    diferentes, ou espaço nas pontas, recusam sem gravar arquivo;
 *  - destino relativo, dentro de árvore git ou já existente (sem
 *    --substituir) é recusado;
 *  - depois de gravar, o arquivo é relido e decifrado: releitura que não bate
 *    não deixa nada no destino;
 *  - --importar com conflito (loja já no cofre com outro valor) recusa e não
 *    grava NADA, nem parcialmente; frase errada dá a mensagem genérica;
 *  - nenhum valor do cofre (canário) nem a frase aparece em saída ou erro;
 *  - argv com qualquer coisa fora das flags conhecidas é recusado antes de
 *    pedir frase, sem ecoar o argumento;
 *  - a leitura sem eco recusa stdin que não é terminal e não ecoa a frase.
 *
 * Os valores são FALSOS, inventados aqui; os cofres são os de MEMÓRIA e os
 * arquivos vão para pastas temporárias. Cada cifrar/decifrar roda o scrypt de
 * verdade (~0,4 s).
 */
import { EventEmitter } from "node:events";
import { fromFileUrl, join } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  ErroDoBackup,
  MENSAGEM_ESPACO_NAS_PONTAS,
  lerFraseSemEco,
  main,
} from "../scripts/frota/backup-do-cofre.mjs";
import { criarCofreMemoria } from "../scripts/frota/cofre-local.mjs";

const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const FRASE = "frase FALSA do backup, com ação ✓";
const CANARIO = "CANARIO-do-cofre-7f3a";
const ACESSO = {
  "loja-um": `{"refresh":"refresh-FALSO-um-${CANARIO}","segredo":"s3gr3d0-FALSO"}`,
  "loja-dois": `{"refresh":"refresh-FALSO-dois-${CANARIO}"}`,
};
const BANCO = { "loja-um": `senha-FALSA-ção-${CANARIO}` };

async function pastaTemp() {
  return await Deno.makeTempDir({ prefix: "backup-cofre-teste-" });
}

async function existe(caminho) {
  try {
    await Deno.stat(caminho);
    return true;
  } catch {
    return false;
  }
}

async function cofresCom(acesso = {}, banco = {}) {
  const c = { acesso: criarCofreMemoria(), banco: criarCofreMemoria() };
  for (const [s, v] of Object.entries(acesso)) await c.acesso.gravar(s, v);
  for (const [s, v] of Object.entries(banco)) await c.banco.gravar(s, v);
  return c;
}

async function conteudo(cofres) {
  const deUm = async (cofre) => {
    const pares = [];
    for (const s of await cofre.listar()) pares.push([s, await cofre.ler(s)]);
    return Object.fromEntries(pares);
  };
  return { acesso: await deUm(cofres.acesso), banco: await deUm(cofres.banco) };
}

/** Dependências falsas: as frases saem de uma fila; saída e erros anotados. */
function deps(cofres, frases, extra = {}) {
  const fila = [...frases];
  const linhas = [];
  const perguntas = [];
  return {
    cofres,
    lerFrase: async (pergunta) => {
      perguntas.push(pergunta);
      if (fila.length === 0) throw new Error("frase pedida a mais");
      return fila.shift();
    },
    saida: {
      log: (l) => linhas.push(`OUT ${l}`),
      erro: (l) => linhas.push(`ERR ${l}`),
    },
    linhas,
    perguntas,
    ...extra,
  };
}

const texto = (d) => d.linhas.join("\n");

async function exportar(cofres, destino, frases = [FRASE, FRASE], mais = []) {
  const d = deps(cofres, frases);
  const codigo = await main(["--exportar", destino, ...mais], d);
  return { codigo, d };
}

Deno.test("ida e volta: exporta e importa num cofre vazio, resultado igual", async () => {
  const pasta = await pastaTemp();
  try {
    const origem = await cofresCom(ACESSO, BANCO);
    const destino = join(pasta, "backup.ikcous");
    const ex = await exportar(origem, destino);
    assertEquals(ex.codigo, 0, texto(ex.d));
    assert(await existe(destino));
    assertEquals(ex.d.perguntas.length, 2, "a frase tem de ser pedida 2 vezes");
    assert(/OK/.test(texto(ex.d)) && /3 /.test(texto(ex.d)), texto(ex.d));
    // nenhum .tmp sobrando na pasta
    const nomes = [];
    for await (const e of Deno.readDir(pasta)) nomes.push(e.name);
    assertEquals(nomes, ["backup.ikcous"]);

    const alvo = await cofresCom();
    const im = deps(alvo, [FRASE]);
    assertEquals(await main(["--importar", destino], im), 0, texto(im));
    assertEquals(im.perguntas.length, 1, "no importar a frase é pedida 1 vez");
    assertEquals(await conteudo(alvo), { acesso: ACESSO, banco: BANCO });

    // de novo: tudo igual, nada muda (idempotente)
    const de_novo = deps(alvo, [FRASE]);
    assertEquals(await main(["--importar", destino], de_novo), 0);
    assertEquals(await conteudo(alvo), { acesso: ACESSO, banco: BANCO });
    assert(/iguais?\D*3|3\D*iguais?/.test(texto(de_novo)), texto(de_novo));
  } finally {
    await Deno.remove(pasta, { recursive: true });
  }
});

Deno.test("frases diferentes nas duas digitações: recusa sem gravar arquivo", async () => {
  const pasta = await pastaTemp();
  try {
    const destino = join(pasta, "backup.ikcous");
    const ex = await exportar(await cofresCom(ACESSO, BANCO), destino, [
      FRASE,
      `${FRASE}x`,
    ]);
    assertEquals(ex.codigo, 1);
    assert(/não batem/.test(texto(ex.d)), texto(ex.d));
    assert(!(await existe(destino)));
    for await (const _ of Deno.readDir(pasta))
      throw new Error("sobrou arquivo");
  } finally {
    await Deno.remove(pasta, { recursive: true });
  }
});

Deno.test("frase com espaço no começo ou no fim: recusa (exportar e importar)", async () => {
  const pasta = await pastaTemp();
  try {
    const destino = join(pasta, "backup.ikcous");
    for (const ruim of [` ${FRASE}`, `${FRASE} `, `${FRASE}\t`]) {
      const ex = await exportar(await cofresCom(ACESSO), destino, [ruim, ruim]);
      assertEquals(ex.codigo, 1);
      assert(texto(ex.d).includes(MENSAGEM_ESPACO_NAS_PONTAS), texto(ex.d));
      assert(!(await existe(destino)));
    }
    assertEquals(
      MENSAGEM_ESPACO_NAS_PONTAS,
      "a frase tem espaço no começo ou no fim; digite de novo sem ele",
    );
    // no importar também (a frase do backup nunca tem espaço nas pontas)
    assertEquals((await exportar(await cofresCom(ACESSO), destino)).codigo, 0);
    const alvo = await cofresCom();
    const im = deps(alvo, [`${FRASE} `]);
    assertEquals(await main(["--importar", destino], im), 1);
    assert(texto(im).includes(MENSAGEM_ESPACO_NAS_PONTAS), texto(im));
    assertEquals(await alvo.acesso.listar(), []);
  } finally {
    await Deno.remove(pasta, { recursive: true });
  }
});

Deno.test("destino relativo, dentro de árvore git ou do repositório: recusa sem pedir frase", async () => {
  const pasta = await pastaTemp();
  try {
    await Deno.mkdir(join(pasta, ".git"));
    await Deno.mkdir(join(pasta, "sub"));
    for (const destino of [
      "backup.ikcous",
      "./pasta/backup.ikcous",
      join(pasta, "sub", "backup.ikcous"),
      join(pasta, "backup.ikcous"),
      join(RAIZ, "backup.ikcous"),
    ]) {
      const ex = await exportar(await cofresCom(ACESSO), destino);
      assertEquals(ex.codigo, 1, destino);
      assertEquals(ex.d.perguntas.length, 0, "pediu frase antes de recusar");
    }
    assert(!(await existe(join(pasta, "sub", "backup.ikcous"))));
    assert(!(await existe(join(RAIZ, "backup.ikcous"))));
  } finally {
    await Deno.remove(pasta, { recursive: true });
  }
});

Deno.test("destino que já existe: recusa sem --substituir; com --substituir troca", async () => {
  const pasta = await pastaTemp();
  try {
    const destino = join(pasta, "backup.ikcous");
    await Deno.writeTextFile(destino, "backup antigo");
    const ex = await exportar(await cofresCom(ACESSO), destino);
    assertEquals(ex.codigo, 1);
    assertEquals(ex.d.perguntas.length, 0);
    assertEquals(await Deno.readTextFile(destino), "backup antigo");

    const sub = await exportar(await cofresCom(ACESSO), destino, undefined, [
      "--substituir",
    ]);
    assertEquals(sub.codigo, 0, texto(sub.d));
    const alvo = await cofresCom();
    assertEquals(await main(["--importar", destino], deps(alvo, [FRASE])), 0);
    assertEquals(await conteudo(alvo), { acesso: ACESSO, banco: {} });
  } finally {
    await Deno.remove(pasta, { recursive: true });
  }
});

Deno.test("cofre vazio: recusa exportar (um backup vazio não recupera nada)", async () => {
  const pasta = await pastaTemp();
  try {
    const destino = join(pasta, "backup.ikcous");
    const ex = await exportar(await cofresCom(), destino);
    assertEquals(ex.codigo, 1);
    assert(!(await existe(destino)));
  } finally {
    await Deno.remove(pasta, { recursive: true });
  }
});

Deno.test("releitura que não bate (disco devolveu outra coisa): erro e nada no destino", async () => {
  const pasta = await pastaTemp();
  try {
    const destino = join(pasta, "backup.ikcous");
    const d = deps(await cofresCom(ACESSO, BANCO), [FRASE, FRASE], {
      lerArquivo: async (caminho) => {
        const b = await Deno.readFile(caminho);
        b[b.length - 1] ^= 0x01; // o último byte (etiqueta do GCM) estragado
        return b;
      },
    });
    assertEquals(await main(["--exportar", destino], d), 1);
    assert(/relei/.test(texto(d)), texto(d));
    assert(!(await existe(destino)), "ficou arquivo que não confere");
    for await (const _ of Deno.readDir(pasta)) throw new Error("sobrou .tmp");
  } finally {
    await Deno.remove(pasta, { recursive: true });
  }
});

Deno.test("importar com conflito sem --substituir: recusa e não grava nada; com --substituir grava", async () => {
  const pasta = await pastaTemp();
  try {
    const destino = join(pasta, "backup.ikcous");
    assertEquals(
      (await exportar(await cofresCom(ACESSO, BANCO), destino)).codigo,
      0,
    );
    // loja-um já no cofre do banco com OUTRA senha; o resto falta
    const alvo = await cofresCom({}, { "loja-um": "outra-senha-FALSA" });
    const im = deps(alvo, [FRASE]);
    assertEquals(await main(["--importar", destino], im), 1);
    assert(/loja-um/.test(texto(im)) && /--substituir/.test(texto(im)));
    assertEquals(await conteudo(alvo), {
      acesso: {},
      banco: { "loja-um": "outra-senha-FALSA" },
    });

    const sub = deps(alvo, [FRASE]);
    assertEquals(
      await main(["--importar", destino, "--substituir"], sub),
      0,
      texto(sub),
    );
    assertEquals(await conteudo(alvo), { acesso: ACESSO, banco: BANCO });
  } finally {
    await Deno.remove(pasta, { recursive: true });
  }
});

Deno.test("importar: loja travada por outra operação = recusa e nada gravado", async () => {
  const pasta = await pastaTemp();
  try {
    const destino = join(pasta, "backup.ikcous");
    assertEquals(
      (await exportar(await cofresCom(ACESSO, BANCO), destino)).codigo,
      0,
    );
    const alvo = await cofresCom();
    const liberar = await alvo.acesso.travar("loja-dois");
    const im = deps(alvo, [FRASE]);
    assertEquals(await main(["--importar", destino], im), 1);
    assertEquals(await conteudo(alvo), { acesso: {}, banco: {} });
    await liberar();
    // as travas que o importar pegou foram soltas
    await (await alvo.acesso.travar("loja-um"))();
    await (await alvo.banco.travar("loja-um"))();
  } finally {
    await Deno.remove(pasta, { recursive: true });
  }
});

Deno.test("frase errada no importar: mensagem genérica e nada gravado", async () => {
  const pasta = await pastaTemp();
  try {
    const destino = join(pasta, "backup.ikcous");
    assertEquals(
      (await exportar(await cofresCom(ACESSO, BANCO), destino)).codigo,
      0,
    );
    const alvo = await cofresCom();
    const im = deps(alvo, ["outra frase FALSA comprida"]);
    assertEquals(await main(["--importar", destino], im), 1);
    assert(texto(im).includes("frase errada ou arquivo danificado"), texto(im));
    assertEquals(await conteudo(alvo), { acesso: {}, banco: {} });
  } finally {
    await Deno.remove(pasta, { recursive: true });
  }
});

Deno.test("canário: valor do cofre e frase nunca aparecem em saída nem em erro", async () => {
  const pasta = await pastaTemp();
  const tudo = [];
  try {
    const destino = join(pasta, "backup.ikcous");
    const casos = [
      async () => exportar(await cofresCom(ACESSO, BANCO), destino),
      async () => exportar(await cofresCom(ACESSO, BANCO), destino),
      async () => {
        const d = deps(await cofresCom(), [FRASE]);
        return { codigo: await main(["--importar", destino], d), d };
      },
      async () => {
        const d = deps(await cofresCom({ "loja-um": "x-FALSO" }), [FRASE]);
        return { codigo: await main(["--importar", destino], d), d };
      },
      async () => {
        const d = deps(await cofresCom(), ["outra frase FALSA comprida"]);
        return { codigo: await main(["--importar", destino], d), d };
      },
      async () => {
        // cofre que explode na gravação com o valor na mensagem
        const c = await cofresCom();
        c.acesso.gravar = async (_s, v) => {
          throw new Error(`falhou gravando ${v}`);
        };
        const d = deps(c, [FRASE]);
        return { codigo: await main(["--importar", destino], d), d };
      },
      async () => {
        const c = await cofresCom(ACESSO, BANCO);
        c.banco.ler = async () => {
          throw new Error(`falhou lendo ${BANCO["loja-um"]}`);
        };
        const d = deps(c, [FRASE, FRASE]);
        const outro = join(pasta, "outro.ikcous");
        return { codigo: await main(["--exportar", outro], d), d };
      },
    ];
    for (const caso of casos) {
      let r;
      try {
        r = await caso();
      } catch (e) {
        tudo.push(`LANÇOU ${e?.message}\n${e?.stack}`);
        continue;
      }
      tudo.push(texto(r.d), ...r.d.perguntas);
    }
    const junto = tudo.join("\n");
    assert(!junto.includes(CANARIO), "valor do cofre na saída");
    assert(!junto.includes("FALSO-um"), "valor do cofre na saída");
    assert(!junto.includes(FRASE), "a frase na saída");
  } finally {
    await Deno.remove(pasta, { recursive: true });
  }
});

Deno.test("argv fora das flags conhecidas: recusa (código 2) sem pedir frase e sem ecoar", async () => {
  const pasta = await pastaTemp();
  try {
    const destino = join(pasta, "backup.ikcous");
    const SEGREDO = "minha-frase-SECRETA-no-argv";
    for (const argv of [
      [],
      ["--exportar"],
      ["--importar"],
      ["--exportar", destino, SEGREDO],
      ["--exportar", destino, "--frase", SEGREDO],
      [`--frase=${SEGREDO}`, "--exportar", destino],
      [`--exportar=${destino}`],
      ["--exportar", destino, "--importar", destino],
      ["--exportar", destino, "--substituir", "--substituir"],
      ["--exportar", `--${SEGREDO}`],
      ["--substituir"],
      [SEGREDO],
    ]) {
      const d = deps(await cofresCom(ACESSO), [FRASE, FRASE]);
      assertEquals(await main(argv, d), 2, argv.join(" "));
      assertEquals(d.perguntas.length, 0, "pediu frase");
      assert(!texto(d).includes(SEGREDO), `ecoou o argumento: ${texto(d)}`);
      assert(!(await existe(destino)));
    }
  } finally {
    await Deno.remove(pasta, { recursive: true });
  }
});

// ---------------------------------------------------- leitura sem eco --

/** stdin falso de terminal: emite os pedaços quando lido. */
function terminalFalso(pedacos, { tty = true } = {}) {
  const e = new EventEmitter();
  e.isTTY = tty;
  e.modoCru = [];
  e.setRawMode = (v) => {
    e.modoCru.push(v);
    return e;
  };
  e.setEncoding = () => e;
  e.resume = () => {
    queueMicrotask(() => {
      for (const p of pedacos) e.emit("data", p);
    });
    return e;
  };
  e.pause = () => e;
  return e;
}

function ecoFalso() {
  const escrito = [];
  return { escrito, write: (t) => escrito.push(String(t)) };
}

Deno.test("lerFraseSemEco: stdin que não é terminal é recusado (nunca lê com eco)", async () => {
  const eco = ecoFalso();
  await assertRejects(
    () =>
      lerFraseSemEco("Frase: ", {
        entrada: terminalFalso([`${FRASE}\r`], { tty: false }),
        eco,
      }),
    ErroDoBackup,
  );
  await assertRejects(
    () => lerFraseSemEco("Frase: ", { entrada: { isTTY: true }, eco }),
    ErroDoBackup,
  );
});

Deno.test("lerFraseSemEco: lê em modo cru, apaga com backspace, não ecoa e restaura o terminal", async () => {
  const eco = ecoFalso();
  const entrada = terminalFalso(["frase FALSA", "X\b", "\x7f", "A longa ç\r"]);
  const lida = await lerFraseSemEco("Frase: ", { entrada, eco });
  assertEquals(lida, "frase FALSA longa ç");
  assertEquals(entrada.modoCru, [true, false]);
  assert(!eco.escrito.join("").includes("FALSA"), "ecoou a frase");
  assert(eco.escrito.join("").includes("Frase: "));
});

Deno.test("lerFraseSemEco: Ctrl+C cancela e restaura o terminal", async () => {
  const entrada = terminalFalso(["frase FALSA\u0003"]);
  await assertRejects(
    () => lerFraseSemEco("Frase: ", { entrada, eco: ecoFalso() }),
    ErroDoBackup,
  );
  assertEquals(entrada.modoCru, [true, false]);
});

Deno.test("lerFraseSemEco: caractere de controle (seta, tab) recusa a frase", async () => {
  const entrada = terminalFalso(["frase FALSA\u001b[Acomprida\r"]);
  await assertRejects(
    () => lerFraseSemEco("Frase: ", { entrada, eco: ecoFalso() }),
    ErroDoBackup,
  );
  assertEquals(entrada.modoCru, [true, false]);
});
