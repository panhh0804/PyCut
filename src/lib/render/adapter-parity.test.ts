import {describe, expect, it} from 'vitest';
import {createDefaultVideoSpec} from '@/lib/video-spec/defaults';
import {compileVideoSpec} from '@/lib/video-spec/compiler';
import {createHyperFramesHtml} from './hyperframes-adapter';

describe('dual renderer contract', () => {
  it('compiles the same scene count, IDs, dimensions, fps and duration for HyperFrames', () => {
    const spec = createDefaultVideoSpec();
    const compiled = compileVideoSpec(spec);
    const html = createHyperFramesHtml(spec);
    expect(html).toContain('data-composition-id="picut-main"');
    expect(html).toContain(`data-width="${spec.canvas.width}"`);
    expect(html).toContain(`data-height="${spec.canvas.height}"`);
    expect(html).toContain(`data-fps="${spec.canvas.fps}"`);
    expect(html).toContain(`data-duration="${compiled.durationMs / 1000}"`);
    for (const scene of compiled.scenes) expect(html).toContain(`id="${scene.id}"`);
    expect(html.match(/class="clip scene"/g)).toHaveLength(compiled.scenes.length);
    expect(html).toContain('window.__timelines["picut-main"]');
  });
});

