// @vitest-environment jsdom
//
// Balcão — buscar PRODUTO e buscar CLIENTE com a rede PENDURADA (conectada,
// mas sem responder). Antes: as duas consultas não tinham prazo, a tela ficava
// em "Buscando…" para sempre e, como a busca "ainda estava no ar", repetir o
// mesmo termo não refazia a consulta. Agora a consulta tem prazo (20 s, o das
// consultas do painel), a espera termina na falha que a tela já sabe mostrar
// (com "Tentar de novo") e a resposta que chega depois do prazo é descartada.
//
// Molde: balcao-busca-do-produto-corrida.test.tsx (AdminPdvView real, RPC
// pendente até o teste resolver) e admin-pdv-cupom-e-cliente.test.tsx.
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

import { AdminPdvView } from "@/views/admin/AdminPdvView";

const PRAZO_MS = 20_000;

interface Pendente {
  readonly nome: string;
  readonly params: Record<string, unknown>;
  readonly resolver: (valor: unknown) => void;
}

function produto(numero: number) {
  return {
    id: `Vestido-${numero}`,
    nome: `Vestido ${numero}`,
    preco_venda: 100,
    estoque: 5,
    imagem_url: null,
    imagem_urls: null,
    product_variants: [],
  };
}

function pagina(itens: readonly unknown[], total: number) {
  return { data: { data: itens, total_count: total }, error: null };
}

function lote(inicio: number, quantos: number) {
  return Array.from({ length: quantos }, (_, i) => produto(inicio + i));
}

