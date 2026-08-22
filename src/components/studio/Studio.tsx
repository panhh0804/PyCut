'use client';

import {Component, useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode} from 'react';
import {useRouter} from 'next/navigation';
import {
  Archive,
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  Download,
  Folders,
  LoaderCircle,
  Lock,
  MessageSquareText,
  MonitorPlay,
  MousePointer2,
  PanelRight,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Volume2,
  Unlock,
  WandSparkles,
  Workflow,
} from 'lucide-react';
import type {ChangeSet, PatchOperation, VideoSpec} from '@/lib/video-spec/schema';
import type {ValidationReport} from '@/lib/video-spec/validation';
import type {ProjectAgentRun} from '@/lib/project/store';
import {VIDEO_THEME_PRESETS, type VideoThemeName} from '@/lib/video-spec/themes';
import RemotionPreview from './RemotionPreview';
import {TimelineEditor} from './TimelineEditor';

function PreviewRecovery({reason = '画布模块加载失败'}: {reason?: string}) {
  return (
    <div className="preview-loading preview-load-error" role="alert">
      <CircleAlert size={20}/>
      <strong>{reason}</strong>
      <span>请确认 πCut 本地服务仍在运行，然后重新载入画布。</span>
      <button type="button" onClick={() => window.location.reload()}>重新载入画布</button>
    </div>
  );
}

class PreviewErrorBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
  state = {failed: false};

  static getDerivedStateFromError() {
    return {failed: true};
  }

  render() {
    if (this.state.failed) return <PreviewRecovery reason="画布渲染失败"/>;
    return this.props.children;
  }
}

interface ChatMessage {id: string; role: 'agent' | 'human'; text: string; meta?: string}
interface RenderResult {
  urls: {video: string; spec: string; subtitles: string; assets: string; manifest: string};
  routing?: {selected: 'remotion' | 'hyperframes'; confidence: number; scores: {remotion: number; hyperframes: number}; reasons: string[]; fallback: 'remotion' | 'hyperframes'; executed?: 'remotion' | 'hyperframes'; fallbackApplied?: boolean; fallbackReason?: string} | null;
  traceRun?: ProjectAgentRun;
}
interface AgentJobClient {
  id: string;
  projectId: string;
  kind: 'edit' | 'create';
  prompt: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  attempts: number;
  events: ProjectAgentRun['events'];
  createdAt: string;
  error?: string;
  result?: {
    response: string;
    provider: string;
    model: string;
    thinkingLevel: string;
    executionMode: string;
    sessionId: string;
    traceRunId: string;
  };
}
interface AgentJobSnapshot {
  job: AgentJobClient;
  spec: VideoSpec;
  validation: ValidationReport;
  pendingApproval: ChangeSet | null;
  traceRun: ProjectAgentRun | null;
}
interface SessionSummary {id: string; title: string; durationMs: number; revision: number; updatedAt: string; hasNarration: boolean}
interface StudioProps {
  projectId: string;
  sessions: SessionSummary[];
  initialMessages: ChatMessage[];
  initialAgentRuns: ProjectAgentRun[];
  initialSpec: VideoSpec;
  initialValidation: ValidationReport;
  initialPendingApproval: ChangeSet | null;
}

const starterMessage = (spec: VideoSpec): ChatMessage => ({
  id: 'hello',
  role: 'agent',
  text: `已载入「${spec.project.title}」：${spec.storySpec.scenes.length} 个分镜，目标时长 ${(spec.project.targetDurationMs / 1000).toFixed(0)} 秒。你可以继续修改、生成旁白或导出成片。`,
  meta: 'π Agent · ready',
});

