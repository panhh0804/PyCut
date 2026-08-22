import 'server-only';

import {createHash} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {getProject, updateProject} from '@/lib/project/store';
import {createChangeSet} from '@/lib/video-spec/patch';
import {validateVideoSpec} from '@/lib/video-spec/validation';

interface CommonsCandidate {
  provider: 'wikimedia' | 'noaa' | 'nasa';
  title: string;
  downloadUrl: string;
  pageUrl: string;
  mime: string;
  artist: string;
  license: string;
  licenseUrl?: string;
  description: string;
}

interface MediaSearchResult {
  candidates: CommonsCandidate[];
  warnings: string[];
}

const requestHeaders = {'User-Agent': 'PiCut/0.1 local-agentic-video-editor'};

function readableFetchError(source: string, error: unknown) {
  if (error instanceof DOMException && error.name === 'TimeoutError') return `${source} 请求超时`;
  if (error instanceof Error && error.name === 'AbortError') return `${source} 请求超时`;
  if (error instanceof Error && /fetch failed/i.test(error.message)) {
    const cause = (error.cause as {code?: string; message?: string} | undefined);
    return `${source} 网络连接失败${cause?.code ? `（${cause.code}）` : ''}`;
  }
  return `${source}：${error instanceof Error ? error.message : '未知网络错误'}`;
}

const cleanHtml = (value: unknown) => String(value ?? '')
  .replaceAll(/<[^>]*>/g, ' ')
  .replaceAll(/&nbsp;|&#160;/g, ' ')
  .replaceAll(/&amp;/g, '&')
  .replaceAll(/&quot;/g, '"')
  .replaceAll(/\s+/g, ' ')
  .trim();

export async function searchCommonsMedia(query: string, limit = 8): Promise<CommonsCandidate[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: '6',
    gsrlimit: String(Math.min(12, Math.max(1, limit))),
    prop: 'imageinfo',
    iiprop: 'url|mime|extmetadata',
    iiurlwidth: '1920',
    iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|ImageDescription|Credit',
    origin: '*',
  });
  const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: requestHeaders,
    signal: AbortSignal.timeout(18_000),
  });
  if (!response.ok) throw new Error(`Wikimedia Commons 搜索失败：${response.status}`);
  const payload = await response.json() as {query?: {pages?: Array<{title?: string; imageinfo?: Array<{url?: string; thumburl?: string; mime?: string; extmetadata?: Record<string, {value?: string}>}>}>}};
  return (payload.query?.pages ?? []).flatMap((page) => {
    const info = page.imageinfo?.[0];
    const title = page.title ?? '';
    const downloadUrl = info?.thumburl ?? info?.url;
    const license = cleanHtml(info?.extmetadata?.LicenseShortName?.value);
    if (!downloadUrl || !title || !info?.mime?.startsWith('image/') || info.mime.includes('svg') || !license) return [];
    return [{
      provider: 'wikimedia' as const,
      title,
      downloadUrl,
      pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`,
      mime: info.mime,
      artist: cleanHtml(info.extmetadata?.Artist?.value) || cleanHtml(info.extmetadata?.Credit?.value) || 'Wikimedia Commons contributor',
      license,
      licenseUrl: info.extmetadata?.LicenseUrl?.value,
      description: cleanHtml(info.extmetadata?.ImageDescription?.value) || title.replace(/^File:/, ''),
    }];
  });
}

interface NoaaSearchResult {
  id?: number;
  title?: string;
  url?: string;
  subtype?: string;
}

interface NoaaDetail {
  link?: string;
  title?: {rendered?: string};
  content?: {rendered?: string};
  _embedded?: {'wp:featuredmedia'?: Array<{
    source_url?: string;
    caption?: {rendered?: string};
    media_details?: {
      sizes?: Record<string, {source_url?: string}>;
      image_meta?: {credit?: string; copyright?: string; caption?: string; title?: string};
    };
  }>};
}

export async function searchNoaaOceanMedia(query: string, limit = 8): Promise<CommonsCandidate[]> {
  const search = new URL('https://oceanexplorer.noaa.gov/wp-json/wp/v2/search');
  search.searchParams.set('search', query);
  search.searchParams.set('per_page', String(Math.min(10, Math.max(1, limit))));
  const response = await fetch(search, {headers: requestHeaders, signal: AbortSignal.timeout(18_000)});
  if (!response.ok) throw new Error(`NOAA Ocean Explorer 搜索失败：${response.status}`);
  const results = await response.json() as NoaaSearchResult[];
  const details = await Promise.all(results.flatMap((result) => {
    if (!result.id || !result.subtype || !/^[a-z-]+$/.test(result.subtype)) return [];
    const url = `https://oceanexplorer.noaa.gov/wp-json/wp/v2/${result.subtype}/${result.id}?_embed=1`;
    return [fetch(url, {headers: requestHeaders, signal: AbortSignal.timeout(15_000)})
      .then(async (item) => item.ok ? await item.json() as NoaaDetail : null)
      .catch(() => null)];
  }));
  return details.flatMap((detail) => {
    const featured = detail?._embedded?.['wp:featuredmedia']?.[0];
    const metadata = featured?.media_details?.image_meta;
    const rendered = cleanHtml(`${detail?.content?.rendered ?? ''} ${featured?.caption?.rendered ?? ''}`);
    const credit = cleanHtml(metadata?.credit || metadata?.copyright);
    const noaaAuthored = /NOAA|National Oceanic|Ocean Exploration|Okeanos|OER/i.test(`${credit} ${metadata?.copyright ?? ''}`);
    if (!detail?.link || !featured?.source_url || !noaaAuthored || /\bcopyright\b(?![^.]{0,80}NOAA)/i.test(rendered)) return [];
    const downloadUrl = featured.media_details?.sizes?.['1536x1536']?.source_url
      ?? featured.media_details?.sizes?.large?.source_url
      ?? featured.source_url;
    return [{
      provider: 'noaa' as const,
      title: cleanHtml(detail.title?.rendered) || metadata?.title || 'NOAA Ocean Exploration image',
      downloadUrl,
      pageUrl: detail.link,
      mime: 'image/jpeg',
      artist: credit || 'NOAA Ocean Exploration',
      license: 'Public domain · NOAA Ocean Exploration',
      licenseUrl: 'https://oceanexplorer.noaa.gov/faqs/',
      description: cleanHtml(detail.content?.rendered) || metadata?.caption || cleanHtml(detail.title?.rendered),
    }];
  });
}

