// GUARDA DO ERRO CRU NO PAINEL — painel simples, G10 (spec §6). O texto que
// vem de um erro (`error.message` do Postgres/Supabase, "Failed to fetch",
// "JWT expired", "new row violates row-level security policy…") não é
// palavra de lojista. Nenhum toast do painel pode jogá-lo na tela: o painel
// diz o que aconteceu e o que fazer (`mensagemDeErroDoPainel`, ou frase fixa
// escrita para a ação) e deixa o texto cru no console.
//
// Varre src/views/admin/** e src/components/admin/** (as mesmas pastas da
// guarda de jargão) e reprova toda chamada `toast.error|warning|info|message(…)`
// cujos argumentos — incluindo `{ description: … }`, em várias linhas —
// contenham `.message`, `.details` ou `.hint` de um erro. Texto entre aspas
// não conta; template (`${err.message}`) conta. Linha de comentário não conta.
//
// Limite conhecido: a guarda só enxerga o texto da própria chamada. Guardar
// `const msg = err.message` e depois `toast.error(msg)` passa; o caminho
// honesto é nem ler `.message` perto do toast.
//
// A ALLOWLIST é de propósito curta e cada entrada traz o porquê. Entra só
// texto que o próprio sistema escreveu em português para o lojista:
//   - a recusa de negócio do servidor (SQLSTATE 22023) em AdminOrdersView;
//   - a mensagem já curada por `salvarConfigDoCartao` (src/lib/config-do-cartao.ts)
//     em FormasDePagamentoCard.
// NÃO trocar `useOrders.ts` (`description: err?.message`): as RPCs de pedido
// levantam frases em português com P0001 ("Pedido cancelado não recebe
// pagamento.") e `mensagemDeErroDoPainel` as esconderia; está fora das pastas
// varridas de propósito.
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
   varredura da própria árvore do repositório (caminhos vêm do disco, não de entrada de usuário) */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");
const PASTAS_VARRIDAS = ["src/views/admin", "src/components/admin"];

/** Chamadas de toast que mostram texto ao lojista. */
const ABRE_TOAST = /\btoast\.(?:error|warning|info|message)\s*\(/g;
/** O texto cru do erro: `.message`, `.details`, `.hint` (com ou sem `?.`). */
const TEXTO_CRU = /\.(?:message|details|hint)\b/;

type Achado = { arquivo: string; linha: number; chamada: string };

type Excecao = {
  /** Caminho relativo à raiz, com `/`. */
  arquivo: string;
  /** Trecho que a chamada tem que conter (a exceção é só dessa chamada). */
  chamadaContem: string;
  /** Regex que tem que casar nos 900 caracteres ANTES da chamada. */
  contexto: RegExp;
  motivo: string;
};

const EXCECOES: Excecao[] = [
  {
    arquivo: "src/views/admin/AdminOrdersView.tsx",
    chamadaContem: "toast.error(error.message)",
    contexto: /code\s*===\s*"22023"/,
    motivo:
      "Recusa de NEGÓCIO do servidor (SQLSTATE 22023) em registrar_estorno_manual: texto leigo escrito para o lojista ('o Mercado Pago já está devolvendo… faça pelo painel do Mercado Pago'). Trocar por 'Tente de novo' empurraria o lojista a pagar por fora.",
  },
  {
    arquivo: "src/components/admin/settings/FormasDePagamentoCard.tsx",
    chamadaContem: "err instanceof Error",
    contexto: /salvarConfigDoCartao/,
    motivo:
      "O erro vem de salvarConfigDoCartao (src/lib/config-do-cartao.ts), que lança só frases curadas em português ('Só o administrador da loja pode mudar o cartão pelo app.'); o texto cru do Postgres fica no console lá.",
  },
];

function ehLinhaDeComentario(linha: string): boolean {
  const limpa = linha.trim();
  return (
    limpa.startsWith("//") ||
    limpa.startsWith("/*") ||
    limpa.startsWith("*") ||
    limpa.startsWith("{/*")
  );
}

/** Troca a linha de comentário por linha vazia (os índices do resto ficam). */
function semComentarios(texto: string): string {
  return texto
    .split("\n")
    .map((linha) => (ehLinhaDeComentario(linha) ? "" : linha))
    .join("\n");
}

/** Texto entre aspas simples/duplas some; template fica (tem `${…}`). */
function semStrings(texto: string): string {
  return texto.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');
}

/** Do `(` já aberto em `abre`, devolve os argumentos até o `)` que o fecha. */
function argumentosDe(texto: string, abre: number): string {
  let profundidade = 0;
  let aspas: string | null = null;
  for (let i = abre; i < texto.length && i < abre + 2500; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === "\\") i++;
      else if (c === aspas) aspas = null;
      continue;
    }
    // Aspas simples/duplas escondem parêntese de frase; o template não
    // esconde nada (o `${err.message}` dentro dele é justamente o alvo).
    if (c === '"' || c === "'") aspas = c;
    else if (c === "(") profundidade++;
    else if (c === ")") {
      profundidade--;
      if (profundidade === 0) return texto.slice(abre, i + 1);
    }
  }
  return texto.slice(abre, abre + 2500);
}

