// @vitest-environment jsdom
//
// `useVoltarFechaAFolha`: os LIMITES do histórico que nenhum teste vigiava
// (caçada por mutação, 24/11/2026 -- cada guarda abaixo sobrevivia à remoção).
//   1. A entrada que a folha empurra NÃO herda `isBase` (senão o App acha que
//      voltou ao início).
//   2. Folha FECHADA POR BAIXO de outra folha não devolve a entrada: a do topo
//      é da folha de cima, e um `history.back()` à toa a desarmaria.
//   3. Tela que some com a folha aberta, saída por navegação e entrada do topo
//      que já não é a nossa: NADA é devolvido ao histórico.
//   4. `antesDaGuarda` só reage ao retorno do MESMO endereço (um retorno para
//      outra tela não é Voltar da folha), e o retorno do nosso próprio
//      `history.back()` é engolido ANTES do ouvinte do App (que já acordou
//      primeiro, no navegador de verdade).
//   5. O prazo de 500 ms solta o Voltar se o retorno do nosso `back()` nunca
//      chegar (senão nenhuma folha mais trataria o Voltar).
// Histórico REAL do jsdom. Molde: voltar-fecha-a-folha-gancho.test.tsx.
import { useEffect } from "react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  consumirVoltarDaFolhaAntesDaGuarda,
  useVoltarFechaAFolha,
} from "@/hooks/useVoltarFechaAFolha";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperar(ms = 0): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface PropsDaFolha {
  readonly aberta: boolean;
  readonly aoVoltar: () => unknown;
  readonly antesDaGuarda?: boolean;
  readonly aoReceberSaida?: (sairPorNavegacao: () => void) => void;
}

function Folha({
  aberta,
  aoVoltar,
  antesDaGuarda = false,
  aoReceberSaida,
}: PropsDaFolha) {
  const sairPorNavegacao = useVoltarFechaAFolha(
    aberta,
    aoVoltar,
    antesDaGuarda,
  );
  useEffect(() => {
    aoReceberSaida?.(sairPorNavegacao);
  });
  return null;
}

interface PropsDeDuas {
  readonly baixoAberta: boolean;
  readonly cimaAberta: boolean;
  readonly aoVoltarBaixo: () => unknown;
  readonly aoVoltarCima: () => unknown;
}

function Duas({
  baixoAberta,
  cimaAberta,
  aoVoltarBaixo,
  aoVoltarCima,
}: PropsDeDuas) {
  useVoltarFechaAFolha(baixoAberta, aoVoltarBaixo);
  useVoltarFechaAFolha(cimaAberta, aoVoltarCima);
  return null;
}

