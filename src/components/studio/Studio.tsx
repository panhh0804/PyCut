'use client';

import dynamic from 'next/dynamic';
import {useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent} from 'react';
import {
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  Download,
  Gauge,
  LoaderCircle,
  Lock,
  MessageSquareText,
  MonitorPlay,
  MousePointer2,
  PanelRight,
  Play,
  RotateCcw,
  Send,
  Sparkles,
  Unlock,
  WandSparkles,
} from 'lucide-react';
import type {ChangeSet, VideoSpec} from '@/lib/video-spec/schema';
import type {ValidationReport} from '@/lib/video-spec/validation';

const RemotionPreview = dynamic(() => import('./RemotionPreview'), {
  ssr: false,
  loading: () => <div className="preview-loading"><LoaderCircle className="spin" /> 正在装载确定性画布…</div>,
});

interface ChatMessage {id: string; role: 'agent' | 'human'; text: string; meta?: string}
interface RenderResult {urls: {video: string; spec: string; subtitles: string; assets: string; manifest: string}}
interface StudioProps {initialSpec: VideoSpec; initialValidation: ValidationReport; initialPendingApproval: ChangeSet | null}

const PROJECT_ID = 'transformer-60s';

const starterMessages: ChatMessage[] = [
  {id: 'hello', role: 'agent', text: '已观察项目：60 秒 Transformer 注意力机制，6 个分镜已编译。你可以直接描述局部修改，或在右侧与时间轴手动调整。', meta: 'π Agent · ready'},
];

