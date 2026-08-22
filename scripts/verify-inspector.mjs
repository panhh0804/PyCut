import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const origin = 'http://localhost:3000';
const projectId = 'cloud-science-12s-2';
const outputDir = path.join(process.cwd(), 'output', 'verification');
await mkdir(outputDir, {recursive: true});
const browser = await puppeteer.launch({executablePath: process.env.PICUT_CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
const page = await browser.newPage();
const failures = [];
page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));

const getProject = async () => {
  const response = await fetch(`${origin}/api/projects/${projectId}`);
  if (!response.ok) throw new Error(`project GET ${response.status}`);
  return response.json();
};
const revision = () => page.$eval('.revision-chip', (element) => element.textContent ?? '');
const waitRevision = async (before) => page.waitForFunction((value) => document.querySelector('.revision-chip')?.textContent !== value, {timeout: 25_000}, before);
const clickTab = async (label) => {
  const clicked = await page.evaluate((text) => {
    const button = [...document.querySelectorAll('.inspector-tabs button')].find((item) => item.textContent === text);
    button?.click();
    return Boolean(button);
  }, label);
  if (!clicked) throw new Error(`tab ${label} not found`);
};
const undo = async () => {
  const before = await revision();
  await page.click('.top-actions .icon-button');
  await waitRevision(before);
};

try {
  await page.setViewport({width: 1720, height: 1120, deviceScaleFactor: 1});
  await page.goto(`${origin}/?project=${projectId}`, {waitUntil: 'networkidle0', timeout: 60_000});
  await page.waitForSelector('.nle-timeline', {timeout: 30_000});
  await clickTab('Style');
  await page.waitForSelector('.effect-stack');
  const styleRevision = await revision();
  const added = await page.evaluate(() => {
    const button = [...document.querySelectorAll('.effect-add button')].find((item) => item.textContent?.includes('Blur'));
    button?.click();
    return Boolean(button);
  });
  if (!added) throw new Error('Blur button not found');
  await waitRevision(styleRevision);
  const styled = await getProject();
  if (!styled.spec.editSpec.scenes[0].effects.some((effect) => effect.type === 'blur')) throw new Error('Style effect was not persisted');
  await page.screenshot({path: path.join(outputDir, 'inspector-style-working.png'), fullPage: true});

  await clickTab('Motion');
  await page.waitForSelector('.motion-grid');
  const motionRevision = await revision();
  await page.$eval('.motion-grid label:first-child input', (input) => {
    input.focus();
    input.value = '48';
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.blur();
  });
  await waitRevision(motionRevision);
  const moved = await getProject();
  if (moved.spec.editSpec.scenes[0].transform.x !== 48) throw new Error(`Motion X was not persisted: ${moved.spec.editSpec.scenes[0].transform.x}`);
  await page.screenshot({path: path.join(outputDir, 'inspector-motion-working.png'), fullPage: true});

  const clip = await page.$('.nle-track.video .video-clip');
  const lane = await page.$('.nle-track.video .nle-lane');
  const clipBox = await clip?.boundingBox();
  const laneBox = await lane?.boundingBox();
  if (!clipBox || !laneBox) throw new Error('clip or lane not measurable');
  const clickX = clipBox.x + clipBox.width * 0.72;
  await page.mouse.click(clickX, clipBox.y + clipBox.height / 2);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const timecode = await page.$eval('.transport-group time', (element) => element.textContent?.split('/')[0].trim() ?? '');
  const displayedSeconds = Number(timecode.split(':')[0]) * 60 + Number(timecode.split(':')[1]);
  const current = await getProject();
  const totalFrames = current.spec.editSpec.scenes.reduce((max, scene) => Math.max(max, scene.startFrame + scene.durationFrames), 1);
  const scene = current.spec.editSpec.scenes[0];
  const rawFrame = Math.round((clickX - laneBox.x) / laneBox.width * totalFrames);
  const expectedFrame = Math.max(scene.startFrame, Math.min(scene.startFrame + scene.durationFrames - 1, rawFrame));
  const expectedSeconds = expectedFrame / current.spec.canvas.fps;
  if (Math.abs(displayedSeconds - expectedSeconds) > 1 / current.spec.canvas.fps + 0.01) throw new Error(`clip click seek mismatch: expected ${expectedSeconds}, got ${displayedSeconds}`);
  await clickTab('Scene');
  await page.waitForSelector('input[aria-label$="时长"]');
  const durationMin = await page.$eval('input[aria-label$="时长"]', (input) => input.min);
  if (durationMin !== '0.1') throw new Error(`duration min is ${durationMin}`);

  await undo();
  await undo();
  process.stdout.write(`${JSON.stringify({status: failures.length ? 'failed' : 'passed', stylePersisted: true, motionPersisted: true, clipClick: {expectedSeconds, displayedSeconds}, durationMin, screenshots: ['output/verification/inspector-style-working.png', 'output/verification/inspector-motion-working.png'], failures}, null, 2)}\n`);
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}