interface NasaSearchPayload {
  collection?: {items?: Array<{
    data?: Array<{
      nasa_id?: string;
      title?: string;
      description?: string;
      description_508?: string;
      center?: string;
      photographer?: string;
      secondary_creator?: string;
      media_type?: string;
    }>;
    links?: Array<{href?: string; rel?: string; render?: string}>;
  }>};
}

export function nasaQueryVariants(query: string) {
  const variants = [query.trim()];
  if (/cloud|sky|weather|atmosphere|storm|云|天空|天气|大气|风暴/i.test(query)) variants.push('cumulus clouds atmosphere Earth');
  else if (/hydrothermal|vent|deep sea|ocean|marine|海洋|深海|热液/i.test(query)) variants.push('ocean hydrothermal vent');
  else if (/moon|lunar|月球/i.test(query)) variants.push('Moon lunar surface');
  else if (/mars|火星/i.test(query)) variants.push('Mars surface');
  else {
    const reduced = query
      .replaceAll(/\b(?:diagram|illustration|infographic|editorial|visual|time-?lapse|formation|process|explainer|background)\b/gi, ' ')
      .replaceAll(/\s+/g, ' ')
      .trim()
      .split(' ')
      .slice(0, 5)
      .join(' ');
    if (reduced) variants.push(reduced);
  }
  return [...new Set(variants.filter(Boolean))];
}

function nasaCandidates(payload: NasaSearchPayload): CommonsCandidate[] {
  return (payload.collection?.items ?? []).flatMap((item) => {
    const data = item.data?.[0];
    const preview = item.links?.find((link) => link.render === 'image' && link.rel === 'preview')?.href;
    const description = cleanHtml(data?.description || data?.description_508);
    const rightsText = `${description} ${data?.secondary_creator ?? ''}`;
    if (!data?.nasa_id || !preview || data.media_type !== 'image' || /\b(?:copyright|all rights reserved)\b|©/i.test(rightsText)) return [];
    const center = cleanHtml(data.center);
    const creator = cleanHtml(data.photographer || data.secondary_creator);
    return [{
      provider: 'nasa' as const,
      title: cleanHtml(data.title) || data.nasa_id,
      downloadUrl: preview,
      pageUrl: `https://images.nasa.gov/details/${encodeURIComponent(data.nasa_id)}`,
      mime: 'image/jpeg',
      artist: creator ? `${creator} · NASA${center ? ` / ${center}` : ''}` : `NASA${center ? ` / ${center}` : ''}`,
      license: 'NASA media usage guidelines',
      licenseUrl: 'https://www.nasa.gov/nasa-brand-center/images-and-media/',
      description: description || cleanHtml(data.title) || data.nasa_id,
    }];
  });
}

export async function searchNasaMedia(query: string, limit = 8): Promise<CommonsCandidate[]> {
  for (const variant of nasaQueryVariants(query)) {
    const search = new URL('https://images-api.nasa.gov/search');
    search.searchParams.set('q', variant);
    search.searchParams.set('media_type', 'image');
    search.searchParams.set('page_size', String(Math.min(20, Math.max(1, limit))));
    const response = await fetch(search, {headers: requestHeaders, signal: AbortSignal.timeout(35_000)});
    if (!response.ok) throw new Error(`NASA Image Library 搜索失败：${response.status}`);
    const candidates = nasaCandidates(await response.json() as NasaSearchPayload);
    if (candidates.length) return candidates;
  }
  return [];
}

