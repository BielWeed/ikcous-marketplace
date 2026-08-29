# A recusa do último clique deixa de ser um beco — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada uma das 11 recusas que o banco pode dar no último clique do checkout passa a
oferecer, na tela, a ação que a própria mensagem manda executar.

**Architecture:** Duas funções puras em módulos novos (classificar a recusa; reconferir o
carrinho contra o banco) e um componente que substitui o `toast.error` por um painel com o
botão da ação. **Nenhuma migration, nenhuma RPC, nenhuma regra do banco é tocada.**

**Tech Stack:** React 19, TypeScript, Vitest + jsdom (`tests/front/`), Supabase JS.

**Desenho completo:** [`../specs/2026-08-28-recusa-do-ultimo-clique-design.md`](../specs/2026-08-28-recusa-do-ultimo-clique-design.md)

## Global Constraints

- **Árvore compartilhada.** Nunca `git stash`, `checkout`, `restore`, `clean` nem `reset`.
  Para comparar com o original, `git show HEAD:<caminho>` no scratchpad.
- **Nunca `git add` seguido de `git commit`.** Sempre `git commit -- <caminho> [<caminho>…]`.
- **Nunca `--no-verify`.** O hook de secretlint é a única trava contra credencial vazada.
- **Não editar `src/hooks/useOrders.ts` nem `src/contexts/CartContext.tsx`** até a Task 6.
  Os dois estão reivindicados por outras frentes no mural; a Task 6 existe para isso.
- **Nenhuma migration, nenhuma RPC, nenhum arquivo em `supabase/`.** Se uma tarefa parecer
  exigir isso, o plano está errado — pare e devolva para a sessão principal.
- **Não afrouxar a trava anti-adulteração de preço.** Ela vive no banco e nem é tocada aqui.
- **Verificação:** o diff toca `src/` e `tests/` → os sete comandos do CI: `npm ci`,
  `npm run typecheck`, `npm test`, `npm run build`, `npm run lint:links`,
  `npm run lint:ratchet`, `npm run size`. Se `lint:ratchet` passar de 10 min, **pare de
  esperar** por ele (não mate a rodada, não dispare outra) e use `npx eslint <arquivos do
  diff>` mais o hook de pre-commit; diga isso no relatório.
- **Escopo de commit vem de lista fechada** (`.commitlintrc.json`). Aqui: `checkout`, `cart`,
  `catalog`, `lib`, `ui`.
- 🔴 **Rode `npx biome check --write <seus arquivos>` antes de dar a tarefa por pronta.** O
  Biome **só reprova no CI** (`scripts/lint-ratchet.mjs` compara com `cobra: NO_CI`), então
  localmente ele passa e o PR reprova depois. O teto vivo é `biome.errors: 23`, e **dívida
  nova reprova**. Medido em 28/08/2026: a Task 1 entregou +2 erros de formatação (linha acima
  de 80 colunas) que nenhum comando local acusava. **Isto não é o ruído de CRLF** — os
  arquivos novos deste plano nascem em LF, então o que o Biome vê aqui é o mesmo que o Linux
  do CI vê.

---

### Task 1: O classificador da recusa

**Files:**
- Create: `src/lib/recusaDoPedido.ts`
- Test: `tests/front/recusa-do-pedido-classifica.test.ts`

**Interfaces:**
- Consumes: nada. Função pura.
- Produces:
  - `type AcaoDeRecusa = "reconferir_carrinho" | "recotar_frete" | "ajustar_estoque" | "remover_item" | "escolher_variacao" | "trocar_endereco" | "trocar_entrega" | "remover_cupom" | "tentar_de_novo" | "conferir_antes"`
  - `interface RecusaDoPedido { acao: AcaoDeRecusa; mensagem: string; produto?: string; disponivel?: number }`
  - `function classificarRecusaDoPedido(error: unknown): RecusaDoPedido`

- [ ] **Step 1: Escreva o teste que falha**

```ts
import { classificarRecusaDoPedido } from "@/lib/recusaDoPedido";
import { describe, expect, it } from "vitest";

const p0001 = (message: string) => ({ code: "P0001", message });

describe("classificarRecusaDoPedido", () => {
  it("os valores mudaram -> reconferir o carrinho", () => {
    const r = classificarRecusaDoPedido(
      p0001("Os valores do pedido mudaram. Atualize o carrinho e tente novamente."),
    );
    expect(r.acao).toBe("reconferir_carrinho");
    expect(r.mensagem).toContain("Os valores do pedido mudaram");
  });

  it("cotacao de frete expirada -> recotar o frete", () => {
    const r = classificarRecusaDoPedido(
      p0001("A cotação de frete expirou. Calcule o frete novamente e refaça o pedido."),
    );
    expect(r.acao).toBe("recotar_frete");
  });

  it("estoque insuficiente com numero -> ajustar, e diz quanto ha", () => {
    const r = classificarRecusaDoPedido(
      p0001("Estoque insuficiente para o produto Camiseta Azul (Disponível: 2, Solicitado: 5)"),
    );
    expect(r.acao).toBe("ajustar_estoque");
    expect(r.produto).toBe("Camiseta Azul");
    expect(r.disponivel).toBe(2);
  });

  it("estoque insuficiente SEM numero (corrida no debito) -> ajustar, sem quantidade", () => {
    const r = classificarRecusaDoPedido(p0001("Estoque insuficiente para o produto Caneca"));
    expect(r.acao).toBe("ajustar_estoque");
    expect(r.produto).toBe("Caneca");
    expect(r.disponivel).toBeUndefined();
  });

  it("produto indisponivel -> remover do carrinho, nomeando o produto", () => {
    const r = classificarRecusaDoPedido(p0001("Produto Caneca Branca não disponível."));
    expect(r.acao).toBe("remover_item");
    expect(r.produto).toBe("Caneca Branca");
  });

  it("variacao nao escolhida -> escolher variacao", () => {
    const r = classificarRecusaDoPedido(p0001("Escolha uma variação para o produto Tênis."));
    expect(r.acao).toBe("escolher_variacao");
    expect(r.produto).toBe("Tênis");
  });

  it("cupom invalido -> remover o cupom", () => {
    const r = classificarRecusaDoPedido(p0001("Cupom BEMVINDO10 inválido ou expirado."));
    expect(r.acao).toBe("remover_cupom");
  });

  it("entrega local fora da faixa -> trocar a entrega", () => {
    const r = classificarRecusaDoPedido(
      p0001("Entrega local não disponível para o CEP informado."),
    );
    expect(r.acao).toBe("trocar_entrega");
  });

  it("endereco invalido -> trocar endereco", () => {
    const r = classificarRecusaDoPedido(p0001("Endereço inválido ou não pertence ao usuário."));
    expect(r.acao).toBe("trocar_endereco");
  });

  it("quantidade invalida -> reconferir o carrinho", () => {
    const r = classificarRecusaDoPedido(p0001("Quantidade inválida para um dos itens."));
    expect(r.acao).toBe("reconferir_carrinho");
  });

  // As duas saidas que NAO sao recusa de regra. `mensagemAmigavelErroPedido` ja
  // distingue as duas, e perder a distincao aqui faria a tela oferecer "tente de
  // novo" para um pedido que PODE ter sido criado -- que e' como se duplica pedido.
  it("erro de SQLSTATE generico -> tentar de novo", () => {
    const r = classificarRecusaDoPedido({ code: "40P01", message: "deadlock detected" });
    expect(r.acao).toBe("tentar_de_novo");
  });

  it("erro SEM code (rede/gateway) -> conferir antes, NUNCA tentar de novo", () => {
    const r = classificarRecusaDoPedido({ message: "Failed to fetch" });
    expect(r.acao).toBe("conferir_antes");
  });

  it("P0001 com texto desconhecido -> conferir antes, e preserva o texto do banco", () => {
    const r = classificarRecusaDoPedido(p0001("Uma recusa que ainda nao existe."));
    expect(r.acao).toBe("conferir_antes");
    expect(r.mensagem).toBe("Uma recusa que ainda nao existe.");
  });

  // 🔴 Achados da revisao de contexto limpo, 28/08/2026. Os tres primeiros sao o
  // achado que BLOQUEOU a primeira versao: sem eles, o painel dizia "confira se o
  // pedido apareceu" enquanto o toast, do lado, dizia "tente novamente" -- duas
  // instrucoes opostas para a MESMA falha, na MESMA tela.
  it.each(["PGRST202", "PGRST301", "PGRST302"])(
    "%s prova que a chamada nem chegou ao banco -> tentar de novo, igual ao toast",
    (code) => {
      const r = classificarRecusaDoPedido({ code, message: "qualquer" });
      expect(r.acao).toBe("tentar_de_novo");
    },
  );

  it("nome de produto com quebra de linha NAO perde a acao", () => {
    const r = classificarRecusaDoPedido(
      p0001("Estoque insuficiente para o produto Caneca\nAzul (Disponível: 2, Solicitado: 5)"),
    );
    expect(r.acao).toBe("ajustar_estoque");
    expect(r.produto).toBe("Caneca\nAzul");
    expect(r.disponivel).toBe(2);
  });

  it("nome de produto vazio NAO perde a acao", () => {
    const r = classificarRecusaDoPedido(p0001("Estoque insuficiente para o produto "));
    expect(r.acao).toBe("ajustar_estoque");
    expect(r.produto).toBe("");
  });

  it("o nome guloso continua resolvendo parenteses dentro do nome", () => {
    // Provado pela revisao: o `.+` guloso ja acertava isto, e trocar para
    // `[\s\S]*` nao pode ter quebrado. Nome do produto contendo o proprio
    // formato da mensagem.
    const r = classificarRecusaDoPedido(
      p0001(
        "Estoque insuficiente para o produto Kit (Disponível: 9, Solicitado: 1) (Disponível: 2, Solicitado: 5)",
      ),
    );
    expect(r.produto).toBe("Kit (Disponível: 9, Solicitado: 1)");
    expect(r.disponivel).toBe(2);
  });
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `npx vitest run tests/front/recusa-do-pedido-classifica.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/recusaDoPedido"`.

- [ ] **Step 3: Escreva a implementação mínima**

