'use client';

import {Player, type PlayerRef} from '@remotion/player';
import {useEffect, useMemo, useRef} from 'react';
import {compileVideoSpec} from '@/lib/video-spec/compiler';
import type {VideoSpec} from '@/lib/video-spec/schema';
import {VideoComposition} from '@/remotion/VideoComposition';

export default function RemotionPreview({spec, focusFrame, transport, inFrame = null, outFrame = null, onFrameChange, onPlaybackChange}: {
  spec: VideoSpec;
  focusFrame: number;
  transport: {id: number; action: 'play' | 'pause'};
  inFrame?: number | null;
  outFrame?: number | null;
  onFrameChange: (frame: number) => void;
  onPlaybackChange: (playing: boolean) => void;
}) {
  const compiled = useMemo(() => compileVideoSpec(spec), [spec]);
  const playerRef = useRef<PlayerRef>(null);
  const firstFrame = Math.max(0, Math.min(compiled.durationInFrames - 1, inFrame ?? 0));
  const lastFrame = Math.max(firstFrame, Math.min(compiled.durationInFrames - 1, outFrame ?? compiled.durationInFrames - 1));
  const clampedFocusFrame = Math.max(firstFrame, Math.min(lastFrame, focusFrame));
  useEffect(() => {
    playerRef.current?.seekTo(clampedFocusFrame);
  }, [clampedFocusFrame]);
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const update = (event: {detail: {frame: number}}) => onFrameChange(event.detail.frame);
    const play = () => onPlaybackChange(true);
    const pause = () => onPlaybackChange(false);
    player.addEventListener('frameupdate', update);
    player.addEventListener('play', play);
    player.addEventListener('pause', pause);
    return () => {
      player.removeEventListener('frameupdate', update);
      player.removeEventListener('play', play);
      player.removeEventListener('pause', pause);
    };
  }, [onFrameChange, onPlaybackChange]);
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    if (transport.action === 'play') player.play();
    else player.pause();
  }, [transport]);
  return (
    <Player
      key={`${spec.project.id}-r${spec.revision}`}
      ref={playerRef}
      component={VideoComposition}
      inputProps={{spec}}
      durationInFrames={compiled.durationInFrames}
      compositionWidth={spec.canvas.width}
      compositionHeight={spec.canvas.height}
      fps={spec.canvas.fps}
      initialFrame={clampedFocusFrame}
      inFrame={firstFrame}
      outFrame={lastFrame}
      controls
      loop
      errorFallback={({error}) => <div className="preview-runtime-error" role="alert"><strong>预览渲染失败</strong><span>{error.message}</span><small>VideoSpec 与工作台仍然安全；修改镜头或重新载入后会自动重建播放器。</small></div>}
      acknowledgeRemotionLicense
      style={{width: '100%', aspectRatio: `${spec.canvas.width} / ${spec.canvas.height}`, borderRadius: 16}}
    />
  );
}
