# O app para de inventar endereço — Plano de Implementação

> **Para executores agênticos:** SUB-SKILL OBRIGATÓRIA: use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para implementar tarefa a tarefa. Os passos usam
> caixa de seleção (`- [ ]`) para acompanhamento.

**Objetivo:** acabar com todo endereço, cidade e CEP que o app preenche sozinho quando não sabe, e
mover a identidade da loja (nome, cidade, estado) do código para o painel administrativo.

**Arquitetura:** a regra única que rege o plano inteiro é **nenhum campo ganha valor de mentira;
quando falta, a tela diz que falta ou não mostra nada**. A identidade da loja passa a morar na
tabela `store_config` (que já existe e já é lida pelo `StoreContext`), e todo ponto que hoje escreve
`"Monte Carmelo"` ou `"38500-000"` como reserva passa a ler dali — e a **omitir** o trecho quando
não houver valor, nunca a inventar um.

**Pilha:** React 19 + TypeScript + Vite no front; Vitest (`tests/front/`) para teste de front;
Deno para edge function e teste de edge (`supabase/functions/`); Supabase/Postgres para o banco.

## Restrições globais

- **Migration NÃO leva `BEGIN`/`COMMIT`.** Com eles, o `ROLLBACK` do script de prova vira no-op e a
  mudança fica gravada em produção mesmo assim. Já aconteceu neste repositório em 05/08/2026.
- **Nenhum executor aplica migration.** A Tarefa 1 entrega o arquivo `.sql` e a prova com
  `ROLLBACK`; quem aplica é a sessão principal, depois do ok explícito do Gabriel.
- **Nunca `supabase db push`.**
- **Nunca `--no-verify` no commit.**
- **A cobrança PIX está LIGADA em produção.** `CheckoutView.tsx` é tela de dinheiro real: mudança
  ali é subtrativa (remover valor pré-preenchido), nunca acrescenta lógica de pagamento.
- **Escopo do commit vem de lista fechada** (`.commitlintrc.json`) e não aceita português. Os
  válidos: `account, admin, auth, brand, cart, catalog, checkout, ci, db, deps, edge, lib,
  notifications, orders, pwa, shipping, tooling, ui`.
- **Verificação:** os sete comandos que o CI cobra, nesta ordem — `npm ci`, `npm run typecheck`,
  `npm test`, `npm run build`, `npm run lint:links`, `npm run lint:ratchet`, `npm run size`. Cada
  tarefa diz quais rodar; o que ela não rodar, a sessão principal roda.
- **`eslint` tem teto de 0 erro e 553 warnings.** Warning novo reprova igual a erro novo.
- **Teste novo tem de cair quando a implementação é apagada.** Verde por acidente não conta.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade depois do plano |
|---|---|
| `supabase/migrations/20260819000000_identidade_da_loja.sql` | **Criar.** Colunas `store_name`, `store_city`, `store_state` em `store_config`; remove o `DEFAULT '38500-000'` de `origin_cep` |
| `rollback-20260819000000_identidade_da_loja.sql` | **Criar.** Desfaz a migration acima |
| `src/types/index.ts` | Acrescenta `storeName`, `storeCity`, `storeState` a `StoreConfig` |
| `src/contexts/StoreContext.tsx` | Lê e grava os três campos novos; **para de trazer `originCep: "38500-000"` como reserva** |
| `src/views/admin/AdminSettingsView.tsx` | Ganha o cartão "Identidade da Loja" — a tela de Ajustes passa a ajustar |
| `src/components/ui/custom/AddressForm.tsx` | Para de pré-preencher cidade, estado e CEP do cliente |
| `src/views/customer/CheckoutView.tsx` | Idem, mais o aviso de região que passa a ler a cidade da loja |
| `src/components/admin/orders/OrderDetail.tsx` | Para de completar cidade e estado ausentes do pedido |
| `src/views/customer/HomeView.tsx` | Descrição e título passam a ler a loja; sai a promessa falsa |
| `index.html` | Metadados sem cidade cravada |
| `src/views/customer/ProductView.tsx`, `src/views/shared/AuthView.tsx`, `src/components/ui/custom/FreeShippingBlock.tsx`, `src/views/customer/OrderDetailsView.tsx` | Exibem a cidade da loja, ou omitem o trecho |
| `public/sros_manifest.json`, `supabase/functions/send-otp-email/index.ts` | Sem cidade cravada |
| `supabase/functions/calculate-shipping/index.ts` | Para de assumir CEP de origem e taxa quando a loja não configurou |

---

## Tarefa 1: O banco ganha nome e lugar da loja

**Depende de:** nada. Pode ir em paralelo com as Tarefas 5 e 7.

**Arquivos:**
- Criar: `supabase/migrations/20260819000000_identidade_da_loja.sql`
- Criar: `rollback-20260819000000_identidade_da_loja.sql`

**Interfaces:**
- Produz: as colunas `store_config.store_name` (`text`, nulo), `store_config.store_city` (`text`,
  nulo) e `store_config.store_state` (`text`, nulo), consumidas pela Tarefa 2. E `origin_cep` sem
  valor padrão, consumido pela Tarefa 7.

**Por que assim:** as três colunas nascem **nulas e sem valor padrão** de propósito — nulo é o
estado "a loja ainda não disse", e é exatamente esse estado que o resto do plano passa a exibir
como ausência em vez de inventar. `origin_cep` perde só o `DEFAULT`; linhas que já existem
mantêm o valor que têm, então nada muda no banco atual.