```ts
/**
 * Classifica a recusa que o banco deu no último clique do checkout, para a
 * tela poder oferecer A AÇÃO que a mensagem manda executar.
 *
 * POR QUE POR TEXTO, e não por código de erro: as 11 recusas de
 * `create_marketplace_order_v23/v24` usam `RAISE EXCEPTION` sem `USING
 * ERRCODE`, então todas chegam como `P0001`. Dar código próprio a cada uma
 * mexeria na RPC — no caminho do dinheiro — e `mensagemAmigavelErroPedido`
 * trata `P0001` de forma especial, então mudar isso quebraria peça que hoje
 * funciona.
 *
 * A fragilidade de casar por texto está contida pelo teste
 * `recusa-do-pedido-ancora-nas-migrations.test.ts`: se alguém trocar uma
 * mensagem no SQL, ele reprova NOMEANDO qual, em vez de esta função cair
 * calada no caso genérico.
 *
 * DEFAULT FALHA FECHADO: o que não é reconhecido vira `conferir_antes`, nunca
 * `tentar_de_novo`. Mandar "tente de novo" sem saber se o pedido nasceu é o que
 * duplica pedido — estoque debitado duas vezes, cupom de uso único consumido
 * duas vezes.
 *
 * 🔴 A EXCEÇÃO, e ela não é conservadorismo — é conhecimento: três códigos do
 * PostgREST PROVAM que a chamada nem chegou ao Postgres, porque falham na fase
 * de autenticação/roteamento (doc oficial, citada em `useOrders.ts`).
 * `PGRST202` (função fora do cache de schema), `PGRST301` (JWT inválido ou
 * expirado) e `PGRST302` (papel anônimo desabilitado) devolvem
 * `tentar_de_novo`, e isso é o certo: mandar a pessoa "conferir se o pedido
 * apareceu" seria mandá-la procurar um pedido que provadamente não existe — e,
 * no caso do JWT expirado, mandá-la para uma tela que nem vai carregar.
 *
 * 🔴 E ESTA LISTA TEM DE CONCORDAR COM `mensagemAmigavelErroPedido`
 * (`src/hooks/useOrders.ts`), porque as duas aparecem para a MESMA pessoa, na
 * MESMA tela, no MESMO instante — o painel ao lado do toast. O comentário de
 * `CheckoutView.tsx` escreve a invariante em letra: "mesma tradução aqui, para
 * não haver dois textos diferentes para a mesma falha". A primeira versão deste
 * módulo quebrou isso: ela não tinha os três códigos e mandava a pessoa
 * "conferir antes" enquanto o toast, do lado, dizia "tente novamente". Achado
 * pela revisão de contexto limpo em 28/08/2026.
 *
 * A Task 6 fecha a duplicação: `useOrders.ts` passa a IMPORTAR este conjunto em
 * vez de manter a cópia dele. Enquanto as duas cópias existirem, mexer numa sem
 * mexer na outra reabre exatamente este defeito.
 */
export type AcaoDeRecusa =
  | "reconferir_carrinho"
  | "recotar_frete"
  | "ajustar_estoque"
  | "remover_item"
  | "escolher_variacao"
  | "trocar_endereco"
  | "trocar_entrega"
  | "remover_cupom"
  | "tentar_de_novo"
  | "conferir_antes";

export interface RecusaDoPedido {
  acao: AcaoDeRecusa;
  /** A frase que a pessoa lê. Vem do banco quando o banco escreveu uma. */
  mensagem: string;
  /** Nome do produto, quando a mensagem o nomeia. */
  produto?: string;
  /** Quantidade ainda disponível, quando a mensagem a informa. */
  disponivel?: number;
}

const FORMATO_SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * Os três que provam que a chamada nem chegou ao Postgres. Tem de ser o MESMO
 * conjunto de `mensagemAmigavelErroPedido` — ver o cabeçalho deste arquivo.
 */
const CODIGOS_POSTGREST_REVERTIDO_COMPROVADO = new Set([
  "PGRST202",
  "PGRST301",
  "PGRST302",
]);

/**
 * Ordem IMPORTA: o padrão de estoque COM número precisa ser testado antes do
 * padrão sem número, senão o sem-número casa primeiro e a quantidade se perde.
 *
 * 🔴 `[\s\S]` e não `.` no nome do produto: `.` NÃO casa quebra de linha, e o
 * nome é digitado pelo lojista. Medido pela revisão de 28/08/2026 — um produto
 * chamado "Caneca\nAzul" caía no caso genérico e a pessoa PERDIA o botão. E `*`
 * em vez de `+` porque nome vazio também é possível: com `+`, um produto sem
 * nome tirava a ação junto.
 */
const REGRAS: ReadonlyArray<{ padrao: RegExp; acao: AcaoDeRecusa }> = [
  {
    padrao:
      /^Estoque insuficiente para o produto ([\s\S]*) \(Disponível: (\d+), Solicitado: \d+\)$/,
    acao: "ajustar_estoque",
  },
  { padrao: /^Estoque insuficiente para o produto ([\s\S]*)$/, acao: "ajustar_estoque" },
  { padrao: /^Produto ([\s\S]*) não disponível\.$/, acao: "remover_item" },
  { padrao: /^Escolha uma variação para o produto ([\s\S]*)\.$/, acao: "escolher_variacao" },
  { padrao: /^Cupom .+ inválido ou expirado\.$/, acao: "remover_cupom" },
  { padrao: /^A cotação de frete expirou\./, acao: "recotar_frete" },
  { padrao: /^Entrega local não disponível para o CEP informado\.$/, acao: "trocar_entrega" },
  { padrao: /^Endereço inválido ou não pertence ao usuário\.$/, acao: "trocar_endereco" },
  { padrao: /^Quantidade inválida para um dos itens\.$/, acao: "reconferir_carrinho" },
  { padrao: /^Os valores do pedido mudaram\./, acao: "reconferir_carrinho" },
];

export const classificarRecusaDoPedido = (error: unknown): RecusaDoPedido => {
  const detalhes = (error ?? {}) as { code?: unknown; message?: unknown };
  const codigo = typeof detalhes.code === "string" ? detalhes.code : "";
  const texto = typeof detalhes.message === "string" ? detalhes.message : "";

  if (codigo === "P0001" && texto) {
    for (const { padrao, acao } of REGRAS) {
      const casou = padrao.exec(texto);
      if (!casou) continue;
      const resultado: RecusaDoPedido = { acao, mensagem: texto };
      if (casou[1] !== undefined) resultado.produto = casou[1];
      if (casou[2] !== undefined) resultado.disponivel = Number(casou[2]);
      return resultado;
    }
    // P0001 que ninguém previu: o texto do banco é bom, a ação é que não se sabe.
    return { acao: "conferir_antes", mensagem: texto };
  }

  if (CODIGOS_POSTGREST_REVERTIDO_COMPROVADO.has(codigo) || FORMATO_SQLSTATE.test(codigo)) {
    return {
      acao: "tentar_de_novo",
      mensagem: "Não foi possível criar seu pedido agora. Tente novamente em instantes.",
    };
  }

  return {
    acao: "conferir_antes",
    mensagem:
      "Não conseguimos confirmar se o pedido foi enviado. Verifique se ele já apareceu antes de tentar de novo.",
  };
};
```

- [ ] **Step 4: Rode e veja passar**

Run: `npx vitest run tests/front/recusa-do-pedido-classifica.test.ts`
Expected: PASS, 13 testes.

- [ ] **Step 5: Prove que o teste não passa por acaso**

Troque `return resultado;` por `return { acao: "conferir_antes", mensagem: texto };` e rode
de novo. Expected: **10 testes falham** (os que asseguram ação específica). Desfaça a
sabotagem **editando o arquivo de volta** — nunca com `git checkout`.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(checkout): o app passa a saber QUAL recusa o banco deu" -- src/lib/recusaDoPedido.ts tests/front/recusa-do-pedido-classifica.test.ts
```

---

### Task 1b: O portão que impede as duas peças de divergirem outra vez

**Files:**
- Modify: `src/lib/recusaDoPedido.ts` (só o docstring — ver Step 3)
- Test: `tests/front/recusa-e-toast-nao-divergem.test.ts`

**Interfaces:**
- Consumes: `classificarRecusaDoPedido` (Task 1) e `mensagemAmigavelErroPedido` (`@/hooks/useOrders`).
- Produces: nada de runtime.

**Por que esta tarefa existe.** A revisão da Task 1 achou — e mediu — que o painel e o toast
davam ordens **opostas** para a mesma falha. O conserto entrou, e a segunda revisão provou que
está fechado: 673 entradas comparadas entre os dois módulos, 0 divergência, com controle
mostrando 81 divergências na versão antiga.

**Só que a invariante ficou escrita apenas em prosa.** Nenhum teste liga um módulo ao outro.
O `Set` dos três códigos do PostgREST está **duplicado** em dois arquivos, e o cenário que
reabre tudo é banal: alguém acrescenta `PGRST303` em `src/hooks/useOrders.ts` e não mexe aqui.
Os 19 testes seguem verdes, o `typecheck`, o `eslint`, o `biome` e o `build` seguem verdes — e
o defeito volta, **invisível**.

É a diferença entre *"está escrito que tem de concordar"* e *"não dá para fazer discordar"*.
Foi exatamente a prosa que falhou na primeira rodada.

**Precedente da casa:** o boilerplate de dublês está em
`tests/front/erro-de-pedido-nao-mostra-texto-cru-do-banco.test.ts` — copie de lá; ele já
resolve o import de `useOrders` sem arrastar Supabase.

- [ ] **Step 1: Escreva o teste diferencial**

Ele percorre um corpus e exige, para **cada** entrada, que as duas peças não se contradigam:

- toast dizendo "Tente novamente em instantes" ⇒ painel `tentar_de_novo`;
- toast dizendo "Verifique se ele já apareceu" ⇒ painel `conferir_antes`;
- texto vindo do banco (P0001) ⇒ painel **nunca** `tentar_de_novo`.

Corpus mínimo: os 3 códigos do PostgREST, `P0001` com as 11 frases reais (com acento, tiradas
de `supabase/migrations/20260960000000_variacao_obrigatoria_no_servidor.sql`), SQLSTATE
genérico, `code` vazio, `code` não-string, `message` ausente, `null`, `undefined`, `{}`,
string solta, `new Error()`.

- [ ] **Step 2: O CONTROLE, e sem ele este teste não vale nada**

Reproduza numa cópia no scratchpad a versão **sem** os três códigos do PostgREST e rode o
teste contra ela. Expected: ele **acusa divergência**, nomeando as entradas. Um teste
diferencial que não acusa a versão sabidamente quebrada é um laço sem dentes — e foi assim
que a suíte da Task 3 aceitou uma tolerância 40 vezes maior.

- [ ] **Step 3: Conserte o docstring, que ainda promete o que o código não faz**

Ele diz *"nunca `tentar_de_novo`"* e apresenta os três códigos do PostgREST como **"A
EXCEÇÃO"**, no singular. Existe uma segunda, maior e não mencionada: `FORMATO_SQLSTATE`.
Medido: `{code:"P0001"}` sem `message`, `{code:"12345"}` e `{code:"ABCDE"}` devolvem todos
`tentar_de_novo`.

**O comportamento está certo** — é byte a byte o do vizinho, e P0001/SQLSTATE provam que a
transação abortou. **O texto é que está errado**, e comentário que mente é o que causou a
rodada 1: quem ler o docstring e "corrigir" o código para bater com ele quebra a concordância.

Escreva as **duas** exceções, e diga que a regra real é *"nunca `tentar_de_novo` para texto
que veio do banco"*.

- [ ] **Step 4: Rode, e cole a saída**

```bash
npx vitest run tests/front/recusa-e-toast-nao-divergem.test.ts
```
```bash
npm run typecheck
```
```bash
npx biome check src/lib/recusaDoPedido.ts tests/front/recusa-e-toast-nao-divergem.test.ts
```

- [ ] **Step 5: Commit**

```bash
git commit -m "test(checkout): o painel e o aviso nao podem mais divergir em silencio" -- src/lib/recusaDoPedido.ts tests/front/recusa-e-toast-nao-divergem.test.ts
```

---

### Task 2: A âncora que impede a mensagem de mudar em silêncio

**Files:**
- Test: `tests/front/recusa-do-pedido-ancora-nas-migrations.test.ts`

**Interfaces:**
- Consumes: os arquivos `.sql` de `supabase/migrations/`. **Não** importa o módulo da Task 1.
- Produces: nada de runtime.

**Por que esta tarefa existe:** o classificador casa por texto. Sem esta âncora, alguém muda
uma mensagem no SQL, o classificador cai calado no caso genérico, e a tela volta a ser um
beco — sem nenhum teste vermelho.

- [ ] **Step 1: Escreva o teste**

```ts
// Roda no CI, que NAO tem banco: a ancora e' o arquivo de migration em disco,
// nunca `pg_get_functiondef`.
//
// 🔴 CORRIGIDO em 28/08/2026, depois de a revisao devolver BLOQUEIA. A primeira
// versao usava `node:fs`/`node:path`/`process`, e isso reprovava DOIS portoes:
//
//   1. `npm run typecheck`: `tsconfig.app.json` cobre `tests/front` com
//      `"types": ["vite/client"]` -- SEM `"node"`. Sem isso, `node:fs`,
//      `node:path` e o global `process` nao existem para o compilador. Este era
//      o PRIMEIRO arquivo de `tests/front` a importar API de Node, entao a
//      lacuna nunca tinha aparecido.
//   2. `npm run lint:ratchet`: `readdirSync`/`readFileSync` com caminho de
//      variavel disparam `security/detect-non-literal-fs-filename`. Sao 2
//      warnings NOVOS, e o teto do `.lint-baseline.json` esta em 550 SEM FOLGA
//      -- warning novo reprova igual a erro novo.
//
// `import.meta.glob` com `?raw` le os arquivos em tempo de build do vitest, sem
// API de Node nenhuma: os dois portoes passam e nao se mexe em config
// compartilhada com frentes ativas. O padrao ja existe nesta casa --
// `tests/front/guarda-de-cor-sai-junto-com-a-escrita.test.ts` faz o mesmo, pelo
// mesmo motivo, e o comentario de la' diz isso com todas as letras.
import { describe, expect, it } from "vitest";

