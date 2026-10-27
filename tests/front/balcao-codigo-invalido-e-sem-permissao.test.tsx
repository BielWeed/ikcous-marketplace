// @vitest-environment jsdom
// O Balcão diz a frase certa quando o banco recusa o código de propósito.
import { AdminPdvView } from "@/views/admin/AdminPdvView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { rpc, toastError } = vi.hoisted(() => ({
  rpc: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn(), info: vi.fn() },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "operador" } }),
}));
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let raiz: Root;
let falha: unknown;
beforeEach(() => {
  const dados = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => dados.get(chave) ?? null,
    setItem: (chave: string, valor: string) => dados.set(chave, valor),
    removeItem: (chave: string) => dados.delete(chave),
  });
  vi.useFakeTimers();
  rpc.mockReset();
  toastError.mockReset();
  rpc.mockImplementation(async (nome: string) => {
    if (nome === "get_admin_products_paged")
      return { data: { data: [], total_count: 0 }, error: null };
    if (nome === "buscar_por_codigo_barras")
      return { data: null, error: falha };
    throw new Error(`RPC inesperada: ${nome}`);
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "");
});

async function bipar() {
  await act(async () =>
    raiz.render(<AdminPdvView active onNavigate={vi.fn()} />),
  );
  const buscar = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Buscar"),
  )!;
  await act(async () => buscar.click());
  await act(async () => {
    for (const key of [..."78912345", "Enter"]) {
      vi.advanceTimersByTime(5);
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    }
  });
}

it("código que o banco recusa (22023) mostra que o código não parece válido", async () => {
  falha = { code: "22023", message: "Código de barras inválido" };
  await bipar();
  expect(toastError).toHaveBeenCalledWith(
    "Esse código não parece válido. Confira a etiqueta.",
  );
});

it("acesso negado (42501) mostra a frase de permissão", async () => {
  falha = { code: "42501", message: "Acesso negado" };
  await bipar();
  expect(toastError).toHaveBeenCalledWith(
    "Sem permissão para consultar produtos.",
  );
});

it("outro erro continua pedindo para tentar de novo", async () => {
  falha = { code: "57014", message: "timeout" };
  await bipar();
  expect(toastError).toHaveBeenCalledWith(
    "Não consegui consultar esse código agora. Tente de novo.",
  );
});
