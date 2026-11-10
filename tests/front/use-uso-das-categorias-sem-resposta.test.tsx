// @vitest-environment jsdom
// Sem prazo na RPC, Gerenciar categorias ficava carregando para sempre.
// O hook real deve encerrar a espera, conservar a última lista e permitir
// releitura. Resposta de pedido vencido/antigo nunca substitui a lista atual.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc } }));

const categoria = (nome: string) => ({
  id: "c1",
  nome,
  slug: "categoria",
  ativo: true,
  produtos: 0,
  produtos_excluidos: 0,
  banners: 0,
  regra_devolucao: 0,
});
const resposta = (nome: string) => ({ data: [categoria(nome)], error: null });

describe("useUsoDasCategorias — leitura sem resposta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let hook!: () => ReturnType<
    typeof import("@/hooks/useUsoDasCategorias").useUsoDasCategorias
  >;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    h.rpc.mockReset().mockReturnValue(new Promise(() => {}));
    const { useUsoDasCategorias } = await import("@/hooks/useUsoDasCategorias");
    let atual!: ReturnType<typeof useUsoDasCategorias>;
    function Sonda() {
      const valor = useUsoDasCategorias();
      useEffect(() => {
        atual = valor;
      });
      return (
        <>
          <p role="status">{valor.carregando ? "Carregando" : "Pronto"}</p>
          <p role="alert">{valor.erro}</p>
          <ul>
            {valor.usos?.map((c) => (
              <li key={c.id}>{c.nome}</li>
            ))}
          </ul>
        </>
      );
    }
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<Sonda />);
    });
    hook = () => atual;
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
  });

  async function passar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("primeira carga termina aos 20 s com aviso e permite tentar de novo", async () => {
    await passar(19_999);
    expect(hook().carregando).toBe(true);
    expect(hook().erro).toBeNull();
    await passar(1);

    expect(hook().carregando).toBe(false);
    expect(hook().erro).toMatch(/conexão está lenta/i);
    expect(hook().erro).toMatch(/Tentar de novo/);
    expect(hook().usos).toBeNull();

    h.rpc.mockResolvedValue(resposta("Jogos"));
    await act(async () => {
      await hook().recarregar();
    });
    expect(hook().erro).toBeNull();
    expect(hospedeiro.querySelector("li")?.textContent).toBe("Jogos");
    expect(h.rpc).toHaveBeenCalledTimes(2);
    expect(h.rpc).toHaveBeenLastCalledWith("categorias_com_uso");
  });

  it("mantém a lista anterior e ignora a resposta vencida mesmo após nova consulta", async () => {
    h.rpc.mockResolvedValueOnce(resposta("Brinquedos"));
    await act(async () => {
      await hook().recarregar();
    });

    let responder!: (valor: unknown) => void;
    h.rpc.mockReturnValueOnce(
      new Promise((resolve) => {
        responder = resolve;
      }),
    );
    await act(async () => {
      void hook().recarregar();
    });
    await passar(20_000);

    expect(hook().carregando).toBe(false);
    expect(hook().erro).toMatch(/conexão está lenta/i);
    expect(hospedeiro.querySelector("li")?.textContent).toBe("Brinquedos");

    h.rpc.mockResolvedValueOnce(resposta("Jogos"));
    await act(async () => {
      await hook().recarregar();
    });
    await act(async () => {
      responder(resposta("Resposta velha"));
    });
    expect(hospedeiro.querySelector("li")?.textContent).toBe("Jogos");
    expect(hook().erro).toBeNull();
  });

  it("uma consulta mais antiga não encerra a espera nem apaga o erro da mais nova", async () => {
    let responder!: (valor: unknown) => void;
    h.rpc.mockReturnValueOnce(
      new Promise((resolve) => {
        responder = resolve;
      }),
    );
    await act(async () => {
      void hook().recarregar();
    });
    h.rpc.mockReturnValueOnce(new Promise(() => {}));
    await act(async () => {
      void hook().recarregar();
    });
    await act(async () => {
      responder(resposta("Antiga"));
    });
    expect(hook().carregando).toBe(true);
    expect(hook().usos).toBeNull();
    await passar(20_000);
    expect(hook().carregando).toBe(false);
    expect(hook().erro).toMatch(/conexão está lenta/i);
  });
});
