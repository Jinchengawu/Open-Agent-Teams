'use client';

import React, { useState, useMemo } from 'react';
import { Card } from '@/components/ui/card';

interface CodePreviewProps {
  code: string;
  language?: string;
}

export default function CodePreview({ code, language = 'html' }: CodePreviewProps) {
  const [visible, setVisible] = useState(false);

  const blobUrl = useMemo(() => {
    if (!code || !visible) return null;
    let html = code;

    // 如果代码是 JSX/TSX 而非完整 HTML，包装为完整 HTML
    if (language === 'jsx' || language === 'tsx' || language === 'react') {
      html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>body{margin:0;padding:16px;font-family:sans-serif;}</style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
${code}
    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(<App />);
  </script>
</body>
</html>`;
    }

    // 如果代码是 Vue 单文件组件
    else if (language === 'vue') {
      html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>body{margin:0;padding:16px;font-family:sans-serif;}</style>
</head>
<body>
  <div id="app"></div>
  <script>
${code}
    Vue.createApp(App).mount('#app');
  </script>
</body>
</html>`;
    }

    // 如果代码是 HTML 片段而非完整文档
    else if (!code.includes('<!DOCTYPE') && !code.includes('<html')) {
      html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>body{margin:0;padding:16px;font-family:sans-serif;}</style>
</head>
<body>${code}</body>
</html>`;
    }

    const blob = new Blob([html], { type: 'text/html' });
    return URL.createObjectURL(blob);
  }, [code, language, visible]);

  if (!code) return null;

  return (
    <Card className="mt-2 overflow-hidden border border-slate-200">
      <div className="flex items-center justify-between bg-slate-50 px-3 py-2 border-b border-slate-200">
        <span className="text-xs font-medium text-slate-500">🖥️ 代码预览</span>
        <div className="flex gap-2">
          <button
            onClick={() => setVisible(!visible)}
            className="text-xs px-2 py-1 bg-white border border-slate-200 rounded hover:bg-slate-100 transition-colors"
          >
            {visible ? '隐藏' : '预览'}
          </button>
          {blobUrl && (
            <a
              href={blobUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-2 py-1 bg-blue-50 text-blue-600 border border-blue-200 rounded hover:bg-blue-100 transition-colors"
            >
              新窗口
            </a>
          )}
        </div>
      </div>
      {visible && blobUrl && (
        <iframe
          src={blobUrl}
          className="w-full h-96 border-0"
          sandbox="allow-scripts allow-same-origin"
          title="code-preview"
        />
      )}
    </Card>
  );
}
