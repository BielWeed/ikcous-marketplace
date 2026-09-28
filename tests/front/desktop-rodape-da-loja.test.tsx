import type { StoreConfig, View } from "@/types";
// @vitest-environment jsdom
import { type ComponentType, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let config: Partial<StoreConfig>;
let logado = false;
vi.mock("@/contexts/StoreContext", () => ({ useStore: () => ({ config }) }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: logado ? { id: "prova" } : null }),
}));
const modulos = import.meta.glob<{
  RodapeDaLoja: ComponentType<{ onNavigate: (view: View) => void }>;
}>("../../src/components/desktop/*.tsx");
// @ts-expect-error flag interna do React para act.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const navegar = vi.fn();
beforeEach(() => {
  config = { storeName: "Loja da prova" };
  logado = false;
  navegar.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function montar() {
  const carregar = modulos["../../src/components/desktop/RodapeDaLoja.tsx"];
  expect(carregar, "F1.14 precisa fornecer o rodapé da loja").toBeTypeOf(
    "function",
  );
  const { RodapeDaLoja } = await carregar();
  await act(async () => root.render(<RodapeDaLoja onNavigate={navegar} />));
}
it("com dados completos mostra marca, navegação, conta e atendimento", async () => {
  config = {
    ...config,
    logoUrl: "/logo.png",
    storeCity: "Cidade",
    storeState: "UF",
    storeAddress: "Rua da prova",
    businessHours: "Segunda a sexta",
    whatsappNumber: "(11) 99999-0000",
  };
  await montar();
  expect(host.querySelector("footer")).not.toBeNull();
  for (const trecho of [
    "Loja da prova",
    "Cidade, UF",
    "Navegue",
    "Sua conta",
    "Atendimento",
    "Rua da prova",
    "Segunda a sexta",
    `© ${new Date().getFullYear()} Loja da prova`,
  ])
    expect(host.textContent).toContain(trecho);
  expect(
    host.querySelector('a[href="https://wa.me/5511999990000"]'),
  ).not.toBeNull();
});
it("dados ausentes não produzem atendimento vazio nem undefined", async () => {
  await montar();
  expect(host.textContent).not.toContain("Atendimento");
  expect(host.textContent).not.toContain("undefined");
  expect(host.querySelector("a")).toBeNull();
  expect(host.querySelector("img")).toBeNull();
});
it("os links navegam para as telas existentes, inclusive a conta logada", async () => {
  logado = true;
  await montar();
  for (const [nome, view] of [
    ["Início", "home"],
    ["Favoritos", "favorites"],
    ["Carrinho", "cart"],
    ["Meus pedidos", "orders"],
    ["Minha conta", "profile"],
    ["Configurações", "account-settings"],
    ["Sobre a loja", "about-store"],
  ]) {
    act(() =>
      [...host.querySelectorAll("button")]
        .find((el) => el.textContent === nome)!
        .click(),
    );
    expect(navegar).toHaveBeenLastCalledWith(view);
  }
});
