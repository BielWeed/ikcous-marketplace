import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TIPO_ABRIR_PEDIDO_DO_AVISO } from "../../src/lib/alvo-do-aviso";
import { marcarOperacaoSensivel } from "../../src/lib/atualizacao/operacao-sensivel";
import {
  haRecargaPendente,
  limparRecargaPendente,
} from "../../src/lib/atualizacao/recarga-pendente";
import { TIPO_LOJA_FECHADA } from "../../src/lib/aviso-da-loja-fechada";
import { instalarReceptorDaLojaFechada } from "../../src/lib/receptor-da-loja-fechada";

// O Service Worker viu o porteiro dizer que a loja está fora do ar
// (`adormecida`/`encerrada`), apagou as páginas guardadas e manda esta
// mensagem a cada aba. Aqui a ABA recarrega — e a recarga mostra a página da
// loja fechada no lugar da vitrine que continuava vendendo. Com gravação em
// curso (pagamento, envio de pedido) a recarga NÃO interrompe: fica pendente
// para o próximo ponto seguro, pela mesma regra de toda recarga do app.
describe("receptor da loja fechada (app)", () => {
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
    limparRecargaPendente();
    vi.unstubAllGlobals();
  });

  function receber(data: unknown) {
    servico.dispatchEvent(Object.assign(new Event("message"), { data }));
  }

  it("mensagem da loja fechada, sem nada em andamento: recarrega a aba uma vez", () => {
    const recarregar = vi.fn();
    desinstalar = instalarReceptorDaLojaFechada(recarregar);

    receber({ tipo: TIPO_LOJA_FECHADA });

    expect(recarregar).toHaveBeenCalledOnce();
    expect(haRecargaPendente()).toBe(false);
  });

  it("com gravação em curso: não recarrega agora, deixa a recarga pendente para o ponto seguro", () => {
    const recarregar = vi.fn();
    desinstalar = instalarReceptorDaLojaFechada(recarregar);
    liberar.push(marcarOperacaoSensivel("envio-de-pedido"));

    receber({ tipo: TIPO_LOJA_FECHADA });

    expect(recarregar).not.toHaveBeenCalled();
    expect(haRecargaPendente()).toBe(true);
  });

  it.each([
    ["o pulso do SW", "HEARTBEAT_ACK"],
    ["o aviso de pedido", { tipo: TIPO_ABRIR_PEDIDO_DO_AVISO, pedidoId: "B" }],
    ["mensagem vazia", null],
    ["tipo parecido", { tipo: `${TIPO_LOJA_FECHADA}-x` }],
  ])("ignora outra mensagem (%s)", (_nome, data) => {
    const recarregar = vi.fn();
    desinstalar = instalarReceptorDaLojaFechada(recarregar);

    receber(data);

    expect(recarregar).not.toHaveBeenCalled();
    expect(haRecargaPendente()).toBe(false);
  });

  it("depois de desinstalado, não recarrega mais", () => {
    const recarregar = vi.fn();
    instalarReceptorDaLojaFechada(recarregar)();

    receber({ tipo: TIPO_LOJA_FECHADA });

    expect(recarregar).not.toHaveBeenCalled();
  });

  it("navegador sem service worker: instala sem erro e não faz nada", () => {
    vi.stubGlobal("navigator", {});
    const recarregar = vi.fn();

    expect(() => instalarReceptorDaLojaFechada(recarregar)()).not.toThrow();
  });
});
