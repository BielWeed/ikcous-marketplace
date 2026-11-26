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
 *  - a leitura sem eco recusa stdin que não é terminal e não ecoa a frase;
 *  - conflito no --importar: a mensagem diz que o cofre do PC costuma ser o
 *    MAIS NOVO e manda NÃO substituir (o refresh OAuth muda a cada renovação;
 *    o de um backup velho está morto). Com --substituir, as chaves em conflito
 *    são listadas, a palavra SUBSTITUIR é pedida no terminal e, antes de
 *    sobrescrever, o cofre ATUAL vira uma cópia cifrada ao lado do arquivo
 *    importado; sem confirmação ou sem cópia, nada é gravado;
 *  - main sem cofres injetados recusa neste processo de teste (sentinela
 *    IKCOUS_TESTE_SEM_COFRE_REAL): esquecer a injeção falha alto, nunca abre
 *    o cofre real.
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
import { decifrar } from "../scripts/frota/pacote-do-cofre.mjs";

// Sentinela: neste processo, main sem deps.cofres recusa em vez de abrir os
// cofres DPAPI de verdade (ANOTADO 3 da revisão).
Deno.env.set("IKCOUS_TESTE_SEM_COFRE_REAL", "1");

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
function deps(cofres, frases, extra = {}, confirmacoes = []) {
  const fila = [...frases];
  const filaConfirma = [...confirmacoes];
  const linhas = [];
  const perguntas = [];
  const confirmas = [];
  return {
    cofres,
    lerFrase: async (pergunta) => {
      perguntas.push(pergunta);
      if (fila.length === 0) throw new Error("frase pedida a mais");
      return fila.shift();
    },
    lerConfirmacao: async (pergunta) => {
      confirmas.push(pergunta);
      if (filaConfirma.length === 0) {
        throw new Error("confirmação pedida a mais");
      }
      return filaConfirma.shift();
    },
    confirmas,
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

/** Arquivos "cofre-antes-de-importar-*" na pasta. */
async function copiasEm(pasta) {
  const r = [];
  for await (const e of Deno.readDir(pasta)) {
    if (e.name.startsWith("cofre-antes-de-importar-")) r.push(e.name);
  }
  return r;
}

/** Backup de ACESSO+BANCO na pasta e um cofre-alvo com banco/loja-um
 * DIFERENTE (o conflito) e nada mais. */
async function cenarioDeConflito(pasta) {
  const destino = join(pasta, "backup.ikcous");
  assertEquals(
    (await exportar(await cofresCom(ACESSO, BANCO), destino)).codigo,
    0,
  );
  const alvo = await cofresCom({}, { "loja-um": "senha-NOVA-do-PC-FALSA" });
  return { destino, alvo };
}

const ANTES = { acesso: {}, banco: { "loja-um": "senha-NOVA-do-PC-FALSA" } };

Deno.test("importar com conflito sem --substituir: recusa, não grava nada e manda NÃO substituir", async () => {
  const pasta = await pastaTemp();
  try {
    const { destino, alvo } = await cenarioDeConflito(pasta);
    const im = deps(alvo, [FRASE]);
    assertEquals(await main(["--importar", destino], im), 1);
    const t = texto(im);
    assert(/banco\/loja-um/.test(t), t);
    assert(
      /mais novo/i.test(t),
      `não diz que o cofre do PC é o mais novo: ${t}`,
    );
    const naoSubstitua = t.search(/NÃO substitua/);
    assert(naoSubstitua >= 0, `não recomenda NÃO substituir: ${t}`);
    // --substituir nunca é a primeira saída: se aparece, é depois do aviso
    const sub = t.indexOf("--substituir");
    assert(
      sub === -1 || sub > naoSubstitua,
      `--substituir antes do aviso: ${t}`,
    );
    assertEquals(im.confirmas.length, 0);
    assertEquals(await conteudo(alvo), ANTES);
    assertEquals(await copiasEm(pasta), []);
  } finally {
    await Deno.remove(pasta, { recursive: true });
  }
});

Deno.test("--substituir com conflito e SEM a confirmação SUBSTITUIR: nada gravado, nem cópia", async () => {
  const pasta = await pastaTemp();
  try {
    const { destino, alvo } = await cenarioDeConflito(pasta);
    for (const resposta of ["", "sim", "substituir", "SUBSTITUI"]) {
      const im = deps(alvo, [FRASE], {}, [resposta]);
      assertEquals(
        await main(["--importar", destino, "--substituir"], im),
        1,
        resposta,
      );
      assertEquals(im.confirmas.length, 1, "não pediu a confirmação");
      // as chaves em conflito listadas (tipo e loja), nunca o valor
      assert(/banco\/loja-um/.test(texto(im)), texto(im));
      assert(!texto(im).includes("FALSA"), "valor na tela");
      assertEquals(await conteudo(alvo), ANTES);
      assertEquals(await copiasEm(pasta), []);
    }
    // confirmação que falha (terminal fechou, não é TTY): também nada
    const quebra = deps(alvo, [FRASE], {
      lerConfirmacao: async () => {
        throw new ErroDoBackup("não é terminal");
      },
    });
    assertEquals(
      await main(["--importar", destino, "--substituir"], quebra),
      1,
    );
    assertEquals(await conteudo(alvo), ANTES);
    assertEquals(await copiasEm(pasta), []);
  } finally {
    await Deno.remove(pasta, { recursive: true });
  }
});

Deno.test("--substituir com confirmação: cópia do cofre ANTIGO ao lado do arquivo, decifra para o antigo; depois grava", async () => {
  const pasta = await pastaTemp();
  try {
    const { destino, alvo } = await cenarioDeConflito(pasta);
    const im = deps(alvo, [FRASE], {}, ["SUBSTITUIR"]);
    assertEquals(
      await main(["--importar", destino, "--substituir"], im),
      0,
      texto(im),
    );
    assertEquals(await conteudo(alvo), { acesso: ACESSO, banco: BANCO });
    const copias = await copiasEm(pasta);
    assertEquals(copias.length, 1, texto(im));
    assert(/^cofre-antes-de-importar-.+\.ikcofre$/.test(copias[0]), copias[0]);
    const caminho = join(pasta, copias[0]);
    assert(texto(im).includes(caminho), `não disse o caminho: ${texto(im)}`);
    assertEquals(await decifrar(FRASE, await Deno.readFile(caminho)), {
      "banco/loja-um": "senha-NOVA-do-PC-FALSA",
    });
  } finally {
    await Deno.remove(pasta, { recursive: true });
  }
});

Deno.test("--substituir: se a cópia do cofre atual não grava, nada é sobrescrito", async () => {
  const pasta = await pastaTemp();
  try {
    const { destino, alvo } = await cenarioDeConflito(pasta);
    // o arquivo importado mora numa árvore git: a cópia ao lado é recusada
    const git = join(pasta, "repo");
    await Deno.mkdir(join(git, ".git"), { recursive: true });
    const dentro = join(git, "backup.ikcous");
    await Deno.copyFile(destino, dentro);
    const im = deps(alvo, [FRASE], {}, ["SUBSTITUIR"]);
    assertEquals(await main(["--importar", dentro, "--substituir"], im), 1);
    assert(/cópia/.test(texto(im)), texto(im));
    assertEquals(await conteudo(alvo), ANTES);
    assertEquals(await copiasEm(git), []);
  } finally {
    await Deno.remove(pasta, { recursive: true });
  }
});

Deno.test("--substituir sem conflito: não pede confirmação nem faz cópia", async () => {
  const pasta = await pastaTemp();
  try {
    const destino = join(pasta, "backup.ikcous");
    assertEquals(
      (await exportar(await cofresCom(ACESSO, BANCO), destino)).codigo,
      0,
    );
    const alvo = await cofresCom({}, BANCO);
    const im = deps(alvo, [FRASE]);
    assertEquals(
      await main(["--importar", destino, "--substituir"], im),
      0,
      texto(im),
    );
    assertEquals(im.confirmas.length, 0);
    assertEquals(await copiasEm(pasta), []);
    assertEquals(await conteudo(alvo), { acesso: ACESSO, banco: BANCO });
  } finally {
    await Deno.remove(pasta, { recursive: true });
  }
});

Deno.test("main sem cofres injetados recusa no processo de teste (sentinela), sem abrir cofre nenhum", async () => {
  const pasta = await pastaTemp();
  // se a sentinela sumir, o cofre "real" cai nesta pasta temporária vazia,
  // nunca no do PC (e o teste falha pela mensagem)
  const antes = Deno.env.get("LOCALAPPDATA");
  Deno.env.set("LOCALAPPDATA", pasta);
  try {
    const d = deps(undefined, [FRASE, FRASE]);
    d.cofres = undefined; // a injeção "esquecida"
    const destino = join(pasta, "backup.ikcous");
    assertEquals(await main(["--exportar", destino], d), 1);
    assert(/IKCOUS_TESTE_SEM_COFRE_REAL/.test(texto(d)), texto(d));
    assertEquals(d.perguntas.length, 0);
    assert(!(await existe(destino)));
  } finally {
    if (antes === undefined) Deno.env.delete("LOCALAPPDATA");
    else Deno.env.set("LOCALAPPDATA", antes);
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

Deno.test("lerFraseSemEco com mostrar (a confirmação): ecoa o que é digitado e o apagar", async () => {
  const eco = ecoFalso();
  const entrada = terminalFalso(["SUBSTITUIRX", "\b", "\r"]);
  const lida = await lerFraseSemEco("Digite SUBSTITUIR: ", {
    entrada,
    eco,
    mostrar: true,
  });
  assertEquals(lida, "SUBSTITUIR");
  assert(eco.escrito.join("").includes("SUBSTITUIRX\b \b"), "não ecoou");
  assertEquals(entrada.modoCru, [true, false]);
  // e continua recusando o que não é terminal
  await assertRejects(
    () =>
      lerFraseSemEco("x", {
        entrada: terminalFalso(["SUBSTITUIR\r"], { tty: false }),
        eco,
        mostrar: true,
      }),
    ErroDoBackup,
  );
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
