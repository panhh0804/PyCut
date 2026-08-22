import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const origin = process.env.PICUT_ORIGIN ?? 'http://localhost:3000';
const projectId = process.argv[2] ?? 'picut-9s-mt3ry4ly';
const outputDir = path.join(process.cwd(), 'output', 'verification');
await mkdir(outputDir, {recursive: true});
const browser = await puppeteer.launch({executablePath: process.env.PICUT_CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
const page = await browser.newPage();
const failures = [];
page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
try {
  await page.setViewport({width: 1720, height: 1120, deviceScaleFactor: 1});
  const response = await page.goto(`${origin}/?project=${projectId}`, {waitUntil: 'networkidle0', timeout: 60_000});
  if (!response?.ok()) throw new Error(`studio status ${response?.status()}`);
  await page.waitForSelector('.agent-trace-body', {timeout: 30_000});
  await page.waitForFunction(() => document.querySelector('.agent-trace-body')?.textContent?.includes('自主选择 HyperFrames'), {timeout: 30_000});
  const state = await page.evaluate(() => ({
    title: document.querySelector('.project-breadcrumb strong')?.textContent?.trim(),
    engine: document.querySelector('.backend-select select')?.value,
    traceRuns: document.querySelector('.agent-trace-head small')?.textContent?.trim(),
    trace: document.querySelector('.agent-trace-body')?.textContent?.replaceAll(/\s+/g, ' ').trim(),
    clipCount: document.querySelectorAll('.nle-track.video .video-clip').length,
    hasWaveform: Boolean(document.querySelector('.audio-clip')),
  }));
  if (state.title !== 'Fold to Fly') failures.push(`unexpected title: ${state.title}`);
  if (state.engine !== 'auto') failures.push(`engine is not auto: ${state.engine}`);
  if (state.clipCount !== 4) failures.push(`unexpected clip count: ${state.clipCount}`);
  if (state.hasWaveform) failures.push('no-audio project unexpectedly has a waveform');
  if (!state.trace?.includes('自主选择 HyperFrames')) failures.push('HyperFrames route trace is missing');
  await page.screenshot({path: path.join(outputDir, 'pi-agent-auto-route-hyperframes.png'), fullPage: true});
  const runValues = await page.$$eval('.trace-run-select option', (options) => options.map((option) => option.value));
  if (runValues.length < 2) failures.push(`expected at least two trace runs, got ${runValues.length}`);
  if (runValues[0]) {
    await page.select('.trace-run-select', runValues[0]);
    await page.waitForFunction(() => document.querySelector('.agent-trace-body')?.textContent?.includes('draft_storyboard 完成'), {timeout: 10_000});
  }
  const creationTrace = await page.$eval('.agent-trace-body', (element) => element.textContent?.replaceAll(/\s+/g, ' ').trim());
  if (!creationTrace?.includes('draft_storyboard 完成') || !creationTrace.includes('validate_spec 完成')) failures.push(`creation trace is missing: ${creationTrace}`);
  await page.screenshot({path: path.join(outputDir, 'pi-agent-creation-trace.png'), fullPage: true});
  process.stdout.write(`${JSON.stringify({status: failures.length ? 'failed' : 'passed', projectId, ...state, creationTrace, screenshots: ['output/verification/pi-agent-auto-route-hyperframes.png', 'output/verification/pi-agent-creation-trace.png'], failures}, null, 2)}\n`);
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}
