import React, { useState } from 'react';
import { Upload, FileAudio, Clock, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

export default function MeetingSummarizer() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState('');

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
      setResult(null);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type.startsWith('audio/')) {
      setFile(droppedFile);
      setError(null);
      setResult(null);
    } else {
      setError('Please drop an audio file');
    }
  };

  const handleSubmit = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setProgress('Uploading audio...');

    const formData = new FormData();
    formData.append('audio', file);

    try {
      const response = await fetch('http://localhost:3001/api/transcribe', {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) throw new Error('Failed to process audio');
      const data = await response.json();
      setResult(data);
      setProgress('');
    } catch (err) {
      setError(err.message);
      setProgress('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center px-4 py-12">
      <div className="w-full max-w-3xl space-y-10">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-semibold tracking-tight">Meeting Summarizer</h1>
          <p className="text-gray-400">Transcribe & summarize your meetings effortlessly</p>
        </div>

        <div className="border border-gray-800 rounded-lg p-8 bg-neutral-950">
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="border-2 border-dashed border-gray-700 rounded-lg p-10 text-center hover:border-gray-500 transition-colors cursor-pointer"
          >
            <input
              type="file"
              accept="audio/*"
              onChange={handleFileChange}
              className="hidden"
              id="audio-upload"
            />
            <label htmlFor="audio-upload" className="cursor-pointer space-y-2 block">
              <FileAudio className="mx-auto text-gray-400" size={40} />
              <p className="text-gray-200 text-sm">
                {file ? file.name : 'Click or drag an audio file here'}
              </p>
              <p className="text-gray-500 text-xs">Supports MP3, WAV, M4A, WEBM</p>
            </label>
          </div>

          {file && (
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full mt-6 bg-white text-black hover:bg-gray-200 disabled:bg-gray-800 disabled:text-gray-500 font-medium py-3 rounded-md transition flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin" size={18} />
                  {progress || 'Processing...'}
                </>
              ) : (
                <>
                  <Upload size={18} />
                  Process Meeting
                </>
              )}
            </button>
          )}

          {error && (
            <div className="mt-4 border border-red-500/50 rounded-md p-4 flex items-center gap-2 text-red-400 bg-red-500/10">
              <AlertCircle size={18} />
              <p className="text-sm">{error}</p>
            </div>
          )}
        </div>

        {result && (
          <div className="space-y-6">
            <div className="border border-gray-800 rounded-lg p-6 bg-neutral-950">
              <div className="flex items-center gap-2 mb-3">
                <FileAudio size={20} className="text-gray-400" />
                <h2 className="text-lg font-semibold">Transcript</h2>
              </div>
              <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
                {result.transcript}
              </div>
            </div>

            <div className="border border-gray-800 rounded-lg p-6 bg-neutral-950">
              <div className="flex items-center gap-2 mb-3">
                <Clock size={20} className="text-gray-400" />
                <h2 className="text-lg font-semibold">Summary</h2>
              </div>
              <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                {result.summary}
              </div>
            </div>

            <div className="border border-gray-800 rounded-lg p-6 bg-neutral-950">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle size={20} className="text-gray-400" />
                <h2 className="text-lg font-semibold">Action Items</h2>
              </div>
              <ul className="text-sm text-gray-300 space-y-2">
                {result.actionItems.map((item, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <span className="text-gray-500 mt-1">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="text-center text-gray-600 text-sm pt-6 border-t border-gray-900">
          Built with ❤️ by Koushil
        </div>
      </div>
    </div>
  );
}
