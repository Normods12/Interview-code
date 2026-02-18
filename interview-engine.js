// ============================================================
// interview-engine.js — Interview State Machine (v3)
// ============================================================
// Full 10-question format: spoken + MCQ + coding
// V3: Scoring engine + anti-AI detection
// ============================================================

const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const ai = require('./ai');
const database = require('./database');
const scoring = require('./scoring');

// Ensure transcripts dir exists
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
    MCQ: 'MCQ',
    MCQ_JUSTIFY: 'MCQ_JUSTIFY',
    CODING: 'CODING',
    CODING_INTERRUPT: 'CODING_INTERRUPT',
    COMPLETED: 'COMPLETED',
};

// ─── V2 CONFIG ──────────────────────────────────────────────
// Interview structure: 10 slots total
// Positions: 1=warmup, 2-3=spoken, 4=MCQ, 5-6=spoken, 7=MCQ, 8=spoken, 9=coding, 10=coding
const V2_CONFIG = {
    totalSlots: 10,
    maxFollowUps: 2,
    slotTypes: [
        'spoken',   // 1 - warmup
        'spoken',   // 2
        'spoken',   // 3
        'mcq',      // 4
        'spoken',   // 5
        'spoken',   // 6
        'mcq',      // 7
        'spoken',   // 8
        'coding',   // 9
        'spoken',   // 10 - final
    ],
    difficulties: [
        'easy',     // 1
        'easy',     // 2
        'medium',   // 3
        'medium',   // 4 - MCQ
        'medium',   // 5
        'medium',   // 6
        'hard',     // 7 - MCQ
        'hard',     // 8
        'medium',   // 9 - coding
        'hard',     // 10
    ],
};

// ─── ACTIVE SESSIONS ───────────────────────────────────────
const sessions = new Map();

// ─── CREATE SESSION ─────────────────────────────────────────
function createSession(role, candidateName, difficulty = 'medium') {
    const id = uuidv4();
    const session = {
        id,
        role,
        candidateName,
        difficulty,
        state: STATES.CREATED,
        currentSlotIndex: 0,
        currentFollowUpDepth: 0,
        coveredTopics: [],
        slots: [],
        startTime: Date.now(),
        endTime: null,
        // MCQ state
        currentMCQ: null,
        mcqJustifyPhase: null, // 'why_chose' or 'why_not'
        // Coding state
        currentCoding: null,
        codingInterrupted: false,
    };

    sessions.set(id, session);
    database.createInterview(id, candidateName, role, session.startTime);

    return { id, role, candidateName, state: session.state };
}

// ─── START INTERVIEW ────────────────────────────────────────
async function startInterview(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    if (session.state !== STATES.CREATED) throw new Error('Interview already started');

    session.state = STATES.WARMUP;
    session.currentSlotIndex = 0;

    const question = await ai.generateQuestion(
        session.role, 1, session.difficulty, session.coveredTopics
    );

    const slot = {
        index: 0,
        type: 'spoken',
        question,
        answer: null,
        evaluation: null,
        followUps: [],
        timestamp: Date.now(),
    };
    session.slots.push(slot);

    // Save to DB
    database.stmts.insertQuestion.run(
        sessionId, 1, 'spoken', session.difficulty, question, Date.now()
    );

    return {
        question,
        questionNumber: 1,
        totalQuestions: V2_CONFIG.totalSlots,
        state: session.state,
        type: 'spoken',
        slotType: 'spoken',
    };
}

