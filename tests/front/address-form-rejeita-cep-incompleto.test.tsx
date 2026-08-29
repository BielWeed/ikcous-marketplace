// @vitest-environment jsdom
//
// O formulário de endereço não pode gravar CEP incompleto.
//
// A máscara (formatarCep, useBuscaCep.ts) devolve "12345-67" para 7 dígitos —
// 8 CARACTERES contando o hífen —, e a validação era `min(8)`: CEP de 7
// dígitos passava, o endereço era gravado e virava opção de entrega no
// checkout (em loja de cobertura local nem a busca do ViaCEP disparava para
// salvar a cliente). O que valida CEP é a contagem de DÍGITOS: sempre 8.
//
// Render de verdade com submissão real: o erro do zod tem de aparecer na
// árvore renderizada para o caso de 7 dígitos e NÃO aparecer para 8.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `mockConfig` via vi.hoisted porque vi.mock é içado — mesmo padrão de
// address-form-cep-race.test.tsx.
const mockConfig = vi.hoisted(() => ({
  shippingCoverage: "local" as const,
  originCep: "38500-000",
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig, isLoaded: true }),
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

// Mesmo padrão de account-settings-senha-usa-o-hook-traduzido.test.tsx: a
// validação do react-hook-form é assíncrona — um único escoamento de
// microtask não basta para as mensagens chegarem à árvore.
async function esperarAte(
  condicao: () => boolean,
  { timeoutMs = 2000, passoMs = 10 } = {},
) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(
        `esperarAte: condição não ficou verdadeira em ${timeoutMs}ms`,
      );
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, passoMs));
    });
  }
}

describe("AddressForm — CEP de 7 dígitos é recusado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    // Mesmo padrão de address-form-cep-race.test.tsx: o Checkbox do Radix
    // usa `useSize`, que exige ResizeObserver — ausente no jsdom. Aqui dentro
    // do beforeEach porque o unstubAllGlobals do afterEach o remove a cada
    // teste.
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
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function renderizarEEnviar(cepDigitado: string) {
    const { AddressForm } = await import("@/components/ui/custom/AddressForm");
    await act(async () => {
      raiz.render(<AddressForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    });

    digitar("cep", cepDigitado);

    // jsdom não dispara o submit do form no clique de botão type=submit —
    // mesmo padrão de shipping-calculator-erro-traduzido...: o evento vai
    // direto no <form>, que é onde o handleSubmit do react-hook-form escuta.
    const formulario = hospedeiro.querySelector("form");
    expect(formulario).toBeDefined();
    await act(async () => {
      formulario!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    // Âncora de que a validação RODOU: a mensagem de outro campo obrigatório
    // (vazio) prova que o submit percorreu o zod — sem esperar por ela, a
    // ausência de "CEP inválido" não distinguiria regra certa de validação
    // que nem chegou a rodar.
    await esperarAte(
      () =>
        hospedeiro.textContent?.includes("Logradouro é obrigatório") ?? false,
    );
    return hospedeiro.textContent ?? "";
  }

  it("7 dígitos (máscara conta o hífen): mostra 'CEP inválido' e não deixa salvar", async () => {
    const texto = await renderizarEEnviar("1234567");

    expect(texto).toContain("CEP inválido");
  });

  it("8 dígitos: sem erro de CEP — e a validação rodou (âncora nos outros campos)", async () => {
    const texto = await renderizarEEnviar("38500000");

    // Âncora: as mensagens dos campos obrigatórios vazios provam que o
    // submit rodou a validação — sem ela, a ausência abaixo não provaria nada.
    expect(texto).toContain("Logradouro é obrigatório");
    expect(texto).not.toContain("CEP inválido");
  });
});
