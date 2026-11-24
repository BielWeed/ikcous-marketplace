// A mensagem de WhatsApp do pedido "pronto para retirar" carrega endereço e
// horário da loja dentro de uma URL com teto de tamanho. Os testes vizinhos
// cobrem o corte "grosso" (5000 caracteres) e o horário estourado por folga;
// este arquivo prende as FRONTEIRAS exatas, onde um `<=` virando `<` (ou um
// 300 virando 301) manda uma mensagem cortada sem necessidade, ou, pior, uma
// URL maior que o teto:
//  - endereço: até 300 caracteres E até 950 já codificados na URL cabe inteiro;
//    um a mais em qualquer dos dois e ele é resumido (com o aviso para a
//    cliente confirmar com a loja), aproveitando o orçamento até o último byte;
//  - horário: até 200 caracteres E 650 codificados entra; passou, vira o
//    "confirme o horário" (horário nunca é cortado).
import { mensagemDoStatusNoWhatsapp } from "@/lib/mensagem-do-status-no-whatsapp";
import { describe, expect, it } from "vitest";

const retiradaPronta = {
  nomeDoCliente: "Ana",
  numeroDoPedido: "A1B2C3",
  rotuloDoStatus: "Pronto para retirar",
  nomeDaLoja: "Savy",
  status: "shipping" as const,
  retiradaNaLoja: true,
};

const AVISO_RESUMIDO = "(endereço resumido — confirme com a loja)\n";
const CONFIRME = "Confirme o horário de retirada com a loja antes de vir.\n";

function comEndereco(enderecoDeRetirada: string): string {
  return mensagemDoStatusNoWhatsapp({
    ...retiradaPronta,
    enderecoDeRetirada,
    horarioDeAtendimento: "Seg a sex",
  });
}

function comHorario(horarioDeAtendimento: string): string {
  return mensagemDoStatusNoWhatsapp({
    ...retiradaPronta,
    enderecoDeRetirada: "Rua A, 1",
    horarioDeAtendimento,
  });
}

describe("endereço de retirada — fronteira de 300 caracteres", () => {
  it("exatamente 300 caracteres vai inteiro, sem aviso de resumo", () => {
    const mensagem = comEndereco("a".repeat(300));
    expect(mensagem).toContain(`Retire em: ${"a".repeat(300)}\n`);
    expect(mensagem).not.toContain("resumido");
  });

  it("301 caracteres é resumido em 299 + reticências, com o aviso", () => {
    const mensagem = comEndereco("a".repeat(301));
    expect(mensagem).toContain(
      `Retire em: ${"a".repeat(299)}…\n${AVISO_RESUMIDO}`,
    );
  });
});

describe("endereço de retirada — fronteira de 950 caracteres codificados na URL", () => {
  // "é" vira %C3%A9 (6 caracteres na URL); 158 deles são 948, e "ab" fecha 950.
  it("exatamente 950 codificados vai inteiro", () => {
    const endereco = `${"é".repeat(158)}ab`;
    expect(encodeURIComponent(endereco).length).toBe(950);
    const mensagem = comEndereco(endereco);
    expect(mensagem).toContain(`Retire em: ${endereco}\n`);
    expect(mensagem).not.toContain("resumido");
  });

  it("951 codificados é resumido, e o resumo cabe no orçamento", () => {
    const endereco = `${"é".repeat(158)}abc`;
    expect(encodeURIComponent(endereco).length).toBe(951);
    const mensagem = comEndereco(endereco);
    const resumo = `${"é".repeat(156)}…`;
    expect(mensagem).toContain(`Retire em: ${resumo}\n${AVISO_RESUMIDO}`);
    expect(encodeURIComponent(resumo).length).toBeLessThanOrEqual(950);
  });

  it("o resumo usa o orçamento até o último caractere que cabe", () => {
    // 156 "é" (936) + 5 "a" = 941 = 950 menos os 9 das reticências: os cinco
    // "a" ainda entram; o primeiro "b" é que estoura.
    const endereco = `${"é".repeat(156)}aaaaa${"b".repeat(50)}`;
    const mensagem = comEndereco(endereco);
    const resumo = `${"é".repeat(156)}aaaaa…`;
    expect(mensagem).toContain(`Retire em: ${resumo}\n${AVISO_RESUMIDO}`);
    expect(encodeURIComponent(resumo).length).toBe(950);
  });
});

describe("horário de atendimento — fronteiras de 200 e de 650 codificados", () => {
  it("exatamente 200 caracteres entra inteiro", () => {
    const horario = "a".repeat(200);
    const mensagem = comHorario(horario);
    expect(mensagem).toContain(`Horário: ${horario}\n`);
    expect(mensagem).not.toContain(CONFIRME);
  });

  it("exatamente 650 codificados entra inteiro", () => {
    // "á" vira %C3%A1 (6): 108 deles são 648, e "ab" fecha 650.
    const horario = `${"á".repeat(108)}ab`;
    expect(encodeURIComponent(horario).length).toBe(650);
    const mensagem = comHorario(horario);
    expect(mensagem).toContain(`Horário: ${horario}\n`);
    expect(mensagem).not.toContain(CONFIRME);
  });

  it("651 codificados já não entra: a mensagem manda confirmar o horário", () => {
    const horario = `${"á".repeat(108)}abc`;
    expect(encodeURIComponent(horario).length).toBe(651);
    const mensagem = comHorario(horario);
    expect(mensagem).toContain(CONFIRME);
    expect(mensagem).not.toContain("Horário: ");
  });
});
