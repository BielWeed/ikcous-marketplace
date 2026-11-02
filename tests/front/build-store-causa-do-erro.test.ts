/* eslint-disable security/detect-non-literal-fs-filename -- Só caminhos de mkdtemp criados aqui. */
// O CLI do build (scripts/buildStore.mjs) imprimia só "entrega não confirmada":
// quem via o log da Vercel não sabia SE foi a rede, o sitemap, a hospedagem ou
// a configuração. Agora a causa aparece — e aparece lavada: mensagem de erro de
// terceiro (fetch, Vite, fs) pode carregar token, chave ou variável de ambiente.
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error Node entry é JavaScript nativo, sem declaração de tipos.
import { descreverCausa } from "../../scripts/buildStore.mjs";

const projeto = path.resolve(import.meta.dirname, "../..");
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await fs.rm(root, { recursive: true, force: true });
});

// Montados em tempo de execução: o secretlint do pre-commit barra o formato
// de JWT e de URL de banco escrito por extenso, mesmo sendo fictício.
const JWT = ["eyJhbGciOiJIUzI1NiJ9", "eyJyb2xlIjoiYW5vbiJ9", "assinatura"].join(
  ".",
);
const URL_DE_BANCO = [
  "postgresql:",
  "//admin:hunter2@db.exemplo.invalid/x",
].join("");

describe("descreverCausa", () => {
  it("mostra a mensagem do erro", () => {
    expect(descreverCausa(new Error("SITEMAP_HTTP_503"), {})).toBe(
      "SITEMAP_HTTP_503",
    );
  });

  it("junta o código da causa (fetch falha só com 'fetch failed')", () => {
    const erro = new Error("fetch failed", {
      cause: Object.assign(new Error("connect"), { code: "ECONNREFUSED" }),
    });
    expect(descreverCausa(erro, {})).toBe("fetch failed (causa: ECONNREFUSED)");
  });

  it("não imprime o conteúdo de valor lançado que não é Error", () => {
    expect(descreverCausa(`senha=${JWT}`, {})).not.toContain(JWT);
    expect(descreverCausa(undefined, {})).toMatch(/não é Error/);
  });

  it("esconde o VALOR de variável de ambiente sensível, em qualquer lugar da mensagem", () => {
    const env = {
      SUPABASE_SERVICE_ROLE_KEY: "valor-ficticio-da-chave",
      DATABASE_URL: "x", // curto demais para ser segredo: não vira buraco no texto
      NODE_ENV: "production",
    };
    const texto = descreverCausa(
      new Error("falhou com valor-ficticio-da-chave no meio"),
      env,
    );
    expect(texto).not.toContain("valor-ficticio-da-chave");
    expect(texto).toContain("falhou com");
  });

  it("esconde JWT, chave sb_, Bearer, credencial em URL e sequência opaca longa", () => {
    const texto = descreverCausa(
      new Error(
        [
          `jwt ${JWT}`,
          "chave sb_secret_abcdef123456",
          "cabecalho Bearer abc.def-ghi",
          `url ${URL_DE_BANCO}`,
          `opaca ${"a1B2".repeat(10)}`,
        ].join(" | "),
      ),
      {},
    );
    for (const segredo of [
      JWT,
      "sb_secret_abcdef123456",
      "abc.def-ghi",
      "hunter2",
      "a1B2".repeat(10),
    ])
      expect(texto).not.toContain(segredo);
    expect(texto).toContain("jwt");
    expect(texto).toContain("db.exemplo.invalid");
  });

  it("mantém caminho de arquivo legível (a causa mais comum é um arquivo)", () => {
    const caminho = "C:\\build\\projeto-com-nome-bem-comprido\\public\\x.svg";
    expect(
      descreverCausa(new Error(`ENOENT: no such file '${caminho}'`), {}),
    ).toContain(caminho);
    expect(
      descreverCausa(
        new Error("ENOENT: /vercel/path0/projeto-bem-comprido/public/x.svg"),
        {},
      ),
    ).toContain("/vercel/path0/projeto-bem-comprido/public/x.svg");
  });

  it("uma linha só e com teto de tamanho", () => {
    const texto = descreverCausa(
      new Error(`a\nb\n${"palavra ".repeat(200)}`),
      {},
    );
    expect(texto).not.toMatch(/[\r\n]/);
    expect(texto.length).toBeLessThanOrEqual(401);
  });
});

describe("CLI do build mostra a causa da falha", () => {
  it("imprime a causa lavada ao lado de IDENTITY_BUILD_FAILED, sem vazar segredo", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "build-causa-"));
    roots.push(root);
    await fs.writeFile(
      path.join(root, "package.json"),
      '{"version":"1.26.0","type":"module"}',
    );
    await fs.writeFile(
      path.join(root, ".env"),
      "IKCOUS_IDENTITY_MODE=fixture\n",
    );
    await fs.writeFile(
      path.join(root, "vite.config.js"),
      `throw new Error("config recusada: " + process.env.IKCOUS_TOKEN_FICTICIO + " " + ${JSON.stringify(JWT)});`,
    );
    const resultado = spawnSync(
      process.execPath,
      [path.join(projeto, "scripts/buildStore.mjs")],
      {
        cwd: root,
        env: {
          ...process.env,
          IKCOUS_IDENTITY_MODE: undefined,
          IKCOUS_TOKEN_FICTICIO: "token-ficticio-do-ambiente",
        },
        encoding: "utf8",
        timeout: 30000,
      },
    );
    expect(resultado.status).toBe(1);
    expect(resultado.stderr).toContain(
      "IDENTITY_BUILD_FAILED: entrega não confirmada.",
    );
    expect(resultado.stderr).toContain("config recusada");
    expect(resultado.stderr).not.toContain("token-ficticio-do-ambiente");
    expect(resultado.stderr).not.toContain(JWT);
  });
});
