// Guarda de fonte única do painel simples (D12): endereço e horário têm UM dono.
//
//   - CEP, endereço, cidade e UF (`originCep`, `storeAddress`, `storeCity`,
//     `storeState`) só são GRAVADOS por Minha loja: os arquivos de
//     `minha-loja/` e `AdminAboutStoreView.tsx`. O Frete, a devolução, o Início
//     e qualquer tela futura LEEM; se uma delas voltar a mandar o CEP no
//     `updateConfig`, o Melhor Envio e o mapa passam a discordar da loja.
//   - O horário (`businessHours`) só é gravado por `BusinessHoursSection.tsx`.
//     Mandar o horário que uma tela carregou na abertura apagava o que a
//     lojista tinha salvo depois (A1, 09/10/2026).
//
// O que conta: CHAVE DE OBJETO dentro do argumento de `updateConfig(…)` (o
// literal passado, ou o objeto `const dados = { … }` que a chamada recebe por
// nome). Não conta o campo de uma interface (`readonly originCep: string`),
// nem o nome lido de `config.originCep`.
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-regexp, security/detect-object-injection --
   varredura da própria árvore do repositório (caminhos vêm do disco, não de entrada de usuário); chaves e nomes vêm de constantes e do próprio fonte */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");
const PASTAS_VARRIDAS = ["src/views/admin", "src/components/admin"];

const CHAVES_DO_ENDERECO = [
  "originCep",
  "storeAddress",
  "storeCity",
  "storeState",
] as const;
const CHAVES_DO_HORARIO = ["businessHours"] as const;

/** Quem pode gravar o endereço: Minha loja (a tela e a pasta dos blocos). */
function ehDonoDoEndereco(caminho: string): boolean {
  return (
    caminho === "src/views/admin/AdminAboutStoreView.tsx" ||
    caminho.startsWith("src/components/admin/minha-loja/")
  );
}

/** Quem pode gravar o horário: só o editor de horário. */
function ehDonoDoHorario(caminho: string): boolean {
  return caminho === "src/components/admin/settings/BusinessHoursSection.tsx";
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

/** Tira comentários de linha e de bloco (o resto do texto fica no lugar). */
function semComentarios(texto: string): string {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, (trecho) => trecho.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

const ABRE = new Set(["(", "{", "["]);
const FECHA = new Set([")", "}", "]"]);

/**
 * Do `abertura` (posição de um `(` ou `{`) até o par que o fecha. Ignora o que
 * está dentro de aspas e de template. Devolve o miolo, sem os delimitadores.
 */
function miolo(texto: string, abertura: number): string {
  let profundidade = 0;
  let aspas: string | null = null;
  for (let i = abertura; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === "\\") i++;
      else if (c === aspas) aspas = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      aspas = c;
    } else if (ABRE.has(c)) {
      profundidade++;
    } else if (FECHA.has(c)) {
      profundidade--;
      if (profundidade === 0) return texto.slice(abertura + 1, i);
    }
  }
  return texto.slice(abertura + 1);
}

/**
 * O miolo do que o `nome` recebe na declaração: `const nome = { … }` ou
 * `const [nome, setNome] = useState({ … })` (também `useState<Tipo>(…)`).
 * `null` quando não acha (importado, parâmetro, vindo de um hook).
 */
