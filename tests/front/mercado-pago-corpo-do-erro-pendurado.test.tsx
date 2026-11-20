// @vitest-environment jsdom
import { MercadoPagoSection } from "@/components/admin/settings/MercadoPagoSection";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const { invoke, toastError } = vi.hoisted(() => ({
  invoke: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("@/lib/supabase", () => ({ supabase: { functions: { invoke } } }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it("um corpo de erro sem resposta não prende a leitura de chaves", async () => {
  vi.useFakeTimers();
  const host = document.createElement("div");
  const raiz = createRoot(host);
  try {
    const resposta = new Response(null, { status: 500 });
    const copia = new Response(null, { status: 500 });
    const lerCorpo = vi
      .spyOn(copia, "json")
      .mockImplementation(() => new Promise(() => undefined));
    vi.spyOn(resposta, "clone").mockReturnValue(copia);
    invoke.mockResolvedValue({
      data: null,
      error: { name: "FunctionsHttpError", context: resposta },
    });

    await act(async () => raiz.render(<MercadoPagoSection />));
    expect(lerCorpo).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("Lendo as chaves salvas");
    await act(async () => vi.advanceTimersByTimeAsync(16_000));

    expect(host.textContent).not.toContain("Lendo as chaves salvas");
    expect(host.textContent).toContain("Tentar de novo");
  } finally {
    act(() => raiz.unmount());
    invoke.mockReset();
    vi.useRealTimers();
  }
});

it("avisa e libera Salvar chaves quando o corpo do erro de gravação não termina", async () => {
  vi.useFakeTimers();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const raiz = createRoot(host);
  try {
    const resposta = new Response(null, { status: 500 });
    const copia = new Response(null, { status: 500 });
    const lerCorpo = vi
      .spyOn(copia, "json")
      .mockImplementation(() => new Promise(() => undefined));
    vi.spyOn(resposta, "clone").mockReturnValue(copia);
    const chavePublicaFicticia = "TEST-00000000-0000-0000-0000-000000000000";
    invoke
      .mockResolvedValueOnce({
        data: { configurado: true, public_key: chavePublicaFicticia },
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { name: "FunctionsHttpError", context: resposta },
      });

    await act(async () =>
      raiz.render(<MercadoPagoSection abrirChavesGatilho={1} />),
    );
    const salvar = [...host.querySelectorAll("button")].find(
      (botao) => botao.textContent === "Salvar chaves",
    )!;
    expect(salvar.disabled).toBe(false);
    await act(async () => salvar.click());
    expect(invoke).toHaveBeenLastCalledWith("credenciais-mercado-pago", {
      body: { acao: "salvar", public_key: chavePublicaFicticia },
    });
    expect(lerCorpo).toHaveBeenCalledOnce();
    expect(salvar.disabled).toBe(true);
    expect(toastError).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(21_000));

    expect(toastError).toHaveBeenCalledWith(
      "Sem resposta da rede. Confira o estado das chaves na tela antes de tentar de novo.",
    );
    expect(salvar.disabled).toBe(false);
  } finally {
    act(() => raiz.unmount());
    host.remove();
    invoke.mockReset();
    toastError.mockReset();
    vi.useRealTimers();
  }
});
