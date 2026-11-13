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
function armazenamentoDoCliente(cliente: { auth: unknown }): Storage {
  return (cliente.auth as { storage: Storage }).storage;
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

  it("controle: com o armazenamento normal o cliente segue usando o localStorage", async () => {
    vi.resetModules();

    const { supabase } = await import("@/lib/supabase");

    expect(armazenamentoDoCliente(supabase)).toBe(globalThis.localStorage);
  });
});
