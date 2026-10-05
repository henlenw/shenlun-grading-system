-- Application-only RPC. Never grant clients access to the application tables or service key.
-- Preview statements run in a PostgreSQL subtransaction which is ALWAYS rolled back.
-- Commit executes the entire plan and checks each previously observed result under one lock.
CREATE SCHEMA IF NOT EXISTS kaoba_private;
REVOKE ALL ON SCHEMA kaoba_private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS kaoba_private.receipts (
  id uuid PRIMARY KEY,
  fingerprint text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON kaoba_private.receipts FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS receipts_created_at_idx ON kaoba_private.receipts(created_at);

CREATE OR REPLACE FUNCTION public.kaoba_sql_transaction(p_steps jsonb, p_commit boolean, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  claims jsonb := COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  step jsonb;
  statement text;
  result jsonb;
  response jsonb;
  names jsonb;
  types jsonb;
  rows_json jsonb;
  projection text;
  digest text;
  fingerprint text := encode(sha256(convert_to(p_steps::text, 'UTF8')), 'hex');
  previous kaoba_private.receipts%ROWTYPE;
  count_rows bigint;
BEGIN
  -- CloudBase's gateway can expose RPC names even after REVOKE EXECUTE. This explicit guard
  -- must run before ALL table access, dynamic SQL, and idempotency receipt lookup.
  IF COALESCE(claims->>'role', '') <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Server credential required';
  END IF;
  IF p_id IS NULL OR p_commit IS NULL OR jsonb_typeof(p_steps) <> 'array'
     OR jsonb_array_length(p_steps) NOT BETWEEN 1 AND 1000
     OR octet_length(p_steps::text) > 8388608 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid transaction plan';
  END IF;
  -- All app writes use this gate. The lock is held only during this HTTP request's database
  -- transaction, never across network roundtrips. New rows (phantoms) are covered by replay.
  PERFORM pg_advisory_xact_lock(167, 20261005);
  IF p_commit THEN
    SELECT * INTO previous FROM kaoba_private.receipts WHERE id = p_id;
    IF FOUND THEN
      IF previous.fingerprint <> fingerprint THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Request id reused';
      END IF;
      RETURN previous.response;
    END IF;
  END IF;
  BEGIN
    FOR step IN SELECT value FROM jsonb_array_elements(p_steps) LOOP
      statement := rtrim(btrim(step->>'sql'), ';');
      IF statement IS NULL OR statement !~* '^(SELECT|INSERT|UPDATE|DELETE|WITH)\s'
         OR step->>'mode' NOT IN ('rows', 'count') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Unsupported statement';
      END IF;
      IF step->>'mode' = 'count' THEN
        EXECUTE statement;
        GET DIAGNOSTICS count_rows = ROW_COUNT;
        result := to_jsonb(count_rows);
      ELSE
        -- A temporary result relation preserves PostgreSQL column types even for an empty set.
        -- The CTE also supports INSERT/UPDATE/DELETE ... RETURNING from Prisma.
        DROP TABLE IF EXISTS pg_temp.kaoba_result;
        EXECUTE 'CREATE TEMP TABLE kaoba_result ON COMMIT DROP AS WITH kaoba_data AS ('
          || statement || ') SELECT * FROM kaoba_data';
        SELECT jsonb_agg(attname ORDER BY attnum),
          jsonb_agg(CASE atttypid
            WHEN 21 THEN 0 WHEN 23 THEN 0 WHEN 20 THEN 1
            WHEN 700 THEN 2 WHEN 701 THEN 3 WHEN 1700 THEN 4
            WHEN 16 THEN 5 WHEN 18 THEN 6 WHEN 1082 THEN 8
            WHEN 1083 THEN 9 WHEN 1114 THEN 10 WHEN 1184 THEN 10
            WHEN 114 THEN 11 WHEN 3802 THEN 11 WHEN 17 THEN 13
            WHEN 2950 THEN 15 ELSE 7 END ORDER BY attnum),
          string_agg(CASE WHEN atttypid IN (20,1700,114,3802) THEN format('%I::text', attname)
            ELSE format('%I', attname) END, ',' ORDER BY attnum)
          INTO names, types, projection
          FROM pg_attribute WHERE attrelid = 'pg_temp.kaoba_result'::regclass
            AND attnum > 0 AND NOT attisdropped;
        EXECUTE 'SELECT COALESCE(jsonb_agg(jsonb_build_array(' || projection
          || ')), ''[]''::jsonb) FROM pg_temp.kaoba_result' INTO rows_json;
        result := jsonb_build_object('columnNames', names, 'columnTypes', types, 'rows', rows_json);
      END IF;
      digest := encode(sha256(convert_to(result::text, 'UTF8')), 'hex');
      IF step ? 'expected' AND step->>'expected' IS DISTINCT FROM digest THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Concurrent data change';
      END IF;
    END LOOP;
    response := jsonb_build_object('result', result, 'digest', digest);
    IF NOT p_commit THEN
      -- An exception rolls back every preview write, including nested writes and temporary DDL.
      -- PL/pgSQL variables retain their values outside this rolled-back subtransaction.
      RAISE EXCEPTION USING ERRCODE = 'KB001', MESSAGE = 'Preview rollback';
    END IF;
  EXCEPTION WHEN SQLSTATE 'KB001' THEN NULL;
  END;
  IF p_commit THEN
    INSERT INTO kaoba_private.receipts(id, fingerprint, response) VALUES(p_id, fingerprint, response);
    -- Seven days exceeds all adapter retry windows. No client retries after a process restart.
    DELETE FROM kaoba_private.receipts WHERE created_at < now() - interval '7 days';
  END IF;
  RETURN response;
END;
$function$;
REVOKE ALL ON FUNCTION public.kaoba_sql_transaction(jsonb, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kaoba_sql_transaction(jsonb, boolean, uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
