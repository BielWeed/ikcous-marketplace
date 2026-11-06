// @vitest-environment jsdom
//
// Cliente nova, sinal fraco, no meio do cadastro: toca em "Termos de Uso" e o
// arquivo da folha não baixa. Antes, o erro subia até a tela de erro do app
// inteiro e o cadastro digitado sumia. Agora a falha fica LOCAL: o formulário
// continua montado com o que foi digitado, aparece um aviso curto com
// "Tentar de novo" e nada recarrega a página.
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const servidor = vi.hoisted(() => ({ ok: false, pedidos: 0 }));

// O arquivo da folha: enquanto o servidor não responde, pedir o módulo falha do
// mesmo jeito que o navegador rejeita um chunk que não baixou. O acesso ao
// export mora num getter porque o vitest guarda o resultado da fábrica entre
// os testes: assim cada pedido consulta o `servidor` na hora.
vi.mock("@/components/politicas/PoliticaEmFolha", async () => {
  const { createElement } = await import("react");
  const Folha = ({ tipo }: { tipo: string | null }) =>
    createElement("div", { "data-testid": "folha-politica" }, `folha ${tipo}`);
  return {
    get PoliticaEmFolha() {
      servidor.pedidos += 1;
      if (!servidor.ok) {
        throw new TypeError(
          "Failed to fetch dynamically imported module: http://x/assets/PoliticaEmFolha-abc.js",
        );
      }
      return Folha;
    },
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const reloadEspiao = vi.fn();

describe("folha de política que não baixou", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    servidor.ok = false;
    servidor.pedidos = 0;
    reloadEspiao.mockReset();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: reloadEspiao },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function assentar() {
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
  }

  async function montarCadastro() {
    const { FraseDeAceite } = await import(
      "@/components/politicas/LinksDasPoliticas"
    );
    function Cadastro() {
      const [nome, setNome] = useState("");
      return (
        <form>
          <input
            aria-label="Nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
          <FraseDeAceite acao="criar sua conta" />
        </form>
      );
    }
    await act(async () => {
      raiz.render(<Cadastro />);
    });
    const campo = hospedeiro.querySelector("input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campo, "Maria da Silva");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  const botao = (texto: string) =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    ) as HTMLButtonElement | undefined;

  async function tocar(texto: string) {
    const b = botao(texto);
    expect(b, `botão "${texto}"`).toBeDefined();
    await act(async () => {
      b?.click();
    });
    await assentar();
  }

  it("a falha de download NÃO derruba a tela: o cadastro digitado continua lá, com aviso e sem recarregar", async () => {
    await montarCadastro();

    await tocar("Termos de uso");

    const campo = hospedeiro.querySelector("input") as HTMLInputElement;
    expect(campo).not.toBeNull();
    expect(campo.value).toBe("Maria da Silva");
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "Não foi possível abrir agora",
    );
    expect(botao("Tentar de novo")).toBeDefined();
    expect(reloadEspiao).not.toHaveBeenCalled();
  });

  it("'Tentar de novo' busca o arquivo outra vez e, com a rede de volta, abre a folha sem perder o cadastro", async () => {
    await montarCadastro();
    await tocar("Termos de uso");
    const pedidosAntes = servidor.pedidos;

    servidor.ok = true; // a rede voltou
    await tocar("Tentar de novo");

    expect(servidor.pedidos).toBeGreaterThan(pedidosAntes);
    expect(
      hospedeiro.querySelector('[data-testid="folha-politica"]')?.textContent,
    ).toBe("folha termos");
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
    expect((hospedeiro.querySelector("input") as HTMLInputElement).value).toBe(
      "Maria da Silva",
    );
    expect(reloadEspiao).not.toHaveBeenCalled();
  });

  it("'Tentar de novo' com o arquivo ainda fora do ar: o aviso continua, o cadastro também, e dá para tentar mais uma vez", async () => {
    await montarCadastro();
    await tocar("Termos de uso");

    await tocar("Tentar de novo");
    await tocar("Tentar de novo");

    expect(hospedeiro.querySelector('[role="alert"]')).not.toBeNull();
    expect((hospedeiro.querySelector("input") as HTMLInputElement).value).toBe(
      "Maria da Silva",
    );
    expect(reloadEspiao).not.toHaveBeenCalled();
  });

  it("'Fechar' tira o aviso do caminho e um novo toque no link tenta de novo", async () => {
    await montarCadastro();
    await tocar("Termos de uso");
    expect(hospedeiro.querySelector('[role="alert"]')).not.toBeNull();

    await tocar("Fechar");
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();

    servidor.ok = true;
    await tocar("Política de Privacidade");

    expect(
      hospedeiro.querySelector('[data-testid="folha-politica"]')?.textContent,
    ).toBe("folha privacidade");
  });

  it("o link de Trocas e devoluções (página do produto) também falha só no lugar", async () => {
    const { LinkDeTrocas } = await import(
      "@/components/politicas/LinksDasPoliticas"
    );
    await act(async () => {
      raiz.render(
        <div>
          <p data-testid="escolha">tamanho M, cor azul</p>
          <LinkDeTrocas />
        </div>,
      );
    });

    await tocar("Trocas");

    expect(hospedeiro.querySelector('[data-testid="escolha"]')).not.toBeNull();
    expect(hospedeiro.querySelector('[role="alert"]')).not.toBeNull();
    expect(reloadEspiao).not.toHaveBeenCalled();
  });
});
