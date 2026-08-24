# Tela de Notificações do lojista — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao lojista uma tela que mostra o que precisa da atenção dele agora — pedido esperando, pergunta sem resposta, avaliação sem resposta e produto acabando — e fazer o sino do painel abrir essa tela.

**Architecture:** Três peças. Uma função pura que transforma dados crus em avisos (`src/utils/avisos-do-lojista.ts`), um hook que busca as quatro fontes e chama a função (`src/hooks/useAvisosDoLojista.ts`), e uma tela que só desenha (`src/views/admin/AdminNotificationsView.tsx`). Nenhuma tabela nova, nenhuma migration: os avisos são derivados de dados que já existem, e somem sozinhos quando o lojista resolve.

**Tech Stack:** React 19, TypeScript, Vite, Supabase JS, Tailwind, Vitest (jsdom, `createRoot` + `act`, sem testing-library).

**Spec:** [`docs/superpowers/specs/2026-08-24-notificacoes-do-lojista-design.md`](../specs/2026-08-24-notificacoes-do-lojista-design.md)

## Global Constraints

- **Árvore compartilhada.** Nunca `git stash`, `checkout`, `restore`, `clean`, `reset`. Para comparar com o original, `git show HEAD:<caminho>` gravando no scratchpad. Nunca `git add` — arquivo novo entra por `git hash-object -w` + `git update-index --add --cacheinfo`, e o commit é `git commit -- <caminho>`.
- **Nenhuma migration, nenhuma escrita no banco.** Este plano inteiro é somente leitura do lado do banco. Se alguma tarefa parecer precisar de SQL, o plano está errado — pare e devolva.
- **Verificação:** o diff toca `src/` e `tests/`, então valem os seis do CI (pule `npm ci`): `npm run typecheck`, `npm test`, `npm run build`, `npm run lint:links`, `npm run lint:ratchet`, `npm run size`.
- **Biome não é opcional.** `lint:ratchet` acusa centenas de problemas de CRLF no Windows; essa explicação é verdadeira e já escondeu 16 erros reais neste repositório. Para todo arquivo NOVO, medir a parte que o CRLF não cobre: copiar o arquivo com `\r\n` trocado por `\n` para uma pasta do `%TEMP%`, copiar o `biome.json` para lá sem o bloco `vcs`, rodar `npx biome check --config-path <temp> <temp>`, e na mesma rodada incluir um arquivo sujo de propósito que **tem** de ser acusado. Erro achado se corrige com `npx biome check --write <arquivo>`. Isto bloqueou o merge duas vezes hoje.
- **Português nos nomes novos** (`avisos-do-lojista`, `montarAvisos`, `precisaDeReposicao`), seguindo `pai-da-tela-do-admin.ts` e `destinoPosLogin.ts`. Comentário explica o **porquê**, não o quê.
- **TDD sem exceção:** o teste vem antes, é visto falhar **pelo motivo certo**, e só então vem a implementação.

## File Structure

| arquivo | responsabilidade |
|---|---|
| `src/utils/avisos-do-lojista.ts` (novo) | A regra: dados crus → lista de avisos. Sem React, sem Supabase, sem `Date.now()`. |
| `src/hooks/useAvisosDoLojista.ts` (novo) | As quatro consultas + tolerância a falha parcial. |
| `src/views/admin/AdminNotificationsView.tsx` (novo) | Desenho. Nenhuma regra de negócio. |
| `src/lib/mappers.ts` (modificar) | Passar `estoque_minimo` adiante. |
| `src/types/index.ts` (modificar) | View nova + campo novo em `Product`. |
| `src/App.tsx` (modificar) | Registro da view. **Só isso.** |
| `src/components/layouts/AdminArea.tsx` (modificar) | Montar a tela; título; renomear o título de `admin-push`. |
| `src/components/layouts/AdminLayout.tsx` (modificar) | Sino aponta para a tela nova; crachá passa a somar avaliações. |
| `src/views/admin/AdminSettingsView.tsx` (modificar) | Renomear o cartão para "Avisar clientes". |

---

### Task 1: A regra pura — `avisos-do-lojista.ts`

**Files:**
- Create: `src/utils/avisos-do-lojista.ts`
- Test: `tests/front/avisos-do-lojista.test.ts`

**Interfaces:**
- Consumes: `View` de `@/types`.
- Produces: `TipoDeAviso`, `Aviso`, `EntradaDeAvisos`, `montarAvisos(entrada): Aviso[]`, `precisaDeReposicao(estoque, estoqueMinimo): boolean`, `LIMIAR_PADRAO_DE_ESTOQUE = 5`.

**Contexto que você precisa e não tem:**

`estoque_minimo` é uma coluna por produto, e o padrão do projeto quando ela é nula é **5** — está em `supabase/migrations/20260902000000_kpi_usa_o_mesmo_estoque_que_a_tela.sql`, na expressão `estoque <= COALESCE(estoque_minimo, 5)`. Não invente outro número: o painel já mostra um KPI "Estoque Baixo" com esse limiar, e dois números diferentes sobre a mesma coisa é pior que nenhum.

- [ ] **Step 1: Escreva o teste que falha**

