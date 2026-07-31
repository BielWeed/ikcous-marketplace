# ADR NNNN — Título curto, no infinitivo, dizendo a decisão e não o problema

- **Data:** DD/MM/AAAA
- **Estado:** Proposta | Aceito | Substituído pelo ADR NNNN (`NNNN-slug.md`) | Recusado
- **Decide:** Gabriel | Netim | os dois
- **Cartão relacionado:** `AREA-NNN` ou "nenhum"

## Contexto

O que forçou esta decisão a existir, em 3 a 6 linhas. Escrito para alguém que não estava na
conversa e vai ler isto daqui a seis meses.

Traga a evidência: `arquivo:linha`, número de achado da auditoria, ou a saída do comando que
mostra o problema. Contexto sem evidência vira opinião com data.

## Opções consideradas

Pelo menos duas. Se só existe uma, não é decisão — é implementação, e não precisa de ADR.

### Opção A — nome

O que é, o que custa, o que quebra.

### Opção B — nome

Idem.

## Decisão

Qual opção, em uma frase. Sem hedge, sem "provavelmente".

**Por quê:** o motivo que fez esta ganhar das outras. Se foi por restrição externa (preço,
plano do GitHub, tempo), diga que foi — decisão tomada por restrição é decisão legítima e
precisa ser reconhecível como tal quando a restrição sumir.

## Consequências

- O que passa a ser verdade a partir de agora
- O que fica pior, e a gente aceitou
- O que precisa ser feito por causa disto — cada item vira cartão, com o ID aqui
- Se houve desacordo, **registre aqui quem discordou e por quê.** Desacordo apagado volta
  daqui a três meses como retrabalho

## Quando revisar

Uma condição observável, não uma data solta. Exemplos: "quando o repositório sair do plano
Free", "se a loja passar de 500 pedidos por mês", "quando `INFRA-150` mergear".

Se não existir condição de revisão, escreva "não previsto" — mas pense duas vezes antes.

## Cartões desbloqueados por esta decisão

Lista de IDs. É o item D3 da
[Definition of Done de cartão `decisao`](../processo/DEFINITION-OF-DONE.md#definition-of-done--cartão-de-decisao-ou-doc):
cada um recebe um comentário dizendo o que a decisão mudou nele. Se a decisão não desbloqueou
nada, escreva "nenhum" — e considere se ela precisava ser um ADR.

---

<!--
Como usar este arquivo:

1. Copie para NNNN-slug-curto.md, com NNNN sequencial (0001, 0002, ...).
2. Abra em estado "Proposta", num PR de docs/.
3. O outro comenta no PR. Sem consenso em 2 dias, decide quem vai manter o código —
   e o desacordo fica escrito em Consequências.
4. Ao mergear, mude o estado para "Aceito" e acrescente a linha no índice do README.md.

ADR aceito NÃO se edita, com UMA exceção: o campo Estado, quando um ADR novo o substitui.
Corpo, contexto, opções e decisão nunca mudam. Mudou de ideia? Escreva um ADR novo e marque
o antigo como "Substituído pelo ADR NNNN". A história da decisão é metade do valor do
registro.
-->
