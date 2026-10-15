// Self-test for the runner's save protection: writes a probe file into save/
// from inside the running game. A correct run must report the rollback and
// leave no probe file behind after exit.
// Run: node tools/e2e/run.mjs tools/e2e/scenarios/save-guard-selftest.mjs

export default async function saveGuardSelftest(t) {
  await t.waitFor(
    `typeof SceneManager !== 'undefined' && !!SceneManager._scene`,
    { timeout: 120000, poll: 500, desc: 'game booted' }
  );
  await t.eval(`require('fs').writeFileSync('save/e2e_guard_probe.txt', 'probe')`);
  const exists = await t.eval(`require('fs').existsSync('save/e2e_guard_probe.txt')`);
  t.assert(exists, 'probe file written from inside the game');
  t.log('probe written; the runner must remove it during rollback');
}
