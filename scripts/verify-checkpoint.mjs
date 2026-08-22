import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const origin = 'http://localhost:3000';
const outputDir = path.join(process.cwd(), 'output', 'verification');
await mkdir(outputDir, {recursive: true});

const creation = await fetch(`${origin}/api/projects`, {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({brief: '创建一个关于云朵形成的科普视频，总时长 12 秒'}),
});
const created = await creation.json();
if (!creation.ok) throw new Error(`project creation failed: ${created.error ?? creation.status}`);
if (created.spec.project.targetDurationMs !== 12_000 || created.spec.editSpec.scenes.length !== 3) {
  throw new Error('云朵项目没有生成为 12 秒 / 3 镜头');
}

const browser = await puppeteer.launch({
  executablePath: process.env.PICUT_CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
const failures = [];
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('data-new-gr')) failures.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
page.on('requestfailed', (request) => failures.push(`request: ${request.url()} ${request.failure()?.errorText ?? ''}`));

const revision = () => page.$eval('.revision-chip', (element) => element.textContent ?? '');
const waitRevision = async (before) => {
  await page.waitForFunction((previous) => document.querySelector('.revision-chip')?.textContent !== previous, {timeout: 25_000}, before);
  await page.waitForFunction(() => !document.querySelector('.saving'), {timeout: 25_000});
};
const clickButtonText = async (text) => {
  const clicked = await page.evaluate((label) => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim().includes(label) && !item.disabled);
    button?.click();
    return Boolean(button);
  }, text);
  if (!clicked) throw new Error(`button not found: ${text}`);
};
const undo = async () => {
  const before = await revision();
  await page.click('.top-actions .icon-button');
  await waitRevision(before);
};

