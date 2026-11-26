# Desfazer pelo livro de registro (versão antiga de pedido, produto, cupom, caixa e configuração)

> Escrito em 26/11/2026 junto com a migration
> `supabase/migrations/20261510000000_o_livro_de_registro_guarda_a_versao_antiga.sql`.
> Desde ela, antes de uma linha de 17 tabelas de dinheiro ser **alterada** ou **apagada**, o banco guarda a
> versão antiga em `public.livro_de_registro` por **90 dias**: na alteração, só as colunas que mudaram, com o
> valor de antes; na exclusão, a linha inteira. Este roteiro usa essas versões para **achar** o que mudou,
> **ver o valor** de uma linha num instante, **restaurar** uma linha apagada e **desfazer** uma transação
> inteira (por exemplo, um SQL em massa errado).
>
> O SQL dos blocos abaixo foi **ensaiado**: `tests/banco/o-livro-de-registro-desfazer-ensaio-viva.cjs` lê estes
> mesmos blocos deste arquivo e roda contra um banco de teste com todas as migrations, em ENSAIO e valendo.

## Regras que não se negociam

1. **Mudar dado real só com o "pode" do dono, a cada vez.** Os blocos que escrevem (`restaurar-apagada` e
   `desfazer-transacao`) nascem em **ENSAIO**: rodam tudo e terminam com o erro "ENSAIO (nada foi gravado)",
   que desfaz tudo e mostra o que mudaria. Leve esse texto ao dono. Só depois do "pode", troque
   `v_confirmar boolean := false;` por `true` e rode de novo.
2. **Uma loja por vez.** Cada loja tem o banco dela; o livro de uma não vale para outra.
3. **Ler o livro é ler dado de cliente** (nome, telefone e endereço que estavam no pedido). Não copie o
   resultado para conversa, planilha ou print: olhe, decida, feche.
4. **O livro não é backup.** Ele não guarda o que nasceu (INSERT), não guarda as 17 tabelas inteiras, guarda
   só 90 dias e pode estar desligado (a chave `livro_de_registro_chave`). Se o que você procura não está nele,
   o caminho é o backup do Supabase, não este roteiro.

## As 17 tabelas

`marketplace_orders`, `marketplace_order_items`, `order_refunds`, `marketplace_order_payment_history`,
`devolucoes`, `devolucao_itens`, `produtos`, `product_variants`, `categorias`, `coupons`, `fornecedores`,
`fin_lancamentos`, `fin_contas`, `fin_categorias`, `store_config`, `config_pagamento_cartao`,
`politica_devolucao`. Qualquer outra tabela é recusada pelos blocos (PARADO).

## Antes de tudo: o livro está ligado?

No SQL Editor do Supabase da loja:

```
SELECT ligado, motivo, mudado_em, teto_linhas, teto_banco_mb FROM public.livro_de_registro_chave;
```

`ligado = false` com um `motivo` = alguém desligou (ou o disjuntor desligou porque o banco passou do teto).
Enquanto ele esteve desligado, nada foi guardado.

## Passo 1 — Achar o que mudou

Troque os quatro marcadores: a tabela (ou `''` para todas), o id da linha (ou `''` para todas), e o começo e
o fim da janela de tempo **com o fuso** (`2026-11-26 09:00-03`). Só lê; não muda nada.

```sql
-- BLOCO: achar
WITH p(tabela, linha_id, desde, ate) AS (
  VALUES ('COLE-A-TABELA', 'COLE-O-ID-DA-LINHA', 'COLE-O-INICIO', 'COLE-O-FIM')
)
SELECT l.id, l.quando, l.tabela, l.linha_id, l.operacao, l.transacao, l.quem, l.papel, l.titular, l.antes
  FROM public.livro_de_registro l
  CROSS JOIN p
 WHERE (p.tabela = '' OR l.tabela = p.tabela)
   AND (p.linha_id = '' OR l.linha_id = p.linha_id)
   AND l.quando >= p.desde::timestamptz
   AND l.quando < p.ate::timestamptz
 ORDER BY l.id;
```

