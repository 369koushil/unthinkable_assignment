/**
 * Meeting Summarizer Backend
 * Works with LM Studio (phi-3-mini-4k-instruct) and Xenova Whisper
 * Run LM Studio locally on port 1234
 */

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fsSync = require('fs');
const fs = require('fs').promises;
const { pipeline, env } = require('@xenova/transformers');

// -------------------------------------------------------------------
// Server setup
// -------------------------------------------------------------------
const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// -------------------------------------------------------------------
// Multer setup (file uploads)
// -------------------------------------------------------------------
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// -------------------------------------------------------------------
// Whisper Transcription Setup
// -------------------------------------------------------------------
env.allowLocalModels = false;
env.useBrowserCache = false;
env.backends.onnx.wasm.numThreads = 1;

let transcriber = null;

async function getTranscriber() {
  if (!transcriber) {
    console.log('🌀 Loading Whisper model (tiny.en)...');
    transcriber = await pipeline(
      'automatic-speech-recognition',
      'Xenova/whisper-tiny.en'
    );
    console.log('✅ Whisper model loaded!');
  }
  return transcriber;
}

async function transcribeAudio(audioPath) {
  try {
    const model = await getTranscriber();

    // Read raw audio bytes
    const audioBytes = fsSync.readFileSync(audioPath);
    const arrayBuffer = audioBytes.buffer.slice(
      audioBytes.byteOffset,
      audioBytes.byteOffset + audioBytes.byteLength
    );

    const result = await model(arrayBuffer, {
      chunk_length_s: 30,
      stride_length_s: 5
    });
    
    console.log(result)
    return result.text;
  } catch (err) {
    console.error('❌ Transcription error:', err);
    throw new Error('Failed to transcribe audio');
  }
}

// -------------------------------------------------------------------
// LM Studio Setup
// -------------------------------------------------------------------
const LMSTUDIO_API = 'http://localhost:1234/v1/chat/completions';
const LMSTUDIO_MODEL = 'phi-3-mini-4k-instruct';

// Generate summary using LM Studio
async function generateSummary(transcript) {
  const prompt = `Analyze this meeting transcript and provide a concise summary covering:
1. Key Decisions Made
2. Important Discussion Points
3. Overall meeting outcome

Keep it brief and professional.

Transcript:
${transcript}

Summary:`;

  try {
    const response = await fetch(LMSTUDIO_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: LMSTUDIO_MODEL,
        messages: [
          { role: 'system', content: 'You are a professional meeting summarizer.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 500
      })
    });

    if (!response.ok) throw new Error(`LM Studio API failed: ${response.statusText}`);

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || 'No summary generated.';
  } catch (err) {
    console.error('❌ Summary generation error:', err);
    return 'Summary generation unavailable. Please ensure LM Studio is running.';
  }
}

// Extract action items using LM Studio
async function extractActionItems(transcript) {
  const prompt = `Extract all action items from this meeting transcript. 
List each action item as a clear, concise task. 
Format each item on a new line starting with a dash (-).

If there are no clear action items, respond with: 
"No specific action items identified."

Transcript:
${transcript}

Action Items:`;

  try {
    const response = await fetch(LMSTUDIO_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: LMSTUDIO_MODEL,
        messages: [
          { role: 'system', content: 'You extract actionable tasks from meeting transcripts.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 400
      })
    });

    if (!response.ok) throw new Error(`LM Studio API failed: ${response.statusText}`);

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim() || '';

    const items = content
      .split('\n')
      .filter(line => line.trim().startsWith('-'))
      .map(line => line.trim().substring(1).trim());

    return items.length > 0 ? items : ['No specific action items identified.'];
  } catch (err) {
    console.error('❌ Action items extraction error:', err);
    return ['Action items extraction unavailable. Please ensure LM Studio is running.'];
  }
}

// -------------------------------------------------------------------
// Main endpoint
// -------------------------------------------------------------------
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file provided' });

    const audioPath = req.file.path;
    console.log(`🎧 Processing audio: ${req.file.originalname}`);

    // Step 1: Transcribe
    console.log('🔊 Transcribing...');
    const transcript = await transcribeAudio(audioPath);
    console.log('✅ Transcription complete');

    // Step 2: Generate summary
    console.log('🧠 Generating summary...');
    const summary = await generateSummary(transcript);
    console.log('✅ Summary generated');

    // Step 3: Extract action items
    console.log('📝 Extracting action items...');
    const actionItems = await extractActionItems(transcript);
    console.log('✅ Action items extracted');

    // Cleanup
    await fs.unlink(audioPath);

    res.json({
      transcript,
      summary,
      actionItems,
      metadata: {
        filename: req.file.originalname,
        processedAt: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('❌ Error processing audio:', err);
    if (req.file?.path) {
      try { await fs.unlink(req.file.path); } catch {}
    }
    res.status(500).json({ error: 'Failed to process audio', details: err.message });
  }
});

// -------------------------------------------------------------------
// Health check
// -------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    whisper: transcriber ? 'loaded' : 'not loaded',
    lmStudio: LMSTUDIO_API,
    model: LMSTUDIO_MODEL,
    timestamp: new Date().toISOString()
  });
});

// -------------------------------------------------------------------
// Start server
// -------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`\n🚀 Meeting Summarizer Backend running on http://localhost:${PORT}`);
  console.log(`📝 POST /api/transcribe`);
  console.log(`💚 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🤖 LM Studio: ${LMSTUDIO_MODEL} @ ${LMSTUDIO_API}\n`);
});