export function Studio({projectId, sessions, initialMessages, initialAgentRuns, initialSpec, initialValidation, initialPendingApproval}: StudioProps) {
  const router = useRouter();
  const initialScene = initialSpec.editSpec.scenes[0];
  const initialPreviewFrame = initialScene ? initialScene.startFrame + Math.min(initialScene.durationFrames - 1, Math.max(1, Math.round(initialSpec.canvas.fps * 0.35))) : 0;
  const [spec, setSpec] = useState(initialSpec);
  const [validation, setValidation] = useState(initialValidation);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages.length ? initialMessages : [starterMessage(initialSpec)]);
  const [prompt, setPrompt] = useState('');
  const [selectedSceneId, setSelectedSceneId] = useState(initialSpec.editSpec.scenes[0]?.id ?? '');
  const [busy, setBusy] = useState<'save' | 'render' | 'undo' | 'audio' | null>(null);
  const [renderBackend, setRenderBackend] = useState<'auto' | 'remotion' | 'hyperframes'>('auto');
  const [renderResult, setRenderResult] = useState<RenderResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<ChangeSet | null>(initialPendingApproval);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [newSessionBrief, setNewSessionBrief] = useState('');
  const [ttsVoice, setTtsVoice] = useState(initialSpec.editSpec.globalAudio.tts.voice);
  const [ttsModel, setTtsModel] = useState(initialSpec.editSpec.globalAudio.tts.model);
  const [ttsSpeed, setTtsSpeed] = useState(initialSpec.editSpec.globalAudio.tts.speed);
  const [inspectorTab, setInspectorTab] = useState<'scene' | 'style' | 'motion'>('scene');
  const [playheadFrame, setPlayheadFrame] = useState(initialPreviewFrame);
  const [seekFrame, setSeekFrame] = useState(initialPreviewFrame);
  const [playing, setPlaying] = useState(false);
  const [transport, setTransport] = useState<{id: number; action: 'play' | 'pause'}>({id: 0, action: 'pause'});
  const [creationBrief, setCreationBrief] = useState<string | null>(null);
  const [creationPanelOpen, setCreationPanelOpen] = useState(false);
  const [agentRuns, setAgentRuns] = useState<ProjectAgentRun[]>(initialAgentRuns);
  const [traceOpen, setTraceOpen] = useState(true);
  const [selectedRunId, setSelectedRunId] = useState(initialAgentRuns.at(-1)?.id ?? '');
  const [activeJob, setActiveJob] = useState<AgentJobClient | null>(null);

  useEffect(() => {
    window.localStorage.setItem('picut:last-project', projectId);
  }, [projectId]);

  const selectedIndex = Math.max(0, spec.editSpec.scenes.findIndex((scene) => scene.id === selectedSceneId));
  const selectedScene = spec.editSpec.scenes[selectedIndex];
  const storyScene = spec.storySpec.scenes.find((scene) => scene.id === selectedSceneId);
  const durationFrames = useMemo(() => spec.editSpec.scenes.reduce((max, scene) => Math.max(max, scene.startFrame + scene.durationFrames), 1), [spec]);
  const narrationAsset = useMemo(() => spec.assets.find((asset) => asset.id === spec.editSpec.globalAudio.narrationAssetId), [spec]);
  const selectedRun = useMemo(() => agentRuns.find((run) => run.id === selectedRunId) ?? agentRuns.at(-1), [agentRuns, selectedRunId]);

  const updateFromResponse = useCallback((data: {spec: VideoSpec; validation: ValidationReport}) => {
    setSpec(data.spec);
    setValidation(data.validation);
    setSelectedSceneId((current) => data.spec.editSpec.scenes.some((scene) => scene.id === current)
      ? current
      : data.spec.editSpec.scenes[0]?.id ?? '');
  }, []);

  const applyJobSnapshot = useCallback((snapshot: AgentJobSnapshot) => {
    updateFromResponse(snapshot);
    setPendingApproval(snapshot.pendingApproval ?? null);
    setActiveJob(snapshot.job);
    const run: ProjectAgentRun = snapshot.traceRun ?? {
      id: `run-${snapshot.job.id}`,
      prompt: snapshot.job.prompt,
      model: snapshot.job.result?.model ?? 'gpt-5.5',
      provider: snapshot.job.result?.provider ?? 'openai-codex',
      thinkingLevel: snapshot.job.result?.thinkingLevel ?? 'medium',
      executionMode: snapshot.job.result?.executionMode ?? 'native-session · background',
      sessionId: snapshot.job.result?.sessionId,
      createdAt: snapshot.job.createdAt,
      events: snapshot.job.events,
    };
    setAgentRuns((current) => [...current.filter((item) => item.id !== run.id), run].slice(-40));
    setSelectedRunId(run.id);
    if (snapshot.job.status === 'succeeded' || snapshot.job.status === 'failed') {
      const response = snapshot.job.result?.response ?? `任务未完成：${snapshot.job.error ?? 'Agent Job 执行失败'}`;
      const message: ChatMessage = {
        id: `agent-${snapshot.job.id}`,
        role: 'agent',
        text: response,
        meta: snapshot.job.status === 'succeeded'
          ? `${snapshot.job.result?.provider}/${snapshot.job.result?.model} · ${snapshot.job.result?.thinkingLevel} · native session`
          : 'π AgentSession · failed',
      };
      setMessages((current) => [...current.filter((item) => item.id !== message.id), message]);
      setCreationBrief(null);
      setCreationPanelOpen(false);
      if (snapshot.job.status === 'failed') setNotice(snapshot.job.error ?? 'Agent 后台任务失败');
      router.refresh();
    }
  }, [router, updateFromResponse]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/agent/jobs?projectId=${encodeURIComponent(projectId)}`, {cache: 'no-store'})
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? '读取后台任务失败');
        if (cancelled) return;
        const active = (data.jobs as AgentJobClient[]).find((job) => job.status === 'queued' || job.status === 'running');
        if (active) {
          setActiveJob(active);
          if (active.kind === 'create') {
            setCreationBrief(active.prompt);
            // The generation canvas remains immediately usable; progress is
            // available in the dock and Agent trace instead of a blocking page.
            setCreationPanelOpen(false);
          }
        }
      })
      .catch((error) => { if (!cancelled) setNotice(error instanceof Error ? error.message : '读取后台任务失败'); });
    return () => { cancelled = true; };
  }, [projectId]);

  const streamingJobId = activeJob && (activeJob.status === 'queued' || activeJob.status === 'running') ? activeJob.id : null;
  useEffect(() => {
    if (!streamingJobId) return;
    const source = new EventSource(`/api/agent/jobs/${encodeURIComponent(streamingJobId)}/events`);
    const onSnapshot = (event: MessageEvent<string>) => {
      const snapshot = JSON.parse(event.data) as AgentJobSnapshot;
      applyJobSnapshot(snapshot);
      if (snapshot.job.status === 'succeeded' || snapshot.job.status === 'failed') source.close();
    };
    const onJobError = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as {error?: string};
        if (payload.error) setNotice(payload.error);
      } catch {
        // Native EventSource will reconnect automatically after transient loss.
      }
    };
    source.addEventListener('snapshot', onSnapshot as EventListener);
    source.addEventListener('error', onJobError as EventListener);
    return () => source.close();
  }, [applyJobSnapshot, streamingJobId]);

  const agentWorking = activeJob?.status === 'queued' || activeJob?.status === 'running';

  const retryActiveJob = useCallback(async () => {
    if (!activeJob || activeJob.status !== 'failed') return;
    setNotice(null);
    try {
      const response = await fetch(`/api/agent/jobs/${encodeURIComponent(activeJob.id)}`, {method: 'POST'});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '后台任务重试失败');
      setActiveJob(data.job as AgentJobClient);
      if (activeJob.kind === 'create') setCreationBrief(activeJob.prompt);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '后台任务重试失败');
    }
  }, [activeJob]);

  const seekTo = useCallback((frame: number) => {
    const next = Math.max(0, Math.min(durationFrames - 1, Math.round(frame)));
    setSeekFrame(next);
    setPlayheadFrame(next);
  }, [durationFrames]);

  const selectScene = useCallback((sceneId: string) => {
    setSelectedSceneId(sceneId);
  }, []);

  const togglePlayback = useCallback(() => {
    setTransport((current) => ({id: current.id + 1, action: playing ? 'pause' : 'play'}));
  }, [playing]);

  const handlePlaybackChange = useCallback((value: boolean) => setPlaying(value), []);
  const handleFrameChange = useCallback((frame: number) => setPlayheadFrame(frame), []);

  const submitPrompt = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    const instruction = prompt.trim();
    if (!instruction || agentWorking || busy) return;
    setPrompt('');
    setNotice(null);
    try {
      const response = await fetch('/api/agent/jobs', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          projectId,
          prompt: instruction,
          kind: 'edit',
          context: {revision: spec.revision, selectedSceneId, playheadFrame, inspectorTab, selectedField: null},
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Agent 请求失败');
      const job = data.job as AgentJobClient;
      setActiveJob(job);
      setMessages((current) => [...current.filter((item) => item.id !== `human-${job.id}`), {id: `human-${job.id}`, role: 'human', text: instruction, meta: 'You · background job'}]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Agent 请求失败');
    }
  }, [agentWorking, busy, inspectorTab, playheadFrame, projectId, prompt, selectedSceneId, spec.revision]);

  const createSession = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    const brief = newSessionBrief.trim();
    if (brief.length < 6 || busy) return;
    setCreationBrief(brief);
    setCreationPanelOpen(true);
    setSessionOpen(false);
    setNotice(null);
    try {
      const response = await fetch('/api/projects', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({brief})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '新建会话失败');
      router.push(data.url);
    } catch (error) {
      setCreationBrief(null);
      setCreationPanelOpen(false);
      setNotice(error instanceof Error ? error.message : '新建会话失败');
    }
  }, [busy, newSessionBrief, router]);

  const renameSession = useCallback(async (session: SessionSummary) => {
    const title = window.prompt('输入新的会话名称', session.title)?.trim();
    if (!title || title === session.title || busy) return;
    setBusy('save');
    try {
      const response = await fetch(`/api/projects/${session.id}`, {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({title})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '重命名失败');
      if (session.id === projectId) updateFromResponse(data);
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '重命名失败');
      setBusy(null);
    }
  }, [busy, projectId, router, updateFromResponse]);

  const archiveSession = useCallback(async (session: SessionSummary) => {
    if (busy || !window.confirm(`将「${session.title}」移入可恢复归档？`)) return;
    setBusy('save');
    try {
      const response = await fetch(`/api/projects/${session.id}`, {method: 'DELETE'});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '归档失败');
      const next = data.projects?.find((item: SessionSummary) => item.id !== session.id);
      router.push(next ? `/?project=${encodeURIComponent(next.id)}` : '/');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '归档失败');
      setBusy(null);
    }
  }, [busy, router]);

  const synthesizeAudio = useCallback(async () => {
    if (busy) return;
    setBusy('audio');
    setNotice(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/audio/synthesize`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({model: ttsModel, voice: ttsVoice, speed: ttsSpeed}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '旁白合成失败');
      updateFromResponse(data);
      setMessages((current) => [...current, {id: crypto.randomUUID(), role: 'agent', text: `已使用 ${data.audio.config.model} 生成 ${data.audio.segments.length} 段旁白，按镜头时长对齐并混音到主音轨。`, meta: 'SiliconFlow TTS · waveform ready'}]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '旁白合成失败');
    } finally {
      setBusy(null);
    }
  }, [busy, projectId, ttsModel, ttsSpeed, ttsVoice, updateFromResponse]);

  const resolveApproval = useCallback(async (decision: 'approve' | 'reject') => {
    if (agentWorking || !pendingApproval) return;
    const instruction = decision === 'approve' ? '确认上述结构修改' : '拒绝上述结构修改';
    setNotice(null);
    try {
      const response = await fetch('/api/agent/jobs', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({projectId, prompt: instruction, kind: 'edit', context: {revision: spec.revision, selectedSceneId, playheadFrame, inspectorTab, selectedField: null}}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '审批处理失败');
      const job = data.job as AgentJobClient;
      setActiveJob(job);
      setMessages((current) => [...current.filter((item) => item.id !== `human-${job.id}`), {id: `human-${job.id}`, role: 'human', text: instruction, meta: 'Human approval · background job'}]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '审批处理失败');
    }
  }, [agentWorking, inspectorTab, pendingApproval, playheadFrame, projectId, selectedSceneId, spec.revision]);

  const commitPatch = useCallback(async (intent: string, patch: Array<{op: 'replace' | 'add' | 'remove'; path: string; value?: unknown}>) => {
    if (busy) return;
    setBusy('save');
    setNotice(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/changesets`, {
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
  }, [busy, projectId, spec.revision, updateFromResponse]);

  const applyTheme = useCallback((theme: VideoThemeName) => {
    const preset = VIDEO_THEME_PRESETS[theme];
    const scenePatches = spec.editSpec.scenes.flatMap((scene, index): PatchOperation[] => {
      const accent: PatchOperation = {op: 'replace', path: `/editSpec/scenes/${index}/props/accentColor`, value: preset.tokens.primary};
      if (scene.component !== 'SceneCanvas') return [accent];
      const background = scene.props.background as {type?: unknown; colors?: unknown} | undefined;
      const backgroundType = background?.type === 'solid' || background?.type === 'linear' || background?.type === 'radial' ? background.type : 'linear';
      const originalColorCount = Array.isArray(background?.colors) ? background.colors.length : 2;
      const palette = [preset.tokens.background, preset.tokens.surface, preset.tokens.accent, preset.tokens.primary];
      const layers = Array.isArray(scene.props.layers) ? scene.props.layers : [];
      const themedLayers = layers.map((raw, layerIndex) => {
        const layer = raw as {type?: string; style?: Record<string, unknown>};
        const existing = layer.style ?? {};
        const decorative = ['shape', 'line', 'particles', 'chart'].includes(layer.type ?? '');
        const emphasis = layerIndex % 2 ? preset.tokens.accent : preset.tokens.primary;
        return {
          ...layer,
          style: {
            ...existing,
            ...(existing.color !== undefined || decorative ? {color: decorative ? emphasis : preset.tokens.text} : {}),
            ...(existing.backgroundColor !== undefined ? {backgroundColor: layer.type === 'badge' ? preset.tokens.surface : preset.tokens.background} : {}),
            ...(existing.borderColor !== undefined ? {borderColor: emphasis} : {}),
          },
        };
      });
      return [
        accent,
        {op: 'replace', path: `/editSpec/scenes/${index}/props/background/colors`, value: backgroundType === 'solid' ? [preset.tokens.background] : palette.slice(0, Math.max(2, Math.min(4, originalColorCount)))},
        {op: 'replace', path: `/editSpec/scenes/${index}/props/layers`, value: themedLayers},
      ];
    });
    const patch: PatchOperation[] = [
      {op: 'replace', path: '/style/themeRef', value: `picut-${theme}`},
      {op: 'replace', path: '/style/tokens', value: preset.tokens},
      ...scenePatches,
    ];
    void commitPatch(`将全片色彩主题切换为 ${preset.label}`, patch);
  }, [commitPatch, spec.editSpec.scenes]);

  const narrationResetPatch = useCallback((): PatchOperation[] => {
    if (!spec.editSpec.globalAudio.narrationAssetId && !spec.editSpec.globalAudio.narrationSegments.length) return [];
    const narrationIds = new Set([
      spec.editSpec.globalAudio.narrationAssetId,
      ...spec.editSpec.globalAudio.narrationSegments.map((segment) => segment.assetId),
    ].filter((id): id is string => Boolean(id)));
    return [
      {op: 'replace', path: '/assets', value: spec.assets.filter((asset) => !narrationIds.has(asset.id))},
      {op: 'replace', path: '/editSpec/globalAudio/narrationAssetId', value: null},
      {op: 'replace', path: '/editSpec/globalAudio/narrationSegments', value: []},
    ];
  }, [spec.assets, spec.editSpec.globalAudio.narrationAssetId, spec.editSpec.globalAudio.narrationSegments]);

  const updateDuration = useCallback((seconds: number) => {
    const nextFrames = Math.max(1, Math.round(Math.max(0.1, seconds) * spec.canvas.fps));
    const delta = nextFrames - selectedScene.durationFrames;
    if (delta === 0) return;
    const nextScenes = spec.editSpec.scenes.map((scene, index) => {
      if (index === selectedIndex) return {...scene, durationFrames: nextFrames};
      if (index > selectedIndex) return {...scene, startFrame: Math.max(0, scene.startFrame + delta)};
      return scene;
    });
    const totalFrames = nextScenes.reduce((max, scene) => Math.max(max, scene.startFrame + scene.durationFrames), 1);
    const totalMs = Math.max(1, Math.round(totalFrames / spec.canvas.fps * 1000));
    const patch: PatchOperation[] = [
      {op: 'replace', path: `/editSpec/scenes/${selectedIndex}/durationFrames`, value: nextFrames},
    ];
    spec.editSpec.scenes.slice(selectedIndex + 1).forEach((scene, offset) => {
      patch.push({op: 'replace', path: `/editSpec/scenes/${selectedIndex + offset + 1}/startFrame`, value: Math.max(0, scene.startFrame + delta)});
    });
    patch.push(
      {op: 'replace', path: '/project/targetDurationMs', value: totalMs},
      {op: 'replace', path: '/constraints/maxDurationMs', value: Math.max(totalMs, spec.constraints.maxDurationMs)},
      ...narrationResetPatch(),
    );
    void commitPatch(`将 ${selectedScene.id} 时长调整为 ${seconds.toFixed(1)} 秒`, patch);
  }, [commitPatch, narrationResetPatch, selectedIndex, selectedScene, spec]);

  const timelineMetaPatch = useCallback((scenes: VideoSpec['editSpec']['scenes']): PatchOperation[] => {
    const frames = scenes.reduce((max, scene) => Math.max(max, scene.startFrame + scene.durationFrames), 1);
    const durationMs = Math.round(frames / spec.canvas.fps * 1000);
    return [
      {op: 'replace', path: '/project/targetDurationMs', value: durationMs},
      {op: 'replace', path: '/constraints/maxDurationMs', value: Math.max(durationMs, spec.constraints.maxDurationMs)},
    ];
  }, [spec.canvas.fps, spec.constraints.maxDurationMs]);

  const uniqueSceneId = useCallback((base: string) => {
    const existing = new Set(spec.editSpec.scenes.map((scene) => scene.id));
    let index = 2;
    let candidate = `${base}-${index}`;
    while (existing.has(candidate)) candidate = `${base}-${++index}`;
    return candidate;
  }, [spec.editSpec.scenes]);

  const splitSelected = useCallback(() => {
    if (busy || spec.editSpec.scenes.length >= 12) return;
    const scene = selectedScene;
    const minFrames = Math.max(1, Math.round(spec.canvas.fps * 0.1));
    const relative = playheadFrame - scene.startFrame;
    const cut = relative >= minFrames && relative <= scene.durationFrames - minFrames
      ? relative
      : Math.round(scene.durationFrames / 2);
    if (cut < minFrames || scene.durationFrames - cut < minFrames) {
      setNotice('该镜头太短，无法在保留有效画面的同时分割。');
      return;
    }
    const nextId = uniqueSceneId(scene.id);
    const editScenes = spec.editSpec.scenes.flatMap((item) => item.id === scene.id ? [
      {...item, durationFrames: cut},
      {...item, id: nextId, startFrame: item.startFrame + cut, durationFrames: item.durationFrames - cut, sourceStartFrame: item.sourceStartFrame + cut, origin: {...item.origin, actor: 'human' as const, changeSetId: `ui-split-${Date.now()}`}},
    ] : [item]);
    const story = storyScene ?? spec.storySpec.scenes[selectedIndex];
    const midpoint = Math.max(1, Math.min(story.narration.length - 1, Math.round(story.narration.length * cut / scene.durationFrames)));
    const firstNarration = story.narration.slice(0, midpoint).trim() || story.narration;
    const secondNarration = story.narration.slice(midpoint).trim() || story.narration;
    const storyScenes = spec.storySpec.scenes.flatMap((item) => item.id === scene.id ? [
      {...item, narration: firstNarration},
      {...item, id: nextId, purpose: `${item.purpose}·后段`, narration: secondNarration, approvalState: 'draft' as const},
    ] : [item]);
    setSelectedSceneId(nextId);
    seekTo(scene.startFrame + cut);
    void commitPatch(`在 ${formatFrame(playheadFrame, spec.canvas.fps)} 分割 ${scene.id}`, [
      {op: 'replace', path: '/storySpec/scenes', value: storyScenes},
      {op: 'replace', path: '/editSpec/scenes', value: editScenes},
      ...narrationResetPatch(),
      ...timelineMetaPatch(editScenes),
    ]);
  }, [busy, commitPatch, narrationResetPatch, playheadFrame, seekTo, selectedIndex, selectedScene, spec, storyScene, timelineMetaPatch, uniqueSceneId]);

  const duplicateSelected = useCallback(() => {
    if (busy || spec.editSpec.scenes.length >= 12) return;
    const scene = selectedScene;
    const nextId = uniqueSceneId(scene.id);
    const insertAt = scene.startFrame + scene.durationFrames;
    const shifted = spec.editSpec.scenes.map((item) => item.startFrame >= insertAt ? {...item, startFrame: item.startFrame + scene.durationFrames} : item);
    const sceneIndex = shifted.findIndex((item) => item.id === scene.id);
    const duplicate = {...scene, id: nextId, startFrame: insertAt, origin: {...scene.origin, actor: 'human' as const, changeSetId: `ui-copy-${Date.now()}`}};
    const editScenes = [...shifted.slice(0, sceneIndex + 1), duplicate, ...shifted.slice(sceneIndex + 1)];
    const storyIndex = spec.storySpec.scenes.findIndex((item) => item.id === scene.id);
    const sourceStory = spec.storySpec.scenes[storyIndex];
    const storyScenes = [...spec.storySpec.scenes.slice(0, storyIndex + 1), {...sourceStory, id: nextId, purpose: `${sourceStory.purpose}·副本`, approvalState: 'draft' as const}, ...spec.storySpec.scenes.slice(storyIndex + 1)];
    setSelectedSceneId(nextId);
    seekTo(insertAt);
    void commitPatch(`复制 ${scene.id} 并波纹后移后续镜头`, [
      {op: 'replace', path: '/storySpec/scenes', value: storyScenes},
      {op: 'replace', path: '/editSpec/scenes', value: editScenes},
      ...narrationResetPatch(),
      ...timelineMetaPatch(editScenes),
    ]);
  }, [busy, commitPatch, narrationResetPatch, seekTo, selectedScene, spec, timelineMetaPatch, uniqueSceneId]);

  const deleteSelected = useCallback(() => {
    if (busy) return;
    if (spec.editSpec.scenes.length <= 1) {
      setNotice('项目至少需要保留一个镜头。');
      return;
    }
    const scene = selectedScene;
    const end = scene.startFrame + scene.durationFrames;
    const editScenes = spec.editSpec.scenes
      .filter((item) => item.id !== scene.id)
      .map((item) => item.startFrame >= end ? {...item, startFrame: Math.max(0, item.startFrame - scene.durationFrames)} : item);
    const storyScenes = spec.storySpec.scenes.filter((item) => item.id !== scene.id);
    const nextSelected = editScenes[Math.min(selectedIndex, editScenes.length - 1)];
    setSelectedSceneId(nextSelected.id);
    seekTo(nextSelected.startFrame);
    void commitPatch(`波纹删除 ${scene.id}`, [
      {op: 'replace', path: '/storySpec/scenes', value: storyScenes},
      {op: 'replace', path: '/editSpec/scenes', value: editScenes},
      ...narrationResetPatch(),
      ...timelineMetaPatch(editScenes),
    ]);
  }, [busy, commitPatch, narrationResetPatch, seekTo, selectedIndex, selectedScene, spec, timelineMetaPatch]);

  const undo = useCallback(async () => {
    if (busy) return;
    setBusy('undo');
    try {
      const response = await fetch(`/api/projects/${projectId}/undo`, {method: 'POST'});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '撤销失败');
      updateFromResponse(data);
      setMessages((current) => [...current, {id: crypto.randomUUID(), role: 'agent', text: `已撤销上一项变更，并生成可追踪的新版本 r${data.spec.revision}。`, meta: 'Undo · revisioned'}]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '撤销失败');
    } finally {
      setBusy(null);
    }
  }, [busy, projectId, updateFromResponse]);

  const render = useCallback(async () => {
    if (busy || !validation.valid) return;
    setBusy('render');
    setRenderResult(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/render`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({backend: renderBackend, mode: 'final'})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '渲染失败');
      setRenderResult(data);
      if (data.traceRun) {
        setAgentRuns((current) => [...current, data.traceRun].slice(-40));
        setSelectedRunId(data.traceRun.id);
      }
      const selected = data.routing?.selected ?? renderBackend;
      const routeCopy = data.routing ? `自主路由选择 ${selected === 'remotion' ? 'Remotion' : 'HyperFrames'}（置信度 ${Math.round(data.routing.confidence * 100)}%）` : selected === 'remotion' ? 'Remotion' : 'HyperFrames';
      setMessages((current) => [...current, {id: crypto.randomUUID(), role: 'agent', text: `${routeCopy}，最终渲染完成，五件套交付物已生成。`, meta: 'G1–G7 · delivered'}]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '渲染失败');
    } finally {
      setBusy(null);
    }
  }, [busy, projectId, renderBackend, validation.valid]);

  const addMotionKeyframes = useCallback(() => {
    const relativeFrame = Math.max(0, Math.min(selectedScene.durationFrames, playheadFrame - selectedScene.startFrame));
    const values = selectedScene.transform;
    const properties = [
      ['x', values.x],
      ['y', values.y],
      ['scale', values.scale],
      ['rotation', values.rotation],
      ['opacity', values.opacity],
    ] as const;
    const replaced = selectedScene.keyframes.filter((keyframe) => keyframe.frame !== relativeFrame || !properties.some(([property]) => property === keyframe.property));
    const next = [...replaced, ...properties.map(([property, value]) => ({frame: relativeFrame, property, value, easing: 'ease-in-out' as const}))]
      .sort((a, b) => a.frame - b.frame || a.property.localeCompare(b.property));
    void commitPatch(`在 ${selectedScene.id} 的 ${formatFrame(playheadFrame, spec.canvas.fps)} 添加运动关键帧`, [{op: 'replace', path: `/editSpec/scenes/${selectedIndex}/keyframes`, value: next}]);
  }, [commitPatch, playheadFrame, selectedIndex, selectedScene, spec.canvas.fps]);

  if (!selectedScene) return null;
  const qualityWarningCount = validation.gates.filter((gate) => gate.status === 'warn').length;
  const qualityFailureCount = validation.gates.filter((gate) => gate.status === 'fail').length;
  return (
    <main className="studio-shell">
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark">π</div><div><strong>πCut</strong><span>Agentic Video Compiler</span></div></div>
        <div className="project-breadcrumb" aria-label="当前项目"><strong>{spec.project.title}</strong><span className="revision-chip">r{spec.revision}</span></div>
        <div className="top-actions">
          <button className="icon-button" type="button" onClick={undo} disabled={Boolean(busy)} aria-label="撤销上一项修改"><RotateCcw size={17} /></button>
          <div className={`quality-pill ${validation.valid ? 'pass' : 'fail'}`}><span /> {validation.valid ? 'G1–G7 Ready' : 'Quality blocked'}</div>
          <label className="backend-select">Engine<select value={renderBackend} onChange={(event) => setRenderBackend(event.target.value as typeof renderBackend)}><option value="auto">自主路由</option><option value="remotion">Remotion</option><option value="hyperframes">HyperFrames</option></select><ChevronDown size={14} /></label>
          <button className="export-button" type="button" onClick={render} disabled={Boolean(busy) || !validation.valid}>{busy === 'render' ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />} Export MP4</button>
        </div>
      </header>

      {notice && <div className="notice" role="alert"><CircleAlert size={17}/>{notice}<button type="button" onClick={() => setNotice(null)}>关闭</button></div>}

      <div className="workspace-grid">
        <aside className="chat-panel panel">
          <div className="panel-heading"><div><MessageSquareText size={17}/><strong>Director</strong></div><span className="live-dot">Live</span></div>
          <div className="chat-context"><Sparkles size={15}/><div><strong>π Agent / ReAct</strong><span>Observe → Tool → Validate</span></div></div>
          <section className={`agent-trace ${traceOpen ? 'open' : ''}`}>
            <button className="agent-trace-head" type="button" onClick={() => setTraceOpen((current) => !current)} aria-expanded={traceOpen}>
              <span><Workflow size={14}/><strong>Agent 轨迹</strong></span>
              <small>{agentWorking ? '后台运行中' : agentRuns.length ? `${agentRuns.length} runs` : '等待首次运行'}</small>
              <ChevronDown size={13}/>
            </button>
            {traceOpen && <div className="agent-trace-body">
              {agentRuns.length ? <>
                {agentRuns.length > 1 && <select className="trace-run-select" aria-label="选择 Agent 运行记录" value={selectedRun?.id} onChange={(event) => setSelectedRunId(event.target.value)}>{agentRuns.map((run, index) => <option value={run.id} key={run.id}>{String(index + 1).padStart(2, '0')} · {run.prompt.slice(0, 28)}</option>)}</select>}
                <div className="trace-run-meta"><strong>{selectedRun?.provider ? `${selectedRun.provider}/` : ''}{selectedRun?.model}</strong><span>{selectedRun?.thinkingLevel ? `${selectedRun.thinkingLevel} · ` : ''}{selectedRun?.executionMode}</span>{selectedRun?.sessionId && <span>session {selectedRun.sessionId.slice(0, 8)}</span>}</div>
                <p className="trace-prompt">{selectedRun?.prompt}</p>
                <ol>{selectedRun?.events.filter((event) => !['message_start', 'message_end', 'message_update'].includes(event.type)).slice(-14).map((event, index) => <li className={event.status ?? 'info'} key={`${event.at}-${event.type}-${index}`}><i/><div><strong>{event.summary}</strong>{event.detail && <span>{event.detail}</span>}</div><time>{new Date(event.at).toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit', second: '2-digit'})}</time></li>)}</ol>
              </> : <p className="trace-empty">新建视频或运行指令后，这里会显示观察、工具、质量门与引擎路由。</p>}
            </div>}
          </section>
          <div className="message-list" aria-live="polite">
            {messages.map((message) => <article className={`message ${message.role}`} key={message.id}><div className="avatar">{message.role === 'agent' ? <Bot size={17}/> : '你'}</div><div><span className="message-meta">{message.meta}</span><p>{message.text}</p></div></article>)}
            {agentWorking && <article className="message agent"><div className="avatar"><Bot size={17}/></div><div><span className="message-meta">openai-codex/gpt-5.5 · persistent job</span><p className="thinking"><i/><i/><i/>{activeJob.events.at(-1)?.summary ?? '正在恢复原生会话并调用工具'}</p></div></article>}
            {activeJob?.status === 'failed' && <article className="message agent job-failed"><div className="avatar"><CircleAlert size={17}/></div><div><span className="message-meta">可恢复后台任务</span><p>{activeJob.error}</p><button type="button" onClick={() => void retryActiveJob()}>从原生 transcript 重试</button></div></article>}
          </div>
          {pendingApproval && <section className="approval-card" aria-label="待确认结构修改"><div className="approval-head"><span>Human checkpoint</span><strong>{pendingApproval.risk.toUpperCase()}</strong></div><p>{pendingApproval.intent}</p><small>提案基于 r{pendingApproval.baseRevision} · 确认前不会改写时间轴</small><div><button type="button" onClick={() => void resolveApproval('reject')} disabled={Boolean(busy) || agentWorking}>拒绝</button><button className="approve" type="button" onClick={() => void resolveApproval('approve')} disabled={Boolean(busy) || agentWorking}><Check size={13}/>确认提交</button></div></section>}
          <form className="prompt-box" onSubmit={submitPrompt}>
            <textarea aria-label="给剪辑 Agent 的指令" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：把第 3 幕改成蓝色，并延长到 12 秒" rows={3}/>
            <div><span>{agentWorking ? '后台任务运行中 · 工作台仍可操作' : '⌘ ↵ 运行'}</span><button type="submit" disabled={!prompt.trim() || Boolean(busy) || agentWorking} aria-label="发送指令"><Send size={16}/></button></div>
          </form>
          <div className="suggestions"><button type="button" onClick={() => setPrompt('把第 3 幕的图表改成蓝色，并延长到 12 秒')}>改第 3 幕</button><button type="button" onClick={() => void synthesizeAudio()}>生成旁白</button><button type="button" onClick={() => setPrompt('检查全部质量门并告诉我风险')}>检查质量</button></div>
          <section className={`chat-sessions ${sessionOpen ? 'open' : ''}`} aria-label="持久化项目会话">
            <button className="chat-sessions-toggle" type="button" onClick={() => setSessionOpen((value) => !value)} aria-expanded={sessionOpen} aria-controls="chat-session-drawer">
              <Folders size={15}/><span><strong>Sessions</strong><small>{spec.project.title}</small></span><b>{sessions.length}</b><ChevronDown size={14}/>
            </button>
            {sessionOpen ? <div className="chat-session-drawer" id="chat-session-drawer">
              <div className="session-list">
                {sessions.map((session) => <div className={`session-item ${session.id === projectId ? 'active' : ''}`} key={session.id}>
                  <button type="button" onClick={() => router.push(`/?project=${encodeURIComponent(session.id)}`)} aria-current={session.id === projectId ? 'page' : undefined}>
                    <span className="session-thumb"><MonitorPlay size={15}/></span>
                    <span><strong>{session.title}</strong><small>{(session.durationMs / 1000).toFixed(1)}s · r{session.revision}{session.hasNarration ? ' · 已配音' : ''}</small></span>
                  </button>
                  <button className="session-action" type="button" onClick={() => void renameSession(session)} aria-label={`重命名 ${session.title}`}><Pencil size={12}/></button>
                  <button className="session-action danger" type="button" onClick={() => void archiveSession(session)} aria-label={`归档 ${session.title}`}><Archive size={12}/></button>
                </div>)}
              </div>
              <form className="session-new" onSubmit={createSession}>
                <label htmlFor="new-session-brief">从空白 brief 新建视频</label>
                <div><input id="new-session-brief" value={newSessionBrief} onChange={(event) => setNewSessionBrief(event.target.value)} placeholder="例如：12 秒云朵科普视频"/><button type="submit" disabled={newSessionBrief.trim().length < 6 || Boolean(busy)}><Plus size={14}/>创建</button></div>
              </form>
            </div> : null}
          </section>
        </aside>

        <section className="canvas-column">
          <div className="canvas-toolbar panel"><div className="toolbar-tabs"><button className="active" type="button"><MonitorPlay size={15}/> Program</button><button type="button"><MousePointer2 size={15}/> Preview</button></div><div className="canvas-meta"><span>1920 × 1080</span><span>{spec.canvas.fps} fps</span><span>{(durationFrames / spec.canvas.fps).toFixed(1)} s</span></div></div>
          <div className="canvas-stage panel"><div className="player-wrap"><PreviewErrorBoundary><RemotionPreview spec={spec} focusFrame={seekFrame} transport={transport} onFrameChange={handleFrameChange} onPlaybackChange={handlePlaybackChange}/></PreviewErrorBoundary></div><div className="stage-caption"><div><span className="scene-number">{String(selectedIndex + 1).padStart(2, '0')}</span><div><strong>{storyScene?.purpose}</strong><span>{selectedScene.component} · {selectedScene.durationFrames} frames</span></div></div><button type="button" onClick={() => setPrompt(`修改 ${selectedScene.id}：`)}><WandSparkles size={15}/> Ask Agent</button></div></div>
          <TimelineEditor
            spec={spec}
            selectedSceneId={selectedSceneId}
            playheadFrame={playheadFrame}
            playing={playing}
            disabled={Boolean(busy)}
            onSelect={selectScene}
            onSeek={seekTo}
            onTogglePlayback={togglePlayback}
            onPatch={(intent, patch) => void commitPatch(intent, patch)}
            onSplit={splitSelected}
            onDuplicate={duplicateSelected}
            onDelete={deleteSelected}
            onUndo={() => void undo()}
          />
        </section>

        <aside className="inspector panel">
          <div className="panel-heading"><div><PanelRight size={17}/><strong>Inspector</strong></div><span>{selectedScene.id}</span></div>
          <div className="inspector-tabs"><button className={inspectorTab === 'scene' ? 'active' : ''} type="button" onClick={() => setInspectorTab('scene')}>Scene</button><button className={inspectorTab === 'style' ? 'active' : ''} type="button" onClick={() => setInspectorTab('style')}>Style</button><button className={inspectorTab === 'motion' ? 'active' : ''} type="button" onClick={() => setInspectorTab('motion')}>Motion</button></div>
          {inspectorTab === 'scene' && <>
            <section className="property-section"><label>Component</label><div className="readonly-field"><span className="component-icon"><WandSparkles size={15}/></span><strong>{selectedScene.component}</strong><Lock size={13}/></div></section>
            <DurationControl key={`${selectedScene.id}-${spec.revision}`} sceneId={selectedScene.id} seconds={selectedScene.durationFrames / spec.canvas.fps} onCommit={updateDuration}/>
            <section className="property-section"><label>Narration</label><textarea aria-label={`${selectedScene.id} 旁白`} rows={5} value={storyScene?.narration ?? ''} onChange={(event) => {const value = event.target.value; setSpec((current) => ({...current, storySpec: {...current.storySpec, scenes: current.storySpec.scenes.map((scene) => scene.id === selectedSceneId ? {...scene, narration: value} : scene)}}));}} onBlur={(event) => void commitPatch(`修改 ${selectedScene.id} 旁白`, [{op: 'replace', path: `/storySpec/scenes/${selectedIndex}/narration`, value: event.target.value}])}/></section>
            <section className="property-section audio-studio"><div className="label-row"><label>AI Voice</label><Volume2 size={14}/></div><select aria-label="旁白模型" value={ttsModel} onChange={(event) => setTtsModel(event.target.value)}><option value="fnlp/MOSS-TTSD-v0.5">MOSS-TTSD · 高表现力 / 长文本</option><option value="FunAudioLLM/CosyVoice2-0.5B">CosyVoice 2 · 快速 / 多音色</option></select><select aria-label="旁白音色" value={ttsVoice} onChange={(event) => setTtsVoice(event.target.value)}><option value="FunAudioLLM/CosyVoice2-0.5B:claire">Claire · 清晰女声</option><option value="FunAudioLLM/CosyVoice2-0.5B:anna">Anna · 温和女声</option><option value="FunAudioLLM/CosyVoice2-0.5B:charles">Charles · 叙事男声</option><option value="FunAudioLLM/CosyVoice2-0.5B:benjamin">Benjamin · 稳重男声</option></select><div className="voice-speed"><span>语速 {ttsSpeed.toFixed(2)}×</span><input aria-label="旁白语速" type="range" min="0.7" max="1.5" step="0.02" value={ttsSpeed} onChange={(event) => setTtsSpeed(Number(event.target.value))}/></div><button className="synthesize-button" type="button" disabled={Boolean(busy)} onClick={() => void synthesizeAudio()}>{busy === 'audio' ? <LoaderCircle className="spin" size={14}/> : <Volume2 size={14}/>} {narrationAsset ? '重新合成全部旁白' : '合成全部旁白'}</button>{narrationAsset && <audio controls preload="metadata" src={narrationAsset.src}/>}<small>{ttsModel === 'fnlp/MOSS-TTSD-v0.5' ? '高表现力模型使用所选参考音色，更适合中文科普和较长旁白。' : '快速模型支持更多预置音色；合成后仍会做自然留白与短淡出。'}</small></section>
            <section className="property-section"><div className="label-row"><label>Ownership</label>{selectedScene.locks.locked ? <Lock size={14}/> : <Unlock size={14}/>}</div><button className="ownership-button" type="button" onClick={() => void commitPatch(`${selectedScene.locks.locked ? '解锁' : '锁定'} ${selectedScene.id}`, [{op: 'replace', path: `/editSpec/scenes/${selectedIndex}/locks/locked`, value: !selectedScene.locks.locked}])}><span>{selectedScene.locks.owner === 'human' ? 'Human' : 'Human + Agent'}</span><strong>{selectedScene.locks.locked ? 'Locked' : 'Shared'}</strong></button></section>
          </>}
          {inspectorTab === 'style' && <>
            <section className="property-section"><div className="label-row"><label>Global color theme</label><span>全片联动</span></div><div className="theme-presets">{Object.entries(VIDEO_THEME_PRESETS).map(([key, preset]) => <button className={spec.style.themeRef.endsWith(key) ? 'active' : ''} type="button" key={key} onClick={() => applyTheme(key as VideoThemeName)} disabled={Boolean(busy)}><i style={{background: `linear-gradient(135deg,${preset.tokens.background} 0 48%,${preset.tokens.primary} 49% 72%,${preset.tokens.accent} 73%)`}}/><span>{preset.label}</span></button>)}</div><small className="theme-help">同步背景、卡片表面、主色、辅助色、文字色以及全部镜头强调色。</small></section>
            <section className="property-section"><label>Accent color</label><div className="color-field"><input aria-label={`${selectedScene.id} 强调色`} type="color" value={String(selectedScene.props.accentColor ?? spec.style.tokens.primary)} onChange={(event) => void commitPatch(`修改 ${selectedScene.id} 强调色`, [{op: 'replace', path: `/editSpec/scenes/${selectedIndex}/props/accentColor`, value: event.target.value}])}/><code>{String(selectedScene.props.accentColor ?? spec.style.tokens.primary)}</code></div></section>
            <section className="property-section"><div className="label-row"><label>Opacity</label><span>{Math.round(selectedScene.transform.opacity * 100)}%</span></div><input key={`${selectedScene.id}-${spec.revision}-opacity`} className="range-input" type="range" min="0" max="1" step="0.05" defaultValue={selectedScene.transform.opacity} onPointerUp={(event) => void commitPatch(`修改 ${selectedScene.id} 透明度`, [{op: 'replace', path: `/editSpec/scenes/${selectedIndex}/transform/opacity`, value: Number(event.currentTarget.value)}])}/></section>
            <section className="property-section"><div className="label-row"><label>Effect stack</label><span>{selectedScene.effects.length}</span></div><div className="effect-stack">{selectedScene.effects.map((effect, effectIndex) => <div className="effect-row" key={effect.id}><button className={effect.enabled ? 'enabled' : ''} type="button" onClick={() => void commitPatch(`${effect.enabled ? '关闭' : '启用'} ${effect.type}`, [{op: 'replace', path: `/editSpec/scenes/${selectedIndex}/effects/${effectIndex}/enabled`, value: !effect.enabled}])}>{effect.enabled ? '●' : '○'}</button><select value={effect.type} onChange={(event) => void commitPatch(`修改效果类型`, [{op: 'replace', path: `/editSpec/scenes/${selectedIndex}/effects/${effectIndex}/type`, value: event.target.value}])}><option value="blur">Blur</option><option value="brightness">Brightness</option><option value="contrast">Contrast</option><option value="saturate">Saturate</option><option value="hue-rotate">Hue rotate</option><option value="drop-shadow">Shadow</option></select><input type="number" step="0.1" defaultValue={effect.amount} onBlur={(event) => void commitPatch(`修改 ${effect.type} 强度`, [{op: 'replace', path: `/editSpec/scenes/${selectedIndex}/effects/${effectIndex}/amount`, value: Number(event.target.value)}])}/><button type="button" aria-label={`删除 ${effect.type}`} onClick={() => void commitPatch(`删除 ${effect.type} 效果`, [{op: 'remove', path: `/editSpec/scenes/${selectedIndex}/effects/${effectIndex}`}])}>×</button></div>)}</div><div className="effect-add"><button type="button" onClick={() => void commitPatch(`为 ${selectedScene.id} 添加柔焦`, [{op: 'add', path: `/editSpec/scenes/${selectedIndex}/effects/-`, value: {id: `fx-${Date.now().toString(36)}`, type: 'blur', enabled: true, amount: 6}}])}>+ Blur</button><button type="button" onClick={() => void commitPatch(`为 ${selectedScene.id} 添加饱和度`, [{op: 'add', path: `/editSpec/scenes/${selectedIndex}/effects/-`, value: {id: `fx-${Date.now().toString(36)}`, type: 'saturate', enabled: true, amount: 1.25}}])}>+ Saturate</button></div></section>
          </>}
          {inspectorTab === 'motion' && <>
            <section className="property-section"><label>Transform</label><div className="motion-grid">{([
              ['X', 'x', selectedScene.transform.x, 1], ['Y', 'y', selectedScene.transform.y, 1], ['Scale', 'scale', selectedScene.transform.scale, 0.05], ['Rotate', 'rotation', selectedScene.transform.rotation, 1],
            ] as const).map(([label, field, value, step]) => <label key={field}><span>{label}</span><input key={`${selectedScene.id}-${spec.revision}-${field}`} type="number" step={step} defaultValue={value} onBlur={(event) => void commitPatch(`修改 ${selectedScene.id} ${label}`, [{op: 'replace', path: `/editSpec/scenes/${selectedIndex}/transform/${field}`, value: Number(event.target.value)}])}/></label>)}</div></section>
            <section className="property-section"><label>Playback rate</label><input key={`${selectedScene.id}-${spec.revision}-rate`} className="wide-number" type="number" min="0.25" max="4" step="0.05" defaultValue={selectedScene.playbackRate} onBlur={(event) => void commitPatch(`修改 ${selectedScene.id} 播放速率`, [{op: 'replace', path: `/editSpec/scenes/${selectedIndex}/playbackRate`, value: Number(event.target.value)}])}/></section>
            <section className="property-section"><label>Transitions</label><div className="transition-grid"><label><span>In</span><select value={selectedScene.transition.in} onChange={(event) => void commitPatch(`修改 ${selectedScene.id} 入场转场`, [{op: 'replace', path: `/editSpec/scenes/${selectedIndex}/transition/in`, value: event.target.value}])}><option value="none">None</option><option value="fade">Fade</option><option value="wipe">Wipe</option><option value="slide">Slide</option></select></label><label><span>Out</span><select value={selectedScene.transition.out} onChange={(event) => void commitPatch(`修改 ${selectedScene.id} 出场转场`, [{op: 'replace', path: `/editSpec/scenes/${selectedIndex}/transition/out`, value: event.target.value}])}><option value="none">None</option><option value="fade">Fade</option><option value="wipe">Wipe</option><option value="slide">Slide</option></select></label><label><span>Frames</span><input type="number" min="0" max="90" defaultValue={selectedScene.transition.durationFrames} onBlur={(event) => void commitPatch(`修改 ${selectedScene.id} 转场时长`, [{op: 'replace', path: `/editSpec/scenes/${selectedIndex}/transition/durationFrames`, value: Number(event.target.value)}])}/></label></div></section>
            <section className="property-section"><div className="label-row"><label>Keyframes</label><span>{selectedScene.keyframes.length}</span></div><button className="keyframe-button" type="button" onClick={addMotionKeyframes}><Plus size={13}/>在当前播放头添加 5 个关键帧</button><div className="keyframe-list">{selectedScene.keyframes.slice(-12).map((keyframe, index) => <span key={`${keyframe.frame}-${keyframe.property}-${index}`}><b>{keyframe.frame}f</b>{keyframe.property}<code>{keyframe.value}</code></span>)}</div></section>
          </>}
          <section className="gate-section"><div className="label-row"><label>Quality gates</label><span>{validation.valid ? qualityWarningCount ? `Ready · ${qualityWarningCount} 提醒` : 'Ready · 7/7' : `Blocked · ${qualityFailureCount}`}</span></div>{validation.gates.map((gate) => <div className={`gate-row ${gate.status}`} key={gate.id}>{gate.status === 'pass' ? <Check size={13}/> : <CircleAlert size={13}/>}<strong>{gate.id}</strong><span>{gate.name}</span></div>)}</section>
          {busy === 'save' && <div className="saving"><LoaderCircle className="spin" size={14}/> 正在生成 ChangeSet…</div>}
        </aside>
      </div>
      {renderResult && <div className="render-toast"><Check size={18}/><div><strong>交付包渲染完成</strong><span>MP4、字幕与清单均已生成</span></div><a href={renderResult.urls.video} download>下载 MP4</a><a href={renderResult.urls.manifest} target="_blank" rel="noreferrer">查看清单</a></div>}
      {creationBrief && creationPanelOpen && <div className="creation-overlay" role="dialog" aria-label="新视频生成进度" onMouseDown={(event) => {if (event.target === event.currentTarget) setCreationPanelOpen(false);}}>
        <section className="creation-card" aria-live="polite">
          <div className="creation-orbit"><span/><span/><span/><Bot size={28}/></div>
          <p className="creation-kicker">π AGENT · NEW SESSION</p>
          <h2>正在从空白需求生成新视频</h2>
          <p className="creation-brief">“{creationBrief}”</p>
          <div className="creation-pipeline">
            <span className="active"><i/>原生规划 StorySpec</span>
            <span><i/>组装多轨 VideoSpec</span>
            <span><i/>选择 Remotion / HyperFrames</span>
            <span><i/>校验并持久化独立会话</span>
          </div>
          <small>任务会在后台继续。你可以收起面板，留在当前工作台查看或播放现有视频。</small>
          <button className="creation-minimize" type="button" onClick={() => setCreationPanelOpen(false)}>收起到后台</button>
        </section>
      </div>}
      {creationBrief && !creationPanelOpen && <button className="creation-dock" type="button" onClick={() => setCreationPanelOpen(true)} aria-label="查看新视频生成进度">
        <LoaderCircle className="spin" size={17}/><span><strong>π Agent 正在后台生成新视频</strong><small>{creationBrief}</small></span><b>查看进度</b>
      </button>}
    </main>
  );
}

function formatFrame(frame: number, fps: number) {
  const seconds = Math.max(0, frame / fps);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${(seconds - minutes * 60).toFixed(2).padStart(5, '0')}`;
}

function DurationControl({sceneId, seconds, onCommit}: {sceneId: string; seconds: number; onCommit: (seconds: number) => void}) {
  const [draft, setDraft] = useState(seconds);
  const maximum = Math.max(20, Math.ceil(seconds));
  return <section className="property-section"><div className="label-row"><label>Duration</label><span>{draft.toFixed(1)} s</span></div><input aria-label={`${sceneId} 时长`} className="range-input" type="range" min="0.1" max={maximum} step="0.1" value={Math.max(0.1, draft)} onChange={(event) => setDraft(Number(event.target.value))} onPointerUp={() => onCommit(Math.max(0.1, draft))} onBlur={() => onCommit(Math.max(0.1, draft))}/><div className="range-labels"><span>0.1s</span><span>{maximum}s</span></div></section>;
}