Como ler: `operacao` U = alteração (o `antes` tem só as colunas que mudaram, com o valor de ANTES) e D =
exclusão (o `antes` é a linha inteira). `transacao` é o número da transação: tudo o que um mesmo comando ou
uma mesma gravação do app mudou tem o mesmo número — é ele que o passo 4 usa. `quem` é a conta logada que fez
(vazio = o painel do Supabase, um script ou o próprio banco) e `papel` é como ela entrou (`authenticated` = app,
`service_role` = função do servidor, `postgres` = SQL Editor).

## Passo 2 — Ver o valor de uma linha num instante

Troque a tabela, o id e o instante (com o fuso). Só lê. A resposta é a linha como estava naquele instante
(em JSON), ou vazia (`NULL`) se a linha estava apagada. **Limite:** o livro não anota INSERT; se a linha
nasceu depois do instante, a resposta mostra a primeira versão que existiu, e não "vazio".

```sql
-- BLOCO: valor-no-instante
CREATE OR REPLACE FUNCTION pg_temp.livro_valor_no_instante(p_tabela text, p_linha text, p_instante timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
AS $valor$
DECLARE
  v jsonb;
  r record;
BEGIN
  IF p_tabela NOT IN ('marketplace_orders', 'marketplace_order_items', 'order_refunds', 'marketplace_order_payment_history',
                      'devolucoes', 'devolucao_itens', 'produtos', 'product_variants', 'categorias', 'coupons', 'fornecedores',
                      'fin_lancamentos', 'fin_contas', 'fin_categorias', 'store_config', 'config_pagamento_cartao',
                      'politica_devolucao') THEN
    RAISE EXCEPTION 'PARADO: % nao e uma das 17 tabelas do livro.', p_tabela;
  END IF;
  -- A linha de agora; depois, da anotacao mais nova para a mais velha, volta cada mudanca feita DEPOIS do instante.
  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.id::text = $1', p_tabela) INTO v USING p_linha;
  FOR r IN SELECT l.operacao, l.antes FROM public.livro_de_registro l
            WHERE l.tabela = p_tabela AND l.linha_id = p_linha AND l.quando > p_instante
            ORDER BY l.id DESC LOOP
    IF r.operacao = 'D' THEN
      v := r.antes;
    ELSE
      v := COALESCE(v, '{}'::jsonb) || r.antes;
    END IF;
  END LOOP;
  RETURN v;
END
$valor$;
SELECT pg_temp.livro_valor_no_instante('COLE-A-TABELA', 'COLE-O-ID-DA-LINHA', 'COLE-O-INSTANTE'::timestamptz) AS valor;
```

## Passo 3 — Restaurar uma linha apagada

Troque a tabela e o id. Pega a versão da **última** exclusão dessa linha no livro e grava a linha de volta,
igual, pelos caminhos normais da tabela (os gatilhos dela rodam; se um deles recusar, nada muda).

- **Pais antes dos filhos.** Pedido antes do item do pedido, devolução antes do item da devolução, produto
  antes da variação, conta e categoria do caixa antes do lançamento. Se você tentar o filho primeiro, o bloco
  para (PARADO) e diz qual pai falta.
- **O que não volta:** tabelas fora das 17 que foram apagadas junto (por exemplo o custo do dia do item: ao
  voltar o item, o banco grava o custo de **hoje** do produto).
- Se a linha **já existe**, o bloco para (PARADO): restaurar por cima seria perder o que está lá. Para voltar
  um valor de uma linha que existe, use o passo 4.

