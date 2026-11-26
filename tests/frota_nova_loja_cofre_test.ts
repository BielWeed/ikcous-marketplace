// @ts-nocheck
/**
 * Cofre local do acesso OAuth (scripts/frota/cofre-local.mjs), peça T3 do L4b.
 * O que este arquivo trava:
 *
 *  - o contrato ler/gravar/apagar/travar, igual nas duas implementações
 *    (memória e DPAPI do Windows);
 *  - slug validado (o mesmo padrão do cadastro de lojas) antes de tocar disco;
 *  - DPAPI: o valor vai ao PowerShell por STDIN, NUNCA na linha de comando
 *    (nem cru, nem em base64); o arquivo em disco não tem o valor; falha do
 *    PowerShell não ecoa o valor e não estraga o que já estava gravado;
 *  - recusa pasta dentro do repositório (ou de qualquer árvore git);
 *  - `travar` recusa a segunda trava da mesma loja (arquivo aberto com "wx"),
 *    inclusive vinda de outra instância (outro processo); se a marca não
 *    chega a ser escrita, a trava criada é apagada (só se ainda for a nossa)
 *    e o erro é ErroDoCofre TRAVA_NAO_GRAVOU, sem caminho.
 *
 * O teste com DPAPI DE VERDADE só roda no Windows (no CI Linux ele é pulado),
 * numa pasta temporária, com um valor FALSO inventado, e apaga tudo no fim.
 */
import { open } from "node:fs/promises";
import { fromFileUrl, join } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  CofreTravado,
  ErroDoCofre,
  SCRIPT_CIFRAR,
  SCRIPT_DECIFRAR,
  criarCofreDpapi,
  criarCofreMemoria,
  pastaPadraoDoCofre,
} from "../scripts/frota/cofre-local.mjs";

const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const VALOR =
  '{"refresh":"refresh-FALSO-inventado-xyz","segredo":"s3gr3d0-FALSO"}';
const b64 = (t) => btoa(String.fromCharCode(...new TextEncoder().encode(t)));
const SLUGS_RUINS = [
  "",
  "A",
  "a",
  "Loja",
  "../x",
  "a/b",
  "a\\b",
  "1loja",
  "loja.dpapi",
  "loja\n",
  `l${"o".repeat(40)}`,
  undefined,
  42,
];

/** Decodifica o -EncodedCommand (UTF-16LE em base64) para saber o script. */
function scriptDoArgs(args) {
  const i = args.indexOf("-EncodedCommand");
  const bin = atob(args[i + 1]);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-16le").decode(bytes);
}

/**
 * Executor falso de processo: "cifra" virando hex de "FALSO|"+entrada e
 * "decifra" desfazendo isso. Anota comando, argumentos, entrada e env.
 */
