// @vitest-environment jsdom
//
// O marcador "avisos ligados neste aparelho" (que deixa o app religar o push
// sozinho depois da limpeza do app) tem de morrer quando a inscrição é solta
// DE PROPÓSITO: no Sair (`cancelarInscricaoDaConta`, da conta que sai) e
// quando o aparelho é solto sem sessão (`soltarInscricaoDoAparelho`: outra aba
// saiu, sessão expirou, conta trocada). Sem isso, quem saiu seria religada no
// próximo login sem ter tocado em nada.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
    }),
  },
}));

const CHAVE_A = "ikcous_push_avisos_ligados:conta-a";
const CHAVE_B = "ikcous_push_avisos_ligados:conta-b";

function instalarInscricao() {
  const inscricao = {
    endpoint: "https://push.exemplo/x",
    unsubscribe: vi.fn(async () => true),
  };
  Object.defineProperty(globalThis.navigator, "serviceWorker", {
    value: {
      getRegistration: async () => ({
        pushManager: { getSubscription: async () => inscricao },
      }),
    },
    configurable: true,
    writable: true,
  });
  vi.stubGlobal("PushManager", class {});
  return inscricao;
}

describe("Sair e soltar o aparelho esquecem o marcador de avisos ligados", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(CHAVE_A, "1");
    localStorage.setItem(CHAVE_B, "1");
    localStorage.setItem("ikcous_outra_coisa", "fica");
  });
  afterEach(() => {
    Reflect.deleteProperty(globalThis.navigator, "serviceWorker");
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("cancelarInscricaoDaConta apaga o marcador da conta que sai (e só o dela)", async () => {
    const inscricao = instalarInscricao();
    const { cancelarInscricaoDaConta } = await import(
      "@/lib/inscricao-de-push-da-conta"
    );

    await cancelarInscricaoDaConta("conta-a");

    expect(inscricao.unsubscribe).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(CHAVE_A)).toBeNull();
    expect(localStorage.getItem(CHAVE_B)).not.toBeNull();
  });

  it("cancelarInscricaoDaConta apaga o marcador mesmo sem inscrição no navegador", async () => {
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const { cancelarInscricaoDaConta } = await import(
      "@/lib/inscricao-de-push-da-conta"
    );

    await cancelarInscricaoDaConta("conta-a");

    expect(localStorage.getItem(CHAVE_A)).toBeNull();
  });

  it("soltarInscricaoDoAparelho apaga o marcador de TODAS as contas, sem tocar no resto", async () => {
    instalarInscricao();
    const { soltarInscricaoDoAparelho } = await import(
      "@/lib/inscricao-de-push-da-conta"
    );

    await soltarInscricaoDoAparelho();

    expect(localStorage.getItem(CHAVE_A)).toBeNull();
    expect(localStorage.getItem(CHAVE_B)).toBeNull();
    expect(localStorage.getItem("ikcous_outra_coisa")).toBe("fica");
  });
});
