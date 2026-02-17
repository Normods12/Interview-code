// ============================================================
// database.js — SQLite Database Layer (Interview AI v2)
// ============================================================
// Persistent storage for interviews, questions, answers, MCQs,
// coding submissions, and behavior signals.
// ============================================================

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'interview.db'));

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');

// ─── SCHEMA ─────────────────────────────────────────────────
db.exec(`
    CREATE TABLE IF NOT EXISTS interviews (
        id TEXT PRIMARY KEY,
        candidate_name TEXT NOT NULL,
        role TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'CREATED',
        start_time INTEGER,
        end_time INTEGER,
        duration_ms INTEGER,
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        interview_id TEXT NOT NULL,
        question_number INTEGER NOT NULL,
        type TEXT NOT NULL DEFAULT 'spoken',
        difficulty TEXT DEFAULT 'medium',
        question_text TEXT NOT NULL,
        answer_text TEXT,
        answer_quality REAL,
        concept_coverage TEXT,
        confidence REAL,
        clarity TEXT,
        brief_feedback TEXT,
        question_timestamp INTEGER,
        answer_timestamp INTEGER,
        time_to_answer_ms INTEGER,
        FOREIGN KEY (interview_id) REFERENCES interviews(id)
    );

    CREATE TABLE IF NOT EXISTS follow_ups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        interview_id TEXT NOT NULL,
        question_id INTEGER NOT NULL,
        depth INTEGER NOT NULL,
        question_text TEXT NOT NULL,
        answer_text TEXT,
        answer_quality REAL,
        confidence REAL,
        clarity TEXT,
        brief_feedback TEXT,
        question_timestamp INTEGER,
        answer_timestamp INTEGER,
        time_to_answer_ms INTEGER,
        FOREIGN KEY (interview_id) REFERENCES interviews(id),
        FOREIGN KEY (question_id) REFERENCES questions(id)
    );

    CREATE TABLE IF NOT EXISTS mcq_responses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        interview_id TEXT NOT NULL,
        question_number INTEGER NOT NULL,
        mcq_question TEXT NOT NULL,
        options TEXT NOT NULL,
        selected_option TEXT,
        correct_option TEXT,
        selection_time_ms INTEGER,
        justification TEXT,
        justification_quality REAL,
        why_not_others TEXT,
        why_not_quality REAL,
        question_timestamp INTEGER,
        answer_timestamp INTEGER,
        FOREIGN KEY (interview_id) REFERENCES interviews(id)
    );

    CREATE TABLE IF NOT EXISTS coding_submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        interview_id TEXT NOT NULL,
        question_number INTEGER NOT NULL,
        problem_text TEXT NOT NULL,
        submitted_code TEXT,
        language TEXT DEFAULT 'javascript',
        explanation TEXT,
        explanation_alignment REAL,
        logic_understanding TEXT,
        paste_events INTEGER DEFAULT 0,
        time_to_first_keystroke_ms INTEGER,
        total_time_ms INTEGER,
        edit_pattern TEXT,
        interruption_responses TEXT,
        question_timestamp INTEGER,
        submit_timestamp INTEGER,
        FOREIGN KEY (interview_id) REFERENCES interviews(id)
    );

    CREATE TABLE IF NOT EXISTS behavior_signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        interview_id TEXT NOT NULL,
        signal_type TEXT NOT NULL,
        signal_data TEXT,
        timestamp INTEGER,
        FOREIGN KEY (interview_id) REFERENCES interviews(id)
    );
`);

// ─── PREPARED STATEMENTS ────────────────────────────────────