Crie `tests/front/avisos-do-lojista.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  LIMIAR_PADRAO_DE_ESTOQUE,
  type EntradaDeAvisos,
  montarAvisos,
  precisaDeReposicao,
} from "@/utils/avisos-do-lojista";

const VAZIO: EntradaDeAvisos = {
  pedidos: [],
  perguntasPendentes: 0,
  avaliacoes: [],
  produtos: [],
};

describe("precisaDeReposicao — a guarda e' de LIMIAR, nao binaria", () => {
  it("usa o estoque_minimo do proprio produto quando ele existe", () => {
    expect(precisaDeReposicao(2, 2)).toBe(true);
    expect(precisaDeReposicao(1, 2)).toBe(true);
    expect(precisaDeReposicao(3, 2)).toBe(false);
  });

  it("cai no padrao do projeto (5) quando estoque_minimo e' nulo", () => {
    expect(LIMIAR_PADRAO_DE_ESTOQUE).toBe(5);
    expect(precisaDeReposicao(5, null)).toBe(true);
    expect(precisaDeReposicao(6, null)).toBe(false);
  });

  it("estoque zerado tambem precisa de reposicao", () => {
    expect(precisaDeReposicao(0, null)).toBe(true);
  });

  it("um estoque_minimo de zero nao vira o padrao 5", () => {
    // `?? 5` e' obrigatorio aqui; `|| 5` transformaria 0 em 5 e acusaria
    // reposicao em produto que o lojista marcou como "nunca avisar".
    expect(precisaDeReposicao(3, 0)).toBe(false);
    expect(precisaDeReposicao(0, 0)).toBe(true);
  });
});

describe("montarAvisos", () => {
  it("sem nada pendente devolve lista vazia", () => {
    expect(montarAvisos(VAZIO)).toEqual([]);
  });

  it("um pedido pendente vira aviso que abre AQUELE pedido", () => {
    const avisos = montarAvisos({
      ...VAZIO,
      pedidos: [
        {
          id: "ped-1",
          customer_name: "Maria Silva",
          total: 22.9,
          created_at: "2026-08-24T10:00:00.000Z",
        },
      ],
    });

    expect(avisos).toHaveLength(1);
    expect(avisos[0].tipo).toBe("pedido");
    expect(avisos[0].destino).toEqual({ view: "admin-orders", id: "ped-1" });
    expect(avisos[0].contaNoCracha).toBe(true);
    expect(avisos[0].titulo).toContain("Maria Silva");
  });

  it("perguntas pendentes viram UM aviso com a contagem", () => {
    const avisos = montarAvisos({ ...VAZIO, perguntasPendentes: 3 });

    expect(avisos).toHaveLength(1);
    expect(avisos[0].tipo).toBe("pergunta");
    expect(avisos[0].destino).toEqual({ view: "admin-qa" });
    expect(avisos[0].titulo).toContain("3");
  });

  it("zero perguntas pendentes NAO vira aviso", () => {
    expect(montarAvisos({ ...VAZIO, perguntasPendentes: 0 })).toEqual([]);
  });

  it("avaliacao sem resposta vira aviso; com resposta nao entra na lista", () => {
    const avisos = montarAvisos({
      ...VAZIO,
      avaliacoes: [
        {
          id: "av-1",
          product_id: "prod-1",
          nomeDoProduto: "Bobbie Goods",
          rating: 5,
          created_at: "2026-08-24T09:00:00.000Z",
        },
      ],
    });

    expect(avisos).toHaveLength(1);
    expect(avisos[0].tipo).toBe("avaliacao");
    expect(avisos[0].destino).toEqual({ view: "admin-reviews" });
  });

  it("produto acabando vira aviso que abre AQUELE produto, e NAO conta no cracha", () => {
    const avisos = montarAvisos({
      ...VAZIO,
      produtos: [
        {
          id: "prod-9",
          name: "Caneta 3D",
          stock: 2,
          estoqueMinimo: null,
          created_at: "2026-08-20T09:00:00.000Z",
        },
      ],
    });

    expect(avisos).toHaveLength(1);
    expect(avisos[0].tipo).toBe("estoque");
    expect(avisos[0].destino).toEqual({
      view: "admin-product-form",
      id: "prod-9",
    });
    expect(avisos[0].contaNoCracha).toBe(false);
  });

  it("produto com estoque suficiente nao vira aviso", () => {
    const avisos = montarAvisos({
      ...VAZIO,
      produtos: [
        {
          id: "prod-9",
          name: "Caneta 3D",
          stock: 40,
          estoqueMinimo: null,
          created_at: "2026-08-20T09:00:00.000Z",
        },
      ],
    });

    expect(avisos).toEqual([]);
  });

  it("ordena por urgencia: pedido, pergunta, avaliacao, estoque", () => {
    const avisos = montarAvisos({
      produtos: [
        {
          id: "p",
          name: "X",
          stock: 1,
          estoqueMinimo: null,
          created_at: "2026-08-24T12:00:00.000Z",
        },
      ],
      avaliacoes: [
        {
          id: "a",
          product_id: "p",
          nomeDoProduto: "X",
          rating: 4,
          created_at: "2026-08-24T12:00:00.000Z",
        },
      ],
      perguntasPendentes: 1,
      pedidos: [
        {
          id: "o",
          customer_name: "N",
          total: 1,
          created_at: "2026-08-24T12:00:00.000Z",
        },
      ],
    });

    expect(avisos.map((a) => a.tipo)).toEqual([
      "pedido",
      "pergunta",
      "avaliacao",
      "estoque",
    ]);
  });

  it("dentro do mesmo tipo, o mais recente vem primeiro", () => {
    const avisos = montarAvisos({
      ...VAZIO,
      pedidos: [
        {
          id: "velho",
          customer_name: "A",
          total: 1,
          created_at: "2026-08-20T10:00:00.000Z",
        },
        {
          id: "novo",
          customer_name: "B",
          total: 1,
          created_at: "2026-08-24T10:00:00.000Z",
        },
      ],
    });

    expect(avisos.map((a) => a.destino.id)).toEqual(["novo", "velho"]);
  });

  it("o id do aviso e' unico por tipo+origem — dois tipos com o mesmo id de origem nao colidem", () => {
    const avisos = montarAvisos({
      ...VAZIO,
      pedidos: [
        {
          id: "mesmo",
          customer_name: "A",
          total: 1,
          created_at: "2026-08-24T10:00:00.000Z",
        },
      ],
      produtos: [
        {
          id: "mesmo",
          name: "X",
          stock: 0,
          estoqueMinimo: null,
          created_at: "2026-08-24T10:00:00.000Z",
        },
      ],
    });

    const ids = avisos.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 2: Rode e confirme que falha pelo motivo certo**

Run: `npx vitest run tests/front/avisos-do-lojista.test.ts`
Expected: FAIL com `Failed to resolve import "@/utils/avisos-do-lojista"`. Se falhar por outro motivo, pare e leia — o teste está errado, não a ausência do módulo.

- [ ] **Step 3: Implemente o mínimo**

Crie `src/utils/avisos-do-lojista.ts`:

```ts
import type { View } from "@/types";

