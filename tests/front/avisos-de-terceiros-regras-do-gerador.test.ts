/* eslint-disable security/detect-non-literal-fs-filename -- teste: os caminhos são de pastas temporárias criadas pelo próprio teste, nunca de entrada externa. */
// As REGRAS do gerador de avisos de terceiros (scripts/gerar-avisos-de-terceiros.mjs).
//
// O teste vizinho (avisos-de-terceiros-em-dia.test.ts) confere que o arquivo
// versionado bate com o que o gerador produz HOJE, com os pacotes de hoje.
// Isso pega mudança no texto, mas não prova as regras que fazem o texto ser o
// certo: quais nomes de arquivo contam como LICENSE ou NOTICE, que a ordem não
// depende do sistema de arquivos, o que acontece quando o lockfile e a
// instalação divergem, e o que o CLI faz com argumento, arquivo ausente ou
// licença sem texto. Mudar qualquer uma delas hoje deixava tudo verde porque
// os pacotes instalados não exercitam a borda (nenhum tem `LICENCE.md`, nenhum
// tem NOTICE em duas versões, etc.).
//
// COMO: o script é COPIADO para uma raiz descartável (ele deduz a raiz de
// import.meta.url) com o package.json e o lockfile reais; `node_modules` ali
// é um diretório de JUNÇÕES para o real, EXCETO `clsx`, que é uma cópia
// editável. Assim cada teste monta a pasta do `clsx` do jeito que quer provar,
// sem tocar no node_modules do projeto. Um preload opcional troca o
// `readdirSync` (ordem do sistema de arquivos) e o conteúdo de alguns arquivos.
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Cada teste sobe um processo node e a montagem da raiz cria centenas de
// junções: folga larga para o CI carregado.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const REAL = fileURLToPath(new URL("../../", import.meta.url));
const NOTICES_REAL = readFileSync(
  join(REAL, "public", "THIRD_PARTY_NOTICES.txt"),
  "utf8",
).replace(/\r\n/g, "\n");
const CLSX_VERSAO = JSON.parse(
  readFileSync(join(REAL, "node_modules", "clsx", "package.json"), "utf8"),
).version as string;

const PRELOAD = `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const patch = JSON.parse(process.env.H36_PATCH ?? "{}");
const caminho = (p) => String(p?.pathname ?? p).replaceAll("\\\\", "/");
const listar = fs.readdirSync;
fs.readdirSync = (pasta, ...resto) => {
  const nomes = listar(pasta, ...resto);
  return (patch.reverter ?? []).some((s) => caminho(pasta).endsWith(s)) ? [...nomes].reverse() : nomes;
};
const ler = fs.readFileSync;
fs.readFileSync = (p, ...resto) => {
  let texto = ler(p, ...resto);
  for (const t of patch.trocar ?? []) {
    if (!caminho(p).endsWith(t.sufixo)) continue;
    if (t.conteudo !== undefined) texto = t.conteudo;
    else {
      const json = JSON.parse(texto);
      json[t.campo] = t.valor;
      texto = JSON.stringify(json);
    }
  }
  return texto;
};
syncBuiltinESMExports();
`;

let raiz = "";
let clsxOriginal = "";

function montarRaiz() {
  raiz = realpathSync(mkdtempSync(join(tmpdir(), "h36-avisos-")));
  mkdirSync(join(raiz, "scripts"));
  for (const nome of [
    "gerar-avisos-de-terceiros.mjs",
    "avisos-de-terceiros-licencas.mjs",
  ]) {
    cpSync(join(REAL, "scripts", nome), join(raiz, "scripts", nome));
  }
  cpSync(join(REAL, "package.json"), join(raiz, "package.json"));
  cpSync(join(REAL, "package-lock.json"), join(raiz, "package-lock.json"));
  mkdirSync(join(raiz, "src", "assets", "fonts"), { recursive: true });
  cpSync(
    join(REAL, "src", "assets", "fonts", "OFL.txt"),
    join(raiz, "src", "assets", "fonts", "OFL.txt"),
  );
  mkdirSync(join(raiz, "public"));
  writeFileSync(join(raiz, "preload.mjs"), PRELOAD);

  // node_modules: junção para cada entrada do real, menos o clsx (cópia).
  const realNm = join(REAL, "node_modules");
  const nm = join(raiz, "node_modules");
  mkdirSync(nm);
  for (const entrada of readdirSync(realNm)) {
    if (entrada === "clsx") continue;
    symlinkSync(join(realNm, entrada), join(nm, entrada), "junction");
  }
  clsxOriginal = join(raiz, "clsx-original");
  cpSync(join(realNm, "clsx"), clsxOriginal, { recursive: true });
}

