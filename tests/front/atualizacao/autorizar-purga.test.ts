// AUTORIZAÇÃO DA PURGA DE VERSÃO OBRIGATÓRIA — tudo o que acontece ANTES do
// ponto sem volta (apagar SW, caches e IndexedDB). Antes de qualquer
// apagamento: rede provada AGORA, momento seguro (conferido de novo DEPOIS da
// leitura da rede, que pode demorar) e a trava
// existente (máx. 2) gasta e CONFIRMADA lendo de volta. Qualquer recusa lança
// ANTES de apagar qualquer coisa.
//
// Duas famílias de recusa, e a diferença importa para a trava de tentativas do
// instalador:
//   · AtualizacaoAdiada — "agora não" (sem rede, operação sensível): a
//     tentativa é DEVOLVIDA, nada foi gasto;
//   · Error comum — recusa que repetir não conserta (trava esgotada, storage
//     que não grava): a tentativa conta.
import { describe, expect, it, vi } from "vitest";

import { ehAdiamento } from "@/lib/atualizacao/adiamento";
import {
  type PedidoDeAutorizacao,
  autorizarPurgaObrigatoria,
} from "@/lib/atualizacao/autorizar-purga";

function pedido(sobre: Partial<PedidoDeAutorizacao> = {}) {
  const chamadas: string[] = [];
  let trava = { required: "", count: 0 };
  const base: PedidoDeAutorizacao = {
    requerida: "2.0.0",
    versaoLocal: "1.5.0-sha.aaa",
    online: true,
    momentoSeguroAgora: () => {
      chamadas.push("momento");
      return true;
    },
    lerVersaoDoServidor: async () => {
      chamadas.push("leitura-de-versao");
      return "2.0.0-sha.bbb";
    },
    lerTrava: () => {
      chamadas.push("ler-trava");
      return trava;
    },
    gravarTrava: (required, count) => {
      chamadas.push(`gravar-trava:${count}`);
      trava = { required, count };
    },
    gravarLog: () => {
      chamadas.push("log");
    },
    maximo: 2,
    ...sobre,
  };
  return { base, chamadas, trava: () => trava };
}

async function recusa(p: PedidoDeAutorizacao): Promise<unknown> {
  try {
    await autorizarPurgaObrigatoria(p);
  } catch (erro) {
    return erro;
  }
  return null;
}

