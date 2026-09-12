import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'http://localhost:4173/';
const shots = '/tmp/e2e-mobile';
fs.mkdirSync(shots, { recursive: true });
let pass = 0;
const ok = (name, cond) => {
  if (!cond) throw new Error('断言失败: ' + name);
  console.log('  ✓ ' + name);
  pass++;
};

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  acceptDownloads: true,
});
page.on('dialog', (d) => d.accept());

// 收集控制台错误
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

// 检测横向溢出与“固定元素超出视口”
const overflowInfo = async () => page.evaluate(() => {
  const docW = document.documentElement.clientWidth;
  const bad = [];
  document.querySelectorAll('*').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    if (r.right > docW + 1 || r.left < -1) {
      const cls = (el.className && el.className.toString) ? el.className.toString().slice(0, 40) : el.tagName;
      bad.push(`${el.tagName}.${cls} left=${Math.round(r.left)} right=${Math.round(r.right)} vw=${docW}`);
    }
  });
  return { docW, scrollW: document.documentElement.scrollWidth, bad: bad.slice(0, 8) };
});

// 弹窗是否完整可见、未被遮挡（关闭/提交按钮可点）
const modalFits = async (submitName) => {
  const modal = page.locator('.modal');
  await modal.waitFor();
  const box = await modal.boundingBox();
  const vp = page.viewportSize();
  const submit = page.getByRole('button', { name: submitName });
  const sb = await submit.boundingBox();
  const inViewport = (b) => b && b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width && b.y + b.height <= vp.height;
  // 提交按钮即使在滚动区外，也滚动到可见后可点
  await submit.scrollIntoViewIfNeeded();
  await submit.waitFor({ state: 'visible' });
  return {
    widthOk: box.width <= vp.width,
    submitVisible: inViewport(await submit.boundingBox()),
  };
};

