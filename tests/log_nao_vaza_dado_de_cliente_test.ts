// @ts-nocheck
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
/**
 * Nenhum console.* imprime dado de pessoa — varredura de src/
 *
 * O DEFEITO QUE ESTE TESTE FECHA (reauditoria de 22/08/2026, achado R8):
 * `src/contexts/AuthContext.tsx:361` fazia
 *
 *   console.log("[Auth] Profile fetched:", profileData.full_name);
 *
 * Isso vai para PRODUÇÃO: são 540 `console.*` no projeto e apenas 5 sob guarda
 * `import.meta.env.DEV`. Qualquer pessoa que abrisse o console do navegador na
 * loja lia o NOME COMPLETO do cliente que acabara de entrar. Não é log ruidoso:
 * é dado de pessoa exposto a quem passar por ali.
 *
 * POR QUE UM TESTE DE VARREDURA, E NÃO UM TESTE DA TELA: o defeito é de CLASSE,
 * não de instância. Consertar a linha 361 não impede a próxima pessoa de
 * escrever `console.log("user:", u.email)` em outro arquivo na semana que vem.
 * O que protege é a varredura, e ela custa milissegundos.
 *
 * A ARMADILHA QUE QUASE ME PEGOU, e por isso o teste de calibragem existe:
 * o extrator ingênuo procura o nome do campo na linha inteira, e acusa
 *
 *   console.error("Error fetching orders by whatsapp:", err);   // useOrders.ts:1158
 *
 * que é código CORRETO — "whatsapp" está no TEXTO da mensagem, não é um valor.
 * Um detector assim reprovaria trabalho bom e seria desligado no primeiro dia.
 * Por isso a varredura **apaga as strings literais antes de procurar**: o que
 * sobra é só expressão de verdade.
 *
 * Um detector precisa provar as DUAS coisas — que reage ao caso real e que
 * discrimina o parecido. As duas provas estão no primeiro teste, e elas rodam
 * na MESMA rodada da varredura: se algum dia o extrator quebrar e passar a
 * devolver zero, o teste de calibragem cai junto, em vez de a varredura ficar
 * verde por não estar medindo nada.
 */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

// `fromFileUrl` e não `.pathname`: o caminho deste projeto tem espaços, e o
// pathname devolve `%20` mais uma barra sobrando no Windows.
const SRC = fromFileUrl(new URL("../src", import.meta.url));

/**
 * Campos que identificam uma pessoa. Não entra aqui o que é só id opaco
 * (`user_id`, `order_id`): eles não dizem quem a pessoa é para quem lê o
 * console, e incluí-los encheria a varredura de ruído até alguém desligá-la.
 */
const CAMPOS_DE_PESSOA = [
  "full_name",
  "fullName",
  "email",
  "phone",
  "telefone",
  "whatsapp",
  "cpf",
  "birth_date",
  "customer_name",
];

/**
 * Apaga o conteúdo de strings literais, preservando o comprimento da linha
 * para que a coluna continue fazendo sentido em quem for ler o erro.
 * Cobre aspas duplas, simples e template literal.
 *
 * O que sobra depois disto é expressão: `obj.email` sobrevive,
 * `"erro de email"` vira `"            "`.
 *
 * A INTERPOLAÇÃO DE TEMPLATE LITERAL É PRESERVADA, e isso não é detalhe:
 * `console.log(`perfil: ${p.email}`)` vaza exatamente igual à forma com
 * vírgula. Apagar o miolo da crase inteiro deixaria passar metade das formas
 * de vazar — o detector ficaria verde justamente onde o código é mais comum.
 */
function apagarLiterais(linha: string): string {
  let fora = "";
  let aspa: string | null = null;
  // profundidade de `${ ... }` dentro de template literal; 0 = texto puro
  let interpolacao = 0;
  for (let i = 0; i < linha.length; i++) {
    // `charAt` e não `linha[i]`: o índice variável dispara o aviso
    // `security/detect-object-injection` do eslint, e a catraca de lint deste
    // projeto tem teto fixo — 2 avisos novos reprovam o CI.
    const c = linha.charAt(i);
    const anterior = i > 0 ? linha.charAt(i - 1) : "";
    if (aspa === null) {
      if (c === '"' || c === "'" || c === "`") aspa = c;
      fora += c;
      continue;
    }
    // dentro de template literal, `${` abre uma janela de expressão
    if (aspa === "`" && c === "$" && linha.charAt(i + 1) === "{") {
      interpolacao++;
      fora += c;
      continue;
    }
    if (interpolacao > 0) {
      if (c === "}") interpolacao--;
      fora += c; // expressão preservada
      continue;
    }
    // barra invertida escapa a aspa e não fecha a string
    if (c === aspa && anterior !== "\\") {
      aspa = null;
      fora += c;
    } else {
      fora += " ";
    }
  }
  return fora;
}

