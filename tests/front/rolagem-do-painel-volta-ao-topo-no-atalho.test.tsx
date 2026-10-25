// @vitest-environment jsdom
//
// Defeito (ressalva da 1.5.68): o atalho "Preparar pedidos" do Início zera
// filtros e página da tela Pedidos, mas a rolagem da última visita era
// devolvida pelo `useScrollRestoration` (efeito de layout, que roda ANTES do
// reset) e ainda reaplicada no quadro seguinte. A lista "Em aberto" abria já
// rolada, e a lojista não via os primeiros pedidos para preparar.
//
// `reiniciarScroll` leva a rolagem ao topo, esquece a posição guardada e
// cancela a reaplicação agendada.
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Api = () => void;

describe("useScrollRestoration.reiniciarScroll", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;
  let container: HTMLDivElement;
  const guardado: { api: Api | null } = { api: null };
  const guardar = (a: Api) => {
    guardado.api = a;
  };
  let chave = 0;

  function Tela({
    ativa,
    chaveDaTela,
    aoMontar,
  }: {
    ativa: boolean;
    chaveDaTela: string;
    aoMontar: (api: Api) => void;
  }) {
    const { ref, reiniciarScroll } = useScrollRestoration(chaveDaTela, ativa);
    useEffect(() => {
      aoMontar(reiniciarScroll);
    }, [aoMontar, reiniciarScroll]);
    return <div ref={ref}>lista</div>;
  }

  beforeEach(() => {
    chave += 1;
    hospedeiro = document.createElement("div");
    container = document.createElement("div");
    container.className = "admin-scroll-container";
    container.appendChild(hospedeiro);
    document.body.appendChild(container);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    container.remove();
  });

  const render = (ativa: boolean) =>
    act(async () => {
      raiz.render(
        <Tela ativa={ativa} chaveDaTela={`k${chave}`} aoMontar={guardar} />,
      );
    });
  const proximoQuadro = () =>
    act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });

  it("sem reiniciar, voltar à tela devolve a rolagem da visita anterior", async () => {
    await render(true);
    container.scrollTop = 480;
    await render(false);
    container.scrollTop = 0;
    await render(true);
    await proximoQuadro();
    expect(container.scrollTop).toBe(480);
  });

  it("reiniciar logo depois de voltar leva ao topo e a reaplicação do quadro seguinte não desfaz", async () => {
    await render(true);
    container.scrollTop = 480;
    await render(false);
    container.scrollTop = 0;
    await render(true);
    expect(container.scrollTop).toBe(480);

    await act(async () => {
      guardado.api?.();
    });
    expect(container.scrollTop).toBe(0);
    await proximoQuadro();
    expect(container.scrollTop).toBe(0);

    // E a posição esquecida não volta numa próxima visita.
    await render(false);
    await render(true);
    await proximoQuadro();
    expect(container.scrollTop).toBe(0);
  });
});
