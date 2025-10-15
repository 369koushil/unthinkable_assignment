const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { pipeline, env } = require('@xenova/transformers');
const wavefile = require('wavefile');
const ffmpeg = require('fluent-ffmpeg');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// --- Suppress ONNXRuntime warnings ---
const originalStderrWrite = process.stderr.write;
process.stderr.write = (chunk, ...args) => {
  const msg = chunk.toString();
  if (
    msg.includes('onnxruntime:') ||
    msg.includes('Removing initializer') ||
    msg.includes('graph.cc') ||
    msg.includes('W:onnxruntime')
  ) {
    return;
  }
  return originalStderrWrite.apply(process.stderr, [chunk, ...args]);
};

const cacheDir = path.join(process.cwd(), '.cache');
if (!fsSync.existsSync(cacheDir)) fsSync.mkdirSync(cacheDir, { recursive: true });

env.allowLocalModels = false;
env.useBrowserCache = false;
env.cacheDir = cacheDir;
env.backends.onnx.wasm.numThreads = 4;

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
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

async function convertToWavIfNeeded(inputPath) {
  const ext = path.extname(inputPath).toLowerCase();
  if (ext === '.wav') return inputPath;
  const outputPath = inputPath.replace(ext, '.wav');
  console.log(`Converting ${path.basename(inputPath)} → ${path.basename(outputPath)}`);
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions(['-ac 1', '-ar 16000', '-f wav'])
      .on('end', () => {
        console.log('Conversion completed');
        resolve(outputPath);
      })
      .on('error', (err) => reject(new Error(`FFmpeg conversion failed: ${err.message}`)))
      .save(outputPath);
  });
}

function processAudioBuffer(buffer) {
  try {
    let wav = new wavefile.WaveFile(buffer);
    wav.toBitDepth('32f');
    wav.toSampleRate(16000);
    let audioData = wav.getSamples();
    if (Array.isArray(audioData)) {
      if (audioData.length > 1) {
        const SCALING_FACTOR = Math.sqrt(2);
        for (let i = 0; i < audioData[0].length; ++i)
          audioData[0][i] = SCALING_FACTOR * (audioData[0][i] + audioData[1][i]) / 2;
      }
      audioData = audioData[0];
    }
    return audioData;
  } catch (err) {
    throw new Error(`Audio processing failed: ${err.message}`);
  }
}

let transcriber = null;
async function getTranscriber() {
  if (!transcriber) {
    console.log('Loading Whisper model...');
    console.log("======================================================================");
    transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
    console.log("======================================================================");
    console.log('Whisper model loaded');
  }
  return transcriber;
}

async function transcribeAudio(audioPath) {
  try {
    console.log(`Reading audio file: ${path.basename(audioPath)}`);
    audioPath = await convertToWavIfNeeded(audioPath);
    const buffer = fsSync.readFileSync(audioPath);
    console.log(`File size: ${(buffer.length / 1024).toFixed(2)} KB`);
    console.log('Processing audio data...');
    const audioData = processAudioBuffer(buffer);
    console.log(`Processed ${audioData.length} audio samples`);
    const model = await getTranscriber();
    console.log('Transcribing with Whisper...');
    const startTime = Date.now();
    const result = await model(audioData, {
      chunk_length_s: 30,
      stride_length_s: 5,
      language: 'english',
      task: 'transcribe'
    });
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Transcription completed in ${duration}s`);
    if (!result || !result.text) throw new Error('No transcription result');
    const transcript = result.text.trim();
    if (transcript.length === 0) throw new Error('Empty transcription');
    console.log(`Transcribed ${transcript.length} characters`);
    console.log(`Preview: "${transcript.substring(0, 100)}..."`);
    return transcript;
  } catch (err) {
    console.error('Transcription error:', err.message);
    throw new Error(`Failed to transcribe: ${err.message}`);
  }
}

const LMSTUDIO_API = 'http://localhost:1234/v1/chat/completions';
const LMSTUDIO_MODEL = 'phi-3-mini-4k-instruct';

async function generateSummary(transcript) {
  const prompt = `Analyze this meeting transcript and provide a concise summary covering:
1. Key Decisions Made
2. Important Discussion Points
3. Overall meeting outcome

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
    if (!response.ok) throw new Error(`LM Studio error: ${response.status}`);
    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content?.trim();
    if (!summary) throw new Error('Empty response from LM Studio');
    return summary;
  } catch (err) {
    console.error('Summary error:', err.message);
    return `Summary unavailable. Ensure LM Studio is running. Error: ${err.message}`;
  }
}

async function extractActionItems(transcript) {
  const prompt = `Extract all action items from this meeting transcript. 
List each action item as a clear, concise task. 
Format each item on a new line starting with a dash (-).

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
    if (!response.ok) throw new Error(`LM Studio error: ${response.status}`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim() || '';
    const items = content
      .split('\n')
      .filter(line => line.trim().startsWith('-'))
      .map(line => line.trim().substring(1).trim())
      .filter(item => item.length > 0);
    return items.length > 0 ? items : ['No specific action items identified.'];
  } catch (err) {
    console.error('Action items error:', err.message);
    return [`Action items extraction unavailable. Error: ${err.message}`];
  }
}

// =========================================
// MAIN API ENDPOINT
// =========================================
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  let audioPath = null;
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file provided' });
    audioPath = req.file.path;
    console.log('='.repeat(70));
    console.log(`Processing: ${req.file.originalname}`);
    console.log(`Size: ${(req.file.size / 1024).toFixed(2)} KB`);
    console.log(`Started: ${new Date().toLocaleTimeString()}`);
    console.log('='.repeat(70));

    const transcript = await transcribeAudio(audioPath);
    const summary = await generateSummary(transcript);
    console.log('\n📝 SUMMARY:');
    console.log('='.repeat(70));
    console.log(summary);
    console.log('='.repeat(70));

    const actionItems = await extractActionItems(transcript);
    console.log('\n✅ ACTION ITEMS:');
    actionItems.forEach((item, idx) => console.log(`${idx + 1}. ${item}`));

    await fs.unlink(audioPath).catch(() => {});
    console.log('\nTemporary file cleaned up successfully.');
    console.log('='.repeat(70));

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
    console.error('ERROR:', err.message);
    if (audioPath) await fs.unlink(audioPath).catch(() => {});
    res.status(500).json({ error: 'Failed to process audio', details: err.message });
  }
});

// =========================================
// HEALTH CHECK ENDPOINT
// =========================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    services: {
      whisper: transcriber ? 'loaded' : 'not loaded',
      lmStudio: LMSTUDIO_API
    },
    models: {
      transcription: 'Xenova/whisper-tiny.en',
      summarization: LMSTUDIO_MODEL
    },
    cache: cacheDir,
    timestamp: new Date().toISOString()
  });
});

// =========================================
// SERVER STARTUP
// =========================================
app.listen(PORT, () => {
  console.log('='.repeat(70));
  console.log('Meeting Summarizer Backend - Running');
  console.log('='.repeat(70));
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`Endpoint: POST /api/transcribe`);
  console.log(`Health: GET /api/health`);
  console.log('='.repeat(70));
  console.log('Models:');
  console.log(`- Whisper: Xenova/whisper-tiny.en`);
  console.log(`- LLM: ${LMSTUDIO_MODEL}`);
  console.log('Requirements:');
  console.log('- LM Studio running on port 1234');
  console.log('- FFmpeg installed');
  console.log('- Audio formats: MP3, WAV, M4A, etc.');
  console.log('Ready to process meetings.');
});
