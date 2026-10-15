// Smoke test: the game boots under the SDK binary, reaches the title screen,
// core data is loaded, and the mod loader is active.
// Run: node tools/e2e/run.mjs tools/e2e/scenarios/smoke.mjs

export default async function smoke(t) {
  t.log('waiting for the title screen (splash videos may take a while)...');
  await t.waitFor(
    `typeof SceneManager !== 'undefined' && SceneManager._scene &&
     SceneManager._scene.constructor && SceneManager._scene.constructor.name === 'Scene_Title'`,
    { timeout: 120000, poll: 500, desc: 'Scene_Title active' }
  );

  const title = await t.eval(`$dataSystem && $dataSystem.gameTitle`);
  t.log(`game title: ${JSON.stringify(title)}`);
  t.assert(!!title, '$dataSystem loaded');

  const hasInjector = await t.eval(
    `typeof $plugins !== 'undefined' && $plugins.some(p => p.name === 'ModLoader_Injector')`
  );
  t.assert(hasInjector, 'ModLoader_Injector present in $plugins');

  const consoleText = t.consoleText();
  t.assert(/\[Mod Loader\]/i.test(consoleText), 'console contains [Mod Loader] lines');

  await t.shot('title');
}
