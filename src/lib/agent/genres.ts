export interface GenrePreset {
  id: string;
  label: string;
  description: string;
  skillName: string;
  themeHint: 'editorial' | 'science' | 'nature' | 'warm' | 'neon' | 'minimal';
  promptGuidance: string;
  suggestions: Array<{label: string; prompt: string}>;
}

export const GENRE_PRESETS = {
  finance: {
    id: 'finance',
    label: '财经新闻',
    description: '股市、金融、经济解读，数据驱动，爆点前置',
    skillName: 'picut-finance-news',
    themeHint: 'editorial',
    promptGuidance: '本视频属于财经新闻体裁。开始前先阅读 picut-finance-news skill 并严格遵循：数据驱动叙事、爆点数字前3秒开场（metric + count 动画）、红涨绿跌或主题配色、等宽数字字体；结尾必须包含免责声明与数据来源标注。优先使用 chart/metric 层展示关键指标。',
    suggestions: [
      {label: '今日大盘速报', prompt: '生成一条30秒的今日A股大盘速报短视频，突出上证指数涨跌幅与成交量变化，结尾附风险提示'},
      {label: '个股异动解析', prompt: '制作一条40秒的个股异动解析视频，用折线图展示近期股价走势，分析上涨原因'},
      {label: '宏观政策解读', prompt: '创作一条45秒的降息政策解读视频，对比降息前后利率数据，说明对普通人钱包的影响'},
    ],
  },
  education: {
    id: 'education',
    label: '教育科普',
    description: '知识讲解、原理解析，激发好奇心，循序渐进',
    skillName: 'picut-education',
    themeHint: 'science',
    promptGuidance: '本视频属于教育科普体裁。开始前先阅读 picut-education skill 并严格遵循：反直觉提问或现象开场激发好奇心、从已知到未知循序渐进、抽象概念必须可视化（公式用 formula 层配合 draw/reveal 动画逐步揭示）、每个知识点配生活化类比记忆锚点、结尾留互动问题。',
    suggestions: [
      {label: '科学原理揭秘', prompt: '生成一条45秒的科普视频讲解为什么天空是蓝色的，用粒子动画演示瑞利散射原理'},
      {label: '数学概念可视化', prompt: '制作一条30秒的视频讲解勾股定理，用几何图形动画直观展示 a²+b²=c²'},
      {label: '历史事件讲解', prompt: '创作一条60秒的视频讲解决定赤壁之战胜负的关键因素，配时间轴与地图示意'},
    ],
  },
  promotional: {
    id: 'promotional',
    label: '宣传推广',
    description: '品牌宣传、产品推广，情感共鸣+行动号召',
    skillName: 'picut-promotional',
    themeHint: 'warm',
    promptGuidance: '本视频属于宣传推广体裁。开始前先阅读 picut-promotional skill 并严格遵循：情感共鸣开场、痛点→方案→证明→行动号召四段结构、至少3个信任背书元素（用户数/媒体/奖项/证言）、明确的 CTA 结尾镜头（pulse 动画强调）。需要真实素材时调用 search_media 搜索品牌相关实拍内容。',
    suggestions: [
      {label: '品牌形象片', prompt: '为一家科技公司制作30秒品牌宣传片，突出创新精神与用户价值，结尾带slogan'},
      {label: '产品功能推广', prompt: '制作一条25秒的产品功能推广视频，展示三大核心卖点，配用户好评截图'},
      {label: '活动招商宣传', prompt: '创作一条20秒的行业大会宣传视频，突出嘉宾阵容与往届数据，引导扫码报名'},
    ],
  },
  general: {
    id: 'general',
    label: '通用自由',
    description: '不限体裁，自由创作，Agent 自主判断表达方式',
    skillName: '',
    themeHint: 'minimal',
    promptGuidance: '',
    suggestions: [
      {label: '产品介绍', prompt: '生成一条30秒的产品介绍视频'},
      {label: '知识分享', prompt: '制作一条45秒的知识分享短视频'},
      {label: '活动预告', prompt: '创作一条20秒的活动预告视频'},
    ],
  },
} as const satisfies Record<string, GenrePreset>;

export type GenreId = keyof typeof GENRE_PRESETS;

export function genrePreset(genre: string | null | undefined): GenrePreset {
  if (genre && genre in GENRE_PRESETS) return GENRE_PRESETS[genre as GenreId];
  return GENRE_PRESETS.general;
}

export function composeGenrePrompt(brief: string, genre: string | null | undefined) {
  const preset = genrePreset(genre);
  return preset.promptGuidance
    ? `[体裁指引 · ${preset.label}] ${preset.promptGuidance}\n\n用户需求：${brief}`
    : brief;
}
