const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(600);
  await p.locator('input[type="password"]').fill('123456');
  await p.locator('input[type="password"]').press('Enter');
  await p.waitForTimeout(1200);
  await p.locator('[data-testid="project-switcher"]').click();
  await p.locator('[data-testid="project-row"]').first().click();
  await p.waitForTimeout(2500);

  console.log('before:', (await p.locator('[data-testid="session-row"]').first().innerText()).split('\n')[0]);
  await p.locator('[data-testid="session-rename"]').first().click();
  await p.locator('[data-testid="session-rename-input"]').fill('文档重构与验收');
  await p.locator('[data-testid="session-rename-input"]').press('Enter');
  await p.waitForTimeout(1200);
  console.log('after:', (await p.locator('[data-testid="session-row"]').first().innerText()).split('\n')[0]);

  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  console.log('after reload:', (await p.locator('[data-testid="session-row"]').first().innerText()).split('\n')[0]);
  await p.screenshot({ path: '/tmp/renamed.png' });
  await b.close();
})();