/**
 * O limiar de estoque baixo do projeto quando o produto nao tem um proprio.
 *
 * NAO e' um numero escolhido aqui: vem de `COALESCE(estoque_minimo, 5)` em
 * `supabase/migrations/20260902000000_kpi_usa_o_mesmo_estoque_que_a_tela.sql`,
 * que e' o mesmo limiar do KPI "Estoque Baixo" do painel. Dois numeros
 * diferentes para a mesma pergunta e' pior que nenhum.
 */
export const LIMIAR_PADRAO_DE_ESTOQUE = 5;

export type TipoDeAviso = "pedido" | "pergunta" | "avaliacao" | "estoque";

export interface Aviso {
  id: string;
  tipo: TipoDeAviso;
  titulo: string;
  detalhe: string;
  quando: string;
  destino: { view: View; id?: string };
  contaNoCracha: boolean;
}

export interface PedidoPendente {
  id: string;
  customer_name: string | null;
  total: number | null;
  created_at: string;
}

export interface AvaliacaoSemResposta {
  id: string;
  product_id: string;
  nomeDoProduto: string | null;
  rating: number;
  created_at: string;
}

export interface ProdutoComEstoque {
  id: string;
  name: string;
  stock: number;
  estoqueMinimo: number | null;
  created_at: string;
}

export interface EntradaDeAvisos {
  pedidos: PedidoPendente[];
  perguntasPendentes: number;
  avaliacoes: AvaliacaoSemResposta[];
  produtos: ProdutoComEstoque[];
}

/**
 * `?? LIMIAR_PADRAO_DE_ESTOQUE`, nunca `||`: um produto com `estoque_minimo`
 * ZERO e' um produto que o lojista marcou como "nao me avise", e `|| 5`
 * transformaria essa escolha em 5.
 */
export function precisaDeReposicao(
  estoque: number,
  estoqueMinimo: number | null,
): boolean {
  return estoque <= (estoqueMinimo ?? LIMIAR_PADRAO_DE_ESTOQUE);
}

const ORDEM_DE_URGENCIA: TipoDeAviso[] = [
  "pedido",
  "pergunta",
  "avaliacao",
  "estoque",
];

function maisRecentePrimeiro(a: Aviso, b: Aviso): number {
  return b.quando.localeCompare(a.quando);
}

function formatarReais(valor: number | null): string {
  return `R$ ${(valor ?? 0).toFixed(2).replace(".", ",")}`;
}