// ─── SUBMIT SPOKEN ANSWER ───────────────────────────────────
async function submitAnswer(sessionId, answer) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    if (session.state === STATES.COMPLETED) throw new Error('Interview already completed');

    const slotIndex = session.currentSlotIndex;
    const currentSlot = session.slots[slotIndex];
    const answerTimestamp = Date.now();

    // Handle follow-up answers vs main answers
    if (session.currentFollowUpDepth > 0) {
        const fuIndex = session.currentFollowUpDepth - 1;
        currentSlot.followUps[fuIndex].answer = answer;
        currentSlot.followUps[fuIndex].answerTimestamp = answerTimestamp;

        const evaluation = await ai.evaluateAnswer(
            currentSlot.followUps[fuIndex].question, answer, session.difficulty
        );
        currentSlot.followUps[fuIndex].evaluation = evaluation;

        // Update DB
        const fuRow = database.stmts.getLastFollowUp.get(sessionId, currentSlot.dbId);
        if (fuRow) {
            database.stmts.updateFollowUpAnswer.run(
                answer, evaluation.answer_quality, evaluation.confidence,
                evaluation.clarity, evaluation.brief_feedback,
                answerTimestamp, answerTimestamp - currentSlot.followUps[fuIndex].timestamp,
                fuRow.id
            );
        }
    } else {
        currentSlot.answer = answer;
        currentSlot.answerTimestamp = answerTimestamp;

        const evaluation = await ai.evaluateAnswer(currentSlot.question, answer, session.difficulty);
        currentSlot.evaluation = evaluation;

        // Extract topic
        if (evaluation.concept_coverage && evaluation.concept_coverage.length > 0) {
            session.coveredTopics.push(...evaluation.concept_coverage);
        }

        // Update DB
        database.stmts.updateQuestionAnswer.run(
            answer, evaluation.answer_quality,
            JSON.stringify(evaluation.concept_coverage || []),
            evaluation.confidence, evaluation.clarity, evaluation.brief_feedback,
            answerTimestamp, answerTimestamp - currentSlot.timestamp,
            sessionId, slotIndex + 1
        );
    }

    // ─── IDK DETECTION ──────────────────────────────────────
    const isIdkAnswer = detectDontKnow(answer);
    const lastQuality = getLastEvalQuality(currentSlot, session.currentFollowUpDepth);
    const shouldSkipFollowUps = isIdkAnswer || lastQuality <= 2;

    // ─── SHOULD WE DO FOLLOW-UPS? ──────────────────────────
    if (session.currentFollowUpDepth < V2_CONFIG.maxFollowUps && !shouldSkipFollowUps) {
        session.currentFollowUpDepth++;
        session.state = STATES.FOLLOW_UP;

        const followUpQuestion = await ai.generateFollowUp(
            currentSlot.question, answer, session.currentFollowUpDepth
        );

        currentSlot.followUps.push({
            question: followUpQuestion,
            answer: null,
            evaluation: null,
            depth: session.currentFollowUpDepth,
            timestamp: Date.now(),
        });

        // Save to DB
        if (currentSlot.dbId) {
            database.stmts.insertFollowUp.run(
                sessionId, currentSlot.dbId, session.currentFollowUpDepth,
                followUpQuestion, Date.now()
            );
        }

        return {
            question: followUpQuestion,
            questionNumber: slotIndex + 1,
            totalQuestions: V2_CONFIG.totalSlots,
            isFollowUp: true,
            followUpDepth: session.currentFollowUpDepth,
            state: session.state,
            type: 'spoken',
            slotType: 'spoken',
        };
    }

    // ─── MOVE TO NEXT SLOT ──────────────────────────────────
    return await advanceToNextSlot(session);
}

// ─── SUBMIT MCQ ANSWER ──────────────────────────────────────
async function submitMCQAnswer(sessionId, selectedOption, selectionTimeMs) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    if (session.state !== STATES.MCQ) throw new Error('Not in MCQ state');

    const mcq = session.currentMCQ;
    mcq.selectedOption = selectedOption;
    mcq.selectionTimeMs = selectionTimeMs;

    // Save to DB
    database.stmts.updateMcqAnswer.run(
        selectedOption, selectionTimeMs, Date.now(),
        sessionId, session.currentSlotIndex + 1
    );

    // Generate "why did you choose this?" follow-up
    session.state = STATES.MCQ_JUSTIFY;
    session.mcqJustifyPhase = 'why_chose';

    const followUp = await ai.generateMCQFollowUp(
        mcq.question, selectedOption, mcq.correct
    );

    mcq.justifyQuestion = followUp;

    return {
        question: followUp,
        questionNumber: session.currentSlotIndex + 1,
        totalQuestions: V2_CONFIG.totalSlots,
        state: session.state,
        type: 'mcq_justify',
        slotType: 'mcq',
        mcqResult: {
            selected: selectedOption,
            correct: mcq.correct,
            isCorrect: selectedOption.charAt(0) === mcq.correct,
        },
    };
}