function regiaoDeclarada(texto: string, nome: string): string | null {
  const declaracao = new RegExp(
    `\\b(?:const|let|var)\\s+(?:\\[\\s*${nome}\\b[^\\]]*\\]\\s*|${nome}\\b[^=]*)=`,
  ).exec(texto);
  if (!declaracao) return null;
  const depois = declaracao.index + declaracao[0].length;
  const abre = /[({]/.exec(texto.slice(depois, depois + 80));
  if (!abre) return null;
  return miolo(texto, depois + abre.index);
}

/** Os argumentos de cada `updateConfig(…)` do texto, já resolvidos. */
function payloadsDoUpdateConfig(textoBruto: string): string[] {
  const texto = semComentarios(textoBruto);
  const payloads: string[] = [];
  for (const chamada of texto.matchAll(/\bupdateConfig\s*\(/g)) {
    const abertura = (chamada.index ?? 0) + chamada[0].length - 1;
    const argumentos = miolo(texto, abertura);
    payloads.push(argumentos);

    // Primeiro argumento por NOME (`updateConfig(dados)`): procura o objeto.
    const nome = /^\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(argumentos)?.[1];
    if (nome) {
      const objeto = regiaoDeclarada(texto, nome);
      if (objeto !== null) payloads.push(objeto);
    }

    // Espalhamento (`updateConfig({ ...formData, x })`): o objeto espalhado
    // também vai ao banco. Só resolve nome simples; `...(a ?? {})` e o que
    // vem de fora do arquivo ficam de fora (não dá para saber o que tem).
    for (const espalhado of argumentos.matchAll(
      /\.\.\.\s*([A-Za-z_$][\w$]*)\s*(?=[,}\s]|$)/g,
    )) {
      const objeto = regiaoDeclarada(texto, espalhado[1]);
      if (objeto !== null) payloads.push(objeto);
    }
  }
  return payloads;
}

/**
 * A chave está no objeto? Forma longa (`chave: valor`) ou curta (`{ chave }`,
 * `{ ...a, chave }`). O `x: chave` (valor, não chave) não conta: a curta exige
 * `{` ou `,` antes.
 */
function temChave(objeto: string, chave: string): boolean {
  return (
    new RegExp(`(?:^|[\\s{,])${chave}\\s*:`).test(objeto) ||
    new RegExp(`(?:^|[{,])\\s*${chave}\\s*(?=[,}]|$)`).test(objeto)
  );
}

/** Quais das `chaves` aparecem como chave de objeto nos payloads. */
function chavesGravadas(
  texto: string,
  chaves: readonly string[],
): readonly string[] {
  const payloads = payloadsDoUpdateConfig(texto);
  return chaves.filter((chave) =>
    payloads.some((payload) => temChave(payload, chave)),
  );
}

function varrer(): { arquivo: string; texto: string }[] {
  return PASTAS_VARRIDAS.flatMap((pasta) =>
    arquivosDe(join(RAIZ, pasta)).map((arquivo) => ({
      arquivo: relative(RAIZ, arquivo).split(sep).join("/"),
      texto: readFileSync(arquivo, "utf8"),
    })),
  );
}

describe("o analisador da guarda (para não passar em falso)", () => {
  it("pega a chave no literal passado ao updateConfig", () => {
    expect(
      chavesGravadas(
        "await updateConfig({ originCep: x, storeCity: y })",
        CHAVES_DO_ENDERECO,
      ),
    ).toEqual(["originCep", "storeCity"]);
  });

  it("pega a chave em chamada de várias linhas e com segundo argumento", () => {
    const texto = `
      const ok = await updateConfig(
        {
          ...(parte ?? {}),
          storeAddress: montar(a, b),
        },
        { silent: true },
      );`;
    expect(chavesGravadas(texto, CHAVES_DO_ENDERECO)).toEqual(["storeAddress"]);
  });

  it("pega o objeto montado fora e passado por nome", () => {
    const texto = `
      const dados = { businessHours: horario };
      await updateConfig(dados);`;
    expect(chavesGravadas(texto, CHAVES_DO_HORARIO)).toEqual(["businessHours"]);
  });

  it("pega a forma curta: updateConfig({ originCep })", () => {
    expect(
      chavesGravadas("await updateConfig({ originCep })", CHAVES_DO_ENDERECO),
    ).toEqual(["originCep"]);
    expect(
      chavesGravadas(
        "await updateConfig({ enableCoupons: on, storeState, storeCity })",
        CHAVES_DO_ENDERECO,
      ),
    ).toEqual(["storeCity", "storeState"]);
    expect(
      chavesGravadas(
        "await updateConfig({ businessHours })",
        CHAVES_DO_HORARIO,
      ),
    ).toEqual(["businessHours"]);
  });

  it("a forma curta não pega o nome usado como VALOR de outra chave", () => {
    expect(
      chavesGravadas(
        "await updateConfig({ enableCoupons: originCep, outra: storeCity })",
        CHAVES_DO_ENDERECO,
      ),
    ).toEqual([]);
  });

  it("pega o espalhamento de um objeto que contém a chave protegida", () => {
    const comEstado = `
      const [formData, setFormData] = useState({ originCep: "", nome: "" });
      await updateConfig({ ...formData, enableCoupons: true });`;
    expect(chavesGravadas(comEstado, CHAVES_DO_ENDERECO)).toEqual([
      "originCep",
    ]);

    const comConst = `
      const parcial = { storeAddress: montar() };
      await updateConfig({ ...parcial });`;
    expect(chavesGravadas(comConst, CHAVES_DO_ENDERECO)).toEqual([
      "storeAddress",
    ]);

    const tipado = `
      const [dados, setDados] = useState<Dados>({ businessHours: "" });
      await updateConfig({ x: 1, ...dados });`;
    expect(chavesGravadas(tipado, CHAVES_DO_HORARIO)).toEqual([
      "businessHours",
    ]);
  });

  it("espalhar um objeto SEM chave protegida (ou que não dá para resolver) não acusa", () => {
    const limpo = `
      const [formData, setFormData] = useState({ nome: "", preco: 1 });
      await updateConfig({ ...formData, enableCoupons: true });`;
    expect(chavesGravadas(limpo, CHAVES_DO_ENDERECO)).toEqual([]);

    const dePropsOuHook = "await updateConfig({ ...vindoDeFora, x: 1 })";
    expect(chavesGravadas(dePropsOuHook, CHAVES_DO_ENDERECO)).toEqual([]);

    // Espalhar em OUTRO lugar que não o updateConfig também não conta.
    const outroLugar = `
      const [formData] = useState({ originCep: "" });
      const copia = { ...formData };
      await updateConfig({ enableCoupons: true });`;
    expect(chavesGravadas(outroLugar, CHAVES_DO_ENDERECO)).toEqual([]);
  });

  it("não confunde interface, leitura nem comentário com gravação", () => {
    const texto = `
      interface Props { readonly originCep: string | undefined }
      // updateConfig({ originCep: "x" })
      const cep = config.originCep;
      await updateConfig({ enableCoupons: checked });`;
    expect(chavesGravadas(texto, CHAVES_DO_ENDERECO)).toEqual([]);
  });

  it("não pega chave de outra tela que só CONTÉM o nome (prefixo/sufixo)", () => {
    expect(
      chavesGravadas(
        "await updateConfig({ minOriginCep: 1, storeCityName: 2 })",
        CHAVES_DO_ENDERECO,
      ),
    ).toEqual([]);
  });
});

describe("endereço e horário têm um dono só", () => {
  const arquivos = varrer();

  it("a varredura olhou as telas e os componentes do painel de verdade", () => {
    expect(arquivos.length).toBeGreaterThan(50);
    // E enxerga os donos: o editor de horário grava a chave que a guarda vigia
    // (a prova de que o analisador acha uma gravação de verdade no código real).
    const aboutStore = arquivos.find(
      (a) => a.arquivo === "src/views/admin/AdminAboutStoreView.tsx",
    );
    expect(aboutStore).toBeDefined();
    const horario = arquivos.find((a) => ehDonoDoHorario(a.arquivo));
    expect(horario, "BusinessHoursSection.tsx sumiu do lugar").toBeDefined();
    expect(chavesGravadas(horario!.texto, CHAVES_DO_HORARIO)).toEqual([
      "businessHours",
    ]);
  });

  it("CEP, endereço, cidade e UF só são gravados por Minha loja", () => {
    const intrusos = arquivos
      .filter((a) => !ehDonoDoEndereco(a.arquivo))
      .flatMap((a) =>
        chavesGravadas(a.texto, CHAVES_DO_ENDERECO).map(
          (chave) => `${a.arquivo} grava ${chave}`,
        ),
      );
    expect(
      intrusos,
      "só Minha loja (AdminAboutStoreView e minha-loja/*) grava o endereço; as outras telas leem",
    ).toEqual([]);
  });

  it("o horário só é gravado pelo BusinessHoursSection", () => {
    const intrusos = arquivos
      .filter((a) => !ehDonoDoHorario(a.arquivo))
      .flatMap((a) =>
        chavesGravadas(a.texto, CHAVES_DO_HORARIO).map(
          (chave) => `${a.arquivo} grava ${chave}`,
        ),
      );
    expect(
      intrusos,
      "só o BusinessHoursSection grava o horário; quem salvar outra coisa não o leva de carona",
    ).toEqual([]);
  });

  it("nem Minha loja leva o horário no Salvar do endereço e do contato", () => {
    const donos = arquivos.filter((a) => ehDonoDoEndereco(a.arquivo));
    expect(donos.length).toBeGreaterThan(1);
    for (const dono of donos) {
      expect(
        chavesGravadas(dono.texto, CHAVES_DO_HORARIO),
        `${dono.arquivo} não deve gravar o horário`,
      ).toEqual([]);
    }
  });
});