- [ ] **Passo 1: escrever a migration**

Arquivo `supabase/migrations/20260819000000_identidade_da_loja.sql`, sem `BEGIN`/`COMMIT`:

```sql
-- Identidade da loja sai do código e passa a morar no banco.
--
-- Ate aqui, nome e cidade da loja viviam em src/config/branding.json (198 bytes,
-- editavel so por quem mexe no repositorio) e em 26 pontos de codigo com a string
-- "Monte Carmelo" cravada. Toda loja montada a partir deste molde herdava a cidade
-- errada, e o app preenchia o endereco do cliente com ela sem avisar.
--
-- As tres colunas nascem NULAS e SEM DEFAULT de proposito: nulo e o estado
-- "a loja ainda nao disse", e o app passa a exibir ausencia em vez de inventar.

ALTER TABLE public.store_config
  ADD COLUMN IF NOT EXISTS store_name  text,
  ADD COLUMN IF NOT EXISTS store_city  text,
  ADD COLUMN IF NOT EXISTS store_state text;

COMMENT ON COLUMN public.store_config.store_name  IS 'Nome da loja exibido ao cliente. NULO = a loja ainda nao configurou; a tela omite, nunca inventa.';
COMMENT ON COLUMN public.store_config.store_city  IS 'Cidade de onde a loja opera. NULO = nao configurado; a tela omite o trecho de localizacao.';
COMMENT ON COLUMN public.store_config.store_state IS 'UF de onde a loja opera. NULO = nao configurado.';

-- origin_cep tinha DEFAULT '38500-000': loja nova nascia dizendo que despacha de
-- Monte Carmelo sem ninguem ter informado isso, e o calculo de frete usava esse CEP
-- calado. Tirar o DEFAULT nao altera nenhuma linha existente.
ALTER TABLE public.store_config
  ALTER COLUMN origin_cep DROP DEFAULT;
```

- [ ] **Passo 2: escrever o rollback**

Arquivo `rollback-20260819000000_identidade_da_loja.sql`, na raiz do repositório (é onde os
outros rollbacks deste projeto vivem):

```sql
-- Desfaz 20260819000000_identidade_da_loja.sql

ALTER TABLE public.store_config
  DROP COLUMN IF EXISTS store_name,
  DROP COLUMN IF EXISTS store_city,
  DROP COLUMN IF EXISTS store_state;

ALTER TABLE public.store_config
  ALTER COLUMN origin_cep SET DEFAULT '38500-000'::text;
```

- [ ] **Passo 3: provar a migration com `ROLLBACK`, SEM gravar**

Rode o script de prova que já existe no projeto. Confira o nome real antes de rodar:

```bash
ls scripts | grep -i "prove\|prova\|db-"
```

Use o script de prova do repositório (o que envolve a migration em transação e faz `ROLLBACK` no
fim). **Se não existir**, prove com `psql` contra o banco, nesta forma exata:

```
BEGIN;
\i supabase/migrations/20260819000000_identidade_da_loja.sql
SELECT column_name, data_type, column_default, is_nullable
  FROM information_schema.columns
 WHERE table_name = 'store_config'
   AND column_name IN ('store_name','store_city','store_state','origin_cep')
 ORDER BY column_name;
ROLLBACK;
```

Esperado: as três colunas novas aparecem com `is_nullable = YES` e `column_default` vazio;
`origin_cep` aparece com `column_default` vazio. E depois do `ROLLBACK`, a mesma consulta fora da
transação **não** encontra as três colunas.

**Cole a saída inteira no relatório.** Ela é a prova, e sem ela a tarefa não está feita.

- [ ] **Passo 4: NÃO aplicar**

Esta tarefa termina aqui. **Não rode `db-apply`, não rode `supabase db push`, não aplique de
nenhuma outra forma.** Quem aplica é a sessão principal, depois do ok do Gabriel.

- [ ] **Passo 5: commitar**

Não rode os sete comandos: o diff toca só `supabase/migrations/` e um `.sql` de raiz, e nenhum dos
sete olha conteúdo de migration. Rode apenas `npm run lint:links` (por causa dos comentários) e
commite.

```bash
git add supabase/migrations/20260819000000_identidade_da_loja.sql rollback-20260819000000_identidade_da_loja.sql
```

Mensagem: `feat(db): a loja passa a ter nome e lugar proprios no banco`

---

## Tarefa 2: O app aprende os campos novos, e para de trazer CEP de reserva

**Depende de:** Tarefa 1 (só do desenho das colunas; não precisa da migration aplicada — o código
tem de funcionar com os três campos ausentes, que é o estado de hoje).

**Arquivos:**
- Modificar: `src/types/index.ts:222-251` (interface `StoreConfig`)
- Modificar: `src/contexts/StoreContext.tsx` (linhas 20-42 do `defaultStoreConfig`, ~256 da
  leitura, ~315 do `insert` inicial, ~476 do `updateConfig`)
- Testar: `tests/front/store-config-identidade-da-loja.test.ts` (criar)

**Interfaces:**
- Consome: as colunas `store_name`, `store_city`, `store_state` da Tarefa 1.
- Produz: os campos **opcionais** `storeName?: string`, `storeCity?: string`, `storeState?: string`
  em `StoreConfig`, e a garantia de que `originCep` é `undefined` quando o banco não tem valor —
  consumidos pelas Tarefas 3, 4 e 6.

