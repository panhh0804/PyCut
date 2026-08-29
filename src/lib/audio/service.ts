import 'server-only';

import {createHash} from 'node:crypto';
import {mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {getProject, updateProject} from '@/lib/project/store';
import {getModelApiKey} from '@/lib/server/model-secret';
import {createChangeSet} from '@/lib/video-spec/patch';
import type {NarrationSegment, TtsConfig, VideoSpec} from '@/lib/video-spec/schema';
import {validateVideoSpec} from '@/lib/video-spec/validation';

const MOSS_MODEL = 'fnlp/MOSS-TTSD-v0.5';
const DEFAULT_MODEL = MOSS_MODEL;
const DEFAULT_VOICE = 'FunAudioLLM/CosyVoice2-0.5B:charles';

const MOSS_REFERENCE_TEXT = '他又躺在那里，眼睛闭着，仍然沉浸在梦境的气氛里。那是个庞杂而亮堂的梦';
const MOSS_REFERENCE_VOICES: Record<string, string> = {
  claire: 'https://sf-maas-uat-prod.oss-cn-shanghai.aliyuncs.com/voice_template/fish_audio-Claire.mp3',
  anna: 'https://sf-maas-uat-prod.oss-cn-shanghai.aliyuncs.com/voice_template/fish_audio-Claire.mp3',
  charles: 'https://sf-maas-uat-prod.oss-cn-shanghai.aliyuncs.com/voice_template/fish_audio-Charles.mp3',
  benjamin: 'https://sf-maas-uat-prod.oss-cn-shanghai.aliyuncs.com/voice_template/fish_audio-Charles.mp3',
};

type SynthesisOptions = Partial<Pick<TtsConfig, 'model' | 'voice' | 'speed' | 'gainDb'>>;

function safeProjectId(projectId: string) {
  return projectId.replaceAll(/[^a-zA-Z0-9-_]/g, '-');
}

async function exists(file: string) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

function run(command: string, args: string[], capture = false) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(command, args, {stdio: ['ignore', capture ? 'pipe' : 'ignore', 'pipe']});
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve(Buffer.concat(stdout));
      else reject(new Error(`${path.basename(command)} 执行失败：${Buffer.concat(stderr).toString('utf8').slice(-800)}`));
    });
  });
}

async function durationMs(file: string) {
  const output = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], true);
  const seconds = Number(output.toString('utf8').trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('无法读取合成音频时长');
  return Math.round(seconds * 1000);
}

async function normalizeToScene(input: string, output: string, sourceMs: number, targetMs: number) {
  const targetSeconds = targetMs / 1000;
  const naturalSeconds = sourceMs / 1000;
  const processedSeconds = Math.min(naturalSeconds, targetSeconds);
  const fadeOutDuration = Math.min(0.07, Math.max(0.015, processedSeconds / 4));
  const fadeOutStart = Math.max(0, processedSeconds - fadeOutDuration);
  const filter = `aresample=44100:async=1:first_pts=0,afade=t=in:st=0:d=${Math.min(0.018, processedSeconds / 5).toFixed(3)},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOutDuration.toFixed(3)},apad=whole_dur=${targetSeconds.toFixed(3)},atrim=0:${targetSeconds.toFixed(3)}`;
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vn', '-af', filter, '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le', output]);
}

async function masterSpeechSession(input: string, output: string, loudness: number) {
  const filter = `aresample=44100:async=1:first_pts=0,highpass=f=65,lowpass=f=15000,acompressor=threshold=0.12:ratio=2.4:attack=18:release=180:makeup=1.15,loudnorm=I=${loudness}:TP=-1.5:LRA=9`;
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vn', '-af', filter, '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le', output]);
}