describe("autorizar a purga obrigatória", () => {
  it("caminho feliz: lê a versão do servidor ANTES de gastar a trava, grava 1 e CONFIRMA lendo de volta", async () => {
    const { base, chamadas, trava } = pedido();
    await expect(autorizarPurgaObrigatoria(base)).resolves.toBeUndefined();
    expect(trava()).toEqual({ required: "2.0.0", count: 1 });
    // a ordem é o ponto: rede provada agora vem antes de gastar a tentativa
    expect(chamadas.indexOf("leitura-de-versao")).toBeLessThan(
      chamadas.indexOf("gravar-trava:1"),
    );
    // e depois de gravar, a trava é relida (leitura de volta)
    const iGravar = chamadas.indexOf("gravar-trava:1");
    expect(chamadas.slice(iGravar + 1)).toContain("ler-trava");
  });

  describe("recusas 'agora não' (nada gasto, tentativa devolvida)", () => {
    it("navegador OFFLINE: recusa e não grava nada", async () => {
      const { base, chamadas, trava } = pedido({ online: false });
      const erro = await recusa(base);
      expect(ehAdiamento(erro)).toBe(true);
      expect(trava().count).toBe(0);
      expect(chamadas).not.toContain("leitura-de-versao");
      expect(chamadas.some((c) => c.startsWith("gravar-trava"))).toBe(false);
    });

    it("rede 'online' mas /version.json NÃO legível agora (portal cativo, cabo solto): recusa — a prova de rede velha não vale", async () => {
      const { base, chamadas, trava } = pedido({
        lerVersaoDoServidor: async () => null,
      });
      const erro = await recusa(base);
      expect(ehAdiamento(erro)).toBe(true);
      expect(trava().count).toBe(0);
      expect(chamadas.some((c) => c.startsWith("gravar-trava"))).toBe(false);
    });

    it("a leitura LANÇANDO também é rede não provada", async () => {
      const { base, trava } = pedido({
        lerVersaoDoServidor: async () => {
          throw new Error("Failed to fetch");
        },
      });
      expect(ehAdiamento(await recusa(base))).toBe(true);
      expect(trava().count).toBe(0);
    });

    it("momento NÃO seguro (operação sensível, checkout, venda suja...) logo de saída: recusa e não lê rede nem grava", async () => {
      const { base, chamadas, trava } = pedido({
        momentoSeguroAgora: () => false,
      });
      expect(ehAdiamento(await recusa(base))).toBe(true);
      expect(trava().count).toBe(0);
      expect(chamadas).not.toContain("leitura-de-versao");
    });

    // O defeito: o momento só era conferido ANTES do await de /version.json. Com
    // a leitura lenta, a pessoa entrava em pagamento/venda no meio da espera e
    // a purga seguia em frente mesmo assim.
    it("a pessoa ENTRA em tela de compra/venda enquanto /version.json demora: reconfere DEPOIS da leitura e recusa antes de gravar a trava", async () => {
      let seguro = true;
      const { base, chamadas, trava } = pedido({
        momentoSeguroAgora: () => seguro,
        lerVersaoDoServidor: async () => {
          seguro = false; // entrou no checkout durante a espera
          return "2.0.0-sha.bbb";
        },
      });
      const gravarTrava = vi.fn();
      const gravarLog = vi.fn();
      const erro = await recusa({ ...base, gravarTrava, gravarLog });
      expect(ehAdiamento(erro)).toBe(true);
      expect(gravarTrava).not.toHaveBeenCalled();
      expect(gravarLog).not.toHaveBeenCalled();
      expect(trava().count).toBe(0);
      expect(chamadas.some((c) => c.startsWith("gravar-trava"))).toBe(false);
    });

    it("o momento é reconferido DEPOIS da leitura e ANTES de gravar a trava (a ordem é o contrato)", async () => {
      const { base, chamadas } = pedido();
      await autorizarPurgaObrigatoria(base);
      const iLeitura = chamadas.indexOf("leitura-de-versao");
      const iGravar = chamadas.indexOf("gravar-trava:1");
      const momentosEntre = chamadas
        .slice(iLeitura + 1, iGravar)
        .filter((c) => c === "momento");
      expect(momentosEntre.length).toBeGreaterThanOrEqual(1);
    });

    it("controle: seguro antes E depois da leitura, autoriza (o veto não virou recusa permanente)", async () => {
      const { base, trava } = pedido({
        lerVersaoDoServidor: async () => "2.0.0-sha.bbb",
      });
      await expect(autorizarPurgaObrigatoria(base)).resolves.toBeUndefined();
      expect(trava().count).toBe(1);
    });

    it("ambiente que não informa onLine (undefined) não é offline", async () => {
      const { base } = pedido({ online: undefined });
      await expect(autorizarPurgaObrigatoria(base)).resolves.toBeUndefined();
    });
  });

  describe("recusas que repetir não conserta (a tentativa conta)", () => {
    it("o LIMITE de 2 vale DENTRO da purga: com 2 já gastas para a mesma versão, recusa sem gravar mais", async () => {
      const { base, trava } = pedido({
        lerTrava: () => ({ required: "2.0.0", count: 2 }),
      });
      const gravarTrava = vi.fn();
      const erro = await recusa({ ...base, gravarTrava });
      expect(erro).toBeInstanceOf(Error);
      expect(ehAdiamento(erro)).toBe(false);
      expect(gravarTrava).not.toHaveBeenCalled();
      expect(trava().count).toBe(0);
    });

    it("a 2ª tentativa passa (count 1 → 2) e a 3ª não", async () => {
      let guardado = { required: "2.0.0", count: 1 };
      const comum = {
        lerTrava: () => guardado,
        gravarTrava: (required: string, count: number) => {
          guardado = { required, count };
        },
      };
      const { base } = pedido(comum);
      await expect(autorizarPurgaObrigatoria(base)).resolves.toBeUndefined();
      expect(guardado.count).toBe(2);
      expect(await recusa(base)).toBeInstanceOf(Error);
      expect(guardado.count).toBe(2);
    });

    it("trava de OUTRA versão exigida não conta: recomeça do 1", async () => {
      let guardado = { required: "1.9.0", count: 2 };
      const { base } = pedido({
        lerTrava: () => guardado,
        gravarTrava: (required, count) => {
          guardado = { required, count };
        },
      });
      await autorizarPurgaObrigatoria(base);
      expect(guardado).toEqual({ required: "2.0.0", count: 1 });
    });

    it("storage que LANÇA ao gravar a trava: não autoriza (sem como contar, não apaga)", async () => {
      const { base } = pedido({
        gravarTrava: () => {
          throw new Error("QuotaExceededError");
        },
      });
      const erro = await recusa(base);
      expect(erro).toBeInstanceOf(Error);
      expect(ehAdiamento(erro)).toBe(false);
    });

    it("SEM LEITURA DE VOLTA: gravação 'aceita' que não pegou (leitura devolve outra coisa) não autoriza", async () => {
      const { base } = pedido({
        gravarTrava: () => {
          /* aceitou e não guardou */
        },
        lerTrava: () => ({ required: "2.0.0", count: 0 }),
      });
      const erro = await recusa(base);
      expect(erro).toBeInstanceOf(Error);
      expect(ehAdiamento(erro)).toBe(false);
    });

    it("outra aba ganhou a escrita (leu de volta uma contagem diferente): não autoriza", async () => {
      const { base } = pedido({
        lerTrava: (() => {
          let n = 0;
          return () => {
            n += 1;
            return n === 1
              ? { required: "2.0.0", count: 0 }
              : { required: "2.0.0", count: 2 };
          };
        })(),
        gravarTrava: () => {},
      });
      expect(await recusa(base)).toBeInstanceOf(Error);
    });
  });

  it("o log de diagnóstico para o próximo boot só é gravado depois da trava confirmada", async () => {
    const { base, chamadas } = pedido();
    await autorizarPurgaObrigatoria(base);
    expect(chamadas.indexOf("log")).toBeGreaterThan(
      chamadas.indexOf("gravar-trava:1"),
    );
  });
});
