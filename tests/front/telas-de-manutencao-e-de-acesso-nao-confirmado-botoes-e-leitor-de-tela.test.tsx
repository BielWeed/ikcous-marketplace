// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026), território pwa e layouts: duas telas de
// "o servidor não respondeu" cujo botão e cuja leitura por voz não tinham
// teste nenhum que reprovasse com o defeito plantado:
//  - "Servidor em Manutenção": o botão "Tentar de novo" vira "Verificando...",
//    trava, não repete o pedido com toque duplo e VOLTA ao normal quando acaba
//    — a trava presa deixava o botão morto;
//    e a frase que diz "se você já pagou, não pague de novo";
//  - "Não foi possível confirmar seu acesso": cada botão chama a sua ação, a
//    frase diz que a permissão não mudou e o desenho de alerta é decorativo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recarregar = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useVoltaDaManutencao", () => ({
  useVoltaDaManutencao: () => {},
}));
vi.mock("@/lib/volta-da-manutencao", () => ({
  recarregarComPaginaNova: recarregar,
}));

import { TelaDeVerificacaoFalhou } from "@/components/layouts/TelaDeVerificacaoFalhou";
import { MaintenanceView } from "@/components/pwa/MaintenanceView";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  recarregar.mockReset();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

const texto = () => (hospedeiro.textContent ?? "").replace(/\s+/g, " ");
const botao = (nome: string) =>
  Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => b.textContent === nome,
  ) as HTMLButtonElement | undefined;

describe("MaintenanceView — o botão 'Tentar de novo'", () => {
  function montar() {
    act(() => raiz.render(<MaintenanceView />));
  }

  it("a tela avisa: se já pagou, não pague de novo, e confira em Meus pedidos", () => {
    montar();
    expect(texto()).toContain("Servidor em Manutenção");
    expect(texto()).toContain("Se você já pagou, não pague de novo.");
    expect(texto()).toContain("confira em Meus pedidos");
  });

  it("em andamento: 'Verificando...', travado e o toque duplo não repete o pedido; no fim volta", async () => {
    let concluir: () => void = () => {};
    recarregar.mockImplementation(
      () =>
        new Promise<void>((resolver) => {
          concluir = resolver;
        }),
    );
    montar();
    expect(botao("Tentar de novo")?.disabled).toBe(false);

    await act(async () => {
      botao("Tentar de novo")?.click();
    });
    const ocupado = botao("Verificando...");
    expect(ocupado).toBeDefined();
    expect(ocupado?.disabled).toBe(true);
    expect(botao("Tentar de novo")).toBeUndefined();

    await act(async () => {
      ocupado?.click();
    });
    expect(recarregar).toHaveBeenCalledTimes(1);

    await act(async () => {
      concluir();
    });
    expect(botao("Tentar de novo")?.disabled).toBe(false);
    expect(botao("Verificando...")).toBeUndefined();
  });

  it("terminada a verificação, dá para tentar outra vez (a trava não fica presa)", async () => {
    recarregar.mockResolvedValue(undefined);
    montar();

    await act(async () => {
      botao("Tentar de novo")?.click();
    });
    expect(recarregar).toHaveBeenCalledTimes(1);
    expect(botao("Tentar de novo")?.disabled).toBe(false);

    await act(async () => {
      botao("Tentar de novo")?.click();
    });
    expect(recarregar).toHaveBeenCalledTimes(2);
  });
});

describe("TelaDeVerificacaoFalhou — acesso não confirmado", () => {
  it("diz o que houve sem acusar, e cada botão chama a sua ação", () => {
    const tentar = vi.fn();
    const voltar = vi.fn();
    act(() =>
      raiz.render(
        <TelaDeVerificacaoFalhou onTentarDeNovo={tentar} onVoltar={voltar} />,
      ),
    );
    expect(texto()).toContain("Não foi possível confirmar seu acesso");
    expect(texto()).toContain("O servidor não respondeu a tempo.");
    expect(texto()).toContain("sua permissão não mudou");

    act(() => botao("Tentar de novo")?.click());
    expect(tentar).toHaveBeenCalledTimes(1);
    expect(voltar).not.toHaveBeenCalled();

    act(() => botao("Voltar à loja")?.click());
    expect(voltar).toHaveBeenCalledTimes(1);
    expect(tentar).toHaveBeenCalledTimes(1);
  });

  it("o desenho de alerta é decorativo (escondido do leitor de tela) e nenhum dado do painel aparece", () => {
    act(() =>
      raiz.render(
        <TelaDeVerificacaoFalhou onTentarDeNovo={vi.fn()} onVoltar={vi.fn()} />,
      ),
    );
    const desenho = hospedeiro.querySelector("svg");
    expect(desenho?.getAttribute("aria-hidden")).toBe("true");
    expect(hospedeiro.querySelectorAll("button").length).toBe(2);
  });
});