async function narrationBoundaries(file: string, texts: string[]) {
  const pcm = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'], true);
  const sampleRate = 8_000;
  const windowSamples = 160;
  const sampleCount = Math.floor(pcm.length / 2);
  const windows = Math.max(1, Math.floor(sampleCount / windowSamples));
  const energy = Array.from({length: windows}, (_, window) => {
    let sum = 0;
    const start = window * windowSamples;
    const end = Math.min(sampleCount, start + windowSamples);
    for (let sample = start; sample < end; sample += 1) sum += Math.abs(pcm.readInt16LE(sample * 2));
    return sum / Math.max(1, end - start);
  });
  const totalMs = sampleCount / sampleRate * 1000;
  const weights = texts.map((text) => Math.max(1, Array.from(text.replaceAll(/\s/g, '')).length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const boundaries = [0];
  let consumedWeight = 0;
  for (let index = 0; index < texts.length - 1; index += 1) {
    consumedWeight += weights[index];
    const expectedMs = totalMs * consumedWeight / totalWeight;
    const minimumMs = boundaries.at(-1)! + 260;
    const maximumMs = totalMs - (texts.length - index - 1) * 260;
    const searchRadiusMs = Math.min(2_000, Math.max(700, totalMs / texts.length * 0.34));
    const startWindow = Math.max(0, Math.floor(Math.max(minimumMs, expectedMs - searchRadiusMs) / 20));
    const endWindow = Math.min(windows - 1, Math.ceil(Math.min(maximumMs, expectedMs + searchRadiusMs) / 20));
    let quietestWindow = Math.max(startWindow, Math.min(endWindow, Math.round(expectedMs / 20)));
    let quietestScore = Number.POSITIVE_INFINITY;
    for (let window = startWindow; window <= endWindow; window += 1) {
      const score = energy.slice(Math.max(0, window - 4), Math.min(windows, window + 5)).reduce((sum, value) => sum + value, 0);
      const distancePenalty = Math.abs(window * 20 - expectedMs) / Math.max(1, searchRadiusMs) * 180;
      if (score + distancePenalty < quietestScore) {
        quietestScore = score + distancePenalty;
        quietestWindow = window;
      }
    }
    boundaries.push(Math.max(minimumMs, Math.min(maximumMs, quietestWindow * 20)));
  }
  boundaries.push(totalMs);
  return boundaries;
}

async function sliceSpeechSession(input: string, output: string, startMs: number, endMs: number) {
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vn',
    '-af', `atrim=start=${(startMs / 1000).toFixed(4)}:end=${(endMs / 1000).toFixed(4)},asetpts=PTS-STARTPTS`,
    '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le', output,
  ]);
}

/**
 * TTS speed is owned exclusively by the speech provider. We never hide an
 * additional atempo pass behind a value such as 1.0×. If natural speech does
 * not fit, the timeline grows and later scenes ripple forward.
 */
export function planNaturalNarrationTimeline(spec: VideoSpec, sourceDurationMsByScene: ReadonlyMap<string, number>) {
  const safetyTailMs = 180;
  let accumulatedDelta = 0;
  const scenes = spec.editSpec.scenes.map((scene) => {
    const sourceMs = sourceDurationMsByScene.get(scene.id) ?? 0;
    const naturalFrames = sourceMs > 0 ? Math.ceil((sourceMs + safetyTailMs) / 1000 * spec.canvas.fps) : scene.durationFrames;
    const durationFrames = Math.max(scene.durationFrames, naturalFrames);
    const next = {...scene, startFrame: scene.startFrame + accumulatedDelta, durationFrames};
    accumulatedDelta += durationFrames - scene.durationFrames;
    return next;
  });
  const durationInFrames = scenes.reduce((max, scene) => Math.max(max, scene.startFrame + scene.durationFrames), 1);
  const durationMs = Math.round(durationInFrames / spec.canvas.fps * 1000);
  if (durationMs > 180_000) throw new Error(`自然语速旁白需要 ${(durationMs / 1000).toFixed(1)} 秒，超过 180 秒上限；请先让 Agent 精简旁白，系统不会偷偷倍速压缩`);
  return {scenes, durationInFrames, durationMs, extendedByFrames: accumulatedDelta};
}

