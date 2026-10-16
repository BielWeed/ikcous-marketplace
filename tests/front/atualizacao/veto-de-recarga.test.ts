// @vitest-environment jsdom
//
// O VETO DE RECARGA — a pergunta "é seguro recarregar AGORA?" que qualquer
// caminho de recarga da atualização precisa fazer NO INSTANTE de recarregar,
// não minutos antes, quando decidiu começar. Quem responde é o instalador
// montado (view, trabalho sujo, pedido pendente, operação sensível); sem
// instalador montado, vale o que o módulo consegue saber sozinho.
//
// Vetou: a recarga NÃO acontece e fica PENDENTE (haRecargaPendente), e o gate
// recarrega no próximo ponto de parada — sem laço, sem tentar de novo por conta
// própria.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { marcarOperacaoSensivel } from "@/lib/atualizacao/operacao-sensivel";
import {
  haRecargaPendente,
  limparRecargaPendente,
} from "@/lib/atualizacao/recarga-pendente";
import {
  definirAvaliadorDeMomentoSeguro,
  momentoSeguroAgora,
  recarregarSeSeguro,
} from "@/lib/atualizacao/veto-de-recarga";
import { guardarPedidoPendenteDoCheckout } from "@/lib/pedido-pendente-do-checkout";

const sessao = new Map<string, string>();
const UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("veto de recarga", () => {
  beforeEach(() => {
    sessao.clear();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => sessao.get(k) ?? null,
      setItem: (k: string, v: string) => {
        sessao.set(k, String(v));
      },
      removeItem: (k: string) => {
        sessao.delete(k);
      },
      get length() {
        return sessao.size;
      },
      key: (i: number) => Array.from(sessao.keys()).at(i) ?? null,
    });
    limparRecargaPendente();
  });

  afterEach(() => {
    definirAvaliadorDeMomentoSeguro(null);
    limparRecargaPendente();
    vi.unstubAllGlobals();
  });

  describe("sem instalador montado (o que o módulo sabe sozinho)", () => {
    it("nada sensível: seguro", () => {
      expect(momentoSeguroAgora()).toBe(true);
    });

    it("operação sensível em andamento: NÃO seguro; ao terminar, seguro", () => {
      const desmarcar = marcarOperacaoSensivel("fila-offline");
      expect(momentoSeguroAgora()).toBe(false);
      desmarcar();
      expect(momentoSeguroAgora()).toBe(true);
    });

    it("pedido PIX pendente guardado na aba: NÃO seguro", () => {
      guardarPedidoPendenteDoCheckout("u1", UUID);
      expect(momentoSeguroAgora()).toBe(false);
    });
  });

  describe("com avaliador registrado (o instalador montado)", () => {
    it("o avaliador manda, lido AO VIVO a cada pergunta", () => {
      let livre = true;
      definirAvaliadorDeMomentoSeguro(() => livre);
      expect(momentoSeguroAgora()).toBe(true);
      livre = false;
      expect(momentoSeguroAgora()).toBe(false);
      livre = true;
      expect(momentoSeguroAgora()).toBe(true);
    });

    it("avaliador que LANÇA vale como NÃO seguro (na dúvida, não recarrega)", () => {
      definirAvaliadorDeMomentoSeguro(() => {
        throw new Error("defeito");
      });
      expect(momentoSeguroAgora()).toBe(false);
    });

    it("o desfazer devolvido só remove o PRÓPRIO registro (um avaliador mais novo não é derrubado por um desmonte atrasado)", () => {
      const desfazerAntigo = definirAvaliadorDeMomentoSeguro(() => true);
      definirAvaliadorDeMomentoSeguro(() => false);
      desfazerAntigo();
      expect(momentoSeguroAgora()).toBe(false);
    });

    it("desregistrar (null) volta ao que o módulo sabe sozinho", () => {
      definirAvaliadorDeMomentoSeguro(() => false);
      expect(momentoSeguroAgora()).toBe(false);
      definirAvaliadorDeMomentoSeguro(null);
      expect(momentoSeguroAgora()).toBe(true);
    });
  });

  describe("recarregarSeSeguro", () => {
    it("seguro: recarrega na hora e NÃO deixa recarga pendente", () => {
      const recarregar = vi.fn();
      expect(recarregarSeSeguro(recarregar)).toBe(true);
      expect(recarregar).toHaveBeenCalledTimes(1);
      expect(haRecargaPendente()).toBe(false);
    });

    it("VETADO: não recarrega, e fica PENDENTE para o próximo ponto de parada do gate", () => {
      definirAvaliadorDeMomentoSeguro(() => false);
      const recarregar = vi.fn();
      expect(recarregarSeSeguro(recarregar)).toBe(false);
      expect(recarregar).not.toHaveBeenCalled();
      expect(haRecargaPendente()).toBe(true);
    });

    it("vetado e depois liberado: NÃO recarrega sozinho (quem recarrega é o gate, num ponto de parada)", () => {
      let livre = false;
      definirAvaliadorDeMomentoSeguro(() => livre);
      const recarregar = vi.fn();
      recarregarSeSeguro(recarregar);
      livre = true;
      expect(recarregar).not.toHaveBeenCalled();
    });
  });
});
