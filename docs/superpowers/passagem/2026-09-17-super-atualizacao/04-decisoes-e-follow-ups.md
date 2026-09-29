# Decisões já tomadas com o dono (não reabrir) e follow-ups anotados pelas revisões

## Decisões desta sessão (além das D1–D12 do plano)

- Chaves do Mercado Pago do lojista valem para uso REAL ("eu assumo o risco, de forma segura"): falha
  fechada quando o cofre falta; nunca cobra na conta da plataforma quando existe registro do lojista.
- O prompt que o lojista cola no agente do Mercado Pago é TEXTO EM BLOCOS, não JSON (perguntado e
  decidido em 17/09).
- Código de barras (C5): campo `codigoBarras` (null limpa / undefined não mexe, como o sku); formato
  `[A-Za-z0-9-]{4,64}` depois de aparar; duplicidade checada pela RPC no blur e dentro da tela; sem
  índice novo no cofre; "Tirar foto" em input separado com `capture`.
- Deploy das functions pelo GitHub (workflow `publicar-functions`, só `workflow_dispatch`, destino
  fechado, nunca `--no-verify-jwt`, nunca sem nome). Segredo `SUPABASE_ACCESS_TOKEN` no repositório.
- Concorrência: no máximo 2 workflows por vez nesta máquina.
- Tudo que o dono lê é em português.
- Formato do PDV: D1 (reaproveita `recebido_na_entrega` com rótulo por canal), D2 (cliente avulso
  na v1), D3 (sem rede recusa), D4 (desconto em reais com motivo), D6 (só admin) — já implementados.

## Follow-ups anotados (por área; nenhum bloqueia o PR)

PDV / catálogo
- `database.types.ts` sem `registrar_venda_presencial` e `buscar_por_codigo_barras` em `Functions`.
- `App.tsx` `handlePopState`: override por camada antes do gate de dirty (Voltar com cupom cheio).
- Recibo do PDV: cliente da resposta do banco, não da tela.
- `useVendaPresencial`: bipe com folha de variação aberta entra por trás da folha; recusa por teto em
  `variacao_escolhida` fecha a folha enquanto a por estoque zero mantém.
- `buscar_por_codigo_barras` com origem `produto` e variações: o `estoque` do pai é `p.estoque`, não a
  soma das variações (a tela decide "esgotado" pela soma; alinhar na RPC v2 se incomodar).
- Decodificador memoriza a promessa rejeitada do fallback (C2.1): tratar `falha_do_fallback` vindo de
  `detectar()`.
- Teste do precache (C2.4) deve conferir que `src/views/admin/AdminPdvView.tsx` existe.
- 23505 do `product_variants_sku_key` (SKU repetido de variação) ainda cai na mensagem genérica;
  tratar junto com a mensagem do código de barras em `mensagemAmigavelErroProduto`.
- C5.2 ANOTADO: teste do payload da variação; mensagem de duplicidade interna só sob o campo do
  produto; `await import("@/lib/supabase")` em `conferirCodigoNoBanco`.
- C4.4: teste tela→hook do chip "Balcão" (espião em `loadOrders`, índice 8 = `'presencial'`).
- C4.2: botão "Já estornei no Mercado Pago" em `AlertasCancelados.tsx` fixo para os dois canais;
  teste do confirm por canal; extrair predicado `fraseDizQueODinheiroEntrou` em `OrderDetail`.
- `AdminBannersView.tsx:965` tem a mesma mentira `.jpg`/`image/jpeg` do recorte (extrair
  `arquivoDaImagemRecortada` para `src/lib` e usar nas duas telas); `compressProductImage` devolve JPEG
  com o nome original; `useProducts.ts` deriva a extensão do bucket pelo nome.

Mercado Pago
- `salvar` ecoar `public_key_na_loja` (o teste X9 trava a assinatura de 1 arg; ajustar junto).
- JSDoc de `escreverNaFichaDaLoja` separado da função pela const `FICHA_NAO_EXISTE`.
- Teste que prova que `avaliarAssinatura` usa `camposDaAssinatura`.
- Painel do Dashboard lê o retrato do boot e não recebe eco do interruptor.
- Falta caso de teste para troca SÓ da Public Key (mutação `trocouPublicKey=false` passa).

Frete
- Teste fim a fim do ramo Frenet em `calculate-shipping`.
- Comentário/linha 5 de `src/lib/economia-do-frete.ts` desatualizados.
- Exportar `FRETE_GRATIS_DESLIGADO = 0` em `presets-de-frete-gratis.ts`; 3º caso de teste do visitante.
- Grades da vitrine: `freeShippingPreset` nos 6 `<ProductCard>` + `PremiumOffers`.

Tooling / CI
- `supabase/setup-cli@v1` roda em Node 20 (deprecado no runner): fixar versão do CLI ou trocar
  quando sair v2.
- `.size-limit.cjs` precisa medir `*.wasm` (com C2.5).
- Plano: linhas "Estado em 15/09" e "A13 em execução" precisam de atualização.
