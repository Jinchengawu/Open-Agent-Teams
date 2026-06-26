'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';

interface SnapshotPanelProps {
  sessionId: string;
  messages: Array<{ role: string; content: string }>;
}

export default function SnapshotPanel({ sessionId, messages }: SnapshotPanelProps) {
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/snapshots?session_id=${sessionId}`)
      .then(r => r.json())
      .then(d => setSnapshots(d.snapshots || []))
      .catch(console.error);
  }, [sessionId]);

  const handleSave = async () => {
    // 提取所有 assistant 消息中的代码块
    const files: Array<{ filename: string; content: string; language: string }> = [];
    let fileIndex = 0;

    for (const msg of messages) {
      if (msg.role === 'assistant') {
        const regex = /```(\w+)?\n([\s\S]*?)```/g;
        let match;
        while ((match = regex.exec(msg.content)) !== null) {
          files.push({
            filename: `file-${++fileIndex}.${match[1] || 'txt'}`,
            content: match[2].trim(),
            language: match[1] || 'txt',
          });
        }
      }
    }

    if (files.length === 0) {
      alert('当前会话中没有检测到代码块');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          title: `会话快照 ${new Date().toLocaleString()}`,
          description: `自动提取 ${files.length} 个代码文件`,
          files,
        }),
      });
      const data = await res.json();
      setSnapshots(prev => [data, ...prev]);
    } catch (e) {
      console.error('Save snapshot failed:', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm">📦 代码快照</h3>
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存快照'}
        </button>
      </div>
      {snapshots.length === 0 ? (
        <p className="text-xs text-gray-400">暂无快照</p>
      ) : (
        <ul className="space-y-2 max-h-60 overflow-y-auto">
          {snapshots.map(s => {
            let fileCount = 0;
            try {
              fileCount = JSON.parse(s.files || '[]').length;
            } catch {}
            return (
              <li key={s.id} className="text-xs border-b border-slate-100 pb-2 last:border-0">
                <div className="font-medium">{s.title}</div>
                <div className="text-gray-400">
                  {fileCount} 文件 · {new Date(s.created_at).toLocaleString()}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
