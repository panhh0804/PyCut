import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const origin = process.env.PICUT_ORIGIN ?? 'http://localhost:3000';
const projectId = process.argv[2] ?? 'picut-11s-mt3r9rnw';
const outputDir = path.join(process.cwd(), 'output', 'verification');
await mkdir(outputDir, {recursive: true});
const browser = await puppeteer.launch({
  executablePath: process.env.PICUT_CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
const failures = [];
page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
page.on('requestfailed', (request) => {
  const error = request.failure()?.errorText ?? '';
  if (request.url().includes('/audio/') && error.includes('ERR_ABORTED')) return;
  failures.push(`request: ${request.url()} ${error}`);
});

try {
  await page.setViewport({width: 1720, height: 1120, deviceScaleFactor: 1});
  const response = await page.goto(`${origin}/?project=${projectId}`, {waitUntil: 'networkidle0', timeout: 60_000});
  if (!response?.ok()) throw new Error(`studio status ${response?.status()}`);
  await page.waitForSelector('.nle-timeline', {timeout: 30_000});
  await page.waitForSelector('.agent-trace-body', {timeout: 30_000});
  await page.waitForFunction(() => {
    const image = document.querySelector('img[src*="/media/"]');
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
  }, {timeout: 30_000});
  const state = await page.evaluate(() => ({
    title: document.querySelector('.project-breadcrumb strong')?.textContent?.trim(),
    duration: document.querySelector('.canvas-meta')?.textContent?.trim(),
    clipCount: document.querySelectorAll('.nle-track.video .video-clip').length,
    materialSrc: document.querySelector('img[src*="/media/"]')?.getAttribute('src'),
    component: document.querySelector('.stage-caption span:last-child')?.textContent?.trim(),
    quality: document.querySelector('.quality-pill')?.textContent?.trim(),
    engine: document.querySelector('.backend-select select')?.value,
    trace: document.querySelector('.agent-trace-body')?.textContent?.replaceAll(/\s+/g, ' ').trim(),
  }));
  if (!state.title?.includes('深海热液喷口')) failures.push(`unexpected title: ${state.title}`);
  if (!state.duration?.includes('11.0 s')) failures.push(`unexpected duration: ${state.duration}`);
  if (state.clipCount !== 4) failures.push(`unexpected clip count: ${state.clipCount}`);
  if (!state.materialSrc?.startsWith('/media/')) failures.push('MediaBroll image is not mounted');
  if (state.engine !== 'auto') failures.push(`engine selector is not auto: ${state.engine}`);
  if (!state.trace?.includes('自主选择 Remotion')) failures.push(`route trace is missing: ${state.trace}`);
  await page.screenshot({path: path.join(outputDir, 'pi-agent-generated-hydrothermal-vent.png'), fullPage: true});
  process.stdout.write(`${JSON.stringify({status: failures.length ? 'failed' : 'passed', projectId, ...state, screenshot: 'output/verification/pi-agent-generated-hydrothermal-vent.png', failures}, null, 2)}\n`);
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}
