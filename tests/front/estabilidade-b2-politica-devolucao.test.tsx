// @vitest-environment jsdom
import { PoliticaDeDevolucaoSection } from "@/components/admin/settings/PoliticaDeDevolucaoSection";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), ler: vi.fn(), dirty: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: h.rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: h.ler }) }) }),
  },
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [{ id: "1", name: "Calçados" }] }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeAddress: "Rua Um" } }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const politica = {
  id: 1,
  prazo_arrependimento_dias: 7,
  prazo_troca_dias: 30,
  prazo_vicio_dias: 90,
  aceita_troca: true,
  aceita_vale: true,
  exige_fotos_vicio: true,
  metodos_locais: ["entrega_na_loja", "coleta"],
  metodos_nacionais: ["etiqueta_reversa", "envio_proprio"],
  reembolso_momento: "ao_receber",
  frete_troca_pago_por: "cliente",
  categorias_sem_troca: [],
  texto_politica: null,
  endereco_devolucao: "Rua Dois",
  updated_at: null,
};
let raiz: Root;
let hospedeiro: HTMLDivElement;
beforeEach(async () => {
  vi.clearAllMocks();
  h.rpc.mockReset();
  h.ler.mockResolvedValue({ data: politica, error: null });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz.render(<PoliticaDeDevolucaoSection onDirtyMudou={h.dirty} />);
  });
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});
async function alterarTexto() {
  const campo = hospedeiro.querySelector("textarea")!;
  await act(async () => {
    campo.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(campo, "Texto enviado");
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    campo.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}
it.each(["", "   "])(
  "não salva endereço próprio em branco (%j)",
  async (endereco) => {
    h.rpc.mockResolvedValueOnce({
      data: { ...politica, endereco_devolucao: null },
      error: null,
    });
    const caixa = [
      ...hospedeiro.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"]',
      ),
    ].find((input) =>
      input.closest("label")?.textContent?.includes("Mesmo endereço da loja"),
    )!;
    const campo =
      hospedeiro.querySelector<HTMLInputElement>("#politica-endereco")!;
    expect(caixa.checked).toBe(false);
    await act(async () => {
      campo.focus();
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(campo, endereco);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => campo.blur());
    const salvar = hospedeiro.querySelector<HTMLButtonElement>(
      '[aria-label="Ações da política de devolução"] button',
    );
    expect(salvar?.disabled).toBe(true);
    expect(salvar?.textContent).toContain("Salvar política");
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "Informe o endereço de devolução ou marque 'Mesmo endereço da loja'.",
    );
    expect(h.rpc).not.toHaveBeenCalled();
    expect(caixa.checked).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
  },
);

it.each([false, true])(
  "trava todos os controles durante salvar e libera após erro=%s",
  async (falhar) => {
    let resolver!: (r: unknown) => void;
    h.rpc.mockReturnValueOnce(
      new Promise((resolve) => {
        resolver = resolve;
      }),
    );
    await alterarTexto();
    await act(async () => {
      Array.from(hospedeiro.querySelectorAll("button"))
        .find((b) => b.textContent?.includes("Salvar política"))!
        .click();
    });
    const controles = Array.from(
      hospedeiro.querySelectorAll("input, textarea, button"),
    );
    expect(controles.length).toBeGreaterThan(10);
    for (const controle of controles) {
      expect(controle.matches(":disabled")).toBe(true);
    }
    expect(h.dirty).toHaveBeenLastCalledWith(true);
    await act(async () => {
      resolver(
        falhar
          ? { data: null, error: new Error("rede") }
          : {
              data: { ...politica, texto_politica: "Texto enviado" },
              error: null,
            },
      );
    });
    expect(hospedeiro.querySelector("textarea")!.matches(":disabled")).toBe(
      false,
    );
    expect(hospedeiro.querySelector("textarea")!.value).toBe("Texto enviado");
    expect(h.dirty).toHaveBeenLastCalledWith(falhar);
  },
);
