import {AbsoluteFill, Sequence} from 'remotion';
import {compileVideoSpec} from '../lib/video-spec/compiler';
import type {ComponentType, VideoSpec} from '../lib/video-spec/schema';
import {CaptionKaraoke} from './components/CaptionKaraoke';
import {DynamicChart} from './components/DynamicChart';
import {SplitScreen} from './components/SplitScreen';
import {TextHero} from './components/TextHero';

export type VideoCompositionProps = {spec: VideoSpec} & Record<string, unknown>;

const components = {TextHero, SplitScreen, DynamicChart, CaptionKaraoke} satisfies Record<ComponentType, typeof TextHero>;

export function VideoComposition({spec}: VideoCompositionProps) {
  const compiled = compileVideoSpec(spec);
  return (
    <AbsoluteFill style={{backgroundColor: spec.style.tokens.background}}>
      {compiled.scenes.map((scene) => {
        const Component = components[scene.component];
        return (
          <Sequence key={scene.id} from={scene.startFrame} durationInFrames={scene.durationFrames} name={`${scene.index + 1}. ${scene.id}`}>
            <Component props={scene.props} spec={spec} sceneIndex={scene.index} durationInFrames={scene.durationFrames} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
