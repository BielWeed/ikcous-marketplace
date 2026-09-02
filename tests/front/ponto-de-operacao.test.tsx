import {
  type EstadoDeOperacao,
  EstadoDeOperacaoProvider,
  PontoDeOperacao,
} from "@/components/admin/PontoDeOperacao";
// @vitest-environment jsdom
//
// Missão 06 (C3) — o ponto que substituiu a tag "Operações ao Vivo". A tag
// antiga ficava verde depois da carga mesmo com o tempo real morto; o ponto
// consome o estado REAL medido no AdminLayout (offline / qualidade / flash de
// sync) e só aceita existir dentro do provider. Mesmo padrão da casa:
// jsdom + createRoot + act.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ESTADO_BASE: EstadoDeOperacao = {
  isOffline: false,
  quality: "excellent",
  latency: 90,
  showSyncFlash: false,
};

let container: HTMLDivElement;
let root: Root;

function montar(estado: EstadoDeOperacao, sincronizando = false) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <EstadoDeOperacaoProvider value={estado}>
        <PontoDeOperacao sincronizando={sincronizando} />
      </EstadoDeOperacaoProvider>,
    );
  });
  return container.querySelector("[data-testid='ponto-de-operacao']")!;
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PontoDeOperacao", () => {
  it("offline fica vermelho, sem ping, e diz a verdade no tooltip", () => {
    const ponto = montar({
      isOffline: true,
      quality: "offline",
      latency: 0,
      showSyncFlash: false,
    });
    expect(ponto.className).toContain("bg-red-500");
    expect(ponto.getAttribute("title")).toBe("Sem conexão com o servidor");
    expect(ponto.querySelector(".animate-ping")).toBeNull();
  });

  it("flash de sincronização vence a carga da tela", () => {
    const ponto = montar(
      {
        isOffline: false,
        quality: "excellent",
        latency: 90,
        showSyncFlash: true,
      },
      true,
    );
    expect(ponto.className).toContain("bg-emerald-400");
    expect(ponto.getAttribute("title")).toBe("Sincronização concluída!");
  });

  it("sincronizando fica âmbar", () => {
    const ponto = montar(ESTADO_BASE, true);
    expect(ponto.className).toContain("bg-amber-500");
    expect(ponto.getAttribute("title")).toBe("Sincronizando dados...");
  });

  it("conexão lenta fica âmbar e boa fica sky, com a latência no tooltip", () => {
    const lento = montar({
      isOffline: false,
      quality: "slow",
      latency: 900,
      showSyncFlash: false,
    });
    expect(lento.className).toContain("bg-amber-500");
    expect(lento.getAttribute("title")).toContain("lenta (900ms)");

    const bom = montar({
      isOffline: false,
      quality: "good",
      latency: 120,
      showSyncFlash: false,
    });
    expect(bom.className).toContain("bg-sky-400");
    expect(bom.getAttribute("title")).toBe("Tempo real ativo — latência 120ms");
  });

  it("fora do provider não quebra: mede a conexão por conta própria", () => {
    // Render direto (sem AdminLayout), como os testes de view fazem: o ponto
    // cai para a própria medição em vez de derrubar a tela.
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(<PontoDeOperacao />);
    });
    const ponto = container.querySelector("[data-testid='ponto-de-operacao']")!;
    expect(ponto.className).toContain("bg-emerald-500");
  });
});
