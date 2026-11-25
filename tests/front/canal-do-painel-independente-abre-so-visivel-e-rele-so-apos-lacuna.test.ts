// @vitest-environment jsdom
//
// As duas peças do canal de tempo real que uma tela do painel abre por conta
// própria (`src/lib/canal-do-painel-independente.ts`). Nenhum teste as citava
// diretamente (só os hooks, por trás de dublês). Aqui se prendem as bordas:
//
//  - `assinarEnquantoVisivel`: abre só com a aba visível; esconder fecha;
//    voltar reabre com `reabertura = true`; evento repetido não abre duas
//    vezes nem fecha duas vezes; o cleanup fecha o aberto e solta o ouvinte.
//  - `aoMudarOStatusDoCanalDoPainel`: relê UMA vez depois de uma lacuna sem
//    escuta (queda do canal ou aba que volta), nunca na primeira confirmação
//    comum e nunca duas vezes seguidas sem queda no meio.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  aoMudarOStatusDoCanalDoPainel,
  assinarEnquantoVisivel,
} from "@/lib/canal-do-painel-independente";

// O  de um teste só é desfeito depois do
// afterEach: guarda o documento real para os ganchos não dependerem do global.
const documentoReal = document;
let visibilidade: DocumentVisibilityState = "visible";

function mudarVisibilidade(estado: DocumentVisibilityState) {
  visibilidade = estado;
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  visibilidade = "visible";
  Object.defineProperty(documentoReal, "visibilityState", {
    configurable: true,
    get: () => visibilidade,
  });
});

afterEach(() => {
  // Devolve a propriedade nativa do protótipo para os outros testes do arquivo.
  Reflect.deleteProperty(documentoReal, "visibilityState");
});

function abridorComEspiao() {
  const fechamentos: Array<ReturnType<typeof vi.fn>> = [];
  const abrir = vi.fn((_reabertura: boolean) => {
    const fechar = vi.fn();
    fechamentos.push(fechar);
    return fechar;
  });
  return { abrir, fechamentos };
}

describe("assinarEnquantoVisivel", () => {
  it("com a aba visível abre na hora, uma vez, e avisa que não é reabertura", () => {
    const { abrir } = abridorComEspiao();
    const limpar = assinarEnquantoVisivel(abrir);
    expect(abrir).toHaveBeenCalledTimes(1);
    expect(abrir).toHaveBeenLastCalledWith(false);
    limpar();
  });

  it("com a aba escondida não abre; ao aparecer abre como REABERTURA", () => {
    visibilidade = "hidden";
    const { abrir } = abridorComEspiao();
    const limpar = assinarEnquantoVisivel(abrir);
    expect(abrir).not.toHaveBeenCalled();

    mudarVisibilidade("visible");
    expect(abrir).toHaveBeenCalledTimes(1);
    expect(abrir).toHaveBeenLastCalledWith(true);
    limpar();
  });

  it("esconder a aba fecha o canal aberto; voltar abre outro como reabertura", () => {
    const { abrir, fechamentos } = abridorComEspiao();
    const limpar = assinarEnquantoVisivel(abrir);

    mudarVisibilidade("hidden");
    expect(fechamentos[0]).toHaveBeenCalledTimes(1);

    mudarVisibilidade("visible");
    expect(abrir).toHaveBeenCalledTimes(2);
    expect(abrir).toHaveBeenLastCalledWith(true);
    limpar();
    expect(fechamentos[1]).toHaveBeenCalledTimes(1);
  });

  it("visibilitychange repetido com a aba visível não abre um segundo canal", () => {
    const { abrir } = abridorComEspiao();
    const limpar = assinarEnquantoVisivel(abrir);

    mudarVisibilidade("visible");
    mudarVisibilidade("visible");

    expect(abrir).toHaveBeenCalledTimes(1);
    limpar();
  });

  it("esconder duas vezes seguidas fecha o canal só uma vez", () => {
    const { abrir, fechamentos } = abridorComEspiao();
    const limpar = assinarEnquantoVisivel(abrir);

    mudarVisibilidade("hidden");
    mudarVisibilidade("hidden");

    expect(fechamentos[0]).toHaveBeenCalledTimes(1);
    expect(abrir).toHaveBeenCalledTimes(1);
    limpar();
  });

  it("o cleanup fecha o canal aberto uma vez e solta o ouvinte de visibilidade", () => {
    const { abrir, fechamentos } = abridorComEspiao();
    const limpar = assinarEnquantoVisivel(abrir);

    limpar();
    expect(fechamentos[0]).toHaveBeenCalledTimes(1);

    // Depois do cleanup a tela morreu: voltar à aba não pode abrir nada.
    mudarVisibilidade("hidden");
    mudarVisibilidade("visible");
    expect(abrir).toHaveBeenCalledTimes(1);
    expect(fechamentos[0]).toHaveBeenCalledTimes(1);
  });

  it("o cleanup com a aba escondida não tenta fechar o que já estava fechado", () => {
    const { abrir, fechamentos } = abridorComEspiao();
    const limpar = assinarEnquantoVisivel(abrir);
    mudarVisibilidade("hidden");
    expect(fechamentos[0]).toHaveBeenCalledTimes(1);

    limpar();
    expect(fechamentos[0]).toHaveBeenCalledTimes(1);

    mudarVisibilidade("visible");
    expect(abrir).toHaveBeenCalledTimes(1);
  });

  it("estado 'prerender' (nem visível nem escondido) conta como NÃO visível", () => {
    visibilidade = "prerender" as DocumentVisibilityState;
    const { abrir } = abridorComEspiao();
    const limpar = assinarEnquantoVisivel(abrir);
    expect(abrir).not.toHaveBeenCalled();
    limpar();
  });

  it("sem `document` (SSR) abre direto, sem reabertura, e devolve o fechamento", () => {
    vi.stubGlobal("document", undefined);
    const { abrir, fechamentos } = abridorComEspiao();

    const limpar = assinarEnquantoVisivel(abrir);

    expect(abrir).toHaveBeenCalledTimes(1);
    expect(abrir).toHaveBeenLastCalledWith(false);
    limpar();
    expect(fechamentos[0]).toHaveBeenCalledTimes(1);
  });
});

