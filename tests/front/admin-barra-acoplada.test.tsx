// @vitest-environment jsdom
import {
  AcaoDaBarra,
  ContextoDaBarra,
  useBarraAcoplada,
} from "@/components/layouts/AcaoDaBarra";
import { type ReactNode, act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let largo = false;
let mudouLargura: () => void;
let medir: () => void;
let altura = 76;
const desconectar = vi.fn();

function Prateleira() {
  const barra = useContext(ContextoDaBarra);
  return (
    <nav>
      <div
        ref={barra?.receberPrateleira}
        role="group"
        aria-label="Ações da tela"
      />
      <div data-abas>
        Início · Pedidos · Produtos · Clientes · Ajustes · Vender
      </div>
    </nav>
  );
}

function Altura() {
  const barra = useContext(ContextoDaBarra);
  return <output>{barra?.altura}</output>;
}

function Casca({
  children,
  teclado = false,
}: { children?: ReactNode; teclado?: boolean }) {
  const barra = useBarraAcoplada();
  return (
    <ContextoDaBarra.Provider value={barra}>
      <main>{children}</main>
      {!teclado && <Prateleira />}
      <Altura />
    </ContextoDaBarra.Provider>
  );
}

beforeEach(() => {
  largo = false;
  altura = 76;
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return largo;
    },
    addEventListener: (_: string, fn: () => void) => {
      mudouLargura = fn;
    },
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(fn: () => void) {
        medir = fn;
      }
      observe() {}
      disconnect = desconectar;
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return { height: this.childElementCount ? altura : 0 } as DOMRect;
    },
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("põe as ações antes das abas e só deixa a tela ativa ocupar a prateleira", () => {
  act(() =>
    root.render(
      <Casca>
        <AcaoDaBarra ativa={false}>
          <button>Antiga</button>
        </AcaoDaBarra>
        <AcaoDaBarra aria-label="Ações dos clientes">
          <button>Perguntas e avaliações</button>
          <button>Avisar clientes</button>
        </AcaoDaBarra>
      </Casca>,
    ),
  );
  expect(host.querySelector("main")?.textContent).toBe("");
  const acoes = host.querySelector('[aria-label="Ações dos clientes"]')!;
  expect(acoes.closest("nav")).not.toBeNull();
  expect(
    [...acoes.querySelectorAll("button")].map((b) => b.textContent),
  ).toEqual(["Perguntas e avaliações", "Avisar clientes"]);
  expect(
    acoes.compareDocumentPosition(host.querySelector("[data-abas]")!) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(host.textContent).not.toContain("Antiga");
});

it("mede mudanças de altura e devolve a folga quando a tela não tem ação", () => {
  act(() =>
    root.render(
      <Casca>
        <AcaoDaBarra>
          <button>Novo produto</button>
        </AcaoDaBarra>
      </Casca>,
    ),
  );
  act(() => medir());
  expect(host.querySelector("output")?.textContent).toBe("76");
  altura = 112;
  act(() => medir());
  expect(host.querySelector("output")?.textContent).toBe("112");
  act(() => root.render(<Casca />));
  act(() => medir());
  expect(host.querySelector("output")?.textContent).toBe("0");
  expect(
    host.querySelector('[aria-label="Ações da tela"]')?.childElementCount,
  ).toBe(0);
});

it("mover um botão preserva disabled, explicação e clique", () => {
  const fechar = vi.fn();
  const tela = (vazia: boolean) => (
    <Casca>
      <AcaoDaBarra>
        <button disabled={vazia} onClick={fechar}>
          Fechar venda
        </button>
        {vazia && <p>Indisponível: adicione pelo menos um item.</p>}
      </AcaoDaBarra>
    </Casca>
  );
  act(() => root.render(tela(true)));
  act(() => host.querySelector("button")!.click());
  expect(fechar).not.toHaveBeenCalled();
  expect(host.querySelector("nav")?.textContent).toContain(
    "Indisponível: adicione pelo menos um item.",
  );
  act(() => root.render(tela(false)));
  act(() => host.querySelector("button")!.click());
  expect(fechar).toHaveBeenCalledOnce();
});

it("com teclado aberto não deixa a ação reaparecer solta no corpo", () => {
  const tela = (teclado: boolean) => (
    <Casca teclado={teclado}>
      <AcaoDaBarra>
        <button>Novo lançamento</button>
      </AcaoDaBarra>
    </Casca>
  );
  act(() => root.render(tela(false)));
  expect(host.querySelector("nav button")).not.toBeNull();
  act(() => root.render(tela(true)));
  expect(host.querySelector("button")).toBeNull();
  act(() => root.render(tela(false)));
  expect(host.querySelector("nav button")?.textContent).toBe("Novo lançamento");
});

it("ao ampliar a tela move as mesmas ações para o rodapé sticky, sem duplicar", () => {
  act(() =>
    root.render(
      <Casca>
        <AcaoDaBarra>
          <button>Novo produto</button>
        </AcaoDaBarra>
      </Casca>,
    ),
  );
  largo = true;
  act(() => mudouLargura());
  expect(host.querySelectorAll("button")).toHaveLength(1);
  expect(host.querySelector("main button")?.parentElement?.className).toContain(
    "admin-acao-inline",
  );
  expect(host.querySelector("nav button")).toBeNull();
  expect(host.querySelector("output")?.textContent).toBe("0");
  largo = false;
  act(() => mudouLargura());
  expect(host.querySelector("main button")).toBeNull();
  expect(host.querySelectorAll("nav button")).toHaveLength(1);
});
