// @vitest-environment jsdom
//
// Onda L · L1 (ajustes-e-pagamentos): alvos de toque de 44px em Ajustes
// (cabeçalhos dos grupos e termômetro do PIX), nas formas de pagamento
// (interruptores dentro de <label> de 44px) e na seção do Mercado Pago
// (cabeçalho do expansor, botões e campos) — só classe, nenhum comportamento.
//
// O jsdom não aplica CSS: a prova de toque/layout é sobre a CLASSE (estática,
// lendo a fonte pelo marcador de texto). A medida real em pixels é do render
// do integrador.
/* eslint-disable security/detect-non-literal-fs-filename --
   leitura dos próprios arquivos-fonte do repositório (caminhos constantes deste teste, não entrada de usuário) */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");
const lerFonte = (caminho: string): string =>
  readFileSync(join(RAIZ, caminho), "utf8");

const AJUSTES = "src/views/admin/AdminSettingsView.tsx";
const PIX = "src/views/admin/StatusPagamentoPix.tsx";
const FORMAS = "src/components/admin/settings/FormasDePagamentoCard.tsx";
const MERCADO_PAGO = "src/components/admin/settings/MercadoPagoSection.tsx";

/** Posição da última abertura de `<tag` antes de `indice` (-1 se não houver). */
function ultimaAbertura(fonte: string, tag: string, indice: number): number {
  const abertura = `<${tag}`;
  for (let i = fonte.lastIndexOf(abertura, indice); i >= 0; ) {
    // `<p` não pode casar `<path`: o caractere seguinte tem de ser espaço ou `>`.
    if (/[\s>]/.test(fonte.charAt(i + abertura.length))) return i;
    i = i === 0 ? -1 : fonte.lastIndexOf(abertura, i - 1);
  }
  return -1;
}

