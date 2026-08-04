# ADR 0001 — Apontar o ambiente Preview da Vercel para o banco de produção

- **Data:** 04/08/2026
- **Estado:** Aceito
- **Decide:** Gabriel
- **Cartão relacionado:** `INFRA-060`

## Contexto

O `pull_request_template.md:20` exige, na Definition of Done, "Testei no preview deploy da Vercel,
não só no localhost". **Nenhum PR consegue cumprir essa caixa hoje.**

Medido em 04/08/2026, ao tentar fechar o DoD do PR #128:

O preview daquele PR (`ickous-marketplace-a4kt3ut6a-gabriels-projects-5a19f6ee.vercel.app`) responde
HTTP 200, mas o app carrega direto na tela `🚨 ERRO DE AMBIENTE`, sem `VITE_SUPABASE_URL` nem
`VITE_SUPABASE_ANON_KEY`. Produção (`ickous-marketplace.vercel.app`) carrega o catálogo normalmente.

A causa saiu do `vercel env ls`, no projeto `gabriels-projects-5a19f6ee/ickous-marketplace`:

| Variável | Ambientes onde existe |
| --- | --- |
| `VITE_SUPABASE_URL` | Production |
| `VITE_SUPABASE_ANON_KEY` | Production |
| `VITE_VAPID_PUBLIC_KEY` | Production |
| `VITE_MAINTENANCE_MODE` | Production |
| `RESEND_API_KEY` | Development, Production |

**A palavra "Preview" não aparece em nenhuma linha.** Não é que faltem duas chaves: o ambiente
Preview não tem variável nenhuma, então todo preview builda vazio desde sempre.

Vale registrar o que isso *não* é: a tela de erro é o `src/lib/env.ts` funcionando como projetado —
falha alto e explicada, em vez da tela branca travada em 85% que o achado R1 descrevia. O defeito
está na configuração do ambiente, não no código.

## Opções consideradas

### Opção A — Estender as variáveis de produção para o Preview

Marcar as variáveis existentes também para Preview. Preview passa a funcionar hoje.

Custo: todo preview deploy passa a falar com o **banco de produção**. Um PR aberto vira um app
funcional escrevendo em cima de pedidos, estoque e cupons reais. Um teste de checkout no preview
debita estoque de verdade.

### Opção B — Criar um projeto Supabase de staging só para o Preview

Isolamento real: preview nunca toca produção.

Custo: é trabalho de verdade, não configuração. Exige recriar schema e seed — e o ledger de
migrations está fora de sincronia (121 linhas em `supabase_migrations.schema_migrations` contra 137
arquivos `.sql` em disco, medido em 04/08/2026), então "reconstruir o schema a partir do repositório"
é justamente o que a regra do `03-SETUP-AMBIENTE.md` proíbe. Vira dependência de `BANCO-030`/`BANCO-050`.

### Opção C — Remover a caixa do `pull_request_template.md`

Assumir que a verificação é local e parar de exigir o que não existe.

Custo: perde o único ambiente parecido com produção que o projeto tem, e some o sinal de que o
build de produção realmente sobe — que é exatamente a classe de defeito do achado R1.

## Decisão

**Opção A.** As variáveis `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` e `VITE_VAPID_PUBLIC_KEY`
passam a valer também para o ambiente Preview, e fica combinado por escrito que **preview não fecha
pedido**.

**Por quê:** a decisão é por restrição de tempo, e é para ser reconhecível como tal. O Netim entrou
no projeto em 30/07 e o critério de saída da Onda 0 inclui "o Netim tem um PR mergeado" — ele vai
esbarrar nesta caixa do DoD no primeiro PR. A Opção B é a resposta certa, mas depende da
reconciliação do ledger de migrations, que é uma onda inteira de trabalho. Travar o segundo dev por
semanas para evitar um risco que uma regra escrita já contém é caro demais.

O risco é aceito com olhos abertos, não subestimado: o catálogo tem 18 produtos ativos com estoque
baixo (vários com "apenas 1 restam"), então um pedido de teste indevido **é** visível e **é** chato.

### A regra que acompanha a decisão

Enquanto este ADR estiver em vigor:

1. **Nenhum preview deploy finaliza pedido.** Pode navegar, montar carrinho, cotar frete, abrir o
   checkout — não pode apertar o botão que cria a linha em `marketplace_orders`.
2. **Nenhum preview deploy escreve no admin.** Nada de salvar configuração de loja, criar cupom,
   editar produto ou disparar push a partir de um preview.
3. Quem precisar testar escrita, testa em `localhost` com o mesmo banco e limpa atrás de si — ou
   espera a Opção B.

Como a passagem por essa regra depende de disciplina e não de mecanismo, ela também é o gatilho de
revisão deste ADR (ver abaixo).

## Consequências

- Preview deploy passa a subir de verdade, e a caixa "Testei no preview deploy da Vercel" do
  `pull_request_template.md` passa a ser cumprível — para os dois devs.
- **Fica pior, e a gente aceitou:** existe um caminho novo pelo qual dados de produção podem ser
  alterados a partir de uma branch qualquer, sem revisão, por qualquer um com o link do preview.
  Os previews da Vercel são públicos por URL não listada.
- `VITE_VAPID_PUBLIC_KEY` entra junto porque, sem ela, o preview não exercita push — e push é
  justamente uma das áreas 🔴 do `06-ESTADO-ATUAL.md`. Isso **não** responde `PUSH-030`, que pergunta
  pelas chaves no ambiente da *edge function* `send-push`, não no build do front.
- `RESEND_API_KEY` **fica de fora** do Preview de propósito: é chave de envio de e-mail real, e
  preview mandando e-mail para cliente é um estrago que a regra acima não cobre.
- `INFRA-060` fica **parcialmente** respondido. Este ADR resolve "quais variáveis existem em qual
  ambiente da Vercel". Continuam em aberto as outras duas metades do cartão: a fonte de verdade
  entre os **11 arquivos `.env` na raiz**, e qual `DATABASE_URL` ficou viva depois da troca de 30/07
  — esta última já tem evidência levantada em 04/08 (todas apontam para o mesmo projeto
  `postgres.cafkrminfnokvgjqtkle`; a troca foi rotação de senha, não de alvo) e cabe num ADR próprio.
- Abrir cartão novo para a Opção B (projeto Supabase de staging), com `depende_de` em `BANCO-030`.
  Sem cartão, esta decisão vira permanente por esquecimento — que é o modo de falha real aqui.

**Desacordo registrado:** nenhum. Decisão tomada pelo Gabriel em 04/08/2026, com o levantamento
feito na mesma sessão.

## Quando revisar

Qualquer uma destas, o que vier primeiro:

- **Aparecer em `marketplace_orders` um pedido que ninguém reconhece**, ou o estoque de um produto
  cair sem venda correspondente. É o sinal de que a regra escrita não segurou.
- **`CHECKOUT-010` decidir por gateway de pagamento.** Preview apontando para produção com cobrança
  real ligada deixa de ser risco aceitável e passa a ser risco financeiro.
- **`BANCO-030` fechar.** Com o ledger reconciliado, a Opção B deixa de ser cara e passa a ser a
  escolha óbvia.

## Cartões desbloqueados por esta decisão

- `INFRA-060` — parcialmente; ver Consequências.

Cartões a abrir por causa dela:

- Um cartão `infra` para a Opção B (projeto Supabase de staging para o ambiente Preview).
