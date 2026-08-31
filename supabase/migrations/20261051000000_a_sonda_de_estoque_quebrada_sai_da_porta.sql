-- A SONDA DE ESTOQUE QUEBRADA SAI DA PORTA (laudo ofensiva+mobile do molde,
-- 31/08/2026, achado N9, faxina autorizada pelo Gabriel com "siga").
--
-- O DEFEITO PROVADO AO VIVO: `check_stock_v1` é SECURITY DEFINER com EXECUTE
-- para anon e referencia `produtos.stock` — coluna que NÃO EXISTE (é
-- `estoque`). Toda chamada morre com `42703 column "stock" does not exist`
-- (provado em 31/08 com a chave anônima). É função morta na porta da casa:
-- nenhuma tela chama (só sobrevive no database.types.ts, tipo solto), e
-- quando estava viva era um oráculo booleano de estoque para quem chamasse
-- direto.
--
-- O que muda aqui: DROP da função. Nada no app a referencia (conferido por
-- grep em src/ — único vestígio é a entrada de tipos em
-- src/types/database.types.ts:1981, que não executa nada; a entrada sai no
-- próximo regen dos tipos, e removê-la à mão não é parte desta migration).
--
-- SEM BEGIN/COMMIT (regra da casa).

DROP FUNCTION IF EXISTS public.check_stock_v1(uuid, uuid, integer);
