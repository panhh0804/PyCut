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

function atempoChain(factor: number) {
  const filters: number[] = [];
  let remaining = factor;
  while (remaining > 2) {
    filters.push(2);
    remaining /= 2;
  }
  while (remaining < 0.5) {
    filters.push(0.5);
    remaining /= 0.5;
  }
  filters.push(remaining);
  return filters.map((value) => `atempo=${value.toFixed(6)}`).join(',');
}

async function normalizeToScene(input: string, output: string, sourceMs: number, targetMs: number, loudness: number) {
  const targetSeconds = targetMs / 1000;
  const naturalSeconds = sourceMs / 1000;
  const speechWindowSeconds = Math.max(0.08, targetSeconds - Math.min(0.14, targetSeconds * 0.12));
  const tempo = naturalSeconds > speechWindowSeconds ? naturalSeconds / speechWindowSeconds : 1;
  const processedSeconds = naturalSeconds / tempo;
  const fadeOutDuration = Math.min(0.07, Math.max(0.015, processedSeconds / 4));
  const fadeOutStart = Math.max(0, processedSeconds - fadeOutDuration);
  const tempoFilter = tempo > 1.01 ? `${atempoChain(tempo)},` : '';
  const filter = `${tempoFilter}aresample=44100:async=1:first_pts=0,afade=t=in:st=0:d=${Math.min(0.018, processedSeconds / 5).toFixed(3)},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOutDuration.toFixed(3)},apad=whole_dur=${targetSeconds.toFixed(3)},atrim=0:${targetSeconds.toFixed(3)},loudnorm=I=${loudness}:TP=-1.5:LRA=11`;
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vn', '-af', filter, '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le', output]);
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

  const generated = await Promise.all(spec.editSpec.scenes.map(async (scene) => {
    const story = spec.storySpec.scenes.find((item) => item.id === scene.id);
    if (!story) throw new Error(`${scene.id} 缺少旁白文本`);
    const targetMs = Math.round(scene.durationFrames / spec.canvas.fps * 1000);
    const rawDigest = createHash('sha256').update(JSON.stringify({text: story.narration, config, targetMs})).digest('hex').slice(0, 20);
    const digest = createHash('sha256').update(JSON.stringify({rawDigest, targetMs, pipeline: 'natural-padding-fade-v2'})).digest('hex').slice(0, 20);
    const rawFile = path.join(cacheDir, `${rawDigest}-raw.${config.model === MOSS_MODEL ? 'mp3' : 'wav'}`);
    const publicFile = path.join(publicDir, `${scene.id}-${digest}.wav`);
    const cacheHit = await exists(publicFile);
    let sourceMs: number;
    if (!cacheHit) {
      if (!(await exists(rawFile))) await requestSpeech(story.narration, rawFile, config);
      sourceMs = await durationMs(rawFile);
      await normalizeToScene(rawFile, publicFile, sourceMs, targetMs, spec.constraints.loudnessTargetLUFS);
    } else {
      sourceMs = await durationMs(rawFile).catch(() => targetMs);
    }
    const segment: NarrationSegment = {
      sceneId: scene.id,
      assetId: `narration-${scene.id}-${digest}`,
      trackId: 'audio-narration',
      startFrame: scene.startFrame,
      durationFrames: scene.durationFrames,
      sourceDurationMs: sourceMs,
      renderedDurationMs: await durationMs(publicFile),
      waveform: await waveform(publicFile),
    };
    return {file: publicFile, segment, cacheHit, src: `/audio/${safeId}/${path.basename(publicFile)}`};
  }));

  const masterDigest = createHash('sha256').update(generated.map((item) => `${item.segment.assetId}:${item.segment.startFrame}`).join('|')).digest('hex').slice(0, 20);
  const masterFile = path.join(publicDir, `narration-master-${masterDigest}.wav`);
  if (!(await exists(masterFile))) await mixMaster(spec, generated, masterFile);
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
    },
  };
}

export async function muxNarration(videoInput: string, narrationInput: string, output: string) {
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', videoInput, '-i', narrationInput, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', output]);
  return output;
}
