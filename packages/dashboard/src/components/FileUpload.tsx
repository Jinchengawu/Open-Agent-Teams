'use client';

import React, { useState, useRef } from 'react';

interface FileUploadProps {
  onUpload: (files: Array<{ filename: string; originalname: string; url: string; mimetype: string }>) => void;
}

export default function FileUpload({ onUpload }: FileUploadProps) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }

    try {
      const res = await fetch('/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      onUpload(
        data.files.map((f: any) => ({
          filename: f.filename,
          originalname: f.originalname,
          url: `/uploads/${f.filename}`,
          mimetype: f.mimetype,
        }))
      );
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,.pdf,.sql,.md,.txt,.csv,.json,.yaml,.yml"
        className="hidden"
        onChange={handleFileChange}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="text-xs px-3 py-1.5 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50 flex items-center gap-1"
      >
        {uploading ? '⏳ 上传中...' : '📎 附件'}
      </button>
    </div>
  );
}