function executorFalso({ falharCom } = {}) {
  const chamadas = [];
  const hex = (t) =>
    Array.from(new TextEncoder().encode(t), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  const deHex = (h) =>
    new TextDecoder().decode(
      Uint8Array.from(h.match(/../g), (x) => Number.parseInt(x, 16)),
    );
  const ex = async (comando, args, opcoes) => {
    chamadas.push({ comando, args, ...opcoes });
    if (falharCom) return falharCom(opcoes);
    const script = scriptDoArgs(args);
    if (script === SCRIPT_CIFRAR) {
      return {
        codigo: 0,
        saida: hex(`FALSO|${opcoes.entrada.trim()}`),
        erro: "",
      };
    }
    if (script === SCRIPT_DECIFRAR) {
      const claro = deHex(opcoes.entrada.trim());
      assert(claro.startsWith("FALSO|"));
      return { codigo: 0, saida: claro.slice(6), erro: "" };
    }
    throw new Error("script inesperado");
  };
  ex.chamadas = chamadas;
  return ex;
}

async function pastaTemp() {
  return await Deno.makeTempDir({ prefix: "cofre-frota-teste-" });
}

// ---------------------------------------------------------------- contrato --

function contrato(nome, fabricar) {
  Deno.test(`[${nome}] ler de loja sem nada devolve null`, async () => {
    const { cofre, fim } = await fabricar();
    try {
      assertEquals(await cofre.ler("loja-nova"), null);
    } finally {
      await fim();
    }
  });

  Deno.test(`[${nome}] gravar → ler devolve o mesmo; regravar substitui`, async () => {
    const { cofre, fim } = await fabricar();
    try {
      await cofre.gravar("loja-nova", VALOR);
      assertEquals(await cofre.ler("loja-nova"), VALOR);
      await cofre.gravar("loja-nova", `${VALOR}-2`);
      assertEquals(await cofre.ler("loja-nova"), `${VALOR}-2`);
      assertEquals(await cofre.ler("outra-loja"), null);
    } finally {
      await fim();
    }
  });

  Deno.test(`[${nome}] apagar some com o valor e é idempotente`, async () => {
    const { cofre, fim } = await fabricar();
    try {
      await cofre.gravar("loja-nova", VALOR);
      await cofre.apagar("loja-nova");
      assertEquals(await cofre.ler("loja-nova"), null);
      await cofre.apagar("loja-nova");
      await cofre.apagar("nunca-gravada");
    } finally {
      await fim();
    }
  });

  Deno.test(`[${nome}] slug inválido é recusado em todas as operações`, async () => {
    const { cofre, fim } = await fabricar();
    try {
      for (const slug of SLUGS_RUINS) {
        await assertRejects(() => cofre.ler(slug), ErroDoCofre);
        await assertRejects(() => cofre.gravar(slug, VALOR), ErroDoCofre);
        await assertRejects(() => cofre.apagar(slug), ErroDoCofre);
        await assertRejects(() => cofre.travar(slug), ErroDoCofre);
      }
    } finally {
      await fim();
    }
  });

  Deno.test(`[${nome}] valor vazio ou não-texto é recusado`, async () => {
    const { cofre, fim } = await fabricar();
    try {
      for (const v of ["", undefined, null, 42, { a: 1 }]) {
        await assertRejects(() => cofre.gravar("loja-nova", v), ErroDoCofre);
      }
      assertEquals(await cofre.ler("loja-nova"), null);
    } finally {
      await fim();
    }
  });

  Deno.test(`[${nome}] travar: a segunda trava da mesma loja é recusada`, async () => {
    const { cofre, fim } = await fabricar();
    try {
      const liberar = await cofre.travar("loja-nova");
      await assertRejects(() => cofre.travar("loja-nova"), CofreTravado);
      // outra loja não é afetada
      const liberarOutra = await cofre.travar("outra-loja");
      await liberarOutra();
      await liberar();
      // liberar duas vezes não quebra nem solta trava alheia
      await liberar();
      const deNovo = await cofre.travar("loja-nova");
      await assertRejects(() => cofre.travar("loja-nova"), CofreTravado);
      await liberar(); // liberador VELHO não pode soltar a trava nova
      await assertRejects(() => cofre.travar("loja-nova"), CofreTravado);
      await deNovo();
    } finally {
      await fim();
    }
  });

  Deno.test(`[${nome}] listar: vazio = [], depois só as lojas gravadas (em ordem), sem trava`, async () => {
    const { cofre, fim } = await fabricar();
    try {
      assertEquals(await cofre.listar(), []);
      await cofre.gravar("zeta-loja", VALOR);
      await cofre.gravar("alfa-loja", VALOR);
      const liberar = await cofre.travar("so-travada");
      const liberarB = await cofre.travar("alfa-loja");
      assertEquals(await cofre.listar(), ["alfa-loja", "zeta-loja"]);
      await liberar();
      await liberarB();
      await cofre.apagar("zeta-loja");
      assertEquals(await cofre.listar(), ["alfa-loja"]);
    } finally {
      await fim();
    }
  });

  Deno.test(`[${nome}] CofreTravado é ErroDoCofre`, () => {
    assert(new CofreTravado("x") instanceof ErroDoCofre);
  });
}

contrato("memória", () => {
  const cofre = criarCofreMemoria();
  return { cofre, fim: async () => {} };
});

contrato("dpapi com executor falso", async () => {
  const pasta = await pastaTemp();
  const cofre = criarCofreDpapi({ pasta, executar: executorFalso() });
  return {
    cofre,
    fim: () => Deno.remove(pasta, { recursive: true }),
  };
});

// ----------------------------------------------------- DPAPI (executor falso) --

Deno.test("[dpapi] o valor vai por STDIN, nunca na linha de comando", async () => {
  const pasta = await pastaTemp();
  try {
    const ex = executorFalso();
    // ambiente de quem chama vindo do PowerShell 7 (o caso que quebra o 5.1)
    const env = {
      SystemRoot: "C:\\Windows",
      PSModulePath:
        "C:\\Users\\X\\Documents\\PowerShell\\Modules;C:\\Program Files\\PowerShell\\7\\Modules;C:\\Windows\\system32\\WindowsPowerShell\\v1.0\\Modules",
    };
    const cofre = criarCofreDpapi({ pasta, executar: ex, env });
    await cofre.gravar("loja-nova", VALOR);
    assertEquals(await cofre.ler("loja-nova"), VALOR);
    assertEquals(ex.chamadas.length, 2);
    for (const c of ex.chamadas) {
      const linha = [c.comando, ...c.args].join(" ");
      assert(!linha.includes(VALOR), "valor cru na linha de comando");
      assert(
        !linha.includes(b64(VALOR)),
        "valor em base64 na linha de comando",
      );
      assert(
        !linha.includes("refresh-FALSO"),
        "trecho do valor na linha de comando",
      );
      // caminho absoluto do Windows PowerShell 5.1 (nada de achar pelo PATH)
      assertEquals(
        c.comando,
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      );
      assert(c.args.includes("-NoProfile"));
      assert(c.args.includes("-NonInteractive"));
      assert(c.args.includes("-EncodedCommand"));
      // só os módulos do 5.1 (os do PowerShell 7 quebram o Security)
      assertEquals(
        c.env.PSModulePath,
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules",
      );
    }
    // cifrar recebeu o valor (em base64) por stdin; decifrar recebeu o cifrado
    assertEquals(ex.chamadas[0].entrada.trim(), b64(VALOR));
    assertEquals(scriptDoArgs(ex.chamadas[0].args), SCRIPT_CIFRAR);
    assertEquals(scriptDoArgs(ex.chamadas[1].args), SCRIPT_DECIFRAR);
    assert(!ex.chamadas[1].entrada.includes(VALOR));
  } finally {
    await Deno.remove(pasta, { recursive: true });
  }
});

Deno.test("[dpapi] os scripts usam DPAPI do usuário (sem -Key) e leem stdin", () => {
  for (const s of [SCRIPT_CIFRAR, SCRIPT_DECIFRAR]) {
    assert(s.includes("[Console]::In.ReadToEnd()"));
    assert(
      !/-Key\b|-SecureKey\b/i.test(s),
      "chave fixa tira o escopo do usuário",
    );
    assert(s.includes("$ErrorActionPreference = 'Stop'"));
  }
  assert(SCRIPT_CIFRAR.includes("ConvertTo-SecureString"));
  assert(SCRIPT_CIFRAR.includes("ConvertFrom-SecureString"));
  assert(SCRIPT_DECIFRAR.includes("ConvertTo-SecureString"));
  assert(SCRIPT_DECIFRAR.includes("ZeroFreeBSTR"));
});

Deno.test("[dpapi] o arquivo fica em <pasta>/<slug>.dpapi e não tem o valor", async () => {
  const pasta = await pastaTemp();
  try {
    const cofre = criarCofreDpapi({ pasta, executar: executorFalso() });
    await cofre.gravar("loja-nova", VALOR);
    const nomes = [];
    for await (const e of Deno.readDir(pasta)) nomes.push(e.name);
    assertEquals(nomes, ["loja-nova.dpapi"], "sobrou arquivo temporário");
    const texto = await Deno.readTextFile(join(pasta, "loja-nova.dpapi"));
    assert(!texto.includes(VALOR));
    assert(!texto.includes(b64(VALOR)));
    assert(!texto.includes("refresh-FALSO"));
  } finally {
    await Deno.remove(pasta, { recursive: true });
  }
});

Deno.test("[dpapi] ler loja sem arquivo não chama o PowerShell", async () => {
  const pasta = await pastaTemp();
  try {
    const ex = executorFalso();
    const cofre = criarCofreDpapi({ pasta, executar: ex });
    assertEquals(await cofre.ler("loja-nova"), null);
    assertEquals(ex.chamadas.length, 0);
  } finally {
    await Deno.remove(pasta, { recursive: true });
  }
});

Deno.test("[dpapi] PowerShell falha: erro sem o valor e o gravado antes fica intacto", async () => {
  const pasta = await pastaTemp();
  try {
    const bom = criarCofreDpapi({ pasta, executar: executorFalso() });
    await bom.gravar("loja-nova", VALOR);
    const antes = await Deno.readTextFile(join(pasta, "loja-nova.dpapi"));

    const quebrado = criarCofreDpapi({
      pasta,
      executar: executorFalso({
        falharCom: (o) => ({
          codigo: 1,
          saida: o.entrada,
          erro: `ConvertTo-SecureString falhou com ${atob(o.entrada.trim())}`,
        }),
      }),
    });
    const e = await quebrado
      .gravar("loja-nova", "novo-valor-FALSO-que-falha")
      .then(
        () => null,
        (x) => x,
      );
    assert(e instanceof ErroDoCofre, "não lançou ErroDoCofre");
    const tudo = `${e.message}\n${e.stack}\n${JSON.stringify(e)}`;
    assert(!tudo.includes("novo-valor-FALSO-que-falha"));
    assert(!tudo.includes(b64("novo-valor-FALSO-que-falha")));
    assertEquals(
      await Deno.readTextFile(join(pasta, "loja-nova.dpapi")),
      antes,
    );
    assertEquals(await bom.ler("loja-nova"), VALOR);

    const eLer = await quebrado.ler("loja-nova").then(
      () => null,
      (x) => x,
    );
    assert(eLer instanceof ErroDoCofre);
    assert(!`${eLer.message}`.includes(VALOR));
  } finally {
    await Deno.remove(pasta, { recursive: true });
  }
});

Deno.test("[dpapi] saída estranha do PowerShell é recusada (não grava lixo)", async () => {
  const pasta = await pastaTemp();
  try {
    for (const saida of ["", "não-é-hex", "abc"]) {
      const cofre = criarCofreDpapi({
        pasta,
        executar: executorFalso({
          falharCom: () => ({ codigo: 0, saida, erro: "" }),
        }),
      });
      await assertRejects(() => cofre.gravar("loja-nova", VALOR), ErroDoCofre);
    }
    const nomes = [];
    for await (const e of Deno.readDir(pasta)) nomes.push(e.name);
    assertEquals(nomes, []);
  } finally {
    await Deno.remove(pasta, { recursive: true });
  }
});

Deno.test("[dpapi] arquivo adulterado (sem o cabeçalho) é recusado", async () => {
  const pasta = await pastaTemp();
  try {
    const ex = executorFalso();
    const cofre = criarCofreDpapi({ pasta, executar: ex });
    await Deno.writeTextFile(join(pasta, "loja-nova.dpapi"), "deadbeef\n");
    await assertRejects(() => cofre.ler("loja-nova"), ErroDoCofre);
    assertEquals(ex.chamadas.length, 0);
  } finally {
    await Deno.remove(pasta, { recursive: true });
  }
});

Deno.test("[dpapi] listar: só <slug>.dpapi com slug válido; arquivo estranho, .trava, .tmp e pasta ficam de fora; nada é decifrado", async () => {
  const pasta = await pastaTemp();
  try {
    const ex = executorFalso();
    const cofre = criarCofreDpapi({ pasta, executar: ex });
    // conteúdo que nem é do formato do cofre: listar não abre o arquivo
    await Deno.writeTextFile(join(pasta, "loja-boa.dpapi"), "lixo\n");
    await Deno.writeTextFile(join(pasta, "outra-boa.dpapi"), "lixo\n");
    for (const estranho of [
      "LEIA-ME.txt",
      "Loja.dpapi",
      "1loja.dpapi",
      "a.dpapi",
      "loja_x.dpapi",
      "loja-boa.dpapi.a1b2c3.tmp",
      "loja-boa.trava",
      ".dpapi",
      "loja-boa.dpapi.bak",
    ]) {
      await Deno.writeTextFile(join(pasta, estranho), "x");
    }
    await Deno.mkdir(join(pasta, "uma-pasta.dpapi"));
    assertEquals(await cofre.listar(), ["loja-boa", "outra-boa"]);
    assertEquals(ex.chamadas.length, 0, "listar chamou o PowerShell");
  } finally {
    await Deno.remove(pasta, { recursive: true });
  }
});

Deno.test("[dpapi] listar: pasta do cofre inexistente devolve [] e não cria a pasta", async () => {
  const raiz = await pastaTemp();
  try {
    const pasta = join(raiz, "ainda", "nao-existe");
    const cofre = criarCofreDpapi({ pasta, executar: executorFalso() });
    assertEquals(await cofre.listar(), []);
    assertEquals(await nomesNaPasta(raiz), [], "listar criou a pasta");
  } finally {
    await Deno.remove(raiz, { recursive: true });
  }
});

Deno.test("[dpapi] a trava é por arquivo: outra instância (outro processo) também é recusada", async () => {
  const pasta = await pastaTemp();
  try {
    const a = criarCofreDpapi({ pasta, executar: executorFalso() });
    const b = criarCofreDpapi({ pasta, executar: executorFalso() });
    const liberar = await a.travar("loja-nova");
    const e = await b.travar("loja-nova").then(
      () => null,
      (x) => x,
    );
    assert(e instanceof CofreTravado);
    assert(
      e.message.includes("loja-nova.trava"),
      "não diz qual arquivo segura a trava",
    );
    await liberar();
    const liberarB = await b.travar("loja-nova");
    await liberarB();
    const nomes = [];
    for await (const x of Deno.readDir(pasta)) nomes.push(x.name);
    assertEquals(nomes, [], "a trava não foi removida ao liberar");
  } finally {
    await Deno.remove(pasta, { recursive: true });
  }
});

Deno.test("[dpapi] trava órfã apagada à mão: o liberador antigo não solta a trava de quem travou depois", async () => {
  const pasta = await pastaTemp();
  try {
    const a = criarCofreDpapi({ pasta, executar: executorFalso() });
    const b = criarCofreDpapi({ pasta, executar: executorFalso() });
    const liberarA = await a.travar("loja-nova");
    // o dono apaga o arquivo achando que A morreu; B trava em seguida
    await Deno.remove(join(pasta, "loja-nova.trava"));
    const liberarB = await b.travar("loja-nova");
    await liberarA(); // A acorda e "libera": não pode apagar a trava de B
    await assertRejects(() => a.travar("loja-nova"), CofreTravado);
    await liberarB();
    const liberarDeNovo = await a.travar("loja-nova");
    await liberarDeNovo();
  } finally {
    await Deno.remove(pasta, { recursive: true });
  }
});

/**
 * open() de verdade, mas o handle da TRAVA falha ao escrever (disco cheio,
 * antivírus). `antes(caminho, h, marca)` roda dentro da escrita, antes da falha: para
 * escrever metade da marca ou simular outro processo no arquivo. A mensagem do
 * erro de baixo nível leva o caminho, para provar que ele não vaza.
 */
function abrirQueFalhaNaTrava(antes = async () => {}) {
  return async (caminho, flags, modo) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- o caminho vem do próprio cofre, numa pasta temporária do teste.
    const h = await open(caminho, flags, modo);
    if (!String(caminho).endsWith(".trava")) return h;
    return {
      async writeFile(dados) {
        await antes(caminho, h, String(dados));
        throw Object.assign(new Error(`EIO: falha ao escrever ${caminho}`), {
          code: "EIO",
        });
      },
      close: () => h.close(),
    };
  };
}

