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

  it('emits free canvas layers and camera motion without duplicate style attributes', () => {
    const spec = createDefaultVideoSpec('free-canvas-parity');
    spec.editSpec.scenes[0].component = 'SceneCanvas';
    spec.editSpec.scenes[0].props = {
      background: {type: 'linear', colors: ['#03111F', '#1B355A'], angle: 120},
      texture: 'grid', camera: {startScale: 1, endScale: 1.04, panX: -2, panY: 1},
      layers: [
        {id: 'lead', type: 'text', x: 8, y: 12, width: 60, height: 24, content: '自由构图', style: {fontSize: 88, color: '#FFFFFF'}, motion: {preset: 'rise'}},
        {id: 'signal', type: 'particles', x: 56, y: 20, width: 36, height: 52, content: '18', style: {color: '#76E6FF'}, motion: {preset: 'float'}},
        {id: 'path', type: 'line', x: 12, y: 58, width: 66, height: 18, content: 'semantic direction prompt only', style: {color: '#76E6FF', borderWidth: 3}, motion: {preset: 'draw'}},
      ],
    };
    const html = createHyperFramesHtml(spec);
    const section = html.match(/<section id="scene-01"[^>]*>/)?.[0] ?? '';
    expect(section.match(/style=/g)).toHaveLength(1);
    expect(html).toContain('id="scene-01-lead"');
    expect(html).toContain('id="scene-01-signal"');
    expect(html).toContain('class="free-line-stroke"');
    expect(html).not.toContain('semantic direction prompt only');
    expect(html).toContain('scale:1.04');
  });
});