**Por que opcionais:** `undefined` é o estado "não configurado" que as telas passam a exibir como
ausência. Se fossem obrigatórios com string vazia, cada tela teria de testar `=== ""`, e o primeiro
esquecimento voltaria a imprimir vazio no meio de uma frase.

- [ ] **Passo 1: escrever o teste que falha**

Crie `tests/front/store-config-identidade-da-loja.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { StoreConfig } from "@/types";

describe("identidade da loja no StoreConfig", () => {
  it("aceita nome, cidade e estado da loja", () => {
    const config: Partial<StoreConfig> = {
      storeName: "Loja Teste",
      storeCity: "Uberlândia",
      storeState: "MG",
    };
    expect(config.storeName).toBe("Loja Teste");
    expect(config.storeCity).toBe("Uberlândia");
    expect(config.storeState).toBe("MG");
  });

  it("trata identidade ausente como indefinida, nunca como texto de reserva", () => {
    const config: Partial<StoreConfig> = {};
    expect(config.storeName).toBeUndefined();
    expect(config.storeCity).toBeUndefined();
    expect(config.storeState).toBeUndefined();
    // Reserva de CEP era "38500-000" e cravava Monte Carmelo em loja que nunca
    // informou de onde despacha.
    expect(config.originCep).toBeUndefined();
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
npx vitest run tests/front/store-config-identidade-da-loja.test.ts
```

Esperado: FALHA no `typecheck` do Vitest, com erro de propriedade `storeName` inexistente em
`StoreConfig`.

- [ ] **Passo 3: acrescentar os campos ao tipo**

Em `src/types/index.ts`, dentro de `interface StoreConfig` (depois de `minAppVersion?: string;`):

```ts
  /** Nome da loja exibido ao cliente. `undefined` = a loja ainda não configurou. */
  storeName?: string;
  /** Cidade de onde a loja opera. `undefined` = não configurado; a tela omite o trecho. */
  storeCity?: string;
  /** UF de onde a loja opera. `undefined` = não configurado. */
  storeState?: string;
```

- [ ] **Passo 4: tirar o CEP de reserva do `defaultStoreConfig`**

Em `src/contexts/StoreContext.tsx`, no `defaultStoreConfig` (linha ~32), **remova** a linha
`originCep: "38500-000",`. Não a substitua por string vazia: o campo é opcional e tem de ficar
`undefined`.

Deixe um comentário no lugar explicando, porque essa linha vai parecer um esquecimento para quem
ler depois:

```ts
  // originCep NÃO tem reserva de propósito. Ele valia "38500-000", e isso fazia
  // toda loja que nunca informou de onde despacha calcular frete a partir de
  // Monte Carmelo, calada. Sem valor = a loja não disse, e quem consome trata isso.
```

- [ ] **Passo 5: ler os três campos novos do banco**

Ainda em `StoreContext.tsx`, no mesmo bloco onde `originCep` é lido com `getVal` (linha ~256),
acrescente as três leituras, seguindo exatamente o padrão do vizinho:

```ts
      storeName: getVal("store_name", "storeName", undefined),
      storeCity: getVal("store_city", "storeCity", undefined),
      storeState: getVal("store_state", "storeState", undefined),
```

E ajuste a leitura de `originCep` para não cair na reserva antiga: o terceiro argumento passa a ser
`undefined` em vez de `defaultStoreConfig.originCep`.

- [ ] **Passo 6: gravar os três campos novos**

No `updateConfig` (linha ~476), no mesmo padrão dos vizinhos:

```ts
        if (updates.storeName !== undefined) dbUpdates.store_name = updates.storeName;
        if (updates.storeCity !== undefined) dbUpdates.store_city = updates.storeCity;
        if (updates.storeState !== undefined) dbUpdates.store_state = updates.storeState;
```

**Atenção:** o PR #225 corrigiu justamente o caso de o painel dizer "salvo" sem salvar, e a
correção foi montar o UPDATE **por presença de chave**. Siga o padrão que já está no arquivo; se o
padrão de lá for diferente do escrito acima, o padrão do arquivo vence.

E no `insert` inicial (linha ~315), **remova** `origin_cep: defaultStoreConfig.originCep,` — a loja
nova não nasce mais dizendo de onde despacha.

- [ ] **Passo 7: rodar e ver passar**

```bash
npx vitest run tests/front/store-config-identidade-da-loja.test.ts
```

Esperado: PASSA, os dois casos.

- [ ] **Passo 8: provar que o teste não passa por acaso**

Desfaça temporariamente o Passo 3 (tire os três campos do tipo), rode o teste de novo e confirme
que ele **falha**. Refaça o Passo 3. Cole as duas saídas no relatório.

- [ ] **Passo 9: verificação e commit**

Rode os sete comandos (o diff toca `src/`). Cole a saída de cada um.

```bash
git add src/types/index.ts src/contexts/StoreContext.tsx tests/front/store-config-identidade-da-loja.test.ts
```

Mensagem: `feat(admin): o app aprende nome, cidade e estado da loja, e para de assumir o CEP de origem`

---

## Tarefa 3: A tela de Ajustes passa a ajustar

**Depende de:** Tarefa 2 (os campos `storeName`, `storeCity`, `storeState` em `StoreConfig`).

**Arquivos:**
- Modificar: `src/views/admin/AdminSettingsView.tsx`
- Testar: `tests/front/admin-settings-identidade-da-loja.test.tsx` (criar)

**Interfaces:**
- Consome: `storeName`, `storeCity`, `storeState` de `StoreConfig`, e `updateConfig` do
  `StoreContext` (que devolve `Promise<boolean>` — **`true` só quando gravou mesmo**).
