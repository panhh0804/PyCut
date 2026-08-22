import 'server-only';

import {copyFile, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {compileVideoSpec} from '@/lib/video-spec/compiler';
import type {SceneCanvasProps, VideoSpec} from '@/lib/video-spec/schema';

const escapeHtml = (value: unknown) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const text = (props: Record<string, unknown>, key: string, fallback = '') => typeof props[key] === 'string' ? props[key] as string : fallback;
const strings = (props: Record<string, unknown>, key: string) => Array.isArray(props[key]) ? (props[key] as unknown[]).filter((item): item is string => typeof item === 'string') : [];
const numbers = (props: Record<string, unknown>, key: string) => Array.isArray(props[key]) ? (props[key] as unknown[]).filter((item): item is number => typeof item === 'number') : [];

function canvasBackground(canvas: SceneCanvasProps) {
  if (canvas.background.type === 'solid') return canvas.background.colors[0];
  if (canvas.background.type === 'radial') return `radial-gradient(circle at ${canvas.background.focalX}% ${canvas.background.focalY}%,${canvas.background.colors.join(',')})`;
  return `linear-gradient(${canvas.background.angle}deg,${canvas.background.colors.join(',')})`;
}

function canvasLayerMarkup(sceneId: string, layers: SceneCanvasProps['layers'], spec: VideoSpec) {
  return layers.map((layer) => {
    const style = layer.style;
    const borderWidth = layer.type === 'line' ? 0 : style.borderWidth ?? 0;
    const base = `id="${escapeHtml(sceneId)}-${escapeHtml(layer.id)}" class="free-layer free-${layer.type}" style="left:${layer.x}%;top:${layer.y}%;width:${layer.width}%;height:${layer.height}%;z-index:${layer.zIndex};color:${escapeHtml(style.color ?? 'inherit')};background:${escapeHtml(style.backgroundColor ?? 'transparent')};border:${borderWidth}px solid ${escapeHtml(style.borderColor ?? 'transparent')};border-radius:${style.radius ?? 0}px;padding:${style.padding ?? 0}px;font-size:${style.fontSize ?? 28}px;font-weight:${style.fontWeight ?? 500};line-height:${style.lineHeight ?? 1.2};letter-spacing:${style.letterSpacing ?? 0}px;text-align:${style.align ?? 'left'};opacity:${style.opacity ?? 1};transform:rotate(${style.rotation ?? 0}deg);filter:${style.blur ? `blur(${style.blur}px)` : 'none'};box-shadow:${style.shadow ? `0 18px ${style.shadow}px rgba(0,0,0,.28)` : 'none'}"`;
    if (layer.type === 'image') {
      const asset = spec.assets.find((item) => item.id === layer.assetId);
      const source = asset?.sourceUrl ?? (asset?.src.startsWith('/') ? `file://${path.join(process.cwd(), 'public', asset.src)}` : asset?.src ?? '');
      return `<div ${base}><img src="${escapeHtml(source)}"></div>`;
    }
    if (layer.type === 'chart') {
      const maximum = Math.max(...(layer.values ?? []), 1);
      const bars = (layer.values ?? []).map((value, index) => `<i><strong>${value}</strong><b style="height:${value / maximum * 76}%"></b><span>${escapeHtml(layer.labels?.[index])}</span></i>`).join('');
      return `<div ${base}><div class="free-chart">${bars}</div></div>`;
    }
    if (layer.type === 'particles') {
      const count = Math.max(6, Math.min(36, Number.parseInt(layer.content ?? '18', 10) || 18));
      return `<div ${base}>${Array.from({length: count}, (_, index) => `<i style="left:${(index * 37 + 11) % 100}%;top:${(index * 61 + 7) % 100}%;width:${4 + index % 5 * 3}px;height:${4 + index % 5 * 3}px;background:${escapeHtml(style.color ?? spec.style.tokens.primary)}"></i>`).join('')}</div>`;
    }
    if (layer.type === 'line') return `<div ${base}><i class="free-line-stroke" style="height:${Math.max(1, style.borderWidth ?? 2)}px;background:${escapeHtml(style.color ?? spec.style.tokens.primary)}"></i></div>`;
    const tag = layer.type === 'formula' || layer.type === 'code' ? 'code' : 'span';
    return `<div ${base}><${tag}>${escapeHtml(layer.content).replaceAll('\n', '<br>')}</${tag}></div>`;
  }).join('');
}

const effectFilter = (scene: ReturnType<typeof compileVideoSpec>['scenes'][number]) => scene.effects
  .filter((effect) => effect.enabled)
  .map((effect) => effect.type === 'blur'
    ? `blur(${effect.amount}px)`
    : effect.type === 'hue-rotate'
      ? `hue-rotate(${effect.amount}deg)`
      : effect.type === 'drop-shadow'
        ? `drop-shadow(0 12px ${Math.abs(effect.amount)}px rgba(0,0,0,.35))`
        : `${effect.type}(${effect.amount})`)
  .join(' ');

function sceneMarkup(scene: ReturnType<typeof compileVideoSpec>['scenes'][number], spec: VideoSpec, trackIndex: number) {
  const props = scene.props;
  const accent = text(props, 'accentColor', spec.style.tokens.primary);
  const transform = scene.transform;
  const base = `id="${escapeHtml(scene.id)}" class="clip scene" data-start="${scene.startMs / 1000}" data-duration="${scene.durationMs / 1000}" data-track-index="${trackIndex}" style="--accent:${escapeHtml(accent)};transform:translate(${transform.x}px,${transform.y}px) scale(${transform.scale}) rotate(${transform.rotation}deg);opacity:${transform.opacity};filter:${escapeHtml(effectFilter(scene))}"`;
  const motionId = `${escapeHtml(scene.id)}-motion`;
  if (scene.component === 'TextHero') {
    return `<section ${base}><div id="${motionId}" class="scene-motion"><div class="kicker">${escapeHtml(text(props, 'eyebrow'))}</div><h1>${escapeHtml(text(props, 'title')).replaceAll('\n', '<br>')}</h1><p class="lead">${escapeHtml(text(props, 'subtitle'))}</p><div class="orb"><i></i><b>π</b></div></div></section>`;
  }
  if (scene.component === 'DynamicChart') {
    const values = numbers(props, 'values');
    const labels = strings(props, 'labels');
    const max = Math.max(...values, 1);
    const bars = values.map((value, index) => `<div class="bar-col"><strong>${value}%</strong><i style="height:${value / max * 300}px;${index === Number(props.highlightIndex) ? `background:${spec.style.tokens.accent}` : ''}"></i><span>${escapeHtml(labels[index])}</span></div>`).join('');
    return `<section ${base}><div id="${motionId}" class="scene-motion"><div class="kicker">${escapeHtml(text(props, 'kicker'))}</div><div class="scene-head"><h2>${escapeHtml(text(props, 'title'))}</h2><code>${escapeHtml(text(props, 'formula'))}</code></div><div class="chart">${bars}</div></div></section>`;
  }
  if (scene.component === 'CaptionKaraoke') {
    return `<section ${base}><div id="${motionId}" class="scene-motion"><div class="kicker">${escapeHtml(text(props, 'kicker'))}</div><h2>${escapeHtml(text(props, 'title'))}</h2><code class="formula">${escapeHtml(text(props, 'formula'))}</code><div class="steps">${strings(props, 'words').map((word, index) => `<span>${String(index + 1).padStart(2, '0')} · ${escapeHtml(word)}</span>`).join('<i></i>')}</div><p class="footer-copy">${escapeHtml(text(props, 'footer'))}</p></div></section>`;
  }
  if (scene.component === 'MediaBroll') {
    const asset = spec.assets.find((item) => item.id === text(props, 'assetId'));
    const source = asset?.sourceUrl ?? (asset?.src.startsWith('/') ? `file://${path.join(process.cwd(), 'public', asset.src)}` : asset?.src ?? '');
    return `<section ${base}><img class="media-bg" src="${escapeHtml(source)}"><div class="media-shade"></div><div id="${motionId}" class="scene-motion media-copy"><div class="kicker">${escapeHtml(text(props, 'kicker'))}</div><h1>${escapeHtml(text(props, 'headline'))}</h1><p class="lead">${escapeHtml(text(props, 'caption'))}</p><small>${escapeHtml(text(props, 'credit'))}</small></div></section>`;
  }
  if (scene.component === 'SceneCanvas') {
    const canvas = props as unknown as SceneCanvasProps;
    const canvasBase = base.replace(/style="([^"]*)"/, (_match, styles: string) => `style="${styles};background:${escapeHtml(canvasBackground(canvas))}"`);
    const cameraLayers = canvas.layers.filter((layer) => ['shape', 'line', 'image', 'particles'].includes(layer.type));
    const contentLayers = canvas.layers.filter((layer) => !cameraLayers.includes(layer));
    return `<section ${canvasBase}><div id="${motionId}" class="scene-motion free-canvas"><div id="${scene.id}-camera" class="free-camera">${canvasLayerMarkup(scene.id, cameraLayers, spec)}</div><div class="free-content">${canvasLayerMarkup(scene.id, contentLayers, spec)}</div></div></section>`;
  }
  return `<section ${base}><div id="${motionId}" class="scene-motion"><div class="kicker">${escapeHtml(text(props, 'kicker'))}</div><div class="scene-head"><h2>${escapeHtml(text(props, 'title'))}</h2><div class="tags">${strings(props, 'tags').map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div></div><div class="split"><article><small>LAYER 01</small><h3>${escapeHtml(text(props, 'leftTitle'))}</h3><p>${escapeHtml(text(props, 'leftBody')).replaceAll('\n', '<br>')}</p></article><article><small>LAYER 02</small><h3>${escapeHtml(text(props, 'rightTitle'))}</h3><p>${escapeHtml(text(props, 'rightBody')).replaceAll('\n', '<br>')}</p></article></div></div></section>`;
}

