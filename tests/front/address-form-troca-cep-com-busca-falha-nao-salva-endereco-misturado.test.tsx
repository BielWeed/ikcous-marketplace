// @vitest-environment jsdom
//
// "Novo endereço": a busca de CEP não acha o CEP A, a cliente preenche rua,
// bairro, cidade e UF à mão, troca para o CEP B e a busca também não acha.
// Antes, o cadastro aceitava o CEP B com o endereço do CEP A — uma rua de um
// lugar com o CEP de outro, gravada em silêncio (a limpeza só valia quando uma
// busca ANTERIOR tinha achado algo; o que a pessoa digita à mão não contava).
//
// Cobre só o caminho "a busca do CEP novo também falha". Quando a busca acha
// o endereço, o comportamento é outro e já tem teste próprio
// (address-form-rua-manual-sobrevive-cep-sem-logradouro, address-form-cep-race).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingCoverage: "national", originCep: "38500-000" },
    isLoaded: true,
  }),
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// address-form-cep-race.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const valor = (id: string) =>
  (document.getElementById(id) as HTMLInputElement).value;

async function esvaziar() {
  await act(async () => {
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
}

describe("AddressForm — trocar o CEP com a busca fora do ar não salva endereço misturado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let onSubmit: Mock<(endereco: unknown) => Promise<void>>;

  beforeEach(() => {
    onSubmit = vi
      .fn<(endereco: unknown) => Promise<void>>()
      .mockResolvedValue(undefined);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    // Nenhum provedor conhece nenhum CEP: os campos abrem para preencher à mão.
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          url.includes("viacep")
            ? { ok: true, status: 200, json: async () => ({ erro: "true" }) }
            : { ok: false, status: 404, json: async () => ({ error: true }) },
        ),
      ),
    );
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

  // Abre o formulário novo, digita o CEP A (a busca não acha) e preenche o
  // endereço inteiro à mão, mais número e complemento.
  async function preencherAMaoNoCepA() {
    const { AddressForm } = await import("@/components/ui/custom/AddressForm");
    await act(async () => {
      raiz.render(
        <AddressForm
          nomeDaConta="Mariana Lopes"
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />,
      );
    });
    await act(async () => {
      digitar("cep", "38509999");
    });
    await esvaziar();
    expect(document.getElementById("street")).not.toBeNull();
    await act(async () => {
      digitar("street", "Rua do CEP A");
      digitar("neighborhood", "Bairro do CEP A");
      digitar("city", "Cidade A");
      digitar("state", "mg");
      digitar("number", "77");
      digitar("complement", "Fundos");
    });
    // Âncora: o preenchimento à mão entrou.
    expect(valor("street")).toBe("Rua do CEP A");
    expect(valor("city")).toBe("Cidade A");
  }

  const botaoSalvar = () =>
    document.querySelector('button[type="submit"]') as HTMLButtonElement;

  it("CEP B também sem busca: o endereço do CEP A sai da tela, número e complemento ficam, e salvar pede o endereço de novo", async () => {
    await preencherAMaoNoCepA();

    // A cliente troca para o CEP B; a busca também não acha.
    await act(async () => {
      digitar("cep", "01310100");
    });
    await esvaziar();

    expect(valor("cep")).toBe("01310-100");
    expect(valor("street")).toBe("");
    expect(valor("neighborhood")).toBe("");
    expect(valor("city")).toBe("");
    expect(valor("state")).toBe("");
    // Número e complemento não pertencem ao CEP: ficam.
    expect(valor("number")).toBe("77");
    expect(valor("complement")).toBe("Fundos");

    await act(async () => {
      botaoSalvar().click();
    });
    await esvaziar();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Logradouro é obrigatório");
  });

  it("apagou um dígito e digitou o MESMO CEP de novo: o que ela preencheu fica e salva", async () => {
    await preencherAMaoNoCepA();

    await act(async () => {
      digitar("cep", "3850999");
    });
    await act(async () => {
      digitar("cep", "38509999");
    });
    await esvaziar();

    expect(valor("street")).toBe("Rua do CEP A");
    expect(valor("neighborhood")).toBe("Bairro do CEP A");
    expect(valor("city")).toBe("Cidade A");
    expect(valor("state")).toBe("MG");

    await act(async () => {
      botaoSalvar().click();
    });
    await esvaziar();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      cep: "38509-999",
      street: "Rua do CEP A",
      city: "Cidade A",
      state: "MG",
      number: "77",
    });
  });
});
