import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TIPO_ABRIR_PEDIDO_DO_AVISO } from "../../src/lib/alvo-do-aviso";
import { marcarOperacaoSensivel } from "../../src/lib/atualizacao/operacao-sensivel";
import { instalarReceptorDoPedidoDoAviso } from "../../src/lib/receptor-do-pedido-do-aviso";

// O Service Worker, ao tocarem no aviso "Pedido novo" com o painel já aberto em
// Pedidos, não recarrega mais a janela (o que apagava a anotação ou o código de
// rastreio digitados): foca e manda esta mensagem. Aqui o APP decide: sem
// trabalho em andamento abre o pedido por dentro; com anotação não salva (a
// ficha registra `marcarOperacaoSensivel("anotacao-do-pedido")`) só avisa e
// deixa a lojista onde está. Em ambos os casos CONFIRMA o recebimento no canal
// que veio junto — sem confirmação o SW volta a recarregar a janela.
describe("receptor do pedido do aviso (app)", () => {
  let servico: EventTarget;
  let desinstalar: (() => void) | undefined;
  const liberar: Array<() => void> = [];

  beforeEach(() => {
    servico = new EventTarget();
    vi.stubGlobal("navigator", { serviceWorker: servico });
  });
  afterEach(() => {
    desinstalar?.();
    desinstalar = undefined;
    for (const f of liberar.splice(0)) f();
    vi.unstubAllGlobals();
  });

  function opcoes() {
    return { abrirPedido: vi.fn(), avisarPedidoNovo: vi.fn() };
  }

  /** Entrega ao app uma mensagem do SW e devolve o que ele respondeu no canal. */
  function receber(data: unknown, comCanal = true) {
    const resposta = vi.fn();
    const evento = Object.assign(new Event("message"), {
      data,
      ports: comCanal ? [{ postMessage: resposta }] : [],
    });
    servico.dispatchEvent(evento);
    return resposta;
  }

  const MENSAGEM = { tipo: TIPO_ABRIR_PEDIDO_DO_AVISO, pedidoId: "B" };

  it("sem trabalho em andamento: abre o pedido do aviso por dentro do app e confirma ao SW", () => {
    const o = opcoes();
    desinstalar = instalarReceptorDoPedidoDoAviso(o);

    const resposta = receber(MENSAGEM);

    expect(o.abrirPedido).toHaveBeenCalledExactlyOnceWith("B");
    expect(o.avisarPedidoNovo).not.toHaveBeenCalled();
    expect(resposta).toHaveBeenCalledOnce();
  });

  it("com anotação ou rastreio digitados e não salvos: NÃO abre o pedido, só avisa, e confirma ao SW (senão ele recarregaria)", () => {
    const o = opcoes();
    desinstalar = instalarReceptorDoPedidoDoAviso(o);
    liberar.push(marcarOperacaoSensivel("anotacao-do-pedido"));

    const resposta = receber(MENSAGEM);

    expect(o.abrirPedido).not.toHaveBeenCalled();
    expect(o.avisarPedidoNovo).toHaveBeenCalledOnce();
    expect(resposta).toHaveBeenCalledOnce();
  });

  it("qualquer gravação em curso segura a troca de pedido, não só a anotação", () => {
    const o = opcoes();
    desinstalar = instalarReceptorDoPedidoDoAviso(o);
    liberar.push(marcarOperacaoSensivel("envio-de-pedido"));

    receber(MENSAGEM);

    expect(o.abrirPedido).not.toHaveBeenCalled();
    expect(o.avisarPedidoNovo).toHaveBeenCalledOnce();
  });

  it("o texto salvo (marca desfeita) libera: o aviso seguinte abre o pedido", () => {
    const o = opcoes();
    desinstalar = instalarReceptorDoPedidoDoAviso(o);
    const desmarcar = marcarOperacaoSensivel("anotacao-do-pedido");
    receber(MENSAGEM);
    desmarcar();

    receber(MENSAGEM);

    expect(o.avisarPedidoNovo).toHaveBeenCalledOnce();
    expect(o.abrirPedido).toHaveBeenCalledExactlyOnceWith("B");
  });

  it("falha ao abrir o pedido (sem trabalho em andamento): NÃO confirma — o SW volta a navegar, como antes", () => {
    const o = opcoes();
    o.abrirPedido.mockImplementation(() => {
      throw new Error("tela quebrou");
    });
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    desinstalar = instalarReceptorDoPedidoDoAviso(o);

    const resposta = receber(MENSAGEM);

    expect(resposta).not.toHaveBeenCalled();
    erro.mockRestore();
  });

  it("o aviso na tela falhando com texto em jogo: ainda confirma (a falha do aviso não pode causar recarga)", () => {
    const o = opcoes();
    o.avisarPedidoNovo.mockImplementation(() => {
      throw new Error("toast quebrou");
    });
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    desinstalar = instalarReceptorDoPedidoDoAviso(o);
    liberar.push(marcarOperacaoSensivel("anotacao-do-pedido"));

    const resposta = receber(MENSAGEM);

    expect(o.abrirPedido).not.toHaveBeenCalled();
    expect(resposta).toHaveBeenCalledOnce();
    erro.mockRestore();
  });

  it("mensagem sem canal de resposta: age do mesmo jeito e não quebra", () => {
    const o = opcoes();
    desinstalar = instalarReceptorDoPedidoDoAviso(o);

    expect(() => receber(MENSAGEM, false)).not.toThrow();
    expect(o.abrirPedido).toHaveBeenCalledExactlyOnceWith("B");
  });

  it.each([
    ["pulso do service worker (texto)", "HEARTBEAT_ACK"],
    ["nada", undefined],
    ["null", null],
    ["objeto sem tipo", { pedidoId: "B" }],
    ["tipo de outra mensagem", { tipo: "outra-coisa", pedidoId: "B" }],
    ["tipo certo sem pedido", { tipo: TIPO_ABRIR_PEDIDO_DO_AVISO }],
    [
      "tipo certo com pedido vazio",
      { tipo: TIPO_ABRIR_PEDIDO_DO_AVISO, pedidoId: "" },
    ],
    [
      "tipo certo com pedido que não é texto",
      { tipo: TIPO_ABRIR_PEDIDO_DO_AVISO, pedidoId: 7 },
    ],
  ])(
    "mensagem desconhecida (%s): ignorada, sem erro, sem agir e sem confirmar",
    (_nome, data) => {
      const o = opcoes();
      desinstalar = instalarReceptorDoPedidoDoAviso(o);

      let resposta: ReturnType<typeof vi.fn> | undefined;
      expect(() => {
        resposta = receber(data);
      }).not.toThrow();

      expect(o.abrirPedido).not.toHaveBeenCalled();
      expect(o.avisarPedidoNovo).not.toHaveBeenCalled();
      expect(resposta).not.toHaveBeenCalled();
    },
  );

  it("desinstalar remove o ouvinte", () => {
    const o = opcoes();
    const parar = instalarReceptorDoPedidoDoAviso(o);
    parar();

    receber(MENSAGEM);

    expect(o.abrirPedido).not.toHaveBeenCalled();
  });

  it("App.tsx liga o receptor só com o painel liberado e abre o pedido pelo roteador do painel (sem o receptor ligado o SW recarregaria a janela)", () => {
    const fonte = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../src/App.tsx"),
      "utf8",
    );
    const trecho = fonte.slice(
      fonte.indexOf("instalarReceptorDoPedidoDoAviso({"),
    );
    expect(fonte).toContain(
      'import { instalarReceptorDoPedidoDoAviso } from "@/lib/receptor-do-pedido-do-aviso";',
    );
    expect(fonte).toMatch(
      /if \(!isAdmin\) return;\s*return instalarReceptorDoPedidoDoAviso\(\{/,
    );
    expect(trecho).toContain('handleNavigate("admin-orders", pedidoId)');
    expect(trecho).toContain("Chegou um pedido novo");
  });

  it("navegador sem service worker: instala sem erro e a função de parar é inofensiva", () => {
    vi.stubGlobal("navigator", {});
    const o = opcoes();

    const parar = instalarReceptorDoPedidoDoAviso(o);

    expect(() => parar()).not.toThrow();
  });
});
