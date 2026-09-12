// @vitest-environment jsdom
//
// Achado do revisor Opus (grupo C, T2 item e): `configuracaoDoAmbienteDeBuild()`
// normalizava o assado com `?? null`, que só pega `undefined`/`null` — uma env
// DEFINIDA e VAZIA ("") atravessava como string vazia e violava o contrato
// (`mpPublicKey`/`vapidPublicKey`: `string` NÃO VAZIA ou `null`, nunca "").
// Este arquivo é NOVO (não pode editar
// `configuracao-da-loja-sem-ficha-em-producao-falha-fechada.test.ts`, que já
// cobre "env ausente" — ver ali, linha 84 — mas não "env vazia"): prova que,
// sem ficha e em DEV, uma env vazia normaliza para `null`, o mesmo resultado
// de env ausente.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function importarLimpo() {
  vi.resetModules();
  return import("@/config/configuracaoDaLoja");
}

describe("configuracaoDaLoja.ts — env DEFINIDA e VAZIA em DEV normaliza para null", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    // Sem `#ikcous-loja` no DOM: `lerFichaDaLoja()` devolve `null`.
    vi.stubEnv("DEV", true);
  });
  afterEach(() => {
    document.head.innerHTML = "";
    vi.unstubAllEnvs();
  });

  it('sem ficha + DEV + VITE_MP_PUBLIC_KEY="" (definida e vazia): devolve null, não ""', async () => {
    vi.stubEnv("VITE_MP_PUBLIC_KEY", "");
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "Bassado-do-build");
    const { chavePublicaMercadoPago } = await importarLimpo();

    expect(chavePublicaMercadoPago()).toBeNull();
    expect(chavePublicaMercadoPago()).not.toBe("");
  });

  it('sem ficha + DEV + VITE_VAPID_PUBLIC_KEY="" (definida e vazia): devolve null, não ""', async () => {
    vi.stubEnv("VITE_MP_PUBLIC_KEY", "APP_USR-assado-do-build");
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "");
    const { chavePublicaVapid } = await importarLimpo();

    expect(chavePublicaVapid()).toBeNull();
    expect(chavePublicaVapid()).not.toBe("");
  });

  it('sem ficha + DEV + as duas env definidas e vazias ou só espaço (" "): lerConfiguracaoDaLoja() devolve null nas duas, sem tocar pagamentoOnline/manutencao', async () => {
    vi.stubEnv("VITE_MP_PUBLIC_KEY", "");
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "   ");
    vi.stubEnv("VITE_PAGAMENTO_ONLINE", "true");
    vi.stubEnv("VITE_MAINTENANCE_MODE", "false");
    const { lerConfiguracaoDaLoja } = await importarLimpo();

    expect(lerConfiguracaoDaLoja()).toEqual({
      mpPublicKey: null,
      vapidPublicKey: null,
      pagamentoOnline: true,
      manutencao: false,
    });
  });

  it('sem ficha + DEV + VITE_MP_PUBLIC_KEY="  APP_USR-com-espaco  " (com espaço nas pontas): devolve trimado, não a string crua', async () => {
    vi.stubEnv("VITE_MP_PUBLIC_KEY", "  APP_USR-com-espaco  ");
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "Bassado-do-build");
    const { chavePublicaMercadoPago } = await importarLimpo();

    expect(chavePublicaMercadoPago()).toBe("APP_USR-com-espaco");
  });
});
