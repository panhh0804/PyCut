import 'server-only';

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {SettingsManager} from '@earendil-works/pi-coding-agent';
import {EnvHttpProxyAgent, setGlobalDispatcher} from 'undici';

const execFileAsync = promisify(execFile);
const NETWORK_STATE = Symbol.for('picut.pi-network-state');

interface PiNetworkState {
  initialized: boolean;
  proxy?: string;
  source: 'pi-settings' | 'picut-env' | 'process-env' | 'macos-system' | 'direct';
  timeoutMs: number;
}

function runtimeState() {
  return globalThis as typeof globalThis & {[NETWORK_STATE]?: PiNetworkState};
}

function normalizeProxy(value?: string) {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

async function macosSystemProxy() {
  if (process.platform !== 'darwin') return undefined;
  try {
    const {stdout} = await execFileAsync('/usr/sbin/scutil', ['--proxy'], {timeout: 3_000});
    const enabled = /^\s*HTTPSEnable\s*:\s*1\s*$/m.test(stdout) || /^\s*HTTPEnable\s*:\s*1\s*$/m.test(stdout);
    if (!enabled) return undefined;
    const host = stdout.match(/^\s*(?:HTTPSProxy|HTTPProxy)\s*:\s*(\S+)\s*$/m)?.[1];
    const port = stdout.match(/^\s*(?:HTTPSPort|HTTPPort)\s*:\s*(\d+)\s*$/m)?.[1];
    if (!host || !port) return undefined;
    return normalizeProxy(`http://${host}:${port}`);
  } catch {
    return undefined;
  }
}

async function resolveProxy(settingsManager: SettingsManager) {
  const configured = normalizeProxy(settingsManager.getGlobalSettings().httpProxy);
  if (configured) return {proxy: configured, source: 'pi-settings' as const};

  const picut = normalizeProxy(process.env.PICUT_HTTP_PROXY);
  if (picut) return {proxy: picut, source: 'picut-env' as const};

  const environment = normalizeProxy(process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY);
  if (environment) return {proxy: environment, source: 'process-env' as const};

  const system = await macosSystemProxy();
  if (system) return {proxy: system, source: 'macos-system' as const};
  return {proxy: undefined, source: 'direct' as const};
}

/**
 * Initialize the same undici network stack used by the Pi CLI. Node does not
 * inherit macOS System Settings proxies, so the local app explicitly bridges
 * that setting into EnvHttpProxyAgent before creating an AgentSession.
 */
export async function ensurePiNetwork(settingsManager: SettingsManager): Promise<PiNetworkState> {
  const timeoutMs = settingsManager.getHttpIdleTimeoutMs();
  const resolved = await resolveProxy(settingsManager);
  const current = runtimeState()[NETWORK_STATE];
  if (current?.initialized && current.proxy === resolved.proxy && current.timeoutMs === timeoutMs) return current;

  if (resolved.proxy) {
    process.env.HTTP_PROXY = resolved.proxy;
    process.env.HTTPS_PROXY = resolved.proxy;
  }
  process.env.NO_PROXY ??= 'localhost,127.0.0.1,::1';

  const dispatcher = new EnvHttpProxyAgent({
    allowH2: false,
    bodyTimeout: timeoutMs,
    headersTimeout: timeoutMs,
    connect: {autoSelectFamilyAttemptTimeout: 2_000},
  });
  setGlobalDispatcher(dispatcher);

  const state: PiNetworkState = {initialized: true, proxy: resolved.proxy, source: resolved.source, timeoutMs};
  runtimeState()[NETWORK_STATE] = state;
  return state;
}

export function publicNetworkInfo(state: PiNetworkState) {
  return {
    route: state.proxy ? 'proxy' as const : 'direct' as const,
    source: state.source,
    proxy: state.proxy ? state.proxy.replace(/\/\/[^/@]+@/, '//[credentials]@') : undefined,
    timeoutMs: state.timeoutMs,
  };
}
