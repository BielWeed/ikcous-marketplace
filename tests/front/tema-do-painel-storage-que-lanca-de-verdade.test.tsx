// @vitest-environment jsdom
//
// Aparelho sem storage (modo privado, cota cheia, bloqueio por política): o
// painel precisa abrir Escuro e a escolha do tema precisa valer ao menos na
// sessão. O teste que já existia (`tema-do-painel.test.tsx`, "storage
// indisponível") espiona `Storage.prototype`, mas neste ambiente o
// `localStorage` global NÃO passa por esse protótipo — o espião nunca
// dispara e os dois `catch` do código (leitura em `temaDoPainel.ts` e gravação
// em `AparenciaDoPainel.tsx`) ficavam sem ser executados por nenhum teste:
// trocar o `catch` de leitura para devolver "claro", ou tirar o `try` da
// gravação, passava verde. Aqui o `localStorage` é SUBSTITUÍDO de verdade por
// um que lança, e o que se confere é o resultado visível.
import { AparenciaDoPainel } from "@/components/admin/settings/AparenciaDoPainel";
import {
  lerTemaDoPainel,
  useTemaDoPainelNaRaiz,
} from "@/components/admin/temaDoPainel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flagDoReact = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
flagDoReact.IS_REACT_ACT_ENVIRONMENT = true;

const raizHtml = document.documentElement;

const storageQueLanca = {
  getItem: () => {
    throw new DOMException("negado", "SecurityError");
  },
  setItem: () => {
    throw new DOMException("cheio", "QuotaExceededError");
  },
  removeItem: () => {},
  clear: () => {},
  key: () => null,
  length: 0,
};

let hospedeiro: HTMLDivElement;
let raiz: Root;
let errosNaoTratados: string[];
const aoErrar = (e: ErrorEvent) => {
  errosNaoTratados.push(String(e.message));
  e.preventDefault();
};

beforeEach(() => {
  vi.stubGlobal("localStorage", storageQueLanca);
  raizHtml.removeAttribute("data-admin-tema");
  raizHtml.classList.remove("admin-mode");
  errosNaoTratados = [];
  window.addEventListener("error", aoErrar);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  window.removeEventListener("error", aoErrar);
  vi.unstubAllGlobals();
  raizHtml.removeAttribute("data-admin-tema");
  raizHtml.classList.remove("admin-mode");
});

describe("tema do painel com o storage lançando de verdade", () => {
  it("ler o tema guardado devolve Escuro, sem lançar", () => {
    expect(() => lerTemaDoPainel()).not.toThrow();
    expect(lerTemaDoPainel()).toBe("escuro");
  });

  it("entrar no painel liga admin-mode e fica no Escuro (nenhum atributo de tema)", () => {
    function Casca() {
      useTemaDoPainelNaRaiz();
      return <p>painel</p>;
    }
    act(() => raiz.render(<Casca />));

    expect(raizHtml.classList.contains("admin-mode")).toBe(true);
    expect(raizHtml.hasAttribute("data-admin-tema")).toBe(false);
  });

  it("escolher um tema vale na sessão mesmo sem conseguir guardar, e nada estoura", () => {
    act(() => raiz.render(<AparenciaDoPainel />));
    const opcoes = () =>
      Array.from(
        hospedeiro.querySelectorAll<HTMLButtonElement>("[data-tema-opcao]"),
      );

    act(() => opcoes()[2].click());

    expect(errosNaoTratados).toEqual([]);
    expect(raizHtml.dataset.adminTema).toBe("confortavel");
    expect(opcoes().map((o) => o.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
      "true",
    ]);

    // E voltar ao Escuro também tira o atributo, com o storage ainda lançando.
    act(() => opcoes()[0].click());
    expect(errosNaoTratados).toEqual([]);
    expect(raizHtml.hasAttribute("data-admin-tema")).toBe(false);
    expect(opcoes()[0].getAttribute("aria-checked")).toBe("true");
  });
});