/** A tag de abertura inteira (`<button … >`), respeitando `{}` e aspas. */
function tagDeAbertura(fonte: string, inicio: number): string {
  let profundidade = 0;
  let aspas: string | null = null;
  for (let i = inicio; i < fonte.length; i++) {
    const c = fonte.charAt(i);
    if (aspas) {
      if (c === aspas) aspas = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") aspas = c;
    else if (c === "{") profundidade++;
    else if (c === "}") profundidade--;
    else if (c === ">" && profundidade === 0) return fonte.slice(inicio, i + 1);
  }
  throw new Error("tag sem fechamento");
}

/** Toda abertura de `<tag` cuja tag de abertura contém o marcador. */
function aberturasComMarcador(
  fonte: string,
  tag: string,
  marcador: string,
): string[] {
  const achadas: string[] = [];
  for (
    let i = fonte.indexOf(marcador);
    i >= 0;
    i = fonte.indexOf(marcador, i + 1)
  ) {
    const inicio = ultimaAbertura(fonte, tag, i);
    expect(inicio, `<${tag}> não envolve ${marcador}`).toBeGreaterThan(-1);
    const aberta = tagDeAbertura(fonte, inicio);
    if (aberta.includes(marcador) && !achadas.includes(aberta)) {
      achadas.push(aberta);
    }
  }
  expect(achadas.length, `marcador ausente: ${marcador}`).toBeGreaterThan(0);
  return achadas;
}

/** Aberturas de `<label` cujo corpo (até `</label>`) contém `trecho`. */
function labelsCom(fonte: string, trecho: string): string[] {
  const achadas: string[] = [];
  const re = /<label(?=[\s>])/g;
  for (let m = re.exec(fonte); m; m = re.exec(fonte)) {
    const fim = fonte.indexOf("</label>", m.index);
    if (fonte.slice(m.index, fim).includes(trecho)) {
      achadas.push(tagDeAbertura(fonte, m.index));
    }
  }
  return achadas;
}

const MIN_H_11 = /\bmin-h-11\b/;

describe("L1 · Ajustes: cabeçalhos dos grupos e termômetro do PIX com 44px (estático)", () => {
  const fonte = lerFonte(AJUSTES);

  it("(a) o cabeçalho da SecaoColapsavel (button[aria-expanded]) tem min-h-11", () => {
    const [tag] = aberturasComMarcador(
      fonte,
      "button",
      "aria-expanded={aberta}",
    );
    expect(tag).toContain('type="button"');
    expect(tag).toMatch(MIN_H_11);
  });

  it("(b) o cabeçalho do Diagnóstico de Conexão tem min-h-11", () => {
    const [tag] = aberturasComMarcador(
      fonte,
      "button",
      "aria-expanded={isOpen}",
    );
    expect(tag).toMatch(MIN_H_11);
  });

  it("(c) o botão do termômetro do PIX tem min-h-11", () => {
    const [tag] = aberturasComMarcador(
      lerFonte(PIX),
      "button",
      "aria-expanded={aberto}",
    );
    expect(tag).toMatch(MIN_H_11);
  });
});

describe("L1 · Formas de pagamento: interruptores dentro de <label> de 44px (estático)", () => {
  const fonte = lerFonte(FORMAS);

  it("(a) as 3 formas na entrega: o Switch mora num <label> min-h-11", () => {
    const labels = labelsCom(fonte, "aria-label={ARIA_DA_FORMA.get(forma)}");
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatch(MIN_H_11);
    expect(labels[0]).toMatch(/\bcursor-pointer\b/);
    expect(labels[0]).toContain("has-[:disabled]:cursor-not-allowed");
  });

  it("(b) Crédito: o Switch mora num <label> min-h-11", () => {
    const labels = labelsCom(fonte, 'aria-label="Cartão de crédito pelo app"');
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatch(MIN_H_11);
    expect(labels[0]).toContain("has-[:disabled]:cursor-not-allowed");
  });

  it("(c) Débito: o Switch mora num <label> min-h-11", () => {
    const labels = labelsCom(fonte, 'aria-label="Cartão de débito pelo app"');
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatch(MIN_H_11);
    expect(labels[0]).toContain("has-[:disabled]:cursor-not-allowed");
  });

  it("(d) o <select> das parcelas tem min-h-11", () => {
    const [tag] = aberturasComMarcador(fonte, "select", "id={idDasParcelas}");
    expect(tag).toMatch(MIN_H_11);
  });
});

describe("L1 · Mercado Pago: botões e campos com 44px (estático)", () => {
  const fonte = lerFonte(MERCADO_PAGO);

  it("(a) o cabeçalho do Expansor tem min-h-11", () => {
    const [tag] = aberturasComMarcador(fonte, "button", "onClick={onAlternar}");
    expect(tag).toContain("aria-expanded={aberto}");
    expect(tag).toMatch(MIN_H_11);
  });

  it.each([
    ["Tentar de novo", "onClick={ler}"],
    ["Copiar prompt", "onClick={copiarPrompt}"],
    ["Salvar chaves", "onClick={salvar}"],
    ["Testar conexão (formulário e aviso)", "onClick={testarConexao}"],
    [
      "Desligar/Ligar o pagamento pelo app",
      "onClick={() => pausarOuRetomar(!config.pix_ligado)}",
    ],
    ["Pausar", "onClick={() => pausarOuRetomar(false)}"],
    ["Retomar", "onClick={() => pausarOuRetomar(true)}"],
  ])("(b) o botão %s tem min-h-11", (_nome, marcador) => {
    const tags = aberturasComMarcador(fonte, "button", marcador);
    for (const tag of tags) expect(tag).toMatch(MIN_H_11);
  });

  it("(b2) 'Testar conexão' aparece em dois botões e os dois têm min-h-11", () => {
    expect(
      aberturasComMarcador(fonte, "button", "onClick={testarConexao}"),
    ).toHaveLength(2);
  });

  it.each(["mp-public-key", "mp-access-token", "mp-webhook-secret"])(
    "(c) o campo %s tem h-11 (não h-9)",
    (id) => {
      const [tag] = aberturasComMarcador(fonte, "input", `id="${id}"`);
      expect(tag).toMatch(/\bh-11\b/);
      expect(tag).not.toMatch(/\bh-9\b/);
    },
  );
});
