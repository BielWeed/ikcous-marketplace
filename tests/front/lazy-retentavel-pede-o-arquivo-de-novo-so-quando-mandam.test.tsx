// @vitest-environment jsdom
//
// `lazyRetentavel` (src/utils/lazyRetentavel.ts): o pedaço de tela carregado
// sob demanda que sabe ser pedido DE NOVO. Nenhum teste o citava (só as telas
// que o usam, por trás de dublês). O que se prende aqui:
//   · o arquivo só é pedido quando o pedaço é DESENHADO, e uma vez só;
//   · as props chegam ao componente carregado, e mudam a cada desenho;
//   · depois de uma falha, o `React.lazy` puro devolve o MESMO erro para
//     sempre; com `tentarDeNovo()` o próximo desenho chama o `import()` outra
//     vez e a tela volta;
//   · `tentarDeNovo()` sozinho não pede nada (é o limite de erro quem decide
//     a hora, nunca no meio de um desenho).
import { type PedacoRetentavel, lazyRetentavel } from "@/utils/lazyRetentavel";
import { Component, Suspense, act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class Limite extends Component<
  { readonly children: ReactNode },
  { readonly erro: string | null }
> {
  public state = { erro: null as string | null };
  public static getDerivedStateFromError(e: Error) {
    return { erro: e.message };
  }
  public render() {
    return this.state.erro === null ? (
      this.props.children
    ) : (
      <p data-teste="erro">{this.state.erro}</p>
    );
  }
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  // O React avisa no console de erro que capturou a falha: é esperado aqui.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => raiz.unmount());
  hospedeiro.remove();
});

const Saudacao = ({ nome }: { nome: string }) => <p>Olá, {nome}</p>;

type PedacoDeSaudacao = PedacoRetentavel<typeof Saudacao>;

async function desenhar(Pedaco: PedacoDeSaudacao, props: { nome: string }) {
  await act(async () => {
    raiz.render(
      <Limite>
        <Suspense fallback={<p>carregando</p>}>
          <Pedaco {...props} />
        </Suspense>
      </Limite>,
    );
  });
}

/** Desmonta e monta de novo, como o limite de erro faz depois do "Tentar de novo". */
async function remontar(Pedaco: PedacoDeSaudacao, props: { nome: string }) {
  await act(async () => raiz.unmount());
  raiz = createRoot(hospedeiro);
  await desenhar(Pedaco, props);
}

describe("lazyRetentavel", () => {
  it("não pede o arquivo enquanto o pedaço não é desenhado", () => {
    const fabrica = vi.fn(async () => ({ default: Saudacao }));
    const Pedaco = lazyRetentavel(fabrica);
    Pedaco.tentarDeNovo();
    expect(fabrica).not.toHaveBeenCalled();
  });

  it("desenha o componente carregado, repassa as props e pede o arquivo uma vez só", async () => {
    const fabrica = vi.fn(async () => ({ default: Saudacao }));
    const Pedaco = lazyRetentavel(fabrica);

    await desenhar(Pedaco, { nome: "Ana" });
    expect(hospedeiro.textContent).toBe("Olá, Ana");

    await desenhar(Pedaco, { nome: "Bia" });
    expect(hospedeiro.textContent).toBe("Olá, Bia");
    expect(fabrica).toHaveBeenCalledTimes(1);
  });

  it("sem tentarDeNovo, a falha do download fica: remontar mostra o MESMO erro e não pede de novo", async () => {
    const fabrica = vi.fn(async () => {
      throw new Error("rede caiu");
    });
    const Pedaco = lazyRetentavel(fabrica);

    await desenhar(Pedaco, { nome: "Ana" });
    expect(hospedeiro.textContent).toBe("rede caiu");

    await remontar(Pedaco, { nome: "Ana" });
    expect(hospedeiro.textContent).toBe("rede caiu");
    expect(fabrica).toHaveBeenCalledTimes(1);
  });

  it("depois de falhar, tentarDeNovo faz o próximo desenho pedir o arquivo outra vez e a tela volta", async () => {
    const fabrica = vi
      .fn<() => Promise<{ default: typeof Saudacao }>>()
      .mockRejectedValueOnce(new Error("rede caiu"))
      .mockResolvedValue({ default: Saudacao });
    const Pedaco = lazyRetentavel(fabrica);

    await desenhar(Pedaco, { nome: "Ana" });
    expect(hospedeiro.textContent).toBe("rede caiu");

    Pedaco.tentarDeNovo();
    // Trocar o `lazy` não pede nada sozinho: só o próximo desenho pede.
    expect(fabrica).toHaveBeenCalledTimes(1);

    await remontar(Pedaco, { nome: "Ana" });
    expect(hospedeiro.textContent).toBe("Olá, Ana");
    expect(fabrica).toHaveBeenCalledTimes(2);
  });

  it("se a nova tentativa também falhar, o erro novo aparece e outra tentativa ainda é possível", async () => {
    const fabrica = vi
      .fn<() => Promise<{ default: typeof Saudacao }>>()
      .mockRejectedValueOnce(new Error("primeira falha"))
      .mockRejectedValueOnce(new Error("segunda falha"))
      .mockResolvedValue({ default: Saudacao });
    const Pedaco = lazyRetentavel(fabrica);

    await desenhar(Pedaco, { nome: "Ana" });
    expect(hospedeiro.textContent).toBe("primeira falha");

    Pedaco.tentarDeNovo();
    await remontar(Pedaco, { nome: "Ana" });
    expect(hospedeiro.textContent).toBe("segunda falha");

    Pedaco.tentarDeNovo();
    await remontar(Pedaco, { nome: "Ana" });
    expect(hospedeiro.textContent).toBe("Olá, Ana");
    expect(fabrica).toHaveBeenCalledTimes(3);
  });

  it("mesmo depois de carregar com sucesso, tentarDeNovo troca o lazy: o próximo desenho pede o arquivo outra vez", async () => {
    const fabrica = vi.fn(async () => ({ default: Saudacao }));
    const Pedaco = lazyRetentavel(fabrica);

    await desenhar(Pedaco, { nome: "Ana" });
    expect(fabrica).toHaveBeenCalledTimes(1);

    Pedaco.tentarDeNovo();
    await remontar(Pedaco, { nome: "Ana" });

    expect(fabrica).toHaveBeenCalledTimes(2);
    expect(hospedeiro.textContent).toBe("Olá, Ana");
  });

  it("dois pedaços são independentes: tentarDeNovo de um não mexe no outro", async () => {
    const fabricaA = vi.fn(async () => ({ default: Saudacao }));
    const fabricaB = vi.fn(async () => ({ default: Saudacao }));
    const A = lazyRetentavel(fabricaA);
    const B = lazyRetentavel(fabricaB);

    await desenhar(A, { nome: "Ana" });
    await desenhar(B, { nome: "Bia" });
    A.tentarDeNovo();
    await remontar(B, { nome: "Bia" });

    expect(fabricaA).toHaveBeenCalledTimes(1);
    // B foi desmontado e montado de novo SEM tentarDeNovo: o lazy dele guarda o sucesso.
    expect(fabricaB).toHaveBeenCalledTimes(1);
  });

  it("expõe tentarDeNovo como função no pedaço devolvido", () => {
    const Pedaco = lazyRetentavel(async () => ({ default: Saudacao }));
    expect(typeof Pedaco.tentarDeNovo).toBe("function");
    expect(typeof Pedaco).toBe("function");
  });
});
