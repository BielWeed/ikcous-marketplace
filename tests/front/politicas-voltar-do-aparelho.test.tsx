// @vitest-environment jsdom
//
// VOLTAR DO APARELHO COM A FOLHA ABERTA. O defeito: no Android, com a política
// aberta por cima do checkout, do cadastro ou do produto, o Voltar tirava a
// cliente da tela e apagava o que ela já tinha digitado. Aqui usa-se o
// HISTÓRICO REAL do jsdom (`history.back()` de verdade) e um ouvinte que faz o
// papel do roteador do App (registrado ANTES da folha, como o handler do
// App.tsx), para provar:
//   - o Voltar fecha só a folha, a URL e a tela de baixo ficam como estavam;
//   - o roteador do App nem é acordado (senão ele chamaria o `backOverride`
//     do checkout e fecharia o painel de resumo que estiver aberto);
//   - fechar pelo X devolve a entrada, e o roteador também não é acordado.
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja da Ana" } }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const cadeia = {
        select: () => cadeia,
        eq: () => cadeia,
        maybeSingle: () =>
          Promise.resolve({ data: null, error: { message: "fora do ar" } }),
      };
      return cadeia;
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperar(ms = 0): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("folha de política — o Voltar do aparelho fecha só a folha", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let roteadorDoApp: Mock<() => void>;
  const ouvintes: Array<(e: PopStateEvent) => void> = [];

  beforeEach(() => {
    // Tela do app: /checkout com o estado que o roteador grava.
    globalThis.history.replaceState({ view: "checkout" }, "", "/checkout");
    // O "App": um ouvinte de popstate (bolha) registrado ANTES de a folha abrir.
    roteadorDoApp = vi.fn<() => void>();
    const ouvinte = () => roteadorDoApp();
    ouvintes.push(ouvinte);
    globalThis.addEventListener("popstate", ouvinte);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    for (const o of ouvintes.splice(0)) {
      globalThis.removeEventListener("popstate", o);
    }
  });

  async function renderizar(node: React.ReactNode) {
    await act(async () => {
      raiz.render(node);
    });
    await act(async () => {
      await esperar();
    });
  }

  const botaoPorTexto = (texto: string): HTMLButtonElement => {
    const achado = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === texto,
    );
    expect(achado, `botão "${texto}"`).toBeDefined();
    return achado as HTMLButtonElement;
  };

  async function aguardarFolha(): Promise<Element> {
    for (let i = 0; i < 80; i++) {
      const folha = document.querySelector('[data-testid="folha-politica"]');
      if (folha) return folha;
      await act(async () => {
        await esperar(25);
      });
    }
    throw new Error("a folha da política não abriu");
  }

  /** Aperta o Voltar do aparelho: histórico real do jsdom. */
  async function apertarVoltar() {
    await act(async () => {
      globalThis.history.back();
      await esperar(60);
    });
    await act(async () => {
      await esperar(300);
    });
  }

  async function montarTelaComFrase() {
    const { FraseDeAceite } = await import(
      "@/components/politicas/LinksDasPoliticas"
    );
    function Tela() {
      const [cpf, setCpf] = useState("");
      return (
        <div>
          <input
            aria-label="cpf"
            value={cpf}
            onChange={(e) => setCpf(e.target.value)}
          />
          <FraseDeAceite acao="finalizar" />
        </div>
      );
    }
    await renderizar(<Tela />);
    const campo = hospedeiro.querySelector("input") as HTMLInputElement;
    // Digita como a cliente digita: o valor passa pelo estado do React.
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(campo, "123.456.789-09");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(campo.value).toBe("123.456.789-09");
    return campo;
  }

  it("abrir a folha empurra UMA entrada com o mesmo endereço e a mesma tela", async () => {
    const antes = globalThis.history.length;
    await montarTelaComFrase();
    act(() => botaoPorTexto("Termos de uso").click());
    await aguardarFolha();
    expect(globalThis.history.length).toBe(antes + 1);
    expect(globalThis.location.pathname).toBe("/checkout");
    expect(globalThis.history.state).toMatchObject({
      view: "checkout",
      folhaDePolitica: true,
    });
  });

  it("o endereço com ?id= (produto) continua inteiro na entrada da folha", async () => {
    globalThis.history.replaceState(
      { view: "product-detail", id: "p-9" },
      "",
      "/product-detail?id=p-9",
    );
    await montarTelaComFrase();
    act(() => botaoPorTexto("Termos de uso").click());
    await aguardarFolha();
    expect(globalThis.location.pathname + globalThis.location.search).toBe(
      "/product-detail?id=p-9",
    );
    expect(globalThis.history.state).toMatchObject({
      view: "product-detail",
      id: "p-9",
      folhaDePolitica: true,
    });
    await apertarVoltar();
    expect(globalThis.location.search).toBe("?id=p-9");
  });

  it("Voltar do aparelho: a folha fecha, o roteador do App nem é acordado e o que a cliente digitou fica", async () => {
    const campo = await montarTelaComFrase();
    act(() => botaoPorTexto("Termos de uso").click());
    await aguardarFolha();

    await apertarVoltar();

    expect(document.querySelector('[data-testid="folha-politica"]')).toBeNull();
    // Continua na mesma tela, com o mesmo campo (mesmo nó) e o mesmo valor.
    expect(globalThis.location.pathname).toBe("/checkout");
    expect(globalThis.history.state).toEqual({ view: "checkout" });
    expect(hospedeiro.querySelector("input")).toBe(campo);
    expect(campo.value).toBe("123.456.789-09");
    expect(roteadorDoApp).not.toHaveBeenCalled();
  });

  it("um segundo Voltar (sem folha) volta a ser do roteador: a folha não rouba nada", async () => {
    await montarTelaComFrase();
    act(() => botaoPorTexto("Termos de uso").click());
    await aguardarFolha();
    await apertarVoltar();
    expect(roteadorDoApp).not.toHaveBeenCalled();
    // Sem folha aberta, o Voltar chega ao roteador como sempre.
    await apertarVoltar();
    expect(roteadorDoApp).toHaveBeenCalledTimes(1);
  });

  it("fechar pelo X devolve a entrada que a folha empurrou, sem acordar o roteador", async () => {
    await montarTelaComFrase();
    act(() => botaoPorTexto("Termos de uso").click());
    await aguardarFolha();
    expect(globalThis.history.state).toMatchObject({ folhaDePolitica: true });

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Fechar"]')
        ?.click();
      await esperar(60);
    });
    await act(async () => {
      await esperar(300);
    });

    expect(document.querySelector('[data-testid="folha-politica"]')).toBeNull();
    // A entrada empurrada foi devolvida: o topo é a da tela, sem a marca.
    expect(globalThis.history.state).toEqual({ view: "checkout" });
    expect(globalThis.location.pathname).toBe("/checkout");
    expect(roteadorDoApp).not.toHaveBeenCalled();
  });

  it("abrir, fechar e abrir de novo: cada abertura tem a sua entrada, e o Voltar ainda fecha", async () => {
    const campo = await montarTelaComFrase();
    for (const nome of ["Termos de uso", "Política de Privacidade"]) {
      act(() => botaoPorTexto(nome).click());
      await aguardarFolha();
      await apertarVoltar();
      expect(
        document.querySelector('[data-testid="folha-politica"]'),
      ).toBeNull();
      expect(campo.value).toBe("123.456.789-09");
    }
    expect(roteadorDoApp).not.toHaveBeenCalled();
    expect(globalThis.history.state).toEqual({ view: "checkout" });
  });

  it("a entrada copiada da Home não carrega a marca de base (senão o App acha que voltou ao início)", async () => {
    globalThis.history.replaceState(
      { view: "home", trap: true, isBase: true },
      "",
      "/",
    );
    await montarTelaComFrase();
    act(() => botaoPorTexto("Termos de uso").click());
    await aguardarFolha();
    expect(globalThis.history.state).toMatchObject({
      view: "home",
      folhaDePolitica: true,
    });
    expect(globalThis.history.state.isBase).toBeUndefined();
  });

  it("se a tela some com a folha aberta, nada é devolvido ao histórico", async () => {
    await montarTelaComFrase();
    act(() => botaoPorTexto("Termos de uso").click());
    await aguardarFolha();
    const voltar = vi.spyOn(globalThis.history, "back");
    await act(async () => {
      raiz.render(<div>outra tela</div>);
    });
    await act(async () => {
      await esperar(50);
    });
    expect(voltar).not.toHaveBeenCalled();
    voltar.mockRestore();
  });
});