// ─── SUBMIT MCQ JUSTIFICATION ───────────────────────────────
async function submitMCQJustification(sessionId, justification) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    if (session.state !== STATES.MCQ_JUSTIFY) throw new Error('Not in MCQ justify state');

    const mcq = session.currentMCQ;
    const evaluation = await ai.evaluateAnswer(mcq.justifyQuestion, justification, session.difficulty);

    // Save to DB
    database.stmts.updateMcqJustification.run(
        justification, evaluation.answer_quality,
        null, null,
        sessionId, session.currentSlotIndex + 1
    );

    // Store in slot
    const slot = session.slots[session.currentSlotIndex];
    slot.mcqJustification = justification;
    slot.mcqJustificationEval = evaluation;

    return await advanceToNextSlot(session);
}

// ─── SUBMIT CODE ────────────────────────────────────────────
async function submitCode(sessionId, code, explanation, behaviorData) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    const coding = session.currentCoding;
    const slot = session.slots[session.currentSlotIndex];

    // Evaluate
    const evaluation = await ai.evaluateCodingAnswer(coding.problem, code, explanation, session.difficulty);

    slot.code = code;
    slot.explanation = explanation;
    slot.codingEval = evaluation;
    slot.behaviorData = behaviorData;

    // Save to DB
    database.stmts.updateCodingSubmission.run(
        code, 'javascript', explanation,
        evaluation.explanation_alignment,
        evaluation.logic_understanding,
        behaviorData?.pasteEvents || 0,
        behaviorData?.timeToFirstKeystroke || null,
        behaviorData?.totalTimeMs || null,
        JSON.stringify(behaviorData?.editPattern || []),
        JSON.stringify(slot.interruptionResponses || []),
        Date.now(),
        sessionId, session.currentSlotIndex + 1
    );

    return await advanceToNextSlot(session);
}

// ─── CODING INTERRUPTION RESPONSE ───────────────────────────
async function submitInterruptionResponse(sessionId, response) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    const slot = session.slots[session.currentSlotIndex];
    if (!slot.interruptionResponses) slot.interruptionResponses = [];
    slot.interruptionResponses.push({
        question: slot.interruptionQuestion,
        answer: response,
        timestamp: Date.now(),
    });

    session.codingInterrupted = true;
    session.state = STATES.CODING;

    return {
        state: STATES.CODING,
        type: 'coding_resume',
        message: 'Continue coding...',
    };
}

// ─── ADVANCE TO NEXT SLOT ───────────────────────────────────
async function advanceToNextSlot(session) {
    session.currentFollowUpDepth = 0;
    session.currentSlotIndex++;

    if (session.currentSlotIndex >= V2_CONFIG.totalSlots) {
        return completeInterview(session);
    }

    const slotIndex = session.currentSlotIndex;
    const slotType = V2_CONFIG.slotTypes[slotIndex];
    // Use session difficulty preference instead of hardcoded config
    const difficulty = session.difficulty || 'medium';

    if (slotType === 'mcq') {
        return await generateMCQSlot(session, difficulty);
    } else if (slotType === 'coding') {
        return await generateCodingSlot(session, difficulty);
    } else {
        return await generateSpokenSlot(session, slotIndex, difficulty);
    }
}

// ─── GENERATE SLOTS ─────────────────────────────────────────

async function generateSpokenSlot(session, slotIndex, difficulty) {
    session.state = slotIndex === 0 ? STATES.WARMUP : STATES.CORE_QUESTION;

    const question = await ai.generateQuestion(
        session.role, slotIndex + 1, difficulty, session.coveredTopics
    );

    const slot = {
        index: slotIndex,
        type: 'spoken',
        question,
        answer: null,
        evaluation: null,
        followUps: [],
        timestamp: Date.now(),
    };
    session.slots.push(slot);

    // Save to DB and capture the row ID
    const result = database.stmts.insertQuestion.run(
        session.id, slotIndex + 1, 'spoken', difficulty, question, Date.now()
    );
    slot.dbId = result.lastInsertRowid;

    return {
        question,
        questionNumber: slotIndex + 1,
        totalQuestions: V2_CONFIG.totalSlots,
        isFollowUp: false,
        state: session.state,
        type: 'spoken',
        slotType: 'spoken',
    };
}

