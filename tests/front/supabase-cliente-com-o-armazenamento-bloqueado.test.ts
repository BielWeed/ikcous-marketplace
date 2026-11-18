// @vitest-environment jsdom
//
// O CLIENTE DO BANCO NASCE COM O ARMAZENAMENTO DO NAVEGADOR BLOQUEADO
// (caça, r430-a).
//
// `src/lib/supabase.ts` é o primeiro módulo da loja a rodar (main.tsx →
// AuthContext → supabase). Ele passava `globalThis.localStorage` como
// armazenamento da sessão: com "Bloquear todos os cookies e dados de sites"
// (Chrome/Safari) o ACESSO à propriedade lança SecurityError, e o erro saía na
// AVALIAÇÃO do módulo — antes do React, antes do error boundary: tela em
// branco, sem mensagem nem botão, para sempre. Sem armazenamento, o cliente
// deve nascer e guardar a sessão só na memória (padrão do supabase-js quando
// não recebe `storage`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArmazenamentoComCota } from "./helpers/armazenamento-com-cota";

vi.mock("@/lib/env", () => ({
  SUPABASE_URL: "https://loja-de-teste.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "chave-publica-de-teste",
}));

type NomeDoArmazenamento = "localStorage" | "sessionStorage";

function bloquearOAcesso(nome: NomeDoArmazenamento): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, nome);
  Object.defineProperty(globalThis, nome, {
    configurable: true,
    get() {
      throw new DOMException("The operation is insecure.", "SecurityError");
    },
  });
  return () => {
    if (original) Object.defineProperty(globalThis, nome, original);
    else Reflect.deleteProperty(globalThis, nome);
  };
}

// Campo interno do GoTrueClient (sem API pública para ler): é o que prova ONDE
// a sessão é guardada.
type ArmazenamentoDaSessao = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;
function armazenamentoDoCliente(cliente: {
  auth: unknown;
}): ArmazenamentoDaSessao {
  return (cliente.auth as { storage: ArmazenamentoDaSessao }).storage;
}

describe("lib/supabase com o armazenamento do navegador bloqueado", () => {
  const desfazer: Array<() => void> = [];

  beforeEach(() => {
    // O jsdom não tem Worker e o realtime só confere que ele existe.
    vi.stubGlobal("Worker", class DubleDeWorker {});
  });

  afterEach(() => {
    for (const f of desfazer.splice(0)) f();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("localStorage lançando ao ACESSAR: o módulo carrega e o cliente nasce", async () => {
    desfazer.push(bloquearOAcesso("localStorage"));
    desfazer.push(bloquearOAcesso("sessionStorage"));
    vi.resetModules();

    const { supabase } = await import("@/lib/supabase");

    expect(typeof supabase.auth.getSession).toBe("function");
    expect(typeof supabase.from).toBe("function");
    // A sessão fica na memória: o armazenamento que o cliente usa não lança.
    expect(() => armazenamentoDoCliente(supabase).getItem("x")).not.toThrow();
  });

  it("controle: com o armazenamento normal o cliente guarda e lê a sessão no localStorage", async () => {
    const real = new ArmazenamentoComCota(1_000_000);
    vi.stubGlobal("localStorage", real);
    vi.resetModules();

    const { supabase } = await import("@/lib/supabase");
    const sessao = armazenamentoDoCliente(supabase);
    sessao.setItem("sb-sessao", '{"access_token":"a"}');

    expect(real.getItem("sb-sessao")).toBe('{"access_token":"a"}');
    expect(sessao.getItem("sb-sessao")).toBe('{"access_token":"a"}');
    sessao.removeItem("sb-sessao");
    expect(real.getItem("sb-sessao")).toBeNull();
  });

  it("localStorage cheio (setItem lança): guardar a sessão não lança e ela fica legível", async () => {
    const cheio = new ArmazenamentoComCota(0);
    vi.stubGlobal("localStorage", cheio);
    vi.resetModules();

    const { supabase } = await import("@/lib/supabase");
    const sessao = armazenamentoDoCliente(supabase);

    // O SDK chama exatamente isto ao concluir o login (setItemAsync).
    expect(() =>
      sessao.setItem("sb-sessao", '{"access_token":"a"}'),
    ).not.toThrow();
    expect(sessao.getItem("sb-sessao")).toBe('{"access_token":"a"}');
    expect(cheio.getItem("sb-sessao")).toBeNull();
    expect(() => sessao.removeItem("sb-sessao")).not.toThrow();
    expect(sessao.getItem("sb-sessao")).toBeNull();
  });

  it("localStorage com os MÉTODOS lançando: ler e guardar a sessão não lança", async () => {
    const recusar = () => {
      throw new DOMException("insecure", "SecurityError");
    };
    vi.stubGlobal("localStorage", {
      getItem: recusar,
      setItem: recusar,
      removeItem: recusar,
    });
    vi.resetModules();

    const { supabase } = await import("@/lib/supabase");
    const sessao = armazenamentoDoCliente(supabase);

    expect(sessao.getItem("sb-sessao")).toBeNull();
    expect(() => sessao.setItem("sb-sessao", "{}")).not.toThrow();
    expect(sessao.getItem("sb-sessao")).toBe("{}");
    expect(() => sessao.removeItem("sb-sessao")).not.toThrow();
  });
});
