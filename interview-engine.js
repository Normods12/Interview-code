// ============================================================
// interview-engine.js — Interview State Machine (v1)
// ============================================================
// Manages the interview flow: questions, follow-ups, transitions.
// Backend is the judge — AI is just a witness.
// ============================================================

const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const ai = require('./ai');

// Ensure data directory exists
const TRANSCRIPTS_DIR = path.join(__dirname, 'data', 'transcripts');
if (!fs.existsSync(TRANSCRIPTS_DIR)) {
    fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
}

// ─── INTERVIEW STATES ───────────────────────────────────────
const STATES = {
    CREATED: 'CREATED',
    WARMUP: 'WARMUP',
    CORE_QUESTION: 'CORE_QUESTION',
    FOLLOW_UP: 'FOLLOW_UP',
    COMPLETED: 'COMPLETED',
};

// ─── V1 CONFIG ──────────────────────────────────────────────
const V1_CONFIG = {
    totalQuestions: 3,         // 1 warmup + 2 core
    maxFollowUps: 2,           // per question
    difficulties: ['easy', 'medium', 'medium'],
};

// ─── ACTIVE SESSIONS ───────────────────────────────────────
const sessions = new Map();

/**
 * Create a new interview session
 * @param {string} role - e.g. "Java Backend Developer"
 * @param {string} candidateName - Name of the student
 * @returns {Object} Session info
 */
function createSession(role, candidateName) {
    const id = uuidv4();
    const session = {
        id,
        role,
        candidateName,
        state: STATES.CREATED,
        currentQuestionIndex: 0,
        currentFollowUpDepth: 0,
        questions: [],           // { question, answer, evaluation, followUps: [{question, answer, evaluation}] }
        currentQuestion: null,
        startTime: Date.now(),
        endTime: null,
    };

    sessions.set(id, session);
    return { id, role, candidateName, state: session.state };
}

/**
 * Start the interview — generates the first question
 * @param {string} sessionId
 * @returns {Object} { question, questionNumber, state }
 */
async function startInterview(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    if (session.state !== STATES.CREATED) throw new Error('Interview already started');

    session.state = STATES.WARMUP;
    session.currentQuestionIndex = 0;

    const question = await ai.generateQuestion(
        session.role,
        1,
        V1_CONFIG.difficulties[0]
    );

    session.currentQuestion = question;
    session.questions.push({
        question,
        answer: null,
        evaluation: null,
        followUps: [],
        timestamp: Date.now(),
    });

    return {
        question,
        questionNumber: 1,
        totalQuestions: V1_CONFIG.totalQuestions,
        state: session.state,
        type: 'spoken',
    };
}

/**
 * Submit an answer and get the next action (follow-up or next question)
 * @param {string} sessionId
 * @param {string} answer - The candidate's answer
 * @returns {Object} Next question/follow-up or completion
 */
async function submitAnswer(sessionId, answer) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    if (session.state === STATES.COMPLETED) throw new Error('Interview already completed');

    const qIndex = session.currentQuestionIndex;
    const currentQ = session.questions[qIndex];
    const answerTimestamp = Date.now();

    // Are we answering a follow-up or the main question?
    if (session.currentFollowUpDepth > 0) {
        // Answering a follow-up
        const fuIndex = session.currentFollowUpDepth - 1;
        currentQ.followUps[fuIndex].answer = answer;
        currentQ.followUps[fuIndex].answerTimestamp = answerTimestamp;

        // Evaluate follow-up answer
        const evaluation = await ai.evaluateAnswer(
            currentQ.followUps[fuIndex].question,
            answer
        );
        currentQ.followUps[fuIndex].evaluation = evaluation;
    } else {
        // Answering the main question
        currentQ.answer = answer;
        currentQ.answerTimestamp = answerTimestamp;

        // Evaluate main answer
        const evaluation = await ai.evaluateAnswer(currentQ.question, answer);
        currentQ.evaluation = evaluation;
    }

    // ─── CHECK IF CANDIDATE DOESN'T KNOW ────────────────────
    // If answer is "I don't know" or very low quality, skip follow-ups
    // A real interviewer would just move on, not keep pushing
    const isIdkAnswer = detectDontKnow(answer);
    const lastEvalQuality = getLastEvalQuality(currentQ, session.currentFollowUpDepth);
    const shouldSkipFollowUps = isIdkAnswer || lastEvalQuality <= 2;

    // Decide next action: more follow-ups, or next question?
    if (session.currentFollowUpDepth < V1_CONFIG.maxFollowUps && !shouldSkipFollowUps) {
        // Generate a follow-up
        session.currentFollowUpDepth++;
        session.state = STATES.FOLLOW_UP;

        const followUpQuestion = await ai.generateFollowUp(
            currentQ.question,
            answer,
            session.currentFollowUpDepth
        );

        currentQ.followUps.push({
            question: followUpQuestion,
            answer: null,
            evaluation: null,
            depth: session.currentFollowUpDepth,
            timestamp: Date.now(),
        });

        return {
            question: followUpQuestion,
            questionNumber: qIndex + 1,
            totalQuestions: V1_CONFIG.totalQuestions,
            isFollowUp: true,
            followUpDepth: session.currentFollowUpDepth,
            state: session.state,
            type: 'spoken',
            evaluation: session.currentFollowUpDepth > 1
                ? currentQ.followUps[session.currentFollowUpDepth - 2]?.evaluation
                : currentQ.evaluation,
        };
    }

    // Move to next question
    session.currentFollowUpDepth = 0;
    session.currentQuestionIndex++;

    if (session.currentQuestionIndex >= V1_CONFIG.totalQuestions) {
        // Interview complete
        session.state = STATES.COMPLETED;
        session.endTime = Date.now();

        // Save transcript
        saveTranscript(session);

        return {
            state: STATES.COMPLETED,
            message: 'Interview completed. Thank you!',
            summary: buildSummary(session),
        };
    }

    // Generate next question
    const nextQIndex = session.currentQuestionIndex;
    session.state = nextQIndex === 0 ? STATES.WARMUP : STATES.CORE_QUESTION;

    const nextQuestion = await ai.generateQuestion(
        session.role,
        nextQIndex + 1,
        V1_CONFIG.difficulties[nextQIndex]
    );

    session.currentQuestion = nextQuestion;
    session.questions.push({
        question: nextQuestion,
        answer: null,
        evaluation: null,
        followUps: [],
        timestamp: Date.now(),
    });

    return {
        question: nextQuestion,
        questionNumber: nextQIndex + 1,
        totalQuestions: V1_CONFIG.totalQuestions,
        isFollowUp: false,
        state: session.state,
        type: 'spoken',
    };
}