try {
  await page.goto(BASE);
  await page.evaluate(() => {
    localStorage.removeItem('research-workbench-v1');
    localStorage.removeItem('research-library');
  });
  await page.reload();

  // ---------- 0. 桌面侧栏在窄屏消失，移动标签栏出现 ----------
  await page.waitForSelector('.mobile-tabs');
  ok('移动标签栏可见', await page.locator('.mobile-tabs').isVisible());
  const tabs = page.locator('.mobile-tabs button');
  ok('有 2 个切换标签', (await tabs.count()) === 2);
  const asideBox = await page.locator('aside').boundingBox();
  ok('桌面侧栏已隐藏', asideBox === null || asideBox.width === 0 || asideBox.height === 0);

  // ---------- 1. 初始停在文献库，标签可切换 ----------
  ok('默认显示文献库 header', await page.locator('header h1').innerText() === '所有文献');
  let ov = await overflowInfo();
  ok('文献库无横向溢出', ov.scrollW <= ov.docW + 1);

  await tabs.nth(1).click();
  await page.waitForSelector('.wb');
  ok('切换到工作台，显示问题列表', await page.locator('.q-item').first().isVisible());
  ok('默认选中第一个种子问题', (await page.locator('.q-item.on').count()) === 1);
  await page.screenshot({ path: `${shots}/01-workbench-mobile.png`, fullPage: true });
  ov = await overflowInfo();
  ok('工作台无横向溢出', ov.scrollW <= ov.docW + 1);

  // ---------- 2. 创建问题（弹窗适配检查） ----------
  await page.getByRole('button', { name: '＋ 新建' }).click();
  let fit = await modalFits('创建问题');
  ok('创建问题弹窗宽度不超屏', fit.widthOk);
  ok('创建按钮滚动后可见可点', fit.submitVisible);
  const TITLE = '窄屏测试：外部符号算不算认知的一部分？';
  await page.locator('.modal input').first().fill(TITLE);
  await page.locator('.modal textarea').first().fill('手机宽度下创建的问题。');
  await page.screenshot({ path: `${shots}/02-create-dialog.png`});
  await page.getByRole('button', { name: '创建问题' }).click();
  await page.waitForSelector('.modal', { state: 'detached' });
  ok('新问题已创建并显示', (await page.locator('.wb-head h2').innerText()) === TITLE);
  ok('新建后未关联文献 4 篇', (await page.locator('.unlinked-item').count()) === 4);

  // ---------- 3. 关联文献（长弹窗：select/立场/摘录/批注） ----------
  await page.getByRole('button', { name: '＋ 关联文献为证据' }).click();
  await page.locator('.modal h2').waitFor();
  fit = await modalFits('建立关联');
  ok('关联弹窗宽度不超屏', fit.widthOk);
  ok('建立关联按钮滚动后可见可点', fit.submitVisible);
  // 移动端点触 select：用 value 选择
  const value = await page.locator('select.ctl').evaluate((sel, kw) => {
    const opt = [...sel.options].find((o) => o.textContent.includes(kw));
    return opt.value;
  }, 'Extended Mind');
  await page.locator('select.ctl').selectOption(value);
  await page.locator('.stance-opt.ref').click();
  await page.locator('.modal textarea').nth(0).fill('窄屏下录入的反驳摘录：外部符号只是被认知调用的工具，而非认知本身。');
  await page.locator('.modal textarea').nth(1).fill('手机批注');
  await page.screenshot({ path: `${shots}/03-link-dialog.png`});
  ov = await overflowInfo();
  ok('关联弹窗打开时无横向溢出', ov.scrollW <= ov.docW + 1);
  await page.getByRole('button', { name: '建立关联' }).click();
  await page.waitForSelector('.modal', { state: 'detached' });
  ok('证据卡出现且立场为反驳',
    (await page.locator('.evidence-card').count()) === 1 &&
    (await page.locator('.evidence-card .stance-badge').innerText()) === '反驳');
  ok('覆盖变为 1/4', /1\s*\/4 篇文献/.test((await page.locator('.cov-main strong').innerText()).replace(/\n/g, ' ')));

  // 第二篇：存疑
  await page.getByRole('button', { name: '＋ 关联文献为证据' }).click();
  const v2 = await page.locator('select.ctl').evaluate((sel) => {
    const opt = [...sel.options].find((o) => o.textContent.includes('Designing with Data'));
    return opt.value;
  });
  await page.locator('select.ctl').selectOption(v2);
  await page.locator('.stance-opt.unc').click();
  await page.locator('.modal textarea').nth(0).fill('窄屏第二条证据，立场存疑。');
  await page.getByRole('button', { name: '建立关联' }).click();
  await page.waitForSelector('.modal', { state: 'detached' });
  ok('证据卡变为 2 张', (await page.locator('.evidence-card').count()) === 2);

  // ---------- 4. 重复关联拦截：候选项不含已关联文献 ----------
  await page.getByRole('button', { name: '＋ 关联文献为证据' }).click();
  const opts = await page.locator('select.ctl option').allInnerTexts();
  ok('候选项排除 2 篇已关联文献', opts.length === 2 &&
    !opts.some((t) => t.includes('Extended Mind') || t.includes('Designing with Data')));
  await page.locator('.modal .close').click();
  await page.waitForSelector('.modal', { state: 'detached' });

  // ---------- 5. 立场筛选 ----------
  await page.getByRole('button', { name: /^反驳/ }).click();
  ok('筛选反驳：1 张卡', (await page.locator('.evidence-card').count()) === 1);
  await page.getByRole('button', { name: /^存疑/ }).click();
  ok('筛选存疑：1 张卡', (await page.locator('.evidence-card').count()) === 1);
  await page.getByRole('button', { name: /全部立场/ }).click();
  ok('全部立场：2 张卡', (await page.locator('.evidence-card').count()) === 2);
  await page.screenshot({ path: `${shots}/04-filtered.png`, fullPage: true });
  ov = await overflowInfo();
  ok('证据列表无横向溢出', ov.scrollW <= ov.docW + 1);

  // ---------- 6. 编辑关联（内联） ----------
  await page.locator('.evidence-card').first().getByRole('button', { name: '编辑' }).click();
  await page.locator('.evidence-card').first().locator('.stance-opt.sup').click();
  await page.locator('.evidence-card').first().getByRole('button', { name: '保存' }).click();
  ok('窄屏下改判为支持', (await page.locator('.evidence-card .stance-badge').first().innerText()) === '支持');

  // ---------- 7. 导出 ----------
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '↓ 导出当前问题' }).click(),
  ]);
  const json = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  ok('手机端导出 JSON 结构正确',
    json.format === 'research-question-export/v1' &&
    json.question.title === TITLE &&
    json.summary.evidenceCount === 2 &&
    json.summary.coverage.linkedPapers === 2 &&
    json.summary.coverage.unlinkedPapers === 2);
  ok('导出立场计数 support=1 uncertain=1',
    json.summary.coverage.byStance.support === 1 && json.summary.coverage.byStance.uncertain === 1);

  // ---------- 8. 未关联区快速关联（同篇文献跨问题） ----------
  // 横向问题条：点击第二个种子问题
  await page.locator('.q-item', { hasText: '认知是否只发生在大脑内部' }).click();
  ok('切换问题成功', (await page.locator('.wb-head h2').innerText()).includes('认知是否只发生在大脑内部'));
  const target = page.locator('.unlinked-item', { hasText: 'Designing with Data' });
  ok('该文献标注「已在 2 个其他问题中」（种子 q2 + 刚建的新问题）', (await target.locator('em').innerText()).includes('已在 2 个其他问题中'));
  await target.getByRole('button', { name: '关联' }).click();
  await page.locator('.modal h2').waitFor();
  await page.locator('.stance-opt.unc').click();
  await page.locator('.modal textarea').nth(0).fill('跨问题关联的存疑证据。');
  await page.getByRole('button', { name: '建立关联' }).click();
  await page.waitForSelector('.modal', { state: 'detached' });
  ok('该问题证据增加（原 2 条 → 3 条）', (await page.locator('.evidence-card').count()) === 3);

  // ---------- 9. 编辑问题弹窗 ----------
  await page.locator('.q-item', { hasText: '窄屏测试' }).first().click();
  await page.getByRole('button', { name: '编辑问题' }).click();
  const inp = page.locator('.modal input').first();
  await inp.fill('【手机改】' + TITLE);
  await page.getByRole('button', { name: '保存修改' }).click();
  await page.waitForSelector('.modal', { state: 'detached' });
  ok('手机端编辑问题生效', (await page.locator('.wb-head h2').innerText()).startsWith('【手机改】'));

  // ---------- 10. 切回文献库：原功能在窄屏仍正常 ----------
  await page.locator('.mobile-tabs button', { hasText: '所有文献' }).click();
  ok('文献库列表可见', (await page.locator('.paper').count()) === 4);
  await page.locator('.paper', { hasText: 'Extended Mind' }).click();
  ok('文献详情问题 chips 可见', await page.locator('.q-chip').first().isVisible());
  await page.screenshot({ path: `${shots}/05-library-detail.png`, fullPage: true });
  ov = await overflowInfo();
  ok('文献详情无横向溢出', ov.scrollW <= ov.docW + 1);
  // chip 跳转到工作台仍可用
  await page.locator('.q-chip').first().click();
  await page.waitForSelector('.wb');
  ok('从 chip 跳转到工作台',
    (await page.locator('.mobile-tabs button.on').innerText()).includes('问题工作台'));

  // ---------- 11. 刷新后状态保留、标签栏仍在 ----------
  await page.reload();
  await page.waitForSelector('.mobile-tabs');
  const stored = JSON.parse(await page.evaluate(() => localStorage.getItem('research-workbench-v1')));
  ok('刷新后问题与关联保留',
    stored.questions.some((q) => q.title.startsWith('【手机改】')) && stored.links.length >= 5);
  await page.locator('.mobile-tabs button', { hasText: '问题工作台' }).click();
  await page.locator('.q-item', { hasText: '【手机改】' }).first().click();
  ok('刷新后证据仍为 2 张', (await page.locator('.evidence-card').count()) === 2);

  // ---------- 12. 无控制台错误 ----------
  const realErrors = consoleErrors.filter((t) =>
    !/favicon|Download the React DevTools|net::ERR|Failed to load resource/i.test(t));
  ok('运行过程无 JS 控制台错误', realErrors.length === 0);

  console.log(`\n手机宽度全部 ${pass} 项断言通过。截图目录: ${shots}`);
  if (realErrors.length) console.log(realErrors);
} catch (e) {
  await page.screenshot({ path: `${shots}/FAIL.png`, fullPage: true }).catch(() => {});
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
