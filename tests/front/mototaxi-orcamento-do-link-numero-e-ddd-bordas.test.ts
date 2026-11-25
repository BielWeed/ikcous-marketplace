// Bordas de `src/components/admin/minha-loja/contato.ts` que os testes do
// mototáxi deixavam passar (caça por mutação):
//  - o orçamento do link do WhatsApp (33 de prefixo + até 1800 no total): a
//    mensagem completa cabe até o último caractere e, passou disso, a lista de
//    itens vira "+ N itens (veja o pedido no painel)" sem perder os dados de
//    entrega; a observação cai para 80 e, por último, para a frase fixa;
//  - o teto de 300 caracteres da observação (300 cabe, 301 corta);
//  - todos os DDDs do Brasil e as faixas do número nacional.
import { describe, expect, it } from "vitest";

import {
  dddBrasileiroValido,
  mensagemMototaxi,
  normalizarNumeroMototaxi,
} from "@/components/admin/minha-loja/contato";
import { cortarTexto } from "@/lib/cortar-texto";
import type { Order } from "@/types";

const PREFIXO_DO_LINK = 33;
const TETO_DO_LINK = 1800;

function pedido(
  extra: {
    itens?: string[];
    notes?: string;
    address?: string;
  } = {},
): Order {
  const itens = extra.itens ?? ["Caneca"];
  return {
    id: "c35ce4dd-9876-4321-8123-abcdef3884be",
    shippingOptionId: "local-delivery",
    customer: {
      name: "Cliente fictícia",
      whatsapp: "11912345678",
      address: extra.address ?? "Rua Inventada",
      number: "12",
      complement: "apto 4",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
      cep: "01000-000",
      reference: "portão azul",
    },
    items: itens.map((name) => ({
      productId: "p",
      name,
      quantity: 1,
      price: 25,
      image: "",
    })),
    subtotal: 50,
    shipping: 8,
    discount: 0,
    total: 58,
    paymentMethod: "cash",
    paymentStatus: null,
    status: "processing",
    createdAt: "",
    updatedAt: "",
    cancelledAfterShipping: false,
    ...(extra.notes === undefined ? {} : { notes: extra.notes }),
  } as unknown as Order;
}

const tamanhoNoLink = (mensagem: string) =>
  PREFIXO_DO_LINK + encodeURIComponent(mensagem).length;

const RESUMO = "veja o pedido no painel";

