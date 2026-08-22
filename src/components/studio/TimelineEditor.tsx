'use client';

import {useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent} from 'react';
import {Copy, Eye, EyeOff, Film, Layers3, Lock, Magnet, Pause, Play, Plus, Scissors, Subtitles, Trash2, Unlock, Volume2, VolumeX, ZoomIn, ZoomOut} from 'lucide-react';
import type {PatchOperation, TimelineTrack, VideoSpec} from '@/lib/video-spec/schema';
import {rippleReorderScene} from '@/lib/video-spec/timeline';

interface TimelineEditorProps {
  spec: VideoSpec;
  selectedSceneId: string;
  selectedAudioClipId: string | null;
  playheadFrame: number;
  playing: boolean;
  disabled: boolean;
  onSelect: (sceneId: string) => void;
  onSelectAudioClip: (clipId: string, startFrame: number) => void;
  onSeek: (frame: number) => void;
  onTogglePlayback: () => void;
  onPatch: (intent: string, patch: PatchOperation[]) => void;
  onSplit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onUndo: () => void;
}

type DragMode = 'move' | 'trim-start' | 'trim-end';
interface DragState {sceneId: string; trackId: string; mode: DragMode; startX: number; originalStart: number; originalDuration: number; delta: number}

const visualKinds = new Set<TimelineTrack['kind']>(['video', 'overlay']);

