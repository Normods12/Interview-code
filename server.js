// ============================================================
// server.js — Express Backend (Interview AI Platform v2)
// ============================================================
// V2: Added MCQ, coding, behavior signal, and speech endpoints
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
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── INTERVIEW LIFECYCLE ────────────────────────────────────

app.post('/api/interview/start', async (req, res) => {
    try {
        const { role, candidateName } = req.body;
        if (!role || !candidateName) {
            return res.status(400).json({ error: 'role and candidateName are required' });
        }

        const session = engine.createSession(role, candidateName);
        const firstQuestion = await engine.startInterview(session.id);

        res.json({ sessionId: session.id, ...firstQuestion });
    } catch (err) {
        console.error('Error starting interview:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── SPOKEN ANSWER ──────────────────────────────────────────

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

// ─── MCQ ANSWER ─────────────────────────────────────────────

app.post('/api/interview/mcq-answer', async (req, res) => {
    try {
        const { sessionId, selectedOption, selectionTimeMs } = req.body;
        if (!sessionId || !selectedOption) {
            return res.status(400).json({ error: 'sessionId and selectedOption are required' });
        }

        const result = await engine.submitMCQAnswer(sessionId, selectedOption, selectionTimeMs || 0);
        res.json(result);
    } catch (err) {
        console.error('Error submitting MCQ:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── MCQ JUSTIFICATION ─────────────────────────────────────

app.post('/api/interview/mcq-justify', async (req, res) => {
    try {
        const { sessionId, justification } = req.body;
        if (!sessionId || !justification) {
            return res.status(400).json({ error: 'sessionId and justification are required' });
        }

        const result = await engine.submitMCQJustification(sessionId, justification);
        res.json(result);
    } catch (err) {
        console.error('Error submitting MCQ justification:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── CODE SUBMISSION ────────────────────────────────────────

app.post('/api/interview/code-submit', async (req, res) => {
    try {
        const { sessionId, code, explanation, behaviorData } = req.body;
        if (!sessionId || !code) {
            return res.status(400).json({ error: 'sessionId and code are required' });
        }

        const result = await engine.submitCode(sessionId, code, explanation || '', behaviorData || {});
        res.json(result);
    } catch (err) {
        console.error('Error submitting code:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── CODING INTERRUPTION ───────────────────────────────────

app.post('/api/interview/coding-interrupt', async (req, res) => {
    try {
        const { sessionId, currentCode } = req.body;
        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }

        const result = await engine.triggerCodingInterruption(sessionId, currentCode || '');
        if (!result) {
            return res.json({ interrupted: false });
        }
        res.json(result);
    } catch (err) {
        console.error('Error triggering interruption:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── INTERRUPTION RESPONSE ─────────────────────────────────

app.post('/api/interview/interrupt-response', async (req, res) => {
    try {
        const { sessionId, response } = req.body;
        if (!sessionId || !response) {
            return res.status(400).json({ error: 'sessionId and response are required' });
        }

        const result = await engine.submitInterruptionResponse(sessionId, response);
        res.json(result);
    } catch (err) {
        console.error('Error submitting interrupt response:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── BEHAVIOR SIGNALS ──────────────────────────────────────

app.post('/api/interview/signal', (req, res) => {
    try {
        const { sessionId, signalType, signalData } = req.body;
        if (!sessionId || !signalType) {
            return res.status(400).json({ error: 'sessionId and signalType are required' });
        }

        const database = require('./database');
        database.addBehaviorSignal(sessionId, signalType, signalData || {});
        res.json({ ok: true });
    } catch (err) {
        console.error('Error recording signal:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── SKIP (DEV MODE) ───────────────────────────────────────

app.post('/api/interview/skip', async (req, res) => {
    try {
        const { sessionId } = req.body;
        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }

        const result = await engine.skipQuestion(sessionId);
        res.json(result);
    } catch (err) {
        console.error('Error skipping question:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── TRANSCRIPT ─────────────────────────────────────────────

app.get('/api/interview/:id/transcript', (req, res) => {
    try {
        const transcript = engine.getTranscript(req.params.id);
        res.json(transcript);
    } catch (err) {
        console.error('Error getting transcript:', err);
        res.status(404).json({ error: err.message });
    }
});

// ─── HEALTH ─────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', version: '2.0.0', timestamp: new Date().toISOString() });
});

// ─── FALLBACK ───────────────────────────────────────────────
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── START ──────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n🚀 Interview AI Platform v2`);
    console.log(`   Server running at http://localhost:${PORT}`);
    console.log(`   Features: Spoken + MCQ + Coding + Speech`);
    console.log(`   API: http://localhost:${PORT}/api/health\n`);
});