/** Acha `.campo` como ACESSO A PROPRIEDADE, fora de string. */
function citaDadoDePessoa(linha: string): string | null {
  const semTexto = apagarLiterais(linha);
  if (!/console\.(log|warn|error|debug|info|trace)\s*\(/.test(semTexto)) {
    return null;
  }
  for (const campo of CAMPOS_DE_PESSOA) {
    // Ponto obrigatório antes: queremos `algo.email`, nunca a palavra solta.
    // Feito com indexOf em vez de `new RegExp(campo)` porque regex montada de
    // string dispara `security/detect-non-literal-regexp`, e a catraca de lint
    // deste projeto reprova qualquer aviso novo.
    const alvo = `.${campo}`;
    let de = semTexto.indexOf(alvo);
    while (de !== -1) {
      // a borda direita precisa terminar a palavra: `.email` sim,
      // `.emailVerificado` não é o mesmo campo
      const seguinte = semTexto.charAt(de + alvo.length);
      if (seguinte === "" || !/[A-Za-z0-9_$]/.test(seguinte)) return campo;
      de = semTexto.indexOf(alvo, de + 1);
    }
  }
  return null;
}

/** Conta parênteses de uma linha já com strings apagadas (sem risco de contar parêntese que está dentro de texto). */
function contarParenteses(semTexto: string): number {
  let n = 0;
  for (const c of semTexto) {
    if (c === "(") n++;
    else if (c === ")") n--;
  }
  return n;
}

/**
 * Agrupa linhas que formam uma única chamada `console.*` quebrada em várias
 * linhas — é exatamente o que o formatador do projeto produz sozinho para
 * chamada longa:
 *
 *   console.log(
 *     "[Auth] Profile fetched:",
 *     profileData.full_name,
 *   );
 *
 * Linha a linha isolada, nenhuma tem `console.` e `.full_name` na mesma
 * linha, então o detector line-by-line não via nada. Só junta o que abriu
 * `console.*` sem fechar os parênteses na mesma linha — chamada de qualquer
 * outra função continua isolada, uma linha por vez, para não arriscar juntar
 * coisa que não tem nada a ver.
 */
function agruparChamadasConsole(
  linhas: string[],
): { texto: string; inicio: number }[] {
  const grupos: { texto: string; inicio: number }[] = [];
  let i = 0;
  while (i < linhas.length) {
    // `.at(i)` e não `linhas[i]`: indexação por variável dispara
    // security/detect-object-injection, e a catraca de lint deste projeto
    // não abre exceção para arquivo de teste.
    const linha = linhas.at(i) ?? "";
    const semTexto = apagarLiterais(linha);
    const abreConsole = /console\.(log|warn|error|debug|info|trace)\s*\(/.test(
      semTexto,
    );
    if (!abreConsole) {
      grupos.push({ texto: linha, inicio: i + 1 });
      i++;
      continue;
    }
    let profundidade = contarParenteses(semTexto);
    if (profundidade <= 0) {
      // fechou na própria linha — forma comum, nada a agrupar
      grupos.push({ texto: linha, inicio: i + 1 });
      i++;
      continue;
    }
    const inicio = i + 1;
    let acumulado = linha;
    i++;
    while (profundidade > 0 && i < linhas.length) {
      const proxima = linhas.at(i) ?? "";
      acumulado += ` ${proxima}`;
      profundidade += contarParenteses(apagarLiterais(proxima));
      i++;
    }
    grupos.push({ texto: acumulado, inicio });
  }
  return grupos;
}

function listarArquivos(dir: string): string[] {
  const achados: string[] = [];
  for (const entrada of Deno.readDirSync(dir)) {
    const caminho = `${dir}/${entrada.name}`;
    if (entrada.isDirectory) {
      achados.push(...listarArquivos(caminho));
    } else if (/\.(ts|tsx)$/.test(entrada.name)) {
      achados.push(caminho);
    }
  }
  return achados;
}

Deno.test("o detector reage ao caso real E discrimina o parecido", () => {
  // CONTROLE POSITIVO — a forma que vazou de verdade, em AuthContext.tsx:361.
  // Se isto não acusar, a varredura abaixo não está medindo nada.
  assertEquals(
    citaDadoDePessoa(
      '          console.log("[Auth] Profile fetched:", profileData.full_name);',
    ),
    "full_name",
  );

  // CONTROLE NEGATIVO — código CORRETO de useOrders.ts:1158. A palavra
  // "whatsapp" está no texto da mensagem; o valor logado é o erro, não a
  // pessoa. Um detector que acusa isto reprova trabalho bom.
  assertEquals(
    citaDadoDePessoa(
      '        console.error("Error fetching orders by whatsapp:", err);',
    ),
    null,
  );

  // A mensagem pode citar o campo desde que o VALOR não vá junto.
  assertEquals(
    citaDadoDePessoa('console.warn("email invalido informado pelo usuario");'),
    null,
  );

  // Template literal interpolando o campo vaza IGUAL à forma com vírgula, e
  // é a forma mais comum de escrever. Se isto voltar a devolver null, metade
  // das maneiras de vazar passa direto.
  assertEquals(citaDadoDePessoa("console.log(`perfil: ${p.email}`);"), "email");

  // ...mas o mesmo campo escrito como TEXTO dentro da crase não é vazamento.
  assertEquals(
    citaDadoDePessoa("console.log(`falha ao validar email do cliente`);"),
    null,
  );

  // Fora de console.*, não é problema desta varredura.
  assertEquals(citaDadoDePessoa("const nome = profile.full_name;"), null);
});

Deno.test("agruparChamadasConsole junta chamada multilinha para o detector enxergar", () => {
  // CONTROLE POSITIVO — a forma que o FORMATADOR do projeto produz sozinho
  // para chamada longa (é o que AuthContext.tsx:361 vira depois de formatado).
  // Linha a linha isolada, nenhuma tem `console.` e `.full_name` juntos —
  // só agrupando as duas o detector vê a mesma coisa do controle positivo
  // original.
  const grupoVazando = agruparChamadasConsole([
    "console.log(",
    '  "[Auth] Profile fetched:",',
    "  profileData.full_name,",
    ");",
  ]);
  assertEquals(grupoVazando.length, 1);
  assertEquals(citaDadoDePessoa(grupoVazando[0].texto), "full_name");

  // CONTROLE NEGATIVO — a MESMA quebra de linha, só que num log inócuo (erro
  // sem dado de pessoa). Prova que agrupar linhas não passou a acusar TODA
  // chamada multilinha, só a que carrega campo de pessoa.
  const grupoInocuo = agruparChamadasConsole([
    "console.error(",
    '  "falha ao salvar",',
    "  err,",
    ");",
  ]);
  assertEquals(grupoInocuo.length, 1);
  assertEquals(citaDadoDePessoa(grupoInocuo[0].texto), null);
});

Deno.test("apagarLiterais preserva expressão e apaga texto", () => {
  const dentro = apagarLiterais('f("email do cliente", u.email)');
  // o texto sumiu...
  assertEquals(dentro.includes("email do cliente"), false);
  // ...e a expressão ficou
  assertStringIncludes(dentro, "u.email");
  // o comprimento não muda, para a coluna continuar válida
  assertEquals(dentro.length, 'f("email do cliente", u.email)'.length);
});

Deno.test("nenhum console.* em src/ imprime dado de pessoa", () => {
  const ofensas: string[] = [];
  const arquivos = listarArquivos(SRC);

  // Âncora: se a listagem devolver quase nada, o resultado "0 ofensas" é
  // do instrumento quebrado, não do código limpo.
  if (arquivos.length < 50) {
    throw new Error(
      `varredura leu apenas ${arquivos.length} arquivos de src/ — instrumento quebrado, nao codigo limpo`,
    );
  }

  for (const arquivo of arquivos) {
    const linhas = Deno.readTextFileSync(arquivo).split("\n");
    const grupos = agruparChamadasConsole(linhas);
    for (const grupo of grupos) {
      const campo = citaDadoDePessoa(grupo.texto);
      if (campo) {
        const relativo = arquivo.slice(SRC.length + 1);
        ofensas.push(
          `${relativo}:${grupo.inicio} imprime "${campo}" -> ${grupo.texto.trim()}`,
        );
      }
    }
  }

  assertEquals(
    ofensas,
    [],
    `console.* imprimindo dado de pessoa (vai para producao):\n${ofensas.join("\n")}`,
  );
});
