// "COMO ENTREGO NA MINHA CIDADE" (16/10/2026) — a conta pura do front.
//
// A lojista escolhe "Entrego" / "Entrego e retiro" / "Só retiro" e o prazo da
// entrega própria. No banco são DUAS coisas: a coluna nova
// `local_delivery_enabled` (a entrega própria está ligada?) e a chave que já
// existia, `store-pickup`, em `enabled_shipping_methods` (a retirada está
// ligada?). Este arquivo prova a função que junta as duas na resposta de
// três opções, o normalizador dos campos novos (coluna ausente = padrão de
// hoje: entrega ligada, 1 dia) e a regra da retirada livre — a MESMA que a
// RPC do pedido aplica (`v_so_retirada` + opção `store-pickup`).
import {
  DIAS_DA_ENTREGA_PROPRIA_PADRAO,
  type ModoDaEntregaNaCidade,
  diasDaEntregaPropria,
  entregaPropriaLigada,
  modoDaEntregaNaCidade,
  retiradaLivreParaQualquerCep,
} from "@/lib/guarda-de-frete";
import { describe, expect, it } from "vitest";

const SEM_RETIRADA = ["sedex", "pac"];
const COM_RETIRADA = ["sedex", "pac", "store-pickup"];
const SO_RETIRADA_NA_LISTA = ["store-pickup"];

describe("modoDaEntregaNaCidade — a tabela inteira", () => {
  // [localDeliveryEnabled, enabledShippingMethods, modo]
  const tabela: [
    boolean | null | undefined,
    string[] | null | undefined,
    ModoDaEntregaNaCidade,
  ][] = [
    // Entrega ligada: a retirada decide entre as duas primeiras respostas.
    [true, SEM_RETIRADA, "entrego"],
    [true, COM_RETIRADA, "entrego_e_retiro"],
    [true, SO_RETIRADA_NA_LISTA, "entrego_e_retiro"],
    [true, [], "entrego"],
    // Entrega desligada: só retiro (a trigger do banco garante que a
    // retirada está ligada; ver o caso inalcançável abaixo).
    [false, COM_RETIRADA, "so_retiro"],
    [false, SO_RETIRADA_NA_LISTA, "so_retiro"],
    // Coluna AUSENTE (banco sem a migration) = entrega ligada, como hoje.
    [undefined, SEM_RETIRADA, "entrego"],
    [undefined, COM_RETIRADA, "entrego_e_retiro"],
    [null, SEM_RETIRADA, "entrego"],
    [null, COM_RETIRADA, "entrego_e_retiro"],
    // Lista NULL/ausente lê como a edge: ["sedex","pac"] — sem retirada.
    [true, null, "entrego"],
    [true, undefined, "entrego"],
    [undefined, undefined, "entrego"],
    [null, null, "entrego"],
  ];

  it.each(tabela)(
    "entrega=%s, métodos=%j -> %s",
    (localDeliveryEnabled, enabledShippingMethods, esperado) => {
      expect(
        modoDaEntregaNaCidade({
          localDeliveryEnabled,
          enabledShippingMethods: enabledShippingMethods as string[],
        }),
      ).toBe(esperado);
    },
  );

  it("config nula ou vazia: o padrão de hoje (entrego)", () => {
    expect(modoDaEntregaNaCidade(null)).toBe("entrego");
    expect(modoDaEntregaNaCidade(undefined)).toBe("entrego");
    expect(modoDaEntregaNaCidade({})).toBe("entrego");
  });

  it("só `false` desliga a entrega: valor estranho NÃO a desliga (falha para o lado de hoje)", () => {
    for (const estranho of [0, "", "false", Number.NaN]) {
      expect(
        modoDaEntregaNaCidade({
          localDeliveryEnabled: estranho as unknown as boolean,
          enabledShippingMethods: COM_RETIRADA,
        }),
      ).toBe("entrego_e_retiro");
    }
  });

  it("estado inalcançável (entrega desligada SEM retirada — a trigger do banco recusa): lê como só retiro, e a retirada livre exige a opção marcada", () => {
    const config = {
      localDeliveryEnabled: false,
      enabledShippingMethods: SEM_RETIRADA,
    };
    expect(modoDaEntregaNaCidade(config)).toBe("so_retiro");
    // Mesmo nesse estado, quem libera o convidado é a opção `store-pickup`
    // marcada — que a edge não oferece sem a retirada ligada.
    expect(retiradaLivreParaQualquerCep(config, "local-delivery")).toBe(false);
    expect(retiradaLivreParaQualquerCep(config, null)).toBe(false);
  });
});

