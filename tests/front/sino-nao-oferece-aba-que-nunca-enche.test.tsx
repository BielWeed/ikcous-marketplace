// @vitest-environment jsdom
//
// O sino de notificações mostrava quatro abas — Todas, Pedidos, Ofertas,
// Avisos — mas só uma delas pode receber conteúdo de verdade.
//
// A aba "Pedidos" filtrava por `type === "order" || "delivery"` e "Ofertas"
// por `type === "promotion"`. Nenhum dos três valores existe: o CHECK da
// tabela `notificacoes` (supabase/migrations/20260806000000_baseline_do_
// schema_vivo.sql, `notificacoes_tipo_check`) só aceita 'info', 'warning',
// 'error', 'success', 'sistema', 'pedido_novo', 'estoque_baixo',
// 'pagamento', 'venda', 'aviso', 'sucesso', 'erro' — e o único escritor do
// produto inteiro em `notificacoes` (AdminPushView.tsx) sempre grava
// `tipo: "aviso"`. A cliente que tocava em "Pedidos" ou "Ofertas" lia uma
// promessa ("suas atualizações de entrega vão aparecer aqui") que o banco
// proíbe de cumprir, e ficava esperando para sempre.
//
// O conserto: as duas abas mortas saem. "Todas" e "Avisos" continuam — é a
// única aba que o banco de fato consegue encher.
//
// POR QUE RENDER DE VERDADE (react-dom/client + jsdom), E NÃO grep no
// arquivo fonte: um teste que só varre string continuaria verde se o texto
// morto sobrevivesse em outro lugar da árvore renderizada, fora da barra de
// abas. Medir o texto renderizado pega os dois casos — a aba sumida da
// barra E a frase de "estado vazio" que a acompanhava.
//
// POR QUE useNotificationCenter É MOCADO DIRETO (mesmo padrão de
// searchbar-placeholder-e-checkout.test.tsx): NotificationsView só consome
// o contexto pelo hook, nunca o Provider. Mocar o hook prova o COMPONENTE
// sem arrastar Supabase, BroadcastChannel e localStorage para uma prova que
// é sobre texto e abas.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const aviso = {
  id: "aviso-1",
  title: "Loja em manutenção",
  message: "Voltamos às 9h de amanhã.",
  type: "aviso" as const,
  read: false,
  created_at: new Date().toISOString(),
};

const markAsRead = vi.fn();
const markAllAsRead = vi.fn();
const deleteNotification = vi.fn();

// A lista e reatribuivel para que UM caso possa exercitar o ESTADO VAZIO --
// que e onde mora a frase da aba padrao, a primeira que toda cliente nova le.
let listaDoSino: (typeof aviso)[] = [aviso];

vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({
    notifications: listaDoSino,
    markAsRead,
    markAllAsRead,
    deleteNotification,
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// checkout-view-flag-off.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("NotificationsView — o sino não oferece aba que o banco proíbe encher", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    listaDoSino = [aviso];
    vi.clearAllMocks();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function renderizarSino() {
    const { NotificationsView } = await import(
      "@/views/customer/NotificationsView"
    );
    await act(async () => {
      raiz.render(<NotificationsView onNavigate={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  const botoesDeAba = () =>
    Array.from(hospedeiro.querySelectorAll("button")).filter((b) =>
      ["Todas", "Pedidos", "Ofertas", "Avisos"].includes(
        (b.textContent ?? "").replace(/\d+$/, "").trim(),
      ),
    );

  it("a âncora: a tela renderizou de verdade, com a aba Avisos e o aviso real", async () => {
    await renderizarSino();
    const texto = hospedeiro.textContent ?? "";

    // Sem esta prova as asserções de ausência abaixo passariam com a tela
    // em branco.
    expect(texto).toContain("Loja em manutenção");
    expect(botoesDeAba().some((b) => b.textContent?.startsWith("Avisos"))).toBe(
      true,
    );
  });

  it("não oferece mais a aba Pedidos nem a aba Ofertas", async () => {
    await renderizarSino();

    const rotulos = botoesDeAba().map((b) =>
      (b.textContent ?? "").replace(/\d+$/, "").trim(),
    );
    expect(rotulos).not.toContain("Pedidos");
    expect(rotulos).not.toContain("Ofertas");
    expect(rotulos).toEqual(["Todas", "Avisos"]);
  });

  it("não promete mais rastreamento de pedido nem cupom que nunca chega", async () => {
    await renderizarSino();
    const texto = hospedeiro.textContent ?? "";

    expect(texto).not.toContain(
      "Suas atualizações de entrega, confirmações e status de rastreamento",
    );
    expect(texto).not.toContain(
      "Cupons exclusivos e promoções relâmpago serão enviados",
    );
    expect(texto).not.toContain("Nenhum status de pedido");
    expect(texto).not.toContain("Nenhuma oferta ativa");
  });

  // Achado da revisao: a MESMA promessa que saiu das abas sobreviveu no estado
  // vazio da aba padrao -- "promocoes, cupons e atualizacoes dos seus pedidos".
  // E o lugar mais visivel de todos: a cliente nova, sem nenhuma notificacao,
  // le exatamente isso ao abrir o sino pela primeira vez.
  it("com a caixa vazia, nao promete promocao, cupom nem atualizacao de pedido", async () => {
    listaDoSino = [];

    await renderizarSino();
    const texto = hospedeiro.textContent ?? "";

    expect(texto).toContain("Sua caixa está limpa!");
    expect(texto).not.toContain("promoções");
    expect(texto).not.toContain("cupons");
    expect(texto).not.toContain("atualizações dos seus pedidos");
  });

  it("controle negativo: a aba Avisos continua funcionando — é a única que o banco consegue encher", async () => {
    await renderizarSino();

    const botaoAvisos = botoesDeAba().find((b) =>
      b.textContent?.startsWith("Avisos"),
    );
    expect(botaoAvisos).toBeTruthy();

    await act(async () => {
      botaoAvisos!.click();
    });

    const texto = hospedeiro.textContent ?? "";
    // O aviso continua na lista depois de filtrar por "Avisos" — a aba não
    // ficou vazia, ela é a única que pode ter conteúdo de verdade.
    expect(texto).toContain("Loja em manutenção");
    expect(texto).not.toContain("Sem avisos ou comunicados");
  });
});
