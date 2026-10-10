# Fila do que ainda não começou (em ordem, com dependências)

Antes de tudo: fechar o `02-em-andamento.md`. Depois, nesta ordem. Cada item aponta a especificação.

## 1. C2.5 — dependência `zxing-wasm` (depois de `package-34` da tooling, que também toca `package.json`)

O decodificador (`src/lib/leitor/decodificador.ts`) já tem o fallback `zxing-wasm` INJETADO e carregado
sob demanda, mas a dependência ainda não está no `package.json` (decisão D10 do plano: incluir, lazy,
para o iPhone ler). Fazer: `npm i zxing-wasm@<versão estável atual>` (a sessão anotou 3.1.4 em 15/09;
confira a mais nova), ligar o import dinâmico real onde hoje há o ponto de injeção, `.size-limit.cjs`
passa a medir `*.wasm` (ver a tarefa `size-limit-16`), teste do carregamento sob demanda (o chunk do
zxing NÃO entra no boot nem no chunk do PDV), `npm run build && npm run size`. Escopo do commit: `deps`
ou `catalog`.

## 2. Follow-ups baratos que destravam coisas (ver a lista completa no `04`)

- `src/types/database.types.ts`: acrescentar `registrar_venda_presencial` e `buscar_por_codigo_barras`
  em `Functions` (à mão, como a casa faz) e tirar o `(supabase.rpc as any)` de `AdminPdvView.tsx` e do
  formulário do produto.
- `App.tsx` `handlePopState`: consultar o override por camada ANTES do gate de dirty (Voltar do
  aparelho com cupom cheio no PDV não fecha a camada). Com teste.
- Recibo do PDV: cliente sai da resposta do banco (`order.customer_name` / `customer_data.whatsapp`),
  não da tela.
- Grades da vitrine: passar `freeShippingPreset` nos 6 `<ProductCard>` e no `PremiumOffers`.

## 3. Migrations pendentes (fila serializada; uma por vez; rollback + teste + tipos à mão)

- `upsert_store_config`: `COALESCE(free_shipping_min, 100)` → `0` no INSERT e derrubar o `DEFAULT 100`
  da coluna (a loja nova já nasce com frete grátis desligado no front; o banco ainda semeia 100).
- `shipping_quotes_cache`: `UNIQUE (origin_cep, destination_cep, cart_hash)` + gatilho de limpeza
  `AFTER INSERT OR UPDATE` + voltar o edge a `.upsert`.
- pedidos-4 pode precisar de RPC/parâmetro para a janela por data de CANCELAMENTO (ver `02`).
- `db-apply.cjs`: `VERIFICACOES` sem entrada para `20261163000000`.

## 4. A7 — banco/RPCs da Onda A

Ver o plano, §3 (tabela A7) e §8 (A7 depois de A1..A6, na mesma fila de migrations que C1). Inclui
D12 (valor divergente no PIX registra `recusado`, avisa e pede novo pagamento).

## 5. Onda B — reescritas por área

> **RESERVADA (decisão do dono, 17/09): a Onda B NÃO é de quem estiver terminando as frentes acima.**
> Ela fica arquivada aqui e será feita pela sessão original a partir de terça (reset da cota), em
> branch própria por área, DEPOIS que a atualização atual estiver publicada. Quem chegar até aqui
> para na publicação (lista "Antes de tirar o PR do rascunho") e avisa o dono.

Plano §4 (tabela de partição dos arquivos acima de 1.500 linhas) e §8: `B4 → B5`, `B2 → B3`, `B1 por
último` (toca `App.tsx`). Cada B só depois do A da mesma área. Um escritor por arquivo grande.

## 6. C6 — operação da loja física (só depois do primeiro uso real do PDV)

Plano §5.6: movimentações de estoque por leitura, fila de vendas sem rede com idempotência,
troca/devolução parcial, papéis vendedor/gerente.

## Decisões que só o dono toma (perguntar, não decidir)

- Publicar as CINCO functions da cobrança (`cobranca` no workflow) a partir desta branch, para a chave
  do lojista valer no checkout. Antes: conferir o contrato `criar-pagamento` × front de produção
  (`DEPLOYMENT.md` §5.3.1). Até lá, "Receber PIX no app" deve ficar DESLIGADO (ver `05`).
- Credenciais de PRODUÇÃO do Mercado Pago (as salvas hoje são de TESTE).
- Default de `enabled_shipping_methods` (`['sedex','pac']` perde a Jadlog "de brinde").
- Pedido cotado na Frenet pode virar etiqueta do Melhor Envio pela escolha do lojista? (hoje pode).
- Lojas já semeadas com `free_shipping_min = 350`: migrar ou deixar.
- Bipe com a folha de variação aberta no PDV: ignorar ou fechar a folha.

## Antes de tirar o PR #624 do rascunho

1. `npm ci && npm run typecheck && npm test` inteiro (edge + unit + front) e `npm run build && npm run size`.
2. Aplicar as quatro migrations `20261160000000`..`20261163000000` no projeto da loja (só o dono
   aplica em produção; `BEGIN; ... ROLLBACK;` antes, como manda o `CONTRIBUTING.md`).
3. Publicar as functions da branch pelo workflow (`cobranca` + as demais tocadas: ver `05`).
4. Testar no preview da Vercel os 18 passos da descrição do PR (o passo 15, PDV, exige as migrations).
5. Atualizar a descrição do PR (bullets de C5, pedidos-4, PWA, tooling) e marcar a Definition of Done.