- Produz: nada consumido por outra tarefa.

**O estado de hoje:** essa tela tem exatamente dois blocos — "Diagnóstico de Conexão", que mede
latência de rede e perda de pacotes, e um guia de ajuda. Não há uma única configuração de loja
nela. Quem opera o painel abre "Ajustes", encontra um medidor de internet, e fecha.

**O que entra:** um cartão **"Identidade da Loja"**, acima do diagnóstico, com três campos de
texto — Nome da loja, Cidade, Estado (UF) — e um botão de salvar.

- [ ] **Passo 1: escrever o teste que falha**

Crie `tests/front/admin-settings-identidade-da-loja.test.tsx`. Siga o padrão de montagem e de
mocks dos testes de admin que já existem — leia
`tests/front/admin-limpar-campo-persiste-como-null.test.tsx` antes de escrever, e reaproveite o
jeito dele de embrulhar o componente nos contextos.

O teste tem de cobrir três coisas:

```tsx
it("mostra os campos de identidade da loja preenchidos com o que está salvo", async () => {
  // config com storeName "Loja Teste", storeCity "Uberlândia", storeState "MG"
  // espera achar os três valores nos campos
});

it("grava os três campos quando a pessoa salva", async () => {
  // digita nos três campos, clica em salvar
  // espera updateConfig ter sido chamado com { storeName, storeCity, storeState }
});

it("não diz que salvou quando a gravação falha", async () => {
  // updateConfig devolve false
  // espera NÃO aparecer mensagem de sucesso
});
```

O terceiro caso não é enfeite: o defeito de "dizer salvo sem salvar" foi corrigido no PR #225 em
outras telas, e escrever esta sem a mesma guarda recria o defeito numa tela nova.

- [ ] **Passo 2: rodar e ver falhar**

```bash
npx vitest run tests/front/admin-settings-identidade-da-loja.test.tsx
```

Esperado: FALHA — os campos não existem na tela.

- [ ] **Passo 3: implementar o cartão**

Acrescente o cartão em `AdminSettingsView.tsx`, **acima** do bloco "Diagnóstico de Conexão".
Siga o estilo visual dos cartões que já existem no arquivo (mesma borda arredondada, mesma
tipografia de rótulo) — não invente um visual novo.

Regras de comportamento, e nenhuma delas é opcional:

- Campo vazio grava `null`, não string vazia. Vazio significa "não configurado", e o resto do app
  depende disso para omitir o trecho em vez de imprimir nada no meio de uma frase.
- O botão de salvar **olha o retorno de `updateConfig`**. Só mostra sucesso quando o retorno é
  `true`. O toast de erro já sai de dentro do `StoreContext`; aqui basta não seguir em frente.
- O campo Estado aceita 2 letras e as guarda em maiúscula.

- [ ] **Passo 4: rodar e ver passar**

```bash
npx vitest run tests/front/admin-settings-identidade-da-loja.test.tsx
```

Esperado: PASSA, os três casos.

- [ ] **Passo 5: provar que o teste não passa por acaso**

Comente o `updateConfig` do botão de salvar, rode, confirme que o segundo caso **falha**.
Restaure. Cole as duas saídas.

- [ ] **Passo 6: ver na tela**

Suba o preview com `preview_start` usando `{name: "core_app_mkt"}`, abra o painel administrativo,
vá em Ajustes, e tire uma captura do cartão novo. Confira que ele aparece **acima** do diagnóstico
de conexão. Anexe a captura ao relatório.

- [ ] **Passo 7: verificação e commit**

Sete comandos. Cole a saída.

```bash
git add src/views/admin/AdminSettingsView.tsx tests/front/admin-settings-identidade-da-loja.test.tsx
```

Mensagem: `feat(admin): a tela de Ajustes passa a ajustar nome, cidade e estado da loja`

---

## Tarefa 4: O formulário para de preencher a cidade do cliente

**Depende de:** Tarefa 2.

**Arquivos:**
- Modificar: `src/components/ui/custom/AddressForm.tsx:47`, `:52`, `:103`, `:108`, `:223`
- Modificar: `src/views/customer/CheckoutView.tsx:262-264`, `:280-282`, `:896-897`, `:1336`,
  `:1445`, `:1748`
- Testar: `tests/front/checkout-nao-preenche-endereco-do-cliente.test.tsx` (criar)

**Interfaces:**
- Consome: `storeCity`, `storeState` de `StoreConfig` (Tarefa 2).
- Produz: nada consumido por outra tarefa.

**O defeito, em uma frase:** o formulário abre com cidade "Monte Carmelo", estado "MG" e CEP
"38500-000" já escritos, e quem não apagar manda o pedido para uma cidade que não é a dele.

**Atenção:** esta é a tela onde a cobrança PIX real acontece. Toda mudança aqui é **subtrativa** —
tirar valor pré-preenchido. Não acrescente lógica de pagamento, não mexa em nada de checkout que
não esteja listado nas linhas acima.

- [ ] **Passo 1: escrever o teste que falha**

Crie `tests/front/checkout-nao-preenche-endereco-do-cliente.test.tsx`. Leia
`tests/front/checkout-guest-cep.test.tsx` e
`tests/front/checkout-ordem-dos-campos-de-endereco.test.tsx` antes, e reaproveite a montagem deles.

Cobrir:

```tsx
it("abre com cidade, estado e CEP vazios, em cobertura nacional", async () => {
  // config.shippingCoverage = "national"
  // espera os três campos com value ""
});

it("abre com cidade, estado e CEP vazios TAMBÉM em cobertura local", async () => {
  // config.shippingCoverage = "local", storeCity "Uberlândia", storeState "MG"
  // Em cobertura local a loja entrega só na região dela, mas quem digita o
  // endereço é o cliente: o app pode SUGERIR, nunca PREENCHER.
  // espera os três campos com value ""
});

it("o aviso de região mostra a cidade da loja quando ela configurou", async () => {
  // storeCity "Uberlândia", storeState "MG" -> aparece "Uberlândia, MG"
});

it("o aviso de região some quando a loja não configurou cidade", async () => {
  // storeCity undefined -> o aviso de região não aparece na tela
  // (nunca "Monte Carmelo", nunca ", " solto)
});
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
npx vitest run tests/front/checkout-nao-preenche-endereco-do-cliente.test.tsx
```

Esperado: FALHA nos quatro casos.

- [ ] **Passo 3: limpar o `AddressForm`**

Em `src/components/ui/custom/AddressForm.tsx`:

- Linha 47: `cep: initialData?.cep || "38500-000",` → `cep: initialData?.cep || "",`
- Linha 52: `city: initialData?.city || "Monte Carmelo",` → `city: initialData?.city || "",`
- Linha 53: `state: initialData?.state || "MG",` → `state: initialData?.state || "",`
- Linha 103: `cep: isNational ? "" : config.originCep || "38500-000",` → `cep: "",`
- Linha 108: `city: isNational ? "" : "Monte Carmelo",` → `city: "",`
- Linha 109: `state: isNational ? "" : "MG",` → `state: "",`
- Linha 223: o `placeholder` passa a ser `"00000-000"` nos dois casos. Marca-d'água é sugestão
  visual e não vai junto no envio, então ela pode ficar — mas o CEP de uma cidade específica ali
  ensina errado. Use o formato genérico.

Repare que o `isNational ? ... : ...` desaparece dos três campos: a cobertura da loja decide
**para onde ela entrega**, nunca **onde o cliente mora**.

- [ ] **Passo 4: limpar o `CheckoutView`**

Em `src/views/customer/CheckoutView.tsx`:

- Linha 262: `cep: localStorage.getItem("ikcous_last_shipping_cep") || "38500-000",` →
  `cep: localStorage.getItem("ikcous_last_shipping_cep") || "",`
- Linha 263: `city: "Monte Carmelo",` → `city: "",`
- Linha 264: `state: "MG",` → `state: "",`
- Linhas 279-282, dentro do `form.reset`: o `cep` cai para
  `localStorage.getItem("ikcous_last_shipping_cep") || ""`, e `city`/`state` para `""`, sem o
  ternário de `isNational`.
- Linha 896-897: `city: data.city || "Monte Carmelo",` e `state: data.state || "MG",` →
  `city: data.city,` e `state: data.state,`. **Este é o ponto mais importante do plano inteiro:**
  é aqui que a cidade inventada entra no pedido gravado.
- Linha 1336: `placeholder` passa a `"00000-000"` nos dois casos.
- Linha 1445: `placeholder` do campo cidade passa a `"Cidade"` nos dois casos.
- Linhas 1742-1752, o "Aviso de Região": passa a montar a frase com
  `config.storeCity` e `config.storeState`, e **o bloco inteiro não é renderizado** quando
  `config.storeCity` não tiver valor. Nada de `"Monte Carmelo"`, nada de vírgula solta.

- [ ] **Passo 5: rodar e ver passar**

```bash
npx vitest run tests/front/checkout-nao-preenche-endereco-do-cliente.test.tsx
```

Esperado: PASSA, os quatro casos.

- [ ] **Passo 6: não quebrar o que já passava**

```bash
npx vitest run tests/front/checkout-guest-cep.test.tsx tests/front/checkout-ordem-dos-campos-de-endereco.test.tsx tests/front/address-form-cep-race.test.tsx tests/front/checkout-summary-bar.test.tsx tests/front/checkout-view-flag-on.test.tsx tests/front/checkout-view-flag-off.test.tsx
```

Esperado: todos verdes. **Um aviso conhecido:** `checkout-view-flag-off` falha nesta máquina por
causa do `.env.local` local (`VITE_PAGAMENTO_ONLINE=true`), e passa no CI. Se ele for o único
vermelho e a mensagem for sobre a bandeira de pagamento, não investigue — anote no relatório.

- [ ] **Passo 7: provar que os testes não passam por acaso**

Reponha `city: "Monte Carmelo"` na linha 263, rode o teste novo, confirme que o primeiro caso
**falha**. Desfaça. Cole as duas saídas.

- [ ] **Passo 8: ver na tela**

Preview com `{name: "core_app_mkt"}`, abra o checkout como visitante, e confirme com captura que
cidade, estado e CEP começam vazios.

- [ ] **Passo 9: verificação e commit**

Sete comandos. Cole a saída.

```bash
git add src/components/ui/custom/AddressForm.tsx src/views/customer/CheckoutView.tsx tests/front/checkout-nao-preenche-endereco-do-cliente.test.tsx
```

Mensagem: `fix(checkout): o formulario para de preencher a cidade e o CEP do cliente`

---

## Tarefa 5: O painel para de inventar o endereço do pedido

**Depende de:** nada. Pode ir em paralelo com as Tarefas 1 e 7.

