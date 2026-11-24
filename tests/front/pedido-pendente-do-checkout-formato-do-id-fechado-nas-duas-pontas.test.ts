// @vitest-environment jsdom
//
// O PIX NA TELA SOBREVIVE À RECARGA — o formato do id guardado é FECHADO nas
// duas pontas. O módulo diz que "qualquer outra coisa na chave (adulterada, de
// uma versão velha, vazia) é tratada como nada guardado": o id lido do
// `sessionStorage` vira filtro de uma consulta ao banco, então só um UUID
// inteiro pode passar.
//
// Mutação em `src/lib/pedido-pendente-do-checkout.ts`: tirar a âncora `^` ou
// `$` do formato, ou o `i` (maiúsculas), não derrubava teste nenhum — os testes
// vizinhos usam ids ruins "de verdade" (curtos, vazios), nunca um UUID com
// lixo colado antes ou depois.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  chaveDoPedidoPendenteDoCheckout,
  existeAlgumPedidoPendenteDoCheckout,
  guardarPedidoPendenteDoCheckout,
  lerPedidoPendenteDoCheckout,
} from "@/lib/pedido-pendente-do-checkout";

const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

function armazemDeTeste() {
  const dados = new Map<string, string>();
  return {
    dados,
    getItem: (chave: string) => dados.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      dados.set(chave, String(valor));
    },
    removeItem: (chave: string) => {
      dados.delete(chave);
    },
    clear: () => {
      dados.clear();
    },
    key: (i: number) => Array.from(dados.keys()).at(i) ?? null,
    get length() {
      return dados.size;
    },
  };
}

describe("pedido pendente do checkout — o id é um UUID INTEIRO", () => {
  let armazem: ReturnType<typeof armazemDeTeste>;

  beforeEach(() => {
    armazem = armazemDeTeste();
    vi.stubGlobal("sessionStorage", armazem);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("guardar recusa UUID com lixo antes ou depois (nada vai para o storage)", () => {
    for (const ruim of [
      `x${PEDIDO}`,
      `${PEDIDO}x`,
      ` ${PEDIDO}`,
      `${PEDIDO} `,
      `${PEDIDO}\n`,
      `${PEDIDO}-extra`,
      `${PEDIDO}${PEDIDO}`,
      `eq.${PEDIDO}`,
    ]) {
      guardarPedidoPendenteDoCheckout("user-1", ruim);
    }
    expect(armazem.dados.size).toBe(0);
  });

  it("ler trata como 'nada guardado' o valor ADULTERADO que já estava no storage", () => {
    const chave = chaveDoPedidoPendenteDoCheckout("user-1");
    for (const adulterado of [
      `x${PEDIDO}`,
      `${PEDIDO}x`,
      `${PEDIDO},or=(id.neq.0)`,
      `${PEDIDO}\n`,
    ]) {
      armazem.dados.set(chave, adulterado);
      expect(lerPedidoPendenteDoCheckout("user-1")).toBeNull();
    }
  });

  it("o UUID em maiúsculas (outra versão do app, outro driver) é aceito e lido de volta", () => {
    const maiusculo = PEDIDO.toUpperCase();
    guardarPedidoPendenteDoCheckout("user-1", maiusculo);
    expect(lerPedidoPendenteDoCheckout("user-1")).toBe(maiusculo);
  });

  it("CONTROLE: o UUID minúsculo inteiro continua passando", () => {
    guardarPedidoPendenteDoCheckout("user-1", PEDIDO);
    expect(lerPedidoPendenteDoCheckout("user-1")).toBe(PEDIDO);
  });

  it("existeAlgumPedidoPendenteDoCheckout: só a chave DO PEDIDO PENDENTE conta — storage vazio ou com chave alheia é 'não'", () => {
    // A carga de /checkout sem usuário espera a sessão por até 8 s SÓ quando
    // há registro. Chave alheia (tema, rascunho) não pode acender essa espera.
    expect(existeAlgumPedidoPendenteDoCheckout()).toBe(false);
    armazem.dados.set("tema", "escuro");
    armazem.dados.set("ikcous:outra-coisa", PEDIDO);
    expect(existeAlgumPedidoPendenteDoCheckout()).toBe(false);
  });

  it("existeAlgumPedidoPendenteDoCheckout: acha o registro mesmo sozinho e mesmo na ÚLTIMA posição", () => {
    guardarPedidoPendenteDoCheckout("user-1", PEDIDO);
    expect(armazem.dados.size).toBe(1);
    expect(existeAlgumPedidoPendenteDoCheckout()).toBe(true);

    armazem.dados.clear();
    armazem.dados.set("tema", "escuro");
    armazem.dados.set("ikcous:outra-coisa", "x");
    guardarPedidoPendenteDoCheckout("user-2", PEDIDO);
    expect(existeAlgumPedidoPendenteDoCheckout()).toBe(true);
  });

  it("um usuário vazio nunca grava nem lê (a chave sem dono não existe)", () => {
    guardarPedidoPendenteDoCheckout("", PEDIDO);
    expect(armazem.dados.size).toBe(0);
    armazem.dados.set(chaveDoPedidoPendenteDoCheckout(""), PEDIDO);
    expect(lerPedidoPendenteDoCheckout("")).toBeNull();
  });
});
