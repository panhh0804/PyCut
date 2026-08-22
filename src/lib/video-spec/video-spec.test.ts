import {describe, expect, it} from 'vitest';
import {createDefaultVideoSpec} from './defaults';
import {compileVideoSpec, toSrt} from './compiler';
import {applyChangeSet, createChangeSet, LockedFieldError, RevisionConflictError} from './patch';
import {videoSpecSchema} from './schema';
import {validateVideoSpec} from './validation';

describe('VideoSpec compiler contract', () => {
  it('parses the canonical 60 second project and passes every blocking gate', () => {
    const spec = createDefaultVideoSpec();
    expect(videoSpecSchema.parse(spec)).toEqual(spec);
    const compiled = compileVideoSpec(spec);
    expect(compiled.scenes).toHaveLength(6);
    expect(compiled.durationInFrames).toBe(1_800);
    expect(compiled.durationMs).toBe(60_000);
    const report = validateVideoSpec(spec);
    expect(report.valid).toBe(true);
    expect(report.gates).toHaveLength(7);
    expect(report.gates.some((gate) => gate.status === 'fail')).toBe(false);
  });

  it('emits complete SRT cues in scene order', () => {
    const srt = toSrt(createDefaultVideoSpec());
    expect(srt).toContain('00:00:00,000 --> 00:00:09,000');
    expect(srt).toContain('Transformer 的答案');
    expect(srt.match(/-->/g)).toHaveLength(6);
  });

  it('applies a model-authored auditable cascade patch without a regex translator', () => {
    const spec = createDefaultVideoSpec();
    const changeSet = createChangeSet({
      baseRevision: spec.revision,
      actor: 'agent',
      intent: '精确修改第 3 幕颜色和时长',
      risk: 'medium',
      approval: 'not-required',
      patch: [
        {op: 'replace', path: '/editSpec/scenes/2/props/accentColor', value: '#4D8DFF'},
        {op: 'replace', path: '/editSpec/scenes/2/durationFrames', value: 360},
        {op: 'replace', path: '/editSpec/scenes/3/startFrame', value: 930},
        {op: 'replace', path: '/editSpec/scenes/4/startFrame', value: 1230},
        {op: 'replace', path: '/editSpec/scenes/5/startFrame', value: 1560},
      ],
    });
    const next = applyChangeSet(spec, changeSet);
    expect(next.revision).toBe(1);
    expect(next.editSpec.scenes[2].props.accentColor).toBe('#4D8DFF');
    expect(next.editSpec.scenes[2].durationFrames).toBe(360);
    expect(next.editSpec.scenes[3].startFrame).toBe(930);
    expect(validateVideoSpec(next).valid).toBe(true);
  });

  it('enforces optimistic revision control', () => {
    const spec = createDefaultVideoSpec();
    const stale = createChangeSet({baseRevision: 4, actor: 'human', intent: 'stale', risk: 'low', approval: 'not-required', patch: [{op: 'replace', path: '/project/title', value: 'x'}]});
    expect(() => applyChangeSet(spec, stale)).toThrow(RevisionConflictError);
  });

  it('blocks agent writes to human-locked scenes while allowing human edits', () => {
    const spec = createDefaultVideoSpec();
    spec.editSpec.scenes[0].locks.locked = true;
    const patch = [{op: 'replace' as const, path: '/editSpec/scenes/0/props/title', value: 'New'}];
    const agentChange = createChangeSet({baseRevision: 0, actor: 'agent', intent: 'agent edit', risk: 'low', approval: 'not-required', patch});
    expect(() => applyChangeSet(spec, agentChange)).toThrow(LockedFieldError);
    const humanChange = createChangeSet({baseRevision: 0, actor: 'human', intent: 'human edit', risk: 'low', approval: 'not-required', patch});
    expect(applyChangeSet(spec, humanChange).editSpec.scenes[0].props.title).toBe('New');
  });

  it('produces reproducible diagnostics for every G1-G7 quality gate', () => {
    const status = (spec: ReturnType<typeof createDefaultVideoSpec>, id: string) => validateVideoSpec(spec).gates.find((item) => item.id === id)?.status;

    const badSchema = createDefaultVideoSpec();
    (badSchema.canvas as {fps: number}).fps = 29;
    expect(status(badSchema, 'G1')).toBe('fail');

    const badSemantics = createDefaultVideoSpec();
    badSemantics.storySpec.scenes.pop();
    expect(status(badSemantics, 'G2')).toBe('fail');

    const badTimeline = createDefaultVideoSpec();
    badTimeline.editSpec.scenes[1].startFrame = 200;
    expect(status(badTimeline, 'G3')).toBe('fail');

    const badAsset = createDefaultVideoSpec();
    (badAsset.assets as Array<{id: string; kind: 'image'; src: string}>).push({id: 'missing-src', kind: 'image', src: ''});
    expect(status(badAsset, 'G4')).toBe('fail');

    const badComponent = createDefaultVideoSpec();
    (badComponent.editSpec.scenes[0] as {component: string}).component = 'UnknownCard';
    expect(status(badComponent, 'G5')).toBe('fail');

    expect(status(createDefaultVideoSpec(), 'G6')).toBe('warn');

    const badDelivery = createDefaultVideoSpec();
    (badDelivery as {schemaVersion: string}).schemaVersion = '0.9.0';
    expect(status(badDelivery, 'G7')).toBe('fail');
  });
});
