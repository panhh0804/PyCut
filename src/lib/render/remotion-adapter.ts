import 'server-only';

import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import type {VideoSpec} from '@/lib/video-spec/schema';

let bundlePromise: Promise<string> | undefined;
let bundleAssetKey: string | undefined;

function getBundle(spec: VideoSpec) {
  const assetKey = spec.assets
    .filter((asset) => asset.src.startsWith('/'))
    .map((asset) => `${asset.src}:${asset.checksum ?? asset.id}`)
    .sort()
    .join('|');
  if (!bundlePromise || bundleAssetKey !== assetKey) {
    bundleAssetKey = assetKey;
    bundlePromise = bundle({
      entryPoint: path.join(process.cwd(), 'src', 'remotion', 'index.ts'),
      publicDir: path.join(process.cwd(), 'public'),
      onProgress: () => undefined,
    });
  }
  return bundlePromise;
}

export async function renderRemotion(spec: VideoSpec, outputPath: string, previewFrames?: number) {
  await mkdir(path.dirname(outputPath), {recursive: true});
  const serveUrl = await getBundle(spec);
  const inputProps = {spec};
  const browserExecutable = process.env.PICUT_CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const composition = await selectComposition({serveUrl, id: 'PiCutVideo', inputProps, browserExecutable, logLevel: 'warn'});
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec: 'h264',
    outputLocation: outputPath,
    browserExecutable,
    chromiumOptions: {disableWebSecurity: true},
    concurrency: 2,
    crf: 22,
    pixelFormat: 'yuv420p',
    overwrite: true,
    logLevel: 'warn',
    frameRange: previewFrames ? [0, Math.min(composition.durationInFrames - 1, previewFrames - 1)] : null,
    licenseKey: null,
  });
  return outputPath;
}
