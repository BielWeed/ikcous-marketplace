// @vitest-environment jsdom
//
// A guarda do "/index.html" cru está LIGADA no boot (src/config/buildIdentity.ts):
// em produção, sem ficha, o módulo manda o navegador para "/" e interrompe a
// avaliação (antes de qualquer cliente de banco); em desenvolvimento, ou com
// o caminho "/", não toca no endereço.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("buildIdentity: guarda do index cru", () => {
  const replace = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    replace.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function abrir(pathname: string, dev: boolean) {
    vi.stubEnv("DEV", dev);
    vi.stubGlobal("location", {
      pathname,
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

  it("produção + / : não redireciona e o módulo carrega", async () => {
    abrir("/", false);
    const modulo = await import("@/config/buildIdentity");
    expect(modulo.buildIdentity).toBeDefined();
    expect(replace).not.toHaveBeenCalled();
  });

  it("desenvolvimento + /index.html: não redireciona", async () => {
    abrir("/index.html", true);
    const modulo = await import("@/config/buildIdentity");
    expect(modulo.buildIdentity).toBeDefined();
    expect(replace).not.toHaveBeenCalled();
  });
});
