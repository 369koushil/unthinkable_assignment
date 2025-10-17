const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { pipeline, env } = require('@xenova/transformers');
const wavefile = require('wavefile');
const ffmpeg = require('fluent-ffmpeg');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// =========================================
// DATABASE SETUP (SQLite for data storage)
// =========================================
const dbPath = path.join(process.cwd(), 'meeting_data.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Database connection error:', err.message);
  } else {
    console.log('✅ Connected to SQLite database');
  }
});

// Create meetings table
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      transcript TEXT NOT NULL,
      summary TEXT NOT NULL,
      action_items TEXT NOT NULL,
      file_size INTEGER,
      processing_time REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('❌ Table creation error:', err.message);
    } else {
      console.log('✅ Meetings table ready');
    }
  });
});

// Database helper functions
async function saveMeeting(data) {
  return new Promise((resolve, reject) => {
    const sql = `
      INSERT INTO meetings (filename, transcript, summary, action_items, file_size, processing_time)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    
    db.run(
      sql,
      [
        data.filename,
        data.transcript,
        data.summary,
        JSON.stringify(data.actionItems), // Store as JSON string
        data.fileSize,
        data.processingTime
      ],
      function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID); // 'this' contains lastID
        }
      }
    );
  });
}

async function getAllMeetings() {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT 
        id,
        filename,
        substr(transcript, 1, 100) as transcript_preview,
        substr(summary, 1, 150) as summary_preview,
        created_at,
        file_size,
        processing_time
      FROM meetings 
      ORDER BY created_at DESC
    `;
    
    db.all(sql, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function getMeetingById(id) {
  return new Promise((resolve, reject) => {
    const sql = `SELECT * FROM meetings WHERE id = ?`;
    
    db.get(sql, [id], (err, meeting) => {
      if (err) {
        reject(err);
      } else {
        if (meeting && meeting.action_items) {
          meeting.action_items = JSON.parse(meeting.action_items);
        }
        resolve(meeting);
      }
    });
  });
}

async function deleteMeeting(id) {
  return new Promise((resolve, reject) => {
    const sql = `DELETE FROM meetings WHERE id = ?`;
    
    db.run(sql, [id], function(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

// =========================================
// Suppress ONNXRuntime warnings
// =========================================
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

// =========================================
// Configure Transformers.js
// =========================================
const cacheDir = path.join(process.cwd(), '.cache');
if (!fsSync.existsSync(cacheDir)) {
  fsSync.mkdirSync(cacheDir, { recursive: true });
}

env.allowLocalModels = false;
env.useBrowserCache = false;
env.cacheDir = cacheDir;
env.backends.onnx.wasm.numThreads = 4;

// =========================================
// Multer setup
// =========================================
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

// =========================================
// Audio processing functions
// =========================================
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
        for (let i = 0; i < audioData[0].length; ++i) {
          audioData[0][i] = SCALING_FACTOR * (audioData[0][i] + audioData[1][i]) / 2;
        }
      }
      audioData = audioData[0];
    }
    return audioData;
  } catch (err) {
    throw new Error(`Audio processing failed: ${err.message}`);
  }
}

// =========================================
// Whisper transcription
// =========================================
let transcriber = null;

async function getTranscriber() {
  if (!transcriber) {
    console.log('Loading Whisper model...');
    console.log("=".repeat(70));
    transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
    console.log("=".repeat(70));
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

// =========================================
// LM Studio integration
// =========================================
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
// API ENDPOINTS
// =========================================

// Main transcription endpoint (with storage)
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  let audioPath = null;
  const startTime = Date.now();
  
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file provided' });
    
    audioPath = req.file.path;
    console.log('='.repeat(70));
    console.log(`Processing: ${req.file.originalname}`);
    console.log(`Size: ${(req.file.size / 1024).toFixed(2)} KB`);
    console.log(`Started: ${new Date().toLocaleTimeString()}`);
    console.log('='.repeat(70));

    // Step 1: Transcribe
    const transcript = await transcribeAudio(audioPath);
    
    // Step 2: Generate summary
    const summary = await generateSummary(transcript);
    console.log('\n📝 SUMMARY:');
    console.log('='.repeat(70));
    console.log(summary);
    console.log('='.repeat(70));

    // Step 3: Extract action items
    const actionItems = await extractActionItems(transcript);
    console.log('\n✅ ACTION ITEMS:');
    actionItems.forEach((item, idx) => console.log(`${idx + 1}. ${item}`));

    // Calculate processing time
    const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);

    // Step 4: Save to database
    console.log('\n💾 Saving to database...');
    const meetingId = await saveMeeting({
      filename: req.file.originalname,
      transcript,
      summary,
      actionItems,
      fileSize: req.file.size,
      processingTime: parseFloat(processingTime)
    });
    console.log(`✅ Saved with ID: ${meetingId}`);

    // Cleanup temporary file
    await fs.unlink(audioPath).catch(() => {});
    console.log('🧹 Temporary file cleaned up');
    console.log('='.repeat(70));

    res.json({
      id: meetingId,
      transcript,
      summary,
      actionItems,
      metadata: {
        filename: req.file.originalname,
        processedAt: new Date().toISOString(),
        processingTime: `${processingTime}s`,
        saved: true
      }
    });
    
  } catch (err) {
    console.error('ERROR:', err.message);
    if (audioPath) await fs.unlink(audioPath).catch(() => {});
    res.status(500).json({ error: 'Failed to process audio', details: err.message });
  }
});

// Get all meetings (history)
app.get('/api/meetings', async (req, res) => {
  try {
    const meetings = await getAllMeetings();
    res.json({
      count: meetings.length,
      meetings: meetings.map(m => ({
        id: m.id,
        filename: m.filename,
        transcriptPreview: m.transcript_preview,
        summaryPreview: m.summary_preview,
        createdAt: m.created_at,
        fileSize: m.file_size,
        processingTime: m.processing_time
      }))
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch meetings', details: err.message });
  }
});

// Get specific meeting by ID
app.get('/api/meetings/:id', async (req, res) => {
  try {
    const meeting = await getMeetingById(req.params.id);
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }
    res.json(meeting);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch meeting', details: err.message });
  }
});

// Delete meeting
app.delete('/api/meetings/:id', async (req, res) => {
  try {
    await deleteMeeting(req.params.id);
    res.json({ message: 'Meeting deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete meeting', details: err.message });
  }
});

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const meetingCount = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM meetings', (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    res.json({
      status: 'ok',
      services: {
        whisper: transcriber ? 'loaded' : 'not loaded',
        lmStudio: LMSTUDIO_API,
        database: 'connected'
      },
      models: {
        transcription: 'Xenova/whisper-tiny.en',
        summarization: LMSTUDIO_MODEL
      },
      storage: {
        database: dbPath,
        cache: cacheDir,
        totalMeetings: meetingCount.count
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: 'Health check failed', details: err.message });
  }
});