export function TimelineEditor(props: TimelineEditorProps) {
  const {spec, selectedSceneId, selectedAudioClipId, playheadFrame, playing, disabled, onSelect, onSelectAudioClip, onSeek, onTogglePlayback, onPatch, onSplit, onDuplicate, onDelete, onUndo} = props;
  const [zoom, setZoom] = useState(1.35);
  const [snap, setSnap] = useState(true);
  const [drag, setDrag] = useState<DragState | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const durationFrames = useMemo(() => spec.editSpec.scenes.reduce((max, scene) => Math.max(max, scene.startFrame + scene.durationFrames), 1), [spec.editSpec.scenes]);
  const durationSeconds = durationFrames / spec.canvas.fps;
  const contentWidth = Math.max(900, durationSeconds * 84 * zoom);
  const tracks = [...spec.editSpec.tracks].sort((a, b) => a.order - b.order);
  const snapFrames = snap ? Math.max(1, Math.round(spec.canvas.fps / 2)) : 1;
  const quantize = useCallback((frame: number) => Math.round(frame / snapFrames) * snapFrames, [snapFrames]);

  useEffect(() => {
    if (!playing) return;
    const scroller = scrollRef.current;
    if (!scroller) return;
    const playheadX = 156 + playheadFrame / durationFrames * (contentWidth - 156);
    const visibleStart = scroller.scrollLeft + 176;
    const visibleEnd = scroller.scrollLeft + scroller.clientWidth - 36;
    if (playheadX < visibleStart || playheadX > visibleEnd) {
      scroller.scrollTo({left: Math.max(0, playheadX - scroller.clientWidth * 0.48), behavior: 'auto'});
    }
  }, [contentWidth, durationFrames, playheadFrame, playing]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      if (event.code === 'Space') { event.preventDefault(); onTogglePlayback(); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') { event.preventDefault(); onSplit(); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); onDuplicate(); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); onUndo(); }
      if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); onDelete(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onDelete, onDuplicate, onSplit, onTogglePlayback, onUndo]);

  useEffect(() => {
    if (!drag) return;
    const move = (event: PointerEvent) => {
      const width = timelineRef.current?.scrollWidth ?? contentWidth;
      const rawDelta = (event.clientX - drag.startX) / width * durationFrames;
      setDrag((current) => current ? {...current, delta: quantize(rawDelta)} : null);
    };
    const end = (event: PointerEvent) => {
      const current = drag;
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-track-id]');
      const targetTrack = spec.editSpec.tracks.find((track) => track.id === target?.dataset.trackId);
      const patch: PatchOperation[] = [];
      const index = spec.editSpec.scenes.findIndex((scene) => scene.id === current.sceneId);
      if (index < 0) { setDrag(null); return; }
      if (current.mode === 'move') {
        const desiredStart = Math.max(0, current.originalStart + current.delta);
        if (targetTrack && visualKinds.has(targetTrack.kind) && targetTrack.id !== current.trackId && !targetTrack.locked) {
          if (current.delta !== 0) patch.push({op: 'replace', path: `/editSpec/scenes/${index}/startFrame`, value: desiredStart});
          patch.push({op: 'replace', path: `/editSpec/scenes/${index}/trackId`, value: targetTrack.id});
          onSeek(desiredStart);
        } else if (current.delta !== 0) {
          const reordered = rippleReorderScene(spec, current.sceneId, desiredStart);
          if (reordered.changed) {
            patch.push(
              {op: 'replace', path: '/editSpec/scenes', value: reordered.editScenes},
              {op: 'replace', path: '/storySpec/scenes', value: reordered.storyScenes},
            );
            if (spec.editSpec.globalAudio.narrationSegments.length) patch.push({op: 'replace', path: '/editSpec/globalAudio/narrationSegments', value: reordered.narrationSegments});
            onSeek(reordered.targetStartFrame);
          } else {
            const trackScenes = spec.editSpec.scenes.filter((scene) => scene.trackId === current.trackId).sort((left, right) => left.startFrame - right.startFrame);
            const position = trackScenes.findIndex((scene) => scene.id === current.sceneId);
            const previous = trackScenes[position - 1];
            const next = trackScenes[position + 1];
            const minimum = previous ? previous.startFrame + previous.durationFrames : 0;
            const maximum = next ? next.startFrame - current.originalDuration : Number.POSITIVE_INFINITY;
            const clamped = Math.max(minimum, Math.min(maximum, desiredStart));
            if (clamped !== current.originalStart) {
              patch.push({op: 'replace', path: `/editSpec/scenes/${index}/startFrame`, value: clamped});
              onSeek(clamped);
            }
          }
        }
      } else if (current.mode === 'trim-start') {
        const minimumDuration = Math.max(1, Math.round(spec.canvas.fps * 0.1));
        const delta = Math.max(-current.originalStart, Math.min(current.originalDuration - minimumDuration, current.delta));
        if (delta !== 0) {
          patch.push({op: 'replace', path: `/editSpec/scenes/${index}/startFrame`, value: current.originalStart + delta});
          patch.push({op: 'replace', path: `/editSpec/scenes/${index}/durationFrames`, value: current.originalDuration - delta});
          patch.push({op: 'replace', path: `/editSpec/scenes/${index}/sourceStartFrame`, value: Math.max(0, spec.editSpec.scenes[index].sourceStartFrame + delta)});
        }
      } else {
        const minimumDuration = Math.max(1, Math.round(spec.canvas.fps * 0.1));
        if (current.delta !== 0) patch.push({op: 'replace', path: `/editSpec/scenes/${index}/durationFrames`, value: Math.max(minimumDuration, current.originalDuration + current.delta)});
      }
      setDrag(null);
      if (patch.length) onPatch(`${current.mode === 'move' ? '移动' : '裁切'} ${current.sceneId}`, patch);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, {once: true});
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
  }, [contentWidth, drag, durationFrames, onPatch, onSeek, quantize, spec, spec.canvas.fps, spec.editSpec.scenes, spec.editSpec.tracks]);

  const beginDrag = (event: ReactPointerEvent, sceneId: string, mode: DragMode) => {
    if (disabled) return;
    const scene = spec.editSpec.scenes.find((item) => item.id === sceneId);
    const track = spec.editSpec.tracks.find((item) => item.id === scene?.trackId);
    if (!scene || track?.locked) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(sceneId);
    const lane = event.currentTarget.closest<HTMLElement>('.nle-lane');
    const laneRect = lane?.getBoundingClientRect();
    if (laneRect?.width) {
      const clickedFrame = Math.round((event.clientX - laneRect.left) / laneRect.width * durationFrames);
      onSeek(Math.max(scene.startFrame, Math.min(scene.startFrame + Math.max(0, scene.durationFrames - 1), clickedFrame)));
    }
    setDrag({sceneId, trackId: scene.trackId, mode, startX: event.clientX, originalStart: scene.startFrame, originalDuration: scene.durationFrames, delta: 0});
  };

  const patchTrack = (track: TimelineTrack, field: 'visible' | 'muted' | 'solo' | 'locked', value: boolean) => {
    const index = spec.editSpec.tracks.findIndex((item) => item.id === track.id);
    onPatch(`${value ? '启用' : '关闭'}轨道 ${track.name} 的 ${field}`, [{op: 'replace', path: `/editSpec/tracks/${index}/${field}`, value}]);
  };

  const addTrack = () => {
    const videoTracks = tracks.filter((track) => visualKinds.has(track.kind));
    const id = `video-layer-${Date.now().toString(36)}`;
    const next: TimelineTrack = {id, kind: 'overlay', name: `V${videoTracks.length + 1} · Overlay`, order: Math.max(0, ...tracks.map((track) => track.order)) + 1, visible: true, muted: false, solo: false, locked: false, gainDb: 0};
    onPatch('新增视频叠加轨', [{op: 'add', path: '/editSpec/tracks/-', value: next}]);
  };

  const seekFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(durationFrames - 1, quantize((event.clientX - rect.left) / rect.width * durationFrames))));
  };

  const tickStep = durationSeconds <= 20 ? 1 : durationSeconds <= 90 ? 5 : 10;
  const ticks = Array.from({length: Math.floor(durationSeconds / tickStep) + 1}, (_, index) => index * tickStep);

  return (
    <section className="nle-timeline panel" aria-label="多轨剪辑时间线">
      <div className="nle-toolbar">
        <div className="transport-group">
          <button type="button" onClick={onTogglePlayback} aria-label={playing ? '暂停' : '播放'}>{playing ? <Pause size={14}/> : <Play size={14}/>}</button>
          <time>{formatTime(playheadFrame, spec.canvas.fps)} / {formatTime(durationFrames, spec.canvas.fps)}</time>
        </div>
        <div className="edit-tools">
          <button type="button" onClick={onSplit} title="在播放头分割（⌘B）"><Scissors size={14}/>分割</button>
          <button type="button" onClick={onDuplicate} title="复制镜头（⌘D）"><Copy size={14}/>复制</button>
          <button type="button" onClick={onDelete} title="波纹删除（Delete）"><Trash2 size={14}/>删除</button>
          <button type="button" onClick={addTrack}><Plus size={14}/>轨道</button>
        </div>
        <div className="timeline-view-tools">
          <button className={snap ? 'active' : ''} type="button" onClick={() => setSnap((value) => !value)} title="0.5 秒吸附"><Magnet size={14}/></button>
          <ZoomOut size={13}/><input aria-label="时间线缩放" type="range" min="0.7" max="4" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))}/><ZoomIn size={13}/>
        </div>
      </div>
      <div className="nle-scroll" ref={scrollRef}>
        <div className="nle-content" ref={timelineRef} style={{width: contentWidth}}>
          <div className="nle-ruler" onPointerDown={seekFromPointer}>
            <div className="track-spacer">TRACKS</div>
            <div className="ruler-grid">{ticks.map((second) => <span key={second} style={{left: `${second / durationSeconds * 100}%`}}>{formatSeconds(second)}</span>)}</div>
          </div>
          {tracks.map((track) => <TrackRow key={track.id} track={track} spec={spec} durationFrames={durationFrames} selectedSceneId={selectedSceneId} selectedAudioClipId={selectedAudioClipId} drag={drag} onBeginDrag={beginDrag} onSelect={onSelect} onSelectAudioClip={onSelectAudioClip} onSeek={seekFromPointer} onTrackPatch={patchTrack}/>) }
          <div className="nle-playhead" style={{left: `calc(156px + ${(playheadFrame / durationFrames) * (contentWidth - 156)}px)`}}><i/><span/></div>
        </div>
      </div>
    </section>
  );
}