export function createHyperFramesHtml(spec: VideoSpec) {
  const compiled = compileVideoSpec(spec);
  const duration = compiled.durationMs / 1000;
  const timelines = compiled.scenes.map((scene) => {
    const start = scene.startMs / 1000;
    const end = (scene.startMs + scene.durationMs) / 1000;
    const canvas = scene.component === 'SceneCanvas' ? scene.props as unknown as SceneCanvasProps : undefined;
    const layerMotion = canvas
      ? canvas.layers.map((layer) => {
        const at = start + layer.motion.delayFrames / spec.canvas.fps;
        const duration = Math.max(1, layer.motion.durationFrames) / spec.canvas.fps;
        const initial = layer.motion.preset === 'rise' || layer.motion.preset === 'float' ? '{opacity:0,y:64}'
          : layer.motion.preset === 'slide-left' ? '{opacity:0,x:110}'
            : layer.motion.preset === 'slide-right' ? '{opacity:0,x:-110}'
              : layer.motion.preset === 'scale' ? '{opacity:0,scale:.72}'
                : layer.motion.preset === 'draw' ? '{opacity:0,scaleX:0,transformOrigin:"left center"}'
                : '{opacity:0}';
        return `tl.set("#${scene.id}-${layer.id}",${initial},${at});tl.to("#${scene.id}-${layer.id}",{opacity:${layer.style.opacity ?? 1},x:0,y:0,scale:1,scaleX:1,duration:${duration},ease:"power3.out"},${at});`;
      }).join('')
      : '';
    const cameraMotion = canvas
      ? `tl.fromTo("#${scene.id}-camera",{scale:${canvas.camera.startScale},xPercent:0,yPercent:0},{scale:${canvas.camera.endScale},xPercent:${canvas.camera.panX},yPercent:${canvas.camera.panY},duration:${Math.max(0.1, end - start)},ease:"none"},${start});`
      : '';
    return `tl.set("#${scene.id}-motion",{opacity:0,y:34},${start});tl.to("#${scene.id}-motion",{opacity:1,y:0,duration:.55,ease:"power3.out"},${start});${cameraMotion}${layerMotion}tl.to("#${scene.id}-motion",{opacity:0,duration:.35},${Math.max(start, end - .35)});tl.set("#${scene.id}-motion",{opacity:0},${end});`;
  }).join('\n');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=${spec.canvas.width},height=${spec.canvas.height}"><script src="./vendor/gsap.min.js"></script>
<style>
@font-face{font-family:"PingFang SC";src:local("PingFang SC")}@font-face{font-family:"Microsoft YaHei";src:local("Microsoft YaHei")}*{box-sizing:border-box}html,body{margin:0;width:${spec.canvas.width}px;height:${spec.canvas.height}px;overflow:hidden;background:${spec.style.tokens.background};color:${spec.style.tokens.text};font-family:${spec.style.tokens.fontFamily}}body:before{content:"";position:fixed;inset:0;background:radial-gradient(circle at 20% 20%,${spec.style.tokens.primary}22,transparent 36%),radial-gradient(circle at 80% 78%,${spec.style.tokens.accent}18,transparent 32%),linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:auto,auto,96px 96px,96px 96px}.scene{position:absolute;inset:0;padding:128px 116px 112px}.scene-motion{height:100%;opacity:0;transform:translateY(34px)}.scene:before{content:"πCUT / HYPERFRAMES";position:absolute;top:30px;left:64px;font-size:18px;font-weight:800;letter-spacing:3px;color:var(--accent)}.scene:after{content:"DETERMINISTIC HTML VIDEO";position:absolute;right:64px;bottom:30px;color:${spec.style.tokens.muted};letter-spacing:2px;font-size:15px}.kicker{color:var(--accent);font-size:19px;letter-spacing:4px;font-weight:850;margin-bottom:20px}h1{font-size:112px;line-height:.98;letter-spacing:-5px;margin:110px 0 26px;max-width:1050px}h2{font-size:76px;letter-spacing:-3px;margin:0}h3{font-size:52px;margin:90px 0 24px}.lead,.footer-copy{font-size:34px;color:${spec.style.tokens.muted}}.orb{position:absolute;right:170px;top:260px;width:400px;height:400px;border:1px solid var(--accent);border-radius:50%;display:grid;place-items:center;box-shadow:0 0 90px color-mix(in srgb,var(--accent) 22%,transparent)}.orb:before,.orb:after{content:"";position:absolute;border:1px solid color-mix(in srgb,var(--accent) 35%,transparent);border-radius:50%;width:560px;height:560px}.orb:after{width:690px;height:690px}.orb b{font-size:100px;background:${spec.style.tokens.surface};border:1px solid var(--accent);padding:50px 70px;border-radius:45px}.scene-head{display:flex;align-items:end;justify-content:space-between}.scene-head code,.formula{font-size:25px;color:var(--accent);border:1px solid color-mix(in srgb,var(--accent) 40%,transparent);padding:18px 25px;border-radius:16px;background:rgba(255,255,255,.035)}.split{display:grid;grid-template-columns:1fr 1fr;gap:26px;margin-top:46px;height:570px}.split article{padding:50px;border:1px solid color-mix(in srgb,var(--accent) 35%,transparent);background:linear-gradient(145deg,color-mix(in srgb,var(--accent) 12%,transparent),color-mix(in srgb,${spec.style.tokens.surface} 86%,transparent));border-radius:${spec.style.tokens.radius}px}.split small{color:var(--accent);letter-spacing:3px;font-size:17px}.split p{font-size:29px;line-height:1.6;color:${spec.style.tokens.muted}}.tags,.steps{display:flex;gap:12px}.tags span,.steps span{padding:13px 19px;border:1px solid rgba(255,255,255,.15);border-radius:999px}.chart{height:500px;margin-top:48px;padding:52px;display:flex;align-items:end;gap:34px;border:1px solid rgba(255,255,255,.1);border-radius:28px;background:color-mix(in srgb,${spec.style.tokens.surface} 82%,transparent)}.bar-col{flex:1;height:390px;display:flex;flex-direction:column;justify-content:end;align-items:center;gap:15px}.bar-col i{display:block;width:100%;background:linear-gradient(var(--accent),color-mix(in srgb,var(--accent) 48%,transparent));border-radius:18px 18px 5px 5px}.bar-col strong{font-size:24px}.bar-col span{font-size:20px;color:${spec.style.tokens.muted}}.formula{display:block;margin:34px 0 72px;font-size:48px;border-left:6px solid var(--accent)}.steps{align-items:center}.steps span{font-size:29px;font-weight:800;border-radius:18px;padding:24px 30px}.steps i{height:2px;background:var(--accent);flex:1}.footer-copy{margin-top:70px;font-size:38px}
.media-bg{position:absolute;inset:-5%;width:110%;height:110%;object-fit:cover}.media-shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(3,13,22,.9),rgba(3,13,22,.45) 52%,rgba(3,13,22,.08)),linear-gradient(0deg,rgba(3,13,22,.8),transparent 50%)}.media-copy{position:absolute;left:108px;top:170px;width:950px;height:auto}.media-copy h1{margin:34px 0}.media-copy small{display:block;margin-top:44px;font-size:17px;color:${spec.style.tokens.muted}}
.free-canvas{position:absolute;inset:0;height:auto}.free-camera{position:absolute;inset:-4%;transform-origin:center}.free-content{position:absolute;inset:0}.free-layer{position:absolute;display:flex;flex-direction:column;justify-content:center;white-space:pre-wrap;overflow:hidden}.free-layer>img{width:100%;height:100%;object-fit:cover}.free-code code,.free-formula code{font-family:SFMono-Regular,Consolas,monospace}.free-line-stroke{display:block;width:100%;box-shadow:0 0 18px currentColor;transform-origin:left center}.free-particles>i{position:absolute;border-radius:50%;box-shadow:0 0 22px currentColor}.free-chart{display:flex;align-items:end;gap:16px;width:100%;height:100%;padding:18px}.free-chart>i{display:flex;flex:1;height:100%;flex-direction:column;justify-content:end;align-items:center;gap:8px}.free-chart b{display:block;width:100%;border-radius:12px 12px 3px 3px;background:var(--accent);box-shadow:0 0 24px color-mix(in srgb,var(--accent) 35%,transparent)}.free-chart strong{font-size:20px}.free-chart span{font-size:14px;opacity:.7}
</style></head><body><main id="root" data-composition-id="picut-main" data-start="0" data-duration="${duration}" data-width="${spec.canvas.width}" data-height="${spec.canvas.height}" data-fps="${spec.canvas.fps}">${compiled.scenes.map((scene, index) => sceneMarkup(scene, spec, index + 1)).join('\n')}</main>
<script>window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});tl.set({}, {}, ${duration});${timelines}window.__timelines["picut-main"]=tl;</script></body></html>`;
}

export async function prepareHyperFramesProject(spec: VideoSpec, projectDir: string) {
  await mkdir(path.join(projectDir, 'vendor'), {recursive: true});
  await writeFile(path.join(projectDir, 'index.html'), createHyperFramesHtml(spec), 'utf8');
  await copyFile(path.join(process.cwd(), 'node_modules', 'gsap', 'dist', 'gsap.min.js'), path.join(projectDir, 'vendor', 'gsap.min.js'));
  return path.join(projectDir, 'index.html');
}

export async function renderHyperFrames(spec: VideoSpec, projectDir: string, outputPath: string) {
  await prepareHyperFramesProject(spec, projectDir);
  await mkdir(path.dirname(outputPath), {recursive: true});
  const cli = path.join(process.cwd(), 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs');
  const chrome = process.env.PICUT_CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  // Keep model credentials inside the Next.js server process. Rendering is a
  // deterministic local operation and only receives the small environment it
  // actually needs to launch Node, Chrome and FFmpeg.
  const childEnv: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV,
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    USER: process.env.USER,
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    LC_ALL: process.env.LC_ALL,
    NO_COLOR: '1',
    HYPERFRAMES_TELEMETRY_DISABLED: '1',
    PRODUCER_HEADLESS_SHELL_PATH: chrome,
  };
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'render', '--quality', 'draft', '--workers', '1', '--no-browser-gpu', '--output', outputPath, projectDir], {
      env: childEnv,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`HyperFrames 退出码 ${code}`)));
  });
  return outputPath;
}
