// ============================================================
// server.js — Express Backend (Interview AI Platform v1)
// ============================================================
// REST API server. Serves frontend + handles interview logic.
// Backend is the judge — AI is just a witness.
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const engine = require('./interview-engine');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── MIDDLEWARE ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── API ROUTES ─────────────────────────────────────────────

/**
 * POST /api/interview/start
 * Body: { role: string, candidateName: string }
 * Creates a new interview session
 */
app.post('/api/interview/start', async (req, res) => {
    try {
        const { role, candidateName } = req.body;

        if (!role || !candidateName) {
            return res.status(400).json({ error: 'role and candidateName are required' });
        }

        const session = engine.createSession(role, candidateName);
        const firstQuestion = await engine.startInterview(session.id);

        res.json({
            sessionId: session.id,
            ...firstQuestion,
        });
    } catch (err) {
        console.error('Error starting interview:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/interview/answer
 * Body: { sessionId: string, answer: string }
 * Submits an answer, returns follow-up or next question
 */
app.post('/api/interview/answer', async (req, res) => {
    try {
        const { sessionId, answer } = req.body;

        if (!sessionId || !answer) {
            return res.status(400).json({ error: 'sessionId and answer are required' });
        }

        const result = await engine.submitAnswer(sessionId, answer);
        res.json(result);
    } catch (err) {
        console.error('Error submitting answer:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/interview/:id/transcript
 * Returns the full interview transcript
 */
app.get('/api/interview/:id/transcript', (req, res) => {
    try {
        const transcript = engine.getTranscript(req.params.id);
        res.json(transcript);
    } catch (err) {
        console.error('Error getting transcript:', err);
        res.status(404).json({ error: err.message });
    }
});

/**
 * GET /api/health
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

// ─── FALLBACK: SERVE FRONTEND ───────────────────────────────
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── START SERVER ───────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n🚀 Interview AI Platform v1`);
    console.log(`   Server running at http://localhost:${PORT}`);
    console.log(`   API: http://localhost:${PORT}/api/health\n`);
});
