import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TIPO_ABRIR_PEDIDO_DO_AVISO } from "../../src/lib/alvo-do-aviso";
import { marcarOperacaoSensivel } from "../../src/lib/atualizacao/operacao-sensivel";
import {
  avisoNaTelaDoPedido,
  instalarReceptorDoPedidoDoAviso,
} from "../../src/lib/receptor-do-pedido-do-aviso";

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
    return { abrirPedido: vi.fn(), avisarSemTrocarDeTela: vi.fn() };
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
    expect(o.avisarSemTrocarDeTela).not.toHaveBeenCalled();
    expect(resposta).toHaveBeenCalledOnce();
  });

  it("com anotação ou rastreio digitados e não salvos: NÃO abre o pedido, só avisa, e confirma ao SW (senão ele recarregaria)", () => {
    const o = opcoes();
    desinstalar = instalarReceptorDoPedidoDoAviso(o);
    liberar.push(marcarOperacaoSensivel("anotacao-do-pedido"));

    const resposta = receber(MENSAGEM);

    expect(o.abrirPedido).not.toHaveBeenCalled();
    expect(o.avisarSemTrocarDeTela).toHaveBeenCalledOnce();
    expect(resposta).toHaveBeenCalledOnce();
  });

  it("qualquer gravação em curso segura a troca de pedido, não só a anotação", () => {
    const o = opcoes();
    desinstalar = instalarReceptorDoPedidoDoAviso(o);
    liberar.push(marcarOperacaoSensivel("envio-de-pedido"));

    receber(MENSAGEM);

    expect(o.abrirPedido).not.toHaveBeenCalled();
    expect(o.avisarSemTrocarDeTela).toHaveBeenCalledOnce();
  });

  it("o texto salvo (marca desfeita) libera: o aviso seguinte abre o pedido", () => {
    const o = opcoes();
    desinstalar = instalarReceptorDoPedidoDoAviso(o);
    const desmarcar = marcarOperacaoSensivel("anotacao-do-pedido");
    receber(MENSAGEM);
    desmarcar();

    receber(MENSAGEM);

    expect(o.avisarSemTrocarDeTela).toHaveBeenCalledOnce();
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
    o.avisarSemTrocarDeTela.mockImplementation(() => {
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
      expect(o.avisarSemTrocarDeTela).not.toHaveBeenCalled();
      expect(resposta).not.toHaveBeenCalled();
    },
  );

  // O toque pode ser de QUALQUER aviso que aponta para /admin-orders?id=X
  // (contestação, cobrança duplicada, cliente cancelou, pedido pago). O push já
  // saiu da bandeja: o que ele dizia tem de chegar à tela, com o pedido certo.
  describe("com trabalho em andamento: o aviso na tela é o do push, do pedido certo", () => {
    const CONTESTACAO = {
      tipo: TIPO_ABRIR_PEDIDO_DO_AVISO,
      pedidoId: "aaaaaaaa-0000-0000-0000-00000000c0de",
      titulo: "Contestação de pagamento para conferir",
      corpo: "00C0DE · confira no painel do Mercado Pago",
    };

    it("repassa o título e o corpo que o SW leu da notificação, e o pedido do aviso", () => {
      const o = opcoes();
      desinstalar = instalarReceptorDoPedidoDoAviso(o);
      liberar.push(marcarOperacaoSensivel("anotacao-do-pedido"));

      receber(CONTESTACAO);

      expect(o.avisarSemTrocarDeTela).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          pedidoId: CONTESTACAO.pedidoId,
          titulo: CONTESTACAO.titulo,
          corpo: CONTESTACAO.corpo,
        }),
      );
    });

    it("SW de antes (mensagem sem título nem corpo): chega `null`, nunca texto inventado", () => {
      const o = opcoes();
      desinstalar = instalarReceptorDoPedidoDoAviso(o);
      liberar.push(marcarOperacaoSensivel("anotacao-do-pedido"));

      receber({ ...MENSAGEM, titulo: 7, corpo: "   " });

      expect(o.avisarSemTrocarDeTela).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ pedidoId: "B", titulo: null, corpo: null }),
      );
    });

    it("`abrir` respeita a MESMA guarda: com o texto ainda por salvar não troca de pedido", () => {
      const o = opcoes();
      desinstalar = instalarReceptorDoPedidoDoAviso(o);
      const desmarcar = marcarOperacaoSensivel("anotacao-do-pedido");
      liberar.push(desmarcar);
      receber(CONTESTACAO);
      const aviso = o.avisarSemTrocarDeTela.mock.calls[0][0];

      expect(aviso.abrir()).toBe(false);
      expect(o.abrirPedido).not.toHaveBeenCalled();

      desmarcar();

      expect(aviso.abrir()).toBe(true);
      expect(o.abrirPedido).toHaveBeenCalledExactlyOnceWith(
        CONTESTACAO.pedidoId,
      );
    });
  });

  describe("avisoNaTelaDoPedido (o texto do aviso na tela)", () => {
    const ID = "aaaaaaaa-0000-0000-0000-00000000c0de";

    it("usa o título e o corpo do push e oferece abrir o pedido pelo número", () => {
      expect(
        avisoNaTelaDoPedido({
          pedidoId: ID,
          titulo: "Cliente cancelou o pedido",
          corpo: "00C0DE · R$ 10,00",
        }),
      ).toMatchObject({
        titulo: "Cliente cancelou o pedido",
        descricao: "00C0DE · R$ 10,00",
        rotuloDaAcao: "Abrir pedido #00C0DE",
      });
    });

    it("sem título nem corpo (SW de antes): diz que é aviso DESTE pedido, sem fingir que é pedido novo", () => {
      const aviso = avisoNaTelaDoPedido({
        pedidoId: ID,
        titulo: null,
        corpo: null,
      });
      expect(aviso.titulo).toBe("Aviso do pedido #00C0DE");
      expect(aviso.titulo).not.toMatch(/novo/i);
      expect(aviso.descricao).toContain("#00C0DE");
    });

    it("o id do aviso na tela é por pedido: dois avisos seguidos não se apagam", () => {
      const a = avisoNaTelaDoPedido({
        pedidoId: "p-1",
        titulo: null,
        corpo: null,
      });
      const b = avisoNaTelaDoPedido({
        pedidoId: "p-2",
        titulo: null,
        corpo: null,
      });
      expect(a.id).not.toBe(b.id);
      expect(
        avisoNaTelaDoPedido({ pedidoId: "p-1", titulo: "x", corpo: "y" }).id,
      ).toBe(a.id);
    });

    it("tem o texto para quando a lojista toca em abrir com o trabalho ainda por salvar", () => {
      expect(
        avisoNaTelaDoPedido({ pedidoId: ID, titulo: null, corpo: null })
          .aindaOcupado,
      ).toContain("#00C0DE");
    });
  });

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
    expect(fonte).toMatch(
      /import \{[^}]*instalarReceptorDoPedidoDoAviso[^}]*\} from "@\/lib\/receptor-do-pedido-do-aviso";/,
    );
    expect(fonte).toMatch(
      /if \(!isAdmin\) return;\s*return instalarReceptorDoPedidoDoAviso\(\{/,
    );
    expect(trecho).toContain('handleNavigate("admin-orders", pedidoId)');
    // O aviso na tela repete o push (título/corpo) e oferece abrir o pedido —
    // o texto fixo "Chegou um pedido novo" mentia para contestação, cliente
    // que cancelou, pedido pago.
    expect(trecho).not.toContain("Chegou um pedido novo");
    expect(trecho).toContain(
      "avisarSemTrocarDeTela: mostrarAvisoDoPedidoNaTela",
    );
  });

  it("navegador sem service worker: instala sem erro e a função de parar é inofensiva", () => {
    vi.stubGlobal("navigator", {});
    const o = opcoes();

    const parar = instalarReceptorDoPedidoDoAviso(o);

    expect(() => parar()).not.toThrow();
  });
});
