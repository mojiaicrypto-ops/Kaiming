const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(600);
  await p.locator('input[type="password"]').fill('123456');
  await p.locator('input[type="password"]').press('Enter');
  await p.waitForTimeout(1500);
  await p.goto('http://127.0.0.1:4173/settings/providers', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1500);

  // 1) Fix the existing provider: name it and bind the protocol its endpoint actually answers.
  await p.locator('[data-testid="provider-edit"]').first().click();
  await p.locator('[data-testid="provider-name"]').fill('本地代理');
  const before = await p.locator('[data-testid="provider-api"]').inputValue();
  console.log('existing api was:', JSON.stringify(before));
  await p.locator('[data-testid="provider-api"]').selectOption('openai-completions');
  await p.locator('[data-testid="provider-save"]').click();
  await p.waitForTimeout(1500);
  console.log('row:', (await p.locator('.prov').first().innerText()).replace(/\n/g, ' | '));

  // 2) Register the provider that only existed in models.json, keeping its stored key.
  await p.locator('[data-testid="add-provider"]').click();
  await p.locator('[data-testid="provider-name"]').fill('DeepSeek');
  await p.locator('[data-testid="provider-id"]').fill('deepseek');
  await p.locator('[data-testid="provider-base"]').fill('https://api.deepseek.com/v1');
  await p.locator('[data-testid="provider-api"]').selectOption('openai-completions');
  await p.locator('[data-testid="provider-models"]').fill('deepseek-flash');
  await p.locator('[data-testid="provider-save"]').click();
  await p.waitForTimeout(1500);
  console.log('rows:', await p.locator('.prov').count());
  await p.screenshot({ path: '/tmp/providers.png' });
  await b.close();
})();