describe("entregaPropriaLigada / diasDaEntregaPropria — coluna ausente ou lixo = o padrão de hoje", () => {
  it("o padrão de dias é 1", () => {
    expect(DIAS_DA_ENTREGA_PROPRIA_PADRAO).toBe(1);
  });

  it.each([
    [true, true],
    [false, false],
    [undefined, true],
    [null, true],
    ["false", true],
    [0, true],
  ])("entregaPropriaLigada(%j) = %s", (entrada, esperado) => {
    expect(entregaPropriaLigada(entrada)).toBe(esperado);
  });

  it.each([
    [0, 0],
    [1, 1],
    [2, 2],
    [7, 7],
    [30, 30],
    [undefined, 1],
    [null, 1],
    [31, 1],
    [-1, 1],
    [1.5, 1],
    [Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 1],
    ["3", 1],
    ["", 1],
    [true, 1],
  ])("diasDaEntregaPropria(%j) = %s", (entrada, esperado) => {
    expect(diasDaEntregaPropria(entrada)).toBe(esperado);
  });
});

describe("retiradaLivreParaQualquerCep — espelho do v_retirada_livre da RPC", () => {
  const SO_RETIRO = {
    localDeliveryEnabled: false,
    enabledShippingMethods: COM_RETIRADA,
  };
  const ENTREGO = {
    localDeliveryEnabled: true,
    enabledShippingMethods: SEM_RETIRADA,
  };
  const ENTREGO_E_RETIRO = {
    localDeliveryEnabled: true,
    enabledShippingMethods: COM_RETIRADA,
  };

  it("só retiro + retirada marcada = livre para qualquer CEP", () => {
    expect(retiradaLivreParaQualquerCep(SO_RETIRO, "store-pickup")).toBe(true);
  });

  it("só retiro com OUTRA opção marcada (transportadora, entrega local velha, nada) = não é livre", () => {
    expect(retiradaLivreParaQualquerCep(SO_RETIRO, "local-delivery")).toBe(
      false,
    );
    expect(retiradaLivreParaQualquerCep(SO_RETIRO, "melhor-envio-1")).toBe(
      false,
    );
    expect(retiradaLivreParaQualquerCep(SO_RETIRO, null)).toBe(false);
    expect(retiradaLivreParaQualquerCep(SO_RETIRO, undefined)).toBe(false);
  });

  it("comparação exata do id (mesma régua da RPC): espaço ou caixa não é retirada", () => {
    expect(retiradaLivreParaQualquerCep(SO_RETIRO, " store-pickup")).toBe(
      false,
    );
    expect(retiradaLivreParaQualquerCep(SO_RETIRO, "STORE-PICKUP")).toBe(false);
  });

  it("nos outros dois modos a retirada NUNCA é livre (a edge só a oferece à área local)", () => {
    for (const config of [ENTREGO, ENTREGO_E_RETIRO]) {
      expect(retiradaLivreParaQualquerCep(config, "store-pickup")).toBe(false);
    }
  });

  it("config nula/vazia (padrão de hoje: entrego) nunca libera", () => {
    expect(retiradaLivreParaQualquerCep(null, "store-pickup")).toBe(false);
    expect(retiradaLivreParaQualquerCep(undefined, "store-pickup")).toBe(false);
    expect(retiradaLivreParaQualquerCep({}, "store-pickup")).toBe(false);
  });
});