describe("mensagemMototaxi — o orçamento do link do WhatsApp", () => {
  it("cabe até o ÚLTIMO caractere (33 de prefixo + 1767 = 1800) e, um a mais, a lista de itens é resumida", () => {
    // Nome de item em ASCII: cada letra a mais é exatamente 1 caractere a mais no link.
    const montar = (n: number) =>
      mensagemMototaxi(pedido({ itens: ["a".repeat(n)] }), "Loja");
    const completa = (n: number) => !montar(n).includes(RESUMO);

    let n = 1;
    while (completa(n + 1)) {
      n += 1;
      // Trava de segurança: se o resumo nunca aparecer, falha em vez de girar para sempre.
      if (n > 5000) throw new Error("o resumo dos itens nunca apareceu");
    }

    expect(completa(n)).toBe(true);
    expect(tamanhoNoLink(montar(n))).toBe(TETO_DO_LINK);
    // Um caractere a mais não cabe: o item some e entra o resumo, mantendo a entrega.
    const resumida = montar(n + 1);
    expect(resumida).toContain("+ 1 item (veja o pedido no painel)");
    expect(resumida).not.toContain("Itens:");
    expect(resumida).toContain("Entrega — Pedido #3884BE");
    expect(resumida).toContain("Loja: Loja");
    expect(tamanhoNoLink(resumida)).toBeLessThanOrEqual(TETO_DO_LINK);
  });

  it("cabendo tudo, não aparece resumo nenhum (nem '+ 0 itens')", () => {
    const msg = mensagemMototaxi(pedido({ itens: ["Caneca", "Vela"] }), "Loja");
    expect(msg).toContain("Itens: 1× Caneca; 1× Vela");
    expect(msg).not.toContain(RESUMO);
    expect(msg).not.toMatch(/\+ \d+ iten/);
  });

  it("passou do teto por causa dos itens: entram os que cabem, em ordem, e o resto vira '+ N itens'", () => {
    const itens = Array.from({ length: 80 }, (_, i) => `Produto ${i + 1}`);
    const msg = mensagemMototaxi(pedido({ itens }), "Loja");
    expect(tamanhoNoLink(msg)).toBeLessThanOrEqual(TETO_DO_LINK);
    const linhaDeItens = msg.split("\n").find((l) => l.startsWith("Itens:"));
    const entraram = (linhaDeItens ?? "").replace("Itens: ", "").split("; ");
    expect(entraram.length).toBeGreaterThan(0);
    expect(entraram.length).toBeLessThan(80);
    expect(entraram.at(0)).toBe("1× Produto 1");
    expect(entraram.at(-1)).toBe(`1× Produto ${entraram.length}`);
    expect(msg).toContain(`+ ${80 - entraram.length} itens (${RESUMO})`);
  });

  it("todos os itens cabem mesmo com a observação enorme encurtada: nenhum resumo", () => {
    // 300 letras de 6 caracteres no link (ç) estouram o teto só com a nota.
    const nota = "ç".repeat(300);
    const msg = mensagemMototaxi(pedido({ notes: nota }), "Loja");
    expect(tamanhoNoLink(msg)).toBeLessThanOrEqual(TETO_DO_LINK);
    expect(msg).toContain(`Observações do pedido: ${cortarTexto(nota, 80)}`);
    expect(msg).toContain("Itens: 1× Caneca");
    expect(msg).not.toContain(RESUMO);
  });

  it("a observação só é encurtada quando precisa: nota média com a lista cortada fica inteira", () => {
    const nota = "b".repeat(200);
    const itens = Array.from({ length: 60 }, (_, i) => `Produto ${i + 1}`);
    const msg = mensagemMototaxi(pedido({ itens, notes: nota }), "Loja");
    expect(msg).toContain(RESUMO);
    expect(msg).toContain(`Observações do pedido: ${nota}`);
  });

  it("sem espaço nem para a nota de 80: troca pela frase fixa, e só nesse caso", () => {
    const nota = "n".repeat(200);
    const comEndereco = (k: number) =>
      mensagemMototaxi(pedido({ notes: nota, address: "a".repeat(k) }), "Loja");
    let k = 1;
    while (!comEndereco(k).includes("Veja a observação no painel.")) {
      k += 1;
      if (k > 3000) throw new Error("não chegou à frase fixa");
    }
    const msg = comEndereco(k);
    expect(msg).toContain(
      "Observações do pedido: Veja a observação no painel.",
    );
    expect(msg).not.toContain("nnnn");
    // Um caractere a menos de endereço e a nota cortada em 80 ainda cabe.
    const anterior = comEndereco(k - 1);
    expect(anterior).toContain(
      `Observações do pedido: ${cortarTexto(nota, 80)}`,
    );
    expect(anterior).not.toContain("Veja a observação no painel.");
  });
});

describe("mensagemMototaxi — o teto de 300 caracteres da observação", () => {
  const linhaDaNota = (notes: string) =>
    mensagemMototaxi(pedido({ notes }), "Loja")
      .split("\n")
      .find((l) => l.startsWith("Observações"));

  it("300 caracteres cabem inteiros, sem reticências", () => {
    expect(linhaDaNota("c".repeat(300))).toBe(
      `Observações do pedido: ${"c".repeat(300)}`,
    );
  });

  it("301 caracteres: 299 mais as reticências", () => {
    expect(linhaDaNota("c".repeat(301))).toBe(
      `Observações do pedido: ${"c".repeat(299)}…`,
    );
  });
});

