'use client';

import {Player, type PlayerRef} from '@remotion/player';
import {useEffect, useMemo, useRef} from 'react';
import {compileVideoSpec} from '@/lib/video-spec/compiler';
import type {VideoSpec} from '@/lib/video-spec/schema';
import {VideoComposition} from '@/remotion/VideoComposition';

export default function RemotionPreview({spec, focusFrame}: {spec: VideoSpec; focusFrame: number}) {
  const compiled = useMemo(() => compileVideoSpec(spec), [spec]);
  const playerRef = useRef<PlayerRef>(null);
  useEffect(() => {
    playerRef.current?.seekTo(Math.min(compiled.durationInFrames - 1, focusFrame));
  }, [compiled.durationInFrames, focusFrame]);
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
