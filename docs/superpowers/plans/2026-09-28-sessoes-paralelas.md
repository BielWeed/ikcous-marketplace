# Sessões paralelas da próxima atualização (28/09/2026)

Pedidos do dono (Gabriel) feitos em 28/09/2026, depois do PR #666. Cada frente roda numa sessão
própria, na nuvem, e entrega uma branch com PR **rascunho** contra `proxima/base`. Quem junta tudo é
a sessão coordenadora (a que escreveu este arquivo).

## Regras comuns a todas as sessões

- A fonte de instruções é o [AGENTS.md](../../../AGENTS.md): escopo, domínio, políticas do dono,
  verificação e mapa de risco. Leia antes de qualquer código.
- Responda e escreva em português (commits em Conventional Commits, escopos de `.commitlintrc.json`).
- Ponto de partida: `git fetch origin proxima/base` e crie/reinicie a sua branch de trabalho a partir
  de `origin/proxima/base`. Faça `git fetch` de novo antes de começar: esta base pode ganhar docs
  (plano do layout de computador, relatórios de investigação) depois que você abriu a sessão.
- Entrega: push da sua branch e PR **rascunho** com base `proxima/base` (nunca contra a branch
  padrão nem contra produção). Nunca mescle nada. No corpo do PR: o que mudou, a verificação com
  saída real, prints, e o que ficou de fora.
- **Quem escreveu não revisa o próprio trabalho.** Antes de dar a frente por pronta, rode o subagente
  `revisor` (e também o `revisor-risco` se tocar migration, RLS, SECURITY DEFINER, edge function,
  auth, checkout/pagamento ou service worker). Corrija os achados e rode a revisão de novo até
  PASSA. Registre os vereditos no PR.
- Verificação mínima: `npm run typecheck`; vitest dos arquivos tocados e das telas vizinhas;
  `npm run lint:ratchet` (tetos: eslint 453 avisos / biome 15 erros — não pode subir);
  `npm run lint:links` se mexer em `.md`; `npm run build` com
  `NODE_ENV=production IKCOUS_IDENTITY_MODE=fixture` e `npm run size` (JS da cliente ≤ 550 kB,
  painel ≤ 450 kB).
- Proibido:
  - `supabase db push` ou aplicar qualquer coisa no banco da loja (só o dono aplica, pelo workflow
    `aplicar-migrations.yml`);
  - `npm run dev` apontando para o banco real — para ver telas, use backend falso (Playwright com
    rotas interceptadas; ver `tests/e2e/kit-jornadas.ts`);
  - ler `.env*` ou `vapid_keys.json`; logar token, dado de cartão, CPF, e-mail ou telefone;
  - `--no-verify`, `git checkout -- <arquivo>`, `git stash` sem tag, reescrever histórico de
    branch alheia;
  - ligar o cartão pelo app (está desligado por decisão do dono);
  - mexer em arquivo que é de outra frente (lista abaixo). Precisou? Descreva no PR em vez de mexer.
- Migration (se inevitável): sem `BEGIN/COMMIT` no arquivo, com rollback manual, prova num
  Postgres 17 efêmero (`tests/banco/*-viva.cjs` via `rodar-isolado.cjs`), e front antigo tem de
  continuar funcionando com o banco novo.
- Chromium já está em `/opt/pw-browsers` — não rode `playwright install`.

## Frentes

### A. Venda no balcão: o pagamento, com PIX abrindo na hora

Tela **Vender** do painel (Bipar produto → Subtotal → Cliente (opcional) → Fechar venda).

> "Se a pessoa selecionar que vai pagar no PIX — como a gente tem integração — tem que abrir o PIX
> ali para ser pago. E todas as coisas do pagamento dessa parte: saber certinho como está, se está
> funcionando certo. Investigar, verificar, e se tiver qualquer coisa errada, fazer os upgrades,
> corrigir, construir."

1. Investigue ponta a ponta com arquivo:linha: a tela Vender, o "Fechar venda" (formas, troco,
   desconto, cliente, parcelas), a RPC/migration da venda no balcão, e para onde a venda vai
   (Pedidos, Financeiro — `fin__forma_do_pedido`, Extrato, Caixa da loja física —, CRM canal
   presencial, Início). Liste defeitos com severidade (venda paga sem dinheiro entrar, forma errada
   no Financeiro, dinheiro fora do caixa, troco, centavos, toque duplo, estoque, cancelamento).
   Se existir `docs/superpowers/specs/2026-09-28-balcao-pix-investigacao.md` na `proxima/base`,
   comece por ele.
2. Construa o PIX no balcão: QR grande para o cliente escanear + copia-e-cola, valor, contagem
   regressiva, "Aguardando pagamento…", confirmação automática quando o pagamento for confirmado
   (reuse `criar-pagamento` / `webhook-mercadopago` / `confirmar_pagamento`, com a mesma
   idempotência), trocar a forma ou cancelar sem perder a venda. Defina o que acontece com estoque,
   Financeiro e caixa enquanto espera e se expirar. Cartão no balcão é maquininha (registro manual).
3. Corrija os defeitos achados. Mapa de risco: pagamento → `revisor` + `revisor-risco`.

Arquivos desta frente: a tela Vender e seus componentes/hooks, a RPC da venda no balcão, e o que o
PIX do balcão exigir nas edges de pagamento.

### B. Cupons no checkout: visual novo e cupons disponíveis

Seção "VANTAGEM EXCLUSIVA / Cupom de desconto" do checkout.