const MIGRATIONS = import.meta.glob<string>("/supabase/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
});

// As frases, copiadas do corpo VIVO de create_marketplace_order_v24
// (pg_get_functiondef, 28/08/2026). O `%` do RAISE e' literal no SQL.
const FRASES_DO_BANCO = [
  "Endereço inválido ou não pertence ao usuário.",
  "Quantidade inválida para um dos itens.",
  "Escolha uma variação para o produto %",
  "Produto % não disponível.",
  "Estoque insuficiente para o produto % (Disponível: %, Solicitado: %)",
  "Entrega local não disponível para o CEP informado.",
  "A cotação de frete expirou. Calcule o frete novamente e refaça o pedido.",
  "Cupom % inválido ou expirado.",
  "Os valores do pedido mudaram. Atualize o carrinho e tente novamente.",
  "Estoque insuficiente para o produto %",
];

const sql = Object.values(MIGRATIONS).join("\n");

describe("as mensagens que o classificador reconhece continuam existindo no SQL", () => {
  // As DUAS travas de vacuidade. So' o tamanho nao basta: um glob que casasse
  // UM arquivo grande passaria no piso de caracteres e ainda assim estaria
  // lendo quase nada.
  it("o glob casou o diretorio inteiro de migrations", () => {
    // 🔴 O piso e' 20, e NAO a contagem de hoje (142), de proposito. O ADR
    // `docs/decisoes/0002-baseline-do-ledger-de-migrations.md`, amarrado a issue
    // #131, deixou em aberto arquivar as 98 migrations pre-baseline; se isso for
    // feito sobram ~44, e um piso colado em 100 deixaria este teste vermelho sem
    // nada de errado ter acontecido. 20 continua pegando o que a trava existe
    // para pegar: glob quebrado, que casa ZERO ou UM arquivo.
    expect(Object.keys(MIGRATIONS).length).toBeGreaterThan(20);
  });

  it("o corpus lido nao esta vazio -- senao tudo abaixo passa por vacuidade", () => {
    expect(sql.length).toBeGreaterThan(100000);
  });

  for (const frase of FRASES_DO_BANCO) {
    it(`ainda existe em alguma migration: ${frase.slice(0, 45)}`, () => {
      expect(
        sql.includes(frase),
        // Aspas, nao crase: sem interpolacao, a crase e' erro de Biome
        // (`lint/style/noUnusedTemplateLiteral`) e o Biome so' reprova no CI.
        "A frase acima sumiu das migrations. Se ela foi REESCRITA, " +
          "src/lib/recusaDoPedido.ts precisa da regra nova NA MESMA rodada -- senao a " +
          "recusa cai no caso generico e a pessoa volta a ficar sem acao no ultimo clique.",
      ).toBe(true);
    });
  }
});
```

- [ ] **Step 2: Rode e veja PASSAR de primeira**

Run: `npx vitest run tests/front/recusa-do-pedido-ancora-nas-migrations.test.ts`
Expected: PASS, 12 testes (as 10 frases + as 2 travas de vacuidade). **Passar de primeira
aqui é o esperado** — o teste descreve o estado atual do SQL. O que prova que ele funciona é
o Step 3, não este.

**Também obrigatório neste passo:** rode `npm run typecheck` e `npx eslint tests/front/recusa-do-pedido-ancora-nas-migrations.test.ts`. Nenhum dos dois pode acusar nada
neste arquivo — foi exatamente aí que a primeira versão reprovou.

- [ ] **Step 3: Prove que a âncora detecta mudança de verdade**

Acrescente `"Uma frase que nao existe em migration nenhuma."` ao fim de `FRASES_DO_BANCO` e
rode. Expected: **1 teste falha**, com a mensagem explicativa. Tire a linha e rode de novo:
12 passam.

- [ ] **Step 3b: Prove que as travas de vacuidade travam**

Troque o padrão do glob para `"/supabase/migrations/nao-existe-*.sql"` e rode. Expected: as
**duas** travas de vacuidade ficam vermelhas (0 arquivos, 0 caracteres) — e é isso que
impede o resto do arquivo de passar por vacuidade. Devolva o padrão editando o arquivo.

- [ ] **Step 4: Commit**

```bash
git commit -m "test(checkout): mensagem de recusa nao muda mais em silencio" -- tests/front/recusa-do-pedido-ancora-nas-migrations.test.ts
```

---

### Task 3: A reconferência do carrinho — a ação que hoje não existe

**Files:**
- Create: `src/lib/reconferirCarrinho.ts`
- Test: `tests/front/reconferir-carrinho.test.ts`

**Interfaces:**
- Consumes: `CartItem` de `@/types`; o leitor do catálogo é **injetado por parâmetro**, não
  importado, para o teste não precisar de banco.
- Produces:
  - `interface MudancaNoCarrinho { productId: string; variantId?: string; nome: string; tipo: "preco" | "estoque" | "sumiu"; de?: number; para?: number }`
  - `interface LeitorDeCatalogo { lerProdutos(ids: string[]): Promise<Array<{ id: string; nome: string; preco: number; estoque: number; ativo: boolean }>> }`
  - `interface ResultadoDaReconferencia { mudancas: MudancaNoCarrinho[]; oBancoRecusaria: boolean }`
  - `function reconferirCarrinho(itens: CartItem[], db: LeitorDeCatalogo): Promise<ResultadoDaReconferencia>`

**Rodada 6, e por que é a última mudança de desenho.** As rodadas 4 e 5 tentaram resolver o
problema com DUAS funções compostas pelo chamador: `reconferirCarrinho(itens, db)` listava
`MudancaNoCarrinho[]`, e `oBancoRecusaria(itens, mudancas)` recebia essa lista de volta e
precisava **casar** cada mudança com a linha do carrinho para saber a quantidade — porque a
mudança não carrega a quantidade, só o item do carrinho carrega.

Essa casada produziu dois defeitos seguidos, cada um medido pela revisão de contexto limpo:

- **Rodada 4:** a chave do `Map` era só `productId`. Duas linhas do mesmo produto em variações
  diferentes (camiseta P e camiseta M) colapsavam na mesma entrada, e a conta usava a
  quantidade da ÚLTIMA linha lida.
- **Rodada 5:** a chave passou a incluir a variação — só que do lado do **carrinho**. As
  mudanças nunca carregam `variantId` (quem preenche é a Task 3b), então a busca errava a
  chave, e o `?? 0` transformava *"não achei esta linha"* em *"esta mudança não pesa nada"*.
  Medido com as duas funções reais: um carrinho com variação e R$ 5,00 de diferença de preço
  devolvia `false` — "o banco aceitaria" — e o banco recusa.

A causa raiz nunca foi a chave: foi **ter duas listas para casar**. Se ninguém precisa casar
nada, não há chave para errar. Por isso a rodada 6 funde as duas funções numa só,
`reconferirCarrinho`, que faz a conta **na mesma passada** que monta a lista de mudanças, com a
quantidade da própria linha do carrinho na mão — sem `Map`, sem chave, sem `?? 0`. E o chamador
deixa de ter como passar uma lista de mudanças que não corresponde aos itens (a "lista
filtrada" que a Task 5 e o refresh depois de remover um item produziriam), porque não existe
mais parâmetro de lista nenhum: `oBancoRecusaria` deixa de ser exportada, e o resultado vira
`{ mudancas, oBancoRecusaria }`.

- [ ] **Step 1: Escreva o teste que falha**

```ts
import { reconferirCarrinho } from "@/lib/reconferirCarrinho";
import type { CartItem, Product } from "@/types";
import { describe, expect, it } from "vitest";

// 🔴 CORRIGIDO em 28/08/2026, depois de a Task 3 reprovar o `npm run typecheck`.
// A primeira versao deste plano assumia `product.nome` e `product.preco`; o tipo
// real de `@/types` usa `name` e `price`. O teste antigo usava
// `as unknown as CartItem`, e foi ESSE cast que escondeu o erro do compilador --
// o teste passava contra uma forma que nao existe. Monte um `Product` DE VERDADE:
// assim quem erra o nome do campo descobre no typecheck, nao em producao.
const produto = (id: string, price: number): Product => ({
  id,
  name: `Produto ${id}`,
  description: "",
  price,
  images: [],
  category: "geral",
  stock: 99,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: "2026-08-28T00:00:00Z",
});

const item = (id: string, price: number, qtd: number): CartItem => ({
  product: produto(id, price),
  quantity: qtd,
});

const leitor = (
  linhas: Array<{
    id: string;
    nome: string;
    preco: number;
    estoque: number;
    ativo: boolean;
  }>,
) => ({ lerProdutos: async () => linhas });

describe("reconferirCarrinho", () => {
  it("preco igual e estoque suficiente -> nenhuma mudanca", async () => {
    const r = await reconferirCarrinho(
      [item("a", 10, 2)],
      leitor([
        { id: "a", nome: "Produto a", preco: 10, estoque: 5, ativo: true },
      ]),
    );
    expect(r.mudancas).toEqual([]);
  });

  it("preco mudou -> aponta de quanto para quanto", async () => {
    const r = await reconferirCarrinho(
      [item("a", 10, 1)],
      leitor([
        { id: "a", nome: "Produto a", preco: 12.5, estoque: 5, ativo: true },
      ]),
    );
    expect(r.mudancas).toEqual([
      { productId: "a", nome: "Produto a", tipo: "preco", de: 10, para: 12.5 },
    ]);
  });

  it("estoque menor que o pedido -> aponta quanto ainda ha", async () => {
    const r = await reconferirCarrinho(
      [item("a", 10, 4)],
      leitor([
        { id: "a", nome: "Produto a", preco: 10, estoque: 1, ativo: true },
      ]),
    );
    expect(r.mudancas).toEqual([
      { productId: "a", nome: "Produto a", tipo: "estoque", de: 4, para: 1 },
    ]);
  });

  it("produto desativado -> sumiu", async () => {
    const r = await reconferirCarrinho(
      [item("a", 10, 1)],
      leitor([
        { id: "a", nome: "Produto a", preco: 10, estoque: 5, ativo: false },
      ]),
    );
    expect(r.mudancas[0].tipo).toBe("sumiu");
  });

  it("produto que o banco nao devolve -> sumiu, e NAO quebra", async () => {
    const r = await reconferirCarrinho([item("a", 10, 1)], leitor([]));
    expect(r.mudancas[0].tipo).toBe("sumiu");
    expect(r.mudancas[0].productId).toBe("a");
  });

  it("carrinho vazio -> nao consulta o banco", async () => {
    let chamou = false;
    const r = await reconferirCarrinho([], {
      lerProdutos: async () => {
        chamou = true;
        return [];
      },
    });
    expect(r.mudancas).toEqual([]);
    expect(chamou).toBe(false);
  });

  it("o MESMO produto em duas linhas do carrinho NAO duplica o id na consulta", async () => {
    // Achado da revisao: `itens.map((i) => i.product.id)` mandava
    // `["a", "a"]` ao banco quando o mesmo produto aparece em duas linhas
    // (por exemplo, duas variacoes ainda sem `variantId` distinguindo-as).
    let idsRecebidos: string[] = [];
    const r = await reconferirCarrinho([item("a", 10, 1), item("a", 10, 2)], {
      lerProdutos: async (ids) => {
        idsRecebidos = ids;
        return [
          { id: "a", nome: "Produto a", preco: 10, estoque: 5, ativo: true },
        ];
      },
    });
    expect(idsRecebidos).toEqual(["a"]);
    expect(r.mudancas).toEqual([]);
  });

  it("mudanca de 3 centavos E' relatada -- quem julga se importa e' outro", async () => {
    // Esta funcao nao tem tolerancia na LISTA: ela relata o que mudou. Quem
    // julga se e' o suficiente pra o banco recusar e' `oBancoRecusaria`, no
    // mesmo resultado. Ter a regua em dois lugares produziu dois defeitos.
    const r = await reconferirCarrinho(
      [item("a", 10, 1)],
      leitor([
        { id: "a", nome: "Produto a", preco: 10.03, estoque: 5, ativo: true },
      ]),
    );
    expect(r.mudancas).toHaveLength(1);
    expect(r.mudancas[0]).toMatchObject({ tipo: "preco", de: 10, para: 10.03 });
  });

  it("o MESMO item com preco E estoque mudados reporta os DOIS", async () => {
    // Reportar so' o primeiro devolve a pessoa ao mesmo beco uma rodada depois.
    const r = await reconferirCarrinho(
      [item("a", 10, 4)],
      leitor([
        { id: "a", nome: "Produto a", preco: 12.5, estoque: 1, ativo: true },
      ]),
    );
    expect(r.mudancas.map((m) => m.tipo).sort()).toEqual(["estoque", "preco"]);
  });
});

