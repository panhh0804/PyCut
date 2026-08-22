import 'server-only';

import {createHash} from 'node:crypto';
import {mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {getProject, updateProject} from '@/lib/project/store';
import {createChangeSet} from '@/lib/video-spec/patch';
import {validateVideoSpec} from '@/lib/video-spec/validation';

export const BGM_STYLES = ['ambient', 'documentary', 'uplifting', 'technology', 'nature', 'minimal'] as const;
export type BgmStyle = typeof BGM_STYLES[number];

export interface ComposeBgmOptions {
  style: BgmStyle;
  direction: string;
  tempoBpm?: number;
  energy?: number;
  gainDb?: number;
}

const STYLE_SETTINGS: Record<BgmStyle, {tempo: number; root: number; progression: number[]; minor: boolean; pulse: number}> = {
  ambient: {tempo: 64, root: 48, progression: [0, 5, 3, 7], minor: false, pulse: 0.22},
  documentary: {tempo: 76, root: 45, progression: [0, 3, 7, 5], minor: true, pulse: 0.32},
  uplifting: {tempo: 104, root: 48, progression: [0, 7, 9, 5], minor: false, pulse: 0.58},
  technology: {tempo: 96, root: 43, progression: [0, 3, 10, 7], minor: true, pulse: 0.66},
  nature: {tempo: 72, root: 50, progression: [0, 5, 9, 7], minor: false, pulse: 0.3},
  minimal: {tempo: 82, root: 48, progression: [0, 0, 5, 3], minor: true, pulse: 0.4},
};

const midiFrequency = (note: number) => 440 * 2 ** ((note - 69) / 12);
const smoothstep = (value: number) => {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
};

function wavBuffer(durationSeconds: number, seed: number, options: Required<Pick<ComposeBgmOptions, 'style' | 'tempoBpm' | 'energy'>>) {
  const sampleRate = 44_100;
  const frames = Math.max(1, Math.round(durationSeconds * sampleRate));
  const bytesPerFrame = 4;
  const output = Buffer.allocUnsafe(44 + frames * bytesPerFrame);
  output.write('RIFF', 0);
  output.writeUInt32LE(36 + frames * bytesPerFrame, 4);
  output.write('WAVE', 8);
  output.write('fmt ', 12);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(2, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * bytesPerFrame, 28);
  output.writeUInt16LE(bytesPerFrame, 32);
  output.writeUInt16LE(16, 34);
  output.write('data', 36);
  output.writeUInt32LE(frames * bytesPerFrame, 40);

  const settings = STYLE_SETTINGS[options.style];
  const triad = settings.minor ? [0, 3, 7] : [0, 4, 7];
  let noiseState = seed || 0x6d2b79f5;
  const random = () => {
    noiseState ^= noiseState << 13;
    noiseState ^= noiseState >>> 17;
    noiseState ^= noiseState << 5;
    return (noiseState >>> 0) / 0xffffffff * 2 - 1;
  };
  const beatsPerSecond = options.tempoBpm / 60;
  const intro = Math.min(1.2, durationSeconds * 0.14);
  const outro = Math.min(1.8, durationSeconds * 0.18);
  for (let index = 0; index < frames; index += 1) {
    const time = index / sampleRate;
    const beat = time * beatsPerSecond;
    const bar = Math.floor(beat / 4);
    const barPhase = beat / 4 - bar;
    const chordRoot = settings.root + settings.progression[bar % settings.progression.length];
    const chordEnvelope = smoothstep(Math.min(barPhase * 10, (1 - barPhase) * 10));
    let padLeft = 0;
    let padRight = 0;
    for (let voice = 0; voice < triad.length; voice += 1) {
      const frequency = midiFrequency(chordRoot + triad[voice]);
      const phase = 2 * Math.PI * frequency * time;
      const tone = Math.sin(phase) + Math.sin(phase * 2 + voice * 0.7) * 0.16;
      padLeft += tone * (voice === 1 ? 0.72 : 1);
      padRight += tone * (voice === 1 ? 1 : 0.72);
    }
    const step = Math.floor(beat * 2);
    const stepPhase = beat * 2 - step;
    const arpeggioNote = chordRoot + triad[step % triad.length] + 12;
    const pluckEnvelope = Math.exp(-6.5 * stepPhase);
    const pluck = Math.sin(2 * Math.PI * midiFrequency(arpeggioNote) * time) * pluckEnvelope;
    const beatPhase = beat - Math.floor(beat);
    const bassEnvelope = Math.exp(-4.2 * beatPhase);
    const bass = Math.sin(2 * Math.PI * midiFrequency(chordRoot - 12) * time) * bassEnvelope;
    const percussionEnvelope = Math.exp(-18 * beatPhase);
    const percussion = (Math.sin(2 * Math.PI * (52 - beatPhase * 18) * time) + random() * 0.08) * percussionEnvelope;
    const air = random() * (0.006 + options.energy * 0.006) * Math.sin(Math.PI * Math.min(1, stepPhase * 2));
    const padAmount = 0.105 + (1 - options.energy) * 0.035;
    const pluckAmount = (0.035 + options.energy * 0.07) * settings.pulse;
    const rhythmAmount = (0.018 + options.energy * 0.06) * settings.pulse;
    const fade = smoothstep(time / Math.max(0.05, intro)) * smoothstep((durationSeconds - time) / Math.max(0.05, outro));
    const breath = 0.92 + Math.sin(time * Math.PI * 0.34) * 0.08;
    const left = Math.tanh((padLeft * padAmount * chordEnvelope * breath + pluck * pluckAmount * 0.82 + bass * rhythmAmount + percussion * rhythmAmount + air) * 1.35) * fade * 0.72;
    const right = Math.tanh((padRight * padAmount * chordEnvelope * breath + pluck * pluckAmount + bass * rhythmAmount * 0.94 + percussion * rhythmAmount + air) * 1.35) * fade * 0.72;
    output.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left)) * 32767), 44 + index * bytesPerFrame);
    output.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right)) * 32767), 46 + index * bytesPerFrame);
  }
  return output;
}