describe("useVoltarFechaAFolha — limites do histórico", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let popstates: number;
  let navegacoesDoApp: string[];
  const ouvintes: Array<(e: PopStateEvent) => void> = [];

  beforeEach(() => {
    globalThis.history.replaceState({ view: "home" }, "", "/");
    globalThis.history.pushState({ view: "pedido" }, "", "/pedido");
    popstates = 0;
    navegacoesDoApp = [];
    // Conta todo popstate que chega ao window (registrado antes de qualquer
    // folha, em captura: roda primeiro, mesmo quando a folha o engole depois).
    const contar = () => {
      popstates += 1;
    };
    // O "App" do navegador de verdade: acorda ANTES da folha e só navega se a
    // folha não entregou o retorno antes da guarda.
    const app = (e: PopStateEvent) => {
      if (consumirVoltarDaFolhaAntesDaGuarda(e)) return;
      navegacoesDoApp.push(globalThis.location.pathname);
    };
    ouvintes.push(contar, app);
    globalThis.addEventListener("popstate", contar, true);
    globalThis.addEventListener("popstate", app, true);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    for (const o of ouvintes.splice(0)) {
      globalThis.removeEventListener("popstate", o, true);
    }
  });

  async function renderizar(ui: React.ReactElement) {
    await act(async () => {
      raiz.render(ui);
      await esperar();
    });
  }

  async function deixarPassar(ms = 150) {
    await act(async () => {
      await esperar(ms);
    });
  }

  async function ir(delta: number) {
    await act(async () => {
      globalThis.history.go(delta);
      await esperar(60);
    });
    await deixarPassar(60);
  }

  it("a entrada empurrada pela folha não herda a marca isBase da tela", async () => {
    globalThis.history.replaceState(
      { view: "pedido", isBase: true },
      "",
      "/pedido",
    );
    const aoVoltar = vi.fn<() => unknown>();
    await renderizar(<Folha aberta aoVoltar={aoVoltar} />);

    expect(globalThis.history.state).toEqual({
      view: "pedido",
      folhaDePolitica: true,
    });

    await ir(-1);
    expect(aoVoltar).toHaveBeenCalledTimes(1);
    // A entrada de baixo, a da tela, continua com a marca dela.
    expect(globalThis.history.state).toEqual({ view: "pedido", isBase: true });
  });

  it("folha de BAIXO fechada com a de cima aberta não devolve a entrada que é da de cima", async () => {
    const aoVoltarBaixo = vi.fn<() => unknown>();
    const aoVoltarCima = vi.fn<() => unknown>();
    const props = { aoVoltarBaixo, aoVoltarCima };
    await renderizar(<Duas {...props} baixoAberta cimaAberta />);

    await renderizar(<Duas {...props} baixoAberta={false} cimaAberta />);
    await deixarPassar(200);

    // Nenhum `history.back()` à toa: nenhum popstate, e a folha de cima segue
    // dona do Voltar.
    expect(popstates).toBe(0);
    expect(aoVoltarCima).not.toHaveBeenCalled();
    expect(globalThis.history.state).toMatchObject({ folhaDePolitica: true });

    await ir(-1);
    expect(aoVoltarCima).toHaveBeenCalledTimes(1);
    expect(aoVoltarBaixo).not.toHaveBeenCalled();
  });

  it("a tela some com a folha aberta: o histórico não é mexido", async () => {
    const aoVoltar = vi.fn<() => unknown>();
    await renderizar(<Folha aberta aoVoltar={aoVoltar} />);
    expect(globalThis.history.state).toMatchObject({ folhaDePolitica: true });

    await renderizar(<span />);
    await act(async () => {
      raiz.unmount();
      await esperar(200);
    });

    expect(popstates).toBe(0);
    expect(globalThis.history.state).toMatchObject({ folhaDePolitica: true });
    expect(aoVoltar).not.toHaveBeenCalled();
    // O afterEach desmonta de novo: a raiz já foi, então recria uma vazia.
    raiz = createRoot(hospedeiro);
  });

  it("saída por navegação: fechar a folha depois de avisar NÃO devolve a entrada", async () => {
    let sair: (() => void) | undefined;
    const aoReceberSaida = (fn: () => void) => {
      sair = fn;
    };
    const aoVoltar = vi.fn<() => unknown>();
    await renderizar(
      <Folha aberta aoVoltar={aoVoltar} aoReceberSaida={aoReceberSaida} />,
    );
    expect(sair).toBeTypeOf("function");

    act(() => sair?.());
    await renderizar(
      <Folha
        aberta={false}
        aoVoltar={aoVoltar}
        aoReceberSaida={aoReceberSaida}
      />,
    );
    await deixarPassar(200);

    // O roteador é quem vai substituir a entrada (replaceState); a folha não
    // pode ter mexido nela.
    expect(popstates).toBe(0);
    expect(globalThis.history.state).toMatchObject({ folhaDePolitica: true });
  });

  it("reabrir a folha depois de uma saída por navegação volta a devolver a entrada ao fechar", async () => {
    let sair: (() => void) | undefined;
    const aoReceberSaida = (fn: () => void) => {
      sair = fn;
    };
    const aoVoltar = vi.fn<() => unknown>();
    const monta = (aberta: boolean) => (
      <Folha
        aberta={aberta}
        aoVoltar={aoVoltar}
        aoReceberSaida={aoReceberSaida}
      />
    );
    await renderizar(monta(true));
    act(() => sair?.());
    await renderizar(monta(false));
    await deixarPassar(100);
    // Limpa a entrada deixada de propósito pela saída por navegação.
    await ir(-1);
    popstates = 0;

    await renderizar(monta(true));
    await renderizar(monta(false));
    await deixarPassar(200);

    // Agora a folha fechou normalmente (pelo X): devolveu a SUA entrada.
    expect(popstates).toBe(1);
    expect(globalThis.history.state).toEqual({ view: "pedido" });
  });

  it("a entrada do topo já não é a da folha (a tela navegou): fechar não mexe no histórico", async () => {
    const aoVoltar = vi.fn<() => unknown>();
    await renderizar(<Folha aberta aoVoltar={aoVoltar} />);

    // A tela empurrou uma entrada dela, sem a marca da folha, no mesmo endereço.
    globalThis.history.pushState({ view: "outra-tela" }, "", "/pedido");
    await renderizar(<Folha aberta={false} aoVoltar={aoVoltar} />);
    await deixarPassar(200);

    expect(popstates).toBe(0);
    expect(globalThis.history.state).toEqual({ view: "outra-tela" });
  });

  it("com antesDaGuarda, fechar quando o topo é de OUTRO endereço não devolve a entrada", async () => {
    const aoVoltar = vi.fn<() => unknown>();
    await renderizar(<Folha aberta aoVoltar={aoVoltar} antesDaGuarda />);

    // Outra tela, em outro endereço, que também empurrou uma folha dela.
    globalThis.history.pushState({ folhaDePolitica: true }, "", "/outra");
    await renderizar(
      <Folha aberta={false} aoVoltar={aoVoltar} antesDaGuarda />,
    );
    await deixarPassar(200);

    expect(popstates).toBe(0);
    expect(globalThis.location.pathname).toBe("/outra");
  });

  describe("antesDaGuarda e o endereço", () => {
    it("um retorno para OUTRO endereço não é Voltar da folha; sem antesDaGuarda ela o trataria", async () => {
      const comGuarda = vi.fn<() => unknown>();
      await renderizar(<Folha aberta aoVoltar={comGuarda} antesDaGuarda />);
      await ir(-2); // "/pedido" (folha) → "/"
      expect(globalThis.location.pathname).toBe("/");
      expect(comGuarda).not.toHaveBeenCalled();
      // E o retorno chegou ao App, que decide a tela.
      expect(navegacoesDoApp).toEqual(["/"]);

      // Controle: a mesma navegação, sem a opção, é tratada pela folha.
      await renderizar(<span />);
      await ir(1);
      await ir(1);
      expect(globalThis.location.pathname).toBe("/pedido");
      const semGuarda = vi.fn<() => unknown>();
      await renderizar(<Folha aberta aoVoltar={semGuarda} />);
      await ir(-2);
      expect(semGuarda).toHaveBeenCalledTimes(1);
    });

    it("o retorno do nosso próprio history.back() é entregue à folha ANTES do App", async () => {
      const aoVoltar = vi.fn<() => unknown>();
      await renderizar(<Folha aberta aoVoltar={aoVoltar} antesDaGuarda />);

      await renderizar(
        <Folha aberta={false} aoVoltar={aoVoltar} antesDaGuarda />,
      );
      await deixarPassar(200);

      expect(popstates).toBe(1);
      // O App viu o retorno, mas a folha já o tinha engolido: nada de navegar.
      expect(navegacoesDoApp).toEqual([]);
      expect(aoVoltar).not.toHaveBeenCalled();
      expect(globalThis.history.state).toEqual({ view: "pedido" });
    });

    it("enquanto espera o retorno, um popstate de OUTRO endereço não é engolido", async () => {
      const aoVoltar = vi.fn<() => unknown>();
      await renderizar(<Folha aberta aoVoltar={aoVoltar} antesDaGuarda />);

      // Fecha e, ANTES de o retorno do back() chegar, a tela já mudou de
      // endereço: esse popstate não é o nosso.
      act(() => {
        raiz.render(<Folha aberta={false} aoVoltar={aoVoltar} antesDaGuarda />);
      });
      globalThis.history.replaceState({ view: "outra" }, "", "/outra");
      const alheio = new PopStateEvent("popstate");
      expect(consumirVoltarDaFolhaAntesDaGuarda(alheio)).toBe(false);
      await deixarPassar(200);
    });
  });

  describe("prazo do retorno (500 ms)", () => {
    // O `back()` do fecho pelo X é mudo: o retorno que a folha esperava nunca
    // chega (jsdom não o produz porque o espião o engole).
    async function fecharPeloXSemRetorno(
      aoVoltarA: () => unknown,
      aoVoltarB: () => unknown,
    ) {
      await renderizar(<Folha aberta aoVoltar={aoVoltarA} />);
      await renderizar(<Folha aberta={false} aoVoltar={aoVoltarA} />);
      await renderizar(<Folha aberta aoVoltar={aoVoltarB} />);
    }

    it("o Voltar que chega DENTRO do prazo é tratado como o retorno esperado e engolido", async () => {
      const aoVoltarA = vi.fn<() => unknown>();
      const aoVoltarB = vi.fn<() => unknown>();
      const back = vi
        .spyOn(globalThis.history, "back")
        .mockImplementation(() => {});
      try {
        await fecharPeloXSemRetorno(aoVoltarA, aoVoltarB);
        expect(back).toHaveBeenCalledTimes(1);
      } finally {
        back.mockRestore();
      }
      await ir(-1);
      expect(aoVoltarB).not.toHaveBeenCalled();
    });

    it("se o retorno nunca chega, o Voltar volta a ser da folha depois do prazo", async () => {
      const aoVoltarA = vi.fn<() => unknown>();
      const aoVoltarB = vi.fn<() => unknown>();
      const back = vi
        .spyOn(globalThis.history, "back")
        .mockImplementation(() => {});
      try {
        await fecharPeloXSemRetorno(aoVoltarA, aoVoltarB);
      } finally {
        back.mockRestore();
      }

      await deixarPassar(600);
      await ir(-1);
      expect(aoVoltarB).toHaveBeenCalledTimes(1);
    });
  });
});
