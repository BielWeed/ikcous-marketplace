// @vitest-environment jsdom
//
// CONFIGURACAO DA LOJA (build local, sem ficha, em DEV) — as duas flags do
// ambiente (`VITE_PAGAMENTO_ONLINE`, `VITE_MAINTENANCE_MODE`) so LIGAM com o
// texto exato "true". Vazio, "1", "TRUE", "yes" ou qualquer outra coisa
// = desligado.
//
// O que protege (buraco achado por mutacao, 24/11/2026): o teste vizinho
// (configuracao-da-loja-env-vazia-em-dev) so usa "true" e "false". Trocar a
// regra para "ligado a menos que seja 'false'" passava despercebido — e a loja
// de desenvolvimento acordava em MANUTENCAO (ou com cobranca online ligada) so
// porque alguem deixou a variavel vazia ou escreveu "1".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function importarLimpo() {
  vi.resetModules();
  return import("@/config/configuracaoDaLoja");
}

describe("configuracaoDaLoja.ts — flags do build em DEV so ligam com 'true'", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_MP_PUBLIC_KEY", "");
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "");
  });
  afterEach(() => {
    document.head.innerHTML = "";
    vi.unstubAllEnvs();
  });

  it.each(["", "1", "TRUE", "True", "yes", "on", " true"])(
    'VITE_MAINTENANCE_MODE="%s" nao liga a manutencao',
    async (valor) => {
      vi.stubEnv("VITE_MAINTENANCE_MODE", valor);
      vi.stubEnv("VITE_PAGAMENTO_ONLINE", "false");
      const { modoManutencao } = await importarLimpo();

      expect(modoManutencao()).toBe(false);
    },
  );

  it.each(["", "1", "TRUE", "True", "yes", "on", " true"])(
    'VITE_PAGAMENTO_ONLINE="%s" nao liga o pagamento online',
    async (valor) => {
      vi.stubEnv("VITE_PAGAMENTO_ONLINE", valor);
      vi.stubEnv("VITE_MAINTENANCE_MODE", "false");
      const { pagamentoOnlineLigado, lerConfiguracaoDaLoja } =
        await importarLimpo();

      expect(lerConfiguracaoDaLoja().pagamentoOnline).toBe(false);
      expect(pagamentoOnlineLigado()).toBe(false);
    },
  );

  it('so o texto exato "true" liga cada flag (e cada uma e independente da outra)', async () => {
    vi.stubEnv("VITE_MAINTENANCE_MODE", "true");
    vi.stubEnv("VITE_PAGAMENTO_ONLINE", "");
    const primeira = await importarLimpo();
    expect(primeira.modoManutencao()).toBe(true);
    expect(primeira.pagamentoOnlineLigado()).toBe(false);

    vi.stubEnv("VITE_MAINTENANCE_MODE", "");
    vi.stubEnv("VITE_PAGAMENTO_ONLINE", "true");
    const segunda = await importarLimpo();
    expect(segunda.modoManutencao()).toBe(false);
    expect(segunda.pagamentoOnlineLigado()).toBe(true);
  });
});