const stmts = {
    insertInterview: db.prepare(`
        INSERT INTO interviews (id, candidate_name, role, state, start_time)
        VALUES (?, ?, ?, ?, ?)
    `),
    updateInterviewState: db.prepare(`
        UPDATE interviews SET state = ? WHERE id = ?
    `),
    completeInterview: db.prepare(`
        UPDATE interviews SET state = 'COMPLETED', end_time = ?, duration_ms = ? WHERE id = ?
    `),
    getInterview: db.prepare(`
        SELECT * FROM interviews WHERE id = ?
    `),
    getAllInterviews: db.prepare(`
        SELECT * FROM interviews ORDER BY created_at DESC
    `),

    insertQuestion: db.prepare(`
        INSERT INTO questions (interview_id, question_number, type, difficulty, question_text, question_timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
    `),
    updateQuestionAnswer: db.prepare(`
        UPDATE questions SET answer_text = ?, answer_quality = ?, concept_coverage = ?,
        confidence = ?, clarity = ?, brief_feedback = ?, answer_timestamp = ?, time_to_answer_ms = ?
        WHERE interview_id = ? AND question_number = ?
    `),
    getQuestions: db.prepare(`
        SELECT * FROM questions WHERE interview_id = ? ORDER BY question_number
    `),

    insertFollowUp: db.prepare(`
        INSERT INTO follow_ups (interview_id, question_id, depth, question_text, question_timestamp)
        VALUES (?, ?, ?, ?, ?)
    `),
    updateFollowUpAnswer: db.prepare(`
        UPDATE follow_ups SET answer_text = ?, answer_quality = ?, confidence = ?,
        clarity = ?, brief_feedback = ?, answer_timestamp = ?, time_to_answer_ms = ?
        WHERE id = ?
    `),
    getFollowUps: db.prepare(`
        SELECT * FROM follow_ups WHERE question_id = ? ORDER BY depth
    `),
    getLastFollowUp: db.prepare(`
        SELECT * FROM follow_ups WHERE interview_id = ? AND question_id = ? ORDER BY depth DESC LIMIT 1
    `),

    insertMcq: db.prepare(`
        INSERT INTO mcq_responses (interview_id, question_number, mcq_question, options, question_timestamp)
        VALUES (?, ?, ?, ?, ?)
    `),
    updateMcqAnswer: db.prepare(`
        UPDATE mcq_responses SET selected_option = ?, selection_time_ms = ?, answer_timestamp = ?
        WHERE interview_id = ? AND question_number = ?
    `),
    updateMcqJustification: db.prepare(`
        UPDATE mcq_responses SET justification = ?, justification_quality = ?,
        why_not_others = ?, why_not_quality = ?
        WHERE interview_id = ? AND question_number = ?
    `),
    getMcqs: db.prepare(`
        SELECT * FROM mcq_responses WHERE interview_id = ? ORDER BY question_number
    `),

    insertCoding: db.prepare(`
        INSERT INTO coding_submissions (interview_id, question_number, problem_text, question_timestamp)
        VALUES (?, ?, ?, ?)
    `),
    updateCodingSubmission: db.prepare(`
        UPDATE coding_submissions SET submitted_code = ?, language = ?, explanation = ?,
        explanation_alignment = ?, logic_understanding = ?, paste_events = ?,
        time_to_first_keystroke_ms = ?, total_time_ms = ?, edit_pattern = ?,
        interruption_responses = ?, submit_timestamp = ?
        WHERE interview_id = ? AND question_number = ?
    `),
    getCoding: db.prepare(`
        SELECT * FROM coding_submissions WHERE interview_id = ? ORDER BY question_number
    `),

    insertSignal: db.prepare(`
        INSERT INTO behavior_signals (interview_id, signal_type, signal_data, timestamp)
        VALUES (?, ?, ?, ?)
    `),
    getSignals: db.prepare(`
        SELECT * FROM behavior_signals WHERE interview_id = ? ORDER BY timestamp
    `),
};

// ─── PUBLIC API ─────────────────────────────────────────────
module.exports = {
    db,
    stmts,

    // Convenience wrappers
    createInterview(id, candidateName, role, startTime) {
        stmts.insertInterview.run(id, candidateName, role, 'CREATED', startTime);
    },
    completeInterview(id, endTime, durationMs) {
        stmts.completeInterview.run(endTime, durationMs, id);
    },
    getInterview(id) {
        return stmts.getInterview.get(id);
    },
    getAllInterviews() {
        return stmts.getAllInterviews.all();
    },

    getFullTranscript(id) {
        const interview = stmts.getInterview.get(id);
        if (!interview) return null;

        const questions = stmts.getQuestions.all(id);
        const mcqs = stmts.getMcqs.all(id);
        const coding = stmts.getCoding.all(id);
        const signals = stmts.getSignals.all(id);

        // Attach follow-ups to questions
        for (const q of questions) {
            q.followUps = stmts.getFollowUps.all(q.id);
            if (q.concept_coverage) {
                try { q.concept_coverage = JSON.parse(q.concept_coverage); } catch { }
            }
        }

        return { ...interview, questions, mcqs, coding, signals };
    },

    addBehaviorSignal(interviewId, type, data) {
        stmts.insertSignal.run(interviewId, type, JSON.stringify(data), Date.now());
    },
};
