import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const outputDir = path.join(process.cwd(), 'output', 'verification');
await mkdir(outputDir, {recursive: true});

const browser = await puppeteer.launch({
  executablePath: process.env.PICUT_CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const failures = [];
const page = await browser.newPage();
await page.setViewport({width: 1440, height: 960, deviceScaleFactor: 1});
page.on('console', (message) => {
  if (message.type() === 'error') failures.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
page.on('requestfailed', (request) => failures.push(`request: ${request.url()} ${request.failure()?.errorText ?? ''}`));

const waitForText = async (selector, pattern, timeout = 30_000) => {
  await page.waitForFunction((target, source) => {
    const text = document.querySelector(target)?.textContent ?? '';
    return new RegExp(source).test(text);
  }, {timeout}, selector, pattern.source);
};

try {
  const response = await page.goto('http://localhost:3000', {waitUntil: 'networkidle0', timeout: 60_000});
  if (!response?.ok()) throw new Error(`home status ${response?.status()}`);
  await waitForText('.brand-lockup', /πCut/);
  await waitForText('.quality-pill', /G1–G7 Ready/);
  await page.waitForSelector('.player-wrap video, .player-wrap canvas, .player-wrap [class]', {timeout: 30_000});
  await page.screenshot({path: path.join(outputDir, 'studio-initial.png'), fullPage: true});

  const clips = await page.$$('.timeline-clip');
  if (clips.length !== 6) throw new Error(`expected 6 clips, got ${clips.length}`);
  await page.click('.timeline-clip:nth-child(3) .clip-body');
  await new Promise((resolve) => setTimeout(resolve, 500));
  await waitForText('.inspector .panel-heading', /scene-03/);

  const dragRevision = await page.$eval('.revision-chip', (element) => element.textContent ?? '');
  const resizeHandle = await page.$('.timeline-clip:nth-child(4) .resize-handle.end');
  const handleBox = await resizeHandle?.boundingBox();
  if (!handleBox) throw new Error('timeline resize handle is not measurable');
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 18, handleBox.y + handleBox.height / 2, {steps: 8});
  await page.mouse.up();
  await page.waitForFunction((previous) => document.querySelector('.revision-chip')?.textContent !== previous, {timeout: 20_000}, dragRevision);
  await waitForText('.message-list', /时间轴拖动/);
  const revisionBeforeDragUndo = await page.$eval('.revision-chip', (element) => element.textContent ?? '');
  await page.waitForFunction(() => !document.querySelector('.top-actions .icon-button')?.hasAttribute('disabled'));
  await page.click('.top-actions .icon-button');
  await page.waitForFunction((previous) => document.querySelector('.revision-chip')?.textContent !== previous, {timeout: 20_000}, revisionBeforeDragUndo);

  await page.type('.prompt-box textarea', '删除第 5 幕');
  await page.click('.prompt-box button[type="submit"]');
  await page.waitForSelector('.approval-card', {timeout: 90_000});
  await page.screenshot({path: path.join(outputDir, 'studio-approval.png'), fullPage: true});
  await page.click('.approval-card button:not(.approve)');
  await page.waitForFunction(() => !document.querySelector('.approval-card'), {timeout: 90_000});

  const beforeRevision = await page.$eval('.revision-chip', (element) => element.textContent ?? '');
  await page.$eval('.color-field input[type="color"]', (element) => {
    const input = element;
    input.value = '#FF8A5B';
    input.dispatchEvent(new Event('change', {bubbles: true}));
  });
  await page.waitForFunction((previous) => document.querySelector('.revision-chip')?.textContent !== previous, {timeout: 20_000}, beforeRevision);
  await waitForText('.message-list', /UI → VideoSpec → Agent/);

  await page.type('.prompt-box textarea', '把第 3 幕的图表恢复成蓝色，并运行全部质量门');
  await page.click('.prompt-box button[type="submit"]');
  await waitForText('.message-list', /moonshotai\/Kimi-K2\.7-Code/, 90_000);
  await waitForText('.quality-pill', /G1–G7 Ready/);

  const revisionBeforeUndo = await page.$eval('.revision-chip', (element) => element.textContent ?? '');
  await page.click('.top-actions .icon-button');
  await page.waitForFunction((previous) => document.querySelector('.revision-chip')?.textContent !== previous, {timeout: 20_000}, revisionBeforeUndo);
  await waitForText('.message-list', /已撤销上一项变更/);
  await page.screenshot({path: path.join(outputDir, 'studio-after-edit.png'), fullPage: true});

  const result = {
    status: failures.length ? 'failed' : 'passed',
    title: await page.title(),
    clips: clips.length,
    revision: await page.$eval('.revision-chip', (element) => element.textContent ?? ''),
    selected: await page.$eval('.inspector .panel-heading>span', (element) => element.textContent ?? ''),
    quality: await page.$eval('.quality-pill', (element) => element.textContent?.trim() ?? ''),
    screenshots: ['output/verification/studio-initial.png', 'output/verification/studio-approval.png', 'output/verification/studio-after-edit.png'],
    failures,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}
