// @vitest-environment jsdom
//
// DebouncedSearchInput: o que o teste do ciclo de digitação
// (`debounced-search-input.test.tsx`) não olhava. Caça por mutação
// (25/11/2026) — sobreviveram: o atraso padrão de 400 ms, o texto e o
// `autocomplete` padrão, o `limpavel` ligado por padrão, a folga à direita
// para o botão "x", o texto digitado passar sem corte de espaços, o botão de
// limpar ser `type="button"` (dentro de um formulário ele enviava a busca),
// o `name` do campo, o "digitando" desligar quando o pai NÃO atualiza o valor
// e o "digitando" desligar ao desmontar a tela no meio da digitação.
import { DebouncedSearchInput } from "@/components/admin/DebouncedSearchInput";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let raiz: Root;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});

afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  vi.useRealTimers();
});

type Props = React.ComponentProps<typeof DebouncedSearchInput>;

function montar(props: Partial<Props> = {}) {
  const onChange = props.onChange ?? vi.fn();
  const onTyping = props.onTyping ?? vi.fn();
  act(() => {
    raiz.render(
      <DebouncedSearchInput
        value=""
        {...props}
        onChange={onChange}
        onTyping={onTyping}
      />,
    );
  });
  return { onChange, onTyping };
}

const campo = () => host.querySelector("input") as HTMLInputElement;
const limpar = () =>
  host.querySelector(
    'button[aria-label="Limpar busca"]',
  ) as HTMLButtonElement | null;

function digitar(texto: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(campo(), texto);
    campo().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function passar(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("DebouncedSearchInput: padrões do campo", () => {
  it("sem props extras: placeholder 'Buscar...', autocomplete desligado, sem botão de limpar e sem folga à direita", () => {
    montar({ className: "w-full" });
    expect(campo().placeholder).toBe("Buscar...");
    expect(campo().autocomplete).toBe("off");
    expect(limpar()).toBeNull();
    expect(campo().className).toContain("w-full");
    expect(campo().className).not.toContain("pr-11");
  });

  it("id, name e placeholder que a tela manda chegam ao campo", () => {
    montar({ id: "busca-x", name: "q", placeholder: "Buscar pedido" });
    expect(campo().id).toBe("busca-x");
    expect(campo().name).toBe("q");
    expect(campo().placeholder).toBe("Buscar pedido");
  });

  it("mostra o valor que o pai manda", () => {
    montar({ value: "camiseta" });
    expect(campo().value).toBe("camiseta");
  });
});

describe("DebouncedSearchInput: o atraso", () => {
  it("o padrão é 400 ms: aos 399 ms ainda não avisou, aos 400 ms avisou", () => {
    const { onChange } = montar();
    digitar("ab");
    passar(399);
    expect(onChange).not.toHaveBeenCalled();
    passar(1);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("ab");
  });

  it("o atraso que a tela escolhe vale no lugar do padrão", () => {
    const { onChange } = montar({ delay: 100 });
    digitar("ab");
    passar(99);
    expect(onChange).not.toHaveBeenCalled();
    passar(1);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("ab");
  });

  it("o texto sobe exatamente como foi digitado, com espaço no fim (sem cortar)", () => {
    const { onChange } = montar({ delay: 10 });
    digitar("ab ");
    passar(10);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("ab ");
  });
});

describe("DebouncedSearchInput: o 'digitando'", () => {
  it("se o pai NÃO atualiza o valor, o 'digitando' ainda desliga depois do aviso", () => {
    // O pai ignora o onChange (valor continua ""): o único jeito de o
    // "digitando" desligar é o próprio componente avisar `false` ao disparar.
    const { onChange, onTyping } = montar({ delay: 10 });
    digitar("x");
    expect(onTyping).toHaveBeenLastCalledWith(true);
    passar(10);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("x");
    expect(onTyping).toHaveBeenLastCalledWith(false);
  });

  it("desmontar a tela no meio da digitação desliga o 'digitando' e cancela o aviso", () => {
    const { onChange, onTyping } = montar({ delay: 100 });
    digitar("x");
    expect(onTyping).toHaveBeenLastCalledWith(true);
    act(() => raiz.unmount());
    expect(onTyping).toHaveBeenLastCalledWith(false);
    passar(500);
    expect(onChange).not.toHaveBeenCalled();
    // O afterEach desmonta de novo: recria a raiz para ele não reclamar.
    raiz = createRoot(host);
  });
});

describe("DebouncedSearchInput: o botão de limpar", () => {
  it("'limpavel' dá folga à direita ao campo e o botão só existe com texto", () => {
    montar({ limpavel: true, id: "busca" });
    expect(campo().className).toContain("pr-11");
    expect(limpar()).toBeNull();
    digitar("abc");
    expect(limpar()).not.toBeNull();
    expect(limpar()?.type).toBe("button");
  });

  it("clicar limpa o campo, devolve o foco a ele e, depois do atraso, avisa vazio", () => {
    const { onChange } = montar({ limpavel: true, id: "busca", value: "abc" });
    expect(campo().value).toBe("abc");
    act(() => limpar()?.click());
    expect(campo().value).toBe("");
    expect(document.activeElement).toBe(campo());
    expect(limpar()).toBeNull();
    passar(400);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("");
  });

  it("dentro de um formulário, limpar NÃO envia o formulário", () => {
    const aoEnviar = vi.fn((e: React.FormEvent) => e.preventDefault());
    act(() => {
      raiz.render(
        <form onSubmit={aoEnviar}>
          <DebouncedSearchInput
            limpavel
            id="busca"
            value="abc"
            onChange={vi.fn()}
          />
        </form>,
      );
    });
    act(() => limpar()?.click());
    expect(aoEnviar).not.toHaveBeenCalled();
  });
});