async function exists(file: string) {
  try { await stat(file); return true; } catch { return false; }
}

export async function composeProjectBgm(projectId: string, options: ComposeBgmOptions) {
  const record = await getProject(projectId);
  const spec = record.spec;
  const totalFrames = spec.editSpec.scenes.reduce((max, scene) => Math.max(max, scene.startFrame + scene.durationFrames), 1);
  const durationSeconds = totalFrames / spec.canvas.fps;
  const settings = STYLE_SETTINGS[options.style];
  const tempoBpm = Math.max(48, Math.min(144, options.tempoBpm ?? settings.tempo));
  const energy = Math.max(0, Math.min(1, options.energy ?? 0.45));
  // The generated source is already conservative (roughly -19 dB mean). Keep
  // the mix offset audible and let preview/export duck it under narration.
  const gainDb = Math.max(-24, Math.min(-6, options.gainDb ?? (spec.editSpec.globalAudio.narrationAssetId ? -12 : -8)));
  const digest = createHash('sha256').update(JSON.stringify({projectId, seed: spec.project.renderSeed, durationSeconds, style: options.style, tempoBpm, energy, pipeline: 'picut-bgm-v1'})).digest('hex').slice(0, 20);
  const safeId = projectId.replaceAll(/[^a-zA-Z0-9-_]/g, '-');
  const publicDir = path.join(process.cwd(), 'public', 'audio', safeId);
  const output = path.join(publicDir, `bgm-${digest}.wav`);
  await mkdir(publicDir, {recursive: true});
  const cacheHit = await exists(output);
  if (!cacheHit) await writeFile(output, wavBuffer(durationSeconds, spec.project.renderSeed, {style: options.style, tempoBpm, energy}));
  const assetId = `bgm-${digest}`;
  const asset = {
    id: assetId,
    kind: 'audio' as const,
    src: `/audio/${safeId}/${path.basename(output)}`,
    checksum: createHash('sha256').update(await readFile(output)).digest('hex'),
    license: 'generated:picut-procedural-bgm-v1',
    attribution: `${options.style} · ${tempoBpm} BPM · ${options.direction}`,
    durationMs: Math.round(durationSeconds * 1000),
  };
  const musicTrackIndex = spec.editSpec.tracks.findIndex((track) => track.id === 'audio-music');
  const patch = [
    {op: 'replace' as const, path: '/assets', value: [...spec.assets.filter((item) => !item.id.startsWith('bgm-')), asset]},
    {op: 'replace' as const, path: '/editSpec/globalAudio/bgmAssetId', value: assetId},
    {op: 'replace' as const, path: '/editSpec/globalAudio/bgmGainDb', value: gainDb},
    {op: 'replace' as const, path: '/editSpec/globalAudio/bgmMuted', value: false},
    ...(musicTrackIndex >= 0 ? [{op: 'replace' as const, path: `/editSpec/tracks/${musicTrackIndex}/gainDb`, value: 0}] : []),
  ];
  const changeSet = createChangeSet({
    baseRevision: spec.revision,
    actor: 'agent',
    intent: `为「${spec.project.title}」创作 ${options.style} 纯音乐：${options.direction}`,
    risk: 'medium',
    approval: 'not-required',
    patch,
  });
  const updated = await updateProject(projectId, changeSet);
  return {
    spec: updated.spec,
    validation: validateVideoSpec(updated.spec),
    audio: {assetId, url: asset.src, style: options.style, direction: options.direction, tempoBpm, energy, gainDb, durationMs: asset.durationMs, cacheHit},
  };
}
