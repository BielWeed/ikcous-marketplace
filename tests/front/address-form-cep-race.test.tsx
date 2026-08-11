// @vitest-environment jsdom
//
// Prova (ou refuta) a corrida apontada numa revisão anterior em
// AddressForm.tsx: duas buscas do ViaCEP em voo ao mesmo tempo, a mais
// antiga responde por último e sobrescreve o endereço mais novo.
//
// Caminho usado para disparar a corrida: dois eventos "input" despachados
// diretamente no elemento (`el.dispatchEvent(new Event("input"))`), sem
// nenhum `await`/microtarefa entre eles. Isto NÃO é o que uma digitação de
// usuário alcança — o input tem `disabled={loading || isSearchingCep}`
// e `setIsSearchingCep(true)` roda de forma síncrona antes do
// `await fetch(...)`, então o navegador já recusa gerar um segundo evento
// "input" a partir de interação real depois do primeiro caractere: cada
// gesto (colar, digitar, Ctrl+Z, IME) é uma tarefa separada do event loop, o
// React aplica o `disabled` com flush síncrono do handler antes de devolver
// o controle, e o autofill do Chrome pula campo desabilitado. Medido: com os
// dois eventos em `act()` SEPARADOS, com flush completo entre eles e o
// `disabled` já comitado no DOM, a segunda busca disparou assim mesmo — o
// `act()` compartilhado abaixo não é o que abre a corrida.
//
// O que de fato alcança este caminho é despacho programático que ignora
// `disabled`: extensão de gerenciador de senha/endereço (que chama
// `nativeSetter.call(el, v); el.dispatchEvent(new Event('input',{bubbles:
// true}))` sem checar o atributo) e automação de teste. Superfície real,
// mas estreita — não é o teclado do usuário.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingCoverage: "national", originCep: "38500-000" },
    isLoaded: true,
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão já
// usado em checkout-view-flag-on.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type FetchResolver = (data: unknown) => void;

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AddressForm — corrida na busca de CEP", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let pendentes: Map<string, FetchResolver>;

  beforeEach(() => {
    pendentes = new Map();
    // O Checkbox do Radix (endereço padrão) usa `useSize`, que exige
    // `ResizeObserver` — ausente no jsdom. Sem isto o render nem chega a
    // montar o formulário, muito menos disparar a busca de CEP.
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
      vi.fn((url: string) => {
        const cep = /viacep\.com\.br\/ws\/(\d+)\/json/.exec(url)?.[1] ?? "";
        return new Promise((resolve) => {
          pendentes.set(cep, (data: unknown) =>
            resolve({ json: () => Promise.resolve(data) } as Response),
          );
        });
      }),
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

  it("descarta a resposta da busca antiga quando ela chega depois da busca nova", async () => {
    const { AddressForm } = await import("@/components/ui/custom/AddressForm");

    await act(async () => {
      raiz.render(<AddressForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    });

    // As duas buscas disparam dentro do MESMO `act()` síncrono. O `act()`
    // compartilhado não é o motivo da corrida acontecer — o motivo é que
    // `digitar()` despacha o evento "input" direto no elemento, e nem o DOM
    // nem o React filtram esse despacho programático por `disabled`. Um
    // usuário real não alcança este caminho (ver comentário no topo do
    // arquivo).
    act(() => {
      // Primeira busca: CEP antigo (Av. Paulista).
      digitar("cep", "01310100");
      // Segunda busca, ainda dentro do mesmo `act()`.
      digitar("cep", "38500000");
    });

    // A segunda dispara o fetch mesmo com o `disabled` já comitado no DOM —
    // é isso que abre a corrida, não a ordem de commit do React.
    expect(pendentes.size).toBe(2);

    // A mais antiga (01310100) responde por último.
    pendentes.get("38500000")!({
      logradouro: "Rua Nova",
      bairro: "Bairro Novo",
      localidade: "Monte Carmelo",
      uf: "MG",
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    pendentes.get("01310100")!({
      logradouro: "Avenida Paulista",
      bairro: "Bela Vista",
      localidade: "São Paulo",
      uf: "SP",
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const street = document.getElementById("street") as HTMLInputElement;
    const city = document.getElementById("city") as HTMLInputElement;

    // Correto: o endereço final é o da busca NOVA (38500-000), não o da
    // antiga que respondeu por último.
    expect(street.value).toBe("Rua Nova");
    expect(city.value).toBe("Monte Carmelo");
  });

  it("aborta a busca antiga de verdade quando a nova começa, sem logar erro", async () => {
    const pendentesComSignal = new Map<string, FetchResolver>();
    const abortadas: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: { signal?: AbortSignal }) => {
        const cep = /viacep\.com\.br\/ws\/(\d+)\/json/.exec(url)?.[1] ?? "";
        return new Promise((resolve, reject) => {
          const signal = init?.signal;
          const onAbort = () => {
            abortadas.push(cep);
            reject(signal!.reason);
          };
          if (signal) {
            if (signal.aborted) {
              onAbort();
              return;
            }
            signal.addEventListener("abort", onAbort);
          }
          pendentesComSignal.set(cep, (data: unknown) =>
            resolve({ json: () => Promise.resolve(data) } as Response),
          );
        });
      }),
    );
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const { AddressForm } = await import("@/components/ui/custom/AddressForm");

    await act(async () => {
      raiz.render(<AddressForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    });

    act(() => {
      digitar("cep", "01310100");
      digitar("cep", "38500000");
    });

    // A busca antiga foi cancelada de verdade (não só ignorada quando a
    // resposta chegasse) — é o que o `AbortController` do conserto faz.
    expect(abortadas).toEqual(["01310100"]);

    pendentesComSignal.get("38500000")!({
      logradouro: "Rua Nova",
      bairro: "Bairro Novo",
      localidade: "Monte Carmelo",
      uf: "MG",
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const street = document.getElementById("street") as HTMLInputElement;
    const city = document.getElementById("city") as HTMLInputElement;
    expect(street.value).toBe("Rua Nova");
    expect(city.value).toBe("Monte Carmelo");

    // O cancelamento é esperado, não um erro real — não pode passar pelo
    // `console.error("Error fetching CEP:", ...)` do catch.
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("caso feliz: uma única busca preenche o endereço normalmente", async () => {
    const { AddressForm } = await import("@/components/ui/custom/AddressForm");

    await act(async () => {
      raiz.render(<AddressForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    });

    act(() => {
      digitar("cep", "01310100");
    });
    expect(pendentes.size).toBe(1);

    pendentes.get("01310100")!({
      logradouro: "Avenida Paulista",
      bairro: "Bela Vista",
      localidade: "São Paulo",
      uf: "SP",
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const street = document.getElementById("street") as HTMLInputElement;
    const city = document.getElementById("city") as HTMLInputElement;
    expect(street.value).toBe("Avenida Paulista");
    expect(city.value).toBe("São Paulo");
  });
});
