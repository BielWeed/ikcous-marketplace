-- ROLLBACK MANUAL da 20261024000000_custo_zero_deixa_de_ser_ausencia.sql
-- (custo zero deixa de ser ausência — DROP NOT NULL em produtos.custo)
--
-- ORDEM OBRIGATÓRIA: o UPDATE ANTES do SET NOT NULL. Reverter com a coluna
-- aceitando NULL falha se existir qualquer linha com custo NULL — e depois
-- deste conserto existem, por construção (produtos cadastrados sem custo).
--
-- EFEITO COLATERAL HONESTO: o UPDATE zera os produtos sem custo medido, e a
-- partir daí o painel volta a FUNIR "sem custo" com "custo zero" (o estado
-- de antes do conserto — o defeito do item 3 do laudo volta a existir). É a
-- semântica antiga de volta, não uma perda nova.

UPDATE public.produtos SET custo = 0 WHERE custo IS NULL;

ALTER TABLE public.produtos ALTER COLUMN custo SET NOT NULL;
