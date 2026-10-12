
# Plano — Painel simples

> Spec: `docs/superpowers/specs/2026-10-09-painel-simples-design.md`. Ciclo de `/executar-plano`: implementador novo por tarefa, TDD (o teste falha primeiro), revisor nas duas etapas, revisor-risco só em RISCO, saída colada.
> **Travas** (vão em todo brief): nunca `git stash/checkout/restore/clean/reset`; commit só por caminho (`git commit -- <arquivos>`); arquivo compartilhado (`src/App.tsx`, `src/types/index.ts`, `src/config/rotas.ts`, `database.types.ts`, `.size-limit.cjs`, `.lint-baseline.json`) não entra em frente paralela, vira pedido ao integrador.
> **Verificação por tarefa:** `npx vitest run <teste>` + `npm run typecheck`.
> **Fim de cada onda:** `npm run typecheck && npm test && npm run lint:rapido && npm run lint:ratchet`, e mais `npm run build && npm run size` quando indicado. Cole a saída.
> **Etiquetas:** ROTINA = fora do mapa de risco · RISCO = migration, RLS, SECURITY DEFINER, functions, pagamento, SW ou assinatura consumida por outro módulo.
> **Rotas:** nenhuma é criada ou removida. `rotas-de-entrada.test.ts` (43/24) e `hospedagem-rotas.test.ts` (67/134) **não mudam**; se mudarem, algo saiu do plano.

## Ordem e paralelismo