describe("dddBrasileiroValido — todos os DDDs do Brasil, e só eles", () => {
  const VALIDOS = new Set([
    ...[11, 12, 13, 14, 15, 16, 17, 18, 19],
    ...[21, 22, 24, 27, 28],
    ...[31, 32, 33, 34, 35, 37, 38],
    ...[41, 42, 43, 44, 45, 46, 47, 48, 49],
    ...[51, 53, 54, 55],
    ...[61, 62, 63, 64, 65, 66, 67, 68, 69],
    ...[71, 73, 74, 75, 77, 79],
    ...[81, 82, 83, 84, 85, 86, 87, 88, 89],
    ...[91, 92, 93, 94, 95, 96, 97, 98, 99],
  ]);

  it("de 00 a 99, só os 67 DDDs que existem passam", () => {
    for (let ddd = 0; ddd <= 99; ddd += 1) {
      const texto = String(ddd).padStart(2, "0");
      expect(dddBrasileiroValido(texto), `DDD ${texto}`).toBe(VALIDOS.has(ddd));
    }
    expect(VALIDOS.size).toBe(67);
  });

  it("três dígitos, um dígito, vazio e letra não são DDD", () => {
    for (const ruim of ["", "1", "111", "a1", "1a", " 11", "11 "]) {
      expect(dddBrasileiroValido(ruim), JSON.stringify(ruim)).toBe(false);
    }
  });
});

describe("normalizarNumeroMototaxi — faixas do número nacional", () => {
  it("fixo (8 dígitos começando em 2 a 5) e celular (9 dígitos começando em 9) ganham o 55", () => {
    expect(normalizarNumeroMototaxi("11 2345-6789")).toBe("551123456789");
    expect(normalizarNumeroMototaxi("11 3456-7890")).toBe("551134567890");
    expect(normalizarNumeroMototaxi("11 4567-8901")).toBe("551145678901");
    expect(normalizarNumeroMototaxi("11 5678-9012")).toBe("551156789012");
    expect(normalizarNumeroMototaxi("(11) 91234-5678")).toBe("5511912345678");
  });

  it("fixo começando em 0, 1, 6, 7, 8 ou 9 não vale; celular precisa começar em 9", () => {
    for (const ruim of [
      "11 0345-6789",
      "11 1345-6789",
      "11 6345-6789",
      "11 7345-6789",
      "11 8345-6789",
      "11 9345-6789", // 8 dígitos começando em 9: nem fixo nem celular
      "11 81234-5678", // 9 dígitos começando em 8
      "11 21234-5678", // 9 dígitos começando em 2
    ]) {
      expect(normalizarNumeroMototaxi(ruim), ruim).toBeNull();
    }
  });

  it("com o +55 na frente: 12 dígitos (fixo) e 13 dígitos (celular) perdem o país antes de conferir", () => {
    expect(normalizarNumeroMototaxi("+55 11 3456-7890")).toBe("551134567890");
    expect(normalizarNumeroMototaxi("+55 (11) 91234-5678")).toBe(
      "5511912345678",
    );
    expect(normalizarNumeroMototaxi("5511912345678")).toBe("5511912345678");
  });

  it("DDD 55 (interior do RS) sem país não perde os dois primeiros dígitos", () => {
    expect(normalizarNumeroMototaxi("55 91234-5678")).toBe("5555912345678");
  });

  it("número que não tem 8 nem 9 dígitos depois do DDD, DDD inexistente, letras e vazio: nulo", () => {
    for (const ruim of [
      "11 345-6789", // 7 dígitos
      "11 991234-56789", // 11 dígitos depois do DDD
      "10 91234-5678", // DDD 10 não existe
      "11 9123a-5678",
      "",
      "   ",
    ]) {
      expect(normalizarNumeroMototaxi(ruim), ruim).toBeNull();
    }
    expect(normalizarNumeroMototaxi(null)).toBeNull();
    expect(normalizarNumeroMototaxi(undefined)).toBeNull();
  });
});
