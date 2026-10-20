// @vitest-environment jsdom
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("useLocalStorage — JSON com tipo incompatível", () => {
  let raiz: Root;
  let alvo: HTMLDivElement;
  let valor: unknown;
  function Sonda({ chave, inicial }: { chave: string; inicial: unknown }) {
    const [atual] = useLocalStorage(chave, inicial);
    useEffect(() => {
      valor = atual;
    }, [atual]);
    return null;
  }

  beforeEach(() => {
    window.localStorage.clear();
    alvo = document.createElement("div");
    document.body.appendChild(alvo);
    raiz = createRoot(alvo);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    alvo.remove();
    vi.useRealTimers();
  });

  it.each(["null", "[]", '"texto"', "42", "true"])(
    "intervalo salvo como %s volta ao objeto inicial",
    async (json) => {
      const inicial = { start: "", end: "" };
      window.localStorage.setItem("admin_orders_date_range", json);
      await act(async () =>
        raiz.render(
          <Sonda chave="admin_orders_date_range" inicial={inicial} />,
        ),
      );
      expect(valor).toEqual(inicial);
    },
  );

  it.each([
    { inicial: [], salvo: {}, esperado: [] },
    { inicial: false, salvo: "false", esperado: "false" },
    { inicial: 0, salvo: "42", esperado: "42" },
    { inicial: "", salvo: 42, esperado: 42 },
    { inicial: "all", salvo: true, esperado: true },
    { inicial: 0, salvo: false, esperado: false },
    { inicial: "all", salvo: null, esperado: "all" },
    { inicial: "all", salvo: [], esperado: "all" },
    { inicial: "all", salvo: {}, esperado: "all" },
    { inicial: null, salvo: {}, esperado: null },
    { inicial: [0], salvo: [1, 2], esperado: [1, 2] },
    {
      inicial: { start: "", end: "" },
      salvo: { start: "2026-10-20", end: "" },
      esperado: { start: "2026-10-20", end: "" },
    },
    { inicial: false, salvo: true, esperado: true },
    { inicial: 0, salvo: 42, esperado: 42 },
    { inicial: "", salvo: "ok", esperado: "ok" },
    { inicial: null, salvo: null, esperado: null },
  ])(
    "valida a estrutura sem restringir uniões primitivas: $inicial → $salvo",
    async ({ inicial, salvo, esperado }) => {
      window.localStorage.setItem("chave", JSON.stringify(salvo));
      await act(async () =>
        raiz.render(<Sonda chave="chave" inicial={inicial} />),
      );
      expect(valor).toEqual(esperado);
    },
  );

  it('preserva o filtro de 5 estrelas quando o valor inicial é "all"', async () => {
    function SondaFiltro() {
      const [filtro] = useLocalStorage<number | "all">(
        "admin_reviews_rating_filter",
        "all",
      );
      useEffect(() => {
        valor = filtro;
      }, [filtro]);
      return null;
    }
    window.localStorage.setItem("admin_reviews_rating_filter", "5");
    await act(async () => raiz.render(<SondaFiltro />));
    expect(valor).toBe(5);
  });

  it("também preserva a união primitiva quando a chave muda", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem("avaliacoes-a", '"all"');
    window.localStorage.setItem("avaliacoes-b", "5");
    await act(async () =>
      raiz.render(<Sonda chave="avaliacoes-a" inicial="all" />),
    );
    expect(valor).toBe("all");
    await act(async () =>
      raiz.render(<Sonda chave="avaliacoes-b" inicial="all" />),
    );
    await act(async () => {
      vi.runAllTimers();
    });
    expect(valor).toBe(5);
  });

  it("também recusa null quando a chave muda depois da montagem", async () => {
    vi.useFakeTimers();
    const inicial = { start: "", end: "" };
    window.localStorage.setItem(
      "a",
      JSON.stringify({ start: "2026-10-01", end: "" }),
    );
    window.localStorage.setItem("b", "null");
    await act(async () => raiz.render(<Sonda chave="a" inicial={inicial} />));
    expect(valor).toEqual({ start: "2026-10-01", end: "" });
    await act(async () => raiz.render(<Sonda chave="b" inicial={inicial} />));
    await act(async () => {
      vi.runAllTimers();
    });
    expect(valor).toEqual(inicial);
  });
});
