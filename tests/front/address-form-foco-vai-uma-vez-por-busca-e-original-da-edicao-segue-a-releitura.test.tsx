// @vitest-environment jsdom
//
// AddressForm — duas bordas sem guarda:
//  1. O cursor vai ao campo que falta UMA vez por resposta da busca do CEP.
//     CEP achado sem bairro leva o cursor ao bairro; se ela for corrigir a rua,
//     o cursor fica na rua (o efeito roda de novo a cada letra, mas já focou).
//  2. Rua digitada à mão e depois APAGADA volta a receber a rua da busca do
//     mesmo CEP (o bairro digitado e mantido continua).
//  3. Na EDIÇÃO, o "original" entregue ao salvar (usado para detectar que outro
//     aparelho mudou o endereço) é a versão em que a pessoa COMEÇOU a mexer:
//     se ela não tinha mexido em nada, uma releitura nova do servidor passa a
//     ser o original; se ela já tinha digitado, o original continua o antigo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DadosDoFormularioDeEndereco } from "@/components/ui/custom/AddressForm";
import type { Address } from "@/types";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingCoverage: "national", originCep: "38500-000" },
    isLoaded: true,
  }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  expect(el, `campo ${id} deve estar visível`).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function esvaziar() {
  await act(async () => {
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
}

const casa = (extra: Partial<Address> = {}): Address => ({
  id: "end-a",
  user_id: "conta",
  name: "Casa",
  recipient_name: "Ana",
  cep: "38500-000",
  street: "Rua do Comércio",
  number: "10",
  complement: "",
  neighborhood: "Centro",
  city: "Monte Carmelo",
  state: "MG",
  reference: "",
  is_default: true,
  ...extra,
});

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
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

describe("AddressForm — cursor depois da busca do CEP", () => {
  it("CEP achado sem bairro leva ao bairro; digitar na rua depois não devolve o cursor ao bairro", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          logradouro: "Rua das Flores",
          bairro: "",
          localidade: "Monte Carmelo",
          uf: "MG",
        }),
      })),
    );
    const { AddressForm } = await import("@/components/ui/custom/AddressForm");
    await act(async () => {
      raiz.render(<AddressForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    });

    await act(async () => {
      digitar("cep", "38500000");
    });
    await esvaziar();
    expect(document.activeElement?.id).toBe("neighborhood");
    expect(
      document.querySelector('[data-testid="cartao-do-endereco"]'),
    ).toBeNull();

    // Ela corrige a rua (que veio da busca): o cursor fica na rua, não volta
    // ao bairro a cada letra digitada.
    const rua = document.getElementById("street") as HTMLInputElement;
    act(() => rua.focus());
    expect(document.activeElement?.id).toBe("street");
    await act(async () => {
      digitar("street", "Rua das Flores, lado par");
    });
    await esvaziar();
    expect(document.activeElement?.id).toBe("street");
  });
});

describe("AddressForm — campo digitado à mão e depois apagado", () => {
  it("a rua apagada volta a receber a da busca; o bairro digitado e mantido continua", async () => {
    // 1º CEP não existe em nenhum provedor: os campos abrem para ela digitar.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("viacep")
          ? { ok: true, status: 200, json: async () => ({ erro: "true" }) }
          : {
              ok: false,
              status: 404,
              json: async () => ({ error: true, code: "not_found" }),
            },
      ),
    );
    const { AddressForm } = await import("@/components/ui/custom/AddressForm");
    await act(async () => {
      raiz.render(<AddressForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    });
    await act(async () => {
      digitar("cep", "38509999");
    });
    await esvaziar();
    expect(document.getElementById("street")).not.toBeNull();
    await act(async () => {
      digitar("street", "Rua Digitada");
      digitar("neighborhood", "Zona Rural");
    });
    // Ela muda de ideia e APAGA a rua.
    await act(async () => {
      digitar("street", "");
    });

    // Refaz a busca do MESMO CEP, agora com o endereço completo.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          logradouro: "Rua Oficial",
          bairro: "Centro Oficial",
          localidade: "Monte Carmelo",
          uf: "MG",
        }),
      })),
    );
    await act(async () => digitar("cep", "3850999"));
    await act(async () => digitar("cep", "38509999"));
    await esvaziar();

    const cartao = document.querySelector('[data-testid="cartao-do-endereco"]');
    expect(cartao).not.toBeNull();
    // A rua que ela apagou recebe a da busca; o bairro que ela digitou fica.
    expect(cartao?.textContent).toContain("Rua Oficial");
    expect(cartao?.textContent).toContain("Zona Rural");
    expect(cartao?.textContent).not.toContain("Centro Oficial");
  });
});

describe("AddressForm — original da edição", () => {
  let onSubmit: ReturnType<
    typeof vi.fn<
      (
        dados: DadosDoFormularioDeEndereco,
        mudou?: unknown,
        contexto?: { original: Address },
      ) => Promise<void>
    >
  >;

  beforeEach(() => {
    onSubmit = vi.fn().mockResolvedValue(undefined);
  });

  async function mostrar(initialData: Address) {
    const { AddressForm } = await import("@/components/ui/custom/AddressForm");
    await act(async () => {
      raiz.render(
        <AddressForm
          initialData={initialData}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />,
      );
    });
    await esvaziar();
  }

  async function salvar() {
    await act(async () => {
      hospedeiro
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    await esvaziar();
  }

  it("sem digitar nada: a releitura do servidor vira o original", async () => {
    await mostrar(casa({ number: "10" }));
    await mostrar(casa({ number: "100" }));

    await act(async () => {
      digitar("complement", "Apto 3");
    });
    await salvar();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][2]?.original.number).toBe("100");
  });

  it("já tinha digitado: o original continua a versão em que ela começou", async () => {
    await mostrar(casa({ number: "10" }));
    await act(async () => {
      digitar("number", "55");
    });
    await mostrar(casa({ number: "100" }));

    await salvar();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].number).toBe("55");
    expect(onSubmit.mock.calls[0][2]?.original.number).toBe("10");
  });
});