async function waveform(file: string, bucketCount = 120) {
  const pcm = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'], true);
  const samples = Math.floor(pcm.length / 2);
  const bucketSize = Math.max(1, Math.floor(samples / bucketCount));
  const values = Array.from({length: bucketCount}, (_, bucket) => {
    const start = bucket * bucketSize;
    const end = Math.min(samples, start + bucketSize);
    let peak = 0;
    for (let sample = start; sample < end; sample += 1) peak = Math.max(peak, Math.abs(pcm.readInt16LE(sample * 2)) / 32768);
    return Number(Math.max(0.04, peak).toFixed(4));
  });
  const maximum = Math.max(...values, 0.01);
  return values.map((value) => Number((value / maximum).toFixed(4)));
}

async function checksum(file: string) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

async function requestSpeech(text: string, output: string, config: TtsConfig) {
  const apiKey = getModelApiKey();
  if (!apiKey) throw new Error('未配置服务端模型密钥，无法合成旁白');
  const baseUrl = (process.env.PICUT_MODEL_BASE_URL ?? 'https://api.siliconflow.cn/v1').replace(/\/$/, '');
  const mossVoice = config.voice.split(':').at(-1)?.toLowerCase() ?? 'charles';
  const requestBody = config.model === MOSS_MODEL
    ? {
        model: config.model,
        input: `[S1]${text}`,
        references: [{audio: MOSS_REFERENCE_VOICES[mossVoice] ?? MOSS_REFERENCE_VOICES.charles, text: MOSS_REFERENCE_TEXT}],
        max_tokens: Math.min(1600, Math.max(320, text.length * 10)),
        response_format: 'mp3',
        speed: config.speed,
        gain: config.gainDb,
        stream: false,
      }
    : {
        model: config.model,
        voice: config.voice,
        input: `请用清晰、自然、温和的中文科普语气朗读。<|endofprompt|>${text}`,
        response_format: 'wav',
        sample_rate: 44100,
        speed: config.speed,
        gain: config.gainDb,
        stream: false,
      };
  const response = await fetch(`${baseUrl}/audio/speech`, {
    method: 'POST',
    headers: {'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json'},
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 600);
    throw new Error(`语音服务返回 ${response.status}：${detail}`);
  }
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length < 1024) throw new Error('语音服务返回的音频为空');
  await writeFile(output, audio);
}

async function mixMaster(spec: VideoSpec, segments: Array<{file: string; segment: NarrationSegment}>, output: string) {
  const totalFrames = spec.editSpec.scenes.reduce((max, scene) => Math.max(max, scene.startFrame + scene.durationFrames), 1);
  const totalSeconds = totalFrames / spec.canvas.fps;
  const inputs = segments.flatMap(({file}) => ['-i', file]);
  const delayed = segments.map(({segment}, index) => `[${index}:a]adelay=${Math.round(segment.startFrame / spec.canvas.fps * 1000)}|${Math.round(segment.startFrame / spec.canvas.fps * 1000)}[a${index}]`);
  const mixInputs = segments.map((_, index) => `[a${index}]`).join('');
  const filter = `${delayed.join(';')};${mixInputs}amix=inputs=${segments.length}:duration=longest:normalize=0,apad=whole_dur=${totalSeconds.toFixed(3)},atrim=0:${totalSeconds.toFixed(3)},loudnorm=I=${spec.constraints.loudnessTargetLUFS}:TP=-1.5:LRA=11[out]`;
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', filter, '-map', '[out]', '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le', output]);
}

