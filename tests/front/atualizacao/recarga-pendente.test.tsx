// @vitest-environment jsdom
//
// RECARGA PENDENTE — o veto local de cada aba. O service worker novo assumiu
// (onNeedReload do plugin): a aba só ANOTA; recarregar é decisão do gate.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  haRecargaPendente,
  limparRecargaPendente,
  marcarRecargaPendente,
  recarregarAposAssumir,
  useRecargaPendente,
} from "@/lib/atualizacao/recarga-pendente";
import {
  CHAVE_MOTIVO_DE_RECARGA,
  CHAVE_ORIGEM_DE_ATUALIZACAO,
} from "@/lib/motivo-de-recarga";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const local = new Map<string, string>();
const sessao = new Map<string, string>();
const stub = (m: Map<string, string>) => ({
  getItem: (k: string) => m.get(k) ?? null,
  setItem: (k: string, v: string) => {
    m.set(k, String(v));
  },
  removeItem: (k: string) => {
    m.delete(k);
  },
});

describe("recarga pendente", () => {
  let host: HTMLDivElement;
  let raiz: Root;

  function Leitor() {
    return <span>{String(useRecargaPendente())}</span>;
  }

  beforeEach(() => {
    local.clear();
    sessao.clear();
    vi.stubGlobal("localStorage", stub(local));
    vi.stubGlobal("sessionStorage", stub(sessao));
    limparRecargaPendente();
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    limparRecargaPendente();
  });

  it("começa sem pedido; marcar liga (e é idempotente); limpar desliga", () => {
    expect(haRecargaPendente()).toBe(false);
    marcarRecargaPendente();
    marcarRecargaPendente();
    expect(haRecargaPendente()).toBe(true);
    limparRecargaPendente();
    expect(haRecargaPendente()).toBe(false);
  });

  it("serve como onNeedReload do plugin: sem argumentos, sem retorno obrigatório", () => {
    expect(marcarRecargaPendente.length).toBe(0);
  });

  it("o hook re-renderiza quando o pedido chega, e solta o ouvinte ao desmontar", () => {
    act(() => raiz.render(<Leitor />));
    expect(host.textContent).toBe("false");
    act(() => marcarRecargaPendente());
    expect(host.textContent).toBe("true");
    act(() => raiz.unmount());
    expect(() => limparRecargaPendente()).not.toThrow();
    raiz = createRoot(host);
  });

  it("recarregarAposAssumir grava a SUA origem e o motivo ANTES de recarregar", () => {
    const recarregar = vi.fn(() => {
      // no instante do reload, a evidência já tem de estar gravada
      expect(sessao.get(CHAVE_ORIGEM_DE_ATUALIZACAO)).toBe("1.5.31-sha.aaa");
      expect(local.get(CHAVE_MOTIVO_DE_RECARGA)).toBe("atualizacao-aplicada");
    });
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: recarregar },
    });
    recarregarAposAssumir("1.5.31-sha.aaa");
    expect(recarregar).toHaveBeenCalledTimes(1);
  });
});
