// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";
import { OrderSuccessView } from "@/views/customer/OrderSuccessView";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
// @ts-expect-error flag de teste do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it("Pedido feito é cartão no computador e mantém classes do celular", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(<OrderSuccessView onNavigate={vi.fn()} />),
    );
    const el = host.firstElementChild as HTMLElement;
    expect(classesDoCelular(el.className)).toBe(
      "flex min-h-full flex-col items-center justify-center bg-white px-6 py-12 text-center",
    );
    expect(el.className).toContain("lg:max-w-[560px]");
  } finally {
    act(() => root.unmount());
  }
});

const fontes = import.meta.glob("/src/views/customer/CheckoutView.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});
const fonte = fontes["/src/views/customer/CheckoutView.tsx"] as string;
it.each([
  "SuccessView",
  "PagamentoConfirmadoView",
  "PagamentoForaDoPrazoView",
  "AddressSelectionView",
])("%s ganha cartão só a partir de lg", (nome) => {
  const trecho = fonte.slice(fonte.indexOf(`function ${nome}(`));
  const classe = trecho.match(
    /return \(\s*<div className=\{cn\(\s*"([^"]+)",\s*"([^"]+)"/,
  );
  expect(classe).not.toBeNull();
  expect(classesDoCelular(classe![2])).toBe("");
  expect(classe![2]).toContain("lg:max-w-[560px]");
});