async function searchLicensedMedia(query: string, limit: number): Promise<MediaSearchResult> {
  const oceanTopic = /ocean|sea|marine|hydrothermal|vent|coral|深海|海洋|海底/i.test(query);
  const nasaTopic = /cloud|sky|weather|atmosphere|storm|earth|space|planet|moon|solar|云|天空|天气|大气|风暴|地球|太空|行星|月球/i.test(query);
  const sources: Array<{name: string; search: () => Promise<CommonsCandidate[]>}> = oceanTopic
    ? [
        {name: 'NOAA Ocean Explorer', search: () => searchNoaaOceanMedia(query, limit)},
        {name: 'NASA Image Library', search: () => searchNasaMedia(query, limit)},
        {name: 'Wikimedia Commons', search: () => searchCommonsMedia(query, limit)},
      ]
    : nasaTopic
      ? [
          {name: 'NASA Image Library', search: () => searchNasaMedia(query, limit)},
          {name: 'Wikimedia Commons', search: () => searchCommonsMedia(query, limit)},
        ]
      : [
          {name: 'Wikimedia Commons', search: () => searchCommonsMedia(query, limit)},
          {name: 'NASA Image Library', search: () => searchNasaMedia(query, limit)},
        ];
  const warnings: string[] = [];
  for (const source of sources) {
    try {
      const candidates = await source.search();
      if (candidates.length) return {candidates, warnings};
      warnings.push(`${source.name} 没有返回带许可元数据的图片`);
    } catch (error) {
      warnings.push(readableFetchError(source.name, error));
    }
  }
  return {candidates: [], warnings};
}

function isTrustedDownloadUrl(value: string) {
  const parsed = new URL(value);
  return parsed.protocol === 'https:' && (
    parsed.hostname.endsWith('wikimedia.org')
    || parsed.hostname === 'oceanexplorer.noaa.gov'
    || parsed.hostname === 'images-assets.nasa.gov'
  );
}

async function downloadCandidate(projectId: string, candidate: CommonsCandidate, slot: number) {
  const parsed = new URL(candidate.downloadUrl);
  if (!isTrustedDownloadUrl(parsed.href)) throw new Error('素材下载地址不在已批准的可信域');
  const response = await fetch(parsed, {headers: requestHeaders, signal: AbortSignal.timeout(45_000)});
  if (!response.ok) throw new Error(`素材下载失败：${response.status}`);
  if (!isTrustedDownloadUrl(response.url)) throw new Error('素材下载重定向到了未批准的域名');
  const contentType = response.headers.get('content-type') ?? candidate.mime;
  if (!contentType.startsWith('image/')) throw new Error('搜索结果不是可用图片');
  const content = Buffer.from(await response.arrayBuffer());
  if (content.length < 8_000 || content.length > 25_000_000) throw new Error('素材文件大小不在安全范围');
  const checksum = createHash('sha256').update(content).digest('hex');
  const extension = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
  const safeId = projectId.replaceAll(/[^a-zA-Z0-9-_]/g, '-');
  const directory = path.join(process.cwd(), 'public', 'media', safeId);
  await mkdir(directory, {recursive: true});
  const filename = `broll-${slot + 1}-${checksum.slice(0, 14)}.${extension}`;
  await writeFile(path.join(directory, filename), content);
  return {
    id: `broll-${slot + 1}-${checksum.slice(0, 14)}`,
    kind: 'image' as const,
    src: `/media/${safeId}/${filename}`,
    checksum,
    license: candidate.licenseUrl ? `${candidate.license} · ${candidate.licenseUrl}` : candidate.license,
    sourceUrl: candidate.pageUrl,
    attribution: candidate.artist,
    retrievedAt: new Date().toISOString(),
  };
}

function queriesForProject(title: string, sceneCount: number, queryOverride?: string) {
  if (queryOverride?.trim()) return Array.from({length: sceneCount}, (_, index) => `${queryOverride.trim()} ${index + 1}`);
  if (/云|cloud/i.test(title)) return ['cumulus clouds blue sky atmosphere', 'cloud droplets condensation macro', 'rain cloud precipitation landscape'].slice(0, sceneCount);
  return Array.from({length: sceneCount}, (_, index) => `${title} editorial visual ${index + 1}`);
}

