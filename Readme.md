const fs = require('fs');

const content = `# Meeting Summarizer - Batch 2026

An AI-powered meeting transcription and summarization tool that converts audio recordings into actionable insights.

## 🎯 Features

- **Audio Transcription**: Automatic speech-to-text using Whisper AI
- **Smart Summarization**: Key decisions and discussion points extraction
- **Action Items**: Automatic identification of tasks and follow-ups
- **Local Processing**: Runs completely offline with no API costs
- **Beautiful UI**: Modern React interface with Tailwind CSS

## 🛠️ Tech Stack

**Frontend:**
- React
- Tailwind CSS
- Lucide React (icons)

**Backend:**
- Node.js + Express
- Transformers.js (Whisper model)
- Ollama (LLM for summarization)
- Multer (file uploads)

## 📋 Prerequisites

1. **Node.js** (v18 or higher)
2. **Ollama** - Download from [https://ollama.ai](https://ollama.ai)

## 🚀 Installation

### Step 1: Clone the Repository
\`\`\`bash
git clone <your-repo-url>
cd meeting-summarizer
\`\`\`

### Step 2: Install Backend Dependencies
\`\`\`bash
cd backend
npm install
\`\`\`

### Step 3: Install Frontend Dependencies
\`\`\`bash
cd ../frontend
npm install
\`\`\`

### Step 4: Install Ollama and Model
\`\`\`bash
# Install Ollama from https://ollama.ai
# Then pull the model:
ollama pull llama3.2
\`\`\`

## 📦 Package Installation

### Backend package.json
Create \`backend/package.json\`:
\`\`\`json
{
  "name": "meeting-summarizer-backend",
  "version": "1.0.0",
  "description": "Meeting audio transcription and summarization backend",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "multer": "^1.4.5-lts.1",
    "cors": "^2.8.5",
    "@xenova/transformers": "^2.17.1"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  }
}
\`\`\`

### Frontend package.json
Create \`frontend/package.json\`:
\`\`\`json
{
  "name": "meeting-summarizer-frontend",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "lucide-react": "^0.263.1"
  },
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build"
  },
  "devDependencies": {
    "react-scripts": "5.0.1",
    "tailwindcss": "^3.3.0"
  }
}
\`\`\`

## 🏃 Running the Application

### Terminal 1 - Start Ollama
\`\`\`bash
ollama serve
\`\`\`

### Terminal 2 - Start Backend
\`\`\`bash
cd backend
npm start
\`\`\`
Backend runs on: \`http://localhost:3001\`

### Terminal 3 - Start Frontend
\`\`\`bash
cd frontend
npm start
\`\`\`
Frontend runs on: \`http://localhost:3000\`

## 📁 Project Structure

\`\`\`
meeting-summarizer/
├── backend/
│   ├── server.js
│   ├── package.json
│   ├── uploads/
│   └── .gitignore
├── frontend/
│   ├── src/
│   │   ├── App.js
│   │   ├── index.js
│   │   └── index.css
│   ├── public/
│   ├── package.json
│   └── tailwind.config.js
├── README.md
└── .gitignore
\`\`\`

## 🎬 Usage

1. **Start all services** (Ollama, Backend, Frontend)
2. **Open browser** to \`http://localhost:3000\`
3. **Upload audio file**
4. **Click "Process Meeting"**
5. **View results**: Transcript, Summary, and Action Items

## 🧪 Testing

### Sample Audio Files
- MP3, WAV, M4A, WEBM

### Expected Output
- **Transcript**: Full meeting transcript
- **Summary**: Key decisions and discussion points
- **Action Items**: List of tasks identified

## 🔧 Configuration

### Change LLM Model
Edit \`server.js\`:
\`\`\`javascript
model: 'llama3.2'
\`\`\`

### Adjust Response Temperature
\`\`\`javascript
options: {
  temperature: 0.3,
  top_p: 0.9
}
\`\`\`

### File Size Limit
\`\`\`javascript
limits: { fileSize: 50 * 1024 * 1024 }
\`\`\`

## 📊 LLM Prompt Engineering

### Summary Prompt
\`\`\`
Analyze this meeting transcript and provide:
1. Key Decisions Made
2. Important Discussion Points
3. Overall meeting outcome
\`\`\`

### Action Items Prompt
\`\`\`
Extract all action items from this meeting transcript.
List each action item as a clear, concise task.
Format each item on a new line starting with a dash (-).
\`\`\`

## 🐛 Troubleshooting

- Ensure Ollama is running: \`ollama serve\`
- Check model installed: \`ollama list\`
- Pull model if missing: \`ollama pull llama3.2\`
- First run may take time to download Whisper model
- Check audio file format
- Ensure sufficient disk space
- Verify backend API URL matches frontend

## 🎯 Evaluation Criteria

✅ **Transcription Accuracy**  
✅ **Summary Quality**  
✅ **Code Structure**  
✅ **LLM Effectiveness**  

## 📝 API Documentation

### POST /api/transcribe
**Request:** multipart/form-data (audio file)

**Response:**
\`\`\`json
{
  "transcript": "Full meeting transcript...",
  "summary": "Key decisions and points...",
  "actionItems": [
    "Task 1...",
    "Task 2..."
  ],
  "metadata": {
    "filename": "meeting.mp3",
    "processedAt": "2025-10-14T10:30:00.000Z"
  }
}
\`\`\`

### GET /api/health
\`\`\`json
{
  "status": "ok",
  "whisper": "loaded",
  "timestamp": "2025-10-14T10:30:00.000Z"
}
\`\`\`

## 🎓 Batch 2026 Project

**Author**: [Your Name]  
**Batch**: 2026  
**Date**: October 2025

## 📄 License

MIT License

**Built with ❤️ by Koushil**

