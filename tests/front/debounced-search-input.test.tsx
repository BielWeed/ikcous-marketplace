// @vitest-environment jsdom
//
// DebouncedSearchInput isolado do resto da tela — os 5 consumidores
// (AdminCustomersView, AdminProductsView, AdminQAView, AdminReviewsView,
// AdminOrdersView) só ligam `onTyping` num `useState(false)`, então o
// contrato que importa é do próprio componente, não de cada tela.
//
// Guarda de regressão para o achado 2 de
// admin-orders-total-concluido-e-aviso-pago-cancelado.test.tsx: aquele
// arquivo prova que zerar o valor DE FORA desliga o "digitando". Este
// arquivo prova o ciclo normal — digitar → `onTyping(true)` → depois do
// atraso, `onChange` dispara e `onTyping(false)` desliga — que é o
// comportamento que a correção do efeito `[localValue, value, delay]` mais
// pode quebrar, porque os dois casos passam pelo mesmo `if`.
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Espera até `condicao()` ficar verdadeira, testando a cada `passoMs` em
 * vez de dormir um tempo fixo — mesmo helper de
 * admin-orders-total-concluido-e-aviso-pago-cancelado.test.tsx. */
async function esperarAte(
  condicao: () => boolean,
  { timeoutMs = 2000, passoMs = 10 } = {},
) {
  await act(async () => {
    const inicio = Date.now();
    while (!condicao()) {
      if (Date.now() - inicio > timeoutMs) {
        throw new Error(
          `esperarAte: condição não ficou verdadeira em ${timeoutMs}ms`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, passoMs));
    }
  });
}

describe("DebouncedSearchInput — ciclo de digitação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  it("digitar liga onTyping(true) e, depois do atraso, dispara onChange e desliga onTyping — sem ligar à toa na montagem", async () => {
    const { DebouncedSearchInput } = await import(
      "@/components/admin/DebouncedSearchInput"
    );

    const onChange = vi.fn();
    const onTyping = vi.fn();

    // Invólucro controlado, igual ao uso real nas 5 telas do admin: quem
    // segura `value` é quem usa o componente, e `onChange` só atualiza esse
    // estado depois que o debounce decide que a digitação parou.
    function Involucro() {
      const [valor, setValor] = useState("");
      return (
        <DebouncedSearchInput
          id="busca-teste"
          value={valor}
          onChange={(v) => {
            onChange(v);
            setValor(v);
          }}
          onTyping={onTyping}
          delay={40}
        />
      );
    }

    await act(async () => {
      raiz.render(<Involucro />);
    });

    // Montagem: `localValue === value` (os dois `""`) desde o primeiro
    // render. A correção chama `onTyping(false)` nesse caso — inofensivo
    // aqui porque as 5 telas nascem com `isTyping` em `useState(false)`, e
    // nunca deve chamar `onTyping(true)` sem ninguém ter digitado nada.
    expect(onTyping).not.toHaveBeenCalledWith(true);

    const campo = hospedeiro.querySelector("#busca-teste") as HTMLInputElement;
    expect(campo).toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;

    await act(async () => {
      campo.focus();
      setter?.call(campo, "maria");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // A lupa vira ícone girando: `onTyping(true)` disparou, e o `onChange`
    // ainda não — a busca de verdade só depois do atraso.
    expect(onTyping).toHaveBeenLastCalledWith(true);
    expect(onChange).not.toHaveBeenCalled();

    await esperarAte(() => onChange.mock.calls.length > 0);

    // Depois do atraso: a busca dispara com o texto digitado, e a lupa
    // volta ao normal.
    expect(onChange).toHaveBeenCalledWith("maria");
    expect(onTyping).toHaveBeenLastCalledWith(false);
  });
});
