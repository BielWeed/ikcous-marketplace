// Mensagem do WhatsApp do mototáxi: os DOIS limites que decidem o que a
// pessoa que entrega recebe, provados no fio da navalha (caça por mutação,
// 24/11/2026). Os testes que já existiam cortavam observações de 500
// caracteres, mas nenhum conferia o limite em si:
//  - observação com 300 caracteres inteiros vai completa; com 301 é cortada
//    em 299 + "…";
//  - a mensagem completa só é trocada pelo resumo quando o link do WhatsApp
//    passaria de 1800 caracteres; com exatamente 1800 ela vai inteira, com
//    1801 o item é trocado pelo aviso "veja o pedido no painel".
import { mensagemMototaxi } from "@/components/admin/minha-loja/contato";
import type { Order } from "@/types";
import { describe, expect, it } from "vitest";

const PREFIXO_DO_LINK = 33;
const LIMITE_DO_LINK = 1800;

const base: Order = {
  id: "c35ce4dd-9876-4321-8123-abcdef3884be",
  shippingOptionId: "local-delivery",
  customer: {
    name: "Cliente fictícia",
    whatsapp: "11912345678",
    address: "Rua Inventada",
    number: "12",
    complement: "apto 4",
    neighborhood: "Centro",
    city: "São Paulo",
    state: "SP",
    cep: "01000-000",
    reference: "portão azul",
  },
  items: [
    {
      productId: "p",
      name: "Caneca",
      quantity: 2,
      price: 25,
      image: "",
    },
  ],
  subtotal: 50,
  shipping: 8,
  discount: 0,
  total: 58,
  paymentMethod: "cash",
  status: "processing",
  createdAt: "",
  updatedAt: "",
  cancelledAfterShipping: false,
};

const linhaDaObservacao = (mensagem: string) =>
  mensagem.split("\n").find((l) => l.startsWith("Observações do pedido:"));

describe("mensagemMototaxi: limite de 300 caracteres da observação", () => {
  it("300 caracteres vão inteiros, sem reticências", () => {
    const nota = "a".repeat(300);
    const linha = linhaDaObservacao(
      mensagemMototaxi({ ...base, notes: nota }, "Loja"),
    );
    expect(linha).toBe(`Observações do pedido: ${nota}`);
  });

  it("301 caracteres são cortados em 299 mais reticências", () => {
    const linha = linhaDaObservacao(
      mensagemMototaxi({ ...base, notes: "a".repeat(301) }, "Loja"),
    );
    expect(linha).toBe(`Observações do pedido: ${"a".repeat(299)}…`);
  });
});

describe("mensagemMototaxi: limite de 1800 caracteres do link", () => {
  const comItemDeTamanho = (n: number) =>
    mensagemMototaxi(
      { ...base, items: [{ ...base.items[0], name: "i".repeat(n) }] },
      "Loja",
    );
  const tamanhoDoLink = (mensagem: string) =>
    PREFIXO_DO_LINK + encodeURIComponent(mensagem).length;

  // Cada "i" a mais no nome do item soma exatamente 1 caractere ao link
  // (ASCII puro), então dá para mirar o tamanho exato a partir de uma
  // mensagem curta que certamente cabe.
  const pequeno = 10;
  const curta = comItemDeTamanho(pequeno);
  const nNoLimite = pequeno + (LIMITE_DO_LINK - tamanhoDoLink(curta));

  it("calibragem: a mensagem curta é a completa e o alvo existe", () => {
    expect(curta).toContain(`Itens: 2× ${"i".repeat(pequeno)}`);
    expect(nNoLimite).toBeGreaterThan(pequeno);
  });

  it("com o link em exatamente 1800 caracteres a mensagem vai completa", () => {
    const mensagem = comItemDeTamanho(nNoLimite);
    expect(tamanhoDoLink(mensagem)).toBe(LIMITE_DO_LINK);
    expect(mensagem).toContain(`Itens: 2× ${"i".repeat(nNoLimite)}`);
    expect(mensagem).not.toContain("veja o pedido no painel");
  });

  it("com 1801 caracteres o item sai e entra o aviso do painel", () => {
    const mensagem = comItemDeTamanho(nNoLimite + 1);
    expect(mensagem).not.toContain("i".repeat(nNoLimite + 1));
    expect(mensagem).toContain("+ 1 item (veja o pedido no painel)");
    expect(tamanhoDoLink(mensagem)).toBeLessThanOrEqual(LIMITE_DO_LINK);
  });
});