function TrackRow({track, spec, durationFrames, selectedSceneId, selectedAudioClipId, drag, onBeginDrag, onSelect, onSelectAudioClip, onSeek, onTrackPatch}: {
  track: TimelineTrack;
  spec: VideoSpec;
  durationFrames: number;
  selectedSceneId: string;
  selectedAudioClipId: string | null;
  drag: DragState | null;
  onBeginDrag: (event: ReactPointerEvent, sceneId: string, mode: DragMode) => void;
  onSelect: (sceneId: string) => void;
  onSelectAudioClip: (clipId: string, startFrame: number) => void;
  onSeek: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onTrackPatch: (track: TimelineTrack, field: 'visible' | 'muted' | 'solo' | 'locked', value: boolean) => void;
}) {
  const scenes = spec.editSpec.scenes.filter((scene) => scene.trackId === track.id);
  const audio = spec.editSpec.globalAudio.narrationSegments.filter((segment) => segment.trackId === track.id);
  const bgmAsset = track.id === 'audio-music' ? spec.assets.find((asset) => asset.id === spec.editSpec.globalAudio.bgmAssetId) : undefined;
  const captionScenes = track.kind === 'caption' ? spec.editSpec.scenes : [];
  const icon = track.kind === 'audio' ? <Volume2 size={13}/> : track.kind === 'caption' ? <Subtitles size={13}/> : track.kind === 'overlay' ? <Layers3 size={13}/> : <Film size={13}/>;
  return (
    <div className={`nle-track ${track.kind}`} data-track-id={track.id}>
      <div className="nle-track-head">
        <div><span>{icon}</span><strong>{track.name}</strong></div>
        <div className="track-toggles">
          <button type="button" onClick={() => onTrackPatch(track, 'visible', !track.visible)} aria-label={`${track.visible ? '隐藏' : '显示'} ${track.name}`}>{track.visible ? <Eye size={12}/> : <EyeOff size={12}/>}</button>
          {track.kind === 'audio' && <button type="button" onClick={() => onTrackPatch(track, 'muted', !track.muted)} aria-label={`${track.muted ? '取消静音' : '静音'} ${track.name}`}>{track.muted ? <VolumeX size={12}/> : <Volume2 size={12}/>}</button>}
          <button className={track.solo ? 'active' : ''} type="button" onClick={() => onTrackPatch(track, 'solo', !track.solo)} aria-label={`独奏 ${track.name}`}>S</button>
          <button type="button" onClick={() => onTrackPatch(track, 'locked', !track.locked)} aria-label={`${track.locked ? '解锁' : '锁定'} ${track.name}`}>{track.locked ? <Lock size={11}/> : <Unlock size={11}/>}</button>
        </div>
      </div>
      <div className="nle-lane" onPointerDown={onSeek}>
        {scenes.map((scene) => {
          const activeDrag = drag?.sceneId === scene.id ? drag : null;
          const leftFrame = activeDrag?.mode === 'move' || activeDrag?.mode === 'trim-start' ? Math.max(0, scene.startFrame + activeDrag.delta) : scene.startFrame;
          const minimumDuration = Math.max(1, Math.round(spec.canvas.fps * 0.1));
          const duration = activeDrag?.mode === 'trim-start' ? Math.max(minimumDuration, scene.durationFrames - activeDrag.delta) : activeDrag?.mode === 'trim-end' ? Math.max(minimumDuration, scene.durationFrames + activeDrag.delta) : scene.durationFrames;
          return <div key={scene.id} className={`nle-clip video-clip ${scene.id === selectedSceneId ? 'selected' : ''}`} style={{left: `${leftFrame / durationFrames * 100}%`, width: `${duration / durationFrames * 100}%`}} onPointerDown={(event) => onBeginDrag(event, scene.id, 'move')} onClick={() => onSelect(scene.id)}>
            <button className="clip-handle left" type="button" aria-label={`裁切 ${scene.id} 入点`} onPointerDown={(event) => onBeginDrag(event, scene.id, 'trim-start')}/>
            <span>{scene.component}</span><strong>{scene.id}</strong><small>{(scene.durationFrames / spec.canvas.fps).toFixed(1)}s</small>
            <button className="clip-handle right" type="button" aria-label={`裁切 ${scene.id} 出点`} onPointerDown={(event) => onBeginDrag(event, scene.id, 'trim-end')}/>
          </div>;
        })}
        {audio.map((segment) => <button type="button" key={segment.assetId} className={`nle-clip audio-clip ${selectedAudioClipId === segment.assetId ? 'selected' : ''} ${segment.muted ? 'muted' : ''}`} style={{left: `${segment.startFrame / durationFrames * 100}%`, width: `${segment.durationFrames / durationFrames * 100}%`}} title={`${segment.sceneId} · ${segment.muted ? '已静音' : '有声'} · 单击后在 Inspector 设置`} onPointerDown={(event) => event.stopPropagation()} onClick={() => onSelectAudioClip(segment.assetId, segment.startFrame)}>{segment.waveform.map((value, index) => <i key={index} style={{height: `${Math.max(8, value * 88)}%`}}/>)}{segment.muted && <VolumeX className="clip-mute-mark" size={12}/>}</button>)}
        {bgmAsset && <button type="button" className={`nle-clip audio-clip bgm-clip ${selectedAudioClipId === bgmAsset.id ? 'selected' : ''} ${spec.editSpec.globalAudio.bgmMuted ? 'muted' : ''}`} style={{left: 0, width: '100%'}} title={`${bgmAsset.attribution ?? 'Agent 自主配乐'} · 单击后在 Inspector 设置`} onPointerDown={(event) => event.stopPropagation()} onClick={() => onSelectAudioClip(bgmAsset.id, 0)}>{Array.from({length: 96}, (_, index) => <i key={index} style={{height: `${18 + ((index * 37 + spec.project.renderSeed) % 70)}%`}}/>)}{spec.editSpec.globalAudio.bgmMuted && <VolumeX className="clip-mute-mark" size={12}/>}</button>}
        {captionScenes.map((scene) => <button key={scene.id} type="button" className="nle-clip caption-clip" style={{left: `${scene.startFrame / durationFrames * 100}%`, width: `${scene.durationFrames / durationFrames * 100}%`}} onClick={() => onSelect(scene.id)}>CC · {scene.id}</button>)}
        {!scenes.length && !audio.length && !bgmAsset && !captionScenes.length && <span className="empty-track">将素材或镜头拖到这里</span>}
      </div>
    </div>
  );
}

function formatTime(frame: number, fps: number) {
  const seconds = Math.max(0, frame / fps);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
}

function formatSeconds(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return minutes ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}s`;
}
