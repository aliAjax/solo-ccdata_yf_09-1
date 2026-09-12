import { chromium } from 'playwright';
import fs from 'node:fs';

const MOBILE = !!process.env.MOBILE;
const BASE = 'http://localhost:4173/';
const shots = MOBILE ? '/tmp/e2e-mobile-cmp' : '/tmp/e2e-cmp';
fs.mkdirSync(shots, { recursive: true });
let pass = 0;
const ok = (name, cond) => {
  if (!cond) throw new Error('断言失败: ' + name);
  console.log('  ✓ ' + name);
  pass++;
};

const browser = await chromium.launch();
const page = await browser.newPage(MOBILE
  ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
  : { viewport: { width: 1440, height: 900 } });
page.on('dialog', (d) => d.accept());

const noOverflow = async (name) => {
  if (!MOBILE) return;
  const info = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  ok(name, info.sw <= info.cw + 1);
};
const gotoWorkbench = async () => {
  const btn = MOBILE
    ? page.locator('.mobile-tabs button').nth(1)
    : page.locator('nav button').nth(1);
  await btn.click();
  await page.waitForSelector('.wb');
};

try {
  await page.goto(BASE);
  await page.evaluate(() => {
    localStorage.removeItem('research-workbench-v1');
    localStorage.removeItem('research-library');
  });
  await page.reload();
  await gotoWorkbench();

  // ---------- 1. 进入对比，默认 q1 vs q2 ----------
  await page.getByRole('button', { name: /⇄ 对比/ }).click();
  await page.waitForSelector('.cmp-picker');
  ok('对比面板出现', await page.locator('.cmp').isVisible());
  const cards = page.locator('.cmp-sum-card');
  const cardText = async (i) => (await cards.nth(i).innerText()).replace(/\s+/g, ' ');
  ok('共同文献 = 1（种子中仅 Extended Mind）', (await cardText(0)).startsWith('1'));
  ok('立场冲突 = 0', (await cardText(1)).startsWith('0'));
  ok('仅 A 有 = 1', (await cardText(2)).startsWith('1'));
  ok('仅 B 有 = 1', (await cardText(3)).startsWith('1'));
  ok('无冲突区块不渲染', (await page.locator('.cmp-section.conflict').count()) === 0);
  ok('共同（非冲突）区列出 Extended Mind',
    (await page.locator('.cmp-section:not(.conflict) .cmp-paper strong').allInnerTexts()).some((t) => t.includes('Extended Mind')));
  const onlyA = page.locator('.cmp-section.only-a');
  const onlyB = page.locator('.cmp-section.only-b');
  ok('仅 A 区是 Situated Learning', (await onlyA.locator('.cmp-paper strong').innerText()).includes('Situated Learning'));
  ok('仅 B 区是 Designing with Data', (await onlyB.locator('.cmp-paper strong').innerText()).includes('Designing with Data'));
  // 同篇共同文献两侧立场：支持 / 存疑
  const alignedStances = page.locator('.cmp-section:not(.conflict) .cmp-row').first().locator('.cmp-stance b');
  ok('共同文献两侧立场为 支持/存疑',
    (await alignedStances.nth(0).innerText()) === '支持' && (await alignedStances.nth(1).innerText()) === '存疑');
  await page.screenshot({ path: `${shots}/01-compare-seed.png`, fullPage: true });
  await noOverflow('对比面板无横向溢出');

  // ---------- 2. 选择相同问题 → 明确提示，结果隐藏 ----------
  const selB = page.locator('.cmp-picker select').nth(1);
  const selA = page.locator('.cmp-picker select').nth(0);
  await selB.selectOption(await selA.inputValue());
  await page.waitForSelector('.cmp-empty.warn');
  ok('同题警告出现', /不能将问题与自身对比/.test(await page.locator('.cmp-empty.warn').innerText()));
  ok('同题时不显示结果摘要', (await page.locator('.cmp-summary').count()) === 0);
  await noOverflow('同题警告无横向溢出');
  // 恢复：B 选回 q2
  const q2value = await page.locator('.cmp-picker select').nth(1)
    .evaluate((sel) => [...sel.options].find((o) => o.textContent.includes('情境化')).value);
  await selB.selectOption(q2value);
  await page.waitForSelector('.cmp-summary');

  // ---------- 3. 制造冲突：q1 关联 paper3（Designing with Data）为反驳（q2 中为支持） ----------
  await page.getByRole('button', { name: /✕ 退出对比|← 返回当前问题/ }).first().click();
  await page.waitForSelector('.cmp', { state: 'detached' });
  // 当前选中即 q1（认知…大脑内部）
  ok('已返回 q1 详情', (await page.locator('.wb-head h2').innerText()).includes('大脑内部'));
  await page.getByRole('button', { name: '＋ 关联文献为证据' }).click();
  const v = await page.locator('select.ctl').evaluate((sel) =>
    [...sel.options].find((o) => o.textContent.includes('Designing with Data')).value);
  await page.locator('select.ctl').selectOption(v);
  await page.locator('.stance-opt.ref').click();
  await page.locator('.modal textarea').nth(0).fill('对比测试：在 q1 下对此文持反驳立场，与 q2 的支持形成冲突。');
  await page.getByRole('button', { name: '建立关联' }).click();
  await page.waitForSelector('.modal', { state: 'detached' });

  // ---------- 4. 重新对比：出现 1 条立场冲突 ----------
  await page.getByRole('button', { name: /⇄ 对比/ }).click();
  await page.waitForSelector('.cmp-summary');
  ok('共同文献变为 2', (await cardText(0)).startsWith('2'));
  ok('立场冲突变为 1', (await cardText(1)).startsWith('1'));
  const conflictCard = cards.nth(1);
  ok('冲突卡为热点样式', (await conflictCard.getAttribute('class')).includes('hot'));
  const conflictRows = page.locator('.cmp-section.conflict .cmp-row');
  ok('冲突区 1 行', (await conflictRows.count()) === 1);
  ok('冲突行是 Designing with Data',
    (await conflictRows.locator('.cmp-paper strong').innerText()).includes('Designing with Data'));
  const cStances = conflictRows.locator('.cmp-stance b');
  ok('冲突两侧立场为 反驳 / 支持',
    (await cStances.nth(0).innerText()) === '反驳' && (await cStances.nth(1).innerText()) === '支持');
  ok('行内带冲突标记 ⚡', (await conflictRows.innerText()).includes('⚡'));
  await page.screenshot({ path: `${shots}/02-conflict.png`, fullPage: true });
  await noOverflow('冲突结果无横向溢出');

  // ---------- 5. 点文献标题 → 文献详情 ----------
  await conflictRows.locator('.cmp-paper strong').click();
  await page.waitForSelector('.detail h2');
  ok('跳转到文献详情：Designing with Data',
    (await page.locator('.detail h2').innerText()).includes('Designing with Data'));
  ok('文献详情显示其所属的两个问题 chips',
    (await page.locator('.q-chip').count()) >= 2);
  await page.screenshot({ path: `${shots}/03-jump-paper.png`, fullPage: true });

  // ---------- 6. 点立场块 → 跳回对应问题 ----------
  await gotoWorkbench();
  await page.getByRole('button', { name: /⇄ 对比/ }).click();
  await page.waitForSelector('.cmp-section.conflict');
  // A 侧立场块（反驳）→ 应回到 q1 详情
  await page.locator('.cmp-section.conflict .cmp-row .cmp-stance').first().click();
  await page.waitForSelector('.cmp', { state: 'detached' });
  ok('点立场块回到工作台详情', (await page.locator('.wb-head h2').innerText()).includes('大脑内部'));
  ok('回到的问题中该证据为反驳',
    (await page.locator('.evidence-card', { hasText: 'Designing with Data' }).locator('.stance-badge').innerText()) === '反驳');

  // ---------- 7. 无可比内容：建两个空问题再对比 ----------
  const makeEmptyQuestion = async (t) => {
    await page.getByRole('button', { name: '＋ 新建' }).click();
    await page.locator('.modal input').first().fill(t);
    await page.getByRole('button', { name: '创建问题' }).click();
    await page.waitForSelector('.modal', { state: 'detached' });
  };
  await makeEmptyQuestion('空问题甲');
  await makeEmptyQuestion('空问题乙');
  await page.getByRole('button', { name: /⇄ 对比/ }).click();
  await page.waitForSelector('.cmp-picker');
  const pick = async (idx, kw) => {
    const sel = page.locator('.cmp-picker select').nth(idx);
    const val = await sel.evaluate((s, k) =>
      [...s.options].find((o) => o.textContent.includes(k)).value, kw);
    await sel.selectOption(val);
  };
  await pick(0, '空问题甲');
  await pick(1, '空问题乙');
  await page.waitForSelector('.cmp-empty.block');
  const emptyText = await page.locator('.cmp-empty.block').innerText();
  ok('两个空问题显示「暂无可比内容」', /暂无可比内容/.test(emptyText));
  ok('提示中点名了两个问题', emptyText.includes('空问题甲') && emptyText.includes('空问题乙'));
  ok('提供两个「去关联」按钮', (await page.locator('.cmp-empty.block button').count()) === 2);
  await page.screenshot({ path: `${shots}/04-no-evidence.png`, fullPage: true });
  await noOverflow('空内容提示无横向溢出');
  await page.getByRole('button', { name: /去「空问题甲」关联/ }).click();
  await page.waitForSelector('.cmp', { state: 'detached' });
  ok('点击后回到空问题甲的详情', (await page.locator('.wb-head h2').innerText()).includes('空问题甲'));

  // ---------- 8. 原功能回归：覆盖/筛选仍正常 ----------
  await page.locator('.q-item', { hasText: '大脑内部' }).click();
  ok('q1 证据 3 条（原 2 + 冲突 1）', (await page.locator('.evidence-card').count()) === 3);
  await page.getByRole('button', { name: /^反驳/ }).click();
  ok('立场筛选「反驳」= 1', (await page.locator('.evidence-card').count()) === 1);

  console.log(`\n${MOBILE ? '手机' : '桌面'}对比流程全部 ${pass} 项断言通过。截图: ${shots}`);
} catch (e) {
  await page.screenshot({ path: `${shots}/FAIL.png`, fullPage: true }).catch(() => {});
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
