// @vitest-environment jsdom
// Mesmo padrão dos testes vizinhos: createRoot + act, sem dependência nova.
// O armazenamento é real: os cliques precisam persistir a leitura e redesenhar.
import * as armazenamento from "@/lib/novidades/armazenamento-local";
import type { Novidade } from "@/lib/novidades/armazenamento-local";
import type { Aviso } from "@/utils/avisos-do-lojista";
import { AdminNotificationsView } from "@/views/admin/AdminNotificationsView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let avisos: Aviso[] = [];

vi.mock("@/hooks/useAvisosDoLojista", () => ({
  useAvisosDoLojista: () => ({
    avisos,
    quantidadeNoCracha: avisos.filter((aviso) => aviso.contaNoCracha).length,
    carregando: false,
    fontesComFalha: [],
    recarregar: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE = "notificacoes-novidades-do-app-v1";
const NOVA: Novidade = {
  versao: "1.5.32",
  titulo: "Mais facilidade no dia a dia",
  registradaEm: "2026-10-16T12:00:00.000Z",
  lida: false,
  novidades: ["Veja o que mudou no app."],
  correcoes: ["Os avisos voltaram a aparecer."],
  melhorias: ["Os pedidos abrem mais rápido."],
};
const ANTIGA: Novidade = {
  versao: "1.5.31",
  titulo: "Pedidos mais claros",
  registradaEm: "2026-10-15T12:00:00.000Z",
  lida: true,
  novidades: [],
  correcoes: ["A lista de pedidos foi corrigida."],
  melhorias: [],
};
const PEDIDO: Aviso = {
  id: "pedido-ped-1",
  tipo: "pedido",
  titulo: "Pedido esperando você",
  detalhe: "R$ 90,00",
  quando: "2026-10-16T10:00:00.000Z",
  destino: { view: "admin-orders", id: "ped-1" },
  contaNoCracha: true,
};
const ESTOQUE: Aviso = {
  id: "estoque-prod-1",
  tipo: "estoque",
  titulo: "Caneta está acabando",
  detalhe: "Resta 1 unidade",
  quando: "",
  destino: { view: "admin-product-form", id: "prod-1" },
  contaNoCracha: false,
};

let raiz: Root;
let hospedeiro: HTMLDivElement;
const onNavigate = vi.fn();

function guardar(novidades: readonly Novidade[]) {
  localStorage.setItem(CHAVE, JSON.stringify(novidades));
}

async function montar() {
  await act(async () => {
    raiz.render(<AdminNotificationsView onNavigate={onNavigate} />);
  });
}

function botaoComTexto(texto: string): HTMLButtonElement {
  const botao = Array.from(hospedeiro.querySelectorAll("button")).find(
    (elemento) => elemento.textContent?.includes(texto),
  );
  if (!botao) throw new Error(`Botão ausente: ${texto}`);
  return botao;
}

function conteudoDoBotao(botao: HTMLButtonElement): HTMLElement {
  const id = botao.getAttribute("aria-controls");
  const conteudo = id ? document.getElementById(id) : null;
  if (!conteudo) throw new Error("Conteúdo da novidade ausente");
  return conteudo;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  avisos = [PEDIDO, ESTOQUE];
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("Novidades do app na central do lojista", () => {
  it("omite a seção inteira quando não há histórico no aparelho", async () => {
    await montar();

    expect(hospedeiro.textContent).not.toContain("Novidades do app");
    expect(hospedeiro.querySelector("section[aria-labelledby]")).toBeNull();
  });

  it("mostra título, versão, data e os grupos com marcadores", async () => {
    guardar([NOVA]);
    await montar();

    const botao = botaoComTexto("Mais facilidade no dia a dia");
    expect(botao.textContent).toContain("Versão 1.5.32");
    expect(botao.textContent).toContain("16/10/2026");
    const conteudo = conteudoDoBotao(botao);
    expect(conteudo.hidden).toBe(false);
    expect(
      Array.from(conteudo.querySelectorAll("h4")).map((no) => no.textContent),
    ).toEqual(["Novidades", "Correções", "Melhorias"]);
    expect(
      Array.from(conteudo.querySelectorAll("ul li")).map(
        (no) => no.textContent,
      ),
    ).toEqual([
      "Veja o que mudou no app.",
      "Os avisos voltaram a aparecer.",
      "Os pedidos abrem mais rápido.",
    ]);
  });

  it("omite os grupos vazios sem esconder o grupo preenchido", async () => {
    guardar([{ ...ANTIGA, lida: false }]);
    await montar();

    const conteudo = conteudoDoBotao(botaoComTexto("Pedidos mais claros"));
    expect(
      Array.from(conteudo.querySelectorAll("h4")).map((no) => no.textContent),
    ).toEqual(["Correções"]);
    expect(conteudo.querySelectorAll("ul")).toHaveLength(1);
    expect(conteudo.textContent).toContain("A lista de pedidos foi corrigida.");
  });

  it("inicia não lida aberta e lida recolhida, sem ler sozinha", async () => {
    guardar([NOVA, ANTIGA]);
    const marcar = vi.spyOn(armazenamento, "marcarNovidadeComoLida");
    await montar();

    const nova = botaoComTexto("Mais facilidade no dia a dia");
    const antiga = botaoComTexto("Pedidos mais claros");
    expect(nova.getAttribute("aria-expanded")).toBe("true");
    expect(conteudoDoBotao(nova).hidden).toBe(false);
    expect(nova.textContent).toContain("Não lida");
    expect(antiga.getAttribute("aria-expanded")).toBe("false");
    expect(conteudoDoBotao(antiga).hidden).toBe(true);
    expect(antiga.textContent).not.toContain("Não lida");
    expect(marcar).not.toHaveBeenCalled();
    expect(armazenamento.listarNovidades()[0]?.lida).toBe(false);
  });

  it("abrir uma não lida marca só aquela versão e mantém aberta", async () => {
    guardar([NOVA, { ...ANTIGA, lida: false }]);
    const marcar = vi.spyOn(armazenamento, "marcarNovidadeComoLida");
    await montar();
    const botao = botaoComTexto("Mais facilidade no dia a dia");

    act(() => botao.click());
    expect(botao.getAttribute("aria-expanded")).toBe("false");
    expect(armazenamento.listarNovidades()[0]?.lida).toBe(false);
    act(() => botao.click());

    expect(marcar).toHaveBeenCalledExactlyOnceWith("1.5.32");
    expect(armazenamento.listarNovidades().map((item) => item.lida)).toEqual([
      true,
      false,
    ]);
    expect(botao.getAttribute("aria-expanded")).toBe("true");
    expect(conteudoDoBotao(botao).hidden).toBe(false);
    expect(botao.textContent).not.toContain("Não lida");
  });

  it("permite marcar a entrada já aberta como lida sem recolher", async () => {
    guardar([NOVA]);
    const marcar = vi.spyOn(armazenamento, "marcarNovidadeComoLida");
    await montar();

    act(() => botaoComTexto("Marcar como lida").click());

    expect(marcar).toHaveBeenCalledExactlyOnceWith("1.5.32");
    expect(armazenamento.listarNovidades()[0]?.lida).toBe(true);
    const botao = botaoComTexto("Mais facilidade no dia a dia");
    expect(botao.getAttribute("aria-expanded")).toBe("true");
    expect(botao.textContent).not.toContain("Não lida");
  });

  it("reabre e recolhe uma lida sem chamar a API de leitura", async () => {
    guardar([ANTIGA]);
    const marcar = vi.spyOn(armazenamento, "marcarNovidadeComoLida");
    await montar();
    const botao = botaoComTexto("Pedidos mais claros");

    act(() => botao.click());
    expect(botao.getAttribute("aria-expanded")).toBe("true");
    expect(conteudoDoBotao(botao).hidden).toBe(false);
    act(() => botao.click());
    expect(conteudoDoBotao(botao).hidden).toBe(true);
    expect(marcar).not.toHaveBeenCalled();
  });

  it("marca todas, retira os indicadores e preserva o histórico", async () => {
    guardar([NOVA, { ...ANTIGA, lida: false }]);
    const marcarTodas = vi.spyOn(armazenamento, "marcarTodasComoLidas");
    await montar();

    act(() => botaoComTexto("Marcar tudo como lido").click());

    expect(marcarTodas).toHaveBeenCalledTimes(1);
    expect(armazenamento.listarNovidades().map((item) => item.lida)).toEqual([
      true,
      true,
    ]);
    expect(hospedeiro.textContent).not.toContain("Não lida");
    expect(hospedeiro.textContent).not.toContain("Marcar tudo como lido");
    expect(hospedeiro.textContent).toContain("Mais facilidade no dia a dia");
    expect(hospedeiro.textContent).toContain("Pedidos mais claros");

    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    await montar();
    expect(
      botaoComTexto("Mais facilidade no dia a dia").getAttribute(
        "aria-expanded",
      ),
    ).toBe("false");
  });

  it("não oferece marcar tudo quando só há entradas lidas", async () => {
    guardar([ANTIGA]);
    await montar();

    expect(hospedeiro.textContent).toContain("Novidades do app");
    expect(hospedeiro.textContent).not.toContain("Marcar tudo como lido");
  });

  it.each([false, true])(
    "mantém os avisos, seus blocos e destinos com novidades = %s",
    async (comNovidades) => {
      if (comNovidades) guardar([NOVA]);
      await montar();

      const precisa = hospedeiro.querySelector(
        '[data-bloco="precisa-de-voce"]',
      );
      const deOlho = hospedeiro.querySelector('[data-bloco="de-olho"]');
      expect(precisa?.querySelectorAll("[data-aviso]")).toHaveLength(1);
      expect(deOlho?.querySelectorAll("[data-aviso]")).toHaveLength(1);
      expect(precisa?.textContent).toContain("1 item");
      expect(deOlho?.textContent).toContain("não conta no sino");
      expect(botaoComTexto("Pedido esperando você").textContent).toContain(
        "R$ 90,00",
      );
      expect(botaoComTexto("Caneta está acabando").textContent).toContain(
        "Resta 1 unidade",
      );

      act(() => botaoComTexto("Pedido esperando você").click());
      act(() => botaoComTexto("Caneta está acabando").click());
      expect(onNavigate.mock.calls).toEqual([
        ["admin-orders", "ped-1"],
        ["admin-product-form", "prod-1"],
      ]);
    },
  );

  it("fica antes dos avisos, com seção e botões acessíveis", async () => {
    guardar([NOVA]);
    await montar();

    const secao = hospedeiro.querySelector("section[aria-labelledby]");
    if (!secao) throw new Error("Seção de novidades ausente");
    const tituloId = secao.getAttribute("aria-labelledby");
    expect(tituloId && document.getElementById(tituloId)?.textContent).toBe(
      "Novidades do app",
    );
    const secoes = Array.from(hospedeiro.querySelectorAll("section"));
    expect(secoes[0]).toBe(secao);
    for (const botao of secao.querySelectorAll("button")) {
      expect(botao.type).toBe("button");
      expect(botao.classList.contains("min-h-11")).toBe(true);
      expect(botao.className).toContain("focus-visible:ring-2");
    }
  });

  it("não altera o retrato compartilhado nem as listas de texto", async () => {
    guardar([ANTIGA, NOVA]);
    const retrato = armazenamento.listarNovidades();
    const antes = JSON.stringify(retrato);
    for (const entrada of retrato) {
      Object.freeze(entrada.novidades);
      Object.freeze(entrada.correcoes);
      Object.freeze(entrada.melhorias);
      Object.freeze(entrada);
    }
    Object.freeze(retrato);

    await montar();

    expect(JSON.stringify(retrato)).toBe(antes);
    expect(armazenamento.listarNovidades()).toBe(retrato);
    const versoes = Array.from(
      hospedeiro.querySelectorAll("button[aria-expanded]"),
    ).map((botao) => botao.textContent?.match(/Versão (\d+\.\d+\.\d+)/)?.[1]);
    expect(versoes).toEqual(["1.5.32", "1.5.31"]);
  });
});
