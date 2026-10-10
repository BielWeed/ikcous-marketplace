// `admin-glass` não divide o elemento com classe que ele apaga.
//
// Medido compilando o CSS: `.admin-glass` (src/index.css, `@layer utilities`) sai
// DEPOIS de toda utilitária sem variante e ANTES das com variante (`sm:`, `hover:`,
// `group-hover:` vencem). Ele fixa `border-width:1px`, `border-color:white/5`,
// `background:zinc-950/40`, `shadow-2xl` e `backdrop-blur(40px)`. Logo, no mesmo
// `className`, perdem: `bg-*`, `border` de lado/cor (`border-y`, `border-b`,
// `border-amber-…`), `shadow-*` e `backdrop-blur-*` que não sejam os mesmos valores.
// A classe que perde é código morto que PARECE valer (o aviso âmbar que nunca aparece).
//
// Esta guarda varre src/views/admin/** e src/components/admin/**, pega cada literal
// ("…", '…', `…`) que contém `admin-glass` e reprova as classes sem variante que
// ele apaga. Corrija assim: se a classe tem sentido (cor de alerta), tire
// `admin-glass` e escreva por extenso `border bg-zinc-950/40 shadow-2xl
// backdrop-blur-2xl` + a classe pretendida; se é só sombra/borda alternativa, apague-a.
//
// EXCEÇÕES: lista que só desce. Uma exceção que não casa mais FALHA ("apague a
// exceção"), para a lista não virar licença.
/* eslint-disable security/detect-non-literal-fs-filename --
   varredura da própria árvore do repositório (caminhos vêm do disco, não de entrada de usuário) */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");
const PASTAS_VARRIDAS = ["src/views/admin", "src/components/admin"];

/** Classes que o `.admin-glass` já fixa com o MESMO valor: não perdem nada. */
const REDUNDANTES = new Set([
  "border",
  "border-white/5",
  "shadow-2xl",
  "bg-zinc-950/40",
  "backdrop-blur-2xl",
]);
/** `border-solid` etc. são estilo/modo da borda, não cor nem lado: não são apagadas. */
const BORDA_QUE_NAO_E_COR =
  /^border-(solid|dashed|dotted|double|none|hidden|collapse|separate|spacing)/;
const CLASSE_QUE_PERDE = /^(bg-|border(-|$)|shadow(-|$)|backdrop-blur(-|$))/;

/** As classes de UM literal que `admin-glass` apaga (vazio se o literal não o usa). */
function classesQuePerdem(literal: string): string[] {
  const classes = literal.split(/\s+/).filter(Boolean);
  if (!classes.includes("admin-glass")) return [];
  return classes.filter(
    (classe) =>
      !classe.includes(":") &&
      CLASSE_QUE_PERDE.test(classe) &&
      !BORDA_QUE_NAO_E_COR.test(classe) &&
      !REDUNDANTES.has(classe),
  );
}

type Excecao = { arquivo: string; classe: string; motivo: string };

const EXCECOES: Excecao[] = [
  {
    arquivo: "src/views/admin/AdminLoginView.tsx",
    classe: "border-b",
    motivo:
      "login é mapa de risco (caminho *login*), fora da onda K; o border-b perdido fica para a onda L",
  },
  // PROVISÓRIAS: corrigidas pela frente produtos-acabamento. O integrador apaga estas
  // três depois de integrar as duas frentes (a guarda acusa "exceção que não casa mais").
  {
    arquivo: "src/views/admin/AdminProductsView.tsx",
    classe: "shadow-[0_20px_50px_rgba(0,0,0,0.3)]",
    motivo:
      "corrigida pela frente produtos-acabamento; o integrador apaga esta exceção depois de integrar as duas",
  },
  {
    arquivo: "src/views/admin/AdminProductsView.tsx",
    classe: "shadow-lg",
    motivo:
      "corrigida pela frente produtos-acabamento; o integrador apaga esta exceção depois de integrar as duas",
  },
  {
    arquivo: "src/views/admin/AdminProductsView.tsx",
    classe: "border-y",
    motivo:
      "corrigida pela frente produtos-acabamento; o integrador apaga esta exceção depois de integrar as duas",
  },
];

function arquivosDe(pasta: string): string[] {
  const achados: string[] = [];
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) achados.push(...arquivosDe(caminho));
    else if (/\.tsx?$/.test(nome)) achados.push(caminho);
  }
  return achados;
}

function ehLinhaDeComentario(linha: string): boolean {
  const limpa = linha.trim();
  return (
    limpa.startsWith("//") ||
    limpa.startsWith("/*") ||
    limpa.startsWith("*") ||
    limpa.startsWith("{/*")
  );
}

/** Troca a linha de comentário por linha vazia (mesmo critério da régua visual). */
function semComentarios(texto: string): string {
  return texto
    .split("\n")
    .map((linha) => (ehLinhaDeComentario(linha) ? "" : linha))
    .join("\n");
}