describe("oBancoRecusaria", () => {
  // 🔴 Rodada 6: nao existe mais uma funcao separada que recebe as DUAS
  // listas (itens + mudancas) e precisa casa-las de volta por chave. Foi essa
  // casada que produziu os defeitos das rodadas 4 e 5 -- a chave so' no
  // produto colapsava variacoes diferentes, e depois a chave composta
  // encontrava as mudancas (que nunca carregam `variantId`) e o `?? 0`
  // silenciava a nao-achada como "nao pesa nada". Aqui o cenario e' montado
  // no LEITOR (o catalogo "vivo"), e a resposta se le em
  // `.oBancoRecusaria`, no MESMO objeto que `reconferirCarrinho` devolve --
  // nao ha chave para casar porque nao ha lista pra casar com outra.

  it("QUANTIDADE multiplica: 4 centavos vezes 10 unidades passa do teto", async () => {
    // O caso medido que provou o defeito da rodada 1: o banco recusava 100,40
    // contra 100,00 e a funcao dizia "nada mudou".
    //
    // 🔴 `estoque: 20` (nao 5): com estoque menor que a quantidade, o teste
    // passaria mesmo se a multiplicacao por `item.quantity` sumisse do
    // codigo, porque `deEstoque.length > 0` sozinho ja faz `oBancoRecusaria`
    // dar `true` -- e essa e' a recusa ERRADA, mascarando a do preco. Medido
    // nesta rodada: a sabotagem "tirar o `* item.quantity`" nao derrubava
    // NADA com `estoque: 5` aqui.
    const r = await reconferirCarrinho(
      [item("a", 10, 10)],
      leitor([
        { id: "a", nome: "Produto a", preco: 10.04, estoque: 20, ativo: true },
      ]),
    );
    expect(r.oBancoRecusaria).toBe(true);
  });

  it("dois itens de 4 centavos no MESMO sentido somam e passam do teto", async () => {
    const r = await reconferirCarrinho(
      [item("a", 10, 1), item("b", 20, 1)],
      leitor([
        { id: "a", nome: "Produto a", preco: 10.04, estoque: 5, ativo: true },
        { id: "b", nome: "Produto b", preco: 20.04, estoque: 5, ativo: true },
      ]),
    );
    expect(r.oBancoRecusaria).toBe(true);
  });

  // 🔴 O TESTE QUE FALTAVA, e sem ele a rodada 2 passou com a conta errada.
  // Somar MODULOS e' uma conta diferente de somar COM SINAL, e so' este caso
  // separa as duas. A revisao mediu: com a suite antiga, trocar uma pela outra
  // deixava os 10 testes verdes.
  it("SINAIS OPOSTOS se cancelam, igual no banco -- e a tela NAO avisa", async () => {
    // A lojista sobe R$ 3 na camiseta e baixa R$ 3 na caneca. O banco calcula
    // 30,00 contra 30,00 e FECHA o pedido.
    const r = await reconferirCarrinho(
      [item("a", 10, 1), item("b", 20, 1)],
      leitor([
        { id: "a", nome: "Produto a", preco: 13, estoque: 5, ativo: true },
        { id: "b", nome: "Produto b", preco: 17, estoque: 5, ativo: true },
      ]),
    );
    expect(r.oBancoRecusaria).toBe(false);
  });

  it("EXATAMENTE 5 centavos NAO passa -- o banco usa `> 0.05`, nao `>=`", async () => {
    // Em ponto flutuante isto da' 0.050000000000000710 e passaria; a conta em
    // centavos inteiros da' 5, e 5 > 5 e' falso, igual ao `numeric` do Postgres.
    const r = await reconferirCarrinho(
      [item("a", 10, 1)],
      leitor([
        { id: "a", nome: "Produto a", preco: 10.05, estoque: 5, ativo: true },
      ]),
    );
    expect(r.oBancoRecusaria).toBe(false);
  });

  it("estoque insuficiente recusa sozinho, sem faixa de aceitacao", async () => {
    const r = await reconferirCarrinho(
      [item("a", 10, 4)],
      leitor([
        { id: "a", nome: "Produto a", preco: 10, estoque: 1, ativo: true },
      ]),
    );
    expect(r.oBancoRecusaria).toBe(true);
  });

  it("item sumido recusa sozinho", async () => {
    const r = await reconferirCarrinho([item("a", 10, 1)], leitor([]));
    expect(r.oBancoRecusaria).toBe(true);
  });

  it("carrinho sem mudanca nenhuma -> nao recusa", async () => {
    const r = await reconferirCarrinho(
      [item("a", 10, 1)],
      leitor([
        { id: "a", nome: "Produto a", preco: 10, estoque: 5, ativo: true },
      ]),
    );
    expect(r.oBancoRecusaria).toBe(false);
  });

  // 🔴 O TESTE DE COMPOSICAO que a revisao pediu -- o cenario EXATO que
  // devolvia `false` na rodada 5, com as duas funcoes reais. Item com
  // `variantId` preenchido, diferenca de preco que passa do teto so' quando
  // multiplicada pela quantidade: se a chave composta ainda existisse, esta
  // mudanca teria variantId indefinido (nao vem da Task 3b) e seria
  // silenciada.
  it("item COM variantId cuja diferenca multiplicada pela quantidade passa do teto -> banco recusa", async () => {
    // `estoque: 20`, pelo mesmo motivo do teste "QUANTIDADE multiplica":
    // estoque menor que a quantidade recusaria por ESTOQUE, mascarando o que
    // este teste prova sobre PRECO.
    const comVariacao: CartItem = { ...item("a", 10, 10), variantId: "M" };
    const r = await reconferirCarrinho(
      [comVariacao],
      leitor([
        { id: "a", nome: "Produto a", preco: 10.04, estoque: 20, ativo: true },
      ]),
    );
    expect(r.oBancoRecusaria).toBe(true);
  });

  // 🔴 O teste que prendia a chave composta agora e' de ponta a ponta: duas
  // linhas do MESMO produto, variacoes diferentes, quantidades diferentes.
  // Sem casar nada por chave, cada linha usa a propria quantidade na conta.
  it("MESMO produto em duas linhas com variacoes DIFERENTES usa a quantidade de CADA uma", async () => {
    // `estoque: 20`: cobre a linha M (10 unidades) sem disparar a recusa por
    // estoque, que mascararia a de preco -- mesmo motivo do teste acima.
    const catalogo = leitor([
      { id: "a", nome: "Produto a", preco: 10.04, estoque: 20, ativo: true },
    ]);
    const camisetaM: CartItem = { ...item("a", 10, 10), variantId: "M" };
    const camisetaP: CartItem = { ...item("a", 10, 1), variantId: "P" };

    // So' a linha M (10 unidades) multiplica os 4 centavos por 10 = 40
    // centavos: passa do teto sozinha.
    const soM = await reconferirCarrinho([camisetaM], catalogo);
    expect(soM.oBancoRecusaria).toBe(true);

    // A MESMA diferenca de preco na linha P (1 unidade) da' so' 4 centavos:
    // nao passa sozinha.
    const soP = await reconferirCarrinho([camisetaP], catalogo);
    expect(soP.oBancoRecusaria).toBe(false);

    // Juntas no mesmo carrinho, as duas linhas somam 40 + 4 = 44 centavos: o
    // dedup do id para a consulta ao catalogo NAO colapsa a conta por linha.
    const juntas = await reconferirCarrinho([camisetaM, camisetaP], catalogo);
    expect(juntas.oBancoRecusaria).toBe(true);
  });
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `npx vitest run tests/front/reconferir-carrinho.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/reconferirCarrinho"`.

- [ ] **Step 3: Escreva a implementação mínima**

```ts
import type { CartItem } from "@/types";

/**
 * Relê o catálogo e diz, numa passada só, o que mudou desde que a pessoa pôs
 * no carrinho E se o banco recusaria o pedido com o que mudou.
 *
 * ESTA É A AÇÃO QUE A MENSAGEM DO BANCO MANDA EXECUTAR e que o app não tinha:
 * "Os valores do pedido mudaram. Atualize o carrinho e tente novamente." —
 * medido em 28/08/2026, `grep -rn "refreshCart" src/` voltava vazio.
 *
 * Serve VISITANTE e logado igual. Hoje `CartContext.tsx:190` sai antes de
 * revalidar quando não há usuário, e é por isso que a recusa acerta
 * principalmente quem ainda não tem conta.
 *
 * ------------------------------------------------------------------
 * DUAS PERGUNTAS, UMA PASSADA — e por que elas não podem ser duas funções
 * compostas pelo chamador.
 *
 * São duas perguntas com respostas opostas:
 *
 *   "o que mudou no meu carrinho?"   -> o CartProvider (Task 6) quer TUDO,
 *                                        sem faixa de aceitação nenhuma.
 *   "o banco recusaria este pedido?" -> o painel (Task 5) quer a conta do
 *                                        banco, com sinal e com tolerância.
 *
 * Até a rodada 5, cada pergunta era uma função: `reconferirCarrinho` listava
 * `MudancaNoCarrinho[]`, e `oBancoRecusaria(itens, mudancas)` recebia essa
 * lista de volta e precisava CASAR cada mudança com a linha do carrinho para
 * saber a quantidade. Essa casada é que produziu dois defeitos seguidos:
 *
 *   Rodada 4: a chave era só `productId`   -> camiseta P e camiseta M (mesmo
 *                                             produto, variações diferentes)
 *                                             colapsavam na mesma entrada do
 *                                             Map, e a conta usava a
 *                                             quantidade da ÚLTIMA linha.
 *   Rodada 5: a chave passou a incluir a   -> as mudanças NUNCA carregam
 *             variação, só de um lado         `variantId` (quem preenche é a
 *                                             Task 3b); a busca errava a
 *                                             chave, e o `?? 0` transformava
 *                                             "não achei esta linha" em "esta
 *                                             mudança não pesa nada" — medido
 *                                             com as duas funções reais: R$
 *                                             5,00 de diferença virava
 *                                             `false`, e o banco recusa.
 *
 * A causa raiz não era a chave — era TER duas listas para casar. Se ninguém
 * precisa casar nada, não há chave para errar. Por isso a conta agora é feita
 * NA MESMA passada que monta a lista de mudanças, com a quantidade da própria
 * linha do carrinho na mão — sem Map, sem chave, sem `?? 0`. E o chamador não
 * tem mais como passar uma lista de mudanças que não corresponde aos itens
 * (a "lista filtrada" que a Task 5 e o refresh depois de remover item
 * produziriam), porque não existe mais parâmetro de lista nenhum.
 *
 * 🔴 `mudancas: []` NUNCA quer dizer "o pedido vai passar". Quer dizer "nada
 * mudou nos ITENS". O total do banco também leva frete e desconto, e o campo
 * `frete_gratis` do produto pode mudar sozinho a conta inteira — medido pela
 * revisão de 28/08/2026: produto com frete grátis desligado pela lojista faz
 * o banco recalcular com R$ 15 de frete e recusar, com preço, estoque e
 * `ativo` idênticos. Quem renderizar isto (Task 4) **não pode** transformar
 * `mudancas: []` em "conferimos, está tudo certo" — só `oBancoRecusaria`
 * julga, e mesmo ela é incompleta por construção (não vê frete/desconto).
 *
 * ------------------------------------------------------------------
 * O QUE `oBancoRecusaria` COPIA DO BANCO, e por que na unidade certa:
 *
 * A trava do banco é `ABS(v_calculated_total - p_total_amount) > 0.05`, e
 * `v_calculated_total` é `Σ(preço × QUANTIDADE) + frete − desconto`. A
 * quantidade MULTIPLICA a diferença.
 *
 *   Rodada 1: tolerância POR ITEM       -> ESCONDIA. 10 unidades subindo 4
 *                                          centavos davam "nada mudou", e o
 *                                          banco recusava por 40 centavos.
 *   Rodada 2: soma dos MÓDULOS          -> ASSUSTAVA. Um item sobe R$ 3 e
 *                                          outro desce R$ 3: o banco fecha o
 *                                          pedido, e a tela avisava mesmo
 *                                          assim.
 *
 * 🔴 Por isso a soma é COM SINAL, módulo só no fim, e por isso `mudancas`
 * (a lista) segue sem tolerância nenhuma: ela só RELATA, quem julga é
 * `oBancoRecusaria`. Ter essa régua em dois lugares foi o que produziu os
 * dois defeitos acima.
 */
export interface MudancaNoCarrinho {
  productId: string;
  /**
   * Ainda NÃO preenchido — fica sempre `undefined` até a Task 3b, que passa a
   * ler `product_variants` e sabe de qual variação a mudança veio. Não
   * precisa dele para a conta: cada linha do carrinho já carrega a própria
   * quantidade, então o total de `oBancoRecusaria` não depende de casar esta
   * mudança de volta com o item — é por isso que colapsar duas variações do
   * mesmo produto (a chave da rodada 4/5) deixou de ser possível.
   */
  variantId?: string;
  nome: string;
  tipo: "preco" | "estoque" | "sumiu";
  de?: number;
  para?: number;
}

export interface LeitorDeCatalogo {
  lerProdutos(ids: string[]): Promise<
    Array<{
      id: string;
      nome: string;
      preco: number;
      estoque: number;
      ativo: boolean;
    }>
  >;
}

export interface ResultadoDaReconferencia {
  /** O que mudou, sem faixa de aceitação nenhuma. É o que a tela LISTA. */
  mudancas: MudancaNoCarrinho[];
  /**
   * A conta do banco: `Σ(Δpreço × quantidade)` com SINAL, em centavos
   * inteiros, contra a tolerância de 5 — mais estoque e item sumido, que
   * recusam sozinhos, sem faixa de aceitação.
   *
   * ⚠️ `false` significa **"os ITENS não explicam uma recusa"**, nunca "o
   * pedido vai passar": o total do banco também leva frete e desconto.
   */
  oBancoRecusaria: boolean;
}

/**
 * A tolerância da trava do banco, em CENTAVOS INTEIROS.
 *
 * Por que centavos e não `0.05`: medido pela revisão de 28/08/2026, uma
 * diferença de exatamente 5 centavos em ponto flutuante dá
 * `0.050000000000000710` e **passa** de `> 0.05`, enquanto o `numeric` do
 * Postgres calcula 0,05 exato e **não** passa. Ou seja: a mesma conta, escrita
 * do mesmo jeito, dá respostas diferentes dos dois lados — e o lado errado é o
 * nosso, avisando à toa. Fazendo a conta em inteiro (centavos), some.
 */
const TOLERANCIA_EM_CENTAVOS = 5;

const emCentavos = (reais: number) => Math.round(reais * 100);

export const reconferirCarrinho = async (
  itens: CartItem[],
  db: LeitorDeCatalogo,
): Promise<ResultadoDaReconferencia> => {
  if (itens.length === 0) return { mudancas: [], oBancoRecusaria: false };

  // Dedup só para a CONSULTA ao catálogo: o mesmo produto pode aparecer em
  // duas linhas do carrinho (duas variações), e pedir o id duas vezes ao
  // banco é desperdício. O loop abaixo continua correndo por LINHA (`itens`,
  // não `ids`), então cada linha usa a própria quantidade — é isso que evita
  // a chave composta das rodadas 4/5.
  const ids = [...new Set(itens.map((i) => i.product.id))];
  const vivos = await db.lerProdutos(ids);
  const porId = new Map(vivos.map((p) => [p.id, p]));

  const sumiram: MudancaNoCarrinho[] = [];
  const deEstoque: MudancaNoCarrinho[] = [];
  const dePreco: MudancaNoCarrinho[] = [];
  let diferencaEmCentavos = 0;

  for (const item of itens) {
    const id = item.product.id;
    const vivo = porId.get(id);
    // `name`/`price`, nao `nome`/`preco`: sao os nomes do tipo `Product` de
    // `@/types`. A primeira versao deste plano errou isso e o typecheck pegou.
    const nome = vivo?.nome ?? item.product.name;

    if (!vivo || !vivo.ativo) {
      sumiram.push({ productId: id, nome, tipo: "sumiu" });
      continue;
    }

    // SEM `continue` entre preço e estoque: o mesmo item pode ter mudado nos
    // dois, e reportar só o primeiro devolve a pessoa ao mesmo beco uma rodada
    // depois — ela aceita o preço novo, clica, e leva recusa por estoque.
    // Achado da revisão de contexto limpo, 28/08/2026.
    if (vivo.estoque < item.quantity) {
      deEstoque.push({
        productId: id,
        nome,
        tipo: "estoque",
        de: item.quantity,
        para: vivo.estoque,
      });
    }

    // A conta do banco, feita AQUI, com a quantidade DESTA linha na mão. Não
    // há Map nem chave para errar — foi a causa dos defeitos das rodadas 4 e
    // 5. Soma COM SINAL: dois itens que se cancelam somam zero, igual ao
    // banco.
    const deltaEmCentavos =
      emCentavos(vivo.preco) - emCentavos(item.product.price);
    if (deltaEmCentavos !== 0) {
      diferencaEmCentavos += deltaEmCentavos * item.quantity;
      // SEM tolerância aqui: esta lista só RELATA. Julgar se a diferença é
      // suficiente para o banco recusar é o que `oBancoRecusaria`, abaixo,
      // decide — ter essa régua em dois lugares foi o que produziu os
      // defeitos das rodadas 1 e 2.
      dePreco.push({
        productId: id,
        nome,
        tipo: "preco",
        de: item.product.price,
        para: vivo.preco,
      });
    }
  }

  const mudancas = [...sumiram, ...deEstoque, ...dePreco];

  return {
    mudancas,
    // Sumido e estoque curto recusam sozinhos: o banco não tem faixa de
    // aceitação para eles.
    oBancoRecusaria:
      sumiram.length > 0 ||
      deEstoque.length > 0 ||
      Math.abs(diferencaEmCentavos) > TOLERANCIA_EM_CENTAVOS,
  };
};
```

- [ ] **Step 4: Rode e veja passar**

Run: `npx vitest run tests/front/reconferir-carrinho.test.ts`
Expected: PASS, 18 testes.

- [ ] **Step 5: Prove com sabotagem, uma por vez**

Cinco sabotagens, cada uma isolada e revertida antes da próxima — **nunca** com `git checkout`,
sempre editando o arquivo de volta:

1. Trocar `diferencaEmCentavos += deltaEmCentavos * item.quantity;` por
   `diferencaEmCentavos += Math.abs(deltaEmCentavos * item.quantity);` (soma de módulos).
   Expected: **"SINAIS OPOSTOS se cancelam"** falha.
2. Trocar `> TOLERANCIA_EM_CENTAVOS` por `>= TOLERANCIA_EM_CENTAVOS`.
   Expected: **"EXATAMENTE 5 centavos NAO passa"** falha.
3. Trocar `diferencaEmCentavos += deltaEmCentavos * item.quantity;` por
   `diferencaEmCentavos += deltaEmCentavos;` (tira a multiplicação pela quantidade).
   Expected: **"QUANTIDADE multiplica"**, **"item COM variantId..."** e **"MESMO produto em
   duas linhas..."** falham — as três dependem da quantidade multiplicar a diferença.
   🔴 **Armadilha medida nesta rodada:** se o `estoque` do leitor for menor que a quantidade do
   item nesses três testes, a sabotagem NÃO derruba nada, porque a recusa por estoque
   insuficiente mascara a de preço. O `estoque` desses três cenários precisa ser maior que a
   quantidade testada.
4. Devolver o `continue` depois do `push` em `deEstoque` (parar de avaliar preço quando o
   estoque já faltou).
   Expected: **"o MESMO item com preco E estoque mudados reporta os DOIS"** falha.
5. Trocar `if (deltaEmCentavos !== 0)` por
   `if (Math.abs(deltaEmCentavos) > TOLERANCIA_EM_CENTAVOS)` (tolerância dentro da lista de
   mudanças).
   Expected: **"mudanca de 3 centavos E' relatada"** e as quatro que dependem de somar
   diferenças pequenas (**"QUANTIDADE multiplica"**, **"dois itens de 4 centavos..."**, **"item
   COM variantId..."**, **"MESMO produto em duas linhas..."**) falham — 5 no total.

Depois de cada sabotagem, desfaça editando o arquivo de volta e rode de novo até os 18 testes
voltarem verdes.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(cart): o app passa a saber reconferir o carrinho, inclusive sem conta" -- src/lib/reconferirCarrinho.ts tests/front/reconferir-carrinho.test.ts
```

---

### Task 3c: As quatro frases e a linha que fecham a família de defeitos

**Files:**
- Modify: `src/lib/reconferirCarrinho.ts`
- Test: `tests/front/reconferir-carrinho.test.ts` (acrescentar 1 caso)

**Por que esta tarefa existe.** A revisão da rodada 6 devolveu **PASSA** — o sexto defeito não
existe. Mas ela deixou quatro pontos que são **a mesma família que já mordeu cinco vezes**:
comentário que engana, e ausência lida como resposta. Todos são baratos agora, e caros depois
que a Task 4 e a Task 6 lerem este arquivo como contrato.

- [ ] **Step 1: A enumeração do `false` omite justamente a maior**

O aviso diz que `false` não vê "frete e desconto". Falta a **variação**, que é a maior das
três e a única que a peça vai deixar de ter até a Task 3b: o banco usa
`COALESCE(v.price_override, p.preco_venda)` e `v.stock_increment`, e o app já manda o total
com o override. A lojista que mexe **só** no `price_override` faz o banco levantar a
mensagem #9, e esta função responde `{mudancas: [], oBancoRecusaria: false}`.

Quem ler só este arquivo recebe uma lista que **parece completa**. É a forma exata do defeito
#5. Acrescente a variação à enumeração, dizendo que ela sai na Task 3b.

- [ ] **Step 2: O lado `true` também tem ponto cego, e ele não está escrito**

O banco aplica o cupom depois do subtotal e **limita o desconto ao subtotal**. Cupom fixo de
R$ 50 num carrinho de R$ 40: a lojista sobe R$ 5 e o banco **aceita**, enquanto a peça
responde `true`.

**Não ensine cupom à peça** — seria a correção que cria o próximo defeito. Escreva a frase do
outro lado: `true` quer dizer *"os itens sozinhos passariam do teto"*, não *"o banco vai
recusar"*.

- [ ] **Step 3: `lerProdutos` não tem como dizer "não consegui ler"**

O contrato devolve `Array<…>`. Um adaptador que engula o erro do Supabase e devolva
`data ?? []` — a forma mais comum de errar isso — faz um carrinho de 3 itens válidos virar 3
mudanças `"sumiu"`, e o painel oferece remover produto que existe.

Escreva no docstring da interface: **leitura que falha tem de lançar; `[]` significa "nenhum
destes produtos está à venda"**. É contrato, não código.

- [ ] **Step 4: O `NaN` falha ABERTO, e apaga a diferença de todo mundo**

Medido: item sem `preco` faz `emCentavos` dar `NaN`, `diferencaEmCentavos` vira `NaN`, e
`Math.abs(NaN) > 5` é `false` — **apagando a diferença de todos os outros itens**. Item A sem
preço + item B subindo R$ 5,00 → `oBancoRecusaria: false`.

Inalcançável por adaptador que respeite o tipo, mas é **falha aberta no caminho do dinheiro**,
que é a assinatura de todos os cinco defeitos anteriores. Uma linha:

```ts
oBancoRecusaria:
  sumiram.length > 0 ||
  deEstoque.length > 0 ||
  !Number.isFinite(diferencaEmCentavos) ||
  Math.abs(diferencaEmCentavos) > TOLERANCIA_EM_CENTAVOS,
```

**Teste novo, e ele é o que prova o Step 4:** item com `preco` ausente no catálogo mais um
item subindo R$ 5,00 → `oBancoRecusaria` tem de ser `true`. **Sabotagem obrigatória:** tire o
`!Number.isFinite(...)` e mostre esse teste ficando vermelho.

- [ ] **Step 5: Feche a porta do leitor antes da Task 3b**

`new Map(vivos.map((p) => [p.id, p]))` fica com a **última** linha de cada id. Hoje é
inalcançável (`produtos.id` é chave primária). Mas quando a Task 3b juntar `product_variants`,
**um produto com três variações volta em três linhas com o mesmo id** — e o colapso da rodada
4 reentra pelo lado do **leitor**, não das mudanças.

A interface é definida aqui, então feche aqui: escreva no contrato que `lerProdutos` devolve
**uma linha por id**, e que variação vem por `lerVariacoes` (Task 3b), nunca duplicando
produto.

- [ ] **Step 6: Verificação**

`npx vitest run`, `npm run typecheck`, `npx eslint`, `npx biome check`, CRLF em bytes — todos
zero. Mais a sabotagem do Step 4.

---

### Task 3b: DESCARTADA em 28/08/2026 — não reconstrua sem ler isto

🔴 **A regra de parada disparou, e o Gabriel aprovou o descarte.** O código desta tarefa foi
apagado da árvore de trabalho (nunca chegou a ser commitado). Os bytes das três versões estão
guardados fora do repositório, mas **guardar não é licença para ressuscitar sem revisão nova**.

**O que se tentou:** fazer a reconferência enxergar a variação escolhida — preço e estoque
vindos de `COALESCE(v.price_override, p.preco_venda)` e `v.stock_increment`, como o banco faz.

**Por que parou:** dez rodadas de código, onze revisões, **oito defeitos** — todos da mesma
família (*a peça afirma sobre dinheiro o que não pode sustentar*), e **três** deles nascidos
dentro da rodada que consertava o anterior. O oitavo foi medido com os módulos reais:

- **Alarme falso permanente.** Adaptador sem `lerVariacoes` (o caminho de hoje), produto base
  R$ 50, variação com `price_override` R$ 60, **nada mudou** → a peça relatava
  `{"tipo":"preco","de":60,"para":50}` e `oBancoRecusaria: true`. HEAD e rodada 9: silêncio,
  correto. **A correção criou o defeito.**
- **Falso silêncio.** A soma é com sinal (e tem de ser — foi o conserto da rodada 2), então o
  delta fabricado **cancelava** a alta real de outra linha: `oBancoRecusaria: false` com o
  banco recusando. Falha ABERTA no caminho do dinheiro.

**A razão estrutural, e é ela que importa:** naquele caminho **não existe emparelhamento
certo**. O lado esquerdo exigiria o preço vivo da variação, indisponível por construção — é a
definição do caminho. Qualquer par que se escolha compara dois números que não descrevem a
mesma coisa; cada escolha só decide **em quais estados do mundo se erra**.

**Existe um conserto de uma linha, medido funcionando nos cinco cenários** (fazer os dois lados
caírem para a mesma fórmula quando o adaptador não lê variação). Ele foi **recusado de
propósito**: é a oitava vez que alguém diz "é só mais uma linha" neste arquivo, e funcionar em
cinco cenários não diz nada sobre o nono que ninguém pensou.

**O que NÃO se perdeu, porque nunca foi alcançável:**

- A guarda de `null` no preço (`emCentavos`) — `produtos.preco_venda` é `numeric(10,2)
  **NOT NULL**` (baseline, linha 814). O preço do produto não pode vir vazio do banco; só o da
  variação pode. A guarda era alcançável **só pela variação**.
- A guarda de estoque malformado — `null < quantidade` é `true` em JavaScript, então o código
  commitado **já acusa** esse caso. Só escapa `undefined`, de um leitor que não existe.

Foram medidas as duas. Não reabra a 3b alegando que elas se perderam.

**O desenho certo, se a variação voltar** (ponte da aviação: instrumento que perdeu a entrada
declara leitura inválida, não estima um número degradado): naquele caminho a peça **não calcula
delta de preço** para a linha, e `oBancoRecusaria` fica **proibido de afirmar `false`**. Isso
muda o que a peça promete — é decisão de contrato, e passa pelo Gabriel antes de virar código.

**E antes de qualquer reconstrução, a pergunta de rumo:** esta peça consumiu onze revisões para
**prever** o que o banco responde em 300 ms, enquanto as Tasks 1 e 2 — que só **escutam** o
banco — saíram em duas rodadas e estão certas. Vale perguntar se prever ainda paga.

---

### Task 3b: A reconferência enxerga a variação — e sem isto ela mente de novo

**Files:**
- Modify: `src/lib/reconferirCarrinho.ts`
- Test: `tests/front/reconferir-carrinho-variacao.test.ts`

**Interfaces:**
- Consumes: `LeitorDeCatalogo` e `MudancaNoCarrinho` (Task 3).
- Produces: `LeitorDeCatalogo` ganha `lerVariacoes(ids: string[]): Promise<Array<{ id: string; productId: string; precoEfetivo: number; estoque: number; ativa: boolean }>>`, e `MudancaNoCarrinho.variantId` passa a ser **preenchido de verdade**.

**Por que esta tarefa existe, e por que ela vem ANTES da fiação:** achado da revisão de contexto limpo de 28/08/2026. A Task 3 lê só a tabela de produtos. O banco, para item com variação, usa `COALESCE(v.price_override, p.preco_venda)` e `v.stock_increment` — não o preço e o estoque do produto base.

Cenário medido pelo revisor: produto de R$ 50,00 com estoque agregado 40, e a variação "P" **esgotada** (`stock_increment` = 0). A reconferência lê o produto base, vê preço igual e estoque de sobra, e devolve **nada mudou**. O banco entra no ramo da variação, vê 0 < 1 e recusa. **É o mesmo defeito da tolerância, na outra ponta:** a peça afirma que está tudo certo e a pessoa leva a recusa no clique seguinte.

Dois efeitos colaterais que esta tarefa também fecha:
- `MudancaNoCarrinho.variantId` hoje é **declarado e nunca preenchido** — contrato prometido e não cumprido, e a Task 4 desenharia em cima de um campo que nunca chega.
- Duas linhas do mesmo produto em variações diferentes viram duas entradas idênticas, sem a tela ter como saber qual corrigir.

**O dado está a uma consulta de distância:** `CartContext.tsx:230-240` já lê `vw_produtos_public` + `product_variants`. Copie a forma de lá.

🔴 **A API mudou na rodada 6 da Task 3, e este bloco foi atualizado junto (28/08/2026).**
`reconferirCarrinho` devolve `{ mudancas, oBancoRecusaria }`, **não** um array. Foi o executor
da rodada 6 que avisou: se alguem implementasse esta tarefa copiando a versao antiga, ela
reprovaria — ou, pior, "consertaria" fazendo a funcao voltar a devolver array puro, desfazendo
o conserto que custou seis rodadas. **Acrescente tambem, nesta tarefa, uma asercao de
`oBancoRecusaria`** para o caso da variacao esgotada: ela tem de dar `true`.

- [ ] **Step 1: Escreva os testes que falham**

```ts
import { reconferirCarrinho } from "@/lib/reconferirCarrinho";
import type { CartItem, Product } from "@/types";
import { describe, expect, it } from "vitest";

const produto = (id: string, price: number): Product => ({
  id,
  name: `Produto ${id}`,
  description: "",
  price,
  images: [],
  category: "geral",
  stock: 99,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: "2026-08-28T00:00:00Z",
});

const itemComVariacao = (
  id: string,
  price: number,
  qtd: number,
  variantId: string,
): CartItem => ({ product: produto(id, price), quantity: qtd, variantId }) as CartItem;

describe("reconferirCarrinho enxerga a variacao", () => {
  it("variacao esgotada e' vista, mesmo com o produto base cheio", async () => {
    const r = await reconferirCarrinho([itemComVariacao("a", 50, 1, "v1")], {
      lerProdutos: async () => [
        { id: "a", nome: "Produto a", preco: 50, estoque: 40, ativo: true },
      ],
      lerVariacoes: async () => [
        { id: "v1", productId: "a", precoEfetivo: 50, estoque: 0, ativa: true },
      ],
    });
    expect(r.mudancas).toEqual([
      { productId: "a", variantId: "v1", nome: "Produto a", tipo: "estoque", de: 1, para: 0 },
    ]);
  });

  it("o preco da variacao manda sobre o do produto base", async () => {
    const r = await reconferirCarrinho([itemComVariacao("a", 50, 10, "v1")], {
      lerProdutos: async () => [
        { id: "a", nome: "Produto a", preco: 50, estoque: 40, ativo: true },
      ],
      lerVariacoes: async () => [
        { id: "v1", productId: "a", precoEfetivo: 50.04, estoque: 40, ativa: true },
      ],
    });
    expect(r.mudancas[0]).toMatchObject({ variantId: "v1", tipo: "preco", para: 50.04 });
  });

  it("variacao desativada vira `sumiu`, nomeando a variacao", async () => {
    const r = await reconferirCarrinho([itemComVariacao("a", 50, 1, "v1")], {
      lerProdutos: async () => [
        { id: "a", nome: "Produto a", preco: 50, estoque: 40, ativo: true },
      ],
      lerVariacoes: async () => [
        { id: "v1", productId: "a", precoEfetivo: 50, estoque: 9, ativa: false },
      ],
    });
    expect(r.mudancas[0]).toMatchObject({ variantId: "v1", tipo: "sumiu" });
  });

  it("variacao que o banco NAO devolve vira `sumiu`, e nao quebra", async () => {
    const r = await reconferirCarrinho([itemComVariacao("a", 50, 1, "v1")], {
      lerProdutos: async () => [
        { id: "a", nome: "Produto a", preco: 50, estoque: 40, ativo: true },
      ],
      lerVariacoes: async () => [],
    });
    expect(r.mudancas[0]).toMatchObject({ variantId: "v1", tipo: "sumiu" });
  });

  it("duas linhas do MESMO produto em variacoes diferentes viram entradas distintas", async () => {
    const r = await reconferirCarrinho(
      [itemComVariacao("a", 50, 1, "v1"), itemComVariacao("a", 50, 1, "v2")],
      {
        lerProdutos: async () => [
          { id: "a", nome: "Produto a", preco: 50, estoque: 40, ativo: true },
        ],
        lerVariacoes: async () => [
          { id: "v1", productId: "a", precoEfetivo: 50, estoque: 0, ativa: true },
          { id: "v2", productId: "a", precoEfetivo: 50, estoque: 9, ativa: true },
        ],
      },
    );
    expect(r.mudancas).toHaveLength(1);
    expect(r.mudancas[0].variantId).toBe("v1");
  });

  it("item SEM variacao continua funcionando igual, e nao consulta variacoes a toa", async () => {
    let pediuVariacoes = false;
    const r = await reconferirCarrinho(
      [{ product: produto("a", 10), quantity: 1 } as CartItem],
      {
        lerProdutos: async () => [
          { id: "a", nome: "Produto a", preco: 10, estoque: 5, ativo: true },
        ],
        lerVariacoes: async () => {
          pediuVariacoes = true;
          return [];
        },
      },
    );
    expect(r.mudancas).toEqual([]);
    expect(pediuVariacoes).toBe(false);
  });
});
```

- [ ] **Step 2: Rode e veja falhar** — `npx vitest run tests/front/reconferir-carrinho-variacao.test.ts`

- [ ] **Step 2b: A guarda do valor inválido também vale para o ESTOQUE**

Achado da revisão da Task 3c, e é a mesma família que a 3c fechou para o preço. `vivo.estoque
< item.quantity` com `estoque` malformado (`undefined`/`NaN`) dá `false` **em silêncio**: o
item não entra em `deEstoque` nem afeta a conta, e a reconferência responde "tudo certo"
enquanto o estoque real pode estar insuficiente.

A 3c pôs `Number.isFinite` na conta de preço e **deixou o estoque de fora**. Feche aqui, junto
com a variação — que é exatamente onde entra uma segunda fonte de estoque (`stock_increment`)
e portanto uma segunda chance de vir malformado.

Teste: catálogo devolvendo `estoque` ausente → a linha vira mudança (ou `sumiu`), **nunca**
silêncio. E sabotagem: tire a guarda e mostre o teste vermelho.

- [ ] **Step 3: Implemente**

Regra: quando o item tem `variantId`, **a variação manda** no preço e no estoque; o produto
base ainda decide `sumiu` quando o produto inteiro saiu. Variação ausente, inativa ou com
estoque abaixo da quantidade é tratada como a Task 3 trata o produto. `variantId` vai em
toda mudança que veio de uma linha com variação.

- [ ] **Step 4: Rode a suíte das DUAS tarefas**

```bash
npx vitest run tests/front/reconferir-carrinho.test.ts tests/front/reconferir-carrinho-variacao.test.ts
```
Os testes da Task 3 **não podem** ter quebrado.

- [ ] **Step 5: Sabotagem** — faça a variação ser ignorada (leia sempre o produto base) e
mostre quais testes caem. Desfaça editando.

- [ ] **Step 6: `npx biome check --write` nos arquivos, depois `npm run typecheck` e `npx eslint`, e commit**

```bash
git commit -m "feat(cart): a reconferencia passa a enxergar a variacao escolhida" -- src/lib/reconferirCarrinho.ts tests/front/reconferir-carrinho-variacao.test.ts
```

---

### Task 4: O painel que substitui o aviso que some

**Files:**
- Create: `src/components/ui/custom/SaidaDaRecusa.tsx`
- Test: `tests/front/saida-da-recusa-oferece-a-acao.test.tsx`

**Interfaces:**
- Consumes: `RecusaDoPedido` e `AcaoDeRecusa` de `@/lib/recusaDoPedido` (Task 1).
- Produces: `function SaidaDaRecusa(props: { recusa: RecusaDoPedido; onAgir: (acao: AcaoDeRecusa) => void; onFechar: () => void }): JSX.Element`

- [ ] **Step 1: Escreva o teste que falha**

```tsx
// @vitest-environment jsdom
//
// Prova a garantia que o item 3 inteiro existe para dar: depois da recusa, a
// pessoa VE UM BOTAO. O toast antigo sumia sozinho e nao levava a lugar nenhum.
import { SaidaDaRecusa } from "@/components/ui/custom/SaidaDaRecusa";
import type { AcaoDeRecusa, RecusaDoPedido } from "@/lib/recusaDoPedido";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (recusa: RecusaDoPedido, onAgir: (a: AcaoDeRecusa) => void = () => {}) => {
  act(() => {
    root.render(<SaidaDaRecusa recusa={recusa} onAgir={onAgir} onFechar={() => {}} />);
  });
};

describe("SaidaDaRecusa", () => {
  it("mostra a frase que o banco escreveu, sem reescrever", () => {
    render({
      acao: "reconferir_carrinho",
      mensagem: "Os valores do pedido mudaram. Atualize o carrinho e tente novamente.",
    });
    expect(container.textContent).toContain("Os valores do pedido mudaram");
  });

  it("TODA acao de recusa tem um botao -- nenhuma fica sem saida", () => {
    const acoes: AcaoDeRecusa[] = [
      "reconferir_carrinho",
      "recotar_frete",
      "ajustar_estoque",
      "remover_item",
      "escolher_variacao",
      "trocar_endereco",
      "trocar_entrega",
      "remover_cupom",
      "tentar_de_novo",
      "conferir_antes",
    ];
    for (const acao of acoes) {
      render({ acao, mensagem: "qualquer" });
      const botoes = container.querySelectorAll("button[data-acao]");
      expect(
        botoes.length,
        `a acao ${acao} ficou SEM botao -- isso e' o beco de volta`,
      ).toBeGreaterThan(0);
    }
  });

  it("clicar no botao devolve a acao ao chamador", () => {
    const recebidas: AcaoDeRecusa[] = [];
    render({ acao: "recotar_frete", mensagem: "A cotação de frete expirou." }, (a) =>
      recebidas.push(a),
    );
    const botao = container.querySelector("button[data-acao]") as HTMLButtonElement;
    act(() => botao.click());
    expect(recebidas).toEqual(["recotar_frete"]);
  });

  it("estoque insuficiente diz quanto ainda ha", () => {
    render({
      acao: "ajustar_estoque",
      mensagem: "Estoque insuficiente para o produto Caneca (Disponível: 2, Solicitado: 5)",
      produto: "Caneca",
      disponivel: 2,
    });
    expect(container.textContent).toContain("Caneca");
    expect(container.textContent).toContain("2");
  });

  it("conferir_antes NAO oferece 'tentar de novo' -- e' assim que se duplica pedido", () => {
    render({ acao: "conferir_antes", mensagem: "Não conseguimos confirmar." });
    const rotulos = Array.from(container.querySelectorAll("button")).map((b) =>
      (b.textContent ?? "").toLowerCase(),
    );
    expect(rotulos.some((r) => r.includes("tentar de novo"))).toBe(false);
  });
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `npx vitest run tests/front/saida-da-recusa-oferece-a-acao.test.tsx`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Escreva o componente**

Siga o padrão visual dos vizinhos em `src/components/ui/custom/`. Os quatro requisitos abaixo
**não são estéticos** e estão prendidos por teste:

1. A `mensagem` aparece **literal** — o banco já escreveu em português, e essa frase é a
   única coisa que explica o que houve.
2. **Toda** `AcaoDeRecusa` renderiza pelo menos um `<button data-acao="<acao>">`.
3. `conferir_antes` oferece **"Ver meus pedidos"**, nunca "tentar de novo": o pedido pode ter
   nascido, e repetir duplica estoque e queima cupom de uso único.
4. `ajustar_estoque` com `disponivel` mostra o número e o nome do produto.

Rótulos, um por ação:

| ação | rótulo do botão |
|---|---|
| `reconferir_carrinho` | Atualizar o carrinho |
| `recotar_frete` | Calcular o frete de novo |
| `ajustar_estoque` | Deixar a quantidade disponível |
| `remover_item` | Tirar do carrinho |
| `escolher_variacao` | Escolher a opção |
| `trocar_endereco` | Escolher outro endereço |
| `trocar_entrega` | Ver outras formas de entrega |
| `remover_cupom` | Tirar o cupom |
| `tentar_de_novo` | Tentar de novo |
| `conferir_antes` | Ver meus pedidos |

- [ ] **Step 4: Rode e veja passar**

Run: `npx vitest run tests/front/saida-da-recusa-oferece-a-acao.test.tsx`
Expected: PASS, 5 testes.

- [ ] **Step 5: Prove que o teste de cobertura pega buraco de verdade**

Remova o caso `recotar_frete` do componente (deixe cair num `default` sem botão) e rode.
Expected: o teste "TODA acao de recusa tem um botao" **falha nomeando `recotar_frete`**.
Devolva o caso editando o arquivo.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(ui): a recusa do pedido passa a ter botao, nao so' aviso" -- src/components/ui/custom/SaidaDaRecusa.tsx tests/front/saida-da-recusa-oferece-a-acao.test.tsx
```

---

### Task 5: Ligar no checkout

**Files:**
- Modify: `src/views/customer/CheckoutView.tsx` (a região do `catch`, hoje em `:1017-1027`)
- Test: `tests/front/checkout-oferece-saida-na-recusa.test.tsx`

**Interfaces:**
- Consumes: `classificarRecusaDoPedido` (Task 1), `SaidaDaRecusa` (Task 4),
  `reconferirCarrinho` (Task 3).
- Produces: `export const decidirSaidaDoCheckout = (error: unknown): RecusaDoPedido`

**🔴 Antes de começar:** rode `node "C:\Users\Gabriel\.claude\mural\mural.mjs" core_app_mkt` e
confirme que `src/views/customer/CheckoutView.tsx` não ganhou dono novo. Se ganhou, **pare** e
devolva para a sessão principal.

- [ ] **Step 1: Escreva o teste que falha**

O teste exercita a função pura exportada, não a view inteira — a view arrasta `useAuth`,
`useOrders`, `useCoupons`, confetti e Supabase, e nada disso é o que esta tarefa muda.

```ts
import { decidirSaidaDoCheckout } from "@/views/customer/CheckoutView";
import { describe, expect, it } from "vitest";

const AS_ONZE = [
  "Endereço inválido ou não pertence ao usuário.",
  "Quantidade inválida para um dos itens.",
  "Escolha uma variação para o produto Tênis.",
  "Produto Caneca não disponível.",
  "Estoque insuficiente para o produto Caneca (Disponível: 2, Solicitado: 5)",
  "Entrega local não disponível para o CEP informado.",
  "A cotação de frete expirou. Calcule o frete novamente e refaça o pedido.",
  "Cupom X inválido ou expirado.",
  "Os valores do pedido mudaram. Atualize o carrinho e tente novamente.",
  "Estoque insuficiente para o produto Caneca",
];

describe("nenhuma recusa real do banco cai no caso generico", () => {
  for (const mensagem of AS_ONZE) {
    it(`tem acao propria: ${mensagem.slice(0, 40)}`, () => {
      const r = decidirSaidaDoCheckout({ code: "P0001", message: mensagem });
      expect(r.acao).not.toBe("conferir_antes");
    });
  }
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `npx vitest run tests/front/checkout-oferece-saida-na-recusa.test.tsx`
Expected: FAIL — `decidirSaidaDoCheckout` não é exportada.

- [ ] **Step 3: Ligue no checkout**

Exporte a função pura e, no `catch` de `:1017-1027`, guarde a recusa em estado e renderize
`<SaidaDaRecusa>`.

**Mantenha o `toast.error` também.** Ele é o que avisa quem não está olhando a parte da tela
onde o painel aparece; o painel é a **ação**, o toast é o **aviso**. Tirar o toast trocaria um
defeito por outro.

Ligue `onAgir` ao que já existe no arquivo (`removeFromCart`, `updateQuantity`, o passo de
endereço, o de frete, o cupom) e `reconferir_carrinho` a `reconferirCarrinho`.

- [ ] **Step 4: Rode e veja passar**

Run: `npx vitest run tests/front/checkout-oferece-saida-na-recusa.test.tsx`
Expected: PASS, 10 testes.

- [ ] **Step 5: Veja na tela rodando**

`preview_start` com `{name: "core_app_mkt"}`, vá ao checkout e force a recusa mudando o preço
de um produto pelo painel com o carrinho já montado. Confirme que o painel aparece com o
botão e que clicar nele resolve. Tire print.

- [ ] **Step 6: Rode a verificação inteira e cole a saída**

```bash
npm run typecheck
```
```bash
npm test
```
```bash
npm run build
```
```bash
npm run lint:links
```
```bash
npm run lint:ratchet
```
```bash
npm run size
```

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(checkout): a recusa do ultimo clique passa a ter saida" -- src/views/customer/CheckoutView.tsx tests/front/checkout-oferece-saida-na-recusa.test.tsx
```

---

### Task 6: A fiação nos dois arquivos compartilhados

**Files:**
- Modify: `src/contexts/CartContext.tsx` (acrescentar a ação `reconferir` a `CartActions`)
- Modify: `src/hooks/useOrders.ts` — **importar de `@/lib/recusaDoPedido`** o conjunto
  `CODIGOS_POSTGREST_REVERTIDO_COMPROVADO` e `FORMATO_SQLSTATE`, apagando as cópias locais.

🔴 **Correção de 28/08/2026, achada pela revisão:** a versão anterior desta linha dizia
"reexportar `classificarRecusaDoPedido`" — e **reexportar não deduplica nada**. As duas cópias
continuariam existindo, e o docstring da Task 1 promete que esta tarefa fecha a duplicação.
Promessa que a tarefa não cumpre é a mesma família de defeito que bloqueou a rodada 1.

Enquanto esta tarefa não acontece — e ela é **pulável** por dependência de outras frentes —
quem segura a invariante é o teste diferencial da **Task 1b**, não este item.

**Interfaces:**
- Consumes: `reconferirCarrinho` e `MudancaNoCarrinho` (Task 3).
- Produces: `CartActions.reconferir: () => Promise<MudancaNoCarrinho[]>` — o `CartProvider`
  devolve **só a lista**, lendo `.mudancas` do resultado.

🔴 **Atualizado na rodada 6 (28/08/2026).** `reconferirCarrinho` passou a devolver
`{ mudancas, oBancoRecusaria }`. O `CartProvider` quer **tudo o que mudou, sem faixa de
aceitação** — então ele fica com `.mudancas` e **ignora** `oBancoRecusaria` de propósito.
Quem usa o veredito é o painel (Task 5), não o carrinho. Misturar os dois papéis aqui é
exatamente o erro que custou seis rodadas na Task 3.

**🔴 Esta tarefa NÃO começa antes de:**
1. a frente `caca-defeitos-cacador-a` (GLM) responder na mesa sobre `CartContext.tsx`, **e**
2. a frente `timer-orfao-do-sync-offline` encerrar `useOrders.ts`.

**Se qualquer uma continuar ativa, pare e devolva para a sessão principal** — as Tasks 1 a 5
já entregam valor sem esta.

🔴 **O ADAPTADOR NASCE CONFERINDO — decisão do Gabriel, 28/08/2026.**

Esta tarefa escreve o adaptador que implementa `LeitorDeCatalogo` (`lerProdutos` e
`lerVariacoes`). **Ele é o último lugar onde o dado ainda pode ser RECUSADO.** Depois dele,
`reconferirCarrinho` só consegue avisar — e foi por isso que aquela peça levou nove rodadas
fechando, uma por vez, promessa de tipo que o banco não cumpre.

O que o `LeitorDeCatalogo` promete por tipo, e o banco **não** garante (medido em 28/08/2026):

- `price_override` é `numeric` **sem `NOT NULL`** (baseline, linha 4049) — `null` é o caso
  majoritário, não uma borda. `precoEfetivo` tem de chegar em `reconferirCarrinho` **já com o
  `COALESCE(price_override, preco_venda)` aplicado**, nunca a coluna crua.
- `cart_items` tem chave estrangeira **só para o usuário** (baseline, linhas 5061-5065):
  nenhuma para produto, nenhuma para variação. A tabela de **itens do pedido** tem. Ou seja, o
  carrinho aceita variação órfã e o banco só reclama no último clique.
- `sync_cart` grava `COALESCE(item->>'variant_id','')::text` **cru do cliente**.

🔴 **A armadilha exata que este bloco existe para impedir.** O texto da Task 3b manda copiar a
forma da consulta de `src/contexts/CartContext.tsx:225-246`. **Não copie a parte do erro.** Ali
a leitura de produtos lança (`if (prodError) throw prodError;`, linha 231) mas a de variações
**engole** (linhas 242-244: `console.error(...)` e segue com `variants = varData || []`).

Copiar isso faz a loja, na primeira falha de rede ou de permissão, tratar todo produto com
variação como **sem variação** — e dizer para a cliente **"este produto sumiu"** sobre produto
que está lá, à venda. O contrato de `lerProdutos` já diz, com estas palavras: *leitura que
falha tem de lançar; `[]` significa "nenhum destes produtos está à venda"*. **Vale igual para
`lerVariacoes`.**

- [ ] **Step 0: Os testes do adaptador vêm ANTES do adaptador**

Isto não é formalidade: é o único conserto para o risco desta decisão, que é a exigência virar
promessa e evaporar. Cada caso abaixo é um teste que falha primeiro:

1. Erro do Supabase na leitura de produtos → **lança**. Nunca `data ?? []`.
2. Erro do Supabase na leitura de variações → **lança**. É o caso que o `CartContext` engole.
3. `price_override` nulo → `precoEfetivo` sai com o `preco_venda` do produto, nunca `null`.
4. Linha de produto sem `preco` ou sem `estoque` numérico → **lança**, ou não entra na lista;
   nunca vira `0` nem `undefined` silencioso.
5. `lerVariacoes` recebe **ids de variação**, não de produto (a consulta do `CartContext` filtra
   por `product_id`; a interface pede `id`). Teste que o filtro é o certo.
6. `lerProdutos` devolve **uma linha por id** — variação nunca duplica produto.

`zod` já está instalado no projeto: validar aqui não custa dependência nova.

🔴 **NÃO acrescente conferência dentro de `src/lib/reconferirCarrinho.ts`.** Aquele arquivo está
fechado por decisão — nove rodadas, 33 testes com dentes comprovados, e o histórico deste projeto
é de 9 correções produzindo 8 defeitos novos. As guardas que já existem lá (`emCentavos`,
`Number.isFinite` no estoque, `variante.productId !== id`, `variacoesNaoConferidas`) ficam **de
propósito**, mesmo parecendo redundantes depois que o adaptador conferir: elas são o piso
compartilhado, e têm teste que morre quando some.

**O que invalidaria esta decisão:** aparecer um **segundo** consumidor de `reconferirCarrinho`
com outro adaptador. Aí conferir por adaptador vira duplicação e a validação sobe para a função
compartilhada. Hoje o consumidor é um só, e é este.

**Uma regra de produto continua em aberto, e é decisão do Gabriel:** quando a conferência **não
conseguir** ler o catálogo, a loja **trava** o último clique ou **deixa passar** e a pessoa leva
a recusa do banco? Travar irrita quem podia ter comprado; deixar passar devolve a pessoa ao beco
que este plano inteiro existe para acabar. **Pare e pergunte** antes de implementar o caminho de
erro.

- [ ] **Step 1: Confirme que os dois arquivos estão livres**

```bash
node "C:\Users\Gabriel\.claude\mural\mural.mjs" core_app_mkt
```
Expected: nenhuma frente ATIVA além da sua reivindicando esses dois arquivos.

- [ ] **Step 2: Escreva o teste que falha**

```ts
// O visitante passa a ser reconferido igual a quem tem conta -- hoje
// CartContext.tsx:190 sai antes, e e' por isso que a recusa acerta
// principalmente quem ainda nao e' cliente.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("o ramo do visitante nao sai mais sem reconferir", () => {
  const fonte = readFileSync("src/contexts/CartContext.tsx", "utf8");
  const trecho = fonte.slice(fonte.indexOf("No user detected"));
  expect(trecho.slice(0, 400)).toContain("reconferir");
});
```

- [ ] **Step 3: Ligue**

Acrescente `reconferir: () => Promise<MudancaNoCarrinho[]>` a `CartActions` e implemente no
`CartProvider` usando `reconferirCarrinho`, chamando também no ramo do visitante.

- [ ] **Step 4: Rode a verificação inteira e cole a saída** (os sete comandos da Task 5)

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(cart): o carrinho de quem nao tem conta passa a ser reconferido" -- src/contexts/CartContext.tsx src/hooks/useOrders.ts
```

---

### Task 7: Conferência do conjunto

**Files:** nenhum. Somente leitura.

Chame o agente `diretor` com: o pedido original nas palavras do Gabriel ("segue com os 11"),
a lista das Tasks 1 a 6, e onde está o resultado (o diff da branch).

Ele responde o que nenhum revisor de peça responde: **o conjunto ainda é o que foi pedido?**
Perguntas que se respondem com fato:

- As 11 recusas medidas na função viva têm, cada uma, uma ação na tela?
- Alguma migration, RPC ou regra do banco foi tocada? (tem de ser **não**)
- A trava anti-adulteração de preço continua idêntica?
- A verificação citada nos relatórios tem lastro — a saída existe mesmo?
- A Task 6 foi pulada por frente ativa? Se foi, isso está dito em vez de escondido?

Veredito: `SEGUE`, `CORRIGE` ou `PARA`.

---

## Self-Review

**Cobertura do desenho:** as 11 mensagens aparecem na Task 1 (classificação), Task 2
(âncora), Task 4 (botão para cada ação) e Task 5 (nenhuma cai no genérico). A reconferência —
a ação que não existia — está na Task 3, e o ramo do visitante na Task 6.

**Placeholders:** nenhum passo diz "adicione tratamento de erro" ou "escreva testes para o
acima". A Task 4 descreve o componente por requisitos prendidos em teste mais uma tabela de
rótulos, em vez de JSX inteiro, porque o visual segue os vizinhos; os quatro requisitos que
**não** são estéticos estão listados e testados.

**Consistência de tipos:** `RecusaDoPedido`/`AcaoDeRecusa` (Task 1) são consumidos com o mesmo
nome nas Tasks 4 e 5. `MudancaNoCarrinho`/`reconferirCarrinho` (Task 3) idem nas Tasks 5 e 6.
`LeitorDeCatalogo` só existe na Task 3, que é onde é injetado.

**O risco assumido, e onde ele está contido:** casar recusa por texto é frágil — contido pela
Task 2, que reprova nomeando a frase que mudou. A alternativa robusta (`ERRCODE` próprio por
recusa) foi descartada no desenho porque mexeria na RPC, no caminho do dinheiro.