async function generateMCQSlot(session, difficulty) {
    session.state = STATES.MCQ;

    const mcq = await ai.generateMCQ(session.role, difficulty, session.coveredTopics);
    session.currentMCQ = mcq;

    if (mcq.topic) session.coveredTopics.push(mcq.topic);

    const slot = {
        index: session.currentSlotIndex,
        type: 'mcq',
        question: mcq.question,
        options: mcq.options,
        correct: mcq.correct,
        timestamp: Date.now(),
    };
    session.slots.push(slot);

    // Save to DB
    database.stmts.insertMcq.run(
        session.id, session.currentSlotIndex + 1,
        mcq.question, JSON.stringify(mcq.options), Date.now()
    );

    return {
        question: mcq.question,
        options: mcq.options,
        questionNumber: session.currentSlotIndex + 1,
        totalQuestions: V2_CONFIG.totalSlots,
        state: session.state,
        type: 'mcq',
        slotType: 'mcq',
    };
}

async function generateCodingSlot(session, difficulty) {
    session.state = STATES.CODING;
    session.codingInterrupted = false;

    const coding = await ai.generateCodingQuestion(session.role, difficulty);
    session.currentCoding = coding;

    if (coding.topic) session.coveredTopics.push(coding.topic);

    const slot = {
        index: session.currentSlotIndex,
        type: 'coding',
        problem: coding.problem,
        exampleInput: coding.example_input,
        exampleOutput: coding.example_output,
        timestamp: Date.now(),
    };
    session.slots.push(slot);

    // Save to DB
    database.stmts.insertCoding.run(
        session.id, session.currentSlotIndex + 1, coding.problem, Date.now()
    );

    return {
        problem: coding.problem,
        exampleInput: coding.example_input,
        exampleOutput: coding.example_output,
        questionNumber: session.currentSlotIndex + 1,
        totalQuestions: V2_CONFIG.totalSlots,
        state: session.state,
        type: 'coding',
        slotType: 'coding',
    };
}

// ─── GENERATE CODING INTERRUPTION ───────────────────────────
async function triggerCodingInterruption(sessionId, currentCode) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    if (session.codingInterrupted) return null; // Only interrupt once

    const slot = session.slots[session.currentSlotIndex];
    const question = await ai.generateCodingInterruption(
        currentCode, session.currentCoding.problem
    );

    slot.interruptionQuestion = question;
    session.state = STATES.CODING_INTERRUPT;

    return {
        question,
        state: STATES.CODING_INTERRUPT,
        type: 'coding_interrupt',
    };
}

// ─── COMPLETE INTERVIEW ─────────────────────────────────────
function completeInterview(session) {
    session.state = STATES.COMPLETED;
    session.endTime = Date.now();
    const duration = session.endTime - session.startTime;

    database.completeInterview(session.id, session.endTime, duration);
    // V3: Compute score and risk flags
    const scoreResult = scoring.computeScore(session);
    session.score = scoreResult;

    saveTranscript(session);

    return {
        state: STATES.COMPLETED,
        message: 'Interview completed. Thank you!',
        summary: buildSummary(session),
        score: scoreResult,
    };
}

// ─── TRANSCRIPT & HELPERS ───────────────────────────────────

function getTranscript(sessionId) {
    const session = sessions.get(sessionId);
    if (session) return buildTranscript(session);

    // Try from DB
    const dbTranscript = database.getFullTranscript(sessionId);
    if (dbTranscript) return dbTranscript;

    // Try from disk
    const filePath = path.join(TRANSCRIPTS_DIR, `${sessionId}.json`);
    if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }

    throw new Error('Session not found');
}

function getSession(sessionId) {
    return sessions.get(sessionId) || null;
}

// ─── DETECT "I DON'T KNOW" ─────────────────────────────────
function detectDontKnow(answer) {
    const normalized = answer.toLowerCase().trim().replace(/[^a-z\s]/g, '');
    const idkPhrases = [
        'i dont know', 'i do not know', 'idk', 'no idea',
        'not sure', 'im not sure', 'i am not sure',
        'i have no idea', 'no clue', 'cant answer',
        'skip', 'pass', 'dont remember', 'i forgot',
    ];
    if (normalized.length < 30) {
        return idkPhrases.some(phrase => normalized.includes(phrase));
    }
    return false;
}

