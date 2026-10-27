// @vitest-environment jsdom
//
// A guarda da página crua (sem a ficha da loja) está LIGADA no boot
// (src/config/buildIdentity.ts): em produção, num endereço que não é local, o
// app que sobe SEM ficha nunca chega a criar o cliente do banco.
//   - qualquer caminho que não seja "/" (/index.html, /404.html, /icons/x.png):
//     troca para "/" (replace), onde o porteiro entrega a ficha da loja;
//   - "/" sem ficha: não há para onde ir, então pinta a tela segura e para
//     (sem laço de redirecionamento);
//   - desenvolvimento e endereço local: nada muda.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("buildIdentity: guarda da página crua", () => {
  const replace = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    replace.mockClear();
    document.body.innerHTML = '<div id="root"></div>';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    document.body.innerHTML = "";
  });

  function abrir(pathname: string, dev: boolean, hostname = "savy.exemplo") {
    vi.stubEnv("DEV", dev);
    vi.stubGlobal("location", {
      pathname,
      hostname,
      search: "?a=1",
      hash: "",
      replace,
    });
  }

  it("produção + /index.html + sem ficha: replace('/?a=1') e o boot para", async () => {
    abrir("/index.html", false);
    await expect(import("@/config/buildIdentity")).rejects.toThrow(
      "INDEX_CRU_REDIRECIONANDO",
    );
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/?a=1");
  });

  it.each(["/404.html", "/icons/nao-existe.png", "/images/a/b.webp"])(
    "produção + %s + sem ficha: replace('/?a=1') e o boot para",
    async (pathname) => {
      abrir(pathname, false);
      await expect(import("@/config/buildIdentity")).rejects.toThrow(
        "INDEX_CRU_REDIRECIONANDO",
      );
      expect(replace).toHaveBeenCalledTimes(1);
      expect(replace).toHaveBeenCalledWith("/?a=1");
    },
  );

  it("produção + / + sem ficha: tela segura, sem redirecionar (sem laço) e o boot para", async () => {
    abrir("/", false);
    await expect(import("@/config/buildIdentity")).rejects.toThrow(
      "BOOT_SEM_FICHA",
    );
    expect(replace).not.toHaveBeenCalled();
    expect(document.getElementById("root")?.textContent).toContain(
      "Loja em manutenção",
    );
  });

  it("produção + rota do app sem ficha: também vai para / (nunca sobe com o banco assado)", async () => {
    abrir("/carrinho", false);
    await expect(import("@/config/buildIdentity")).rejects.toThrow(
      "INDEX_CRU_REDIRECIONANDO",
    );
    expect(replace).toHaveBeenCalledWith("/?a=1");
  });

  it("depois do replace, chegar em / sem ficha NÃO redireciona de novo", async () => {
    abrir("/404.html", false);
    await expect(import("@/config/buildIdentity")).rejects.toThrow(
      "INDEX_CRU_REDIRECIONANDO",
    );
    expect(replace).toHaveBeenCalledTimes(1);

    vi.resetModules();
    replace.mockClear();
    abrir("/", false);
    await expect(import("@/config/buildIdentity")).rejects.toThrow(
      "BOOT_SEM_FICHA",
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it("desenvolvimento + /index.html: não redireciona", async () => {
    abrir("/index.html", true);
    const modulo = await import("@/config/buildIdentity");
    expect(modulo.buildIdentity).toBeDefined();
    expect(replace).not.toHaveBeenCalled();
  });

  it.each(["localhost", "127.0.0.1", "[::1]", "app.localhost"])(
    "produção em endereço local (%s), sem ficha: o boot segue (preview e testes de jornada)",
    async (hostname) => {
      abrir("/404.html", false, hostname);
      const modulo = await import("@/config/buildIdentity");
      expect(modulo.buildIdentity).toBeDefined();
      expect(replace).not.toHaveBeenCalled();
    },
  );

  it("main.tsx importa a guarda ANTES de qualquer módulo do app (o banco só nasce depois)", () => {
    const fonte = readFileSync("src/main.tsx", "utf8");
    const guarda = fonte.indexOf('import "@/config/buildIdentity"');
    expect(guarda).toBeGreaterThan(-1);
    const imports = [...fonte.matchAll(/^import .*$/gm)].map((m) => ({
      linha: m[0],
      posicao: m.index ?? 0,
    }));
    const antes = imports.filter((i) => i.posicao < guarda).map((i) => i.linha);
    // Só React vem antes: nenhum módulo do app (nem o do banco) avalia primeiro.
    expect(antes.every((l) => /from "react(-dom\/client)?"/.test(l))).toBe(
      true,
    );
  });
});