function liberadoPelaAllowlist(
  arquivo: string,
  textoAntes: string,
  chamada: string,
): boolean {
  return EXCECOES.some(
    (e) =>
      e.arquivo === arquivo &&
      chamada.includes(e.chamadaContem) &&
      e.contexto.test(textoAntes.slice(-900)),
  );
}

/** Toasts do arquivo que mostram texto cru de erro, fora da allowlist. */
function acharErroCru(textoBruto: string, arquivo: string): Achado[] {
  const texto = semComentarios(textoBruto);
  const achados: Achado[] = [];
  for (const abertura of texto.matchAll(ABRE_TOAST)) {
    const inicio = abertura.index ?? 0;
    const abre = inicio + abertura[0].length - 1;
    const argumentos = argumentosDe(texto, abre);
    if (!TEXTO_CRU.test(semStrings(argumentos))) continue;
    // A chamada inteira, numa linha só: é o que a allowlist confere e o que
    // o relatório mostra.
    const chamada = `${abertura[0]}${argumentos.slice(1)}`
      .replace(/\s+/g, " ")
      .trim();
    if (liberadoPelaAllowlist(arquivo, texto.slice(0, inicio), chamada)) {
      continue;
    }
    achados.push({
      arquivo,
      linha: texto.slice(0, inicio).split("\n").length,
      chamada,
    });
  }
  return achados;
}

function arquivosDe(pasta: string): string[] {
  const achados: string[] = [];
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) achados.push(...arquivosDe(caminho));
    else if (/\.tsx?$/.test(nome)) achados.push(caminho);
  }
  return achados;
}

function varrer(raiz: string, pastas: string[]): Achado[] {
  const achados: Achado[] = [];
  for (const pasta of pastas) {
    for (const caminho of arquivosDe(join(raiz, pasta))) {
      const rel = relative(raiz, caminho).split(sep).join("/");
      achados.push(...acharErroCru(readFileSync(caminho, "utf8"), rel));
    }
  }
  return achados;
}