export function montarAvisos(entrada: EntradaDeAvisos): Aviso[] {
  const avisos: Aviso[] = [];

  for (const pedido of entrada.pedidos) {
    avisos.push({
      id: `pedido:${pedido.id}`,
      tipo: "pedido",
      titulo: `Pedido de ${pedido.customer_name || "cliente"} esperando você`,
      detalhe: formatarReais(pedido.total),
      quando: pedido.created_at,
      destino: { view: "admin-orders", id: pedido.id },
      contaNoCracha: true,
    });
  }

  if (entrada.perguntasPendentes > 0) {
    const uma = entrada.perguntasPendentes === 1;
    avisos.push({
      id: "pergunta:pendentes",
      tipo: "pergunta",
      titulo: uma
        ? "1 pergunta esperando resposta"
        : `${entrada.perguntasPendentes} perguntas esperando resposta`,
      detalhe: "Clientes perguntaram sobre seus produtos",
      quando: "",
      destino: { view: "admin-qa" },
      contaNoCracha: true,
    });
  }

  for (const avaliacao of entrada.avaliacoes) {
    avisos.push({
      id: `avaliacao:${avaliacao.id}`,
      tipo: "avaliacao",
      titulo: `Avaliação de ${avaliacao.rating} estrela${avaliacao.rating === 1 ? "" : "s"} sem resposta`,
      detalhe: avaliacao.nomeDoProduto || "Produto",
      quando: avaliacao.created_at,
      destino: { view: "admin-reviews" },
      contaNoCracha: true,
    });
  }

  for (const produto of entrada.produtos) {
    if (!precisaDeReposicao(produto.stock, produto.estoqueMinimo)) continue;
    avisos.push({
      id: `estoque:${produto.id}`,
      tipo: "estoque",
      titulo:
        produto.stock === 0
          ? `${produto.name} acabou`
          : `${produto.name} está acabando`,
      detalhe:
        produto.stock === 0
          ? "Sem nenhuma unidade"
          : `${produto.stock} ${produto.stock === 1 ? "unidade" : "unidades"} restantes`,
      quando: produto.created_at,
      // NAO conta no cracha, e isso e' deliberado: estoque baixo so' termina
      // se o lojista repuser. Se ele decidir nao repor, o aviso fica para
      // sempre e a bolinha nunca zera — e bolinha que nunca zera e' bolinha
      // que se para de olhar, o que apaga tambem os tres que importam.
      contaNoCracha: false,
    });
  }

  return avisos.sort((a, b) => {
    const posicao =
      ORDEM_DE_URGENCIA.indexOf(a.tipo) - ORDEM_DE_URGENCIA.indexOf(b.tipo);
    return posicao !== 0 ? posicao : maisRecentePrimeiro(a, b);
  });
}
```

- [ ] **Step 4: Rode e confirme verde**

Run: `npx vitest run tests/front/avisos-do-lojista.test.ts`
Expected: PASS, todos os casos.

- [ ] **Step 5: Prove que o teste tem dente — três sabotagens**

Aplique uma de cada vez, rode a suíte, confirme que falha, e **desfaça**:

| sabotagem | tem de quebrar |
|---|---|
| `estoque <= (...)` vira `estoque < (...)` | "usa o estoque_minimo do proprio produto" |
| `?? LIMIAR_PADRAO_DE_ESTOQUE` vira `\|\| LIMIAR_PADRAO_DE_ESTOQUE` | "um estoque_minimo de zero nao vira o padrao 5" |
| `contaNoCracha: false` do estoque vira `true` | "produto acabando ... NAO conta no cracha" |

Se algum mutante sobreviver, o teste está fraco: conserte o **teste**, não a promessa.

- [ ] **Step 6: Biome nos arquivos novos, e verificação**

Rode a receita de Biome descrita em Global Constraints sobre os dois arquivos novos, com o controle sujo na mesma rodada. Corrija o que aparecer. Depois rode os seis comandos e cole a saída.

- [ ] **Step 7: Commit**

```bash
git commit -- src/utils/avisos-do-lojista.ts tests/front/avisos-do-lojista.test.ts
```

Mensagem: `feat(admin): a regra dos avisos do lojista, sem React e sem banco`. O arquivo novo entra por `git hash-object -w` + `git update-index --add --cacheinfo` antes do commit.

---

### Task 2: `estoqueMinimo` chega ao app

**Files:**
- Modify: `src/types/index.ts` (interface `Product`)
- Modify: `src/lib/mappers.ts` (`mapProductFromDB`, por volta da linha 108)
- Test: `tests/front/mapper-traz-o-estoque-minimo.test.ts`

**Interfaces:**
- Produces: `Product.estoqueMinimo?: number | null`, consumido pela Task 3.

**Contexto:** `useProducts` já faz `select("*")`, então `estoque_minimo` **já chega do banco** — ele só não é repassado. A mudança é aditiva: nenhum consumidor atual lê esse campo.

- [ ] **Step 1: Escreva o teste que falha**

Crie `tests/front/mapper-traz-o-estoque-minimo.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { mapProductFromDB } from "@/lib/mappers";

function linhaDoBanco(extra: Record<string, unknown> = {}) {
  return {
    id: "prod-1",
    name: "Caneta 3D",
    description: "",
    price: 10,
    estoque: 7,
    ativo: true,
    created_at: "2026-08-24T10:00:00.000Z",
    ...extra,
  } as any;
}