async function nomesNaPasta(pasta) {
  const nomes = [];
  for await (const e of Deno.readDir(pasta)) nomes.push(e.name);
  return nomes.sort();
}

Deno.test("[dpapi] trava: escrita da marca falha = ErroDoCofre próprio, sem caminho, e a trava NÃO fica órfã", async () => {
  const pasta = await pastaTemp();
  try {
    for (const antes of [
      async () => {}, // nada escrito
      async (_c, h, marca) => {
        await h.write(marca.slice(0, Math.floor(marca.length / 2))); // metade da marca
      },
    ]) {
      const cofre = criarCofreDpapi({
        pasta,
        executar: executorFalso(),
        abrirArquivo: abrirQueFalhaNaTrava(antes),
      });
      const e = await cofre.travar("loja-nova").then(
        () => null,
        (x) => x,
      );
      assert(e instanceof ErroDoCofre, "o erro subiu cru (não é ErroDoCofre)");
      assert(!(e instanceof CofreTravado), "não é a loja travada por outro");
      assertEquals(e.codigo, "TRAVA_NAO_GRAVOU");
      const tudo = `${e.message}\n${JSON.stringify(e)}`;
      assert(!tudo.includes(pasta), "a mensagem carrega o caminho do cofre");
      assert(!tudo.includes("EIO"), "a mensagem carrega o erro de baixo nível");
      assertEquals(await nomesNaPasta(pasta), [], "a trava ficou órfã");
      // e a loja continua travável por quem vier depois
      const liberar = await criarCofreDpapi({
        pasta,
        executar: executorFalso(),
      }).travar("loja-nova");
      await liberar();
    }
  } finally {
    await Deno.remove(pasta, { recursive: true });
  }
});