**Arquivos:**
- Modificar: `src/components/admin/orders/OrderDetail.tsx:309`, `:931-932`, `:952-953`
- Testar: `tests/front/order-detail-nao-inventa-cidade.test.tsx` (criar)

**Interfaces:**
- Consome: nada de outra tarefa.
- Produz: nada consumido por outra tarefa.

**O defeito:** quando o pedido não traz cidade, o painel escreve "Monte Carmelo - MG" no lugar — e
esse é o endereço que quem vende **copia e abre no Google Maps** para entregar. O sistema não
sinaliza em lugar nenhum que inventou.

Três pontos, e o do meio é o pior:
- Linha 309: o resumo no topo mostra `• Monte Carmelo/MG` quando falta cidade.
- Linhas 931-932: o endereço montado para exibição e cópia.
- Linhas 952-953: a consulta que vai para o **Google Maps**.

- [ ] **Passo 1: escrever o teste que falha**

Crie `tests/front/order-detail-nao-inventa-cidade.test.tsx`. Cobrir:

```tsx
it("não escreve nenhuma cidade quando o pedido não tem cidade", () => {
  // pedido sem city e sem state
  // espera NÃO achar "Monte Carmelo" em lugar nenhum da tela
});

it("mostra a cidade do pedido quando ela existe", () => {
  // pedido com city "Patos de Minas", state "MG"
  // espera achar "Patos de Minas"
});

it("o link do mapa não leva cidade inventada", () => {
  // pedido sem city -> o href do mapa não contém "Monte Carmelo"
});
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
npx vitest run tests/front/order-detail-nao-inventa-cidade.test.tsx
```

Esperado: FALHA nos casos 1 e 3.

- [ ] **Passo 3: implementar**

Nas três posições, a cidade e o estado passam a ser **omitidos** quando não existem, em vez de
substituídos:

- Linha 309: só renderiza o trecho `• cidade/UF` quando `order.customer.city` tiver valor.
- Linhas 928-932: o item da lista de endereço vira string vazia quando não há cidade nem estado —
  o `.filter(Boolean)` que já existe logo abaixo remove o item sozinho, então não é preciso mudar
  a montagem da lista.
- Linhas 952-953: só empurra `cidade - UF` para `mapsQueryParts` quando `order.customer.city`
  tiver valor.

Não acrescente texto do tipo "cidade não informada" no endereço de cópia: ele é colado em
aplicativo de entrega, e uma frase no meio atrapalha mais que a ausência.

- [ ] **Passo 4: rodar e ver passar**

```bash
npx vitest run tests/front/order-detail-nao-inventa-cidade.test.tsx
```

Esperado: PASSA, os três casos.

- [ ] **Passo 5: provar que o teste não passa por acaso**

Reponha `|| "Monte Carmelo"` na linha 952, rode, confirme que o terceiro caso **falha**. Desfaça.
Cole as duas saídas.

- [ ] **Passo 6: verificação e commit**

Sete comandos. Cole a saída.

```bash
git add src/components/admin/orders/OrderDetail.tsx tests/front/order-detail-nao-inventa-cidade.test.tsx
```

Mensagem: `fix(orders): o painel para de completar o endereco do pedido com cidade inventada`

---

## Tarefa 6: A cidade da loja sai do código, e a promessa falsa sai da home

**Depende de:** Tarefa 2.

**Arquivos:**
- Modificar: `src/views/customer/HomeView.tsx:217`, `:222`, `:224`
- Modificar: `index.html:9`, `:19`, `:33`, `:52`
- Modificar: `src/views/customer/ProductView.tsx:1170`
- Modificar: `src/views/shared/AuthView.tsx:444`, `:727`
- Modificar: `src/components/ui/custom/FreeShippingBlock.tsx:135`
- Modificar: `src/views/customer/OrderDetailsView.tsx:618`
- Modificar: `public/sros_manifest.json:33`
- Modificar: `supabase/functions/send-otp-email/index.ts:114`
- Testar: `tests/front/identidade-da-loja-nas-telas.test.tsx` (criar)

**Interfaces:**
- Consome: `storeCity`, `storeState`, `storeName` de `StoreConfig` (Tarefa 2).
- Produz: nada consumido por outra tarefa.

**Duas coisas nesta tarefa, e a segunda é independente da primeira:**

**(a) A cidade sai do código.** Em toda tela que hoje escreve "Monte Carmelo", o texto passa a vir
de `config.storeCity` / `config.storeState`, e **o trecho inteiro some** quando não há valor. A
regra vale para cada ponto: nunca imprimir vírgula solta, travessão solto ou espaço no meio de uma
frase por falta de dado.

**(b) A promessa falsa sai da home.** `HomeView.tsx:224` descreve a loja como *"O melhor marketplace
de Monte Carmelo com entrega ultrarrápida e troca garantida"*. **Não existe entrega ultrarrápida e
não existe fluxo de troca** — é a mesma frase que o PR #225 tirou do carrinho por ser mentira, viva
na descrição da página inicial e no que aparece quando alguém compartilha o link. As issues #46
(política de troca) e #108 (status de devolução) seguem abertas. Tire as duas promessas.

Mesma coisa em `index.html:9`, `:19` e `:33`: "entrega super rápida" e "frete grátis" — o frete
grátis existe (é configurável, com mínimo), mas a entrega super rápida não. Tire só a que é falsa.

**Sobre `index.html`, `sros_manifest.json` e `send-otp-email`:** esses três não têm acesso ao
`StoreConfig` em tempo de execução. Neles, **remova a cidade** e deixe o texto genérico; não tente
inventar um mecanismo de substituição em tempo de build para isto agora.

