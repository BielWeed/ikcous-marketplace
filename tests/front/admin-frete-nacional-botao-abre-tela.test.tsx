// @vitest-environment jsdom
//
// TAREFA T4 (23/09/2026, admin): dentro de "Fora da cidade"
// (`FreteNacionalBloco`), um botão "Estratégias do frete nacional →" mostra
// o estado SALVO ao lado (`resumoDaEstrategiaNacional` de
// src/lib/estrategias-de-frete.ts) e navega para a tela nova
// (`admin-shipping-national`) — sem recalcular nada aqui, o componente só
// exibe o texto que a view calculou e chama o callback que recebeu.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FreteNacionalBloco } from "@/components/admin/shipping/FreteNacionalBloco";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("FreteNacionalBloco — botão 'Estratégias do frete nacional'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  function montar(props: {
    resumoDaEstrategiaNacional?: string;
    onAbrirEstrategiasNacionais?: () => void;
  }) {
    act(() => {
      raiz.render(
        <FreteNacionalBloco
          originCep="38400-000"
          onOriginCep={() => {}}
          provedores={[]}
          {...props}
        />,
      );
    });
  }

  it("sem onAbrirEstrategiasNacionais, o botão não existe (mesmo padrão de onAbrirAjustes)", () => {
    montar({});
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      /estratégias do frete nacional/i.test(b.textContent || ""),
    );
    expect(botao).toBeUndefined();
  });

  it("mostra o estado salvo ao lado do botão", () => {
    montar({
      resumoDaEstrategiaNacional: "grátis acima de R$ 199 · todas as opções",
      onAbrirEstrategiasNacionais: () => {},
    });
    expect(hospedeiro.textContent).toContain(
      "grátis acima de R$ 199 · todas as opções",
    );
  });

  it("sem resumo explícito, mostra 'desligado' (o default do contrato)", () => {
    montar({ onAbrirEstrategiasNacionais: () => {} });
    expect(hospedeiro.textContent).toContain("desligado");
  });

  it("clicar chama onAbrirEstrategiasNacionais", () => {
    const onAbrir = vi.fn();
    montar({
      resumoDaEstrategiaNacional: "15% na mais barata",
      onAbrirEstrategiasNacionais: onAbrir,
    });
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      /estratégias do frete nacional/i.test(b.textContent || ""),
    ) as HTMLButtonElement;
    expect(botao).toBeDefined();
    act(() => {
      botao.click();
    });
    expect(onAbrir).toHaveBeenCalledTimes(1);
  });

  it("desabilitado (offline) o botão não clica", () => {
    const onAbrir = vi.fn();
    act(() => {
      raiz.render(
        <FreteNacionalBloco
          originCep="38400-000"
          onOriginCep={() => {}}
          provedores={[]}
          resumoDaEstrategiaNacional="desligado"
          onAbrirEstrategiasNacionais={onAbrir}
          desabilitado={true}
        />,
      );
    });
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      /estratégias do frete nacional/i.test(b.textContent || ""),
    ) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
  });
});