try {
  await page.setViewport({width: 1720, height: 1120, deviceScaleFactor: 1});
  const response = await page.goto(`${origin}${created.url}`, {waitUntil: 'networkidle0', timeout: 60_000});
  if (!response?.ok()) throw new Error(`studio status ${response?.status()}`);
  await page.waitForSelector('.nle-timeline', {timeout: 30_000});
  await page.waitForFunction(() => document.querySelector('.project-breadcrumb strong')?.textContent?.includes('12 秒看懂云朵的形成'));
  await page.waitForFunction(() => document.querySelector('.canvas-meta')?.textContent?.includes('12.0 s'));

  const trackNames = await page.$$eval('.nle-track-head strong', (elements) => elements.map((element) => element.textContent?.trim()));
  const expectedTracks = ['V2 · Overlay', 'V1 · Main', 'C1 · Captions', 'A1 · Narration', 'A2 · Music'];
  if (JSON.stringify(trackNames) !== JSON.stringify(expectedTracks)) throw new Error(`unexpected tracks: ${trackNames.join(', ')}`);
  if ((await page.$$('.video-clip')).length !== 3) throw new Error('初始云朵时间轴应为 3 个镜头');

  const timeBefore = await page.$eval('.transport-group time', (element) => element.textContent ?? '');
  await page.click('.transport-group button[aria-label="播放"]');
  await page.waitForSelector('.transport-group button[aria-label="暂停"]', {timeout: 5_000});
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  const timeAfter = await page.$eval('.transport-group time', (element) => element.textContent ?? '');
  if (timeAfter === timeBefore) throw new Error('播放后时间码未推进');
  await page.click('.transport-group button[aria-label="暂停"]');

  await page.screenshot({path: path.join(outputDir, 'checkpoint-cloud-multitrack.png'), fullPage: true});

  await page.click('.project-breadcrumb');
  await page.waitForSelector('.session-popover');
  const sessionCount = await page.$$eval('.session-item', (elements) => elements.length);
  if (sessionCount < 2) throw new Error('会话列表没有保留多个独立项目');
  await page.screenshot({path: path.join(outputDir, 'checkpoint-persistent-sessions.png'), fullPage: true});
  const cloudUrl = page.url();
  const switched = await page.evaluate(() => {
    const button = document.querySelector('.session-item:not(.active)>button:first-child');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  });
  if (!switched) throw new Error('没有可切换的第二个会话');
  await page.waitForFunction((url) => window.location.href !== url, {timeout: 20_000}, cloudUrl);
  await page.waitForSelector('.nle-timeline', {timeout: 20_000});
  await page.goto(`${origin}${created.url}`, {waitUntil: 'networkidle0', timeout: 60_000});
  await page.waitForSelector('.nle-timeline', {timeout: 20_000});
  await page.waitForFunction(() => document.querySelector('.canvas-meta')?.textContent?.includes('12.0 s'));

  // Move a clip from V1 to V2 and undo.
  const source = await page.$('.nle-track.video .video-clip');
  const target = await page.$('.nle-track.overlay .nle-lane');
  const sourceBox = await source?.boundingBox();
  const targetBox = await target?.boundingBox();
  if (!sourceBox || !targetBox) throw new Error('镜头或目标轨道不可测量');
  const moveRevision = await revision();
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + Math.min(sourceBox.width / 2, targetBox.width / 5), targetBox.y + targetBox.height / 2, {steps: 10});
  await page.mouse.up();
  await waitRevision(moveRevision);
  if ((await page.$$('.nle-track.overlay .video-clip')).length !== 1) throw new Error('镜头未移动到 V2 轨道');
  await undo();

  // Trim the first clip and undo.
  const trimHandle = await page.$('.nle-track.video .video-clip .clip-handle.right');
  const trimBox = await trimHandle?.boundingBox();
  if (!trimBox) throw new Error('裁切手柄不可测量');
  const trimRevision = await revision();
  await page.mouse.move(trimBox.x + trimBox.width / 2, trimBox.y + trimBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(trimBox.x - 35, trimBox.y + trimBox.height / 2, {steps: 8});
  await page.mouse.up();
  await waitRevision(trimRevision);
  await undo();

  // Split at 2 seconds, capture, then undo.
  await page.click('.nle-track.video .video-clip');
  const ruler = await page.$('.ruler-grid');
  const rulerBox = await ruler?.boundingBox();
  if (!rulerBox) throw new Error('时间标尺不可测量');
  await page.mouse.click(rulerBox.x + rulerBox.width / 6, rulerBox.y + rulerBox.height / 2);
  const splitRevision = await revision();
  await clickButtonText('分割');
  await waitRevision(splitRevision);
  if ((await page.$$('.video-clip')).length !== 4) throw new Error('分割后应有 4 个镜头');
  await page.click('.nle-track.video .video-clip:nth-of-type(3)');
  await page.mouse.click(rulerBox.x + rulerBox.width * 0.46, rulerBox.y + rulerBox.height / 2);
  await new Promise((resolve) => setTimeout(resolve, 300));
  await page.screenshot({path: path.join(outputDir, 'checkpoint-split-operation.png'), fullPage: true});
  await undo();

  // Duplicate and undo.
  const duplicateRevision = await revision();
  await clickButtonText('复制');
  await waitRevision(duplicateRevision);
  if ((await page.$$('.video-clip')).length !== 4) throw new Error('复制后应有 4 个镜头');
  await undo();

  // Delete and undo.
  await page.click('.nle-track.video .video-clip:nth-of-type(2)');
  const deleteRevision = await revision();
  await clickButtonText('删除');
  await waitRevision(deleteRevision);
  if ((await page.$$('.video-clip')).length !== 2) throw new Error('删除后应剩 2 个镜头');
  await undo();

  await page.reload({waitUntil: 'networkidle0', timeout: 60_000});
  await page.waitForSelector('.nle-timeline');
  if ((await page.$$('.video-clip')).length !== 3) throw new Error('重载后未从持久化项目恢复 3 个镜头');
  const result = {
    status: failures.length ? 'failed' : 'passed',
    projectId: created.projectId,
    durationMs: created.spec.project.targetDurationMs,
    tracks: trackNames,
    sessions: sessionCount,
    playback: {before: timeBefore, after: timeAfter},
    operations: ['move-across-tracks', 'trim', 'split', 'duplicate', 'ripple-delete', 'undo', 'reload-persistence'],
    screenshots: [
      'output/verification/checkpoint-cloud-multitrack.png',
      'output/verification/checkpoint-persistent-sessions.png',
      'output/verification/checkpoint-split-operation.png',
    ],
    failures,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}
