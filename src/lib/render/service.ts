import 'server-only';

import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {getProject} from '@/lib/project/store';
import {compileVideoSpec, toSrt} from '@/lib/video-spec/compiler';
import {validateVideoSpec} from '@/lib/video-spec/validation';
import {renderHyperFrames} from './hyperframes-adapter';
import {renderRemotion} from './remotion-adapter';

export type RenderBackend = 'remotion' | 'hyperframes';

const digestFile = async (file: string) => createHash('sha256').update(await readFile(file)).digest('hex');

export async function renderProject(projectId: string, backend: RenderBackend, mode: 'preview' | 'final' = 'final') {
  const {spec} = await getProject(projectId);
  const validation = validateVideoSpec(spec);
  if (!validation.valid) throw new Error('VideoSpec 未通过阻断质量门，拒绝渲染');
  const compiled = compileVideoSpec(spec);
  const slug = `${projectId}-r${spec.revision}-${backend}-${mode}`;
  const publicDir = path.join(process.cwd(), 'public', 'renders', slug);
  const workDir = path.join(process.cwd(), 'output', slug);
  await Promise.all([mkdir(publicDir, {recursive: true}), mkdir(workDir, {recursive: true})]);
  const videoPath = path.join(publicDir, `${slug}.mp4`);
  if (backend === 'remotion') await renderRemotion(spec, videoPath, mode === 'preview' ? 150 : undefined);
  else await renderHyperFrames(spec, path.join(workDir, 'hyperframes'), videoPath);
  const specPath = path.join(publicDir, 'VideoSpec.json');
  const subtitlesPath = path.join(publicDir, 'subtitles.srt');
  const assetsPath = path.join(publicDir, 'AssetManifest.json');
  await Promise.all([
    writeFile(specPath, JSON.stringify(spec, null, 2), 'utf8'),
    writeFile(subtitlesPath, toSrt(spec), 'utf8'),
    writeFile(assetsPath, JSON.stringify({projectId, revision: spec.revision, assets: spec.assets}, null, 2), 'utf8'),
  ]);
  const manifest = {
    manifestVersion: '1.0.0',
    projectId,
    revision: spec.revision,
    backend,
    mode,
    createdAt: new Date().toISOString(),
    video: {file: path.basename(videoPath), sha256: await digestFile(videoPath)},
    specDigest: validation.digest,
    canvas: spec.canvas,
    durationInFrames: mode === 'preview' && backend === 'remotion' ? Math.min(150, compiled.durationInFrames) : compiled.durationInFrames,
    qualityGates: validation.gates,
    deliverables: ['MP4', 'SRT', 'VideoSpec', 'AssetManifest', 'RenderManifest'],
  };
  await writeFile(path.join(publicDir, 'RenderManifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return {
    manifest,
    urls: {
      video: `/renders/${slug}/${slug}.mp4`,
      spec: `/renders/${slug}/VideoSpec.json`,
      subtitles: `/renders/${slug}/subtitles.srt`,
      assets: `/renders/${slug}/AssetManifest.json`,
      manifest: `/renders/${slug}/RenderManifest.json`,
    },
  };
}

