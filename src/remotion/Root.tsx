import {Composition} from 'remotion';
import {createDefaultVideoSpec} from '../lib/video-spec/defaults';
import {compileVideoSpec} from '../lib/video-spec/compiler';
import {VideoComposition} from './VideoComposition';

const defaultSpec = createDefaultVideoSpec();
const compiled = compileVideoSpec(defaultSpec);

export function RemotionRoot() {
  return (
    <Composition
      id="PiCutVideo"
      component={VideoComposition}
      width={defaultSpec.canvas.width}
      height={defaultSpec.canvas.height}
      fps={defaultSpec.canvas.fps}
      durationInFrames={compiled.durationInFrames}
      defaultProps={{spec: defaultSpec}}
      calculateMetadata={({props}) => {
        const input = props;
        const value = compileVideoSpec(input.spec);
        return {
          width: input.spec.canvas.width,
          height: input.spec.canvas.height,
          fps: input.spec.canvas.fps,
          durationInFrames: value.durationInFrames,
          props: input,
        };
      }}
    />
  );
}
