// @vitest-environment jsdom
//
// VOLTAR DO APARELHO COM A FOLHA ABERTA. O defeito: no Android, com a política
// aberta por cima do checkout, do cadastro ou do produto, o Voltar tirava a
// cliente da tela e apagava o que ela já tinha digitado. Aqui usa-se o
// HISTÓRICO REAL do jsdom (`history.back()` de verdade) e um "App" simulado: um
// ouvinte de popstate registrado ANTES da folha (como o handler do App.tsx, que
// se registra na montagem) e que só NAVEGA quando a tela do histórico é
// diferente da que ele está mostrando (o "já estamos no mesmo destino" do
// `syncWithUrl`). Para provar o RESULTADO, não o mecanismo:
//   - o Voltar fecha só a folha; o endereço e o estado do histórico ficam como
//     estavam, o App não troca de tela e nada do que foi digitado se perde;
//   - fechar pelo X devolve a entrada empurrada, com o mesmo resultado.
// Nota: no Chromium real o App (registrado primeiro) também acorda; ele só não
// faz nada porque a tela não mudou. O jsdom põe a captura na frente, então este
// teste NÃO afirma "o App nem acordou".
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  // Telas para as quais o "App" navegou (vazio = ficou onde estava).
  let navegacoesDoApp: string[];
  const ouvintes: Array<(e: PopStateEvent) => void> = [];

  const telaDoHistorico = () =>
    `${globalThis.history.state?.view}|${globalThis.location.pathname}${globalThis.location.search}`;

  beforeEach(() => {
    // Uma entrada anterior (Home) e, por cima, a tela do app: /checkout com o
    // estado que o roteador grava. Assim o segundo Voltar tem para onde ir.
    globalThis.history.replaceState({ view: "home" }, "", "/");
    globalThis.history.pushState({ view: "checkout" }, "", "/checkout");
    // O "App": ouvinte de popstate (bolha) registrado ANTES de a folha abrir,
    // como o do App.tsx. Só navega se a tela do histórico mudou.
    navegacoesDoApp = [];
    let telaMostrada = telaDoHistorico();
    const ouvinte = () => {
      const alvo = telaDoHistorico();
      if (alvo === telaMostrada) return;
      telaMostrada = alvo;
      navegacoesDoApp.push(alvo);
    };
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
    // Folga para a primeira abertura, que baixa o pedaço da folha a frio.
    for (let i = 0; i < 240; i++) {
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

  it("Voltar do aparelho: a folha fecha, a tela e o endereço não mudam e o que a cliente digitou fica", async () => {
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
    expect(navegacoesDoApp).toEqual([]);
  });

  it("um segundo Voltar (sem folha) volta a ser do roteador: a folha não rouba nada", async () => {
    await montarTelaComFrase();
    act(() => botaoPorTexto("Termos de uso").click());
    await aguardarFolha();
    await apertarVoltar();
    expect(navegacoesDoApp).toEqual([]);
    // Sem folha aberta, o Voltar leva o App à tela anterior, como sempre.
    await apertarVoltar();
    expect(navegacoesDoApp).toEqual(["home|/"]);
  });

  it("fechar pelo X devolve a entrada que a folha empurrou, e o App não troca de tela", async () => {
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
    expect(navegacoesDoApp).toEqual([]);
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
    expect(navegacoesDoApp).toEqual([]);
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
