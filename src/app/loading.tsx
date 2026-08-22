import {LoaderCircle} from 'lucide-react';

export default function Loading() {
  return <main className="error-page"><LoaderCircle className="spin" size={32}/><h1>正在编译工作台</h1><p>读取 VideoSpec 与质量门状态…</p></main>;
}

