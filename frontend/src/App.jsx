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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
      {/* Watermark */}

      <div className="container mx-auto px-4 py-12 max-w-5xl">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-white mb-3 tracking-tight">
            Meeting Summarizer
          </h1>
          <p className="text-blue-200 text-lg">
            AI-powered transcription & intelligent summary generation
          </p>
        </div>

        {/* Upload Section */}
        <div className="bg-white/10 backdrop-blur-md rounded-2xl p-8 mb-8 border border-white/20 shadow-2xl">
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="border-2 border-dashed border-blue-300/50 rounded-xl p-12 text-center hover:border-blue-400 transition-colors cursor-pointer bg-white/5"
          >
            <input
              type="file"
              accept="audio/*"
              onChange={handleFileChange}
              className="hidden"
              id="audio-upload"
            />
            <label htmlFor="audio-upload" className="cursor-pointer">
              <FileAudio className="mx-auto mb-4 text-blue-300" size={48} />
              <p className="text-white text-lg mb-2">
                {file ? file.name : 'Drop audio file here or click to upload'}
              </p>
              <p className="text-blue-200 text-sm">
                Supports MP3, WAV, M4A, and other audio formats
              </p>
            </label>
          </div>

          {file && (
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full mt-6 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin" size={20} />
                  {progress || 'Processing...'}
                </>
              ) : (
                <>
                  <Upload size={20} />
                  Process Meeting
                </>
              )}
            </button>
          )}

          {error && (
            <div className="mt-4 bg-red-500/20 border border-red-500/50 rounded-lg p-4 flex items-center gap-3">
              <AlertCircle className="text-red-300" size={20} />
              <p className="text-red-200">{error}</p>
            </div>
          )}
        </div>

        {/* Results Section */}
        {result && (
          <div className="space-y-6">
            {/* Transcript */}
            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-8 border border-white/20 shadow-2xl">
              <div className="flex items-center gap-3 mb-4">
                <FileAudio className="text-blue-300" size={24} />
                <h2 className="text-2xl font-bold text-white">Transcript</h2>
              </div>
              <div className="bg-black/30 rounded-lg p-6 max-h-64 overflow-y-auto">
                <p className="text-gray-200 leading-relaxed whitespace-pre-wrap">
                  {result.transcript}
                </p>
              </div>
            </div>

            {/* Summary */}
            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-8 border border-white/20 shadow-2xl">
              <div className="flex items-center gap-3 mb-4">
                <Clock className="text-green-300" size={24} />
                <h2 className="text-2xl font-bold text-white">Summary</h2>
              </div>
              <div className="bg-black/30 rounded-lg p-6">
                <p className="text-gray-200 leading-relaxed whitespace-pre-wrap">
                  {result.summary}
                </p>
              </div>
            </div>

            {/* Action Items */}
            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-8 border border-white/20 shadow-2xl">
              <div className="flex items-center gap-3 mb-4">
                <CheckCircle className="text-yellow-300" size={24} />
                <h2 className="text-2xl font-bold text-white">Action Items</h2>
              </div>
              <div className="bg-black/30 rounded-lg p-6">
                <ul className="space-y-3">
                  {result.actionItems.map((item, index) => (
                    <li key={index} className="flex items-start gap-3">
                      <span className="text-yellow-300 mt-1">▸</span>
                      <span className="text-gray-200">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Footer Watermark */}
        <div className="text-center mt-12 text-blue-300/60 text-sm">
          <p>Build by koushil| Meeting Summarizer Project</p>
        </div>
      </div>
    </div>
  );
}