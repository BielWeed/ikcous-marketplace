// @vitest-environment jsdom
//
// Bloco "Contato da loja" das políticas — bordas sem guarda:
//  1. O link do WhatsApp sempre leva o código do país 55: número de 10 dígitos
//     (fixo) e de 11 (celular) ganham o 55; número que JÁ vem com 55 não ganha
//     outro. O texto da mensagem sai codificado para a URL.
//  2. O endereço aparece sem os espaços das pontas; endereço só com espaços não
//     conta como endereço.
//  3. A frase "ainda não cadastrou um contato" só aparece quando NÃO há
//     WhatsApp, nem e-mail, nem endereço.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { config, abrirWhatsapp } = vi.hoisted(() => ({
  config: { valor: {} as Record<string, unknown> },
  abrirWhatsapp: vi.fn(),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: config.valor }),
}));
vi.mock("@/lib/abrir-whatsapp", () => ({ abrirWhatsapp }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const cadeia = {
        select: () => cadeia,
        eq: () => cadeia,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      };
      return cadeia;
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeAll(async () => {
  await import("@/components/politicas/ConteudoDaPolitica");
}, 60_000);

beforeEach(() => {
  abrirWhatsapp.mockClear();
  config.valor = { storeName: "Loja da Ana" };
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

async function montar(extra: Record<string, unknown>) {
  config.valor = { storeName: "Loja da Ana", ...extra };
  const { ConteudoDaPolitica } = await import(
    "@/components/politicas/ConteudoDaPolitica"
  );
  await act(async () => {
    raiz.render(<ConteudoDaPolitica tipo="termos" />);
  });
}

const contato = () =>
  hospedeiro.querySelector(
    'section[aria-labelledby="politica-contato-da-loja"]',
  ) as HTMLElement;

const botaoWhatsapp = () =>
  [...contato().querySelectorAll("button")].find((b) =>
    b.textContent?.includes("WhatsApp"),
  ) as HTMLButtonElement;

const MENSAGEM = "Ol%C3%A1!%20Vim%20pelo%20app%20da%20loja.";

describe("Contato da loja — link do WhatsApp", () => {
  it.each([
    ["celular com DDD (11 dígitos)", "(34) 99999-0000", "5534999990000"],
    ["fixo com DDD (10 dígitos)", "(34) 3333-0000", "553433330000"],
    [
      "já com o 55 na frente (13 dígitos)",
      "+55 34 99999-0000",
      "5534999990000",
    ],
    ["já com o 55 na frente (12 dígitos)", "55 34 3333-0000", "553433330000"],
  ])("%s", async (_nome, numero, esperado) => {
    await montar({ whatsappNumber: numero });
    await act(async () => botaoWhatsapp().click());
    expect(abrirWhatsapp).toHaveBeenCalledExactlyOnceWith(
      `https://wa.me/${esperado}?text=${MENSAGEM}`,
    );
  });
});

describe("Contato da loja — endereço e frase de 'sem contato'", () => {
  it("endereço aparece sem os espaços das pontas e some a frase de 'sem contato'", async () => {
    await montar({ storeAddress: "   Rua Exemplo, 10 - Centro   " });
    const linha = contato().querySelector("p span");
    expect(linha?.textContent).toBe("Rua Exemplo, 10 - Centro");
    expect(contato().textContent).not.toContain("ainda não cadastrou");
  });

  it("endereço só com espaços não conta: sem contato nenhum, a frase aparece", async () => {
    await montar({ storeAddress: "     " });
    expect(contato().querySelector("p span")).toBeNull();
    expect(contato().textContent).toContain(
      "A loja ainda não cadastrou um contato neste app.",
    );
  });

  it("só o e-mail de atendimento já basta: sem a frase de 'sem contato'", async () => {
    await montar({ storeSupportEmail: "atendimento@example.com" });
    expect(contato().textContent).toContain("atendimento@example.com");
    expect(contato().textContent).not.toContain("ainda não cadastrou");
  });
});
