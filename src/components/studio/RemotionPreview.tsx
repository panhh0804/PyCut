'use client';

import {Player, type PlayerRef} from '@remotion/player';
import {forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef} from 'react';
import {compileVideoSpec} from '@/lib/video-spec/compiler';
import type {VideoSpec} from '@/lib/video-spec/schema';
import {VideoComposition} from '@/remotion/VideoComposition';

export interface RemotionPreviewRef {
  pause: () => void;
  seekTo: (frame: number) => void;
  togglePlayback: () => void;
}

interface RemotionPreviewProps {
  spec: VideoSpec;
  focusFrame: number;
  inFrame?: number | null;
  outFrame?: number | null;
  loop?: boolean;
  onFrameChange: (frame: number) => void;
  onPlaybackChange: (playing: boolean) => void;
}

const RemotionPreview = forwardRef<RemotionPreviewRef, RemotionPreviewProps>(function RemotionPreview({spec, focusFrame, inFrame = null, outFrame = null, loop = false, onFrameChange, onPlaybackChange}, ref) {
  const compiled = useMemo(() => compileVideoSpec(spec), [spec]);
  const inputProps = useMemo(() => ({spec}), [spec]);
  const playerStyle = useMemo(() => ({width: '100%', aspectRatio: `${spec.canvas.width} / ${spec.canvas.height}`, borderRadius: 16}), [spec.canvas.height, spec.canvas.width]);
  const playerRef = useRef<PlayerRef>(null);
  const lastReportedFrameRef = useRef<number | null>(null);
  const firstFrame = Math.max(0, Math.min(compiled.durationInFrames - 1, inFrame ?? 0));
  const lastFrame = Math.max(firstFrame, Math.min(compiled.durationInFrames - 1, outFrame ?? compiled.durationInFrames - 1));
  const clampedFocusFrame = Math.max(firstFrame, Math.min(lastFrame, focusFrame));

  useImperativeHandle(ref, () => ({
    pause: () => {
      const player = playerRef.current;
      if (!player) {
        onPlaybackChange(false);
        return;
      }
      player.pause();
    },
    seekTo: (frame: number) => {
      const next = Math.max(firstFrame, Math.min(lastFrame, Math.round(frame)));
      playerRef.current?.seekTo(next);
    },
    togglePlayback: () => {
      const player = playerRef.current;
      if (!player) return;
      // This method is called synchronously from the single timeline transport
      // button. Keeping the user gesture on the real Player also avoids browser
      // audio-unlock races caused by dispatching a second React transport state.
      if (player.isPlaying()) player.pause();
      else player.play();
    },
  }), [firstFrame, lastFrame, onPlaybackChange]);

  useEffect(() => {
    playerRef.current?.seekTo(clampedFocusFrame);
  }, [clampedFocusFrame]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const update = (event: {detail: {frame: number}}) => {
      if (lastReportedFrameRef.current === event.detail.frame) return;
      lastReportedFrameRef.current = event.detail.frame;
      onFrameChange(event.detail.frame);
    };
    const play = () => onPlaybackChange(true);
    const pause = () => onPlaybackChange(false);
    player.addEventListener('frameupdate', update);
    player.addEventListener('seeked', update);
    player.addEventListener('play', play);
    player.addEventListener('pause', pause);
    player.addEventListener('ended', pause);
    return () => {
      // A revision rebuilds the Remotion Player. Stop the old instance before
      // attaching the single clock listener to the new one, otherwise its audio
      // can overlap briefly and the timeline remains subscribed to a stale ref.
      player.pause();
      player.removeEventListener('frameupdate', update);
      player.removeEventListener('seeked', update);
      player.removeEventListener('play', play);
      player.removeEventListener('pause', pause);
      player.removeEventListener('ended', pause);
      lastReportedFrameRef.current = null;
      onPlaybackChange(false);
    };
  }, [onFrameChange, onPlaybackChange, spec.project.id, spec.revision]);

  return (
    <Player
      key={`${spec.project.id}-r${spec.revision}`}
      ref={playerRef}
      component={VideoComposition}
      inputProps={inputProps}
      durationInFrames={compiled.durationInFrames}
      compositionWidth={spec.canvas.width}
      compositionHeight={spec.canvas.height}
      fps={spec.canvas.fps}
      initialFrame={clampedFocusFrame}
      inFrame={firstFrame}
      outFrame={lastFrame}
      controls={false}
      clickToPlay={false}
      loop={loop}
      errorFallback={({error}) => <div className="preview-runtime-error" role="alert"><strong>预览渲染失败</strong><span>{error.message}</span><small>VideoSpec 与工作台仍然安全；修改镜头或重新载入后会自动重建播放器。</small></div>}
      acknowledgeRemotionLicense
      style={playerStyle}
    />
  );
});

// Studio updates its timecode while playing. Do not reconcile the full Player
// and audio graph for every UI tick when all preview inputs are unchanged.
export default memo(RemotionPreview);
