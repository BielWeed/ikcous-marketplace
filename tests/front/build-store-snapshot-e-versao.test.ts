/* eslint-disable security/detect-non-literal-fs-filename -- Só caminhos de mkdtemp criados aqui. */
// metadata() de scripts/buildStore.mjs: a fotografia da identidade da loja
// (__STORE_IDENTITY__) e a versão do app (__APP_VERSION__) que o Vite resolveu.
// Cada linha da tabela abaixo é UMA adulteração; todas têm de terminar em
// IDENTITY_SNAPSHOT e sem marcador version.json. Sem este teste, tirar uma
// condição do `||` de metadata() deixava a loja confirmar uma entrega com
// versão, commit ou endereço público incoerentes.
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Cenario,
  REV,
  SHA,
  VERSAO,
  ausente,
  cenario,
  limparRoots,
  recusa,
  versaoDeEntrega,
} from "./build-store-cenario";

const dubles = vi.hoisted(() => ({
  build: vi.fn(),
  loadEnv: vi.fn(),
  gerarHospedagem: vi.fn(),
  gerarSitemap: vi.fn(),
}));
vi.mock("vite", () => ({ build: dubles.build, loadEnv: dubles.loadEnv }));
vi.mock("../../scripts/hospedagem.mjs", () => ({
  gerarHospedagem: dubles.gerarHospedagem,
}));
vi.mock("../../scripts/sitemap.mjs", () => ({
  gerarSitemap: dubles.gerarSitemap,
}));

beforeEach(() => {
  dubles.build.mockReset();
  dubles.loadEnv.mockReset();
  dubles.gerarHospedagem.mockReset().mockResolvedValue(undefined);
  dubles.gerarSitemap.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await limparRoots();
});

const escreverPacote = (c: Cenario, version: string) =>
  fs.writeFile(path.join(c.root, "package.json"), JSON.stringify({ version }));
const marcador = (c: Cenario) => path.join(c.saida(), "version.json");

const adulteracoes: [string, (c: Cenario) => void | Promise<void>][] = [
  [
    "__STORE_IDENTITY__ não é JSON",
    (c) => {
      c.ajustarConfig = (cfg) => {
        cfg.define.__STORE_IDENTITY__ = "{";
      };
    },
  ],
  [
    "__APP_VERSION__ não é JSON",
    (c) => {
      c.ajustarConfig = (cfg) => {
        cfg.define.__APP_VERSION__ = "{";
      };
    },
  ],
  [
    "__STORE_IDENTITY__ ausente",
    (c) => {
      c.ajustarConfig = (cfg) => {
        Reflect.deleteProperty(cfg.define, "__STORE_IDENTITY__");
      };
    },
  ],
  [
    "fotografia é array",
    (c) => {
      c.ajustarConfig = (cfg) => {
        cfg.define.__STORE_IDENTITY__ = "[]";
      };
    },
  ],
  [
    "fotografia com chave a mais",
    (c) => {
      c.snapshot.extra = 1;
    },
  ],
  [
    "fotografia com uma chave trocada por outra (mesma contagem)",
    (c) => {
      Reflect.deleteProperty(c.snapshot, "localUrls");
      c.snapshot.outra = {};
    },
  ],
  [
    "schemaVersion 2",
    (c) => {
      c.snapshot.schemaVersion = 2;
    },
  ],
  [
    "origem da fotografia diferente da do build",
    (c) => {
      c.snapshot.source = "fixture";
    },
  ],
  [
    "identity nulo",
    (c) => {
      c.snapshot.identity = null;
    },
  ],
  [
    "identity.schemaVersion 2",
    (c) => {
      c.snapshot.identity.schemaVersion = 2;
    },
  ],
  [
    "localUrls é array",
    (c) => {
      c.snapshot.localUrls = [];
    },
  ],
  [
    "localUrls nulo",
    (c) => {
      c.snapshot.localUrls = null;
    },
  ],
  [
    "publicUrl é array com a URL dentro (String() a engoliria)",
    (c) => {
      c.snapshot.publicUrl = ["https://loja-de-teste.example"];
    },
  ],
  [
    "codeSha é array com o hash dentro (a versão de entrega é montada com ele inteiro)",
    (c) => {
      c.fixarSha([SHA], `${VERSAO}-sha.${SHA}-identity.${REV}`);
    },
  ],
  [
    "fotografia é null",
    (c) => {
      c.ajustarConfig = (cfg) => {
        cfg.define.__STORE_IDENTITY__ = "null";
      };
    },
  ],
  [
    "codeSha com 39 caracteres",
    (c) => {
      c.fixarSha("a".repeat(39));
    },
  ],
  [
    "codeSha com 41 caracteres",
    (c) => {
      c.fixarSha("a".repeat(41));
    },
  ],
  [
    "codeSha em maiúsculas",
    (c) => {
      c.fixarSha("A".repeat(40));
    },
  ],
  [
    "codeSha fora do hexadecimal",
    (c) => {
      c.fixarSha("g".repeat(40));
    },
  ],
  [
    "codeSha com lixo antes",
    (c) => {
      c.fixarSha(`x${"a".repeat(40)}`);
    },
  ],
  [
    "codeSha com lixo depois",
    (c) => {
      c.fixarSha(`${"a".repeat(40)}x`);
    },
  ],
  [
    "identityRevision é array com o hash dentro",
    (c) => {
      c.fixarRevisao([REV], versaoDeEntrega());
    },
  ],
  [
    "identityRevision com 63 caracteres",
    (c) => {
      c.fixarRevisao("b".repeat(63));
    },
  ],
  [
    "identityRevision com 65 caracteres",
    (c) => {
      c.fixarRevisao("b".repeat(65));
    },
  ],
  [
    "identityRevision em maiúsculas",
    (c) => {
      c.fixarRevisao("B".repeat(64));
    },
  ],
  [
    "identityRevision com lixo antes",
    (c) => {
      c.fixarRevisao(`x${"b".repeat(64)}`);
    },
  ],
  [
    "identityRevision com lixo depois",
    (c) => {
      c.fixarRevisao(`${"b".repeat(64)}x`);
    },
  ],
  [
    "deliveryVersion errada nos dois lados",
    (c) => {
      c.snapshot.deliveryVersion = "1.2.3-qualquer";
      c.appVersion = "1.2.3-qualquer";
    },
  ],
  [
    "deliveryVersion com 8 caracteres do commit",
    (c) => {
      c.snapshot.deliveryVersion = `${VERSAO}-sha.${SHA.slice(0, 8)}-identity.${REV}`;
      c.appVersion = c.snapshot.deliveryVersion;
    },
  ],
  [
    "__APP_VERSION__ diferente da deliveryVersion",
    (c) => {
      c.appVersion = "1.2.3-outra";
    },
  ],
  [
    "versão do package.json diferente da fotografia",
    async (c) => {
      await escreverPacote(c, "1.2.4");
    },
  ],
  [
    "publicUrl em http",
    (c) => {
      c.snapshot.publicUrl = "http://loja-de-teste.example";
    },
  ],
  [
    "publicUrl com usuário",
    (c) => {
      c.snapshot.publicUrl = "https://alguem@loja-de-teste.example";
    },
  ],
  [
    "publicUrl só com senha",
    (c) => {
      c.snapshot.publicUrl = "https://:senha@loja-de-teste.example";
    },
  ],
  [
    "publicUrl com query",
    (c) => {
      c.snapshot.publicUrl = "https://loja-de-teste.example/?a=1";
    },
  ],
  [
    "publicUrl com fragmento",
    (c) => {
      c.snapshot.publicUrl = "https://loja-de-teste.example/#a";
    },
  ],
  [
    "publicUrl com caminho",
    (c) => {
      c.snapshot.publicUrl = "https://loja-de-teste.example/loja";
    },
  ],
];

