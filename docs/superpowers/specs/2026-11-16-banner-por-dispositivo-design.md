# Banner com imagens independentes por dispositivo

Aprovado por Gabriel em 2026-11-16, na conversa desta sessão.

## Objetivo

Cada banner permite configurar uma imagem para celular (2:1) e outra para computador (4:1), inclusive artes diferentes. Enviar ou recortar uma versão não altera a outra. Texto, link, ordem, ativação e programação continuam compartilhados.

## Compatibilidade e segurança

**Correção solicitada por Gabriel em 2026-11-17:** não existe substituição entre dispositivos. O campo atual `imageUrl` é a imagem de celular; `desktopImageUrl` guarda a versão de computador. Sem imagem de computador, esse banner não entra na vitrine do computador, mas continua no celular e no painel. As listas, indicadores e pré-carregamento seguem a mesma seleção. A troca de imagem só descarta arquivos que não sejam usados pela outra versão; cancelar, recuperar rascunho e uploads atrasados preservam o mesmo isolamento.

O recorte é iniciado para uma versão explícita e não pode trocar de destino ao mudar a seleção do editor. As proporções e a prévia devem corresponder ao dispositivo. Nenhuma imagem existente é convertida, apagada ou sobrescrita automaticamente.

## Abordagens

- Somente mudar o recorte da imagem compartilhada: rejeitada, pois salva por cima da outra versão e não resolve o pedido.
- Criar dois banners completos: rejeitada, pois duplica texto, link, programação e ordem, que devem continuar comuns.
- Acrescentar imagem opcional de computador ao mesmo banner: escolhida, separa as artes e preserva os banners atuais.

## Entrega e limites

Seguir React/TypeScript e componentes já existentes; não acrescentar dependências. Mudança aditiva no banco, com tipos e mapeamentos atualizados. Testes cobrem leitura, escrita, cache, rascunho, cancelamento, conclusão tardia do upload e seleção responsiva. Não alterar outras regras da vitrine nem gerar imagens com IA. Publicação depende dos portões de revisão e da presença da coluna no banco; implementação local não equivale a publicação.

## Conta dos dois lados

Melhora: o visitante vê a arte adequada e a pessoa que configura não perde o ajuste do outro aparelho. Risco: regressão no fluxo de upload e descarte de imagens. Conserto: manter o campo antigo, testar referências cruzadas e usar migration aditiva. Bem maior: preservar banners e arquivos que já funcionam, mesmo sem versão nova configurada.