function digitarInput(id: string, valor: string): void {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function botao(raiz: ParentNode, texto: string): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

async function avancar(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("Balcão — buscas com a rede pendurada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let pendentes: Pendente[];

  beforeEach(() => {
    const armazem = new Map<string, string>();
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
    vi.spyOn(console, "error").mockImplementation(() => {});
    pendentes = [];
    rpcMock.mockReset();
    rpcMock.mockImplementation(
      (nome: string, params: Record<string, unknown>) =>
        new Promise((resolver) => {
          pendentes.push({ nome, params, resolver });
        }),
    );
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

  async function resolver(indice: number, valor: unknown): Promise<void> {
    await act(async () => {
      pendentes.at(indice)!.resolver(valor);
    });
    await avancar();
  }

  const buscando = () => (hospedeiro.textContent ?? "").includes("Buscando…");
  const chamadas = (nome: string) =>
    rpcMock.mock.calls.filter(([n]) => n === nome).length;

  async function abrirBuscaDeProduto(): Promise<void> {
    await act(async () => {
      raiz.render(<AdminPdvView onNavigate={vi.fn()} active />);
    });
    await avancar();
    await act(async () => {
      botao(hospedeiro, "Buscar")!.click();
    });
    await avancar();
  }

  async function abrirBuscaDeCliente(): Promise<void> {
    await act(async () => {
      raiz.render(<AdminPdvView onNavigate={vi.fn()} active />);
    });
    await avancar();
    await act(async () => {
      botao(hospedeiro, "Cliente (opcional)")!.click();
    });
    await avancar();
    await act(async () => {
      botao(hospedeiro, "Buscar cliente")!.click();
    });
    await avancar();
  }

  async function digitar(id: string, termo: string): Promise<void> {
    await act(async () => {
      digitarInput(id, termo);
    });
    await avancar(400);
  }

  describe("produto", () => {
    it("a lista base que não responde: depois do prazo sai de 'Buscando…' e mostra a falha com 'Tentar de novo'", async () => {
      await abrirBuscaDeProduto();
      expect(buscando()).toBe(true);

      await avancar(PRAZO_MS);

      expect(buscando()).toBe(false);
      expect(hospedeiro.textContent).toContain("Falha na busca de produtos");
      expect(botao(hospedeiro, "Tentar de novo")).toBeTruthy();
    });

    it("'Tentar de novo' depois do prazo refaz a consulta e mostra o resultado", async () => {
      await abrirBuscaDeProduto();
      await avancar(PRAZO_MS);

      await act(async () => {
        botao(hospedeiro, "Tentar de novo")!.click();
      });
      await avancar();
      expect(chamadas("get_admin_products_paged")).toBe(2);
      await resolver(1, pagina(lote(1, 2), 2));

      expect(buscando()).toBe(false);
      expect(hospedeiro.textContent).toContain("Vestido 1");
      expect(hospedeiro.textContent).not.toContain("Falha na busca");
    });

    it("termo digitado que não responde: repetir o MESMO termo (campo perde o foco) refaz a consulta", async () => {
      await abrirBuscaDeProduto();
      const campo = document.getElementById(
        "busca-manual-de-produto",
      ) as HTMLInputElement;
      await act(async () => {
        campo.focus();
      });
      await digitar("busca-manual-de-produto", "vestido");
      expect(chamadas("get_admin_products_paged")).toBe(2);

      await avancar(PRAZO_MS);
      expect(buscando()).toBe(false);
      expect(hospedeiro.textContent).toContain("Falha na busca de produtos");

      await act(async () => {
        campo.blur();
      });
      await avancar();
      expect(chamadas("get_admin_products_paged")).toBe(3);
    });

    it("a resposta que chega DEPOIS do prazo é descartada", async () => {
      await abrirBuscaDeProduto();
      await digitar("busca-manual-de-produto", "vestido");
      await avancar(PRAZO_MS);
      expect(hospedeiro.textContent).toContain("Falha na busca de produtos");

      // A rede volta e entrega a resposta da consulta já abandonada.
      await resolver(1, pagina(lote(1, 8), 20));

      expect(hospedeiro.textContent).toContain("Falha na busca de produtos");
      expect(hospedeiro.textContent).not.toContain("Vestido 1");
    });

    it("'Mostrar mais' que não responde: solta o botão e mantém a lista que já estava na tela", async () => {
      await abrirBuscaDeProduto();
      await digitar("busca-manual-de-produto", "vestido");
      await resolver(1, pagina(lote(1, 8), 20));

      await act(async () => {
        botao(hospedeiro, "Mostrar mais")!.click();
      });
      await avancar();
      expect(botao(hospedeiro, "Mostrar mais")?.disabled).toBe(true);

      await avancar(PRAZO_MS);

      expect(buscando()).toBe(false);
      expect(hospedeiro.textContent).toContain("Falha na busca de produtos");
      expect(hospedeiro.textContent).toContain("Vestido 8");

      // Repetir a página que travou pede a MESMA página (1), não recomeça.
      await act(async () => {
        botao(hospedeiro, "Tentar de novo")!.click();
      });
      await avancar();
      expect(pendentes.at(-1)!.params.p_page).toBe(1);
    });
  });

  describe("cliente", () => {
    it("a busca que não responde: depois do prazo sai de 'Buscando…' e avisa que não foi possível", async () => {
      await abrirBuscaDeCliente();
      await digitar("busca-de-cliente-do-balcao", "maria");
      expect(buscando()).toBe(true);

      await avancar(PRAZO_MS);

      expect(buscando()).toBe(false);
      expect(hospedeiro.textContent).toContain("Não foi possível buscar");
    });

    it("repetir o MESMO termo depois do prazo refaz a consulta", async () => {
      await abrirBuscaDeCliente();
      const campo = document.getElementById(
        "busca-de-cliente-do-balcao",
      ) as HTMLInputElement;
      await act(async () => {
        campo.focus();
      });
      await digitar("busca-de-cliente-do-balcao", "maria");
      await avancar(PRAZO_MS);
      expect(chamadas("get_admin_customers_paged")).toBe(1);

      await act(async () => {
        campo.blur();
      });
      await avancar();
      expect(chamadas("get_admin_customers_paged")).toBe(2);
    });

    it("a resposta que chega DEPOIS do prazo é descartada", async () => {
      await abrirBuscaDeCliente();
      await digitar("busca-de-cliente-do-balcao", "maria");
      await avancar(PRAZO_MS);
      expect(hospedeiro.textContent).toContain("Não foi possível buscar");

      await resolver(0, {
        data: {
          data: [
            { id: "c1", full_name: "Maria Tardia", email: null, phone: null },
          ],
          total_count: 1,
        },
        error: null,
      });

      expect(hospedeiro.textContent).toContain("Não foi possível buscar");
      expect(hospedeiro.textContent).not.toContain("Maria Tardia");
    });
  });
});
