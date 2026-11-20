-- Desfaz so o indice novo; preserva a restricao UNIQUE(code) do baseline.
SET LOCAL lock_timeout = '5s';

DROP INDEX IF EXISTS public.coupons_code_upper_uidx;
