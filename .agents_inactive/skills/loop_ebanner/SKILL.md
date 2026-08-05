---
name: loop_ebanner
description: Executa o loop de evolução contínua da tela de banners (AdminBannersView.tsx), realizando auditoria, propostas de melhoria de usabilidade e codificação estática automatizada.
---

# ⚡ SKILL: EVOLUÇÃO CONTÍNUA DO GERENCIADOR DE BANNERS (AdminBannersView.tsx)

Você foi ativado pelo comando ou intenção `/loop_ebanner`. Sua missão é auditar a tela administrativa de banners em [AdminBannersView.tsx](file:///c:/Users/Gabriel/Documents/software%20Gerenciador%20ecossistema%20ikcous/projects/app_mkt_cliente_novo/src/views/admin/AdminBannersView.tsx) e realizar de forma autônoma a próxima melhoria de usabilidade, funcionalidade ou estética (mantendo tudo extremamente completo, mas incrivelmente simples e fácil de usar).

## 🎯 Diretriz de Usabilidade: "Completude com Fricção Zero"
Qualquer upgrade deve seguir a filosofia de design da IKCOUS:
1. **Completude Absoluta**: A funcionalidade deve dar todo o controle ao administrador (edição de cores, tipografia, simulação, posicionamento, links, etc.).
2. **Simplicidade Extrema**: O formulário deve guiar o usuário de forma natural. Elementos complexos (como códigos hexadecimais ou rotas internas) devem ter alternativas visuais fáceis (swatches de cores, sugestões em um clique, seletores gráficos).
3. **Estética Premium**: Animações fluidas (`framer-motion`), design adaptado para Dark Mode com acentos em ouro/âmbar (`#FFBF00`), cantos arredondados, e feedbacks táteis/sonoros (sonner toast) bem calibrados.

## 🔍 Ciclo de Investigação e Execução (Passo a Passo)

### ⚠️ Passo 0: Validação de Estabilidade e Funcionamento Atual (Mandatório)
Antes de propor ou implementar qualquer novo upgrade ou melhoria:
1. **Auditoria e Testes Atuais**: Você DEVE testar e auditar exaustivamente todas as funcionalidades atuais da tela de banners, stepper de criação, listagem, exclusão e visualização de simulação do PWA.
2. **Garantia de Zero Bugs**: Confirme se tudo o que foi implementado em upgrades anteriores está funcionando 100% perfeitamente no ambiente atual.
3. **Priorização Absoluta de Correções**: Se identificar qualquer mau funcionamento, lentidão, bugs de layout ou erros lógicos, você **NÃO DEVE** iniciar um novo upgrade. O foco desta iteração passará a ser obrigatoriamente a correção e estabilização de tudo o que está quebrado. Não avance para novos recursos com pendências funcionais.
4. **Validação Estática Inicial**: Execute a suíte rápida para assegurar que a base existente compila e não possui erros de linter:
   `C:\Users\Gabriel\Documents\Ferramentas para projetos\Executar_Todas_Suites_Modo_Rapido.bat`

Apenas siga para a seleção de um novo upgrade (Passos 1 e 2) se for garantido que o estado atual está impecável e sem qualquer regressão.

### Passo 1: Auditoria do Estado Atual do Código
Analise detalhadamente o arquivo [AdminBannersView.tsx](file:///c:/Users/Gabriel/Documents/software%20Gerenciador%20ecossistema%20ikcous/projects/app_mkt_cliente_novo/src/views/admin/AdminBannersView.tsx) para entender:
1. Como o formulário de criação/edição está estruturado (Wizard/Stepper atual e campos).
2. Quais parâmetros estéticos e lógicos de um banner estão ativos (título, cores, templates, produtos associados, posições).
3. Quais limitações ou gargalos de usabilidade existem atualmente (ex: campos que poderiam ter preenchimento mais intuitivo, previews que podem ser mais dinâmicos, validações pendentes ou melhorias de performance).

### Passo 2: Seleção e Planejamento do Upgrade
Com base na auditoria anterior, selecione autonomamente **um ou mais upgrades focados em simplicidade e usabilidade**. Exemplos de melhorias contínuas:
- **Facilitadores de Entrada**: Sugestões automáticas inteligentes de títulos baseadas no produto selecionado, preenchimento de cupons associados ao banner ou detecção automática do contraste ideal do texto com a imagem de fundo.
- **Melhorias no Simulador PWA**: Inclusão de novos elements gráficos na simulação do telefone (como simulação de diferentes marcas/tamanhos de tela, ou exibição do banner em formato carrossel se múltiplos banners estiverem ativos na mesma posição).
- **Filtros & Organização**: Melhorias nos filtros rápidos de visualização da listagem de banners (ativos, topo, meio, base) ou busca aprimorada de produtos vinculados.
- **Robustez / Offline**: Melhorias no comportamento do formulário sob conexões instáveis, cache local de uploads temporários ou feedbacks de salvamento mais robustos.

Apresente uma justificativa clara de por que escolheu essa melhoria específica e como ela torna a tela mais completa e ao mesmo tempo mais simples de operar.

### Passo 3: Implementação Cirúrgica
Realize a substituição ou adição de código no arquivo de forma incremental e sem deletar lógicas de integração com o Supabase ou imports necessários.
- **Nunca use placeholders**: Todo código gerado deve ser completo e funcional.
- **Framer Motion**: Mantenha as transições suaves no stepper e modais para dar sensação de uma aplicação premium.
- **Uso de Controles Visuais**: Prefira sempre seletores interativos (chips, cartões com ícones, cores visuais) do que campos de digitação manual sempre que possível.

### Passo 4: Validação de Qualidade
- Verifique se o projeto compila sem problemas.
- Execute a suíte de qualidade rápida para homologar o código estaticamente:
  `C:\Users\Gabriel\Documents\Ferramentas para projetos\Executar_Todas_Suites_Modo_Rapido.bat`

### Passo 5: Ledger & Autorização
1. Atualize o `walkthrough.md` com a melhoria implementada.
2. Gere ou atualize o arquivo de autorização correspondente na pasta `C:\Users\Gabriel\Documents\software Gerenciador ecossistema ikcous\projects\authorizations\auth_` para autorizar a sincronização segura da alteração.