describe("metadata(): fotografia incoerente nunca confirma entrega", () => {
  it.each(adulteracoes)("%s", async (_nome, adulterar) => {
    const c = await cenario(dubles);
    await adulterar(c);
    await recusa(c.executar(), "SNAPSHOT");
    await ausente(marcador(c));
    expect(dubles.gerarHospedagem).not.toHaveBeenCalled();
  });

  it.each([
    "1.2",
    "01.2.3",
    "1.02.3",
    "1.2.03",
    "v1.2.3",
    "1.2.3-beta",
    "1.2.3.4",
    "x1.2.3",
    "1.2.3x",
    "",
  ])(
    "versão %j do código é recusada mesmo igual no package.json",
    async (versao) => {
      const c = await cenario(dubles);
      c.fixarVersao(versao);
      await escreverPacote(c, versao);
      await recusa(c.executar(), "SNAPSHOT");
      await ausente(marcador(c));
    },
  );

  it.each(["0.0.0", "10.20.30"])("versão %s é aceita", async (versao) => {
    const c = await cenario(dubles);
    c.fixarVersao(versao);
    await escreverPacote(c, versao);
    expect((await c.executar()).codeVersion).toBe(versao);
  });

  it("publicUrl que nem é URL derruba o build (qualquer erro) e não deixa marcador", async () => {
    const c = await cenario(dubles);
    c.snapshot.publicUrl = "isto não é uma url";
    await expect(c.executar()).rejects.toBeInstanceOf(Error);
    await ausente(marcador(c));
  });

  it("publicUrl com barra final é aceita (pathname é '/')", async () => {
    const c = await cenario(dubles);
    c.snapshot.publicUrl = "https://loja-de-teste.example/";
    await c.executar();
  });

  it("package.json ausente propaga o erro do disco, sem marcador", async () => {
    const c = await cenario(dubles);
    await fs.rm(path.join(c.root, "package.json"));
    await expect(c.executar()).rejects.toMatchObject({ code: "ENOENT" });
    await ausente(marcador(c));
  });
});
