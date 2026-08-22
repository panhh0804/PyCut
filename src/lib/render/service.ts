import 'server-only';

import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {getProject} from '@/lib/project/store';
import {compileVideoSpec, toSrt} from '@/lib/video-spec/compiler';
import {validateVideoSpec} from '@/lib/video-spec/validation';
import {renderHyperFrames} from './hyperframes-adapter';
import {renderRemotion} from './remotion-adapter';
import {muxProjectAudio, type ProjectAudioMixInput} from '@/lib/audio/service';

export type RenderBackend = 'remotion' | 'hyperframes';
export type RenderBackendRequest = RenderBackend | 'auto';

const digestFile = async (file: string) => createHash('sha256').update(await readFile(file)).digest('hex');

function renderTargets(projectId: string, revision: number, backend: RenderBackend, mode: 'preview' | 'final') {
  const slug = `${projectId}-r${revision}-${backend}-${mode}`;
  return {
    slug,
    publicDir: path.join(process.cwd(), 'public', 'renders', slug),
    workDir: path.join(process.cwd(), 'output', slug),
  };
}

async function renderWithBackend(
  spec: Awaited<ReturnType<typeof getProject>>['spec'],
  backend: RenderBackend,
  mode: 'preview' | 'final',
  publicDir: string,
  workDir: string,
  videoPath: string,
) {
  await Promise.all([mkdir(publicDir, {recursive: true}), mkdir(workDir, {recursive: true})]);
  if (backend === 'remotion') {
    await renderRemotion(spec, videoPath, mode === 'preview' ? 150 : undefined);
    return;
  }
  const hasAudioSolo = spec.editSpec.tracks.some((track) => track.kind === 'audio' && track.solo);
  const narrationTrack = spec.editSpec.tracks.find((track) => track.id === 'audio-narration');
  const musicTrack = spec.editSpec.tracks.find((track) => track.id === 'audio-music');
  const narration = spec.assets.find((asset) => asset.id === spec.editSpec.globalAudio.narrationAssetId);
  const bgm = spec.assets.find((asset) => asset.id === spec.editSpec.globalAudio.bgmAssetId);
  const resolveAudio = (src: string) => src.startsWith('/') ? path.join(process.cwd(), 'public', src.replace(/^\//, '')) : src;
  const audioInputs: ProjectAudioMixInput[] = [];
  if (narrationTrack && !narrationTrack.muted && (!hasAudioSolo || narrationTrack.solo)) {
    const clipsAreDefault = spec.editSpec.globalAudio.narrationSegments.every((segment) => !segment.muted && segment.gainDb === 0 && segment.playbackRate === 1);
    if (narration?.src && clipsAreDefault) {
      audioInputs.push({file: resolveAudio(narration.src), role: 'narration', gainDb: narrationTrack.gainDb});
    } else if (spec.editSpec.globalAudio.narrationSegments.length) {
      for (const segment of spec.editSpec.globalAudio.narrationSegments) {
        const asset = spec.assets.find((item) => item.id === segment.assetId);
        if (!asset?.src || segment.muted) continue;
        audioInputs.push({
          file: resolveAudio(asset.src),
          role: 'narration',
          gainDb: narrationTrack.gainDb + segment.gainDb,
          startSeconds: segment.startFrame / spec.canvas.fps,
          durationSeconds: segment.durationFrames / spec.canvas.fps,
          playbackRate: segment.playbackRate,
        });
      }
    } else if (narration?.src) {
      audioInputs.push({file: resolveAudio(narration.src), role: 'narration', gainDb: narrationTrack.gainDb});
    }
  }
  if (bgm?.src && musicTrack && !musicTrack.muted && !spec.editSpec.globalAudio.bgmMuted && (!hasAudioSolo || musicTrack.solo)) {
    audioInputs.push({file: resolveAudio(bgm.src), role: 'bgm', gainDb: musicTrack.gainDb + spec.editSpec.globalAudio.bgmGainDb, loop: true});
  }
  if (audioInputs.length) {
    const visualPath = path.join(workDir, 'hyperframes-visual.mp4');
    await renderHyperFrames(spec, path.join(workDir, 'hyperframes'), visualPath);
    const durationFrames = spec.editSpec.scenes.reduce((max, scene) => Math.max(max, scene.startFrame + scene.durationFrames), 1);
    await muxProjectAudio(visualPath, audioInputs, videoPath, durationFrames / spec.canvas.fps, mode === 'final' ? '320k' : '192k');
    return;
  }
  await renderHyperFrames(spec, path.join(workDir, 'hyperframes'), videoPath);
}

export async function renderProject(projectId: string, backendRequest: RenderBackendRequest, mode: 'preview' | 'final' = 'final') {
  const {spec} = await getProject(projectId);
  const validation = validateVideoSpec(spec);
  if (!validation.valid) throw new Error('VideoSpec 未通过阻断质量门，拒绝渲染');
  let routing = backendRequest === 'auto' ? (await import('./router')).routeRenderBackend(spec) : null;
  let backend: RenderBackend = routing?.selected ?? backendRequest as RenderBackend;
  const compiled = compileVideoSpec(spec);
  let targets = renderTargets(projectId, spec.revision, backend, mode);
  let videoPath = path.join(targets.publicDir, `${targets.slug}.mp4`);
  try {
    await renderWithBackend(spec, backend, mode, targets.publicDir, targets.workDir, videoPath);
    if (routing) routing = {...routing, executed: backend, fallbackApplied: false};
  } catch (error) {
    if (!routing) throw error;
    const firstError = error instanceof Error ? error.message : '首选引擎渲染失败';
    backend = routing.fallback;
    targets = renderTargets(projectId, spec.revision, backend, mode);
    videoPath = path.join(targets.publicDir, `${targets.slug}.mp4`);
    try {
      await renderWithBackend(spec, backend, mode, targets.publicDir, targets.workDir, videoPath);
      routing = {...routing, executed: backend, fallbackApplied: true, fallbackReason: firstError};
    } catch (fallbackError) {
      const secondError = fallbackError instanceof Error ? fallbackError.message : '备用引擎渲染失败';
      throw new Error(`自主路由的首选与备用引擎均渲染失败：${routing.selected}: ${firstError}；${backend}: ${secondError}`);
    }
  }
  const {slug, publicDir} = targets;
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
    routing,
    qualityGates: validation.gates,
    deliverables: ['MP4', 'SRT', 'VideoSpec', 'AssetManifest', 'RenderManifest'],
  };
  await writeFile(path.join(publicDir, 'RenderManifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return {
    manifest,
    routing,
    urls: {
      video: `/renders/${slug}/${slug}.mp4`,
      spec: `/renders/${slug}/VideoSpec.json`,
      subtitles: `/renders/${slug}/subtitles.srt`,
      assets: `/renders/${slug}/AssetManifest.json`,
      manifest: `/renders/${slug}/RenderManifest.json`,
    },
  };
}
