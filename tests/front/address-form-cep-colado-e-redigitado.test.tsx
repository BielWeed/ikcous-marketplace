// @vitest-environment jsdom
//
// Caça contínua, rodada 5 (f16 e f17) — CEP do cadastro de endereço.
//
// f16: o campo de CEP tinha `maxLength={9}`. O navegador corta o texto COLADO
// no limite ANTES do `onChange`: "38.500-000" ou " 38500-000" (10 caracteres)
// chegava com 7 dígitos, a busca nunca disparava e nada avisava. Quem limita o
// tamanho é `formatarCep` (8 dígitos); o atributo não pode cortar antes dela.
// O `digitar` abaixo não passa pelo corte do navegador (escreve o valor
// direto), então o que PROVA o defeito é o atributo ausente.
//
// f17: apagar o último dígito do CEP e digitar o MESMO de novo refazia a busca
// e escrevia a rua e o bairro do provedor por cima do que a pessoa corrigiu à
// mão. O checkout de convidado já protege isso (camposEditadosAMaoRef +
// mesmoCep); o cadastro de endereço da conta agora faz igual. CEP DIFERENTE
// continua preenchendo tudo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DadosDoFormularioDeEndereco } from "@/components/ui/custom/AddressForm";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingCoverage: "local", originCep: "38500-000" },
    isLoaded: true,
  }),
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Dados inventados (repositório público).
const ENDERECOS = new Map<string, Record<string, string>>([
  [
    "38500000",
    {
      logradouro: "Rua Tiradentes",
      bairro: "Centro",
      localidade: "Monte Carmelo",
      uf: "MG",
    },
  ],
  [
    "01310100",
    {
      logradouro: "Avenida Paulista",
      bairro: "Bela Vista",
      localidade: "São Paulo",
      uf: "SP",
    },
  ],
]);

function responder(url: string) {
  const cep = /(\d{8})/.exec(url)?.[1] ?? "";
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ENDERECOS.get(cep),
  });
}

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function botao(texto: string): HTMLButtonElement {
  const b = [...document.querySelectorAll("button")].find(
    (x) => x.textContent?.trim() === texto,
  );
  if (!b) throw new Error(`botão "${texto}" não existe na tela`);
  return b as HTMLButtonElement;
}

function cartao(): string | null {
  return (
    document.querySelector('[data-testid="cartao-do-endereco"]')?.textContent ??
    null
  );
}

function valor(id: string): string {
  return (document.getElementById(id) as HTMLInputElement).value;
}

async function esvaziar() {
  await act(async () => {
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
}

describe("AddressForm — CEP colado com máscara e CEP redigitado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  async function renderizar() {
    const { AddressForm } = await import("@/components/ui/custom/AddressForm");
    await act(async () => {
      raiz.render(
        <AddressForm
          onSubmit={vi.fn<(a: DadosDoFormularioDeEndereco) => Promise<void>>()}
          onCancel={vi.fn()}
        />,
      );
    });
  }

  async function digitarOCep(cep: string) {
    await act(async () => {
      digitar("cep", cep);
    });
    await esvaziar();
  }

  const buscasDoCep = (cep: string) =>
    fetchMock.mock.calls.filter(([url]) => String(url).includes(cep)).length;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    fetchMock = vi.fn((url: string) => responder(url));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("f16 — colar o CEP com ponto, espaço ou traço", () => {
    it("o campo de CEP não tem maxlength: o corte do navegador antes da máscara perdia o último dígito", async () => {
      await renderizar();
      expect(document.getElementById("cep")?.hasAttribute("maxlength")).toBe(
        false,
      );
    });

    it.each(["38.500-000", " 38500-000", "38500000"])(
      "colar %j busca o CEP inteiro e deixa o campo em 38500-000",
      async (colado) => {
        await renderizar();
        await digitarOCep(colado);

        expect(buscasDoCep("38500000")).toBeGreaterThan(0);
        expect(valor("cep")).toBe("38500-000");
        expect(cartao()).toContain("Rua Tiradentes");
      },
    );
  });

  describe("9º dígito sem o maxlength", () => {
    it("um dígito a mais depois do CEP achado não derruba o resultado", async () => {
      await renderizar();
      await digitarOCep("38500000");
      expect(cartao()).toContain("Rua Tiradentes");

      await digitarOCep("385000001");

      expect(valor("cep")).toBe("38500-000");
      expect(cartao()).toContain("Rua Tiradentes");
      expect(cartao()).toContain("Achado pelo CEP");
    });
  });

  describe("f17 — redigitar o mesmo CEP", () => {
    async function acharEEditarAMao() {
      await renderizar();
      await digitarOCep("38500000");
      expect(cartao()).toContain("Rua Tiradentes");

      await act(async () => {
        botao("Editar").click();
      });
      await act(async () => {
        digitar("street", "Rua Tiradentes, esquina com B");
        digitar("neighborhood", "Centro Velho");
      });
      expect(valor("street")).toBe("Rua Tiradentes, esquina com B");
    }

    it("apagar o último dígito e digitar o mesmo não desfaz a rua e o bairro corrigidos à mão", async () => {
      await acharEEditarAMao();
      const antes = buscasDoCep("38500000");

      await digitarOCep("3850000");
      await digitarOCep("38500000");

      // a busca roda de novo (o CEP é o mesmo, mas não há como saber)...
      expect(buscasDoCep("38500000")).toBeGreaterThan(antes);
      // ...e não escreve por cima do que a pessoa corrigiu.
      expect(cartao()).toContain("Rua Tiradentes, esquina com B");
      expect(cartao()).toContain("Centro Velho");
    });

    it("CEP DIFERENTE preenche rua e bairro de novo, mesmo depois de correção à mão", async () => {
      await acharEEditarAMao();

      await digitarOCep("01310100");

      expect(cartao()).toContain("Avenida Paulista");
      expect(cartao()).toContain("Bela Vista");
      expect(cartao()).not.toContain("esquina com B");
    });

    it("voltar ao CEP de antes depois de passar por outro também preenche de novo (a correção valia para o CEP anterior)", async () => {
      await acharEEditarAMao();
      await digitarOCep("01310100");
      await digitarOCep("38500000");

      expect(cartao()).toContain("Rua Tiradentes");
      expect(cartao()).not.toContain("esquina com B");
      expect(cartao()).toContain("Centro");
      expect(cartao()).not.toContain("Centro Velho");
    });
  });
});