```sql
-- BLOCO: restaurar-apagada
DO $restaurar$
DECLARE
  v_confirmar boolean := false; -- ENSAIO. So com o "pode" do dono: troque para true.
  v_tabela text := 'COLE-A-TABELA';
  v_linha text := 'COLE-O-ID-DA-LINHA';
  v_antes jsonb;
  v_quando timestamptz;
  v_existe boolean;
  v_colunas text;
  v_rel text;
BEGIN
  IF v_tabela NOT IN ('marketplace_orders', 'marketplace_order_items', 'order_refunds', 'marketplace_order_payment_history',
                      'devolucoes', 'devolucao_itens', 'produtos', 'product_variants', 'categorias', 'coupons', 'fornecedores',
                      'fin_lancamentos', 'fin_contas', 'fin_categorias', 'store_config', 'config_pagamento_cartao',
                      'politica_devolucao') THEN
    RAISE EXCEPTION 'PARADO: % nao e uma das 17 tabelas do livro. Nada foi mudado.', v_tabela;
  END IF;
  SELECT l.antes, l.quando INTO v_antes, v_quando
    FROM public.livro_de_registro l
   WHERE l.tabela = v_tabela AND l.linha_id = v_linha AND l.operacao = 'D'
   ORDER BY l.id DESC LIMIT 1;
  IF v_antes IS NULL THEN
    RAISE EXCEPTION 'PARADO: o livro nao tem a exclusao de % %. Nada foi mudado.', v_tabela, v_linha;
  END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I t WHERE t.id::text = $1)', v_tabela) INTO v_existe USING v_linha;
  IF v_existe THEN
    RAISE EXCEPTION 'PARADO: % % ja existe; restaurar por cima perderia o que esta la. Nada foi mudado.', v_tabela, v_linha;
  END IF;
  -- Todas as colunas de hoje, menos as calculadas pelo banco; o que a versao antiga nao tinha fica com o padrao da coluna.
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_colunas
    FROM pg_attribute a
   WHERE a.attrelid = format('public.%I', v_tabela)::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attgenerated = '' AND v_antes ? a.attname;
  BEGIN
    EXECUTE format('INSERT INTO public.%I (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1)',
                   v_tabela, v_colunas, v_colunas, v_tabela) USING v_antes;
  EXCEPTION
    WHEN foreign_key_violation THEN
      RAISE EXCEPTION 'PARADO: % % aponta para um pai que nao existe mais (%). Restaure o pai primeiro (pais antes dos filhos). Nada foi mudado.',
        v_tabela, v_linha, SQLERRM;
  END;
  v_rel := format(E'%s %s restaurada com a versao apagada em %s\n', v_tabela, v_linha, v_quando);
  IF NOT v_confirmar THEN
    RAISE EXCEPTION '%', E'ENSAIO (nada foi gravado). Isto e o que mudaria:\n' || v_rel;
  END IF;
  RAISE NOTICE '%', E'FEITO:\n' || v_rel;
END
$restaurar$;
```

## Passo 4 — Desfazer uma transação inteira

Troque o número da transação (a coluna `transacao` do passo 1). O bloco volta **todas** as mudanças dela, da
mais nova para a mais velha: alteração volta o valor antigo das colunas que mudaram; exclusão grava a linha de
volta (pais antes dos filhos, pela ordem da própria transação).

- **Conflito para tudo.** Se alguma linha que a transação mudou foi mudada **de novo depois**, por outra
  transação, desfazer apagaria essa mudança posterior. O bloco para (PARADO), lista cada conflito
  (`tabela id`) e não muda nada. Aí a decisão é do dono, linha por linha, com o passo 2 na mão.
- **O que não volta:** linha que a transação **criou** (o livro não anota INSERT: ela fica; procure pelo
  `created_at` e decida com o dono) e o que a transação mudou fora das 17 tabelas.
- Desfazer também é uma mudança: ela entra no livro com outro número de transação.

