// @vitest-environment jsdom
import { MercadoPagoSection } from "@/components/admin/settings/MercadoPagoSection";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
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
    vi.useRealTimers();
  }
});
