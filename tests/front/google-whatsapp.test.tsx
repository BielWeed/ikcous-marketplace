// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
// @ts-expect-error flag de testes do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const salvar = vi.fn();
beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  salvar.mockReset();
  history.replaceState(null, "", "/profile");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
  vi.restoreAllMocks();
});
async function montar(opcoes: Record<string, any> = {}) {
  const { AvisoWhatsappGoogle } = await import(
    "@/views/shared/AvisoWhatsappGoogle"
  );
  await act(async () =>
    root.render(
      <AvisoWhatsappGoogle
        key={opcoes.user?.id ?? "conta-a"}
        user={{ id: "conta-a", identities: [{ provider: "google" }] }}
        profile={{ id: "conta-a", role: "customer", whatsapp: null }}
        habilitado
        updateProfile={salvar}
        {...opcoes}
      />,
    ),
  );
}
const botao = (texto: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === texto)!;
it("Agora não dispensa para sempre, por conta, mesmo remontando", async () => {
  await montar();
  expect(host.textContent).toContain(
    "Seu WhatsApp, para a loja avisar do pedido",
  );
  await act(async () => botao("Agora não").click());
  await act(async () => root.render(null));
  vi.resetModules(); // Simula outra carga do módulo: a dispensa precisa estar no storage.
  await montar();
  expect(host.textContent).toBe("");
  await montar({
    user: { id: "conta-b", identities: [{ provider: "google" }] },
    profile: { id: "conta-b", role: "customer" },
  });
  expect(host.textContent).toContain("Seu WhatsApp");
});
it.each([
  { habilitado: false },
  { checkout: true },
  { profile: { id: "conta-a", role: "customer", whatsapp: "11999999999" } },
  { profile: { id: "conta-b", role: "customer" } },
  { profile: { id: "conta-a", role: "admin" } },
  { user: { id: "conta-a", identities: [{ provider: "email" }] } },
])("não interrompe quem não precisa do aviso (%j)", async (opcoes) => {
  await montar(opcoes);
  expect(host.textContent).toBe("");
});
it("salva só WhatsApp validado; se falhar continua pulável", async () => {
  salvar.mockResolvedValue(false);
  await montar();
  await act(async () => botao("Salvar").click());
  expect(salvar).not.toHaveBeenCalled();
  const input = host.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "11999999999");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => botao("Salvar").click());
  expect(salvar).toHaveBeenCalledWith(
    { whatsapp: "(11) 99999-9999" },
    { silencioso: true, contaEsperada: "conta-a" },
  );
  expect(host.textContent).toContain("Não deu para confirmar");
  await act(async () => botao("Agora não").click());
  expect(host.textContent).toBe("");
});
it("salvou: nunca mais pede", async () => {
  salvar.mockResolvedValue(true);
  await montar();
  const input = host.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "11999999999");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => botao("Salvar").click());
  await act(async () => root.render(null));
  vi.resetModules(); // Simula outra carga do módulo: a dispensa precisa estar no storage.
  await montar();
  expect(host.textContent).toBe("");
});