| Onda | Valor × risco | Território (faixa de arquivos) | Paraleliza com |
|---|---|---|---|
| A — Consertos imediatos | alto × baixo | A1: `AdminWhatsAppConfigView.tsx` · A2–A3: `AdminLayout.tsx` · A4–A5: `src/lib/loja-pronta.ts`, `dashboard/LojaProntaEEstoqueBaixo.tsx`, `AdminDashboardView.tsx` | as 3 frentes entre si e com a B |
| B — Fundação | habilita o resto × baixo | só arquivos novos em `src/components/admin/primitivos/`, `src/lib/`, `src/config/nomes-do-painel.ts`, testes novos; B5 toca `AdminHelpModal.tsx` | A |
| C — Navegação e nomes | alto × baixo | `AdminLayout.tsx`, `AdminArea.tsx`, `App.tsx` (integrador), `pai-da-tela-do-admin.ts`, `dashboard/*Banners.tsx`, `AdminSettingsView.tsx`, cabeçalhos das views | D, E1/E3 |
| D — Minha loja fonte única | alto × médio | `AdminAboutStoreView.tsx`, `minha-loja/*` (novo), `settings/IdentitySettingsSection.tsx`, `settings/PoliticaDeDevolucaoSection.tsx`, `shipping/FreteNacionalBloco.tsx`, `shipping/FreteLocalBloco.tsx`, `AdminShippingView.tsx`, `AdminWhatsAppConfigView.tsx` | C (menos D11, que espera C8) |
| E — Primeiros passos | alto × baixo | `src/lib/loja-pronta.ts`, `inicio/*`, `LojaProntaEEstoqueBaixo.tsx`; E2 toca `AdminShippingView.tsx` (depois da D); E5 toca `AdminSettingsView.tsx` (depois da C) | C, D (E1/E3) |
| F — Um número, um conceito | médio × baixo | `src/lib/pedidos-para-preparar.ts`, `AdminLayout.tsx`, `AdminOrdersView.tsx`, `inicio/*`, `useProducts.ts`, `AdminUserDetailView.tsx` | G (por tela) |
| G — Linguagem por tela | médio × baixo | uma frente por tela: crm/* · financeiro/* · settings/MercadoPago+StatusPagamentoPix · HistoricoCotacoes · PoliticaDeDevolucao · Identity · AdminLayout (selo) | entre si |
| H — Telas gigantes | médio × médio | ProductForm · Push · Banners · Frete+Ajustes | entre si (Frete+Ajustes é uma frente só); ProductForm junto com G3 |
| I — Banco (RISCO, opcional) | depende de P3, P1 | migrations, `tests/banco/` | nada (serial) |

Pontos de conflito: `AdminLayout.tsx` (A2, A3, C9, F2, G7), `AdminArea.tsx` (C8, D11), `App.tsx` (C7), `AdminSettingsView.tsx` (C5, E5, H5, H6) e `AdminShippingView.tsx` (D6, D7, E2, H5) são sempre seriais, na ordem desta lista.

---

## Onda A — Consertos que não esperam (publicável sozinha)

**A1 · Atendimento para de regravar o horário** — ROTINA · dep. —
- **Arquivos:** `src/views/admin/AdminWhatsAppConfigView.tsx`; teste novo `tests/front/atendimento-nao-grava-horario.test.tsx`.
- **Teste que falha:** renderiza a view com `useStore` mockado (`businessHours: "Seg a sex 9h–18h"`), muda o WhatsApp, clica em Salvar. `updateConfig` deve receber um objeto **sem** a chave `businessHours`; o bloco 2 mostra o horário como texto e tem o botão "Alterar em Minha loja", que chama `onNavigate("admin-about-store")`.
- **Implementação:**
  - tirar `businessHours` do payload (linhas ~791-797), do `isDirty` (~709-713) e de `temAlteracaoNaoSalva`;
  - trocar o `LocalBufferedInput` do bloco 2 (~925-946) por leitura + botão.
- **Atualizar:** `ajustes-horario-de-atendimento.test.tsx`, `atendimento-formulario-direto.test.tsx`, `admin-visual-canais-avisar.test.tsx` (o bloco 2 deixa de ter campo).
- **Verificação:** `npx vitest run tests/front/atendimento-nao-grava-horario.test.tsx tests/front/ajustes-horario-de-atendimento.test.tsx tests/front/admin-visual-canais-avisar.test.tsx`

**A2 · Barra inferior com nome acessível** — ROTINA · dep. —
- **Arquivos:** `src/components/layouts/AdminLayout.tsx` (map de `navItems`, ~1245-1320); teste novo `tests/front/admin-barra-tem-nome-acessivel.test.tsx`.
- **Teste que falha:**
  - `getByRole("button",{name:"Início"|"Pedidos"|"Produtos"|"Clientes"|"Ajustes"})` dentro do `nav` móvel;
  - o rótulo não tem a classe `hidden`;
  - o selo de pedidos entra no nome ("Pedidos, 3 para preparar").
- **Implementação:**
  - `aria-label` em cada botão;
  - rótulo sempre visível com `text-[11px]` e sem `hidden sm:inline-block` (cabe em 360px com `flex-1`; o Vender continua `shrink-0`);
  - selo com `aria-hidden` e o número no `aria-label`.
- **Atualizar:** `admin-barra-nao-mente-a-aba-do-pdv.test.tsx`, se ele consultar o rótulo pela classe.
- **Verificação:** `npx vitest run tests/front/admin-barra-tem-nome-acessivel.test.tsx tests/front/admin-barra-nao-mente-a-aba-do-pdv.test.tsx`

**A3 · Voltar e sino com 44px** — ROTINA · dep. A2
- **Arquivos:** `AdminLayout.tsx` (cabeçalho móvel, ~1015-1120); teste novo `tests/front/admin-cabecalho-alvos-44.test.tsx`.
- **Teste que falha:** o botão Voltar e o sino (`name:"Notificações"`) têm `min-h-11` e `min-w-11` (o visual pode continuar `h-7` por dentro).
- **Implementação:** envoltório clicável com `min-h-11 min-w-11` e o ícone centralizado; o desenho fica igual.
- **Verificação:** `npx vitest run tests/front/admin-cabecalho-alvos-44.test.tsx tests/front/sino-do-painel-leva-as-notificacoes.test.tsx`

**A4 · Função pura da lista de "loja pronta" (3 itens de hoje + o conserto do pagamento)** — ROTINA · dep. —
- **Arquivos:** novo `src/lib/loja-pronta.ts`; teste novo `tests/front/loja-pronta.test.ts`.
- **Teste que falha:**
  - `formasNaEntrega:["cash"], pixOk:false` → o item `recebe` vem `feito`;
  - `formasNaEntrega:[], pixOk:false` → `pendente`;
  - CEP `"01310100"` e `"01310-100"` → `feito`; `"0131"` → `pendente`;
  - `configCarregando` → `carregando`.
- **Implementação:** `passosDaLojaPronta({originCep, pixOk, formasNaEntrega, produtos, configCarregando, produtosCarregando})` → `ItemDoChecklist[]`, com rótulos "Como você recebe" / "Endereço da loja (CEP)" / "Primeiro produto à venda".
- **Verificação:** `npx vitest run tests/front/loja-pronta.test.ts`

**A5 · O cartão do Início usa a função** — ROTINA · dep. A4
- **Arquivos:** `src/components/admin/dashboard/LojaProntaEEstoqueBaixo.tsx`, `src/views/admin/AdminDashboardView.tsx` (passa `config.formasPagamentoEntrega`).
- **Teste que falha:** em `tests/front/dashboard-diz-o-que-falta-para-vender.test.tsx`, um caso novo: uma loja só com "na entrega" **não** mostra "Configurar pagamento PIX".
- **Implementação:** trocar o array local pela função.
- **Atualizar:** `dashboard-cep-oito-digitos.test.tsx` (rótulos).
- **Verificação:** `npx vitest run tests/front/dashboard-diz-o-que-falta-para-vender.test.tsx tests/front/dashboard-cep-oito-digitos.test.tsx`

**Fim da Onda A:** `npm run typecheck && npm test && npm run lint:rapido && npm run lint:ratchet`.

---

## Onda B — Fundação (arquivos novos; publicável sem efeito visível, exceto a B5)

**B1 · Nomes e portas** — ROTINA · dep. —
- **Arquivos:** novo `src/config/nomes-do-painel.ts` (`NOMES_DO_PAINEL: Record<AdminView,string>`, `PORTAS_DO_PAINEL: Record<Aba, readonly View[]>`, `APELIDOS`); teste novo `tests/front/nomes-e-portas-do-painel.test.ts`.
- **Teste que falha:**
  - todo `admin-*` de `TELAS_DE_ENTRADA` (menos `admin-login`) tem nome não vazio;
  - toda sub-view que não é apelido (`admin-whatsapp-config`, `admin-shipping-national`, `admin`), nem filha de lista (`admin-product-form`, `admin-coupon-form`, `admin-user-detail`), nem `admin-pdv`/`admin-notifications` aparece em exatamente uma aba;
  - valores conforme a tabela do §3 da spec.
- **Verificação:** `npx vitest run tests/front/nomes-e-portas-do-painel.test.ts`

**B2 · Glossário + guarda de jargão com teto** — ROTINA · dep. —
- **Arquivos:** novo `src/lib/glossario-do-painel.ts`; novos `tests/front/painel-sem-jargao.test.ts` e `tests/front/painel-sem-jargao.teto.json`.
- **Teste que falha:**
  - o teste varre `src/views/admin/**` e `src/components/admin/**`, ignorando linhas de comentário (`//`, `*`), em busca dos termos proibidos da tabela;
  - a contagem por arquivo não pode passar do teto;
  - primeiro rodar com o teto vazio (falha), medir e gravar o teto real.
- **Verificação:** `npx vitest run tests/front/painel-sem-jargao.test.ts`

**B3 · Erro amigável único** — ROTINA · dep. —
- **Arquivos:** novo `src/lib/erro-do-painel.ts`; `src/lib/crm.ts` (passa a reexportar `mensagemDeErroDoPainel`); teste novo `tests/front/erro-do-painel.test.ts`.
- **Teste que falha:**
  - PGRST202 → frase de "ainda não ativado";
  - 42501 → frase de permissão;
  - `TypeError: Failed to fetch` → "Sem conexão — confira a internet e tente de novo.";
  - 22023 com mensagem em português passa direto;
  - mensagem com "relation", "function", "supabase" ou "migration" nunca aparece.
- **Verificação:** `npx vitest run tests/front/erro-do-painel.test.ts tests/front/crm-e-inicio-funcoes-puras.test.ts`

**B4 · Régua visual com teto** — ROTINA · dep. —
- **Arquivos:** novos `tests/front/regua-visual-do-painel.test.ts` e `tests/front/regua-visual-do-painel.json`.
- **Teste que falha:** conta por arquivo os padrões do §7 da spec; falha se algum passar do teto (primeiro com o teto vazio; depois gravar o medido).
- **Verificação:** `npx vitest run tests/front/regua-visual-do-painel.test.ts`

**B5 · `FolhaDoPainel` + ajuda acessível** — ROTINA · dep. —
- **Arquivos:** novo `src/components/admin/primitivos/FolhaDoPainel.tsx` (sobre `@radix-ui/react-dialog`, sem importar `ui/dialog.tsx`); `src/components/admin/AdminHelpModal.tsx` (mesmas props); teste novo `tests/front/ajuda-do-painel-e-dialogo.test.tsx`.
- **Teste que falha:**
  - aberta, `getByRole("dialog",{name:título})`;
  - Esc chama `onClose`;
  - o botão de fechar tem nome "Fechar";
  - "Entendi" continua fechando;
  - a classe `admin-modal-open` continua no `body`.
- **Atualizar:** `admin-orders-guia-do-pagamento-que-nao-fechou.test.tsx` e `porta-de-avisar-clientes-mora-em-clientes.test.tsx`, se procurarem "✕".
- **Verificação:** `npx vitest run tests/front/ajuda-do-painel-e-dialogo.test.tsx tests/front/admin-orders-guia-do-pagamento-que-nao-fechou.test.tsx`

**B6 · `SeloDeStatus`, `EstadoVazio`, `EsqueletoDaLista`** — ROTINA · dep. —
- **Arquivos:** novos em `src/components/admin/primitivos/`; teste novo `tests/front/primitivos-do-painel.test.tsx`.
- **Teste que falha:**
  - o selo tem ícone `aria-hidden` + texto visível (a cor não é a única pista);
  - o vazio tem título, frase e ação opcional;
  - o esqueleto tem `aria-busy` e um texto `sr-only` "Carregando…".
- **Verificação:** `npx vitest run tests/front/primitivos-do-painel.test.tsx`

**B7 · `SecaoRecolhivel`** — ROTINA · dep. —
- **Arquivos:** novo `primitivos/SecaoRecolhivel.tsx`; o mesmo teste da B6 (casos novos).
- **Teste que falha:**
  - `aria-expanded` alterna;
  - com `temErro` vira aberta;
  - o conteúdo fechado **continua montado** (`hidden`), para nada se perder ao digitar — mesma regra do `PainelRecolhivel` do Frete.
- **Verificação:** igual à B6.

**B8 · `AtalhosDaAba`, `AlternadorDeTelas`, `AcaoDoPainel`** — ROTINA · dep. B1
- **Arquivos:** novos em `primitivos/`; teste novo `tests/front/atalhos-da-aba.test.tsx`.
- **Teste que falha:**
  - `<AtalhosDaAba aba="clientes">` mostra "Perguntas e avaliações" e "Avisar clientes" com os nomes de `NOMES_DO_PAINEL`, cada um ≥ 44px, e chama `onNavigate` com a rota certa;
  - o contador opcional entra no nome acessível;
  - o alternador marca `aria-current="page"`.
- **Verificação:** `npx vitest run tests/front/atalhos-da-aba.test.tsx`

**Fim da Onda B:** as quatro verificações + `npm run build && npm run size` (anotar painel e cliente: os primitivos não podem entrar no cliente).

---

## Onda C — Navegação e nomes

**C1 · Produtos: só a porta Cupons** — ROTINA · dep. B8
- **Arquivos:** `src/views/admin/AdminProductsView.tsx` (~691), `src/components/admin/dashboard/ProductBanners.tsx` (apagar).
- **Teste que falha:** em `tests/front/atalhos-da-aba.test.tsx`, um caso para a view de Produtos: tem "Cupons" e **não** tem porta para `admin-shipping`.
- **Implementação:** `<AtalhosDaAba aba="produtos">` no lugar de `ProductBanners`.
- **Verificação:** `npx vitest run tests/front/atalhos-da-aba.test.tsx` + `rg -n "ProductBanners" src` vazio.

**C2 · Pedidos: só a porta Devoluções** — ROTINA · dep. B8
- **Arquivos:** `AdminOrdersView.tsx` (~1578), `dashboard/SupportBanners.tsx` (apagar).
- **Teste que falha:** a view de Pedidos não tem porta para `admin-qa`/`admin-reviews` e tem "Devoluções".
- **Verificação:** o mesmo teste + `npx vitest run tests/front/admin-orders*.test.tsx`.

**C3 · Clientes: Perguntas e avaliações + Avisar clientes** — ROTINA · dep. B8
- **Arquivos:** `AdminCustomersView.tsx` (~490), `dashboard/CustomerBanners.tsx` (apagar).
- **Teste que falha:**
  - `porta-de-avisar-clientes-mora-em-clientes.test.tsx` passa a afirmar a porta "Perguntas e avaliações" → `admin-qa`;
  - o caso "Canais de Atendimento continua levando ao Atendimento" é substituído por "não há porta para admin-whatsapp-config em Clientes".
- **Verificação:** `npx vitest run tests/front/porta-de-avisar-clientes-mora-em-clientes.test.tsx`

**C4 · Alternador Perguntas | Avaliações** — ROTINA · dep. B8
- **Arquivos:** `AdminQAView.tsx`, `AdminReviewsView.tsx` (logo abaixo do cabeçalho).
- **Teste que falha:** novo `tests/front/perguntas-e-avaliacoes-alternam.test.tsx`; em `admin-qa`, clicar "Avaliações" chama `onNavigate("admin-reviews")`, e o contrário também.
- **Verificação:** o teste novo.

**C5 · Ajustes: grupos e portas** — ROTINA · dep. B8
- **Arquivos:** `AdminSettingsView.tsx` (grupo "Sua loja", ~830-945; ajuda, ~1115).
- **Teste que falha:**
  - em `admin-ajustes-salao-e-porao.test.tsx`: grupos "Minha loja", "Aparência do app" (Banners, Vitrines), "Entrega e frete" (porta para `admin-shipping`), "Pagamentos", "Regras de troca e devolução", "Ferramentas";
  - a ajuda lista os mesmos grupos que a tela (constante compartilhada; some o "três grupos").
- **Atualizar:** `ajustes-identidade-e-horario-so-em-sobre-a-loja.test.tsx` (rótulo "Minha loja").
- **Verificação:** `npx vitest run tests/front/admin-ajustes-salao-e-porao.test.tsx tests/front/ajustes-identidade-e-horario-so-em-sobre-a-loja.test.tsx`

**C6 · Pais novos do Voltar** — ROTINA · dep. C1–C5
- **Arquivos:** `src/utils/pai-da-tela-do-admin.ts`, `tests/front/pai-da-tela-do-admin.test.ts`.
- **Teste que falha:**
  - `admin-reviews`/`admin-qa` → `admin-customers`;
  - `admin-shipping` → `admin-settings`;
  - `admin-whatsapp-config` sem origem → `admin-settings`;
  - `admin-push` sem origem → `admin-customers`.
- **Atualizar:** `admin-shipping-national-view.test.tsx`, `admin-frete-nacional-botao-abre-tela.test.tsx`, se afirmarem o pai antigo.
- **Verificação:** `npx vitest run tests/front/pai-da-tela-do-admin.test.ts tests/front/admin-shipping-national-view.test.tsx`

**C7 · Popstate pergunta ao pai único** — ROTINA (`App.tsx`: pedido ao integrador; serial) · dep. C6
- **Arquivos:** `src/App.tsx` (~1765-1880), novo `src/utils/volta-do-navegador-no-painel.ts`; teste novo `tests/front/voltar-do-navegador-segue-o-pai.test.ts`.
- **Teste que falha:**
  - para cada sub-view, `destinoDoPopstate(v)` é igual a `paiDaTelaDoAdmin(v,null,false)`;
  - `admin-notifications` está incluída;
  - teste de fonte: `App.tsx` não contém mais a cadeia `currView === "admin-coupon-form"`.
- **Implementação:** a lista `subAdminViews` e o if/else viram uma chamada à função; o `replaceState` usa o mesmo destino.
- **Verificação:** o teste novo + `npx vitest run tests/front/pai-da-tela-do-admin.test.ts tests/front/rotas-de-entrada.test.ts`

**C8 · Carregando com o nome único** — ROTINA · dep. B1
- **Arquivos:** `src/components/layouts/AdminArea.tsx` (`AdminViewLoadingFallback`).
- **Teste que falha:** novo `tests/front/carregando-usa-nome-do-painel.test.tsx`; o fallback de `admin-qa` mostra "Perguntas" e o de `admin-about-store` mostra "Minha loja".
- **Verificação:** o teste novo + `tests/front/admin-pdv-registro-no-roteador.test.tsx`.

**C9 · Barra lateral e subcabeçalhos** — ROTINA · dep. C3
- **Arquivos:** `AdminLayout.tsx` (porta "Avisar clientes", ~966-984; títulos de banners e carousels, ~1124-1170).
- **Teste que falha:** novo `tests/front/admin-layout-porta-unica.test.tsx`:
  - a barra lateral não tem botão "Avisar clientes";
  - o subcabeçalho de banners diz "Banners" e o de carousels "Vitrines";
  - "Notificações" continua lá.
- **Verificação:** o teste novo + `tests/front/sino-do-painel-leva-as-notificacoes.test.tsx`

**C10–C14 · Títulos das telas pelo nome único** (5 tarefas, 4–5 views cada) — ROTINA · dep. B1
- **Arquivos:**
  - C10: Dashboard, Orders, Products, Customers, Settings;
  - C11: QA, Reviews, Devolucoes, Coupons, CouponForm;
  - C12: Banners, Carousels, AboutStore, Push, Notifications;
  - C13: ProductForm, UserDetail, Shipping, Pdv;
  - C14: Crm (vira "Relatórios"; atualizar os 13 testes que citam "Dashboard CRM", incluindo `atalhos-do-inicio-so-dois-botoes-grandes.test.tsx`) e Financeiro.
- **Teste que falha:** `tests/front/admin-visual-telas-titulo-padronizado.test.tsx` ganha a asserção "o `titulo` do `AdminPageHeader` vem de `NOMES_DO_PAINEL`" (teste de fonte: `titulo={NOMES_DO_PAINEL[`).
- **Implementação:** trocar o literal; títulos de ajuda passam pelo glossário.
- **Verificação:** `npx vitest run tests/front/admin-visual-telas-titulo-padronizado.test.tsx tests/front/painel-sem-jargao.test.ts` (baixar o teto) + os testes da tela tocada (`rg -l "<nome antigo>" tests/front`).

**Fim da Onda C:** completo + `npm run build && npm run size`.

---

## Onda D — Minha loja, fonte única (sem migration; supõe P1 = A e P2 = sim)

**D1 · Endereço: montar e ler (puro)** — ROTINA · dep. —
- **Arquivos:** novo `src/lib/endereco-da-loja.ts`; teste novo `tests/front/endereco-da-loja.test.ts`.
- **Teste que falha:**
  - `montarEnderecoDaLoja({cep:"01310100",rua:"Avenida Paulista",numero:"1578",complemento:"",bairro:"Bela Vista",cidade:"São Paulo",uf:"SP"})` → `{originCep:"01310-100", storeAddress:"Avenida Paulista, 1578 — Bela Vista, São Paulo/SP — CEP 01310-100", storeCity:"São Paulo", storeState:"SP"}`;
  - `lerEnderecoDaLoja` é o inverso exato (com e sem complemento);
  - texto livre antigo → `null`;
  - `divergenciaDoEndereco(cidadeDoCep,"SP",storeCity,storeState)` → mensagem ou `null`, ignorando acento e maiúscula.
- **Implementação:** o formato do CEP gravado é o mesmo que `formatCEP` grava hoje (conferir em `FreteNacionalBloco.tsx`).
- **Verificação:** `npx vitest run tests/front/endereco-da-loja.test.ts`

**D2 · Componente `EnderecoDaLoja`** — ROTINA · dep. D1, B7
- **Arquivos:** novo `src/components/admin/minha-loja/EnderecoDaLoja.tsx` (usa `useBuscaCep`, `LocalBufferedInput`); teste novo `tests/front/minha-loja-endereco-por-cep.test.tsx`.
- **Teste que falha:**
  - digitar o CEP com o provedor mockado preenche rua, bairro, cidade e UF;
  - sem número, o Salvar fica desabilitado com o motivo à vista;
  - com número, `onMudou(valores)` entrega as 4 chaves;
  - endereço antigo ilegível aparece como texto, com o aviso "Confirme pelo CEP";
  - CEP inexistente → "CEP não encontrado", sem apagar o que estava;
  - aviso estático do Melhor Envio presente.
- **Verificação:** o teste novo.

**D3 · Minha loja usa o componente; um Salvar, uma chamada** — ROTINA · dep. D2
- **Arquivos:** `src/views/admin/AdminAboutStoreView.tsx` (bloco 2, `handleSubmit`; toast da linha ~201 via `erro-do-painel`).
- **Teste que falha:** em `tests/front/admin-sobre-a-loja-salva-sem-apagar.test.tsx`, um caso novo: mudar CEP e número e salvar → `updateConfig` chamado **1 vez** com `originCep`, `storeAddress`, `storeCity`, `storeState` e `storeDescription`.
- **Atualizar:** `about-store-view-endereco-e-descricao.test.tsx`, `about-store-view-mostra-o-que-a-loja-tem.test.tsx`.
- **Verificação:** `npx vitest run tests/front/admin-sobre-a-loja-salva-sem-apagar.test.tsx tests/front/about-store-view-endereco-e-descricao.test.tsx`

**D4 · Aviso de divergência CEP × cidade** — ROTINA · dep. D3
- **Arquivos:** `AdminAboutStoreView.tsx`.
- **Teste que falha:** com o config divergente (CEP de Campinas, `store_city` São Paulo) e o provedor mockado, aparece "Seu CEP é de Campinas/SP…".
- **Verificação:** o teste da D3.

**D5 · Marca sem Cidade/UF, sem reverter** — ROTINA (revisor confere o caminho de conflito de `src/lib/adminStoreIdentity.ts`) · dep. D3
- **Arquivos:** `src/components/admin/settings/IdentitySettingsSection.tsx` (`fields`); talvez `src/hooks/useStoreIdentityEditor.ts` (re-leitura depois de mudança externa).
- **Teste que falha:** novo `tests/front/minha-loja-marca-nao-reverte-cidade.test.tsx`: salvar o endereço (cidade nova) e depois a cor da marca → o `save_store_identity` mockado recebe `desired_identity.store_city` = cidade nova e nenhum erro de conflito aparece.
- **Implementação:** tirar Cidade/UF dos campos visíveis; o rascunho re-hidrata quando `config.storeCity/State` mudam e o lojista não editou a marca.
- **Verificação:** o teste novo + `npx vitest run tests/front/ajustes-identidade-e-horario-so-em-sobre-a-loja.test.tsx`

**D6 · Frete lê o CEP e não grava** — ROTINA · dep. D3, **P2**
- **Arquivos:** `src/components/admin/shipping/FreteNacionalBloco.tsx` (~238-260), `src/views/admin/AdminShippingView.tsx` (`originCep` em ~172, 243, 425, 575, 784-786).
- **Teste que falha:** novo `tests/front/frete-nao-grava-cep.test.tsx`:
  - o Salvar do Frete chama `updateConfig` **sem** `originCep`;
  - a tela mostra "Entregas saem de: CEP 01310-100" e o botão "Alterar em Minha loja" → `onNavigate("admin-about-store")`;
  - sem CEP, o aviso "sem isso a loja não vende" leva a Minha loja.
- **Atualizar:** `admin-shipping-nao-inventa-cep-de-origem.test.tsx`, `admin-frete-v2-contrato.test.tsx`, `admin-shipping-trocar-de-aba-nao-apaga-o-que-foi-digitado.test.tsx`, `admin-visual-frete.test.tsx`, `frete-indefinido-sem-cep-de-origem.test.tsx` (se for do painel), e o destino do item CEP em `dashboard-diz-o-que-falta-para-vender.test.tsx` (`admin-about-store`).
- **Verificação:** `npx vitest run tests/front/frete-nao-grava-cep.test.tsx tests/front/admin-shipping-nao-inventa-cep-de-origem.test.tsx tests/front/admin-visual-frete.test.tsx`

**D7 · Retirada aponta para Minha loja** — ROTINA · dep. D6
- **Arquivos:** `src/components/admin/shipping/FreteLocalBloco.tsx` (ou onde mora a chave de retirada; confirmar com `rg -n "store-pickup\|Retirada" src/components/admin/shipping`).
- **Teste que falha:** em `tests/front/admin-frete-retirada-na-loja.test.tsx`, sem `storeAddress` a chave explica e oferece "Cadastrar endereço em Minha loja"; com endereço, mostra o endereço só para leitura.
- **Verificação:** `npx vitest run tests/front/admin-frete-retirada-na-loja.test.tsx`

**D8 · Devolução: "Mesmo endereço da loja"** — ROTINA · dep. D3
- **Arquivos:** `src/components/admin/settings/PoliticaDeDevolucaoSection.tsx` (~440-450).
- **Teste que falha:** novo `tests/front/devolucao-mesmo-endereco-da-loja.test.tsx`:
  - `endereco_devolucao` vazio → a caixa vem marcada, mostrando `config.storeAddress`, sem campo;
  - desmarcar mostra o campo;
  - remarcar e salvar envia `endereco_devolucao: ""` (a semântica de hoje).
- **Verificação:** o teste novo.

**D9 · Contato (WhatsApp + mensagem) dentro de Minha loja** — ROTINA · dep. A1, D3
- **Arquivos:** novos `src/components/admin/minha-loja/WhatsAppDaLoja.tsx` e `MensagemDeCompartilhar.tsx` (extraídos de `AdminWhatsAppConfigView.tsx`, blocos 1 e 3, com o mesmo comportamento: 10–11 dígitos → `55…`, vazio grava NULL); `AdminAboutStoreView.tsx` (bloco "Contato" no lugar do bloco 5 de leitura).
- **Teste que falha:** novo `tests/front/minha-loja-contato.test.tsx`:
  - número com 9 dígitos → "WhatsApp inválido";
  - 11 dígitos → `updateConfig({whatsappNumber:"55…"})`, sem `businessHours`;
  - os modelos de mensagem abrem e fecham.
- **Atualizar** (redirecionar aos componentes novos): `atendimento-presets-abre.test.tsx`, `admin-whatsapp-folha-modelos-fecha.test.tsx`.
- **Verificação:** o teste novo + os dois atualizados.

**D10 · Seção inicial por props** — ROTINA · dep. D9
- **Arquivos:** `AdminAboutStoreView.tsx` (prop `secaoInicial?: "contato"`, que rola e põe o foco no bloco).
- **Teste que falha:** com `secaoInicial="contato"`, o foco vai para o título do bloco Contato.
- **Verificação:** `npx vitest run tests/front/minha-loja-contato.test.tsx`

**D11 · A rota `admin-whatsapp-config` vira apelido** — ROTINA (serial: `AdminArea.tsx`) · dep. D10, C8
- **Arquivos:** `src/components/layouts/AdminArea.tsx` (o `case "admin-whatsapp-config"` renderiza `AdminAboutStoreView` com `secaoInicial="contato"`); apagar `src/views/admin/AdminWhatsAppConfigView.tsx`.
- **Teste que falha:** novo `tests/front/atendimento-abre-minha-loja.test.tsx`: navegar para `admin-whatsapp-config` mostra o título "Minha loja" e o bloco Contato.
- **Atualizar:** `atendimento-formulario-direto.test.tsx` e o bloco "Canais de Atendimento" de `admin-visual-canais-avisar.test.tsx` (migram para os componentes novos ou saem com a view, **sem perder** as asserções de comportamento: dirty, nada desmonta, editor com o texto salvo).
- **Verificação:** o teste novo + `npx vitest run tests/front/admin-visual-canais-avisar.test.tsx tests/front/rotas-de-entrada.test.ts tests/front/hospedagem-rotas.test.ts` + `rg -n "AdminWhatsAppConfigView" src` vazio.

**D12 · Guarda de fonte única** — ROTINA · dep. D6, D11
- **Arquivos:** teste novo `tests/front/endereco-e-horario-tem-um-dono.test.ts`.
- **Teste que falha / afirma:**
  - em `src/views/admin/**` e `src/components/admin/**`, `originCep:`/`storeAddress:`/`storeCity:`/`storeState:` como chave de payload de `updateConfig` só aparecem em `minha-loja/*` e `AdminAboutStoreView.tsx`;
  - `businessHours:` só em `BusinessHoursSection.tsx`.
- **Verificação:** o teste novo.

**Fim da Onda D:** completo + `npm run build && npm run size` (a view apagada reduz o painel).

---

## Onda E — Primeiros passos

**E1 · 6 itens na função** — ROTINA · dep. A4, D1
- **Arquivos:** `src/lib/loja-pronta.ts`, `tests/front/loja-pronta.test.ts`.
- **Teste que falha:**
  - itens marca, endereço, WhatsApp, recebe, entrega e produto, com destinos (`admin-about-store`, `admin-settings`, `admin-shipping`, `admin-products`);
  - `proximoPasso()` devolve o primeiro pendente;
  - `contagem` → `{feitos, total:6}`;
  - o horário não conta.
- **Verificação:** `npx vitest run tests/front/loja-pronta.test.ts`

**E2 · Régua da entrega extraída** — ROTINA · dep. D7
- **Arquivos:** `src/views/admin/AdminShippingView.tsx` (~320, `StatusDaFaixaFrete`) → novo `src/lib/status-da-entrega.ts`; teste novo `tests/front/status-da-entrega.test.ts`.
- **Teste que falha:** os mesmos casos que a tela usa hoje (sem CEP; local; nacional com ou sem transportadora ligada) dão o mesmo status.
- **Atualizar:** `admin-shipping-view-estrategia-nacional-na-faixa.test.tsx` deve continuar verde sem edição.
- **Verificação:** o teste novo + `npx vitest run tests/front/admin-shipping-view-estrategia-nacional-na-faixa.test.tsx`

**E3 · Cartão guiado no Início** — ROTINA · dep. E1
- **Arquivos:** `LojaProntaEEstoqueBaixo.tsx`, `AdminDashboardView.tsx`.
- **Teste que falha:** em `tests/front/dashboard-diz-o-que-falta-para-vender.test.tsx`:
  - "4 de 6 prontos";
  - um botão "Próximo passo: Cadastrar WhatsApp" → `admin-about-store`;
  - a lista recolhida abre com `aria-expanded`;
  - 6/6 → só a linha "Loja pronta para vender".
- **Verificação:** o teste + `tests/front/inicio-do-painel.test.tsx`

**E4 · "Falta preencher" em Minha loja** — ROTINA · dep. E1, D3
- **Arquivos:** `AdminAboutStoreView.tsx`.
- **Teste que falha:** sem WhatsApp, o topo diz "Falta preencher: WhatsApp", e o toque leva ao bloco.
- **Verificação:** `npx vitest run tests/front/minha-loja-contato.test.tsx`

**E5 · Ajustes: status por grupo no lugar do cartão** — ROTINA (serial: `AdminSettingsView.tsx`) · dep. E1, C5
- **Arquivos:** `AdminSettingsView.tsx` (~457-830, `IndicadorDoPainel`).
- **Teste que falha:**
  - em `admin-ajustes-salao-e-porao.test.tsx`, o cartão "Como está sua loja" não existe;
  - o subtítulo de "Minha loja" diz "Falta: WhatsApp", e o de "Pagamentos" diz "Na entrega + PIX";
  - "Conexão" aparece em Ferramentas.
- **Atualizar:** `ajustes-disclosure-do-diagnostico.test.tsx`.
- **Verificação:** os dois testes.

---

## Onda F — Um número, um conceito (front)

**F1 · Regra "para preparar" única** — ROTINA · dep. —
- **Arquivos:** novo `src/lib/pedidos-para-preparar.ts` (`STATUS_PARA_PREPARAR`, `PAGAMENTOS_QUE_NAO_PREPARAM`, `estaParaPreparar(pedido)`, `filtroPostgrestParaPreparar` = `or=(payment_status.is.null,payment_status.not.in.(aguardando,expirado,recusado,estornado))`); teste novo `tests/front/pedidos-para-preparar.test.ts`.
- **Teste que falha:** uma amostra de 8 pedidos (inclui `payment_status` NULL da entrega e PIX `aguardando`) → 5 para preparar, igual à regra do `painel_inicio`.
- **Verificação:** o teste novo.

**F2 · O selo da aba segue a regra** — ROTINA (serial: `AdminLayout.tsx`) · dep. F1, C9
- **Arquivos:** `AdminLayout.tsx` (~179-189; `STATUS_PEDIDOS_COM_ACAO_PENDENTE` passa a vir da F1).
- **Teste que falha:** em `admin-layout-cracha-pedidos-pendentes.test.tsx`, o mock da consulta recebe também o filtro `.or(...)` da F1; o caso novo "PIX aguardando não conta" passa.
- **Verificação:** `npx vitest run tests/front/admin-layout-cracha-pedidos-pendentes.test.tsx tests/front/sino-do-painel-leva-as-notificacoes.test.tsx`

**F3 · KPIs de Pedidos operacionais** — ROTINA · dep. F1, C2
- **Arquivos:** `AdminOrdersView.tsx` (~539-575).
- **Teste que falha:** em `admin-kpi-carousel-compacto.test.tsx` (ou um teste novo da view), os cartões são "Para preparar", "Aguardando pagamento", "A caminho" e "Entregues"; "Receita Hoje" e "Ticket Médio" não existem.
- **Implementação:** antes, conferir a régua de `stats.pending`; se for outra, contar pela F1.
- **Atualizar:** `useAnularVendaDoBalcao.ts:50` e `useOrders.ts:3348` só no comentário.
- **Verificação:** o teste + `npx vitest run tests/front/admin-orders*.test.tsx`

**F4 · Início: rótulos com janela e sem repetição** — ROTINA · dep. —
- **Arquivos:** `src/components/admin/inicio/HojeNaLoja.tsx`, `NumerosDoMes.tsx`, `ParaFazer.tsx`.
- **Teste que falha:** em `tests/front/inicio-do-painel.test.tsx`:
  - "Vendas pagas hoje" e "Vendas pagas no mês";
  - "Contas vencidas" aparece uma vez só;
  - "Devoluções abertas" mantém o rótulo.
- **Verificação:** `npx vitest run tests/front/inicio-do-painel.test.tsx tests/front/crm-e-inicio-funcoes-puras.test.ts`

**F5 · Limiar de estoque único no front** — ROTINA · dep. —
- **Arquivos:** `src/hooks/useProducts.ts:679` (`lte("estoque", 5)` → `LIMIAR_PADRAO_DE_ESTOQUE` de `src/utils/avisos-do-lojista.ts`), e qualquer `<= 5` de estoque em `src/views/admin`/`src/components/admin` (`ProductCard` é da cliente e fica fora).
- **Teste que falha:** teste de fonte `tests/front/estoque-baixo-um-limiar.test.ts`: nenhum literal `5` de estoque no painel fora de `avisos-do-lojista.ts`.
- **Verificação:** o teste novo.

**F6 · Clientes × Relatórios: rótulos e WhatsApp na ficha** — ROTINA · dep. C14
- **Arquivos:** `AdminCustomersView.tsx` (subtítulo "Clientes com conta no app"), `src/components/admin/crm/*` (aba Clientes: "Quem já comprou — app e balcão"), `AdminUserDetailView.tsx` (botão WhatsApp com o mesmo construtor de link do CRM; confirmar com `rg -n "wa.me" src/components/admin/crm`).
- **Teste que falha:** novo `tests/front/ficha-do-cliente-tem-whatsapp.test.tsx`: com telefone, o botão abre `https://wa.me/55…`; sem telefone, não aparece.
- **Verificação:** o teste novo.

**F7 · Balcão × Pedidos: só texto** — ROTINA · dep. F3
- **Arquivos:** `AdminOrdersView.tsx` ou `src/components/admin/orders/*` (o detalhe de venda `canal === "balcao"`).
- **Teste que falha:** num pedido de balcão do dia, a área de cancelar mostra o texto que explica "Anular (em Vender)" × "Cancelar". A **frase exata** é conferida contra a 20261204 (`a_venda_do_balcao_se_anula_no_mesmo_dia`) antes de escrever. Nenhum handler muda.
- **Verificação:** o teste novo `tests/front/balcao-explica-anular-e-cancelar.test.tsx`.

---

## Onda G — Linguagem por tela (cada tarefa baixa o teto de `painel-sem-jargao` e da régua visual)

Padrão de cada tarefa:
- **Teste que falha:** baixar o teto do arquivo em `painel-sem-jargao.teto.json` para 0 (falha), e então trocar os textos pelo glossário.
- **Verificação:** `npx vitest run tests/front/painel-sem-jargao.test.ts tests/front/regua-visual-do-painel.test.ts` + os testes da tela (`rg -l "<termo antigo>" tests/front`).

| # | Arquivos | Troca | Testes a atualizar |
|---|---|---|---|
| G1 | `src/components/admin/crm/*` (Visão geral, Clientes/RFM, Canais, Estoque) | §6 bloco CRM; segmentos com uma frase de explicação; remove "Conversão Comercial" vazio | `crm-visual-*`, `crm-e-inicio-funcoes-puras` |
| G2 | `src/components/admin/financeiro/*`, `AdminFinanceiroView.tsx` | "DRE" → "Resultado do mês"; "Competência" → "Mês da venda"; "Contas e categorias" vai para o fim com o selo "Avançado" | testes `financeiro-*` |
| G3 | `AdminProductFormView.tsx` (rótulos; vai junto com a H1 na mesma frente) | SKU, EAN, variações (§6) | testes `product-form*` |
| G4 | `src/views/admin/StatusPagamentoPix.tsx`, `src/components/admin/settings/MercadoPagoSection.tsx`, `mercado-pago-conteudo.ts` | sem `MP_ACCESS_TOKEN`/Supabase/flag/frota; chaves com nome do lojista | testes `status-pagamento*`, `mercado-pago*` |
| G5 | `src/components/admin/settings/HistoricoCotacoesCard.tsx` | `destination_cep`/`provider`/`error_message` → "CEP do cliente", "Transportadora", "Motivo" (via `mensagemAmigavel`) | `admin-shipping-historico-*` |
| G6 | `src/components/admin/settings/TransportadorasCard.tsx` | códigos 12/15/16/22 → nome do serviço (conferir na doc do Melhor Envio via context7/oficial; o código fica em Avançado) | `admin-shipping-frete-por-provedor` |
| G7 | `AdminLayout.tsx` (selo de conexão On/Slow/Sync/Off; serial depois da F2) e `AdminSettingsView.tsx` (diagnóstico "latência/ping"; serial depois da E5) | §6 | `ajustes-disclosure-do-diagnostico` |
| G8 | `PoliticaDeDevolucaoSection.tsx` | "CDC art. 49/26" → frases do §6 | testes `politica-de-devolucao*` |
| G9 | `IdentitySettingsSection.tsx` | Favicon/Ícone Apple/192/512/máscara → "Ícones do app (avançado)" dentro de `SecaoRecolhivel` | `ajustes-identidade-*` |
| G10 | toasts crus no painel (`rg -n "toast.error\(\`.*\\\$\{.*message" src/views/admin src/components/admin`) | `mensagemAmigavel(e, ação)` (a exceção 22023 continua) | os testes das telas tocadas |

---

## Onda H — Telas gigantes

**H1 · Produto: básico primeiro** (3 tarefas) — ROTINA · dep. B7
- **Arquivos:** `src/views/admin/AdminProductFormView.tsx`; teste novo `tests/front/produto-basico-primeiro.test.tsx`.
- **H1a — teste que falha:** ao abrir um produto novo, Fotos, Nome, Preço, Estoque e Categoria estão visíveis; "Variações", "Peso e medidas", "Custo e lucro" e "Avançado" estão em `SecaoRecolhivel` fechadas, mas montadas (`hidden`). Implementação: embrulhar as seções (~2783, ~3181, ~3347, ~3778) sem mover estado.
- **H1b — teste que falha:** submeter com erro num campo dentro de "Peso e medidas" abre a seção e põe o foco no campo.
- **H1c — teste que falha:** editar um produto com variações abre "Variações" já expandida.
- **Verificação:** o teste novo + `npx vitest run $(rg -l "AdminProductFormView" tests/front | tr '\n' ' ')`

**H2 · Estoque mínimo no Avançado do produto** — ROTINA **se** o UPDATE já passar; senão vira I5 (RISCO) · dep. H1a
- **Antes:** conferir no Postgres efêmero se `UPDATE produtos SET estoque_minimo` pelo admin passa (grants da 20261070 e gatilhos de `useProducts`).
- **Arquivos:** `AdminProductFormView.tsx`, `src/hooks/useProducts.ts` (`dbUpdates.estoque_minimo`).
- **Teste que falha:** novo `tests/front/produto-estoque-minimo.test.tsx`: o campo "Avisar quando o estoque chegar a" grava `estoque_minimo`, e vazio grava NULL (usa o padrão).
- **Verificação:** o teste novo.

**H3 · Avisar clientes: destino escolhido** — ROTINA · dep. B7
- **Arquivos:** `src/views/admin/AdminPushView.tsx` (~1504 e as 8 opções de destino).
- **Teste que falha:** novo `tests/front/push-destino-escolhido.test.tsx`:
  - escolher "Um produto" e buscar "tênis" monta a URL de produto que a tela já monta hoje;
  - o campo de caminho manual só existe dentro de "Avançado";
  - a URL que sai no envio é a mesma de hoje para cada opção (contrato).
- **Atualizar:** o bloco "Avisar clientes" de `admin-visual-canais-avisar.test.tsx`.
- **Verificação:** o teste novo + `npx vitest run tests/front/admin-visual-canais-avisar.test.tsx`

**H4 · Banners: Simples é o padrão e fica lembrado** — ROTINA · dep. —
- **Arquivos:** `src/views/admin/AdminBannersView.tsx` (confirmar com `rg -n "Simples|Completo"` onde nasce o modo).
- **Teste que falha:** novo `tests/front/banners-modo-lembrado.test.tsx`: primeira abertura em Simples; trocar para Completo, desmontar e montar → Completo.
- **Verificação:** o teste novo + `tests/front/admin-banners-voltar-fecha-so-o-dialogo.test.tsx`

**H5 · Frete recebe Transportadoras e Consultas; Ajustes só tem a porta** — ROTINA (serial: `AdminShippingView.tsx` e `AdminSettingsView.tsx`; uma frente só) · dep. D6, E2, E5, G7
- **Arquivos:** `AdminShippingView.tsx` (painéis "Na sua cidade", "Para todo o Brasil", "Transportadoras" com o `TransportadorasCard` em lazy, "Avançado" com estratégias local, etiquetas e `HistoricoCotacoesCard`); `AdminSettingsView.tsx` (sai o acordeão "Entrega e frete" (~947-983) e "Consultas de frete" (~1100); fica o cartão-porta).
- **Teste que falha:** novo `tests/front/frete-um-lugar-so.test.tsx`:
  - Frete tem o painel "Transportadoras" com o mesmo formulário de chave;
  - Ajustes não monta `TransportadorasCard` nem `HistoricoCotacoesCard`;
  - `painelInicial="nacional"` (a casca) continua abrindo "Para todo o Brasil".
- **Atualizar:** `admin-ajustes-salao-e-porao`, `ajustes-disclosure-do-diagnostico`, `admin-shipping-chaves-que-nao-carregam-dizem-e-deixam-tentar`, `admin-shipping-erro-teste-credenciais-traduzido`, `admin-shipping-national-view`, `admin-visual-frete`.
- **Verificação:** os testes acima + `npm run build && npm run size` (o lazy muda de lugar).

**H6 · Pagamentos: status uma vez, chaves em Avançado** — ROTINA (texto e arrumação; nenhuma chamada a `credenciais-mercado-pago` muda) · dep. H5, G4
- **Arquivos:** `AdminSettingsView.tsx` (grupo Pagamentos, ~985-1050), `MercadoPagoSection.tsx`.
- **Teste que falha:** novo `tests/front/pagamentos-status-uma-vez.test.tsx`:
  - o status do PIX aparece uma vez em Ajustes;
  - as chaves estão em `SecaoRecolhivel` "Avançado: chaves do Mercado Pago";
  - "Minha loja está no ar?" mostra só a conexão e um link para Pagamentos.
- **Antes:** mapear com `rg -n "rotuloDoPix\|StatusPagamentoPix" src` os 4 lugares e registrar no PR qual fica.
- **Verificação:** o teste novo + `npx vitest run $(rg -l "MercadoPagoSection|StatusPagamentoPix" tests/front | tr '\n' ' ')`

**Fim da Onda H:** completo + `npm run build && npm run size` + a régua visual no teto-meta.

---

## Onda I — Banco (RISCO; só depois das respostas; serial; `/nova-migration`; revisor-risco; prova no Postgres efêmero)

Antes de numerar, conferir a faixa de migrations no mural (`~/.claude/mural/core_app_mkt/_REGRAS.md`). O próximo número livre parece ser `20261207000000`.

**I1 · Estoque baixo com padrão único (P3)** — RISCO · dep. F5
- **Arquivos:** `supabase/migrations/20261207000000_estoque_baixo_tem_um_padrao.sql` (`CREATE OR REPLACE` de `painel_inicio` com o corpo vigente da 20261199, linhas ~1590-1596, trocando `COALESCE(p.estoque_minimo, 3)` por `5` nas 2 linhas; mantém `is_admin_atual`, `search_path`, sem `BEGIN`/`COMMIT`; seguir o preflight por hash se o padrão da 20261199 exigir) + `rollback-manual-20261207000000_estoque_baixo_tem_um_padrao.sql` (o corpo anterior). Tipos não mudam (a assinatura é a mesma).
- **Teste que falha:** `tests/banco/estoque-baixo-padrao-viva.cjs` — produto com estoque 4 e `estoque_minimo` NULL: `painel_inicio()->>'estoque_baixo'` conta 1 e o analytics conta 1.
- **Verificação:** `node scripts/ci/banco/aplicar-migrations.cjs supabase/migrations && node scripts/ci/banco/prova-dupla-aplicacao.cjs supabase/migrations && node tests/banco/estoque-baixo-padrao-viva.cjs` (receita da `ARQUITETURA-AGENTICA.md`).
- **Publicação:** pelo `aplicar-migrations.yml`, antes do front que depender dela (a F5 não depende).

**I2 · Prova: "vendas pagas" tem uma régua** — RISCO (só leitura; dinheiro) · dep. —
- **Arquivos:** `tests/banco/receita-uma-regua-viva.cjs`.
- **Afirma:** com a semente (online pago, balcão, na entrega recebido, PIX expirado, estornado, pago depois de expirar), no mesmo mês: `painel_inicio.receita_mes` = `crm__vendas` (mês) = entradas de venda de `fin_resumo`.
- **Se falhar:** **não** corrigir aqui. Abrir spec própria (RISCO, `fin_*`) e manter os rótulos do Relatórios e do Financeiro com o período explícito.
- **Verificação:** o mesmo bloco de comandos da I1.

**I3 · (só se P1 = B) Colunas estruturadas de endereço** — RISCO, em tarefas separadas:
- (a) migration com 4 colunas + `upsert_store_config` + `v_store_config` (colunas no fim) + rollback;
- (b) `src/types/database.types.ts` regenerado;
- (c) `StoreContext.updateConfig` mapeando as chaves;
- (d) `EnderecoDaLoja` passa a gravar os campos (o texto montado continua).

Prova no Postgres efêmero: "salvar um campo não apaga os outros" para as 4 colunas novas.

**I4 · (opcional, não recomendado agora) Conferir o remetente do ME** — RISCO (`supabase/functions/melhor-envio-etiqueta`): ação só de leitura que devolve o CEP e a cidade da conta ME para Minha loja comparar.

**I5 · (só se a H2 achar o UPDATE bloqueado) Grant de `estoque_minimo`** — RISCO: migration de grant + prova.

---

## Testes existentes que mudam, por onda (resumo)

- **A:** `ajustes-horario-de-atendimento`, `atendimento-formulario-direto`, `admin-visual-canais-avisar`, `admin-barra-nao-mente-a-aba-do-pdv`, `dashboard-diz-o-que-falta-para-vender`, `dashboard-cep-oito-digitos` — horário vira leitura, rótulos do checklist, o rótulo da barra deixa de ser `hidden`.
- **B:** `admin-orders-guia-do-pagamento-que-nao-fechou`, `porta-de-avisar-clientes-mora-em-clientes` (só se buscarem "✕").
- **C:** `porta-de-avisar-clientes-mora-em-clientes`, `admin-ajustes-salao-e-porao`, `ajustes-identidade-e-horario-so-em-sobre-a-loja`, `pai-da-tela-do-admin`, `admin-shipping-national-view`, `admin-frete-nacional-botao-abre-tela`, `admin-visual-telas-titulo-padronizado`, os 13 que citam "Dashboard CRM" e os 14 que citam "Sobre a Loja" — **só os do painel**; os da página da cliente ficam.
- **D:** `about-store-view-*`, `admin-sobre-a-loja-salva-sem-apagar`, `admin-shipping-nao-inventa-cep-de-origem`, `admin-frete-v2-contrato`, `admin-shipping-trocar-de-aba-…`, `admin-visual-frete`, `admin-frete-retirada-na-loja`, `atendimento-*`, `admin-whatsapp-folha-modelos-fecha`, `admin-visual-canais-avisar`.
- **E:** `dashboard-diz-o-que-falta-para-vender`, `inicio-do-painel`, `admin-ajustes-salao-e-porao`, `ajustes-disclosure-do-diagnostico`.
- **F:** `admin-layout-cracha-pedidos-pendentes` (a contagem passa a excluir PIX não pago), `admin-kpi-carousel-compacto`, `inicio-do-painel`.
- **G:** `crm-visual-*`, `financeiro-*`, `admin-shipping-historico-*`, `admin-shipping-frete-por-provedor`, `politica-de-devolucao*`, `ajustes-identidade-*`.
- **H:** os de product-form, `admin-visual-canais-avisar` (Push), `admin-banners-*`, `admin-shipping-*`, `ajustes-*`.

**Regra do revisor:** atualizar um teste só pode trocar rótulo ou porta. Asserção de comportamento (o que grava, o que não apaga, dirty, offline) não sai.

---

**Perguntas ao dono** (detalhe e conta no §13 da spec):
- **P1 — Endereço: A (sem migration, recomendado) ou B (colunas estruturadas, RISCO)?** Sem resposta, segue A.
- **P2 — O CEP da loja é o mesmo de onde saem as entregas?** Recomendo sim. Bloqueia a D6.
- **P3 — Padrão do "estoque baixo" sem mínimo: 5 (recomendado) ou 3?** Bloqueia só a I1.

**Suposições:**
- "Mantendo como está" = mesmas 5 abas, mesmas rotas, mesmo tema escuro.
- "Dashboard CRM" pode virar "Relatórios": reversível numa linha.
- O lojista prefere a contagem de "para preparar" sem PIX não pago, como o Início já faz.
- `useBuscaCep` e os provedores de CEP servem ao painel como servem à cliente, sem mudar o CSP.
- Radix Dialog já está no bundle, por causa de `ui/dialog.tsx`.
- Os números de linha citados são de hoje; o implementador confirma com `rg` antes de editar.

**Arquivos principais lidos:**
- `/home/user/ikcous-marketplace/AGENTS.md`
- `/home/user/ikcous-marketplace/docs/processo/ARQUITETURA-AGENTICA.md`
- `/home/user/ikcous-marketplace/.claude/commands/nova-tela.md`
- `/home/user/ikcous-marketplace/docs/superpowers/specs/2026-09-26-inicio-crm-e-financeiro-do-painel-design.md`
- `/home/user/ikcous-marketplace/src/components/layouts/AdminLayout.tsx`
- `/home/user/ikcous-marketplace/src/utils/pai-da-tela-do-admin.ts`
- `/home/user/ikcous-marketplace/src/App.tsx` (~1765)
- `/home/user/ikcous-marketplace/src/views/admin/AdminAboutStoreView.tsx`
- `/home/user/ikcous-marketplace/src/views/admin/AdminWhatsAppConfigView.tsx`
- `/home/user/ikcous-marketplace/src/views/admin/AdminShippingView.tsx`
- `/home/user/ikcous-marketplace/src/components/admin/shipping/FreteNacionalBloco.tsx`
- `/home/user/ikcous-marketplace/src/components/admin/dashboard/LojaProntaEEstoqueBaixo.tsx`
- `/home/user/ikcous-marketplace/src/contexts/StoreContext.tsx` (~894-1002)
- `/home/user/ikcous-marketplace/supabase/migrations/20261199000000_portas_do_painel_exigem_admin_atual.sql` (`upsert_store_config` ~3528, `save_store_identity`, `painel_inicio`)
- `/home/user/ikcous-marketplace/supabase/functions/melhor-envio-etiqueta/index.ts` (~495-532)
- `/home/user/ikcous-marketplace/src/views/admin/AdminOrdersView.tsx` (~539-575)
- `/home/user/ikcous-marketplace/scripts/paralelo/faixas.mjs`

