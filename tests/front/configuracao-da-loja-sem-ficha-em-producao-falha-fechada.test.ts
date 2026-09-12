// @vitest-environment jsdom
//
// A metade de `configuracaoDaLoja.ts` que NÃO tem ficha (build de loja
// única, ou arquivo estático servido cru fora do matcher do porteiro:
// `/index.html`, `/404.html`, `/offline.html` — medido 11/09/2026 ~20:2xZ,
// ADENDO A.2). Prova a regra de DINHEIRO: o `import.meta.env` assado só é
// aceito quando `import.meta.env.DEV` é verdadeiro; em PRODUÇÃO (`DEV:
// false`), ficha ausente devolve `{ mpPublicKey: null, vapidPublicKey:
// null, pagamentoOnline: false, manutencao: false }` — NUNCA o assado, MESMO
// QUE ele esteja preenchido no build. Sem esta trava, `/index.html` cru
// numa loja compartilhada tokenizaria cartão com a chave pública de OUTRA
// loja (a que ficou assada no build).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function importarLimpo() {
  vi.resetModules();
  return import("@/config/configuracaoDaLoja");
}

describe("configuracaoDaLoja.ts — sem ficha, em produção, falha fechada (ADENDO A.2)", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    // Sem `#ikcous-loja` no DOM: `lerFichaDaLoja()` devolve `null`.
    vi.stubEnv("VITE_MP_PUBLIC_KEY", "APP_USR-assado-do-build");
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "Bassado-do-build");
    vi.stubEnv("VITE_PAGAMENTO_ONLINE", "true");
    vi.stubEnv("VITE_MAINTENANCE_MODE", "true");
  });
  afterEach(() => {
    document.head.innerHTML = "";
    vi.unstubAllEnvs();
  });

  it("sem ficha + DEV verdadeiro (build local): cai no `import.meta.env` assado, como hoje", async () => {
    vi.stubEnv("DEV", true);
    const { lerConfiguracaoDaLoja } = await importarLimpo();

    expect(lerConfiguracaoDaLoja()).toEqual({
      mpPublicKey: "APP_USR-assado-do-build",
      vapidPublicKey: "Bassado-do-build",
      pagamentoOnline: true,
      manutencao: true,
    });
  });

  // O TESTE DE DINHEIRO (brief T2, ADENDO A.2): mesmo com o ambiente
  // assado TOTALMENTE preenchido — inclusive `VITE_PAGAMENTO_ONLINE=true`,
  // que ligaria cobrança — produção sem ficha nunca lê esse valor.
  it("sem ficha + DEV falso (produção), com o env preenchido: devolve {null,null,false,false} mesmo assim", async () => {
    vi.stubEnv("DEV", false);
    const { lerConfiguracaoDaLoja } = await importarLimpo();

    expect(lerConfiguracaoDaLoja()).toEqual({
      mpPublicKey: null,
      vapidPublicKey: null,
      pagamentoOnline: false,
      manutencao: false,
    });
  });

  it("sem ficha + DEV falso: os 4 atalhos falham fechados individualmente", async () => {
    vi.stubEnv("DEV", false);
    const {
      pagamentoOnlineLigado,
      modoManutencao,
      chavePublicaMercadoPago,
      chavePublicaVapid,
    } = await importarLimpo();

    expect(pagamentoOnlineLigado()).toBe(false);
    expect(modoManutencao()).toBe(false);
    expect(chavePublicaMercadoPago()).toBeNull();
    expect(chavePublicaVapid()).toBeNull();
  });

  it('sem ficha + DEV verdadeiro + env com VITE_PAGAMENTO_ONLINE diferente de "true" (ex.: "1"): permanece desligado — só a string exata liga', async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_PAGAMENTO_ONLINE", "1");
    const { pagamentoOnlineLigado } = await importarLimpo();

    expect(pagamentoOnlineLigado()).toBe(false);
  });

  it("sem ficha + DEV verdadeiro + env de chaves ausente (undefined): devolve null, nunca string vazia", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_MP_PUBLIC_KEY", undefined);
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", undefined);
    const { chavePublicaMercadoPago, chavePublicaVapid } =
      await importarLimpo();

    expect(chavePublicaMercadoPago()).toBeNull();
    expect(chavePublicaVapid()).toBeNull();
  });
});
