// @vitest-environment jsdom
//
// O helper que os testes das telas usam no lugar de `fireEvent.change` no
// `<select>`: escolhe como a lojista (abre o campo, toca na opção), síncrono
// (`flushSync`), e lança erro claro quando a opção não existe ou está
// desabilitada — o teste nunca passa "escolhendo" o que não está na tela.
import { CampoDeEscolha } from "@/components/admin/primitivos/lista-de-escolha/CampoDeEscolha";
import type { OpcaoDaLista } from "@/components/admin/primitivos/lista-de-escolha/tipos";
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  escolherNaLista,
  opcoesDaLista,
  valorDaLista,
} from "./helpers/lista-de-escolha";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

class ResizeObserverFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverFalso);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

const UFS: OpcaoDaLista[] = [
  { valor: "", rotulo: "Não informar" },
  { valor: "RJ", rotulo: "Rio de Janeiro", sigla: "RJ" },
  { valor: "SP", rotulo: "São Paulo", sigla: "SP" },
  { valor: "XX", rotulo: "Estado antigo", desabilitada: true },
];

let mudancas: string[] = [];

function Uf() {
  const [uf, setUf] = useState("SP");
  return (
    <CampoDeEscolha
      id="fornecedor-uf"
      rotulo="Estado"
      opcoes={UFS}
      valor={uf}
      aoMudar={(v) => {
        mudancas.push(v);
        setUf(v);
      }}
    />
  );
}

function montar() {
  mudancas = [];
  act(() => raiz.render(<Uf />));
}

describe.each([
  { tela: "celular", computador: false },
  { tela: "computador", computador: true },
])("helper da lista de escolha — $tela", ({ computador }) => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (consulta: string) => ({
      matches: computador && consulta.includes("min-width: 1024px"),
      media: consulta,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }));
  });

  it("valorDaLista lê o valor do campo fechado", () => {
    montar();
    expect(valorDaLista("fornecedor-uf")).toBe("SP");
  });

  it("escolherNaLista escolhe como a lojista e fecha a lista", () => {
    montar();
    act(() => escolherNaLista("fornecedor-uf", "RJ"));
    expect(mudancas).toEqual(["RJ"]);
    expect(valorDaLista("fornecedor-uf")).toBe("RJ");
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it("a opção de valor '' é escolhível", () => {
    montar();
    act(() => escolherNaLista("fornecedor-uf", ""));
    expect(mudancas).toEqual([""]);
    expect(valorDaLista("fornecedor-uf")).toBe("");
  });

  it("é síncrono: sem act em volta também escolhe", () => {
    montar();
    escolherNaLista("fornecedor-uf", "RJ");
    expect(mudancas).toEqual(["RJ"]);
  });

  it("opcoesDaLista lista o que a lojista vê, e deixa a lista fechada", () => {
    montar();
    let lidas: ReturnType<typeof opcoesDaLista> = [];
    act(() => {
      lidas = opcoesDaLista("fornecedor-uf");
    });
    expect(lidas).toEqual([
      { valor: "", rotulo: "Não informar", desabilitada: false },
      { valor: "RJ", rotulo: "Rio de Janeiro", desabilitada: false },
      { valor: "SP", rotulo: "São Paulo", desabilitada: false },
      { valor: "XX", rotulo: "Estado antigo", desabilitada: true },
    ]);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(mudancas).toEqual([]);
  });

  it("opção que não existe: erro claro, com as opções que existem", () => {
    montar();
    expect(() =>
      act(() => escolherNaLista("fornecedor-uf", "MG")),
    ).toThrowError(/"MG".*fornecedor-uf.*"RJ"/s);
    expect(mudancas).toEqual([]);
  });

  it("opção desabilitada: erro claro, nada escolhido", () => {
    montar();
    expect(() =>
      act(() => escolherNaLista("fornecedor-uf", "XX")),
    ).toThrowError(/desabilitada/);
    expect(mudancas).toEqual([]);
  });

  it("campo que não está na tela: erro claro", () => {
    montar();
    expect(() => escolherNaLista("nao-existe", "RJ")).toThrowError(
      /nao-existe.*não está na tela/,
    );
    expect(() => valorDaLista("nao-existe")).toThrowError(/não está na tela/);
  });
});
