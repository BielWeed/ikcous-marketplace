// A busca da lista de escolha com as opções REAIS de duas telas do financeiro.
//
//   - Parcelas: o rótulo usa o sinal de vezes ("12×"); quem digita "12x" no teclado não
//     achava nada. Os `termos` escondidos dão "12x", "12 x" e "12 vezes".
//   - Mês do Exportar para o contador: quem pensa no número ("3", "03") não achava "Março".
import { OPCOES_DE_PARCELAS } from "@/components/admin/financeiro/NovoLancamentoFolha";
import { OPCOES_DO_MES } from "@/components/admin/financeiro/impostos/ExportarParaContador";
import { filtrarOpcoes } from "@/components/admin/primitivos/lista-de-escolha/busca";
import type { OpcaoDaLista } from "@/components/admin/primitivos/lista-de-escolha/tipos";
import { describe, expect, it, vi } from "vitest";

// As opções moram no arquivo da tela, que importa o cliente do banco; aqui só se lê a lista.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

const rotulos = (lista: readonly OpcaoDaLista[]) => lista.map((o) => o.rotulo);

describe("Parcelas: a busca acha pelo que se digita no teclado", () => {
  it.each(["12x", "12 x", "12 vezes", "12X"])('"%s" acha "12×"', (termo) => {
    expect(rotulos(filtrarOpcoes(OPCOES_DE_PARCELAS, termo))).toContain("12×");
  });

  it('"12x" não traz parcela que não termina em 12', () => {
    // `includes`: "12x" bate em "12x" e em "112x"... mas nunca em "13x" nem "21x".
    const achadas = rotulos(filtrarOpcoes(OPCOES_DE_PARCELAS, "12x"));
    expect(achadas).not.toContain("13×");
    expect(achadas).not.toContain("21×");
    expect(achadas).toEqual(["12×"]);
  });

  it('"1x" acha o à vista', () => {
    expect(rotulos(filtrarOpcoes(OPCOES_DE_PARCELAS, "1x"))).toContain(
      "À vista (1×)",
    );
  });
});

describe("Mês do Exportar para o contador: a busca acha pelo número", () => {
  it.each(["3", "03"])('"%s" acha "Março"', (termo) => {
    expect(rotulos(filtrarOpcoes(OPCOES_DO_MES, termo))).toContain("Março");
  });

  it('"03" acha só "Março"', () => {
    expect(rotulos(filtrarOpcoes(OPCOES_DO_MES, "03"))).toEqual(["Março"]);
  });

  it('"12" acha "Dezembro" e o nome continua achando', () => {
    expect(rotulos(filtrarOpcoes(OPCOES_DO_MES, "12"))).toEqual(["Dezembro"]);
    expect(rotulos(filtrarOpcoes(OPCOES_DO_MES, "marco"))).toEqual(["Março"]);
  });
});
