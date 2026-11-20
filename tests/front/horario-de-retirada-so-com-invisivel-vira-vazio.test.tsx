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

const cozinheira = "👩🏽\u{200d}🍳";
const apertoDeMao = "🧑🏻\u{200d}🤝\u{200d}🧑🏿";
const bandeira =
  "\u{1f3f4}\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}";
const tecla = "#\u{fe0f}\u{20e3}";

it.each([
  ["horário só de invisíveis", invisivel, null],
  ["emoji de cozinheira com tom de pele", cozinheira, cozinheira],
  ["emoji de aperto de mão com tons diferentes", apertoDeMao, apertoDeMao],
  ["bandeira com tags Unicode", bandeira, bandeira],
  ["emoji de tecla", tecla, tecla],
  [
    "horário com emoji composto",
    "Seg a Sex 🧑\u{200d}🍳 8h",
    "Seg a Sex 🧑\u{200d}🍳 8h",
  ],
])("salva corretamente: %s", async (_caso, digitado, esperado) => {
  const caixa = document.createElement("div");
  const raiz = createRoot(caixa);
  try {
    act(() => raiz.render(<BusinessHoursSection onDirtyChange={vi.fn()} />));
    const campo = caixa.querySelector("input") as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(campo, digitado);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => caixa.querySelector("button")?.click());
    expect(updateConfig).toHaveBeenLastCalledWith(
      { businessHours: esperado },
      expect.anything(),
    );
  } finally {
    act(() => raiz.unmount());
  }
});

it.each([invisivel, "\u{2800}", "\u{3164}"])(
  "pede confirmação quando o horário antigo não tem texto visível (%j)",
  (horario) => {
    const mensagem = mensagemDoStatusNoWhatsapp({
      nomeDoCliente: "Ana",
      numeroDoPedido: "123",
      rotuloDoStatus: "Pronto para retirar",
      nomeDaLoja: "Loja Exemplo",
      status: "shipping",
      retiradaNaLoja: true,
      horarioDeAtendimento: horario,
    });

    expect(mensagem).toContain(
      "Confirme o horário de retirada com a loja antes de vir.",
    );
    expect(mensagem).not.toContain("Horário:");
  },
);
