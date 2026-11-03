// @vitest-environment jsdom
//
// Caça contínua, rodada 5 (f16) — o `maxLength` do campo cortava o texto
// COLADO antes da máscara: "38.500-000" ou " 38500-000" (CEP) e
// " 529.982.247-25" (CPF) perdiam o último número. Quem limita o tamanho é
// `formatarCep`/`formatarCepDaLoja`/`formatarCpf` (8 e 11 dígitos); o atributo
// não pode cortar antes delas. Mesmo critério de frete-local-ate-onde-entrega
// ("sem maxLength cortando").
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatarCpf } from "@/lib/cpf";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Fonte do checkout lida pelo Vite (`?raw`), sem API de Node.
const FONTES = import.meta.glob<string>(
  "/src/views/customer/CheckoutView.tsx",
  {
    query: "?raw",
    import: "default",
    eager: true,
  },
);

describe("CEP da loja (Minha loja) — colar com máscara", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    // Sem rede: a tela só precisa existir para o atributo ser lido.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 404 })),
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
  });

  it("o campo 'CEP da loja' não tem maxlength", async () => {
    const { EnderecoDaLoja } = await import(
      "@/components/admin/minha-loja/EnderecoDaLoja"
    );
    await act(async () => {
      raiz.render(
        <EnderecoDaLoja
          originCep={null}
          storeAddress={null}
          storeCity={null}
          storeState={null}
          onMudou={vi.fn()}
        />,
      );
    });
    const campo = hospedeiro.querySelector("#endereco-cep");
    expect(campo).not.toBeNull();
    expect(campo?.hasAttribute("maxlength")).toBe(false);
  });
});

describe("CPF do destinatário (checkout) — colar com espaço ou ponto na frente", () => {
  it("a máscara do CPF aceita o texto colado inteiro e limita em 11 dígitos", () => {
    expect(formatarCpf(" 529.982.247-25").formatado).toBe("529.982.247-25");
    expect(formatarCpf("52998224725 99").formatado).toBe("529.982.247-25");
  });

  it("o campo #checkout-cpf não tem maxLength (o corte do navegador antes da máscara perdia o último dígito)", () => {
    const fonte = FONTES["/src/views/customer/CheckoutView.tsx"];
    expect(typeof fonte).toBe("string");
    const inicio = fonte.indexOf('id="checkout-cpf"');
    expect(inicio).toBeGreaterThan(-1);
    const fim = fonte.indexOf("/>", inicio);
    const campo = fonte.slice(inicio, fim);
    expect(campo).toContain("formatarCpf(");
    expect(campo).not.toMatch(/maxLength/i);
  });
});
