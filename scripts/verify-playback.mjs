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
const page = await browser.newPage();
const failures = [];
page.on('console', (message) => {
  if (message.type() === 'error') failures.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));

try {
  await page.setViewport({width: 1680, height: 1100, deviceScaleFactor: 1});
  const response = await page.goto('http://localhost:3000', {waitUntil: 'networkidle0', timeout: 60_000});
  if (!response?.ok()) throw new Error(`home status ${response?.status()}`);
  await page.waitForSelector('.nle-timeline[aria-label="多轨剪辑时间线"]', {timeout: 30_000});
  await page.waitForSelector('.transport-group button[aria-label="播放"]', {timeout: 30_000});
  const before = await page.$eval('.transport-group time', (element) => element.textContent ?? '');
  await page.click('.transport-group button[aria-label="播放"]');
  await page.waitForSelector('.transport-group button[aria-label="暂停"]', {timeout: 5_000});
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  const after = await page.$eval('.transport-group time', (element) => element.textContent ?? '');
  if (after === before) throw new Error(`playhead did not advance: ${before}`);
  await page.click('.transport-group button[aria-label="暂停"]');
  await page.waitForSelector('.transport-group button[aria-label="播放"]', {timeout: 5_000});
  await page.screenshot({path: path.join(outputDir, 'timeline-playback-wired.png'), fullPage: true});
  const result = {status: failures.length ? 'failed' : 'passed', before, after, failures};
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}