```sql
-- BLOCO: desfazer-transacao
DO $desfazer$
DECLARE
  v_confirmar boolean := false; -- ENSAIO. So com o "pode" do dono: troque para true.
  v_transacao bigint := 'COLE-A-TRANSACAO'::bigint;
  v_ultimo bigint;
  v_conflitos text;
  r record;
  v_set text;
  v_colunas text;
  v_n integer;
  v_rel text := '';
BEGIN
  SELECT max(l.id) INTO v_ultimo FROM public.livro_de_registro l WHERE l.transacao = v_transacao;
  IF v_ultimo IS NULL THEN
    RAISE EXCEPTION 'PARADO: o livro nao tem nada da transacao %. Nada foi mudado.', v_transacao;
  END IF;
  -- Conflito: a mesma linha mudou depois, em outra transacao.
  SELECT string_agg(DISTINCT l.tabela || ' ' || l.linha_id, ', ') INTO v_conflitos
    FROM public.livro_de_registro l
   WHERE l.id > v_ultimo AND l.transacao IS DISTINCT FROM v_transacao
     AND EXISTS (SELECT 1 FROM public.livro_de_registro x
                  WHERE x.transacao = v_transacao AND x.tabela = l.tabela AND x.linha_id = l.linha_id);
  IF v_conflitos IS NOT NULL THEN
    RAISE EXCEPTION 'PARADO: estas linhas mudaram de novo depois da transacao % (desfazer apagaria a mudanca posterior): %. Nada foi mudado.',
      v_transacao, v_conflitos;
  END IF;
  FOR r IN SELECT l.id, l.tabela, l.linha_id, l.operacao, l.antes
             FROM public.livro_de_registro l WHERE l.transacao = v_transacao ORDER BY l.id DESC LOOP
    IF r.operacao = 'U' THEN
      SELECT string_agg(format('%I = v.%I', a.attname, a.attname), ', ' ORDER BY a.attnum) INTO v_set
        FROM pg_attribute a
       WHERE a.attrelid = format('public.%I', r.tabela)::regclass AND a.attnum > 0 AND NOT a.attisdropped
         AND a.attgenerated = '' AND r.antes ? a.attname;
      EXECUTE format('UPDATE public.%I t SET %s FROM jsonb_populate_record(NULL::public.%I, $1) v WHERE t.id::text = $2',
                     r.tabela, v_set, r.tabela) USING r.antes, r.linha_id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n <> 1 THEN
        RAISE EXCEPTION 'PARADO: % % nao existe mais (nao da para voltar o valor). Nada foi mudado.', r.tabela, r.linha_id;
      END IF;
      v_rel := v_rel || format(E'%s %s: voltou %s\n', r.tabela, r.linha_id, v_set);
    ELSE
      SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_colunas
        FROM pg_attribute a
       WHERE a.attrelid = format('public.%I', r.tabela)::regclass AND a.attnum > 0 AND NOT a.attisdropped
         AND a.attgenerated = '' AND r.antes ? a.attname;
      BEGIN
        EXECUTE format('INSERT INTO public.%I (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1)',
                       r.tabela, v_colunas, v_colunas, r.tabela) USING r.antes;
      EXCEPTION
        WHEN unique_violation THEN
          RAISE EXCEPTION 'PARADO: % % ja existe de novo (nao da para restaurar por cima). Nada foi mudado.', r.tabela, r.linha_id;
        WHEN foreign_key_violation THEN
          RAISE EXCEPTION 'PARADO: % % aponta para um pai que nao existe mais (%). Restaure o pai primeiro. Nada foi mudado.',
            r.tabela, r.linha_id, SQLERRM;
      END;
      v_rel := v_rel || format(E'%s %s: linha apagada restaurada\n', r.tabela, r.linha_id);
    END IF;
  END LOOP;
  IF NOT v_confirmar THEN
    RAISE EXCEPTION '%', E'ENSAIO (nada foi gravado). Isto e o que mudaria:\n' || v_rel;
  END IF;
  RAISE NOTICE '%', E'FEITO:\n' || v_rel;
END
$desfazer$;
```

## Depois

Rode de novo o passo 1 na mesma janela: as mudanças desfeitas aparecem como anotações novas (com outro número
de transação). Confira no painel da loja o pedido, o produto ou o cupom que voltou.
