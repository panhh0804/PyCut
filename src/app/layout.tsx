import type {Metadata} from 'next';
import './globals.css';
import './timeline.css';
import './interaction.css';

export const metadata: Metadata = {
  title: 'πCut — Agentic Video Compiler',
  description: '以 VideoSpec 为单一事实源的人机协同代码剪辑工作台',
};

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
