// @vitest-environment jsdom
//
// P42b — LOJA NO TABLET E NO COMPUTADOR: o botão "+ Ver outras opções" do
// cálculo de frete (ramo SEM `modoResumo`, o do carrinho) media só 23 px de
// altura clicável de 768 a 1920 px; o ramo de resumo da mesma tela já tem
// `min-h-11`. A correção é SÓ classe prefixada `md:` (≥768 px): o celular
// (<768) fica com o className idêntico ao de antes, e nenhum texto, handler
// ou ordem de foco muda (a altura real em pixels foi medida no Chromium; o
// jsdom não calcula layout, então aqui se prova o CONTRATO DAS CLASSES).
//
// Como o teste falharia sem a correção: o className renderizado não teria
// nenhum token `md:` e `md:min-h-11` faltaria. E se alguém mexer numa classe
// de celular (ou colocar a altura sem o prefixo, que engordaria o celular),
// o contrato abaixo acusa — o mutante em cópia prova que ele pega.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, ShippingOption } from "@/types";

const invoke = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/contexts/CartContext", () => ({
  useCartState: () => ({ freteGratis: false }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { freeShippingMin: 0 }, isLoaded: true }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

// As classes de CELULAR do botão, congeladas como literal (não vêm do
// histórico do git: o CI clona só o último commit).
const CLASSES_DO_CELULAR =
  "w-full select-none py-1 text-center text-[10px] font-semibold text-zinc-400 underline-offset-2 hover:text-zinc-600 hover:underline";

// O que o PC (md:) acrescenta: altura de toque de 44 px, texto centrado no
// mesmo lugar (flex + items-center + justify-center).
const CLASSES_DE_PC = [
  "md:min-h-11",
  "md:flex",
  "md:items-center",
  "md:justify-center",
];

const tokens = (classe: string) => classe.split(/\s+/).filter(Boolean);

// O contrato, como função pura: devolve as violações (vazio = em ordem).
function violacoes(classeRenderizada: string): string[] {
  const todos = tokens(classeRenderizada);
  const doCelular = todos.filter((t) => !t.startsWith("md:"));
  const achadas: string[] = [];
  if (
    [...doCelular].sort().join(" ") !==
    tokens(CLASSES_DO_CELULAR).sort().join(" ")
  ) {
    achadas.push("classes de celular mudaram");
  }
  for (const necessaria of CLASSES_DE_PC) {
    if (!todos.includes(necessaria)) achadas.push(`falta ${necessaria}`);
  }
  return achadas;
}

const carrinho: CartItem[] = [
  {
    product: {
      id: "prod-1",
      name: "Blusa Teste",
      description: "",
      price: 100,
      images: [],
      category: "Roupas",
      stock: 5,
      sold: 0,
      isActive: true,
      isBestseller: false,
      freeShipping: false,
      createdAt: new Date(0).toISOString(),
    },
    quantity: 1,
  },
];

const PAC: ShippingOption = {
  id: "melhor-envio-1",
  name: "Entrega econômica",
  price: 26.41,
  deliveryDays: 8,
  provider: "melhor_envio",
  transportadora: "Correios",
  servico: "PAC",
  provedorRotulo: "Melhor Envio",
};
const SEDEX: ShippingOption = {
  id: "melhor-envio-2",
  name: "Entrega expressa",
  price: 54.88,
  deliveryDays: 4,
  provider: "melhor_envio",
  transportadora: "Correios",
  servico: "SEDEX",
  provedorRotulo: "Melhor Envio",
};
const MEIO: ShippingOption = {
  id: "melhor-envio-3",
  name: "Correios — Meio",
  price: 40,
  deliveryDays: 5,
  provider: "melhor_envio",
  transportadora: "Correios",
  servico: "Meio",
  provedorRotulo: "Melhor Envio",
};

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ShippingCalculator — '+ Ver outras opções' com alvo de toque no PC (P42b)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    invoke.mockReset();
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

  async function montar() {
    invoke.mockImplementation((_nome: string, opts: any) => {
      if (opts?.body?.action === "revisao_config_frete") {
        return Promise.resolve({ data: { revisaoConfig: null }, error: null });
      }
      return Promise.resolve({
        data: { options: [PAC, SEDEX, MEIO] },
        error: null,
      });
    });
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    // Sem `modoResumo`: o ramo do carrinho, o do defeito.
    await act(async () => {
      raiz.render(
        <ShippingCalculator
          cart={carrinho}
          selectedOption={null}
          onSelectOption={() => {}}
          cepDestino="69000000"
        />,
      );
    });
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
  }

  function botaoDe(texto: string) {
    return [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    );
  }

  it("o className renderizado cumpre o contrato: celular igual ao de antes, PC com altura de toque", async () => {
    await montar();
    const botao = botaoDe("Ver outras opções");
    expect(botao, "o botão existe no ramo sem modoResumo").toBeDefined();
    expect(violacoes(botao?.className ?? "")).toEqual([]);
  });

  it("expandido ('Ver menos opções') o botão mantém o mesmo contrato e o mesmo comportamento", async () => {
    await montar();
    await act(async () => {
      botaoDe("Ver outras opções")?.click();
    });
    const botao = botaoDe("Ver menos opções");
    expect(botao).toBeDefined();
    expect(violacoes(botao?.className ?? "")).toEqual([]);
    expect(botao?.getAttribute("type")).toBe("button");
  });

  it("o PC só ACRESCENTA tokens `md:`: nenhum token sem prefixo foi acrescentado", async () => {
    await montar();
    const botao = botaoDe("Ver outras opções");
    const semPrefixo = tokens(botao?.className ?? "").filter(
      (t) => !t.startsWith("md:"),
    );
    expect(semPrefixo.sort()).toEqual(tokens(CLASSES_DO_CELULAR).sort());
  });

  it("mutantes em CÓPIA do className real são pegos pelo contrato", async () => {
    await montar();
    const real = botaoDe("Ver outras opções")?.className ?? "";
    expect(violacoes(real)).toEqual([]);

    // 1) a correção some: nenhum token de PC.
    const semPc = tokens(real)
      .filter((t) => !t.startsWith("md:"))
      .join(" ");
    expect(violacoes(semPc).length).toBeGreaterThan(0);

    // 2) altura colocada SEM o prefixo: engordaria o celular.
    const semPrefixo = real.replace("md:min-h-11", "min-h-11");
    expect(violacoes(semPrefixo).length).toBeGreaterThan(0);

    // 3) uma classe de celular alterada (py-1 -> py-2).
    const celularMexido = real.replace("py-1", "py-2");
    expect(violacoes(celularMexido).length).toBeGreaterThan(0);

    // 4) falta o centrado do PC (o texto sairia do lugar).
    const semCentrar = real.replace("md:items-center", "");
    expect(violacoes(semCentrar).length).toBeGreaterThan(0);
  });
});
