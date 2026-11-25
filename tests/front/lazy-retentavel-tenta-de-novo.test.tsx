// @vitest-environment jsdom
// Pedaço de tela carregado sob demanda que sabe ser pedido DE NOVO: depois de
// uma falha de rede, `React.lazy` devolve o mesmo erro para sempre; o
// `lazyRetentavel` troca o `lazy` em `tentarDeNovo()` e o próximo desenho volta
// a pedir o arquivo. O módulo não tinha teste próprio.
import { lazyRetentavel } from "@/utils/lazyRetentavel";
import {
  Component,
  type ComponentType,
  type ReactNode,
  Suspense,
  act,
} from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão dos outros testes de componente.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class Limite extends Component<
  { children: ReactNode },
  { erro: string | null }
> {
  state = { erro: null as string | null };
  static getDerivedStateFromError(e: Error) {
    return { erro: e.message };
  }
  render() {
    return this.state.erro ? (
      <p>falhou: {this.state.erro}</p>
    ) : (
      this.props.children
    );
  }
}

const Mostra = ({ nome }: { nome: string }) => <p>oi {nome}</p>;

type Pedaco = ComponentType<{ nome: string }>;

let raiz: Root | null = null;
let caixa: HTMLDivElement;

async function desenhar(Alvo: Pedaco) {
  raiz = createRoot(caixa);
  await act(async () => {
    raiz?.render(
      <Limite>
        <Suspense fallback={<p>carregando</p>}>
          <Alvo nome="Ana" />
        </Suspense>
      </Limite>,
    );
  });
  // Deixa a promessa do import() resolver e o Suspense trocar.
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function tirar() {
  await act(async () => {
    raiz?.unmount();
  });
  raiz = null;
}

beforeEach(() => {
  caixa = document.createElement("div");
  document.body.append(caixa);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  if (raiz) await tirar();
  caixa.remove();
  vi.restoreAllMocks();
});

describe("lazyRetentavel", () => {
  it("carrega o pedaço e repassa as props", async () => {
    const fabrica = vi.fn(async () => ({ default: Mostra }));
    const Pedaco = lazyRetentavel(fabrica);
    await desenhar(Pedaco);
    expect(caixa.textContent).toBe("oi Ana");
    expect(fabrica).toHaveBeenCalledTimes(1);
  });

  it("sem tentarDeNovo, a falha fica memorizada: remontar não pede o arquivo outra vez", async () => {
    const fabrica = vi.fn(async (): Promise<{ default: typeof Mostra }> => {
      throw new Error("rede caiu");
    });
    const Pedaco = lazyRetentavel(fabrica);
    await desenhar(Pedaco);
    expect(caixa.textContent).toBe("falhou: rede caiu");
    await tirar();
    await desenhar(Pedaco);
    expect(caixa.textContent).toBe("falhou: rede caiu");
    expect(fabrica).toHaveBeenCalledTimes(1);
  });

  it("tentarDeNovo faz o próximo desenho pedir o arquivo de novo e curar a falha", async () => {
    let rede = false;
    const fabrica = vi.fn(async () => {
      if (!rede) throw new Error("rede caiu");
      return { default: Mostra };
    });
    const Pedaco = lazyRetentavel(fabrica);
    await desenhar(Pedaco);
    expect(caixa.textContent).toBe("falhou: rede caiu");
    await tirar();

    rede = true;
    Pedaco.tentarDeNovo();
    await desenhar(Pedaco);
    expect(caixa.textContent).toBe("oi Ana");
    expect(fabrica).toHaveBeenCalledTimes(2);
  });

  it("tentarDeNovo sozinho não pede nada: só o próximo desenho pede, uma vez", async () => {
    const fabrica = vi.fn(async () => ({ default: Mostra }));
    const Pedaco = lazyRetentavel(fabrica);
    Pedaco.tentarDeNovo();
    Pedaco.tentarDeNovo();
    expect(fabrica).not.toHaveBeenCalled();
    await desenhar(Pedaco);
    expect(caixa.textContent).toBe("oi Ana");
    expect(fabrica).toHaveBeenCalledTimes(1);
  });

  it("dois pedaços são independentes: tentar de novo um não pede nem troca o outro", async () => {
    const quebra = vi.fn(async (): Promise<{ default: typeof Mostra }> => {
      throw new Error("so este");
    });
    const bom = vi.fn(async () => ({ default: Mostra }));
    const A = lazyRetentavel(quebra);
    const B = lazyRetentavel(bom);
    A.tentarDeNovo();
    await desenhar(B);
    expect(caixa.textContent).toBe("oi Ana");
    expect(quebra).not.toHaveBeenCalled();
    expect(bom).toHaveBeenCalledTimes(1);
  });
});
