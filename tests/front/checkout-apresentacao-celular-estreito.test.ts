// Contratos de CSS/estrutura, como celular-estreito-rodape-contraste-toque.
// Não medem geometria: a ausência de sobreposição exige prova em navegador.
import { readFileSync } from "node:fs";
import enderecos from "@/components/ui/custom/AddressList.tsx?raw";
import checkout from "@/views/customer/CheckoutView.tsx?raw";
import { parse } from "postcss";
import { describe, expect, it } from "vitest";

const css = parse(readFileSync("src/index.css", "utf8"));

function tagAntesDoTexto(fonte: string, texto: string): string {
  const posicao = fonte.indexOf(texto);
  expect(posicao, texto).toBeGreaterThan(-1);
  return fonte.slice(fonte.lastIndexOf("<", posicao), posicao);
}

describe("finalizar em celular estreito — apresentação", () => {
  it("só a linha Entrega pode quebrar abaixo de 360px, sem invadir o Total", () => {
    const entrega = checkout.lastIndexOf("<span>Entrega</span>");
    expect(entrega).toBeGreaterThan(-1);
    const tag = checkout.slice(checkout.lastIndexOf("<div", entrega), entrega);
    expect(tag).toContain('className="checkout-delivery"');

    const regras: string[] = [];
    css.walkRules(".checkout-values .checkout-delivery", (regra) => {
      expect(regra.parent?.type).toBe("atrule");
      if (regra.parent?.type === "atrule") {
        expect(regra.parent.name).toBe("media");
        expect(regra.parent.params).toBe("(max-width: 359.98px)");
      }
      regra.walkDecls((declaracao) => {
        regras.push(`${declaracao.prop}: ${declaracao.value}`);
      });
    });
    expect(regras).toContain("flex-wrap: wrap");
    // O preço riscado e o preço final continuam juntos e alinhados à direita.
    const valores: string[] = [];
    css.walkRules(
      ".checkout-values .checkout-delivery > span:last-child",
      (regra) => {
        regra.walkDecls("margin-left", (declaracao) => {
          valores.push(declaracao.value);
        });
      },
    );
    expect(valores).toContain("auto");
  });

  for (const campo of ["checkout-name", "checkout-tel"]) {
    it(`rótulo ${campo} tem 11px`, () => {
      const ancora = checkout.indexOf(`htmlFor="${campo}"`);
      expect(ancora).toBeGreaterThan(-1);
      const tag = checkout.slice(
        checkout.lastIndexOf("<label", ancora),
        checkout.indexOf(">", ancora),
      );
      expect(tag).toContain("text-[11px]");
      expect(tag).not.toContain("text-[10px]");
    });
  }

  it("selo Vantagem Ativa tem 11px, sem mudar o texto", () => {
    const tag = tagAntesDoTexto(checkout, "Vantagem Ativa:");
    expect(tag).toContain("text-[11px]");
    expect(tag).not.toContain("text-[10px]");
  });

  it("Endereço Principal e CEP têm 11px", () => {
    for (const texto of ["Endereço Principal", "CEP: {address.cep}"]) {
      const tag = tagAntesDoTexto(enderecos, texto);
      expect(tag).toContain("text-[11px]");
      expect(tag).not.toMatch(/text-\[(?:8|9)px\]/);
    }
  });

  it("o cabeçalho do endereço deixa o selo quebrar sem espremer os controles", () => {
    const cabecalho = enderecos.slice(
      enderecos.indexOf("{/* Header */}"),
      enderecos.indexOf("{/* Details */}"),
    );
    expect(cabecalho).toContain(
      'className="flex min-w-0 flex-1 items-center gap-3"',
    );
    expect(cabecalho).toContain('<div className="min-w-0">');
    expect(cabecalho).toContain('className="flex shrink-0 items-center gap-2"');
    expect(cabecalho).toMatch(/size-5 shrink-0/);
  });

  it("PIX e cartão já usam a reserva da navegação + área segura", () => {
    const titulo = checkout.indexOf("Finalize o pagamento");
    expect(titulo).toBeGreaterThan(-1);
    const abertura = checkout.slice(
      checkout.lastIndexOf("<div", titulo),
      titulo,
    );
    expect(abertura).toContain("pb-customer");
    const conteudo = checkout.slice(
      titulo,
      checkout.indexOf("// `opcoesNoApp`", titulo),
    );
    expect(conteudo).toContain("<PagamentoOnline");
    expect(conteudo).toContain("metodo={metodoDoPedido}");

    const reservas: string[] = [];
    css.walkDecls("--customer-pb", (declaracao) => {
      reservas.push(declaracao.value);
    });
    expect(reservas).toHaveLength(1);
    expect(reservas[0]).toContain("var(--nav-height)");
    expect(reservas[0]).toContain("var(--safe-area-bottom, 0px)");
    const padding: string[] = [];
    css.walkRules(".pb-customer", (regra) => {
      regra.walkDecls("padding-bottom", (declaracao) => {
        padding.push(declaracao.value);
      });
    });
    expect(padding).toEqual(["var(--customer-pb)"]);
  });
});
