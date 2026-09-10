// Ordering uses two actual backends and pg_blocking_pids, not elapsed sleep.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");
module.exports = async function concurrency({
  db,
  sql,
  open,
  admin,
  lit,
  log,
}) {
  const read = () =>
    JSON.parse(sql(db, `${admin}SELECT public.read_store_identity();`));
  const save = (snapshot, desired) =>
    `SELECT public.save_store_identity(${lit(snapshot.revision)},${lit(JSON.stringify(snapshot.identity))},${lit(JSON.stringify(desired))});`;
  const legacy = (patch) =>
    `SELECT public.upsert_store_config(${lit(JSON.stringify(patch))});`;
  const sessions = [];
  function start(name, body, finish) {
    const child = open();
    const state = { child, stdout: "", stderr: "", exited: false };
    sessions.push(state);
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
    const source = `SET application_name=${lit(name)}; BEGIN; SET LOCAL statement_timeout='20s'; ${admin}\n${body}\n`;
    if (finish) child.stdin.end(source);
    else child.stdin.write(source);
    return state;
  }
  async function until(predicate, message) {
    const limit = Date.now() + 12000;
    while (Date.now() < limit) {
      if (predicate()) return;
      await delay(60);
    }
    assert.fail(message);
  }
  async function race(
    kind,
    firstIsLegacy,
    operational = false,
    recreate = false,
  ) {
    const a = read();
    const desiredA = {
      ...a.identity,
      store_name: `Winner ${kind}`,
      store_city: `City ${kind}`,
      primary_color: "#334455",
    };
    const desiredB = {
      ...a.identity,
      store_name: `Second ${kind}`,
      store_city: `Other ${kind}`,
      primary_color: "#665544",
    };
    // PostgreSQL limits application_name to 63 bytes; keep the distinguishing suffix.
    const sessionId = randomUUID().slice(0, 12);
    const appA = `identity_a5_${sessionId}_a`;
    const appB = `identity_a5_${sessionId}_b`;
    const firstWrite = recreate
      ? `DELETE FROM public.store_config WHERE id=1;${legacy(a.identity)}`
      : firstIsLegacy
        ? legacy(operational ? { shipping_fee: 37.45 } : desiredA)
        : save(a, desiredA);
    const first = start(appA, `${firstWrite}SELECT 'A5_LOCK_HELD';`, false);
    let second;
    try {
      await until(
        () => first.stdout.includes("A5_LOCK_HELD") || first.exited,
        "first backend did not hold row",
      );
      assert.equal(first.exited, false, first.stderr);
      second = start(appB, `${save(a, desiredB)}COMMIT;`, true);
      let observed;
      await until(() => {
        assert.equal(second.exited, false, second.stderr);
        observed = JSON.parse(
          sql(
            db,
            `SELECT coalesce(jsonb_agg(jsonb_build_object('waiter',b.pid,'blocker',a.pid,'wait',b.wait_event_type)),'[]') FROM pg_stat_activity a JOIN pg_stat_activity b ON a.pid=ANY(pg_blocking_pids(b.pid)) WHERE a.datname=${lit(db)} AND b.datname=${lit(db)} AND a.application_name=${lit(appA)} AND b.application_name=${lit(appB)};`,
          ),
        );
        return observed.length === 1;
      }, "second backend never blocked on first backend");
      assert.notEqual(observed[0].waiter, observed[0].blocker);
      assert.equal(observed[0].wait, "Lock");
      log(`LOCK ${kind}: ${JSON.stringify(observed)}`);
      first.child.stdin.end("COMMIT;\n");
      assert.equal(await first.done, 0, first.stderr);
      const secondCode = await second.done;
      if (operational) assert.equal(secondCode, 0, second.stderr);
      else {
        assert.notEqual(secondCode, 0);
        assert.match(
          second.stderr,
          recreate ? /P0002:.*IDENTITY_MISSING/ : /P0001:.*IDENTITY_CONFLICT/,
        );
      }
      assert.deepEqual(
        read().identity,
        recreate ? a.identity : operational ? desiredB : desiredA,
        "whole winning snapshot, no mixed identity",
      );
      if (recreate)
        assert.notEqual(
          read().revision,
          a.revision,
          "recreated equal identity has a new occurrence",
        );
      if (operational)
        assert.equal(
          sql(db, "SELECT shipping_fee FROM public.store_config WHERE id=1;"),
          "37.45",
        );
      log(
        `PASS concurrent ${kind}: ${recreate ? "waiting old row disappears; recreated equal identity retained with new revision" : operational ? "both commit; operational field survives" : "first confirms; waiting stale intent conflicts atomically"}`,
      );
    } finally {
      if (!first.exited && !first.child.stdin.writableEnded)
        first.child.stdin.end("ROLLBACK;\n");
      await first.done;
      if (second) await second.done;
    }
  }
  await race("two_new_intents", false);
  await race("old_identity_first", true);
  await race("old_operational_first", true, true);
  await race("old_delete_recreate", true, false, true);
  const a = read();
  sql(db, admin + save(a, { ...a.identity, store_name: "New API committed" }));
  sql(db, admin + legacy({ store_name: "Old writer later still wins" }));
  assert.equal(read().identity.store_name, "Old writer later still wins");
  assert(sessions.every((session) => session.exited));
  log(
    "PASS legacy writer after new commit retains previous write policy; no retroactive intention check claimed",
  );
};