function getLastEvalQuality(slot, followUpDepth) {
    if (followUpDepth > 0) {
        const lastFu = slot.followUps[followUpDepth - 1];
        return lastFu?.evaluation?.answer_quality ?? 5;
    }
    return slot.evaluation?.answer_quality ?? 5;
}

// ─── BUILD TRANSCRIPT ───────────────────────────────────────
function buildTranscript(session) {
    return {
        id: session.id,
        role: session.role,
        candidateName: session.candidateName,
        startTime: session.startTime,
        endTime: session.endTime,
        state: session.state,
        duration: session.endTime ? session.endTime - session.startTime : null,
        slots: session.slots.map((slot, i) => ({
            questionNumber: i + 1,
            type: slot.type,
            question: slot.question || slot.problem,
            answer: slot.answer,
            evaluation: slot.evaluation,
            // Spoken follow-ups
            followUps: (slot.followUps || []).map(fu => ({
                question: fu.question,
                answer: fu.answer,
                evaluation: fu.evaluation,
                depth: fu.depth,
            })),
            // MCQ data
            options: slot.options,
            correct: slot.correct,
            selectedOption: slot.selectedOption,
            mcqJustification: slot.mcqJustification,
            mcqJustificationEval: slot.mcqJustificationEval,
            // Coding data
            code: slot.code,
            explanation: slot.explanation,
            codingEval: slot.codingEval,
            exampleInput: slot.exampleInput,
            exampleOutput: slot.exampleOutput,
            interruptionResponses: slot.interruptionResponses,
            behaviorData: slot.behaviorData,
        })),
        analysis: session.score,
    };
}

function buildSummary(session) {
    const transcript = buildTranscript(session);

    let totalQuality = 0;
    let qualityCount = 0;

    transcript.slots.forEach(slot => {
        if (slot.evaluation?.answer_quality != null) {
            totalQuality += slot.evaluation.answer_quality;
            qualityCount++;
        }
        (slot.followUps || []).forEach(fu => {
            if (fu.evaluation?.answer_quality != null) {
                totalQuality += fu.evaluation.answer_quality;
                qualityCount++;
            }
        });
        if (slot.mcqJustificationEval?.answer_quality != null) {
            totalQuality += slot.mcqJustificationEval.answer_quality;
            qualityCount++;
        }
        if (slot.codingEval?.code_quality != null) {
            totalQuality += slot.codingEval.code_quality;
            qualityCount++;
        }
    });

    const avgQuality = qualityCount > 0 ? Math.round((totalQuality / qualityCount) * 10) / 10 : 0;
    const duration = transcript.duration;
    const spokenCount = transcript.slots.filter(s => s.type === 'spoken').length;
    const mcqCount = transcript.slots.filter(s => s.type === 'mcq').length;
    const codingCount = transcript.slots.filter(s => s.type === 'coding').length;

    return {
        totalQuestions: transcript.slots.length,
        spokenQuestions: spokenCount,
        mcqQuestions: mcqCount,
        codingQuestions: codingCount,
        averageQuality: avgQuality,
        duration,
        durationFormatted: duration
            ? `${Math.floor(duration / 60000)}m ${Math.floor((duration % 60000) / 1000)}s`
            : 'N/A',
    };
}

function saveTranscript(session) {
    const transcript = buildTranscript(session);
    const filePath = path.join(TRANSCRIPTS_DIR, `${session.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(transcript, null, 2), 'utf-8');
}


// ─── SKIP QUESTION (DEV MODE) ───────────────────────────────
async function skipQuestion(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    // Mark current slot as skipped
    const currentSlot = session.slots[session.slots.length - 1];
    if (currentSlot) {
        currentSlot.skipped = true;
        currentSlot.answer = '[SKIPPED]';
    }

    return await advanceToNextSlot(session);
}

module.exports = {
    createSession,
    startInterview,
    submitAnswer,
    submitMCQAnswer,
    submitMCQJustification,
    submitCode,
    submitInterruptionResponse,
    triggerCodingInterruption,
    skipQuestion,
    getTranscript,
    getSession,
    STATES,
};
