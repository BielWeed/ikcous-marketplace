// @vitest-environment jsdom
//
// Complemento (e referência) só com espaços eram gravados como estavam e o cartão do
// endereço mostrava um traço solto ("Rua X, 10 -   "). Agora o formulário apara os dois
// campos antes de enviar (só espaços viram vazio) e o cartão apara na EXIBIÇÃO — o que
// cobre endereços que já estavam gravados com espaços. Texto real segue igual, só sem os
// espaços das pontas.
import { AddressList } from "@/components/ui/custom/AddressList";
import type { Address } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, isLoaded: true }),
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

async function esperarAte(condicao: () => boolean) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > 2000) {
      throw new Error("esperarAte: condição não ficou verdadeira em 2000ms");
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

const OBRIGATORIOS = {
  name: "Casa",
  street: "Rua de Teste",
  number: "123",
  neighborhood: "Bairro de Teste",
  city: "Cidade de Teste",
  state: "MG",
  recipient_name: "Pessoa de Teste",
};

describe("AddressForm — complemento e referência só com espaços", () => {
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
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          url.includes("viacep")
            ? { ok: true, status: 200, json: async () => ({ erro: "true" }) }
            : {
                ok: false,
                status: 404,
                json: async () => ({ error: true, code: "not_found" }),
              },
        ),
      ),
    );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function preencherEEnviar(extras: Record<string, string>) {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { AddressForm } = await import("@/components/ui/custom/AddressForm");
    await act(async () => {
      raiz.render(<AddressForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    });
    await act(async () => digitar("cep", "38500000"));
    await esperarAte(() => !!document.getElementById("street"));
    const outro = Array.from(hospedeiro.querySelectorAll("button")).find(
      (botao) => botao.textContent === "Outro",
    );
    expect(outro).toBeDefined();
    await act(async () => outro!.click());
    // O ponto de referência só aparece depois de pedir pelo botão "+".
    const pedirReferencia = Array.from(
      hospedeiro.querySelectorAll("button"),
    ).find((botao) => botao.textContent?.trim() === "Ponto de referência");
    expect(pedirReferencia).toBeDefined();
    await act(async () => pedirReferencia!.click());
    await act(async () => {
      for (const [campo, valor] of Object.entries({
        ...OBRIGATORIOS,
        ...extras,
      }))
        digitar(campo, valor);
    });
    await act(async () => {
      hospedeiro
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    await esperarAte(() => onSubmit.mock.calls.length > 0);
    return onSubmit.mock.calls[0][0] as Omit<Address, "id" | "user_id">;
  }

  it("complemento e referência só com espaços são gravados vazios", async () => {
    const enviado = await preencherEEnviar({
      complement: "   ",
      reference: "  ",
    });
    expect(enviado.complement).toBe("");
    expect(enviado.reference).toBe("");
  });

  it.each(
    [0x200b, 0x200e, 0x2800, 0x3164].map((codigo) =>
      String.fromCodePoint(codigo),
    ),
  )(
    "complemento invisível %j é enviado vazio sem alterar a referência visível",
    async (invisivel) => {
      const enviado = await preencherEEnviar({
        complement: invisivel,
        reference: " Perto da praça ",
      });
      expect(enviado.complement).toBe("");
      expect(enviado.reference).toBe("Perto da praça");
    },
  );

  it.each(
    [0x200b, 0x200e, 0x2800, 0x3164].map((codigo) =>
      String.fromCodePoint(codigo),
    ),
  )(
    "referência invisível %j é enviada vazia sem alterar o complemento visível",
    async (invisivel) => {
      const enviado = await preencherEEnviar({
        complement: " Apto 12 ",
        reference: invisivel,
      });
      expect(enviado.complement).toBe("Apto 12");
      expect(enviado.reference).toBe("");
    },
  );

  it("complemento com texto real vai igual, só sem os espaços das pontas", async () => {
    const enviado = await preencherEEnviar({
      complement: " Apto 12 ",
      reference: " Perto da praça ",
    });
    expect(enviado.complement).toBe("Apto 12");
    expect(enviado.reference).toBe("Perto da praça");
  });
});

describe("AddressList — cartão sem traço solto quando o complemento é só espaços", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  const base: Address = {
    id: "addr-1",
    user_id: "user-1",
    name: "Casa",
    recipient_name: "Maria de Lourdes",
    cep: "38600-123",
    street: "Rua das Acácias",
    number: "120",
    complement: "",
    neighborhood: "Jardim Primavera",
    city: "Paracatu",
    state: "MG",
    reference: null,
    is_default: true,
  };

  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  function linhaDaRua(complement: string) {
    act(() => {
      raiz.render(
        <AddressList
          addresses={[{ ...base, complement }]}
          onEdit={() => {}}
          onDelete={() => {}}
        />,
      );
    });
    return Array.from(hospedeiro.querySelectorAll("p")).find((p) =>
      p.textContent?.includes("Rua das Acácias"),
    )?.textContent;
  }

  it("complemento só com espaços: a linha da rua termina no número, sem ' - '", () => {
    expect(linhaDaRua("    ")).toBe("Rua das Acácias, 120");
  });

  it("complemento com texto: igual a hoje (com trim nas pontas)", () => {
    expect(linhaDaRua("Apto 12")).toBe("Rua das Acácias, 120 - Apto 12");
    expect(linhaDaRua("  Apto 12 ")).toBe("Rua das Acácias, 120 - Apto 12");
  });
});