describe("painel sem erro cru — toast não mostra error.message", () => {
  it("nenhum toast de src/views/admin ou src/components/admin mostra texto cru de erro", () => {
    const achados = varrer(RAIZ, PASTAS_VARRIDAS);
    expect(
      achados.map((a) => `${a.arquivo}:${a.linha}  ${a.chamada}`),
      "Toast com texto cru de erro. Use mensagemDeErroDoPainel(erro, 'a ação') ou uma frase fixa em palavras de lojista (o cru fica no console). Só texto que o sistema escreveu para o lojista entra na allowlist, com motivo.",
    ).toEqual([]);
  });

  describe("controle positivo — a guarda pega o que deve pegar", () => {
    const PEGA = [
      ["toast.error(e.message)", "toast.error(e.message);"],
      ["err?.message", "toast.error(err?.message ?? 'x');"],
      [
        "error.message com texto ao lado",
        'toast.error("Falhou: " + error.message);',
      ],
      [
        "template com ${err.message}",
        "toast.error(`Não salvou: ${err.message}`);",
      ],
      [
        "description em várias linhas",
        'toast.error("Não salvou", {\n  description: error.message,\n});',
      ],
      [
        "ternário em várias linhas",
        'toast.error(\n  err instanceof Error\n    ? err.message\n    : "Tente de novo.",\n);',
      ],
      ["toast.warning", "toast.warning(error.message);"],
      ["toast.info", "toast.info(e.message);"],
      ["toast.message", "toast.message(e.message);"],
      ["details do Postgres", "toast.error(error.details);"],
      ["hint do Postgres", "toast.error(erro.hint);"],
    ] as const;

    for (const [nome, codigo] of PEGA) {
      it(`pega: ${nome}`, () => {
        expect(acharErroCru(codigo, "src/views/admin/Fake.tsx")).toHaveLength(
          1,
        );
      });
    }

    const NAO_PEGA = [
      ["frase fixa", 'toast.error("Não consegui salvar. Tente de novo.");'],
      [
        "frase fixa com description fixa",
        'toast.error("Não salvou", { description: "Confira sua conexão." });',
      ],
      [
        "mensagemDeErroDoPainel",
        'toast.error(mensagemDeErroDoPainel(error, "salvar o produto"));',
      ],
      [
        "a palavra .message dentro de uma frase",
        'toast.error("Use .message com cuidado");',
      ],
      ["toast.success", "toast.success(`Salvo: ${resposta.message}`);"],
      ["comentário", "// toast.error(e.message);"],
      ["bloco de comentário", "/*\n * toast.error(err.message)\n */"],
      [
        "console.error com o cru",
        'console.error("falhou:", e.message);\ntoast.error("Tente de novo.");',
      ],
    ] as const;

    for (const [nome, codigo] of NAO_PEGA) {
      it(`deixa passar: ${nome}`, () => {
        expect(acharErroCru(codigo, "src/views/admin/Fake.tsx")).toEqual([]);
      });
    }
  });

  describe("a allowlist é estreita", () => {
    const BLOCO_22023 = `
      if (error) {
        if (
          (error as { code?: string }).code === "22023" &&
          error.message.trim() !== ""
        ) {
          toast.error(error.message);
          return;
        }
      }`;

    it("a exceção 22023 de AdminOrdersView passa", () => {
      expect(
        acharErroCru(BLOCO_22023, "src/views/admin/AdminOrdersView.tsx"),
      ).toEqual([]);
    });

    it("o MESMO trecho em outro arquivo é pego (a exceção é por arquivo)", () => {
      expect(
        acharErroCru(BLOCO_22023, "src/views/admin/AdminOutraView.tsx"),
      ).toHaveLength(1);
    });

    it("em AdminOrdersView, um toast cru SEM o 22023 antes é pego", () => {
      const solto = `
        try { await x(); } catch (error) {
          toast.error(error.message);
        }`;
      expect(
        acharErroCru(solto, "src/views/admin/AdminOrdersView.tsx"),
      ).toHaveLength(1);
    });

    it("em AdminOrdersView, outro toast cru ao lado do 22023 é pego", () => {
      const dois = `${BLOCO_22023}
        toast.error(e.message);`;
      const achados = acharErroCru(dois, "src/views/admin/AdminOrdersView.tsx");
      expect(achados).toHaveLength(1);
      expect(achados[0].chamada).toContain("toast.error(e.message)");
    });

    it("a mensagem curada de FormasDePagamentoCard passa; em outro arquivo, não", () => {
      const curada = `
        const gravada = await salvarConfigDoCartao(desejada);
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : "Não foi possível salvar o cartão pelo app.",
        );`;
      expect(
        acharErroCru(
          curada,
          "src/components/admin/settings/FormasDePagamentoCard.tsx",
        ),
      ).toEqual([]);
      expect(
        acharErroCru(curada, "src/components/admin/settings/OutroCard.tsx"),
      ).toHaveLength(1);
    });

    it("toda exceção da allowlist tem motivo escrito", () => {
      for (const e of EXCECOES) {
        expect(e.motivo.length, e.arquivo).toBeGreaterThan(40);
      }
    });
  });

  describe("a varredura de pastas acha o arquivo ruim (mutação)", () => {
    it("uma árvore com um toast cru reprova; sem ele, passa", () => {
      const raiz = mkdtempSync(join(tmpdir(), "erro-cru-"));
      try {
        const pasta = join(raiz, "src", "views", "admin");
        mkdirSync(pasta, { recursive: true });
        writeFileSync(
          join(pasta, "Limpa.tsx"),
          'toast.error("Não consegui salvar. Tente de novo.");\n',
        );
        expect(varrer(raiz, ["src/views/admin"])).toEqual([]);

        writeFileSync(
          join(pasta, "Suja.tsx"),
          "try {} catch (e) {\n  toast.error(e.message);\n}\n",
        );
        const achados = varrer(raiz, ["src/views/admin"]);
        expect(achados).toHaveLength(1);
        expect(achados[0]).toMatchObject({
          arquivo: "src/views/admin/Suja.tsx",
          linha: 2,
        });
      } finally {
        rmSync(raiz, { recursive: true, force: true });
      }
    });
  });
});
