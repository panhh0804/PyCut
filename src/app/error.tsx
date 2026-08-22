'use client';

import {CircleAlert, RotateCcw} from 'lucide-react';

export default function ErrorBoundary({error, reset}: {error: Error & {digest?: string}; reset: () => void}) {
  return <main className="error-page"><CircleAlert size={32}/><h1>工作台暂时无法加载</h1><p>{error.message}</p><button type="button" onClick={reset}><RotateCcw size={16}/>重新加载</button></main>;
}

