import type { Order } from "@/types";
// @vitest-environment jsdom
//
// Defeito (O3 da revisão da tela Pedidos): "O produto voltou", na lista de
// pedidos cancelados depois de enviados, devolvia o estoque com UM toque,
// sem perguntar e sem volta. Era o único botão de estoque ou dinheiro do
// painel sem confirmação (Desfazer recebimento, Já estornei, Cancelar
// pedido: todos perguntam). Um toque sem querer no celular, com a lista
// rolando, contava como mercadoria de volta no estoque que não voltou, e a
// loja passava a vender o que não tem.
//
// O botão agora abre uma pergunta que diz o que acontece ("O estoque será
// devolvido"), com "Voltar" em foco (a ação padrão é não fazer nada). A
// chamada que mexe no estoque só sai no botão de confirmar.
//
// Cuidado de montagem: a lista de avisos é um painel que se fecha num toque
// FORA dele (`pointerdown`) e no Escape. A pergunta mora num portal, ou seja,
// fora do painel para o DOM: sem tratamento, o primeiro toque dentro da
// pergunta fecharia o painel por baixo, e o Escape fecharia painel e pergunta
// juntos. Os testes de "toque dentro da pergunta" e "Escape" travam isso.
import { AlertasCancelados } from "@/views/admin/AlertasCancelados";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const pedidoEnviado = (id: string, cliente: string, total: number) =>
  ({
    id,
    total,
    customer: { name: cliente },
    status: "cancelled",
    cancelledAfterShipping: true,
    returnedToSellerAt: null,
  }) as unknown as Order;

const PEDIDO_A = pedidoEnviado(
  "aaaaaaaa-0000-0000-0000-00000000a1b2",
  "Maria",
  80,
);
const PEDIDO_B = pedidoEnviado(
  "bbbbbbbb-0000-0000-0000-00000000c3d4",
  "João",
  45,
);

