// @vitest-environment jsdom
import {
  listarNovidades,
  marcarNovidadeComoLida,
  marcarTodasComoLidas,
  registrarNovidadesDaAtualizacao,
  useNovidadesDoAparelho,
} from "@/lib/novidades/armazenamento-local";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const chave = "notificacoes-novidades-do-app-v1";
let raiz: Root;
let hospedeiro: HTMLDivElement;

function Sonda() {
  const { novidades, naoLidas } = useNovidadesDoAparelho();
  return <span>{`${novidades.length}:${naoLidas}`}</span>;
}

beforeEach(() => {
  localStorage.clear();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  act(() => raiz.render(<Sonda />));
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

describe("useNovidadesDoAparelho", () => {
  it("acompanha o registro e a leitura na mesma aba", () => {
    expect(hospedeiro.textContent).toBe("0:0");
    act(() => {
      registrarNovidadesDaAtualizacao({ de: null, para: "1.5.31" });
    });
    expect(hospedeiro.textContent).toBe("1:1");
    act(() => marcarNovidadeComoLida("1.5.31"));
    expect(hospedeiro.textContent).toBe("1:0");
    act(() => marcarTodasComoLidas());
    expect(hospedeiro.textContent).toBe("1:0");
  });

  it("acompanha a gravação e a limpeza feitas em outra aba", () => {
    act(() => {
      registrarNovidadesDaAtualizacao({ de: null, para: "1.5.31" });
    });
    const salvas: unknown = JSON.parse(localStorage.getItem(chave) ?? "[]");
    if (!Array.isArray(salvas)) throw new Error("histórico ausente");
    const lidas = salvas.map((item: Record<string, unknown>) => ({
      ...item,
      lida: true,
    }));
    act(() => {
      localStorage.setItem(chave, JSON.stringify(lidas));
      listarNovidades();
      window.dispatchEvent(new StorageEvent("storage", { key: chave }));
    });
    expect(hospedeiro.textContent).toBe("1:0");
    act(() => {
      localStorage.clear();
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(hospedeiro.textContent).toBe("0:0");
  });

  it("permanece estável quando o storage recebe JSON corrompido", () => {
    act(() => {
      localStorage.setItem(chave, "{quebrado");
      window.dispatchEvent(new StorageEvent("storage", { key: chave }));
    });
    expect(hospedeiro.textContent).toBe("0:0");
  });
});
