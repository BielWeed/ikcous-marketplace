// Two actual psql backends; a catalog-observed lock is the ordering barrier.
const assert = require("node:assert/strict");
const { setTimeout: delay } = require("node:timers/promises");

module.exports = async function concurrency({ db, sql, docker, container }) {
  const literal = (value) => `'${value.replaceAll("'", "''")}'`;
  const admin = `BEGIN; SET LOCAL statement_timeout='20s'; SET LOCAL lock_timeout='15s'; SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claims='{"sub":"11111111-1111-4111-8111-111111111111"}';`;
  const original = JSON.parse(
    sql(db, "SELECT to_jsonb(s) FROM public.store_config s WHERE id=1;"),
  );
  const base = JSON.parse(sql(db, "SELECT public.a2_package();"));
  const url = (assets) =>
    `https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/branding/${assets.header.path}`;
  const payloadA = {
    store_name: "Concurrent A",
    secondary_color: "#111111",
    branding_assets: JSON.parse(
      JSON.stringify(base).replaceAll("a".repeat(64), "b".repeat(64)),
    ),
  };
  payloadA.logo_url = url(payloadA.branding_assets);
  const payloadB = {
    store_name: "Concurrent B",
    accent_color: "#222222",
    branding_assets: JSON.parse(
      JSON.stringify(base).replaceAll("a".repeat(64), "c".repeat(64)),
    ),
  };
  payloadB.logo_url = url(payloadB.branding_assets);

  function start(name, source, finish) {
    const child = docker(
      [
        "exec",
        "-i",
        "--env",
        "PGPASSWORD=postgres",
        container,
        "psql",
        "-U",
        "postgres",
        "-d",
        db,
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        "VERBOSITY=verbose",
      ],
      undefined,
      container,
      true,
    );
    const state = { child, stdout: "", stderr: "", exited: false };
    child.stdout.on("data", (chunk) => {
      state.stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      state.stderr += chunk;
    });
    state.done = new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => {
        state.exited = true;
        resolve(code);
      });
    });
    const input = `SET application_name=${literal(name)};\n${source}\n`;
    if (finish) child.stdin.end(input);
    else child.stdin.write(input);
    return state;
  }
  async function until(predicate, label) {
    const end = Date.now() + 12000;
    while (Date.now() < end) {
      if (predicate()) return;
      await delay(80);
    }
    assert.fail(label);
  }
  async function race(kind, second, expectedError) {
    const appA = `identity_a2_${kind}_a`;
    const appB = `identity_a2_${kind}_b`;
    const first = start(
      appA,
      `${admin} SELECT public.upsert_store_config(${literal(JSON.stringify(payloadA))}); SELECT 'A2_LOCK_HELD';`,
      false,
    );
    let next;
    try {
      await until(
        () => first.stdout.includes("A2_LOCK_HELD") || first.exited,
        "first transaction never acquired row",
      );
      assert.equal(first.exited, false, first.stderr);
      next = start(
        appB,
        `${admin} SELECT public.upsert_store_config(${literal(JSON.stringify(second))}); COMMIT;`,
        true,
      );
      await until(() => {
        assert.equal(next.exited, false, next.stderr);
        return (
          sql(
            db,
            `SELECT count(*) FROM pg_stat_activity WHERE datname=${literal(db)} AND application_name=${literal(appB)} AND wait_event_type='Lock';`,
          ) === "1"
        );
      }, "second backend never blocked on the first");
      const sessions = sql(
        db,
        `SELECT count(DISTINCT pid) FROM pg_stat_activity WHERE datname=${literal(db)} AND application_name IN (${literal(appA)},${literal(appB)});`,
      );
      assert.equal(sessions, "2", "must be distinct live SQL sessions");
      first.child.stdin.end("COMMIT;\n");
      assert.equal(await first.done, 0, first.stderr);
      const code = await next.done;
      if (expectedError) {
        assert.notEqual(code, 0, "stale package must be refused");
        assert.match(next.stderr, expectedError);
      } else assert.equal(code, 0, next.stderr);
      const row = JSON.parse(
        sql(db, "SELECT to_jsonb(s) FROM public.store_config s WHERE id=1;"),
      );
      const expected = expectedError ? payloadA : payloadB;
      assert.equal(row.logo_url, expected.logo_url);
      assert.deepEqual(row.branding_assets, expected.branding_assets);
      assert.equal(row.store_name, expected.store_name);
      assert.equal(
        row.secondary_color,
        payloadA.secondary_color,
        "second omitted color preserves first committed color",
      );
      if (!expectedError) assert.equal(row.accent_color, payloadB.accent_color);
      assert.equal(
        sql(db, "SELECT count(*) FROM public.store_config WHERE id=1;"),
        "1",
      );
      console.log(
        `PASS concurrent ${kind}: two backends and observed lock; ${expectedError ? "stale package rejected 23514 atomically" : "both commits, second wins whole package; omitted color preserved"}`,
      );
    } finally {
      if (!first.exited) first.child.stdin.end("ROLLBACK;\n");
      await first.done;
      if (next) await next.done;
    }
  }

  await race("full_update", payloadB);
  const stale = {
    store_name: "Must not persist stale name",
    branding_assets: payloadB.branding_assets,
  };
  await race(
    "stale_omitted_logo",
    stale,
    /23514:.*store_config_branding_logo_a2_check/,
  );
  // Also prove INSERT arbitration when the singleton did not exist before either call.
  sql(db, "DELETE FROM public.store_config WHERE id=1;");
  await race("initial_insert", payloadB);
  // Keep the legacy rollback probe on a complete fixture with original old fields.
  sql(
    db,
    `UPDATE public.store_config SET home_sections=${literal(JSON.stringify(original.home_sections))}::jsonb WHERE id=1;`,
  );
};