Deno.test("[dpapi] trava: escrita falha mas o arquivo já não é o nosso = não apaga a trava alheia", async () => {
  const pasta = await pastaTemp();
  try {
    const alheia = "99999 2026-11-26T00:00:00.000Z outro-processo";
    const cofre = criarCofreDpapi({
      pasta,
      executar: executorFalso(),
      abrirArquivo: abrirQueFalhaNaTrava(async (caminho) => {
        await Deno.writeTextFile(caminho, alheia);
      }),
    });
    const e = await cofre.travar("loja-nova").then(
      () => null,
      (x) => x,
    );
    assert(e instanceof ErroDoCofre);
    assertEquals(e.codigo, "TRAVA_NAO_GRAVOU");
    assertEquals(
      await Deno.readTextFile(join(pasta, "loja-nova.trava")),
      alheia,
      "apagou ou mexeu na trava de outro",
    );
  } finally {
    await Deno.remove(pasta, { recursive: true });
  }
});

Deno.test("[dpapi] recusa pasta dentro do repositório", () => {
  for (const pasta of [
    RAIZ,
    join(RAIZ, "scripts", "frota"),
    join(RAIZ, "cofre-que-nao-existe", "acesso"),
  ]) {
    assertThrows(
      () => criarCofreDpapi({ pasta, executar: executorFalso() }),
      ErroDoCofre,
    );
  }
});