// =========================================
// SERVER STARTUP
// =========================================
app.listen(PORT, () => {
  console.log('='.repeat(70));
  console.log('🚀 Meeting Summarizer Backend - Batch 2026');
  console.log('='.repeat(70));
  console.log(`📡 Server: http://localhost:${PORT}`);
  console.log(`📝 Main endpoint: POST /api/transcribe`);
  console.log(`📋 Get all meetings: GET /api/meetings`);
  console.log(`🔍 Get meeting by ID: GET /api/meetings/:id`);
  console.log(`🗑️  Delete meeting: DELETE /api/meetings/:id`);
  console.log(`💚 Health check: GET /api/health`);
  console.log('='.repeat(70));
  console.log('🗄️  Database:');
  console.log(`   - SQLite: ${dbPath}`);
  console.log(`   - Stores: transcripts, summaries, action items`);
  console.log('='.repeat(70));
  console.log('🤖 AI Models:');
  console.log(`   - Whisper: Xenova/whisper-tiny.en`);
  console.log(`   - LLM: ${LMSTUDIO_MODEL} (LM Studio)`);
  console.log('='.repeat(70));
  console.log('⚠️  Requirements:');
  console.log('   ✓ LM Studio running on port 1234');
  console.log('   ✓ FFmpeg installed');
  console.log('   ✓ Audio formats: MP3, WAV, M4A, etc.');
  console.log('\n✨ Ready to process and store meetings!\n');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Shutting down gracefully...');
  db.close((err) => {
    if (err) console.error('Error closing database:', err.message);
    else console.log('✅ Database connection closed');
    process.exit(0);
  });
});