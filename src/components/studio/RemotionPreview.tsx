'use client';

import {Player, type PlayerRef} from '@remotion/player';
import {useEffect, useMemo, useRef} from 'react';
import {compileVideoSpec} from '@/lib/video-spec/compiler';
import type {VideoSpec} from '@/lib/video-spec/schema';
import {VideoComposition} from '@/remotion/VideoComposition';

export default function RemotionPreview({spec, focusFrame, transport, onFrameChange, onPlaybackChange}: {
  spec: VideoSpec;
  focusFrame: number;
  transport: {id: number; action: 'play' | 'pause'};
  onFrameChange: (frame: number) => void;
  onPlaybackChange: (playing: boolean) => void;
}) {
  const compiled = useMemo(() => compileVideoSpec(spec), [spec]);
  const playerRef = useRef<PlayerRef>(null);
  useEffect(() => {
    playerRef.current?.seekTo(Math.min(compiled.durationInFrames - 1, focusFrame));
  }, [compiled.durationInFrames, focusFrame]);
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const update = (event: {detail: {frame: number}}) => onFrameChange(event.detail.frame);
    const play = () => onPlaybackChange(true);
    const pause = () => onPlaybackChange(false);
    player.addEventListener('timeupdate', update);
    player.addEventListener('play', play);
    player.addEventListener('pause', pause);
    return () => {
      player.removeEventListener('timeupdate', update);
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
      ref={playerRef}
      component={VideoComposition}
      inputProps={{spec}}
      durationInFrames={compiled.durationInFrames}
      compositionWidth={spec.canvas.width}
      compositionHeight={spec.canvas.height}
      fps={spec.canvas.fps}
      initialFrame={Math.min(compiled.durationInFrames - 1, focusFrame)}
      controls
      loop
      acknowledgeRemotionLicense
      style={{width: '100%', aspectRatio: `${spec.canvas.width} / ${spec.canvas.height}`, borderRadius: 16}}
    />
  );
}