Deno.test("[dpapi] recusa pasta dentro de QUALQUER árvore git", async () => {
  const raiz = await pastaTemp();
  try {
    await Deno.mkdir(join(raiz, ".git"));
    assertThrows(
      () =>
        criarCofreDpapi({
          pasta: join(raiz, "a", "b"),
          executar: executorFalso(),
        }),
      ErroDoCofre,
    );
  } finally {
    await Deno.remove(raiz, { recursive: true });
  }
});

Deno.test("[dpapi] recusa pasta relativa ou ausente", () => {
  for (const pasta of ["acesso", "./x", ""]) {
    assertThrows(
      () => criarCofreDpapi({ pasta, executar: executorFalso() }),
      ErroDoCofre,
    );
  }
});

Deno.test("pasta padrão: %LOCALAPPDATA%\\ikcous\\frota\\acesso; sem a variável, recusa", () => {
  // absoluto no sistema que roda o teste (no CI Linux, "C:\..." é relativo)
  const base =
    Deno.build.os === "windows"
      ? "C:\\Users\\X\\AppData\\Local"
      : "/home/x/AppData/Local";
  const p = pastaPadraoDoCofre({ LOCALAPPDATA: base });
  assertEquals(p, join(base, "ikcous", "frota", "acesso"));
  assertThrows(() => pastaPadraoDoCofre({}), ErroDoCofre);
  assertThrows(
    () => pastaPadraoDoCofre({ LOCALAPPDATA: "relativo" }),
    ErroDoCofre,
  );
});