> "Melhorar o design de layout dela e ela ser mais inteligente: detectar os cupons que estão
> liberados para uso, inclusive os exclusivos, tudo bonitinho, para que seja mais claro e o cliente
> possa usar os cupons."

1. Investigue como o cupom funciona hoje (tabelas, RPC de validação, cupom exclusivo, RLS/grants,
   como o desconto entra no pedido, rateio em devoluções). Se existir
   `docs/superpowers/specs/2026-09-28-cupons-checkout-investigacao.md` na `proxima/base`, comece
   por ele.
2. Mostre os cupons que o cliente pode usar, em cards: descrição legível ("10% OFF acima de
   R$ 100"), validade, "Aplicar" com um toque, melhor cupom em destaque, selo "Exclusivo para você",
   "faltam R$ X" quando ainda não vale para o carrinho, valor economizado e "Remover" depois de
   aplicar. O campo para digitar código continua.
3. **Nada de vazar cupom:** só aparecem cupons que o lojista marcou para mostrar no checkout (crie
   a opção no painel ao criar/editar cupom) e os exclusivos DO próprio cliente logado; nunca
   exclusivos de outros nem códigos "secretos". A validação final continua no servidor.
4. Só a seção do cupom muda no celular; o resto do checkout fica igual. Mapa de risco (checkout,
   provável RPC nova) → `revisor` + `revisor-risco`.

Arquivos desta frente: o componente da seção de cupom do checkout (a frente D5 só posiciona a
seção no layout de computador, não mexe dentro dela), hooks/serviço de cupom, RPC/migration de
cupom, tela de cupons do painel.

### D1–D8. Layout de computador do app do cliente

> "No computador, isso deveria parecer um layout de site profissional de qualidade alta. Redesenhar
> todas as telas para o computador. Mas o layout do celular deve se manter EXATAMENTE como está."

**Só comece uma frente D quando `docs/superpowers/specs/2026-09-28-app-cliente-desktop-design.md`
e `docs/superpowers/plans/2026-09-28-app-cliente-desktop.md` existirem na `proxima/base`** (a
coordenadora avisa o dono). Eles trazem a direção de design, o contrato entre frentes (cabeçalho,
container, grade), o dono de cada arquivo e as tarefas. Regras fixas:

- Layout novo só a partir de `lg` (1024px). Abaixo disso, **zero mudança**: só classes com prefixo
  `lg:`/`xl:`/`2xl:` ou peças só-desktop escondidas por CSS abaixo de `lg`.
- Prova obrigatória: o harness visual da `proxima/base` (ver o plano) com diff pixel a pixel = 0 em
  360/375/390/414 contra o baseline, em todas as telas da sua frente; prints desktop em
  1024/1280/1440/1920 no PR.
- Frentes (valem as do plano, seção A "Mapa de dono"): D1 = F1 casca (o resto da F1 depois da
  Onda 0); D2 = F2 vitrine (Início + card); D3 = F3 produto; D4 = F4 busca e Favoritos; D5 = F5
  carrinho e Meus pedidos; D6 = F6 checkout e sucesso (RISCO; o cupom é da frente B); D7 = F7
  minha conta; D8 = F8 pedido, notificações, sobre a loja e login.
- Harness visual e contrato (Onda 0) ficam na `proxima/base`; se não estiverem lá, pare e avise no
  PR em vez de improvisar.

## Sessões no Codex (frentes D1–D8)

As frentes D1–D8 (layout de computador) rodam em sessões do **Codex**, isoladas das sessões do
Claude. Quem escreveu não revisa: o Codex escreve, a coordenação (Claude) revisa, mede e junta.

1. **Pré-condição.** Rode `git fetch origin proxima/base` e confira que existem, em
   `origin/proxima/base`, os arquivos `src/hooks/useTelaDeComputador.ts` (Onda 0, contrato) e
   `scripts/visual/vitrine/README.md` (harness visual). Se algum faltar, **não mude nada**: responda
   "A base ainda não está pronta (Onda 0/harness)" e pare.
2. **Branch.** `codex/desktop-fN-<nome>` (ex.: `codex/desktop-f3-produto`), criada a partir de
   `origin/proxima/base`. Push só nela. Nunca em `proxima/base`, `claude/*`, na branch padrão ou em
   branch de outra frente.
3. **PR rascunho** com base `proxima/base`, título `[Codex] FN — <frente>`, com: tarefas feitas,
   verificação com saída real, harness (diff do celular por tela × largura; prints desktop
   1024/1280/1440/1920) e o que ficou de fora. Escreva "Aguardando revisão independente da
   coordenação". Não se aprove, não mescle.
4. **Escopo.** Só as tarefas e os arquivos da sua frente no
   [plano](2026-09-28-app-cliente-desktop.md) (seção A e seção E), com os contratos da seção B.
   Nunca toque: arquivos de outra frente; `src/components/ui/custom/CouponInput.tsx` e componentes
   de cupom (frente B); a tela Vender/PDV (frente A); `supabase/`, migrations e edge functions.
5. **Celular intacto.** Só tokens `lg:`/`xl:`/`2xl:` ou peças só-desktop escondidas abaixo de
   `lg`. Prova: `scripts/visual/vitrine` com diff = 0 px em 360/375/390/414 nas telas da frente.
   Sem Chromium e sem conseguir instalar, diga isso no PR — a coordenação roda o harness.
6. **Verificação:** V1 em toda tarefa e V2 no fim da frente (seção D do plano). Commits em
   Conventional Commits com escopo de `.commitlintrc.json`. Todas as regras comuns do topo deste
   arquivo valem (nada de banco, `npm run dev` contra o banco real, `.env*`, `--no-verify`).