export function Studio({initialSpec, initialValidation, initialPendingApproval}: StudioProps) {
  const [spec, setSpec] = useState(initialSpec);
  const [validation, setValidation] = useState(initialValidation);
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages);
  const [prompt, setPrompt] = useState('');
  const [selectedSceneId, setSelectedSceneId] = useState(initialSpec.editSpec.scenes[0]?.id ?? '');
  const [busy, setBusy] = useState<'agent' | 'save' | 'render' | 'undo' | null>(null);
  const [renderBackend, setRenderBackend] = useState<'remotion' | 'hyperframes'>('remotion');
  const [renderResult, setRenderResult] = useState<RenderResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<ChangeSet | null>(initialPendingApproval);
  const timelineCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => timelineCleanupRef.current?.(), []);

  const selectedIndex = Math.max(0, spec.editSpec.scenes.findIndex((scene) => scene.id === selectedSceneId));
  const selectedScene = spec.editSpec.scenes[selectedIndex];
  const storyScene = spec.storySpec.scenes.find((scene) => scene.id === selectedSceneId);
  const durationFrames = useMemo(() => spec.editSpec.scenes.reduce((max, scene) => Math.max(max, scene.startFrame + scene.durationFrames), 1), [spec]);

  const updateFromResponse = useCallback((data: {spec: VideoSpec; validation: ValidationReport}) => {
    setSpec(data.spec);
    setValidation(data.validation);
  }, []);

  const submitPrompt = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    const instruction = prompt.trim();
    if (!instruction || busy) return;
    setMessages((current) => [...current, {id: crypto.randomUUID(), role: 'human', text: instruction, meta: 'You · just now'}]);
    setPrompt('');
    setBusy('agent');
    setNotice(null);
    try {
      const response = await fetch('/api/agent/run', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({projectId: PROJECT_ID, prompt: instruction})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Agent 请求失败');
      updateFromResponse(data);
      setPendingApproval(data.pendingApproval ?? null);
      setMessages((current) => [...current, {id: crypto.randomUUID(), role: 'agent', text: data.response, meta: `${data.model} · ${data.executionMode}`}]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Agent 请求失败');
    } finally {
      setBusy(null);
    }
  }, [busy, prompt, updateFromResponse]);

  const resolveApproval = useCallback(async (decision: 'approve' | 'reject') => {
    if (busy || !pendingApproval) return;
    const instruction = decision === 'approve' ? '确认上述结构修改' : '拒绝上述结构修改';
    setMessages((current) => [...current, {id: crypto.randomUUID(), role: 'human', text: instruction, meta: 'Human approval'}]);
    setBusy('agent');
    setNotice(null);
    try {
      const response = await fetch('/api/agent/run', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({projectId: PROJECT_ID, prompt: instruction}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '审批处理失败');
      updateFromResponse(data);
      setPendingApproval(data.pendingApproval ?? null);
      setMessages((current) => [...current, {id: crypto.randomUUID(), role: 'agent', text: data.response, meta: `${data.model} · approval resolved`}]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '审批处理失败');
    } finally {
      setBusy(null);
    }
  }, [busy, pendingApproval, updateFromResponse]);

  const commitPatch = useCallback(async (intent: string, patch: Array<{op: 'replace' | 'add' | 'remove'; path: string; value?: unknown}>) => {
    if (busy) return;
    setBusy('save');
    setNotice(null);
    try {
      const response = await fetch(`/api/projects/${PROJECT_ID}/changesets`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({baseRevision: spec.revision, intent, risk: patch.length > 2 ? 'medium' : 'low', patch}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '修改保存失败');
      updateFromResponse(data);
      setMessages((current) => [...current, {id: crypto.randomUUID(), role: 'agent', text: `已同步手动编辑：${intent}。ChangeSet 已提交到 r${data.spec.revision}。`, meta: 'UI → VideoSpec → Agent'}]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '修改保存失败');
    } finally {
      setBusy(null);
    }
  }, [busy, spec.revision, updateFromResponse]);

  const updateDuration = useCallback((seconds: number) => {
    const nextFrames = Math.max(spec.canvas.fps * 3, Math.round(seconds * spec.canvas.fps));
    const delta = nextFrames - selectedScene.durationFrames;
    const patch: Array<{op: 'replace'; path: string; value: number}> = [
      {op: 'replace', path: `/editSpec/scenes/${selectedIndex}/durationFrames`, value: nextFrames},
    ];
    spec.editSpec.scenes.slice(selectedIndex + 1).forEach((scene, offset) => {
      patch.push({op: 'replace', path: `/editSpec/scenes/${selectedIndex + offset + 1}/startFrame`, value: scene.startFrame + delta});
    });
    void commitPatch(`将 ${selectedScene.id} 时长调整为 ${seconds.toFixed(1)} 秒`, patch);
  }, [commitPatch, selectedIndex, selectedScene, spec]);

  const beginTimelineResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>, edge: 'start' | 'end', sceneIndex: number) => {
    if (busy) return;
    event.preventDefault();
    event.stopPropagation();
    const lane = event.currentTarget.closest('.track-lane');
    const laneWidth = lane?.getBoundingClientRect().width ?? 0;
    if (laneWidth <= 0) return;

    const snapshot = spec;
    const startX = event.clientX;
    const minFrames = snapshot.canvas.fps * 3;
    const snapFrames = snapshot.canvas.fps / 2;
    let finalScenes = snapshot.editSpec.scenes;
    let lastDelta = 0;
    timelineCleanupRef.current?.();
    const listenerController = new AbortController();
    setSelectedSceneId(snapshot.editSpec.scenes[sceneIndex].id);
    document.body.classList.add('timeline-resizing');

    const onMove = (pointerEvent: PointerEvent) => {
      const rawFrames = (pointerEvent.clientX - startX) / laneWidth * durationFrames;
      let delta = Math.round(rawFrames / snapFrames) * snapFrames;
      const current = snapshot.editSpec.scenes[sceneIndex];

      if (edge === 'start') {
        const previous = snapshot.editSpec.scenes[sceneIndex - 1];
        if (!previous) return;
        delta = Math.max(minFrames - previous.durationFrames, Math.min(current.durationFrames - minFrames, delta));
        finalScenes = snapshot.editSpec.scenes.map((scene, index) => {
          if (index === sceneIndex - 1) return {...scene, durationFrames: previous.durationFrames + delta};
          if (index === sceneIndex) return {...scene, startFrame: current.startFrame + delta, durationFrames: current.durationFrames - delta};
          return scene;
        });
      } else {
        delta = Math.max(minFrames - current.durationFrames, delta);
        finalScenes = snapshot.editSpec.scenes.map((scene, index) => {
          if (index === sceneIndex) return {...scene, durationFrames: current.durationFrames + delta};
          if (index > sceneIndex) return {...scene, startFrame: scene.startFrame + delta};
          return scene;
        });
      }

      lastDelta = delta;
      setSpec({...snapshot, editSpec: {...snapshot.editSpec, scenes: finalScenes}});
    };

    const cleanup = () => {
      listenerController.abort();
      document.body.classList.remove('timeline-resizing');
      timelineCleanupRef.current = null;
    };

    const onUp = () => {
      cleanup();
      if (lastDelta === 0) return;
      const patch: Array<{op: 'replace'; path: string; value: number}> = [];
      finalScenes.forEach((scene, index) => {
        const before = snapshot.editSpec.scenes[index];
        if (scene.startFrame !== before.startFrame) patch.push({op: 'replace', path: `/editSpec/scenes/${index}/startFrame`, value: scene.startFrame});
        if (scene.durationFrames !== before.durationFrames) patch.push({op: 'replace', path: `/editSpec/scenes/${index}/durationFrames`, value: scene.durationFrames});
      });
      const boundary = edge === 'start' ? '入点' : '出点';
      void commitPatch(`在时间轴拖动 ${snapshot.editSpec.scenes[sceneIndex].id} ${boundary} ${Math.abs(lastDelta / snapshot.canvas.fps).toFixed(1)} 秒`, patch);
    };

    timelineCleanupRef.current = cleanup;
    window.addEventListener('pointermove', onMove, {signal: listenerController.signal});
    window.addEventListener('pointerup', onUp, {once: true, signal: listenerController.signal});
    window.addEventListener('pointercancel', onUp, {once: true, signal: listenerController.signal});
  }, [busy, commitPatch, durationFrames, spec]);

  const undo = useCallback(async () => {
    if (busy) return;
    setBusy('undo');
    try {
      const response = await fetch(`/api/projects/${PROJECT_ID}/undo`, {method: 'POST'});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '撤销失败');
      updateFromResponse(data);
      setMessages((current) => [...current, {id: crypto.randomUUID(), role: 'agent', text: `已撤销上一项变更，并生成可追踪的新版本 r${data.spec.revision}。`, meta: 'Undo · revisioned'}]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '撤销失败');
    } finally {
      setBusy(null);
    }
  }, [busy, updateFromResponse]);

  const render = useCallback(async () => {
    if (busy || !validation.valid) return;
    setBusy('render');
    setRenderResult(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/projects/${PROJECT_ID}/render`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({backend: renderBackend, mode: 'final'})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '渲染失败');
      setRenderResult(data);
      setMessages((current) => [...current, {id: crypto.randomUUID(), role: 'agent', text: `${renderBackend === 'remotion' ? 'Remotion' : 'HyperFrames'} 最终渲染完成，五件套交付物已生成。`, meta: 'G1–G7 · delivered'}]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '渲染失败');
    } finally {
      setBusy(null);
    }
  }, [busy, renderBackend, validation.valid]);

  if (!selectedScene) return null;
  return (
    <main className="studio-shell">
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark">π</div><div><strong>πCut</strong><span>Agentic Video Compiler</span></div></div>
        <div className="project-breadcrumb"><span>Projects</span><b>/</b><strong>{spec.project.title}</strong><span className="revision-chip">r{spec.revision}</span></div>
        <div className="top-actions">
          <button className="icon-button" type="button" onClick={undo} disabled={Boolean(busy)} aria-label="撤销上一项修改"><RotateCcw size={17} /></button>
          <div className={`quality-pill ${validation.valid ? 'pass' : 'fail'}`}><span /> {validation.valid ? 'G1–G7 Ready' : 'Quality blocked'}</div>
          <label className="backend-select">Engine<select value={renderBackend} onChange={(event) => setRenderBackend(event.target.value as typeof renderBackend)}><option value="remotion">Remotion</option><option value="hyperframes">HyperFrames</option></select><ChevronDown size={14} /></label>
          <button className="export-button" type="button" onClick={render} disabled={Boolean(busy) || !validation.valid}>{busy === 'render' ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />} Export MP4</button>
        </div>
      </header>

      {notice && <div className="notice" role="alert"><CircleAlert size={17}/>{notice}<button type="button" onClick={() => setNotice(null)}>关闭</button></div>}

      <div className="workspace-grid">
        <aside className="chat-panel panel">
          <div className="panel-heading"><div><MessageSquareText size={17}/><strong>Director</strong></div><span className="live-dot">Live</span></div>
          <div className="chat-context"><Sparkles size={15}/><div><strong>π Agent / ReAct</strong><span>Observe → Tool → Validate</span></div></div>
          <div className="message-list" aria-live="polite">
            {messages.map((message) => <article className={`message ${message.role}`} key={message.id}><div className="avatar">{message.role === 'agent' ? <Bot size={17}/> : '你'}</div><div><span className="message-meta">{message.meta}</span><p>{message.text}</p></div></article>)}
            {busy === 'agent' && <article className="message agent"><div className="avatar"><Bot size={17}/></div><div><span className="message-meta">π Agent · ReAct loop</span><p className="thinking"><i/><i/><i/>正在观察并调用工具</p></div></article>}
          </div>
          {pendingApproval && <section className="approval-card" aria-label="待确认结构修改"><div className="approval-head"><span>Human checkpoint</span><strong>{pendingApproval.risk.toUpperCase()}</strong></div><p>{pendingApproval.intent}</p><small>提案基于 r{pendingApproval.baseRevision} · 确认前不会改写时间轴</small><div><button type="button" onClick={() => void resolveApproval('reject')} disabled={Boolean(busy)}>拒绝</button><button className="approve" type="button" onClick={() => void resolveApproval('approve')} disabled={Boolean(busy)}><Check size={13}/>确认提交</button></div></section>}
          <form className="prompt-box" onSubmit={submitPrompt}>
            <textarea aria-label="给剪辑 Agent 的指令" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：把第 3 幕改成蓝色，并延长到 12 秒" rows={3}/>
            <div><span>⌘ ↵ 运行</span><button type="submit" disabled={!prompt.trim() || Boolean(busy)} aria-label="发送指令"><Send size={16}/></button></div>
          </form>
          <div className="suggestions"><button type="button" onClick={() => setPrompt('把第 3 幕的图表改成蓝色，并延长到 12 秒')}>改第 3 幕</button><button type="button" onClick={() => setPrompt('检查全部质量门并告诉我风险')}>检查质量</button></div>
        </aside>

        <section className="canvas-column">
          <div className="canvas-toolbar panel"><div className="toolbar-tabs"><button className="active" type="button"><MonitorPlay size={15}/> Program</button><button type="button"><MousePointer2 size={15}/> Preview</button></div><div className="canvas-meta"><span>1920 × 1080</span><span>{spec.canvas.fps} fps</span><span>{(durationFrames / spec.canvas.fps).toFixed(1)} s</span></div></div>
          <div className="canvas-stage panel"><div className="player-wrap"><RemotionPreview spec={spec} focusFrame={selectedScene.startFrame + Math.min(30, Math.floor(selectedScene.durationFrames / 4))}/></div><div className="stage-caption"><div><span className="scene-number">{String(selectedIndex + 1).padStart(2, '0')}</span><div><strong>{storyScene?.purpose}</strong><span>{selectedScene.component} · {selectedScene.durationFrames} frames</span></div></div><button type="button" onClick={() => setPrompt(`修改 ${selectedScene.id}：`)}><WandSparkles size={15}/> Ask Agent</button></div></div>
          <div className="timeline-panel panel">
            <div className="timeline-header"><div><strong>Timeline</strong><span>{spec.editSpec.scenes.length} scenes · frame-accurate</span></div><div className="timeline-legend"><span><i className="agent-color"/>Agent</span><span><i className="human-color"/>Shared</span><button type="button" aria-label="播放时间轴"><Play size={14}/></button></div></div>
            <div className="ruler">{Array.from({length: 7}, (_, index) => <span key={index} style={{left: `${index / 6 * 100}%`}}>{Math.round(index * durationFrames / spec.canvas.fps / 6)}s</span>)}</div>
            <div className="track-row"><div className="track-label"><MonitorPlay size={14}/><span>VIDEO</span></div><div className="track-lane">{spec.editSpec.scenes.map((scene, index) => <div key={scene.id} className={`timeline-clip ${scene.id === selectedSceneId ? 'selected' : ''}`} style={{left: `${scene.startFrame / durationFrames * 100}%`, width: `${scene.durationFrames / durationFrames * 100}%`}}>{index > 0 && <button className="resize-handle start" type="button" aria-label={`拖动 ${scene.id} 入点`} onPointerDown={(event) => beginTimelineResize(event, 'start', index)}/>}<button className="clip-body" type="button" onClick={() => setSelectedSceneId(scene.id)} title={`${scene.id} · 拖动两侧手柄调整边界`}><span>{index + 1}</span><strong>{scene.component}</strong><small>{(scene.durationFrames / spec.canvas.fps).toFixed(1)}s</small></button><button className="resize-handle end" type="button" aria-label={`拖动 ${scene.id} 出点`} onPointerDown={(event) => beginTimelineResize(event, 'end', index)}/></div>)}</div></div>
            <div className="track-row narration"><div className="track-label"><Gauge size={14}/><span>VOICE</span></div><div className="track-lane"><div className="waveform">{Array.from({length: 100}, (_, index) => <i key={index} style={{height: `${18 + ((index * 17) % 30)}%`}} />)}</div></div></div>
          </div>
        </section>

        <aside className="inspector panel">
          <div className="panel-heading"><div><PanelRight size={17}/><strong>Inspector</strong></div><span>{selectedScene.id}</span></div>
          <div className="inspector-tabs"><button className="active" type="button">Scene</button><button type="button">Style</button><button type="button">Motion</button></div>
          <section className="property-section"><label>Component</label><div className="readonly-field"><span className="component-icon"><WandSparkles size={15}/></span><strong>{selectedScene.component}</strong><Lock size={13}/></div></section>
          <section className="property-section"><label>Accent color</label><div className="color-field"><input aria-label={`${selectedScene.id} 强调色`} type="color" value={String(selectedScene.props.accentColor ?? spec.style.tokens.primary)} onChange={(event) => void commitPatch(`修改 ${selectedScene.id} 强调色`, [{op: 'replace', path: `/editSpec/scenes/${selectedIndex}/props/accentColor`, value: event.target.value}])}/><code>{String(selectedScene.props.accentColor ?? spec.style.tokens.primary)}</code></div></section>
          <section className="property-section"><div className="label-row"><label>Duration</label><span>{(selectedScene.durationFrames / spec.canvas.fps).toFixed(1)} s</span></div><input aria-label={`${selectedScene.id} 时长`} className="range-input" type="range" min="3" max="20" step="0.5" value={selectedScene.durationFrames / spec.canvas.fps} onChange={(event) => updateDuration(Number(event.target.value))}/><div className="range-labels"><span>3s</span><span>20s</span></div></section>
          <section className="property-section"><label>Narration</label><textarea aria-label={`${selectedScene.id} 旁白`} rows={5} value={storyScene?.narration ?? ''} onChange={(event) => {const value = event.target.value; setSpec((current) => ({...current, storySpec: {...current.storySpec, scenes: current.storySpec.scenes.map((scene) => scene.id === selectedSceneId ? {...scene, narration: value} : scene)}}));}} onBlur={(event) => void commitPatch(`修改 ${selectedScene.id} 旁白`, [{op: 'replace', path: `/storySpec/scenes/${selectedIndex}/narration`, value: event.target.value}])}/></section>
          <section className="property-section"><div className="label-row"><label>Ownership</label>{selectedScene.locks.locked ? <Lock size={14}/> : <Unlock size={14}/>}</div><button className="ownership-button" type="button" onClick={() => void commitPatch(`${selectedScene.locks.locked ? '解锁' : '锁定'} ${selectedScene.id}`, [{op: 'replace', path: `/editSpec/scenes/${selectedIndex}/locks/locked`, value: !selectedScene.locks.locked}])}><span>{selectedScene.locks.owner === 'human' ? 'Human' : 'Human + Agent'}</span><strong>{selectedScene.locks.locked ? 'Locked' : 'Shared'}</strong></button></section>
          <section className="gate-section"><div className="label-row"><label>Quality gates</label><span>{validation.gates.filter((item) => item.status === 'pass').length}/{validation.gates.length}</span></div>{validation.gates.map((gate) => <div className={`gate-row ${gate.status}`} key={gate.id}>{gate.status === 'pass' ? <Check size={13}/> : <CircleAlert size={13}/>}<strong>{gate.id}</strong><span>{gate.name}</span></div>)}</section>
          {busy === 'save' && <div className="saving"><LoaderCircle className="spin" size={14}/> 正在生成 ChangeSet…</div>}
        </aside>
      </div>
      {renderResult && <div className="render-toast"><Check size={18}/><div><strong>交付包渲染完成</strong><span>MP4、字幕与清单均已生成</span></div><a href={renderResult.urls.video} download>下载 MP4</a><a href={renderResult.urls.manifest} target="_blank" rel="noreferrer">查看清单</a></div>}
    </main>
  );
}