describe("'O produto voltou' pede confirmação antes de devolver o estoque", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;
  const aoConfirmar = vi.fn();

  beforeEach(() => {
    aoConfirmar.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function montar(
    pedidos: Order[],
    confirmandoRetornoId: string | null = null,
  ) {
    await act(async () => {
      raiz.render(
        <AlertasCancelados
          pagoCanceladoCount={0}
          avisoPagoAposCancelado=""
          pedidosEsperandoRetorno={pedidos}
          pedidosParaDevolverAgora={[]}
          estornosEmCurso={new Map()}
          incompleto={false}
          confirmandoRetornoId={confirmandoRetornoId}
          onConfirmarRetorno={aoConfirmar}
          estornandoId={null}
          onRegistrarEstorno={vi.fn()}
          onVerPedidos={vi.fn()}
        />,
      );
    });
    await clicar(
      hospedeiro.querySelector<HTMLElement>(
        '[data-testid="alertas-cancelados-alavanca"]',
      ),
    );
  }

  async function clicar(el: HTMLElement | null | undefined) {
    expect(el, "elemento ausente").toBeTruthy();
    await act(async () => {
      el!.click();
    });
  }

  const botao = (raizDaBusca: ParentNode, texto: string) =>
    Array.from(raizDaBusca.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === texto,
    );
  const botoesProdutoVoltou = () =>
    Array.from(hospedeiro.querySelectorAll("button")).filter(
      (b) => b.textContent?.trim() === "O produto voltou",
    );
  const pergunta = () => document.querySelector('[role="alertdialog"]');

  it("um toque só abre a pergunta: o estoque NÃO é devolvido", async () => {
    await montar([PEDIDO_A]);

    await clicar(botoesProdutoVoltou()[0]);

    expect(aoConfirmar).not.toHaveBeenCalled();
    expect(pergunta()).not.toBeNull();
    const texto = pergunta()!.textContent ?? "";
    expect(texto).toContain("O estoque será devolvido");
    // A pergunta diz de qual pedido fala (o mesmo número da lista).
    expect(texto).toContain("#00A1B2");
  });

  it("a ação padrão é 'Voltar' (foco), e 'Voltar' não devolve nada", async () => {
    await montar([PEDIDO_A]);
    await clicar(botoesProdutoVoltou()[0]);

    const voltar = botao(document.body, "Voltar");
    expect(voltar).toBeTruthy();
    expect(document.activeElement).toBe(voltar);

    await clicar(voltar);
    expect(pergunta()).toBeNull();
    expect(aoConfirmar).not.toHaveBeenCalled();
  });

  it("confirmar devolve UMA vez, para o pedido tocado, e fecha a pergunta", async () => {
    await montar([PEDIDO_A]);
    await clicar(botoesProdutoVoltou()[0]);
    await clicar(botao(document.body, "Sim, o produto voltou"));

    expect(aoConfirmar).toHaveBeenCalledTimes(1);
    expect(aoConfirmar).toHaveBeenCalledWith(PEDIDO_A.id);
    expect(pergunta()).toBeNull();
  });

  it("com dois pedidos na lista, a confirmação vale para o que foi tocado, não para o outro", async () => {
    await montar([PEDIDO_A, PEDIDO_B]);
    const [, segundo] = botoesProdutoVoltou();
    await clicar(segundo);

    expect(pergunta()!.textContent).toContain("#00C3D4");
    await clicar(botao(document.body, "Sim, o produto voltou"));

    expect(aoConfirmar).toHaveBeenCalledTimes(1);
    expect(aoConfirmar).toHaveBeenCalledWith(PEDIDO_B.id);
  });

  it("o toque DENTRO da pergunta não fecha a lista por baixo, e a confirmação ainda vale", async () => {
    await montar([PEDIDO_A]);
    await clicar(botoesProdutoVoltou()[0]);

    // Como no dedo: o `pointerdown` vem antes do `click`, e cai fora do painel
    // (a pergunta mora num portal).
    const confirmar = botao(document.body, "Sim, o produto voltou");
    await act(async () => {
      confirmar!.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true }),
      );
    });
    // A lista continua aberta atrás da pergunta: dá para ver o pedido "Confirmando…".
    expect(botoesProdutoVoltou()).toHaveLength(1);

    await clicar(confirmar);
    expect(aoConfirmar).toHaveBeenCalledTimes(1);
    expect(aoConfirmar).toHaveBeenCalledWith(PEDIDO_A.id);
  });

  it("Escape fecha só a pergunta: nada é devolvido e a lista continua aberta", async () => {
    await montar([PEDIDO_A]);
    await clicar(botoesProdutoVoltou()[0]);
    expect(pergunta()).not.toBeNull();

    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(pergunta()).toBeNull();
    expect(aoConfirmar).not.toHaveBeenCalled();
    expect(botoesProdutoVoltou()).toHaveLength(1);
  });

  it("enquanto o retorno deste pedido está sendo confirmado, o botão fica desligado e não abre outra pergunta", async () => {
    await montar([PEDIDO_A], PEDIDO_A.id);

    const desligado = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Confirmando...",
    );
    expect(desligado).toBeTruthy();
    expect(desligado!.disabled).toBe(true);
    await clicar(desligado);
    expect(pergunta()).toBeNull();
    expect(aoConfirmar).not.toHaveBeenCalled();
  });

  it("depois de 'Voltar' (e de Escape), o foco volta ao botão da linha, não ao body", async () => {
    await montar([PEDIDO_A, PEDIDO_B]);
    const [, segundo] = botoesProdutoVoltou();
    await clicar(segundo);

    await clicar(botao(document.body, "Voltar"));
    expect(pergunta()).toBeNull();
    // O Radix devolve o foco num timer: espera ele, sem sleep fixo.
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(botoesProdutoVoltou()[1]),
    );

    // Mesmo caminho pelo teclado.
    await clicar(botoesProdutoVoltou()[0]);
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(pergunta()).toBeNull();
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(botoesProdutoVoltou()[0]),
    );
  });
});