/** Refaz a pasta do clsx: cópia limpa, depois `ajustar` mexe nela. */
function clsxCom(ajustar: (pasta: string) => void) {
  const pasta = join(raiz, "node_modules", "clsx");
  rmSync(pasta, { recursive: true, force: true });
  cpSync(clsxOriginal, pasta, { recursive: true });
  ajustar(pasta);
  return pasta;
}

function rodar(args: string[], patch?: Record<string, unknown>) {
  const r = spawnSync(
    process.execPath,
    [
      "--import",
      pathToFileURL(join(raiz, "preload.mjs")).href,
      join(raiz, "scripts", "gerar-avisos-de-terceiros.mjs"),
      ...args,
    ],
    {
      cwd: raiz,
      encoding: "utf8",
      env: { ...process.env, H36_PATCH: JSON.stringify(patch ?? {}) },
    },
  );
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const DESTINO = () => join(raiz, "public", "THIRD_PARTY_NOTICES.txt");
const gerado = () => readFileSync(DESTINO(), "utf8");

/** O bloco do clsx no inventário: da linha `clsx@... — MIT` até a linha em branco. */
function blocoDoClsx(texto: string) {
  const inicio = texto.indexOf(`clsx@${CLSX_VERSAO} — MIT`);
  expect(inicio).toBeGreaterThan(-1);
  const fim = texto.indexOf("\n\n", inicio);
  return texto.slice(inicio, fim);
}

const MIT = (copyright: string) =>
  `MIT License\n\n${copyright}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software.`;

beforeAll(() => {
  montarRaiz();
});
afterAll(() => {
  rmSync(raiz, { recursive: true, force: true });
});
beforeEach(() => {
  rmSync(DESTINO(), { force: true });
  clsxCom(() => {});
});

describe("CLI do gerador", () => {
  it("sem argumento GERA o arquivo, idêntico ao versionado, e sai 0", () => {
    const r = rodar([]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toBe("");
    expect(gerado()).toBe(NOTICES_REAL);
    expect(gerado().endsWith("\n")).toBe(true);
  });

  it("--check: arquivo igual ao esperado passa (inclusive com fim de linha CRLF)", () => {
    rodar([]);
    expect(rodar(["--check"]).status).toBe(0);
    writeFileSync(DESTINO(), NOTICES_REAL.replace(/\n/g, "\r\n"));
    const r = rodar(["--check"]);
    expect(r.status, r.stderr).toBe(0);
  });

  it("--check: arquivo AUSENTE reprova com a mensagem de como regenerar", () => {
    expect(existsSync(DESTINO())).toBe(false);
    const r = rodar(["--check"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(
      "THIRD_PARTY_NOTICES.txt desatualizado. Rode: node scripts/gerar-avisos-de-terceiros.mjs",
    );
    expect(existsSync(DESTINO())).toBe(false); // --check nunca escreve
  });

  it("--check: uma letra diferente reprova (e não reescreve o arquivo)", () => {
    const adulterado = NOTICES_REAL.replace(
      "Permission is hereby granted",
      "Permission is hereby grantec",
    );
    expect(adulterado).not.toBe(NOTICES_REAL);
    writeFileSync(DESTINO(), adulterado);
    const r = rodar(["--check"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("desatualizado");
    expect(readFileSync(DESTINO(), "utf8")).toBe(adulterado);
  });

  it("--check: falta só a quebra de linha final também reprova", () => {
    writeFileSync(DESTINO(), NOTICES_REAL.replace(/\n$/, ""));
    expect(rodar(["--check"]).status).toBe(1);
  });

  it.each([["--gerar"], ["check"], ["-c"], ["--check=1"]])(
    "argumento desconhecido %s: 1, mensagem de uso e NADA gravado",
    (arg) => {
      const r = rodar([arg]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(
        "Uso: node scripts/gerar-avisos-de-terceiros.mjs [--check]",
      );
      expect(existsSync(DESTINO())).toBe(false);
    },
  );

  it("`--check` com argumento extra depois continua sendo --check (não grava)", () => {
    const r = rodar(["--check", "qualquer-coisa"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("desatualizado");
    expect(existsSync(DESTINO())).toBe(false);
  });
});

describe("lockfile x instalação", () => {
  const lockPath = () => join(raiz, "package-lock.json");
  let lockOriginal = "";
  beforeEach(() => {
    lockOriginal = lockOriginal || readFileSync(lockPath(), "utf8");
    writeFileSync(lockPath(), lockOriginal);
  });
  afterAll(() => writeFileSync(lockPath(), lockOriginal));

  it("versão instalada diferente da do lockfile reprova nomeando o pacote", () => {
    const lock = JSON.parse(lockOriginal);
    lock.packages["node_modules/react"].version = "0.0.1";
    writeFileSync(lockPath(), JSON.stringify(lock));
    const r = rodar(["--check"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(
      "node_modules/react: versão instalada diferente do lockfile; confira a instalação e o inventário.",
    );
  });

  it("pacote que o lockfile nem conhece também reprova", () => {
    const lock = JSON.parse(lockOriginal);
    lock.packages["node_modules/tslib"] = undefined; // JSON.stringify omite a chave
    writeFileSync(lockPath(), JSON.stringify(lock));
    const r = rodar([]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(
      "node_modules/tslib: versão instalada diferente do lockfile",
    );
    expect(existsSync(DESTINO())).toBe(false);
  });
});

describe("o que conta como LICENSE", () => {
  const apagaLicenca = (pasta: string) =>
    rmSync(join(pasta, "license"), { force: true });

  it.each([
    "LICENSE",
    "LICENCE",
    "license.md",
    "LICENSE.txt",
    "Licence.TXT",
    "LICENCE.MD",
  ])("%s é reconhecido como a licença do pacote", (nome) => {
    clsxCom((pasta) => {
      apagaLicenca(pasta);
      writeFileSync(join(pasta, nome), MIT("Copyright (c) H36 Fulano"));
    });
    const r = rodar([]);
    expect(r.status, r.stderr).toBe(0);
    expect(blocoDoClsx(gerado())).toBe(
      `clsx@${CLSX_VERSAO} — MIT\nCopyright (c) H36 Fulano`,
    );
  });

  it.each(["xlicense", "license.bak", "LICENSE-MIT", "license.md.old"])(
    "%s NÃO é reconhecido — sem LICENSE nem exceção, reprova",
    (nome) => {
      clsxCom((pasta) => {
        apagaLicenca(pasta);
        writeFileSync(join(pasta, nome), MIT("Copyright (c) H36 Fulano"));
      });
      const r = rodar([]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(
        `clsx@${CLSX_VERSAO}: sem LICENSE nem exceção verificada.`,
      );
      expect(existsSync(DESTINO())).toBe(false);
    },
  );

  it("entre duas licenças candidatas vale a primeira em ordem ALFABÉTICA, não a ordem do sistema de arquivos", () => {
    clsxCom((pasta) => {
      apagaLicenca(pasta);
      writeFileSync(join(pasta, "LICENSE"), MIT("Copyright (c) Primeira"));
      writeFileSync(join(pasta, "LICENSE.md"), MIT("Copyright (c) Segunda"));
    });
    const direto = rodar([]);
    expect(direto.status, direto.stderr).toBe(0);
    expect(blocoDoClsx(gerado())).toContain("Copyright (c) Primeira");
    // O mesmo, com o sistema de arquivos devolvendo a ordem INVERTIDA.
    rmSync(DESTINO(), { force: true });
    const invertido = rodar([], { reverter: ["/node_modules/clsx/"] });
    expect(invertido.status, invertido.stderr).toBe(0);
    expect(blocoDoClsx(gerado())).toContain("Copyright (c) Primeira");
    expect(blocoDoClsx(gerado())).not.toContain("Segunda");
  });
});

describe("quais linhas da licença viram crédito de copyright", () => {
  it("só linhas que COMEÇAM com copyright/©/'All rights reserved.', menos 'copyright holders/owners' no começo e modelo [yyyy]", () => {
    clsxCom((pasta) => {
      rmSync(join(pasta, "license"), { force: true });
      writeFileSync(
        join(pasta, "LICENSE"),
        [
          "MIT License",
          "",
          "Copyright (c) 2020 H36 Um",
          "© 2021 H36 Dois",
          "All rights reserved.",
          "Copyright holders may do X",
          "copyright owners are Y",
          "Copyright (c) [yyyy] H36 Modelo",
          "Copyright (c) 2022 H36 Tres, copyright holders of Quatro",
          "   Copyright (c) 2023 H36 Cinco",
          "Texto livre citando Copyright (c) 2024 no meio",
          "All rights reserved to somebody",
          "",
          "Permission is hereby granted, free of charge.",
        ].join("\n"),
      );
    });
    const r = rodar([]);
    expect(r.status, r.stderr).toBe(0);
    expect(blocoDoClsx(gerado())).toBe(
      [
        `clsx@${CLSX_VERSAO} — MIT`,
        "Copyright (c) 2020 H36 Um",
        "© 2021 H36 Dois",
        "All rights reserved.",
        "Copyright (c) 2022 H36 Tres, copyright holders of Quatro",
        "Copyright (c) 2023 H36 Cinco",
      ].join("\n"),
    );
  });

  it("licença com fim de linha CRLF produz o mesmo crédito (o gerador normaliza)", () => {
    clsxCom((pasta) => {
      rmSync(join(pasta, "license"), { force: true });
      writeFileSync(
        join(pasta, "LICENSE"),
        "MIT License\r\n\r\nCopyright (c) H36 Windows\r\n\r\nPermission is hereby granted.\r\n",
      );
    });
    const r = rodar([]);
    expect(r.status, r.stderr).toBe(0);
    expect(blocoDoClsx(gerado())).toBe(
      `clsx@${CLSX_VERSAO} — MIT\nCopyright (c) H36 Windows`,
    );
  });
});

describe("o que conta como NOTICE / COPYRIGHT", () => {
  const LICENCA = MIT("Copyright (c) H36 Dono");

  function prepara(avisos: Record<string, string>) {
    clsxCom((pasta) => {
      rmSync(join(pasta, "license"), { force: true });
      writeFileSync(join(pasta, "LICENSE"), LICENCA);
      for (const [nome, texto] of Object.entries(avisos)) {
        writeFileSync(join(pasta, nome), texto);
      }
    });
  }

  it("NOTICE, NOTICE.md, NOTICE.txt, COPYRIGHT e CopyrightNotice (qualquer caixa) entram, sem espaço nas pontas, em ordem alfabética", () => {
    prepara({
      "NOTICE.txt": "\n  AVISO-TXT  \n\n",
      notice: "AVISO-NOTICE\n",
      "Notice.MD": "\nAVISO-MD\n",
      COPYRIGHT: "AVISO-COPYRIGHT",
      "CopyrightNotice.txt": "  AVISO-CN  ",
    });
    const r = rodar([]);
    expect(r.status, r.stderr).toBe(0);
    // Ordem de readdirSync().sort(): letras maiúsculas antes das minúsculas.
    expect(blocoDoClsx(gerado())).toBe(
      [
        `clsx@${CLSX_VERSAO} — MIT`,
        "Copyright (c) H36 Dono",
        "AVISO-COPYRIGHT",
        "AVISO-CN",
        "AVISO-TXT",
        "AVISO-MD",
        "AVISO-NOTICE",
      ].join("\n"),
    );
  });

  it("a ordem dos avisos não depende da ordem que o sistema de arquivos devolve", () => {
    prepara({
      NOTICE: "AVISO-A",
      "NOTICE.md": "AVISO-B",
      "NOTICE.txt": "AVISO-C",
    });
    const r = rodar([], { reverter: ["/node_modules/clsx/"] });
    expect(r.status, r.stderr).toBe(0);
    expect(blocoDoClsx(gerado())).toBe(
      [
        `clsx@${CLSX_VERSAO} — MIT`,
        "Copyright (c) H36 Dono",
        "AVISO-A",
        "AVISO-B",
        "AVISO-C",
      ].join("\n"),
    );
  });

  it.each([
    "NOTICES",
    "notice.bak",
    "xnotice",
    "NOTICE-3RD",
    "copyright.old",
    "mycopyright",
  ])("%s NÃO é aviso (nome parecido não conta)", (nome) => {
    prepara({ [nome]: "NAO-DEVE-APARECER" });
    const r = rodar([]);
    expect(r.status, r.stderr).toBe(0);
    expect(gerado()).not.toContain("NAO-DEVE-APARECER");
  });

  it("aviso que só REPETE a licença (embrulhado em /* */) é descartado; o que traz algo a mais, não", () => {
    prepara({
      COPYRIGHT: `/*\n${LICENCA}\n*/`,
      NOTICE: `${LICENCA}\n\nE mais uma cláusula própria H36.`,
    });
    const r = rodar([]);
    expect(r.status, r.stderr).toBe(0);
    const texto = gerado();
    // O NOTICE tem parágrafos (linha em branco), então o bloco do clsx não
    // cabe em `blocoDoClsx`: contamos no arquivo todo. A linha de copyright
    // aparece 1x como crédito + 1x dentro do NOTICE que traz algo a mais; o
    // aviso que só repete a licença (embrulhado em /* */) NÃO entra (seriam 3).
    expect(texto.match(/Copyright \(c\) H36 Dono/g)).toHaveLength(2);
    expect(texto).toContain("E mais uma cláusula própria H36.");
  });
});

describe("licenças e versões que o gerador não sabe tratar", () => {
  it("SPDX sem texto integral cadastrado reprova nomeando pacote e licença", () => {
    const r = rodar([], {
      trocar: [
        {
          sufixo: "/node_modules/clsx/package.json",
          campo: "license",
          valor: "GPL-3.0",
        },
      ],
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(
      `clsx@${CLSX_VERSAO}: adicione o texto integral da licença GPL-3.0.`,
    );
    expect(existsSync(DESTINO())).toBe(false);
  });

  it("trocar a versão do zxing-wasm sem revisar os avisos nativos reprova", () => {
    const lockPath = join(raiz, "package-lock.json");
    const original = readFileSync(lockPath, "utf8");
    try {
      const lock = JSON.parse(original);
      lock.packages["node_modules/zxing-wasm"].version = "3.1.6";
      writeFileSync(lockPath, JSON.stringify(lock));
      const r = rodar([], {
        trocar: [
          {
            sufixo: "/node_modules/zxing-wasm/package.json",
            campo: "version",
            valor: "3.1.6",
          },
        ],
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(
        "Atualize os avisos do código nativo para a versão instalada de zxing-wasm.",
      );
      expect(existsSync(DESTINO())).toBe(false);
    } finally {
      writeFileSync(lockPath, original);
    }
  });

  it("licença-base sem a frase de início esperada reprova nomeando o pacote de referência", () => {
    const r = rodar([], {
      trocar: [
        {
          sufixo: "/node_modules/tslib/LICENSE.txt",
          conteudo: "texto sem a frase esperada",
        },
      ],
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Texto esperado não encontrado em tslib.");
    expect(existsSync(DESTINO())).toBe(false);
  });
});
