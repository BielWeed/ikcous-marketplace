---
name: loop_ftedit
description: Executa o loop de evolução contínua do componente de ajuste e corte de imagens (ImageAdjuster.tsx) e suas integrações nas telas de produto e banners.
---

# ⚡ SKILL: EVOLUÇÃO CONTÍNUA DO AJUSTADOR DE IMAGENS (ImageAdjuster.tsx)

Você foi ativado pelo comando ou intenção `/loop_ftedit`. Sua missão é auditar o componente de ajuste e corte de imagens em [ImageAdjuster.tsx](file:///c:/Users/Gabriel/Documents/software%20Gerenciador%20ecossistema%20ikcous/projects/app_mkt_cliente_novo/src/components/ui/custom/ImageAdjuster.tsx) e suas integrações nas telas de produto [AdminProductFormView.tsx](file:///c:/Users/Gabriel/Documents/software%20Gerenciador%20ecossistema%20ikcous/projects/app_mkt_cliente_novo/src/views/admin/AdminProductFormView.tsx) e banners [AdminBannersView.tsx](file:///c:/Users/Gabriel/Documents/software%20Gerenciador%20ecossistema%20ikcous/projects/app_mkt_cliente_novo/src/views/admin/AdminBannersView.tsx), realizando de forma autônoma a próxima melhoria significativa de usabilidade, funcionalidade, desempenho ou estética.

---

## 🎯 Filosofia IKCOUS: "Completude Premium com Fricção Zero"

Qualquer evolução do componente `ImageAdjuster` deve seguir estas premissas fundamentais:
1. **Completude Absoluta**: Fornecer ferramentas poderosas para corte, rotação, zoom e avaliação de qualidade. O administrador deve sentir que tem o controle total do enquadramento final.
2. **Fricção Zero**: Facilitar a operação. Se o usuário puder dar duplo clique para centralizar, fazer gestos de pinça para zoom no mobile ou se o sistema sugerir a proporção recomendada automaticamente de acordo com o contexto, faça.
3. **Estética Excepcional**: A interface deve ser lindamente refinada (cantos arredondados, contrastes elegantes, indicação clara de qualidade da imagem, feedback visual tátil, animações fluidas via `framer-motion`).
4. **Precisão de Exportação**: O canvas deve gerar imagens de altíssima qualidade de forma performática, respeitando a rotação, o fator de zoom e centralização selecionados pelo usuário, exportando com qualidade ideal de compressão para o PWA (JPEG ~92%).

---
## 🔍 Ciclo de Investigação e Execução (Passo a Passo)

### ⚠️ Passo 0: Validação de Estabilidade e Funcionamento Atual (Mandatório)
Antes de propor ou implementar qualquer novo upgrade ou melhoria:
1. **Auditoria e Testes Atuais**: Você DEVE testar e auditar exaustivamente todas as funcionalidades atuais de corte, arraste, zoom, rotação, reset, tratamento de CORS e salvamento do `ImageAdjuster`.
2. **Garantia de Zero Bugs**: Confirme se tudo o que foi implementado em upgrades anteriores está funcionando 100% perfeitamente no ambiente atual (tanto nos produtos quanto nos banners).
3. **Priorização Absoluta de Correções**: Se identificar qualquer mau funcionamento, travamento, lentidão, bugs de layout ou erros lógicos, você **NÃO DEVE** iniciar um novo upgrade. O foco desta iteração passará a ser obrigatoriamente a correção e estabilização de tudo o que está quebrado. Não avance para novos recursos com pendências funcionais.
4. **Validação Estática Inicial**: Execute a suíte rápida para assegurar que a base existente compila e não possui erros de linter:
   `C:\Users\Gabriel\Documents\Ferramentas para projetos\Executar_Todas_Suites_Modo_Rapido.bat`

Apenas siga para a seleção de um novo upgrade (Passos 1 e 2) se for garantido que o estado atual está impecável e sem qualquer regressão.

### Passo 1: Auditoria do Estado Atual do Código
Analise detalhadamente o arquivo [ImageAdjuster.tsx](file:///c:/Users/Gabriel/Documents/software%20Gerenciador%20ecossistema%20ikcous/projects/app_mkt_cliente_novo/src/components/ui/custom/ImageAdjuster.tsx) e suas invocações nos formulários. Avalie:
1. **Mecanismo de Arraste e Zoom**: Como os eventos de toque e clique calculam as coordenadas e aplicam o clamp aos limites da imagem.
2. **Corte via Canvas**: Como a imagem original é carregada de forma assíncrona com `crossOrigin="anonymous"` e renderizada no canvas respeitando rotações de 90/180/270 graus.
3. **Desempenho**: Prevenção de travamentos ou atrasos em aparelhos móveis.
4. **Resiliência a Erros**: Como o componente trata imagens corrompidas ou erros de CORS do Supabase Storage.

### Passo 2: Seleção e Planejamento do Upgrade
Selecione de forma autônoma **uma ou mais melhorias de grande impacto** de usabilidade ou performance. Exemplos de caminhos de evolução:
*   **Gestos Touch Avançados**: Implementar detecção de gesto de pinça (*pinch-to-zoom*) e duplo clique/toque para redefinir o zoom e centralização no mobile.
*   **Filtros Rápidos & Ajustes de Imagem**: Adicionar controles deslizantes para ajustes básicos de imagem (Brilho, Contraste, Saturação e Escala de Cinza) diretamente na renderização do Canvas.
*   **Guias Visuais Profissionais**: Substituir a grade simples por guias dinâmicas baseadas na Regra dos Terços ou Proporção Áurea, melhorando a precisão visual do corte.
*   **Preview em Tempo Real Modificado**: Apresentar uma miniatura do resultado recortado em tempo real no rodapé do modal antes de salvar.
*   **Auto-Ajuste Inteligente (Contraste/Brilho)**: Analisar a luminosidade média da imagem e oferecer um botão "Melhorar Automaticamente" aplicando curvas de contraste.
*   **Resiliência Contra CORS**: Implementar tratamento robusto e transparente para imagens que falham no download do canvas devido a restrições de CORS.

Apresente uma justificativa clara da melhoria escolhida, detalhando o impacto na experiência do administrador.

### Passo 3: Implementação Cirúrgica
Modifique os arquivos de forma cirúrgica e segura.
*   **Nunca use placeholders**: O código deve ser completo e robusto.
*   **Preserve Recursos Legados**: Não quebre os presets existentes (`4:5`, `1:1`, `2:1`, `4:1`, `free`) e mantenha compatibilidade com as invocações de `AdminProductFormView.tsx` e `AdminBannersView.tsx`.
*   **Valide o Canvas**: Certifique-se de que a rotação e o zoom continuam sendo exportados com precisão matemática perfeita na imagem final recortada.

### Passo 4: Validação de Qualidade
*   Verifique se o projeto compila sem problemas.
*   Execute a suíte de qualidade rápida para homologar o código estaticamente:
    `C:\Users\Gabriel\Documents\Ferramentas para projetos\Executar_Todas_Suites_Modo_Rapido.bat`

### Passo 5: Ledger & Autorização
1.  Atualize o `walkthrough.md` com os detalhes da evolução implementada.
2.  Crie ou atualize o arquivo de autorização correspondente na pasta `C:\Users\Gabriel\Documents\software Gerenciador ecossistema ikcous\projects\authorizations\auth_` para autorizar a sincronização da melhoria no ecossistema.
