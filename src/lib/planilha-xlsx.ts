import type { CelulaDoProduto } from "./exportar-produtos-planilha";

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function escapar(valor: string): string {
  // XML 1.0: mantém tab/LF/CR e pares de surrogates (emoji), nunca controles ou surrogates soltos.
  return [...valor]
    .filter((caractere) => {
      const n = caractere.codePointAt(0)!;
      return (
        n === 9 ||
        n === 10 ||
        n === 13 ||
        (n >= 32 && n <= 0xd7ff) ||
        (n >= 0xe000 && n <= 0xfffd) ||
        n >= 0x10000
      );
    })
    .join("")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/\r/g, "&#13;");
}

function coluna(indice: number): string {
  let nome = "";
  for (let n = indice + 1; n > 0; n = Math.floor((n - 1) / 26))
    nome = String.fromCharCode(65 + ((n - 1) % 26)) + nome;
  return nome;
}

const tabelaCrc = Uint32Array.from({ length: 256 }, (_, indice) => {
  let n = indice;
  for (let bit = 0; bit < 8; bit++)
    n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});

/** ZIP clássico, método store: sem dependência, compressão, descritor ou ZIP64. */
function zipStore(arquivos: Record<string, string>): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const locais: Uint8Array[] = [];
  const centrais: Uint8Array[] = [];
  let posicao = 0;
  for (const [caminho, xml] of Object.entries(arquivos)) {
    const nome = encoder.encode(caminho); // Nomes internos são ASCII.
    const dados = encoder.encode(XML + xml);
    let crc = 0xffffffff;
    for (const byte of dados) crc = (crc >>> 8) ^ tabelaCrc[(crc ^ byte) & 255];
    crc = (crc ^ 0xffffffff) >>> 0;
    if (posicao + 30 + nome.length + dados.length > 0xffffffff)
      throw new Error("Planilha grande demais para ZIP clássico.");
    const local = new Uint8Array(30 + nome.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(12, 33, true); // Data DOS: 01/01/1980, fixa e válida.
    l.setUint32(14, crc, true);
    l.setUint32(18, dados.length, true);
    l.setUint32(22, dados.length, true);
    l.setUint16(26, nome.length, true);
    local.set(nome, 30);
    locais.push(local, dados);

    const central = new Uint8Array(46 + nome.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(14, 33, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, dados.length, true);
    c.setUint32(24, dados.length, true);
    c.setUint16(28, nome.length, true);
    c.setUint32(42, posicao, true);
    central.set(nome, 46);
    centrais.push(central);
    posicao += local.length + dados.length;
  }
  const tamanhoCentral = centrais.reduce(
    (soma, parte) => soma + parte.length,
    0,
  );
  if (posicao + tamanhoCentral + 22 > 0xffffffff)
    throw new Error("Planilha grande demais para ZIP clássico.");
  const fim = new Uint8Array(22);
  const f = new DataView(fim.buffer);
  f.setUint32(0, 0x06054b50, true);
  f.setUint16(8, centrais.length, true);
  f.setUint16(10, centrais.length, true);
  f.setUint32(12, tamanhoCentral, true);
  f.setUint32(16, posicao, true);
  const zip = new Uint8Array(posicao + tamanhoCentral + fim.length);
  let offset = 0;
  for (const parte of [...locais, ...centrais, fim]) {
    zip.set(parte, offset);
    offset += parte.length;
  }
  return zip;
}

/** As linhas já vêm da função pura do catálogo, com sua proteção extra contra fórmulas. */
export function gerarXlsx(
  linhas: readonly (readonly CelulaDoProduto[])[],
): Uint8Array<ArrayBuffer> {
  const titulos = linhas[0];
  if (!titulos?.length || titulos.length > 16384 || linhas.length > 1048576)
    throw new Error("Dimensões fora do limite da planilha.");
  const area = `A1:${coluna(titulos.length - 1)}${linhas.length}`;
  const formatos = titulos.map((titulo) =>
    String(titulo).includes("(R$)")
      ? 2
      : titulo === "Margem (%)"
        ? 4
        : ["Estoque", "Vendidos", "Estoque mínimo"].includes(String(titulo))
          ? 3
          : 0,
  );
  const colunas = titulos
    .map((titulo, i) => {
      const largura =
        titulo === "Nome"
          ? 36
          : titulo === "Descrição"
            ? 60
            : String(titulo).includes("Foto")
              ? 50
              : String(titulo).startsWith("ID ")
                ? 38
                : String(titulo).endsWith(" em")
                  ? 26
                  : 22;
      return `<col min="${i + 1}" max="${i + 1}" width="${largura}" customWidth="1"/>`;
    })
    .join("");
  const dados = linhas
    .map((linha, r) => {
      if (linha.length !== titulos.length) throw new Error("Linha incompleta.");
      const celulas = linha
        .map((valor, i) => {
          const estilo = r === 0 ? 1 : (formatos.at(i) ?? 0);
          const atributos = `r="${coluna(i)}${r + 1}" s="${estilo}"`;
          if (typeof valor === "number") {
            if (!Number.isFinite(valor)) throw new Error("Número inválido.");
            return `<c ${atributos}><v>${estilo === 4 ? valor / 100 : valor}</v></c>`;
          }
          if (valor.length > 32767)
            throw new Error("Texto maior que o limite do XLSX.");
          // inlineStr nunca vira fórmula; a neutralização das linhas permanece por defesa extra.
          return `<c ${atributos} t="inlineStr"><is><t xml:space="preserve">${escapar(valor)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}"${r === 0 ? ' ht="30" customHeight="1"' : ""}>${celulas}</row>`;
    })
    .join("");
  return zipStore({
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="Produtos" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5">${[0, 0, 4, 1, 10].map((formato, i) => `<xf numFmtId="${formato}" fontId="${i === 1 ? 1 : 0}" fillId="${i === 1 ? 2 : 0}" borderId="0" xfId="0" applyAlignment="1" applyNumberFormat="1"><alignment vertical="top" wrapText="1"/></xf>`).join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="${NS}"><dimension ref="${area}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${colunas}</cols><sheetData>${dados}</sheetData><autoFilter ref="${area}"/></worksheet>`,
  });
}