export async function synthesizeProjectNarration(projectId: string, options: SynthesisOptions = {}) {
  const record = await getProject(projectId);
  const spec = record.spec;
  const config: TtsConfig = {
    provider: 'siliconflow',
    model: options.model ?? process.env.PICUT_TTS_MODEL ?? spec.editSpec.globalAudio.tts.model ?? DEFAULT_MODEL,
    voice: options.voice ?? process.env.PICUT_TTS_VOICE ?? spec.editSpec.globalAudio.tts.voice ?? DEFAULT_VOICE,
    speed: options.speed ?? spec.editSpec.globalAudio.tts.speed,
    gainDb: options.gainDb ?? spec.editSpec.globalAudio.tts.gainDb,
    responseFormat: 'wav',
    sampleRate: 44100,
  };
  const safeId = safeProjectId(projectId);
  const cacheDir = path.join(process.cwd(), '.picut', 'cache', 'tts');
  const publicDir = path.join(process.cwd(), 'public', 'audio', safeId);
  await Promise.all([mkdir(cacheDir, {recursive: true}), mkdir(publicDir, {recursive: true})]);

  const sessionScenes = spec.editSpec.scenes.map((scene) => {
    const story = spec.storySpec.scenes.find((item) => item.id === scene.id);
    if (!story) throw new Error(`${scene.id} 缺少旁白文本`);
    return {scene, story};
  });
  const sessionText = sessionScenes.map(({story}) => story.narration.trim()).join(config.model === MOSS_MODEL ? '\n[S1]' : '\n\n');
  const sessionDigest = createHash('sha256').update(JSON.stringify({texts: sessionScenes.map(({story}) => story.narration), config, pipeline: 'single-session-consistent-v1'})).digest('hex').slice(0, 20);
  const rawSessionFile = path.join(cacheDir, `${sessionDigest}-session-raw.${config.model === MOSS_MODEL ? 'mp3' : 'wav'}`);
  const masteredSessionFile = path.join(cacheDir, `${sessionDigest}-session-master.wav`);
  const sessionCacheHit = await exists(rawSessionFile) && await exists(masteredSessionFile);
  if (!(await exists(rawSessionFile))) await requestSpeech(sessionText, rawSessionFile, config);
  if (!(await exists(masteredSessionFile))) await masterSpeechSession(rawSessionFile, masteredSessionFile, spec.constraints.loudnessTargetLUFS);
  const boundaries = await narrationBoundaries(masteredSessionFile, sessionScenes.map(({story}) => story.narration));
  const rawEntries = await Promise.all(sessionScenes.map(async ({scene, story}, index) => {
    const startMs = boundaries[index];
    const endMs = boundaries[index + 1];
    const rawDigest = createHash('sha256').update(JSON.stringify({sessionDigest, sceneId: scene.id, startMs: Math.round(startMs), endMs: Math.round(endMs)})).digest('hex').slice(0, 20);
    const rawFile = path.join(cacheDir, `${rawDigest}-session-slice.wav`);
    const sliceCacheHit = await exists(rawFile);
    if (!sliceCacheHit) await sliceSpeechSession(masteredSessionFile, rawFile, startMs, endMs);
    return {scene, story, rawDigest, rawFile, rawCacheHit: sessionCacheHit && sliceCacheHit, sourceMs: await durationMs(rawFile)};
  }));

  const timing = planNaturalNarrationTimeline(spec, new Map(rawEntries.map((entry) => [entry.scene.id, entry.sourceMs])));
  const workingSpec: VideoSpec = {
    ...spec,
    project: {...spec.project, targetDurationMs: timing.durationMs},
    editSpec: {...spec.editSpec, scenes: timing.scenes},
    constraints: {...spec.constraints, maxDurationMs: Math.max(spec.constraints.maxDurationMs, timing.durationMs)},
  };
  const previousByScene = new Map(spec.editSpec.globalAudio.narrationSegments.map((segment) => [segment.sceneId, segment]));
  const generated = await Promise.all(rawEntries.map(async (entry, index) => {
    const scene = timing.scenes[index];
    const targetMs = Math.round(scene.durationFrames / spec.canvas.fps * 1000);
    const digest = createHash('sha256').update(JSON.stringify({rawDigest: entry.rawDigest, targetMs, pipeline: 'natural-ripple-padding-v3'})).digest('hex').slice(0, 20);
    const publicFile = path.join(publicDir, `${scene.id}-${digest}.wav`);
    const cacheHit = await exists(publicFile);
    if (!cacheHit) await normalizeToScene(entry.rawFile, publicFile, entry.sourceMs, targetMs);
    const previous = previousByScene.get(scene.id);
    const segment: NarrationSegment = {
      sceneId: scene.id,
      assetId: `narration-${scene.id}-${digest}`,
      trackId: 'audio-narration',
      startFrame: scene.startFrame,
      durationFrames: scene.durationFrames,
      sourceDurationMs: entry.sourceMs,
      renderedDurationMs: await durationMs(publicFile),
      muted: previous?.muted ?? false,
      gainDb: previous?.gainDb ?? 0,
      playbackRate: 1,
      waveform: await waveform(publicFile),
    };
    return {file: publicFile, segment, cacheHit: cacheHit && entry.rawCacheHit, src: `/audio/${safeId}/${path.basename(publicFile)}`};
  }));

  const masterDigest = createHash('sha256').update(generated.map((item) => `${item.segment.assetId}:${item.segment.startFrame}`).join('|')).digest('hex').slice(0, 20);
  const masterFile = path.join(publicDir, `narration-master-${masterDigest}.wav`);
  if (!(await exists(masterFile))) await mixMaster(workingSpec, generated, masterFile);
  const masterId = `narration-master-${masterDigest}`;
  const audioAssets = await Promise.all(generated.map(async (item) => ({
    id: item.segment.assetId,
    kind: 'audio' as const,
    src: item.src,
    checksum: await checksum(item.file),
    license: `generated:siliconflow-tts:${config.model}`,
    durationMs: item.segment.renderedDurationMs,
  })));
  audioAssets.push({
    id: masterId,
    kind: 'audio',
    src: `/audio/${safeId}/${path.basename(masterFile)}`,
    checksum: await checksum(masterFile),
    license: `generated:siliconflow-tts:${config.model}`,
    durationMs: await durationMs(masterFile),
  });
  const retainedAssets = spec.assets.filter((asset) => !asset.id.startsWith('narration-'));
  const changeSet = createChangeSet({
    baseRevision: spec.revision,
    actor: 'agent',
    intent: `为 ${spec.project.title} 合成 ${generated.length} 段旁白`,
    risk: 'medium',
    approval: 'not-required',
    patch: [
      {op: 'replace', path: '/assets', value: [...retainedAssets, ...audioAssets]},
      {op: 'replace', path: '/editSpec/scenes', value: timing.scenes},
      {op: 'replace', path: '/project/targetDurationMs', value: timing.durationMs},
      {op: 'replace', path: '/constraints/maxDurationMs', value: workingSpec.constraints.maxDurationMs},
      {op: 'replace', path: '/editSpec/globalAudio/narrationAssetId', value: masterId},
      {op: 'replace', path: '/editSpec/globalAudio/narrationSegments', value: generated.map((item) => item.segment)},
      {op: 'replace', path: '/editSpec/globalAudio/tts', value: config},
    ],
  });
  const updated = await updateProject(projectId, changeSet);
  return {
    spec: updated.spec,
    validation: validateVideoSpec(updated.spec),
    audio: {
      masterUrl: `/audio/${safeId}/${path.basename(masterFile)}`,
      segments: generated.map((item) => ({sceneId: item.segment.sceneId, assetId: item.segment.assetId, cacheHit: item.cacheHit, sourceDurationMs: item.segment.sourceDurationMs, renderedDurationMs: item.segment.renderedDurationMs})),
      config,
      timing: {policy: 'single-session-natural-speed-ripple', extendedByFrames: timing.extendedByFrames, durationMs: timing.durationMs},
      synthesisMode: 'single-session-consistent-voice',
    },
  };
}

