// @vitest-environment jsdom
import { BusinessHoursSection } from "@/components/admin/settings/BusinessHoursSection";
import { mensagemDoStatusNoWhatsapp } from "@/lib/mensagem-do-status-no-whatsapp";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { updateConfig } = vi.hoisted(() => ({
  updateConfig: vi.fn(async () => true),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { businessHours: null }, updateConfig }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "admin" },
    session: { user: { id: "admin" } },
    isAdmin: true,
    adminStatus: "admin",
  }),
}));
vi.mock("@/lib/env-valores", () => ({ lerSupabaseUrl: () => "loja-teste" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

const invisivel = "\u{200b}\u{200c}\u{200d}\u{2060}\u{feff}\u{00a0}";

it("salva como ausente o horário que só tem caracteres invisíveis", async () => {
  const caixa = document.createElement("div");
  const raiz = createRoot(caixa);
  try {
    act(() => raiz.render(<BusinessHoursSection onDirtyChange={vi.fn()} />));
    const campo = caixa.querySelector("input") as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(campo, invisivel);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => caixa.querySelector("button")?.click());
    expect(updateConfig).toHaveBeenCalledWith(
      { businessHours: null },
      expect.anything(),
    );
  } finally {
    act(() => raiz.unmount());
  }
});

it("pede confirmação quando o horário antigo não tem texto visível", () => {
  const mensagem = mensagemDoStatusNoWhatsapp({
    nomeDoCliente: "Ana",
    numeroDoPedido: "123",
    rotuloDoStatus: "Pronto para retirar",
    nomeDaLoja: "Loja Exemplo",
    status: "shipping",
    retiradaNaLoja: true,
    horarioDeAtendimento: invisivel,
  });

  expect(mensagem).toContain(
    "Confirme o horário de retirada com a loja antes de vir.",
  );
  expect(mensagem).not.toContain("Horário:");
});
