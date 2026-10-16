import {
  type ArmazenamentoSimples,
  criarGerenciadorDeChave,
} from "@/lib/chave-do-pedido";
import { describe, expect, it } from "vitest";

function armazenamentoComFalha() {
  const dados = new Map<string, string>();
  const falhas = { leitura: false, escrita: false, remocao: false };
  const armazenamento: ArmazenamentoSimples = {
    getItem(chave) {
      if (falhas.leitura) throw new Error("Storage bloqueado");
      return dados.get(chave) ?? null;
    },
    setItem(chave, valor) {
      if (falhas.escrita) throw new Error("Storage cheio");
      dados.set(chave, valor);
    },
    removeItem(chave) {
      if (falhas.remocao) throw new Error("Storage bloqueado");
      dados.delete(chave);
    },
  };
  let sequencia = 0;
  return {
    falhas,
    gerente: criarGerenciadorDeChave(
      armazenamento,
      () => `chave-${++sequencia}`,
    ),
  };
}

describe("chave do pedido com storage indisponível", () => {
  it("falha ao remover não transforma sucesso em erro nem reutiliza a chave esquecida", () => {
    const { falhas, gerente } = armazenamentoComFalha();
    expect(gerente.chavePara("compra")).toBe("chave-1");
    falhas.remocao = true;
    expect(() => gerente.esquecer()).not.toThrow();
    expect(gerente.chavePara("compra")).toBe("chave-2");
  });

  it.each(["leitura", "escrita"] as const)(
    "falha de %s mantém a mesma chave nas retentativas da instância",
    (falha) => {
      const { falhas, gerente } = armazenamentoComFalha();
      if (falha === "leitura") falhas.leitura = true;
      else falhas.escrita = true;
      expect(gerente.chavePara("compra")).toBe("chave-1");
      expect(gerente.chavePara("compra")).toBe("chave-1");
      expect(gerente.chavePara("outra-compra")).toBe("chave-2");
    },
  );

  it("não ressuscita a chave antiga se remover e gravar falharem juntos", () => {
    const { falhas, gerente } = armazenamentoComFalha();
    gerente.chavePara("compra");
    falhas.remocao = true;
    falhas.escrita = true;
    gerente.esquecer();
    expect(gerente.chavePara("compra")).toBe("chave-2");
    expect(gerente.chavePara("compra")).toBe("chave-2");
    falhas.escrita = false;
    falhas.leitura = true;
    expect(gerente.chavePara("compra")).toBe("chave-2");
  });
});
