// @vitest-environment jsdom
//
// A "Chave de acesso" da transportadora é um campo type="password" e o
// navegador (Chrome, Android, gerenciadores de senha) ignora
// autocomplete="off" nesse tipo de campo: oferecia a senha salva do painel
// para preencher uma chave de frete. "new-password" é o valor que eles
// respeitam (o Mercado Pago, na mesma área, já usa). A chave também não
// passa pelo corretor ortográfico.
//
// Chaves e e-mails abaixo são FICTÍCIOS.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      throw new Error("a seção não pode ler o banco direto");
    },
    functions: {
      invoke: (...args: unknown[]) => invoke(...(args as [any, any])),
    },
  },
}));
vi.mock("@/lib/revisao-do-frete", () => ({
  descartarCacheDeFreteDoNavegador: () => {},
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = () => new Promise((r) => setTimeout(r, 0));

const CONFIG_DO_SERVIDOR = {
  success: true,
  modo: "legado",
  ligados: ["melhor_envio"],
  provedores: {
    melhor_envio: { tem_chave: true, sandbox: false, servicos: null },
    superfrete: { tem_chave: false, sandbox: false, servicos: null },
    frenet: { tem_chave: false, sandbox: false, servicos: null },
  },
};

describe("TransportadorasSection — chave de acesso não recebe a senha do painel", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    invoke.mockImplementation((_nome: string, opcoes: any) => {
      if (opcoes?.body?.action === "ler_configuracao_frete") {
        return Promise.resolve({ data: CONFIG_DO_SERVIDOR, error: null });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  it("os três campos de chave pedem new-password e sem corretor ortográfico", async () => {
    const { TransportadorasSection } = await import(
      "./apoio/transportadoras-isoladas"
    );
    await act(async () => {
      raiz.render(<TransportadorasSection active />);
    });
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await esperar();
      });
    }

    const campos = [
      ...hospedeiro.querySelectorAll('input[type="password"]'),
    ] as HTMLInputElement[];
    // Melhor Envio, SuperFrete e Frenet: um campo de chave cada.
    expect(campos.length).toBe(3);
    for (const campo of campos) {
      expect(campo.id).toMatch(/^chave-/);
      expect(campo.getAttribute("autocomplete")).toBe("new-password");
      expect(campo.getAttribute("spellcheck")).toBe("false");
    }
  });
});