- [ ] **Passo 1: escrever o teste que falha**

Crie `tests/front/identidade-da-loja-nas-telas.test.tsx`. Cobrir:

```tsx
it("a home não promete entrega ultrarrápida nem troca garantida", () => {
  // renderiza HomeView, lê os metadados aplicados
  // espera NÃO achar "ultrarrápida" nem "troca garantida"
});

it("a home mostra a cidade da loja quando configurada", () => {
  // storeCity "Uberlândia" -> título contém "Uberlândia"
});

it("a home não mostra cidade nenhuma quando a loja não configurou", () => {
  // storeCity undefined -> título não contém "Monte Carmelo",
  // e não contém "|" seguido de espaço vazio nem vírgula solta
});

it("o bloco de frete grátis mostra a cidade da loja, ou omite o rótulo", () => {
  // dois casos: com storeCity e sem
});
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
npx vitest run tests/front/identidade-da-loja-nas-telas.test.tsx
```

Esperado: FALHA.

- [ ] **Passo 3: implementar, arquivo por arquivo**

`src/views/customer/HomeView.tsx`:
- Linha 217 (`homeDescription`): monta a frase com a cidade da loja; sem cidade, a frase fica
  `"Descubra produtos exclusivos."` — sem "em , ".
- Linha 222 (`title`): `branding.appName` sozinho quando não há cidade; `${appName} | ${cidade}, ${uf}`
  quando há.
- Linha 224 (`description`): **saem "ultrarrápida" e "troca garantida"**. A frase passa a descrever
  só o que a loja faz de verdade.

`index.html` linhas 9, 19, 33, 52: tire "Monte Carmelo, MG" e tire "entrega super rápida". O título
da aba (linha 52) fica só `IKCOUS Marketplace`.

`src/views/customer/ProductView.tsx:1170`: `"Entrega em Monte Carmelo, MG"` passa a ler a cidade da
loja; **sem cidade, o bloco inteiro (ícone e texto) não é renderizado**.

`src/views/shared/AuthView.tsx`:
- Linha 444: a frase de boas-vindas perde a cidade e fica genérica.
- Linha 727: `{branding.appName} • Monte Carmelo, MG` passa a ler a cidade; sem cidade, mostra só
  o nome, sem o `•` solto.

`src/components/ui/custom/FreeShippingBlock.tsx:135`: o rótulo "Monte Carmelo" passa a ler a
cidade da loja; sem cidade, **o rótulo e o ponto separador ao lado dele somem**, e o texto de
"Entrega Grátis" fica sozinho.

`src/views/customer/OrderDetailsView.tsx:618`: `{neighborhood} • Monte Carmelo` passa a mostrar a
cidade **do pedido** (`order.customer.city`), não a da loja — é o endereço de quem comprou. Sem
cidade no pedido, mostra só o bairro, sem o `•`.

`public/sros_manifest.json:33`: `"delivery_restriction": "Monte Carmelo, MG"` → `null`.

`supabase/functions/send-otp-email/index.ts:114`: tire `Monte Carmelo, MG` do rodapé do e-mail.

- [ ] **Passo 4: conferir que não sobrou nenhum**

```bash
grep -rn "Monte Carmelo" src supabase/functions index.html public
```

Esperado: **nenhum resultado**, com uma exceção permitida — o comentário histórico em
`supabase/functions/calculate-shipping/index.ts:63`, que explica um defeito passado e não é texto
exibido. Se aparecer qualquer outro, ele passou despercebido: conserte antes de seguir.

- [ ] **Passo 5: rodar e ver passar**

```bash
npx vitest run tests/front/identidade-da-loja-nas-telas.test.tsx
```

Esperado: PASSA.

- [ ] **Passo 6: provar que o teste não passa por acaso**

Reponha "troca garantida" na linha 224, rode, confirme que o primeiro caso **falha**. Desfaça.
Cole as duas saídas.

- [ ] **Passo 7: ver na tela**

Preview com `{name: "core_app_mkt"}`. Com a loja **sem** cidade configurada (que é o estado de
hoje), abra a home, um produto e a tela de entrar, e confirme por captura que **não sobrou vírgula
solta, travessão solto nem espaço estranho** onde a cidade estava.

- [ ] **Passo 8: verificação e commit**

Sete comandos. Cole a saída. `supabase/functions/` está no diff, então `lint:ratchet` é
obrigatório — é o único dos sete que olha essa pasta.

```bash
git add src/views/customer/HomeView.tsx index.html src/views/customer/ProductView.tsx src/views/shared/AuthView.tsx src/components/ui/custom/FreeShippingBlock.tsx src/views/customer/OrderDetailsView.tsx public/sros_manifest.json supabase/functions/send-otp-email/index.ts tests/front/identidade-da-loja-nas-telas.test.tsx
```

Mensagem: `fix(ui): a cidade da loja sai do codigo, e a home para de prometer entrega ultrarrapida`

---

## Tarefa 7: O frete para de assumir de onde a loja despacha

**Depende de:** nada. Pode ir em paralelo com as Tarefas 1 e 5.

**Arquivos:**
- Modificar: `supabase/functions/calculate-shipping/index.ts:408-409`
- Testar: `supabase/functions/calculate-shipping/index_test.ts` (acrescentar casos)

**Interfaces:**
- Consome: `origin_cep` sem valor padrão (Tarefa 1) — mas a correção **não depende** da migration
  estar aplicada: a função tem de tratar `null` vindo do banco, que já pode acontecer hoje.