/** Cada literal "…", '…' ou `…` do texto que contém a palavra `admin-glass`. */
function literaisComAdminGlass(texto: string): string[] {
  const achados: string[] = [];
  for (const achado of semComentarios(texto).matchAll(
    /"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g,
  )) {
    const literal = achado[1] ?? achado[2] ?? achado[3] ?? "";
    if (/(^|[\s])admin-glass(?=[\s]|$)/.test(literal)) achados.push(literal);
  }
  return achados;
}

type Varredura = {
  arquivosComAdminGlass: string[];
  /** arquivo (relativo à raiz, com "/") -> classes que perdem (únicas) */
  perdem: Map<string, Set<string>>;
};

function varrer(): Varredura {
  const arquivosComAdminGlass: string[] = [];
  const perdem = new Map<string, Set<string>>();
  for (const pasta of PASTAS_VARRIDAS) {
    for (const caminho of arquivosDe(join(RAIZ, pasta))) {
      const literais = literaisComAdminGlass(readFileSync(caminho, "utf8"));
      if (literais.length === 0) continue;
      const nome = relative(RAIZ, caminho).split(sep).join("/");
      arquivosComAdminGlass.push(nome);
      for (const literal of literais) {
        for (const classe of classesQuePerdem(literal)) {
          const set = perdem.get(nome) ?? new Set<string>();
          set.add(classe);
          perdem.set(nome, set);
        }
      }
    }
  }
  return { arquivosComAdminGlass, perdem };
}

describe("classesQuePerdem (o critério da guarda)", () => {
  it("as redundantes não perdem nada", () => {
    expect(
      classesQuePerdem(
        "admin-glass relative border border-white/5 shadow-2xl bg-zinc-950/40 backdrop-blur-2xl p-4",
      ),
    ).toEqual([]);
  });

  it("classe com variante vence o admin-glass, então não é acusada", () => {
    expect(
      classesQuePerdem(
        "admin-glass sm:border-x group-hover:border-white/10 hover:bg-white/5 sm:shadow-lg",
      ),
    ).toEqual([]);
  });

  it("estilo da borda (solid, dashed…) não é cor nem lado", () => {
    expect(classesQuePerdem("admin-glass border-dashed border-none")).toEqual(
      [],
    );
  });

  it("borda de lado perde", () => {
    expect(classesQuePerdem("admin-glass border-y border-white/5 p-3")).toEqual(
      ["border-y"],
    );
  });

  it("cor de borda perde", () => {
    expect(
      classesQuePerdem("admin-glass rounded-2xl border-amber-500/20"),
    ).toEqual(["border-amber-500/20"]);
  });

  it("fundo, sombra e desfoque diferentes perdem", () => {
    expect(
      classesQuePerdem("admin-glass bg-amber-500/5 shadow-lg backdrop-blur-sm"),
    ).toEqual(["bg-amber-500/5", "shadow-lg", "backdrop-blur-sm"]);
  });

  it("literal sem admin-glass não é da conta desta guarda", () => {
    expect(classesQuePerdem("border-y shadow-lg bg-red-500")).toEqual([]);
    expect(classesQuePerdem("not-admin-glass border-y")).toEqual([]);
  });
});

describe("admin-glass sem classe que perde (varredura do painel)", () => {
  const { arquivosComAdminGlass, perdem } = varrer();

  it("controle positivo: a varredura acha admin-glass em pelo menos 15 arquivos", () => {
    // Eram 20 antes de Devoluções e Alertas trocarem o admin-glass por classes por
    // extenso (18 hoje). O piso só existe para a regex não virar vácuo.
    expect(arquivosComAdminGlass.length).toBeGreaterThanOrEqual(15);
  });

  it("nenhum literal com admin-glass carrega classe que ele apaga (fora das exceções)", () => {
    const acusacoes: string[] = [];
    for (const [arquivo, classes] of perdem) {
      for (const classe of classes) {
        const excecao = EXCECOES.some(
          (e) => e.arquivo === arquivo && e.classe === classe,
        );
        if (!excecao)
          acusacoes.push(`${arquivo}: "${classe}" perde para o admin-glass`);
      }
    }
    expect(
      acusacoes,
      `Classe apagada pelo admin-glass: tire o admin-glass e escreva a borda/fundo por extenso, ou apague a classe morta.\n${acusacoes.join("\n")}`,
    ).toEqual([]);
  });

  it("toda exceção ainda casa (senão: apague a exceção)", () => {
    const orfas = EXCECOES.filter(
      (e) => !perdem.get(e.arquivo)?.has(e.classe),
    ).map(
      (e) =>
        `${e.arquivo}: "${e.classe}" já não perde — apague a exceção (${e.motivo})`,
    );
    expect(orfas).toEqual([]);
  });
});
