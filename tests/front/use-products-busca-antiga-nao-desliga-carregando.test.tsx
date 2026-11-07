import { useProducts } from "@/hooks/useProducts";
// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [],
    loadingProducts: false,
    fetchProducts: vi.fn(),
  }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let api: ReturnType<typeof useProducts>;
let root: Root;
let host: HTMLDivElement;
function Sonda() {
  const atual = useProducts({ autoFetch: false });
  useEffect(() => {
    api = atual;
  });
  return null;
}
function pendente() {
  let resolver!: (resposta: any) => void;
  const promessa = new Promise<any>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}
beforeEach(() => {
  rpc.mockReset();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  host = document.createElement("div");
  root = createRoot(host);
  act(() => root.render(<Sonda />));
});
afterEach(() => {
  act(() => root.unmount());
  vi.restoreAllMocks();
});

it("busca cancelada termina mas só a sucessora pode retirar o carregando", async () => {
  const primeira = pendente();
  const segunda = pendente();
  rpc.mockImplementationOnce(() => ({ abortSignal: () => primeira.promessa }));
  rpc.mockImplementationOnce(() => ({ abortSignal: () => segunda.promessa }));
  let p1!: Promise<unknown>;
  let p2!: Promise<unknown>;
  await act(async () => {
    p1 = api.loadProducts(0, 12, { search: "ca" });
  });
  await act(async () => {
    p2 = api.loadProducts(0, 12, { search: "camisa" });
  });
  expect(api.loading).toBe(true);
  await act(async () => {
    primeira.resolver({
      data: null,
      error: { name: "AbortError", message: "Fetch is aborted", status: 400 },
    });
    await p1;
  });
  expect(api.loading).toBe(true);
  await act(async () => {
    segunda.resolver({ data: { data: [], total_count: 0 }, error: null });
    await p2;
  });
  expect(api.loading).toBe(false);
});
