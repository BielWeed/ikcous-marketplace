// @vitest-environment jsdom
//
// A busca de cliente do BALCÃO usa a porta leve `buscar_clientes_do_balcao`
// (migration 20261530000000), nunca mais a `get_admin_customers_paged` (que a
// cada pausa de digitação recalcula o CRM e junta todos os pedidos da loja).
// E SEM atalho: se a porta nova ainda não existe no banco (front publicado
// antes da migration), a tela mostra a falha da busca — não cai na porta
// antiga escondendo a ordem de publicação errada.
//
// Molde: tests/front/admin-pdv-cupom-e-cliente.test.tsx (createRoot + act,
// `@/lib/supabase` e `LeitorDeCodigo` mocados).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcMock },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja Teste" } }),
}));

vi.mock("@/components/admin/pdv/LeitorDeCodigo", () => ({
  LeitorDeCodigo: () => null,
}));

import { prepararTextoDeBuscaDoPainel } from "@/lib/texto-de-busca-do-painel";
import { AdminPdvView } from "@/views/admin/AdminPdvView";

const MARIA = {
  id: "cliente-1",
  full_name: "Maria Cliente",
  phone: "(34) 99999-1234",
  email: "maria@example.com",
};

function digitarInput(id: string, valor: string): void {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function botao(raizDom: ParentNode, texto: string): HTMLButtonElement {
  const achado = [...raizDom.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
  if (!achado) throw new Error(`botão "${texto}" não encontrado`);
  return achado;
}

async function avancar(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  });
}

const chamadasDe = (nome: string) =>
  rpcMock.mock.calls.filter(([n]) => n === nome);

describe("balcão — a busca de cliente pela porta leve", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    armazem = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.useFakeTimers();
    rpcMock.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function buscarCliente(termo: string): Promise<void> {
    await act(async () => {
      raiz.render(<AdminPdvView onNavigate={vi.fn()} active />);
    });
    await avancar();
    await act(async () => botao(hospedeiro, "Cliente (opcional)").click());
    await avancar();
    await act(async () => botao(hospedeiro, "Buscar cliente").click());
    await avancar();
    await act(async () => {
      digitarInput("busca-de-cliente-do-balcao", termo);
    });
    await avancar(300);
  }

  it("chama SÓ buscar_clientes_do_balcao, com o termo preparado e 8 linhas, e mostra o que ela devolve", async () => {
    rpcMock.mockImplementation(async (nome: string) => {
      if (nome === "buscar_clientes_do_balcao") {
        return { data: { data: [MARIA], total_count: 1 }, error: null };
      }
      throw new Error(`RPC não esperada: ${nome}`);
    });

    await buscarCliente("  maria_50%  ");

    expect(chamadasDe("buscar_clientes_do_balcao")).toEqual([
      [
        "buscar_clientes_do_balcao",
        {
          p_search: prepararTextoDeBuscaDoPainel("  maria_50%  "),
          p_limite: 8,
        },
      ],
    ]);
    expect(chamadasDe("get_admin_customers_paged")).toEqual([]);
    expect(hospedeiro.textContent).toContain("Maria Cliente");
  });

  it("lê o total do banco da porta nova: 'Mostrando 8 de 143'", async () => {
    const oito = Array.from({ length: 8 }, (_, i) => ({
      ...MARIA,
      id: `silva-${i}`,
      full_name: `Silva ${i}`,
    }));
    rpcMock.mockImplementation(async (nome: string) => {
      if (nome === "buscar_clientes_do_balcao") {
        return { data: { data: oito, total_count: 143 }, error: null };
      }
      throw new Error(`RPC não esperada: ${nome}`);
    });

    await buscarCliente("silva");

    expect(hospedeiro.textContent).toContain("Silva 7");
    expect(hospedeiro.textContent).toContain("Mostrando 8 de 143");
  });

  it("porta nova ausente no banco (PGRST202): mostra a falha da busca e NÃO cai na porta antiga", async () => {
    rpcMock.mockImplementation(async (nome: string) => {
      if (nome === "buscar_clientes_do_balcao") {
        return {
          data: null,
          error: {
            code: "PGRST202",
            message:
              "Could not find the function public.buscar_clientes_do_balcao(p_limite, p_search) in the schema cache",
          },
        };
      }
      if (nome === "get_admin_customers_paged") {
        return { data: { data: [MARIA], total_count: 1 }, error: null };
      }
      throw new Error(`RPC não esperada: ${nome}`);
    });

    await buscarCliente("maria");

    expect(chamadasDe("buscar_clientes_do_balcao")).toHaveLength(1);
    expect(chamadasDe("get_admin_customers_paged")).toEqual([]);
    expect(hospedeiro.textContent).toContain("Não foi possível buscar");
    expect(hospedeiro.textContent).not.toContain("Maria Cliente");
  });
});