describe("mapProductFromDB repassa o estoque minimo", () => {
  it("traz o valor quando o produto tem um proprio", () => {
    expect(mapProductFromDB(linhaDoBanco({ estoque_minimo: 2 })).estoqueMinimo).toBe(2);
  });

  it("traz zero como ZERO, nao como ausente", () => {
    expect(mapProductFromDB(linhaDoBanco({ estoque_minimo: 0 })).estoqueMinimo).toBe(0);
  });

  it("traz null quando a coluna e' nula", () => {
    expect(mapProductFromDB(linhaDoBanco({ estoque_minimo: null })).estoqueMinimo).toBeNull();
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

Run: `npx vitest run tests/front/mapper-traz-o-estoque-minimo.test.ts`
Expected: FAIL — `estoqueMinimo` é `undefined`.

Se der erro de tipo ou de import, ajuste os campos obrigatórios de `linhaDoBanco` lendo a assinatura real de `mapProductFromDB`; não mude as asserções.

- [ ] **Step 3: Implemente**

Em `src/types/index.ts`, na interface `Product`, acrescente:

```ts
  /**
   * Limiar de "estoque baixo" deste produto. Nulo significa "use o padrao do
   * projeto" (5), a mesma regra do KPI Estoque Baixo do painel. ZERO e' uma
   * escolha valida do lojista, nao ausencia — por isso `number | null`, e por
   * isso quem le usa `??`, nunca `||`.
   */
  estoqueMinimo?: number | null;
```

Em `src/lib/mappers.ts`, dentro do objeto devolvido por `mapProductFromDB`, acrescente:

```ts
      estoqueMinimo:
        (row as any).estoque_minimo === undefined
          ? null
          : ((row as any).estoque_minimo as number | null),
```

- [ ] **Step 4: Rode e confirme verde**

Run: `npx vitest run tests/front/mapper-traz-o-estoque-minimo.test.ts`

- [ ] **Step 5: Prove o dente**

Troque o mapeamento por `estoqueMinimo: (row as any).estoque_minimo || null`. O caso "traz zero como ZERO" tem de falhar. Desfaça.

- [ ] **Step 6: Verificação e commit**

Biome no arquivo de teste novo (receita das Global Constraints), depois os seis comandos. Commit:

```bash
git commit -- src/types/index.ts src/lib/mappers.ts tests/front/mapper-traz-o-estoque-minimo.test.ts
```

Mensagem: `feat(catalog): o limiar de estoque do produto chega ao app`.

---

### Task 3: O hook `useAvisosDoLojista`

**Files:**
- Create: `src/hooks/useAvisosDoLojista.ts`
- Test: `tests/front/use-avisos-do-lojista.test.ts`

**Interfaces:**
- Consumes: `montarAvisos`, `Aviso` (Task 1); `Product.estoqueMinimo` (Task 2); `STATUS_PEDIDOS_COM_ACAO_PENDENTE` de `@/components/layouts/AdminLayout`.
- Produces: `useAvisosDoLojista(): { avisos: Aviso[]; quantidadeNoCracha: number; carregando: boolean; fontesComFalha: TipoDeAviso[]; recarregar: () => void }`.

**Contexto que você precisa e não tem:**

- Pedidos pendentes: `supabase.from("marketplace_orders").select("id, customer_name, total, created_at").in("status", STATUS_PEDIDOS_COM_ACAO_PENDENTE)`. A constante já existe e é exportada de `src/components/layouts/AdminLayout.tsx:55`.
- Perguntas: `supabase.rpc("get_admin_questions_paged", { p_search: "", p_filter: "pending", p_page: 0, p_page_size: 1 })` e leia `data.total_count`. É exatamente o que `AdminLayout.tsx:113-124` já faz para o crachá.
- Avaliações: `supabase.from("reviews").select("id, product_id, rating, created_at").is("merchant_reply", null)`.
- Produtos: use o hook `useProducts` já existente e filtre pelo `precisaDeReposicao` da Task 1 — **não** consulte `produtos` direto, porque a regra de estoque efetivo (soma das variantes ativas) mora em `mapProductFromDB` e ler a coluna crua é o defeito que a migration de 02/09 corrigiu.

**Falha parcial não derruba a tela.** Cada consulta é independente: use `Promise.allSettled`, e registre em `fontesComFalha` o tipo de cada uma que falhou. Uma tela de avisos em branco por causa de uma consulta é pior que uma tela incompleta e honesta.

- [ ] **Step 1: Escreva o teste que falha**

Crie `tests/front/use-avisos-do-lojista.test.ts`. Mocke `@/lib/supabase` e `@/hooks/useProducts` (veja o padrão de dublê de builder do Supabase em `tests/front/sino-do-painel-leva-onde-o-alerta-aponta.test.tsx`, que monta `builder.select`/`builder.in` encadeáveis). Casos obrigatórios:

1. Com as quatro fontes devolvendo dados, `avisos` tem os quatro tipos.
2. `quantidadeNoCracha` **conta** os avisos com `contaNoCracha`, e é diferente de `avisos.length` quando há aviso de estoque — asserte os dois números na mesma rodada, e asserte `quantidadeNoCracha === avisos.filter(a => a.contaNoCracha).length`.
3. Se a consulta de avaliações rejeitar, os outros três tipos continuam na lista e `fontesComFalha` contém `"avaliacao"` — e **só** ele.
4. Se todas falharem, `avisos` é `[]`, `fontesComFalha` tem os quatro, e `carregando` é `false` (não fica preso carregando para sempre).
5. `recarregar()` dispara as consultas de novo.

- [ ] **Step 2: Rode e confirme que falha**

Run: `npx vitest run tests/front/use-avisos-do-lojista.test.ts`
Expected: FAIL por módulo inexistente.

- [ ] **Step 3: Implemente o hook**

`useState` para `avisos`, `fontesComFalha`, `carregando`. `useCallback` para `buscar`, chamado num `useEffect` de montagem e exposto como `recarregar`. `Promise.allSettled` com as quatro promessas; cada `rejected` (ou `error` do Supabase) acrescenta o tipo em `fontesComFalha` e entra vazio em `montarAvisos`. `quantidadeNoCracha` é `avisos.filter((a) => a.contaNoCracha).length`.

Guarde um `ativo = true` no efeito e ponha `false` na limpeza, para não chamar `setState` depois de desmontar.

- [ ] **Step 4: Rode e confirme verde**

Run: `npx vitest run tests/front/use-avisos-do-lojista.test.ts`

- [ ] **Step 5: Prove o dente**

Sabote `quantidadeNoCracha` para `avisos.length`. O caso 2 tem de falhar. Desfaça.
Sabote o `allSettled` para `Promise.all`. O caso 3 tem de falhar (a tela inteira cairia por uma fonte). Desfaça.

- [ ] **Step 6: Verificação e commit**

Biome nos arquivos novos, seis comandos, e:

```bash
git commit -- src/hooks/useAvisosDoLojista.ts tests/front/use-avisos-do-lojista.test.ts
```

Mensagem: `feat(admin): o hook que junta os quatro avisos do lojista`.

---

### Task 4: A tela `AdminNotificationsView`

**Files:**
- Create: `src/views/admin/AdminNotificationsView.tsx`
- Test: `tests/front/admin-notifications-view.test.tsx`

**Interfaces:**
- Consumes: `useAvisosDoLojista` (Task 3), `Aviso` (Task 1).
- Produces: `AdminNotificationsView({ onNavigate }: { onNavigate: (view: View, id?: string) => void })`, consumido pela Task 5.

**Contexto visual:** siga os cartões do painel — `rounded-2xl`, `border border-white/5`, `bg-zinc-950/40`, rótulo de categoria em `text-[9px] font-black uppercase tracking-widest`. Veja `src/components/admin/dashboard/CustomerBanners.tsx` como referência de um cartão clicável já aprovado neste painel.

**Estrutura:** dois blocos. "Precisa de você" com os avisos de `contaNoCracha`, e "De olho" com os de estoque. Cada bloco some inteiro quando não tem item.

- [ ] **Step 1: Escreva o teste que falha**

Crie `tests/front/admin-notifications-view.test.tsx`, mockando `@/hooks/useAvisosDoLojista`. Use `createRoot` + `act` (padrão da casa; **não** use `@testing-library/react`, que não está instalado). Casos obrigatórios:

1. Com um aviso de cada tipo, a tela mostra quatro linhas clicáveis.
2. Clicar no aviso de pedido chama `onNavigate("admin-orders", "<o id daquele pedido>")` — asserte o id, não só a view.
3. Clicar no aviso de estoque chama `onNavigate("admin-product-form", "<id do produto>")`.
4. Sem nenhum aviso, aparece o texto de tela vazia e **nenhum** elemento clicável de aviso.
5. O aviso de estoque aparece na faixa "De olho" e os outros três não — asserte pela contagem de itens de cada bloco, não pela presença de um texto.
6. Com `fontesComFalha: ["avaliacao"]`, a tela mostra o recado de falha parcial **e** continua listando os outros avisos.

- [ ] **Step 2: Rode e confirme que falha**

Run: `npx vitest run tests/front/admin-notifications-view.test.tsx`

- [ ] **Step 3: Implemente a tela**

Componente `memo`, sem regra de negócio: lê o hook, separa `avisos` em dois arrays por `contaNoCracha`, e desenha. Cada aviso é um `<button>` com `onClick={() => onNavigate(aviso.destino.view, aviso.destino.id)}`.

- [ ] **Step 4: Rode e confirme verde**

- [ ] **Step 5: Prove o dente**

Sabote o clique para passar sempre `undefined` como id. O caso 2 tem de falhar. Desfaça.

- [ ] **Step 6: Verificação e commit**

Biome nos novos, seis comandos, e:

```bash
git commit -- src/views/admin/AdminNotificationsView.tsx tests/front/admin-notifications-view.test.tsx
```

Mensagem: `feat(admin): a tela de Notificacoes do lojista`.

---

### Task 5: A tela fica alcançável

**Files:**
- Modify: `src/types/index.ts` (o union `View`)
- Modify: `src/App.tsx` (**apenas** 4 pontos, listados abaixo)
- Modify: `src/components/layouts/AdminArea.tsx`
- Test: `tests/front/pai-da-tela-do-admin.test.ts` (acrescentar um caso)

**Interfaces:**
- Consumes: `AdminNotificationsView` (Task 4).
- Produces: a view `"admin-notifications"`, consumida pela Task 6.

**🔴 O ponto mais fácil de errar deste plano.** `admin-push` aparece **10 vezes** em `src/App.tsx`, e elas se dividem em dois grupos opostos. A view nova entra em quatro e **não pode** entrar em seis:

| linha | o que a lista significa | `admin-notifications` entra? |
|---|---|---|
| ~180 | mapa `view → componente` | **SIM** — `"admin-notifications": AdminArea` |
| ~381 | `adminViewIndices`, peso de navegação | **SIM** — use `0.3` |
| ~1494 | lista de views do admin | **SIM** |
| ~2242 | lista de views do admin | **SIM** |
| ~913 | views que aceitam `?id=` | **NÃO** — a tela não recebe id |
| ~1675 | views que aceitam `?id=` | **NÃO** |
| ~1816 | views que aceitam `?id=` | **NÃO** |
| ~1854 | views que aceitam `?id=` | **NÃO** |
| ~1508 | `subAdminViews` (subtelas) | **NÃO** — é tela de topo |
| ~1554 | tratamento de subtela | **NÃO** |

Confira cada uma pelo conteúdo, não pelo número da linha — outra sessão pode ter mexido no arquivo.

**Não toque** em `pushState`, popstate, trava de transição, nem em `handleNavigate`.

- [ ] **Step 1: Escreva o teste que falha**

Em `tests/front/pai-da-tela-do-admin.test.ts`, acrescente:

```ts
  it("admin-notifications e' tela de topo — o pai e' 'profile', nao uma subtela", () => {
    expect(paiDaTelaDoAdmin("admin-notifications", null, false)).toBe("profile");
    expect(paiDaTelaDoAdmin("admin-notifications", "admin-orders", false)).toBe(
      "profile",
    );
  });
```

- [ ] **Step 2: Rode e confirme que falha**

Run: `npx vitest run tests/front/pai-da-tela-do-admin.test.ts`
Expected: FAIL de **tipo** (`"admin-notifications"` não existe no union `View`) — que é o motivo certo.

- [ ] **Step 3: Implemente**

1. `src/types/index.ts`: acrescente `| "admin-notifications"` ao union `View`, logo depois de `"admin-push"`.
2. `src/App.tsx`: os quatro pontos da tabela acima. **Nenhum outro.**
3. `src/components/layouts/AdminArea.tsx`:
   - o `lazyWithPreload` da tela nova, no padrão do `AdminPush`;
   - o `case "admin-notifications"` no switch, envolto em `LocalErrorBoundary`, passando `onNavigate`;
   - `else if (view === "admin-notifications") title = "Notificações";`
   - **e mude** `else if (view === "admin-push") title = "Notificações";` para `title = "Avisar clientes";` — duas telas opostas com o mesmo nome é a causa raiz do pedido, não um detalhe.

`paiDaTelaDoAdmin` **não muda**: o `default` do switch já devolve `"profile"`, que é o certo. O teste do Step 1 existe para prender isso.

- [ ] **Step 4: Rode e confirme verde**

Run: `npx vitest run tests/front/pai-da-tela-do-admin.test.ts`

- [ ] **Step 5: Prove que a tela abre de verdade**

`npx vite dev` não: use o preview do projeto. Abra o app, entre no painel, e navegue até `admin-notifications`. Se não conseguir logar (a senha é do Gabriel), diga isso no relatório em vez de afirmar que funciona — `typecheck` verde não prova que a tela monta.

- [ ] **Step 6: Verificação e commit**

Seis comandos, e:

```bash
git commit -- src/types/index.ts src/App.tsx src/components/layouts/AdminArea.tsx tests/front/pai-da-tela-do-admin.test.ts
```

Mensagem: `feat(admin): a tela de Notificacoes entra no painel, e a de push vira "Avisar clientes"`.

---

### Task 6: O sino abre a tela certa

**Files:**
- Modify: `src/components/layouts/AdminLayout.tsx`
- Modify: `src/views/admin/AdminSettingsView.tsx`
- Delete: `tests/front/sino-do-painel-leva-onde-o-alerta-aponta.test.tsx`
- Create: `tests/front/sino-do-painel-leva-as-notificacoes.test.tsx`

**Interfaces:**
- Consumes: a view `"admin-notifications"` (Task 5).

**Contexto:** `AdminLayout.tsx:400` tem hoje uma escada de três destinos (`notificationBellTarget`). Ela vira a constante `"admin-notifications"`, e a escada inteira sai — inclusive o comentário que a explicava.

**O teste que está sendo apagado prende o comportamento ANTIGO** (pedido > pergunta > push). Apagá-lo é deliberado: o comportamento que ele descreve deixou de ser o desejado. Cite isso no cabeçalho do teste novo, para ninguém achar que foi um teste apagado por incômodo.

**Também nesta tarefa:** o crachá passa a somar avaliações sem resposta. Acrescente `pendingReviewsCount` no mesmo padrão de `pendingQuestionsCount`, buscando em `fetchInitialCounts` com `supabase.from("reviews").select("*", { count: "exact", head: true }).is("merchant_reply", null)`. **Não toque** no bloco de realtime, nem no `BroadcastChannel`, nem no leader election — o crachá atualiza ao montar, como o de perguntas já faz na primeira carga.

- [ ] **Step 1: Escreva o teste novo, que falha**

Crie `tests/front/sino-do-painel-leva-as-notificacoes.test.tsx`, partindo do dublê de Supabase do arquivo que será apagado (leia-o antes de apagar). Casos obrigatórios:

1. Com pedidos pendentes > 0, clicar no sino chama `onNavigate("admin-notifications")`.
2. Com tudo zerado, clicar no sino chama `onNavigate("admin-notifications")` — **o mesmo destino**; é isso que prova que a escada saiu, e não que ela foi rearranjada.
3. `onNavigate` **nunca** é chamado com `"admin-push"` nem com `"admin-orders"` a partir do sino.
4. O crachá vermelho aparece quando só há avaliação sem resposta (e nenhum pedido, nenhuma pergunta).

- [ ] **Step 2: Rode e confirme que falha**

Run: `npx vitest run tests/front/sino-do-painel-leva-as-notificacoes.test.tsx`

- [ ] **Step 3: Implemente**

1. `AdminLayout.tsx`: `const notificationBellTarget: View = "admin-notifications";` — e apague a escada e o comentário dela. Acrescente `pendingReviewsCount` e some-o na condição do ponto vermelho.
2. `AdminSettingsView.tsx`: o cartão criado hoje muda de `Notificações` para `Avisar clientes`, e o texto de apoio passa a deixar claro que é envio: "Envie avisos no celular dos clientes — para todos, para quem compra sempre ou para uma pessoa só." (o rótulo "Engajamento" fica).
3. Apague `tests/front/sino-do-painel-leva-onde-o-alerta-aponta.test.tsx`.

- [ ] **Step 4: Rode e confirme verde**

- [ ] **Step 5: Prove o dente**

Volte `notificationBellTarget` para a escada antiga. Os casos 1 **e** 2 têm de falhar — se só um falhar, o teste não distingue "escada saiu" de "escada rearranjada". Desfaça.

- [ ] **Step 6: Verificação e commit**

Seis comandos, e:

```bash
git commit -- src/components/layouts/AdminLayout.tsx src/views/admin/AdminSettingsView.tsx tests/front/sino-do-painel-leva-as-notificacoes.test.tsx tests/front/sino-do-painel-leva-onde-o-alerta-aponta.test.tsx
```

Mensagem: `feat(admin): o sino do painel abre as Notificacoes do lojista`.

---

### Task 7: Conferir o conjunto contra o pedido (`diretor`)

**Esta tarefa nasce com o plano, não se lembra no fim.** Plano de 3+ tarefas neste projeto abre com ela escrita, porque quando a falha é "ninguém aciona a checagem no fim", a solução é marcar a checagem na agenda antes de começar.

- [ ] **Step 1: Despache o `diretor` com o pedido original nas palavras do Gabriel**

O pedido literal foi: *"essa tela nao existe, crie uma tela de notificaçao para o logista(admin), mas somente notificaçao, e nao notificar clientes, entende?"*, com print apontando para o sino da barra superior.

Perguntas que ele deve responder com fato:

1. O sino abre a tela nova em **todos** os estados (com e sem pendência)?
2. A tela mostra os quatro avisos que o Gabriel escolheu, e **nenhum** deles envia coisa alguma para cliente?
3. Sobrou algum lugar do painel onde "Notificações" ainda significa "disparar push"?
4. **Depois desta entrega, quantas portas visíveis existem para cada uma das duas telas, no celular (375px)?** Esta pergunta é obrigatória: hoje, 24/08, a remoção de uma porta "redundante" deixou a tela de push com ZERO portas visíveis no celular, e só a conferência de conjunto pegou.
5. A verificação teve lastro — os testes existem no disco, as contagens batem, os seis comandos rodaram?

- [ ] **Step 2: Agir sobre o veredito**

`CORRIGE` volta para um implementador novo com o achado no prompt. `SEGUE` libera o PR.

---

## Self-Review

**Cobertura do spec:** as quatro fontes (Task 1 e 3), o limiar por produto (Task 1 e 2), o estoque efetivo via `mapProductFromDB` (Task 3), a bolinha contando três dos quatro (Task 1, 3 e 6), os quatro destinos (Task 1 e 4), a tela (Task 4), o registro e o rename (Task 5), o sino (Task 6), a conferência (Task 7). Sem lacuna.

**Placeholders:** nenhum "TBD"/"depois". As Tasks 3, 4 e 6 descrevem os casos de teste em prosa em vez de código pronto porque dependem do dublê de Supabase existente no repositório, que o implementador tem de **ler** — copiar um dublê inventado aqui seria pior que apontar o arquivo real.

**Consistência de tipos:** `Aviso`, `EntradaDeAvisos`, `montarAvisos`, `precisaDeReposicao` e `LIMIAR_PADRAO_DE_ESTOQUE` aparecem com o mesmo nome e a mesma assinatura nas Tasks 1, 3 e 4. `Product.estoqueMinimo` (Task 2) casa com `ProdutoComEstoque.estoqueMinimo` (Task 1). `useAvisosDoLojista` devolve `fontesComFalha`, e é esse o nome usado no teste da Task 4.