export async function muxNarration(videoInput: string, narrationInput: string, output: string) {
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', videoInput, '-i', narrationInput, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', output]);
  return output;
}

export interface ProjectAudioMixInput {
  file: string;
  role: 'narration' | 'bgm';
  gainDb: number;
  startSeconds?: number;
  durationSeconds?: number;
  playbackRate?: number;
  loop?: boolean;
}

function explicitTempoChain(rate: number) {
  const parts: number[] = [];
  let remaining = rate;
  while (remaining > 2) { parts.push(2); remaining /= 2; }
  while (remaining < 0.5) { parts.push(0.5); remaining /= 0.5; }
  parts.push(remaining);
  return parts.map((part) => `atempo=${part.toFixed(6)}`).join(',');
}

export async function muxProjectAudio(videoInput: string, audioInputs: ProjectAudioMixInput[], output: string, projectDurationSeconds: number, bitrate = '320k') {
  if (!audioInputs.length) throw new Error('项目混音至少需要一个音频输入');
  const inputs = audioInputs.flatMap((input) => [...(input.loop ? ['-stream_loop', '-1'] : []), '-i', input.file]);
  const narrationLabels: string[] = [];
  const bgmLabels: string[] = [];
  const filters: string[] = [];
  audioInputs.forEach((input, index) => {
    const source = index + 1;
    const volume = 10 ** (input.gainDb / 20);
    const rate = Math.max(0.25, Math.min(4, input.playbackRate ?? 1));
    const tempo = Math.abs(rate - 1) > 0.0001 ? `,${explicitTempoChain(rate)}` : '';
    const clipDuration = Math.max(0.01, Math.min(projectDurationSeconds, input.durationSeconds ?? projectDurationSeconds));
    const delayMs = Math.max(0, Math.round((input.startSeconds ?? 0) * 1000));
    const fade = input.role === 'bgm'
      ? `,afade=t=in:st=0:d=${Math.min(1, projectDurationSeconds / 5).toFixed(3)},afade=t=out:st=${Math.max(0, projectDurationSeconds - Math.min(2, projectDurationSeconds / 4)).toFixed(3)}:d=${Math.min(2, projectDurationSeconds / 4).toFixed(3)}`
      : '';
    const label = `${input.role}_${index}`;
    filters.push(`[${source}:a]aresample=44100:async=1:first_pts=0${tempo},volume=${volume.toFixed(8)},atrim=0:${clipDuration.toFixed(3)}${fade},adelay=${delayMs}|${delayMs},apad=whole_dur=${projectDurationSeconds.toFixed(3)},atrim=0:${projectDurationSeconds.toFixed(3)}[${label}]`);
    (input.role === 'narration' ? narrationLabels : bgmLabels).push(`[${label}]`);
  });
  if (narrationLabels.length) {
    filters.push(narrationLabels.length === 1 ? `${narrationLabels[0]}anull[narration_bus]` : `${narrationLabels.join('')}amix=inputs=${narrationLabels.length}:duration=longest:normalize=0[narration_bus]`);
  }
  if (bgmLabels.length) {
    filters.push(bgmLabels.length === 1 ? `${bgmLabels[0]}anull[bgm_bus]` : `${bgmLabels.join('')}amix=inputs=${bgmLabels.length}:duration=longest:normalize=0[bgm_bus]`);
  }
  if (narrationLabels.length && bgmLabels.length) {
    filters.push('[narration_bus]asplit=2[narration_mix][narration_side]');
    // Keep a guaranteed audible music floor. Only the 65% dynamic branch is
    // side-chain compressed, so narration can never silence the BGM bus.
    filters.push('[bgm_bus]asplit=2[bgm_floor_in][bgm_dynamic_in]');
    filters.push('[bgm_floor_in]volume=0.35[bgm_floor]');
    filters.push('[bgm_dynamic_in]volume=0.65[bgm_dynamic]');
    filters.push('[bgm_dynamic][narration_side]sidechaincompress=threshold=0.055:ratio=2.4:attack=12:release=280:makeup=1[bgm_dynamic_ducked]');
    filters.push('[bgm_floor][bgm_dynamic_ducked]amix=inputs=2:duration=longest:normalize=0[ducked_bgm]');
    filters.push('[narration_mix][ducked_bgm]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95[mix]');
  } else if (narrationLabels.length) {
    filters.push('[narration_bus]alimiter=limit=0.95[mix]');
  } else {
    filters.push('[bgm_bus]alimiter=limit=0.95[mix]');
  }
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', videoInput, ...inputs,
    '-filter_complex', filters.join(';'), '-map', '0:v:0', '-map', '[mix]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', bitrate, '-t', projectDurationSeconds.toFixed(3), '-movflags', '+faststart', output,
  ]);
  return output;
}