export async function enrichProjectWithCommonsMedia(projectId: string, queryOverride?: string) {
  const record = await getProject(projectId);
  const spec = record.spec;
  const plannedMediaIndices = spec.editSpec.scenes.flatMap((scene, index) => typeof scene.props.mediaQuery === 'string' && scene.props.mediaQuery.trim() ? [index] : []);
  const sceneIndices = (plannedMediaIndices.length
    ? plannedMediaIndices
    : spec.editSpec.scenes.length >= 3 ? [0, spec.editSpec.scenes.length - 1] : [0]
  ).slice(0, 2);
  const generatedQueries = queriesForProject(spec.project.title, spec.editSpec.scenes.length, queryOverride);
  const queries = spec.editSpec.scenes.map((scene, index) => typeof scene.props.mediaQuery === 'string' && scene.props.mediaQuery.trim()
    ? scene.props.mediaQuery.trim()
    : generatedQueries[index] ?? spec.project.title);
  const used = new Set<string>();
  const downloads: Array<{sceneIndex: number; candidate: CommonsCandidate; asset: Awaited<ReturnType<typeof downloadCandidate>>}> = [];
  const warnings: string[] = [];
  for (const [slot, sceneIndex] of sceneIndices.entries()) {
    const query = queries[sceneIndex] ?? spec.project.title;
    const searched = await searchLicensedMedia(query, 10);
    warnings.push(...searched.warnings.map((warning) => `${spec.editSpec.scenes[sceneIndex].id}：${warning}`));
    let downloaded: {candidate: CommonsCandidate; asset: Awaited<ReturnType<typeof downloadCandidate>>} | null = null;
    for (const candidate of searched.candidates.filter((item) => !used.has(item.downloadUrl))) {
      try {
        downloaded = {candidate, asset: await downloadCandidate(projectId, candidate, slot)};
        break;
      } catch (error) {
        warnings.push(`${spec.editSpec.scenes[sceneIndex].id}：${candidate.provider} 下载候选失败：${error instanceof Error ? error.message : '未知错误'}`);
      }
    }
    if (!downloaded) {
      warnings.push(`${spec.editSpec.scenes[sceneIndex].id}：查询“${query}”后没有可下载的合规素材`);
      continue;
    }
    used.add(downloaded.candidate.downloadUrl);
    downloads.push({sceneIndex, ...downloaded});
  }
  if (!downloads.length) {
    return {
      spec,
      validation: validateVideoSpec(spec),
      assets: [],
      degraded: true,
      warnings,
      message: `所有可信素材源均暂不可用或无合规结果；已保留当前可编辑 VideoSpec，未阻断工作台。${warnings.slice(0, 3).join('；')}`,
    };
  }
  const retainedAssets = spec.assets.filter((asset) => !asset.id.startsWith('broll-'));
  const patch = [
    {op: 'replace' as const, path: '/assets', value: [...retainedAssets, ...downloads.map((item) => item.asset)]},
    ...downloads.flatMap(({sceneIndex, candidate, asset}, slot) => {
      const scene = spec.editSpec.scenes[sceneIndex];
      const story = spec.storySpec.scenes.find((item) => item.id === scene.id)!;
      const existingTitle = typeof scene.props.title === 'string' ? scene.props.title : story.purpose;
      return [
        {op: 'replace' as const, path: `/editSpec/scenes/${sceneIndex}/component`, value: 'MediaBroll'},
        {op: 'replace' as const, path: `/editSpec/scenes/${sceneIndex}/props`, value: {
          assetId: asset.id,
          kicker: typeof scene.props.eyebrow === 'string' ? scene.props.eyebrow : typeof scene.props.kicker === 'string' ? scene.props.kicker : 'FIELD VISUAL · VERIFIED SOURCE',
          headline: existingTitle,
          caption: story.narration,
          credit: `${candidate.artist} · ${candidate.license}`.slice(0, 160),
          focalX: slot === 0 ? 58 : 50,
          focalY: slot === 0 ? 44 : 54,
          accentColor: String(scene.props.accentColor ?? spec.style.tokens.primary),
        }},
      ];
    }),
  ];
  const changeSet = createChangeSet({baseRevision: spec.revision, actor: 'agent', intent: `联网检索并注入 ${downloads.length} 个可追溯 B-roll 素材`, risk: 'medium', approval: 'not-required', patch});
  const updated = await updateProject(projectId, changeSet);
  return {
    spec: updated.spec,
    validation: validateVideoSpec(updated.spec),
    assets: downloads.map(({sceneIndex, candidate, asset}) => ({sceneId: spec.editSpec.scenes[sceneIndex].id, assetId: asset.id, sourceUrl: candidate.pageUrl, attribution: candidate.artist, license: candidate.license, query: queries[sceneIndex], provider: candidate.provider})),
    degraded: downloads.length < sceneIndices.length,
    warnings,
    message: downloads.length < sceneIndices.length ? `已注入 ${downloads.length} 个素材；其余镜头保留原组件并可继续编辑。` : undefined,
  };
}