- Produz: nada consumido por outra tarefa.

**O defeito, e por que ele é irmão do que a 1.4.0 corrigiu:**

```
const originCep = (storeConfig.origin_cep || '38500-000').replace(/\D/g, '')
const flatFee   = Number(storeConfig.shipping_fee || 15)
```

A release 1.4.0 acabou com o preço inventado de R$ 15 na **contingência**. Estas duas linhas são o
mesmo defeito um andar acima: se a loja não disse de onde despacha, a função calcula a partir de
Monte Carmelo calada; se não disse quanto cobra, assume R$ 15.

**A regra que vale aqui é a mesma da 1.4.0:** falha não produz opção nenhuma. Cotação sem origem
não é cotação — é chute com aparência de preço.

- [ ] **Passo 1: escrever os testes que falham**

Em `supabase/functions/calculate-shipping/index_test.ts`, acrescente:

```ts
Deno.test("sem CEP de origem configurado, nao devolve opcao de frete", async () => {
  // storeConfig com origin_cep null
  // espera erro claro ou lista de opcoes vazia — nunca uma opcao calculada
});

Deno.test("sem taxa configurada, nao inventa R$ 15", async () => {
  // storeConfig com shipping_fee null, provider flat_fee
  // espera que nenhuma opcao saia com price 15
});
```

Leia o arquivo de teste inteiro antes de escrever: ele já tem montagem de `storeConfig` falso, e
reaproveitar é obrigatório.

- [ ] **Passo 2: rodar e ver falhar**

```bash
npm run test:edge
```

Esperado: FALHA nos dois casos novos.

- [ ] **Passo 3: implementar**

Linha 408: quando `storeConfig.origin_cep` não tiver valor, a função **não** calcula. Devolva o
mesmo formato de falha que o arquivo já usa para "não consegui cotar" — leia o tratamento que
existe logo acima e siga o padrão dele; não invente formato de erro novo.

Linha 409: quando `storeConfig.shipping_fee` não tiver valor e o provedor for `flat_fee`, também
não produza opção. Repare que `Number(null)` é `0` e `null || 15` é `15` — os dois caminhos estão
errados, e o certo é não cotar.

Deixe um comentário curto explicando, no mesmo tom dos comentários que já existem no arquivo, que
a regra veio do defeito de R$ 15 corrigido na 1.4.0.

- [ ] **Passo 4: rodar e ver passar**

```bash
npm run test:edge
```

Esperado: PASSA, inclusive os 237 que já existiam.

- [ ] **Passo 5: provar que os testes não passam por acaso**

Reponha `|| '38500-000'` na linha 408, rode, confirme que o primeiro caso **falha**. Desfaça. Cole
as duas saídas.

- [ ] **Passo 6: NÃO publicar a função**

Esta tarefa termina no repositório. **Não rode `supabase functions deploy`.** A Vercel sobe o front
sozinha no merge, mas edge function sobe à mão, e quem publica é a sessão principal — que também
tem de preservar `verify_jwt: false`, o estado que está no ar para esta função.

- [ ] **Passo 7: verificação e commit**

Sete comandos. **`lint:ratchet` é obrigatório aqui** — é o único dos sete que olha
`supabase/functions/`; `typecheck` e `build` seguem os `tsconfig` do app, que não incluem essa
pasta, e `size` só mede `dist/assets/*`. Quem entrega diff ali e pula o `lint:ratchet` não tem
nenhum dos outros seis cobrindo o que mudou.

```bash
git add supabase/functions/calculate-shipping/index.ts supabase/functions/calculate-shipping/index_test.ts
```

Mensagem: `fix(shipping): sem CEP de origem e sem taxa, a funcao para de cotar em vez de assumir`

---

## Depois das sete tarefas — o que é da sessão principal

Nada disto é tarefa de executor:

1. **Revisar cada tarefa** com o `revisor`. Revisor em **Opus** para as Tarefas 1 (migration),
   4 (checkout) e 7 (edge function); **Sonnet** serve para as Tarefas 3, 5 e 6.
2. **Aplicar a migration da Tarefa 1** — só depois do ok explícito do Gabriel, e depois da revisão.
3. **Publicar a edge function da Tarefa 7** à mão, preservando `verify_jwt: false`, e conferir
   `UPDATED_AT` contra o `git log` da pasta depois de publicar. Merge não é estar no ar.
4. **Preencher a identidade da loja no painel** depois que a migration entrar, para que o app de
   demonstração não fique sem nome nem cidade.
5. **Chamar o `diretor`** antes de dar o bloco por pronto — são 7 tarefas, e parte do resultado
   depende de ambiente separado do código (migration aplicada, function publicada).
6. **O PIX de R$ 1,00** como portão de saída, com a autorização do Gabriel: prova que a corrente do
   dinheiro continua inteira depois de mexer no checkout.

## Fora deste plano, de propósito

- **#126, a chave publishable do Supabase.** O sócio propôs juntar na mesma leva, mas misturar
  troca de chave de acesso com correção de endereço é exatamente o padrão "a correção cria o
  defeito seguinte" que já custou caro neste repositório. Vai como bloco próprio, e tem folga: a
  documentação oficial da Supabase dá prazo até o fim de 2026.
- **`branding.json`.** O arquivo continua existindo e continua sendo a fonte de `appName` e das
  cores. Mover isso para o banco é outro bloco; este plano tira do código a **cidade** e o
  **endereço**, que são os que fazem mercadoria ir para o lugar errado.