// ------------------------------------------- DPAPI de verdade (só Windows) --

Deno.test({
  name: "[dpapi REAL] cifra e decifra no Windows, sem o valor no disco",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const pasta = await pastaTemp();
    // valor FALSO inventado agora (nunca um segredo de verdade); com acento e
    // símbolo para provar que a ida e volta não estraga caractere fora do ASCII
    const falso = `valor-FALSO-${crypto.randomUUID()}-ação-✓`;
    try {
      const cofre = criarCofreDpapi({ pasta });
      await cofre.gravar("loja-teste", falso);
      const texto = await Deno.readTextFile(join(pasta, "loja-teste.dpapi"));
      assert(!texto.includes(falso), "valor em claro no arquivo");
      assert(!texto.includes(b64(falso)), "valor em base64 no arquivo");
      assertEquals(
        await cofre.ler("loja-teste"),
        falso,
        "ida e volta mudou o valor",
      );
      // outra instância (como outro processo do mesmo usuário) também lê
      assertEquals(await criarCofreDpapi({ pasta }).ler("loja-teste"), falso);
      await cofre.apagar("loja-teste");
      assertEquals(await cofre.ler("loja-teste"), null);
      console.log(
        `DPAPI real: gravou ${texto.length} caracteres cifrados, leu de volta igual, apagou.`,
      );
    } finally {
      await Deno.remove(pasta, { recursive: true });
    }
  },
});
