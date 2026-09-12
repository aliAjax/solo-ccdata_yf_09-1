import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'http://localhost:4173/';
const shots = '/tmp/e2e-shots';
fs.mkdirSync(shots, { recursive: true });
let pass = 0;
const ok = (name, cond) => {
  if (!cond) throw new Error('断言失败: ' + name);
  console.log('  ✓ ' + name);
  pass++;
};

// 按部分文本匹配 <option> 再按 value 选择（selectOption 的 label 不接受正则）
const selectByText = async (reSrc) => {
  const value = await page.locator('select.ctl').evaluate((sel, src) => {
    const opt = [...sel.options].find((o) => new RegExp(src).test(o.textContent));
    return opt ? opt.value : null;
  }, reSrc);
  if (value == null) throw new Error('找不到匹配选项: ' + reSrc);
  await page.locator('select.ctl').selectOption(value);
};

const browser = await chromium.launch();
const page = await browser.newPage({ acceptDownloads: true });
page.on('dialog', (d) => d.accept()); // 删除确认 / 解除关联确认

try {
  // ---------- 1. 进入工作台，初始种子数据 ----------
  await page.goto(BASE);
  await page.evaluate(() => {
    localStorage.removeItem('research-workbench-v1');
    localStorage.removeItem('research-library');
  });
  await page.reload();
  await page.screenshot({ path: `${shots}/01-library.png`, fullPage: true });
  await page.getByRole('button', { name: /问题工作台/ }).click();
  await page.waitForSelector('.wb');
  ok('种子含 2 个研究问题', await page.locator('.q-item').count() === 2);
  await page.screenshot({ path: `${shots}/02-workbench-seed.png`, fullPage: true });

  // ---------- 2. 创建问题 ----------
  await page.getByRole('button', { name: '＋ 新建问题' }).click();
  await page.locator('.modal h2').waitFor();
  const TITLE = '测试问题：工具使用能否构成认知？';
  await page.locator('.modal input').first().fill(TITLE);
  await page.locator('.modal textarea').first().fill('由端到端脚本创建，用于验证完整流程。');
  await page.getByRole('button', { name: '创建问题' }).click();
  await page.waitForSelector('.modal', { state: 'detached' });
  ok('新建问题出现在列表并被选中', (await page.locator('.wb-head h2').innerText()) === TITLE);

  // ---------- 3. 编辑问题 ----------
  await page.getByRole('button', { name: '编辑问题' }).click();
  const editInput = page.locator('.modal input').first();
  ok('编辑框回填原标题', (await editInput.inputValue()) === TITLE);
  await editInput.fill('【已编辑】' + TITLE);
  await page.getByRole('button', { name: '保存修改' }).click();
  await page.waitForSelector('.modal', { state: 'detached' });
  ok('标题已更新', (await page.locator('.wb-head h2').innerText()).startsWith('【已编辑】'));
  await page.screenshot({ path: `${shots}/03-question-edited.png`, fullPage: true });

  // ---------- 4. 初始覆盖：0/4，未关联 4 篇 ----------
  const cov0 = await page.locator('.cov-main strong').innerText();
  ok('初始覆盖 0/4', /0\s*\/4 篇文献/.test(cov0.replace(/\n/g, ' ')));
  ok('未关联文献 4 篇', (await page.locator('.unlinked-item').count()) === 4);

  // ---------- 5. 关联第 1 篇：Simon，反驳 ----------
  await page.getByRole('button', { name: '＋ 关联文献为证据' }).click();
  await page.locator('.modal h2').waitFor();
  await selectByText('Sciences of the Artificial');
  await page.locator('.stance-opt.ref').click();
  const dialogTextareas = page.locator('.modal textarea');
  await dialogTextareas.nth(0).fill('设计处理的是“应当如何”，并不承认外部工具承担认知功能——模拟反驳立场。');
  await dialogTextareas.nth(1).fill('端到端测试：第 1 条证据');
  await page.getByRole('button', { name: '建立关联' }).click();
  await page.waitForSelector('.modal', { state: 'detached' });
  ok('1 条证据卡出现', (await page.locator('.evidence-card').count()) === 1);
  ok('立场徽标为反驳', (await page.locator('.evidence-card .stance-badge').innerText()) === '反驳');

  // ---------- 6. 关联第 2 篇：Situated Learning，存疑（多文献→同一问题） ----------
  await page.getByRole('button', { name: '＋ 关联文献为证据' }).click();
  await selectByText('Situated Learning');
  await page.locator('.stance-opt.unc').click();
  await page.locator('.modal textarea').nth(0).fill('情境参与的说法与工具认知相关，但证据不直接——存疑。');
  await page.getByRole('button', { name: '建立关联' }).click();
  await page.waitForSelector('.modal', { state: 'detached' });
  ok('2 条证据卡', (await page.locator('.evidence-card').count()) === 2);
  const cov2 = (await page.locator('.cov-main strong').innerText()).replace(/\n/g, ' ');
  ok('覆盖更新为 2/4', /2\s*\/4 篇文献/.test(cov2));
  ok('未关联剩 2 篇', (await page.locator('.unlinked-item').count()) === 2);
  await page.screenshot({ path: `${shots}/04-two-links.png`, fullPage: true });

  // ---------- 7. 重复关联被拦住：候选项中不应出现已关联文献 ----------
  await page.getByRole('button', { name: '＋ 关联文献为证据' }).click();
  const opts = await page.locator('select.ctl option').allInnerTexts();
  ok('候选项不含已关联的 Simon 文献', !opts.some((t) => t.includes('Sciences of the Artificial')));
  ok('候选项不含已关联的 Situated Learning', !opts.some((t) => t.includes('Situated Learning')));
  ok('候选项仍含未关联文献', opts.some((t) => t.includes('Extended Mind')));
  await page.locator('.modal .close').click();
  await page.waitForSelector('.modal', { state: 'detached' });

  // ---------- 8. 按立场筛选 ----------
  await page.getByRole('button', { name: /^反驳/ }).click();
  ok('筛选「反驳」只剩 1 张卡', (await page.locator('.evidence-card').count()) === 1);
  await page.getByRole('button', { name: /^存疑/ }).click();
  ok('筛选「存疑」只剩 1 张卡', (await page.locator('.evidence-card').count()) === 1);
  await page.getByRole('button', { name: /全部立场/ }).click();
  ok('筛选「全部」恢复 2 张卡', (await page.locator('.evidence-card').count()) === 2);

  // ---------- 9. 编辑关联网：反驳改判为支持 + 改摘录 ----------
  await page.locator('.evidence-card').first().getByRole('button', { name: '编辑' }).click();
  await page.locator('.evidence-card').first().locator('.stance-opt.sup').click();
  const editArea = page.locator('.evidence-card').first().locator('textarea').first();
  await editArea.fill((await editArea.inputValue()) + '（经复核改判为支持）');
  await page.locator('.evidence-card').first().getByRole('button', { name: '保存' }).click();
  ok('改判后徽标为支持', (await page.locator('.evidence-card .stance-badge').first().innerText()) === '支持');
  await page.screenshot({ path: `${shots}/05-link-edited.png`, fullPage: true });

  // ---------- 10. 导出当前问题为结构化文件 ----------
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '↓ 导出当前问题' }).click(),
  ]);
  const fname = download.suggestedFilename();
  ok('导出文件名是 question-*.json', /^question-.*\.json$/.test(fname));
  const json = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  ok('导出 format 标识正确', json.format === 'research-question-export/v1');
  ok('导出的问题标题为编辑后的标题', json.question.title.startsWith('【已编辑】'));
  ok('证据数为 2', json.summary.evidenceCount === 2);
  ok('覆盖摘要 linked=2 total=4 unlinked=2',
    json.summary.coverage.linkedPapers === 2 &&
    json.summary.coverage.totalPapers === 4 &&
    json.summary.coverage.unlinkedPapers === 2);
  ok('立场计数 support=1 uncertain=1',
    json.summary.coverage.byStance.support === 1 &&
    json.summary.coverage.byStance.uncertain === 1 &&
    json.summary.coverage.byStance.refute === 0);
  ok('证据含立场、摘录与文献元数据',
    json.evidence.every((e) => ['support', 'refute', 'uncertain'].includes(e.stance) &&
      e.excerpt.length > 0 && e.paper.title && e.paper.cite));
  ok('导出包含未关联文献清单', Array.isArray(json.unlinkedPapers) && json.unlinkedPapers.length === 2);
  fs.writeFileSync('/tmp/exported-question.json', JSON.stringify(json, null, 2));

  // ---------- 11. 同一文献进入多个问题 ----------
  await page.locator('.q-item', { hasText: '情境化的研究结论' }).click();
  ok('切换到 q2，种子证据 2 条', (await page.locator('.evidence-card').count()) === 2);
  ok('q2 未关联 2 篇', (await page.locator('.unlinked-item').count()) === 2);
  const simonItem = page.locator('.unlinked-item', { hasText: 'Sciences of the Artificial' });
  ok('该文献标记「已在 1 个其他问题中」', (await simonItem.locator('em').innerText()).includes('已在 1 个其他问题中'));
  await simonItem.getByRole('button', { name: '关联' }).click();
  await page.locator('.modal h2').waitFor();
  ok('弹窗预选了该文献', (await page.locator('select.ctl').inputValue()) === '4');
  await page.locator('.stance-opt.sup').click();
  await page.locator('.modal textarea').nth(0).fill('设计科学同样处理“应当如何”，可侧面支持设计决策转化。');
  await page.getByRole('button', { name: '建立关联' }).click();
  await page.waitForSelector('.modal', { state: 'detached' });
  ok('q2 现在有 3 条证据（同篇文献跨两个问题）', (await page.locator('.evidence-card').count()) === 3);
  const covQ2 = (await page.locator('.cov-main strong').innerText()).replace(/\n/g, ' ');
  ok('q2 覆盖 3/4', /3\s*\/4 篇文献/.test(covQ2));
  await page.screenshot({ path: `${shots}/06-cross-question.png`, fullPage: true });

  // ---------- 12. 文献详情显示所属问题，并可跳转 ----------
  await page.getByRole('button', { name: /所有文献/ }).click();
  await page.locator('.paper', { hasText: 'The Extended Mind' }).click();
  const chips = page.locator('.q-chip');
  ok('Extended Mind 属于 2 个问题', (await chips.count()) === 2);
  const chipTexts = await chips.allInnerTexts();
  ok('两个问题下立场分别为支持/存疑',
    chipTexts.some((t) => t.includes('支持') && t.includes('认知是否只发生在大脑内部')) &&
    chipTexts.some((t) => t.includes('存疑') && t.includes('情境化的研究结论')));
  await page.screenshot({ path: `${shots}/07-paper-questions.png`, fullPage: true });
  await chips.getByText(/情境化的研究结论/).click();
  await page.waitForSelector('.wb');
  ok('点击 chip 跳转到工作台并定位 q2',
    (await page.locator('.wb-head h2').innerText()).includes('情境化的研究结论'));

  // ---------- 13. 刷新持久化 ----------
  await page.reload();
  const raw = await page.evaluate(() => localStorage.getItem('research-workbench-v1'));
  const stored = JSON.parse(raw);
  const myQ = stored.questions.find((q) => q.title.startsWith('【已编辑】'));
  ok('localStorage 中保留了编辑后的问题', !!myQ);
  const myLinks = stored.links.filter((l) => l.questionId === myQ.id);
  ok('刷新后关联仍在（2 条）', myLinks.length === 2);
  ok('关联的文献为 #4 与 #2', myLinks.map((l) => l.paperId).sort().join() === '2,4');
  ok('改判的立场已持久化（含 1 条 support）', myLinks.some((l) => l.stance === 'support'));
  ok('摘录文本已持久化', myLinks.every((l) => l.excerpt.length > 0));
  // 不变量：不存在重复的 (问题, 文献) 关联
  const pairs = new Set();
  for (const l of stored.links) {
    const k = l.questionId + '|' + l.paperId;
    if (pairs.has(k)) throw new Error('发现重复关联: ' + k);
    pairs.add(k);
  }
  ok('全部关联无重复的（问题, 文献）配对', true);
  // 界面上也确认
  await page.getByRole('button', { name: /问题工作台/ }).click();
  await page.locator('.q-item', { hasText: '【已编辑】' }).click();
  ok('刷新后界面仍显示 2 条证据', (await page.locator('.evidence-card').count()) === 2);
  await page.screenshot({ path: `${shots}/08-after-reload.png`, fullPage: true });

  // ---------- 14. 解除关联后回到未关联区 ----------
  const beforeRemove = await page.locator('.unlinked-item').count();
  await page.locator('.evidence-card').first().getByRole('button', { name: '解除关联' }).click();
  ok('解除后证据剩 1 条', (await page.locator('.evidence-card').count()) === 1);
  ok('未关联文献增加 1 篇', (await page.locator('.unlinked-item').count()) === beforeRemove + 1);

  console.log(`\n全部 ${pass} 项断言通过。截图目录: ${shots}`);
} catch (e) {
  await page.screenshot({ path: `${shots}/FAIL.png`, fullPage: true }).catch(() => {});
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