/**
 * Get the full transcript for a session
 */
function getTranscript(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
        // Try loading from disk
        const filePath = path.join(TRANSCRIPTS_DIR, `${sessionId}.json`);
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
        throw new Error('Session not found');
    }
    return buildTranscript(session);
}

/**
 * Get session info
 */
function getSession(sessionId) {
    return sessions.get(sessionId) || null;
}

// ─── HELPER FUNCTIONS ───────────────────────────────────────

/**
 * Detect if the candidate's answer means "I don't know"
 */
function detectDontKnow(answer) {
    const normalized = answer.toLowerCase().trim().replace(/[^a-z\s]/g, '');
    const idkPhrases = [
        'i dont know', 'i do not know', 'idk', 'no idea',
        'not sure', 'im not sure', 'i am not sure',
        'i have no idea', 'no clue', 'cant answer',
        'skip', 'pass', 'dont remember', 'i forgot',
    ];
    // Check if the entire answer is basically "I don't know"
    if (normalized.length < 30) {
        return idkPhrases.some(phrase => normalized.includes(phrase));
    }
    return false;
}

/**
 * Get the quality score from the most recent evaluation
 */
function getLastEvalQuality(currentQ, followUpDepth) {
    if (followUpDepth > 0) {
        const lastFu = currentQ.followUps[followUpDepth - 1];
        return lastFu?.evaluation?.answer_quality ?? 5;
    }
    return currentQ.evaluation?.answer_quality ?? 5;
}


function buildTranscript(session) {
    return {
        id: session.id,
        role: session.role,
        candidateName: session.candidateName,
        startTime: session.startTime,
        endTime: session.endTime,
        state: session.state,
        duration: session.endTime ? session.endTime - session.startTime : null,
        questions: session.questions.map((q, i) => ({
            questionNumber: i + 1,
            question: q.question,
            answer: q.answer,
            evaluation: q.evaluation,
            followUps: q.followUps.map(fu => ({
                question: fu.question,
                answer: fu.answer,
                evaluation: fu.evaluation,
                depth: fu.depth,
            })),
        })),
    };
}

function buildSummary(session) {
    const transcript = buildTranscript(session);
    const avgQuality = transcript.questions.reduce((sum, q) => {
        let total = q.evaluation?.answer_quality || 0;
        let count = 1;
        q.followUps.forEach(fu => {
            total += fu.evaluation?.answer_quality || 0;
            count++;
        });
        return sum + total / count;
    }, 0) / transcript.questions.length;

    return {
        totalQuestions: transcript.questions.length,
        averageQuality: Math.round(avgQuality * 10) / 10,
        duration: transcript.duration,
        durationFormatted: transcript.duration
            ? `${Math.floor(transcript.duration / 60000)}m ${Math.floor((transcript.duration % 60000) / 1000)}s`
            : 'N/A',
    };
}

function saveTranscript(session) {
    const transcript = buildTranscript(session);
    const filePath = path.join(TRANSCRIPTS_DIR, `${session.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(transcript, null, 2), 'utf-8');
}

module.exports = {
    createSession,
    startInterview,
    submitAnswer,
    getTranscript,
    getSession,
    STATES,
};