describe("aoMudarOStatusDoCanalDoPainel", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("a primeira confirmação de uma abertura comum NÃO relê (a tela acabou de ler)", () => {
    const reler = vi.fn();
    const aoMudar = aoMudarOStatusDoCanalDoPainel("pedidos", reler);

    aoMudar("SUBSCRIBED");

    expect(reler).not.toHaveBeenCalled();
  });

  it("aba que voltou a aparecer relê UMA vez, na primeira confirmação, e não na segunda", () => {
    const reler = vi.fn();
    const aoMudar = aoMudarOStatusDoCanalDoPainel("pedidos", reler, true);

    aoMudar("SUBSCRIBED");
    expect(reler).toHaveBeenCalledTimes(1);

    aoMudar("SUBSCRIBED");
    expect(reler).toHaveBeenCalledTimes(1);
  });

  it.each(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"])(
    "queda por %s e volta (SUBSCRIBED) relê uma vez",
    (queda) => {
      const reler = vi.fn();
      const aoMudar = aoMudarOStatusDoCanalDoPainel("pedidos", reler);
      aoMudar("SUBSCRIBED");

      aoMudar(queda);
      expect(reler).not.toHaveBeenCalled();
      aoMudar("SUBSCRIBED");

      expect(reler).toHaveBeenCalledTimes(1);
    },
  );

  it("várias quedas antes de reconectar viram uma releitura só, e confirmação repetida não relê de novo", () => {
    const reler = vi.fn();
    const aoMudar = aoMudarOStatusDoCanalDoPainel("pedidos", reler);

    aoMudar("CHANNEL_ERROR");
    aoMudar("TIMED_OUT");
    aoMudar("CLOSED");
    aoMudar("SUBSCRIBED");
    aoMudar("SUBSCRIBED");

    expect(reler).toHaveBeenCalledTimes(1);
  });

  it("uma segunda queda depois de reconectar volta a pedir releitura", () => {
    const reler = vi.fn();
    const aoMudar = aoMudarOStatusDoCanalDoPainel("pedidos", reler);

    aoMudar("CLOSED");
    aoMudar("SUBSCRIBED");
    aoMudar("TIMED_OUT");
    aoMudar("SUBSCRIBED");

    expect(reler).toHaveBeenCalledTimes(2);
  });

  it("status que não é queda nem confirmação (ex.: JOINING) não cria lacuna", () => {
    const reler = vi.fn();
    const aoMudar = aoMudarOStatusDoCanalDoPainel("pedidos", reler);

    aoMudar("JOINING");
    aoMudar("SUBSCRIBED");

    expect(reler).not.toHaveBeenCalled();
  });

  it("a releitura só vale na confirmação: a queda sozinha não relê", () => {
    const reler = vi.fn();
    const aoMudar = aoMudarOStatusDoCanalDoPainel("pedidos", reler, true);

    aoMudar("CHANNEL_ERROR");

    expect(reler).not.toHaveBeenCalled();
  });

  it("CHANNEL_ERROR avisa no console com o nome do canal e a mensagem do erro", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const aoMudar = aoMudarOStatusDoCanalDoPainel("pedidos", vi.fn());

    aoMudar("CHANNEL_ERROR", new Error("socket caiu"));

    expect(aviso).toHaveBeenCalledTimes(1);
    expect(aviso.mock.calls[0][0]).toContain("pedidos");
    expect(aviso.mock.calls[0][1]).toBe("socket caiu");
  });

  it("CHANNEL_ERROR com erro que não é Error passa o valor como veio", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const aoMudar = aoMudarOStatusDoCanalDoPainel("clientes", vi.fn());

    aoMudar("CHANNEL_ERROR", "texto solto");

    expect(aviso.mock.calls[0][0]).toContain("clientes");
    expect(aviso.mock.calls[0][1]).toBe("texto solto");
  });

  it("TIMED_OUT e CLOSED não gritam no console (só o CHANNEL_ERROR)", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const aoMudar = aoMudarOStatusDoCanalDoPainel("pedidos", vi.fn());

    aoMudar("TIMED_OUT");
    aoMudar("CLOSED");
    aoMudar("SUBSCRIBED");

    expect(aviso).not.toHaveBeenCalled();
  });
});
