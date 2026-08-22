import type {VideoSpec} from './schema';

export const VIDEO_THEME_PRESETS = {
  editorial: {label: 'Editorial', tokens: {background: '#08131F', surface: '#12283A', primary: '#56E0C5', accent: '#FF9A68', text: '#F4F8FB', muted: '#9BB0BE', fontFamily: 'Inter, PingFang SC, Microsoft YaHei, sans-serif', radius: 28}},
  science: {label: 'Sky Science', tokens: {background: '#061525', surface: '#102E49', primary: '#73D8FF', accent: '#FFD166', text: '#F4FBFF', muted: '#99BED1', fontFamily: 'Inter, PingFang SC, Microsoft YaHei, sans-serif', radius: 30}},
  nature: {label: 'Field Nature', tokens: {background: '#071A17', surface: '#12372F', primary: '#8EE6B1', accent: '#F6C96C', text: '#F5FFF9', muted: '#A7CABB', fontFamily: 'Inter, PingFang SC, Microsoft YaHei, sans-serif', radius: 32}},
  warm: {label: 'Warm Story', tokens: {background: '#21110D', surface: '#3C2119', primary: '#FFB86B', accent: '#FF6B6B', text: '#FFF8F1', muted: '#D0AEA0', fontFamily: 'Inter, PingFang SC, Microsoft YaHei, sans-serif', radius: 30}},
  neon: {label: 'Neon Future', tokens: {background: '#08071B', surface: '#17133A', primary: '#8CFFEA', accent: '#CA7CFF', text: '#F8F6FF', muted: '#ABA5CE', fontFamily: 'Inter, PingFang SC, Microsoft YaHei, sans-serif', radius: 26}},
  minimal: {label: 'Mono Minimal', tokens: {background: '#101419', surface: '#20262D', primary: '#E9F2F7', accent: '#6CB7FF', text: '#F8FAFC', muted: '#A4AFBA', fontFamily: 'Inter, PingFang SC, Microsoft YaHei, sans-serif', radius: 22}},
} as const satisfies Record<string, {label: string; tokens: VideoSpec['style']['tokens']}>;

export type VideoThemeName = keyof typeof VIDEO_THEME_PRESETS;
