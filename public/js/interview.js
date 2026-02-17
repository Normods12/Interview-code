// ============================================================
// interview.js — Frontend Interview Logic (v2)
// ============================================================
// Handles spoken, MCQ, and coding flows + speech + paste detect
// ============================================================

const API = 'http://localhost:3000/api';

// ─── STATE ──────────────────────────────────────────────────
let sessionId = null;
let timerInterval = null;
let answerTimerInterval = null;
let mcqTimerInterval = null;
let codingTimerInterval = null;
let answerStartTime = null;
let mcqStartTime = null;
let codingStartTime = null;
let selectedMCQOption = null;

// Speech
let speechEnabled = true;
let micEnabled = false;
let synth = window.speechSynthesis;
let recognition = null;

// Coding behavior tracking
let pasteCount = 0;
let firstKeystrokeTime = null;
let codingStartTimestamp = null;
let interruptTriggered = false;

// ─── BOOT ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    sessionId = params.get('session');

    if (!sessionId) {
        window.location.href = '/';
        return;
    }

    // Setup header
    const name = params.get('name') || 'Candidate';
    const role = params.get('role') || 'Developer';
    document.getElementById('headerTitle').textContent = `${name}'s Interview`;
    document.getElementById('headerRole').textContent = role;

    // Start timer
    const startTime = Date.now();
    timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const s = String(elapsed % 60).padStart(2, '0');
        document.getElementById('timerText').textContent = `${m}:${s}`;
    }, 1000);

    // Setup speech
    setupSpeech();

    // Setup submit handlers
    setupSpokenHandlers();
    setupMCQHandlers();
    setupCodingHandlers();
    setupInterruptHandler();
    setupSkipButton();

    // Start — first question arrives via URL params
    loadFirstQuestion();
});

// ─── SPEECH SETUP ────────────────────────────────────────────
function setupSpeech() {
    const speechBtn = document.getElementById('speechToggle');
    const micBtn = document.getElementById('micToggle');
    const statusEl = document.getElementById('speechStatus');

    // TTS toggle
    speechBtn.addEventListener('click', () => {
        speechEnabled = !speechEnabled;
        speechBtn.textContent = speechEnabled ? '🔊 Voice On' : '🔇 Voice Off';
        speechBtn.classList.toggle('active', speechEnabled);
    });

    // STT setup
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event) => {
            let finalTranscript = '';
            let interimTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }

            // Find the active textarea
            const activeInput = getActiveTextarea();
            if (activeInput && finalTranscript) {
                activeInput.value += (activeInput.value ? ' ' : '') + finalTranscript;
                activeInput.dispatchEvent(new Event('input'));
            }

            if (interimTranscript) {
                statusEl.textContent = `🎙️ "${interimTranscript.slice(-50)}..."`;
            } else if (finalTranscript) {
                statusEl.textContent = '✅ Speech captured';
            }
        };

        recognition.onerror = (e) => {
            if (e.error !== 'no-speech') {
                statusEl.textContent = `⚠️ Mic error: ${e.error}`;
            }
        };

        recognition.onend = () => {
            if (micEnabled) recognition.start(); // auto-restart
        };

        micBtn.addEventListener('click', () => {
            micEnabled = !micEnabled;
            if (micEnabled) {
                recognition.start();
                micBtn.textContent = '🎤 Mic On';
                micBtn.classList.add('active');
                statusEl.textContent = '🎙️ Listening...';
            } else {
                recognition.stop();
                micBtn.textContent = '🎤 Mic Off';
                micBtn.classList.remove('active');
                statusEl.textContent = '';
            }
        });
    } else {
        micBtn.disabled = true;
        micBtn.textContent = '🎤 Not supported';
        statusEl.textContent = 'Speech input not supported in this browser';
    }
}

function getActiveTextarea() {
    if (!document.getElementById('spokenArea').classList.contains('hidden')) {
        return document.getElementById('answerInput');
    }
    if (!document.getElementById('mcqJustifyArea').classList.contains('hidden')) {
        return document.getElementById('mcqJustifyInput');
    }
    if (!document.getElementById('interruptModal').classList.contains('hidden')) {
        return document.getElementById('interruptInput');
    }
    if (!document.getElementById('codingArea').classList.contains('hidden')) {
        return document.getElementById('codeExplanation');
    }
    return null;
}

function speak(text) {
    if (!speechEnabled || !synth) return;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    // Prefer a natural-sounding voice
    const voices = synth.getVoices();
    const preferred = voices.find(v => v.name.includes('Google') && v.lang.startsWith('en'))
        || voices.find(v => v.lang.startsWith('en'));
    if (preferred) utterance.voice = preferred;
    synth.speak(utterance);
}

// ─── LOAD FIRST QUESTION ────────────────────────────────────
async function loadFirstQuestion() {
    try {
        const res = await fetch(`${API}/interview/${sessionId}/transcript`);
        if (!res.ok) throw new Error('Could not load session');

        // The session should already have the first question from the start call.
        // We need to re-fetch by checking the state. Let's just show loading briefly.
        // Actually the first question was returned when session was created on landing page.
        // We stored it in sessionStorage.
        const firstQ = JSON.parse(sessionStorage.getItem('firstQuestion') || 'null');
        if (firstQ) {
            handleResponse(firstQ);
        } else {
            // Fallback: fetch transcript
            const data = await res.json();
            if (data.slots && data.slots.length > 0) {
                const q = data.slots[0];
                handleResponse({
                    question: q.question,
                    questionNumber: 1,
                    totalQuestions: 10,
                    type: q.type || 'spoken',
                    slotType: q.type || 'spoken',
                    state: 'WARMUP',
                });
            }
        }
    } catch (err) {
        console.error('Error loading first question:', err);
    }
}

// ─── RESPONSE ROUTER ────────────────────────────────────────
function handleResponse(data) {
    hideAll();
    document.getElementById('loadingState').classList.add('hidden');

    console.log('[handleResponse]', data.type, data.slotType, data.state, data);

    if (data.state === 'COMPLETED') {
        showCompletion(data);
        return;
    }

    updateProgress(data.questionNumber, data.totalQuestions);

    // IMPORTANT: check specific types BEFORE generic slotType
    if (data.type === 'mcq_justify') {
        showMCQJustify(data);
    } else if (data.type === 'coding_interrupt') {
        showCodingInterrupt(data);
    } else if (data.type === 'coding_resume') {
        showCodingResume();
    } else if (data.type === 'mcq' || data.slotType === 'mcq') {
        showMCQ(data);
    } else if (data.type === 'coding' || data.slotType === 'coding') {
        showCoding(data);
    } else {
        showSpokenQuestion(data);
    }
}

// ─── SHOW SPOKEN QUESTION ───────────────────────────────────
function showSpokenQuestion(data) {
    const area = document.getElementById('spokenArea');
    area.classList.remove('hidden');

    const badge = document.getElementById('questionBadge');
    if (data.isFollowUp) {
        badge.className = 'question-badge follow-up';
        badge.querySelector('span').textContent = `↳ Follow-up (Depth ${data.followUpDepth})`;
    } else {
        badge.className = 'question-badge';
        badge.querySelector('span').textContent = `Question ${data.questionNumber}`;
    }

    document.getElementById('questionText').textContent = data.question;
    document.getElementById('answerInput').value = '';
    document.getElementById('submitBtn').disabled = true;

    // Speak the question
    speak(data.question);

    // Start answer timer
    answerStartTime = Date.now();
    clearInterval(answerTimerInterval);
    answerTimerInterval = setInterval(() => {
        const s = Math.floor((Date.now() - answerStartTime) / 1000);
        document.getElementById('answerTimer').textContent = `Thinking time: ${s}s`;
    }, 1000);

    // Focus input
    setTimeout(() => document.getElementById('answerInput').focus(), 300);
}

// ─── SHOW MCQ ───────────────────────────────────────────────
function showMCQ(data) {
    const area = document.getElementById('mcqArea');
    area.classList.remove('hidden');

    document.getElementById('mcqQuestionText').textContent = data.question;

    const optionsContainer = document.getElementById('mcqOptions');
    optionsContainer.innerHTML = '';
    selectedMCQOption = null;
    document.getElementById('mcqSubmitBtn').disabled = true;

    // Safety check: if options are missing, show error
    const options = data.options || [];
    if (options.length === 0) {
        console.error('[showMCQ] No options received!', data);
        optionsContainer.innerHTML = '<p style="color: var(--danger);">⚠️ Options failed to load. Click Skip to continue.</p>';
        return;
    }

    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'mcq-option';
        btn.textContent = opt;
        btn.addEventListener('click', () => {
            // Deselect others
            optionsContainer.querySelectorAll('.mcq-option').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            selectedMCQOption = opt;
            document.getElementById('mcqSubmitBtn').disabled = false;
        });
        optionsContainer.appendChild(btn);
    });

    // Speak the question
    speak(data.question);

    // Timer
    mcqStartTime = Date.now();
    clearInterval(mcqTimerInterval);
    mcqTimerInterval = setInterval(() => {
        const s = Math.floor((Date.now() - mcqStartTime) / 1000);
        document.getElementById('mcqTimer').textContent = `Time: ${s}s`;
    }, 1000);
}

// ─── SHOW MCQ JUSTIFY ───────────────────────────────────────
function showMCQJustify(data) {
    const area = document.getElementById('mcqJustifyArea');
    area.classList.remove('hidden');

    document.getElementById('mcqJustifyQuestion').textContent = data.question;
    document.getElementById('mcqJustifyInput').value = '';
    document.getElementById('mcqJustifySubmitBtn').disabled = true;

    const resultBadge = document.getElementById('mcqResultBadge');
    if (data.mcqResult?.isCorrect) {
        resultBadge.innerHTML = '<span style="color: var(--success);">✅ Correct answer!</span>';
    } else {
        resultBadge.innerHTML = `<span style="color: var(--danger);">❌ Incorrect — correct was ${data.mcqResult?.correct}</span>`;
    }

    speak(data.question);
    setTimeout(() => document.getElementById('mcqJustifyInput').focus(), 300);
}

// ─── SHOW CODING ────────────────────────────────────────────
function showCoding(data) {
    const area = document.getElementById('codingArea');
    area.classList.remove('hidden');

    document.getElementById('codingProblem').textContent = data.problem;
    document.getElementById('codingInput').textContent = data.exampleInput;
    document.getElementById('codingOutput').textContent = data.exampleOutput;

    const editor = document.getElementById('codeEditor');
    editor.value = '';
    document.getElementById('codeExplanation').value = '';
    document.getElementById('codeSubmitBtn').disabled = true;
    document.getElementById('pasteWarning').classList.add('hidden');

    // Reset tracking
    pasteCount = 0;
    firstKeystrokeTime = null;
    codingStartTimestamp = Date.now();
    interruptTriggered = false;

    speak(data.problem);

    // Timer
    codingStartTime = Date.now();
    clearInterval(codingTimerInterval);
    codingTimerInterval = setInterval(() => {
        const s = Math.floor((Date.now() - codingStartTime) / 1000);
        document.getElementById('codingTimer').textContent = `Time: ${s}s`;

        // Trigger interruption after ~30 seconds of coding if not yet interrupted
        if (s >= 30 && !interruptTriggered && editor.value.trim().length > 20) {
            triggerInterruption();
        }
    }, 1000);
}

// ─── SHOW CODING INTERRUPT ──────────────────────────────────
function showCodingInterrupt(data) {
    const modal = document.getElementById('interruptModal');
    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    document.getElementById('interruptQuestion').textContent = data.question;
    document.getElementById('interruptInput').value = '';
    document.getElementById('interruptSubmitBtn').disabled = true;

    speak(data.question);
    setTimeout(() => document.getElementById('interruptInput').focus(), 300);
}

function showCodingResume() {
    const modal = document.getElementById('interruptModal');
    modal.classList.add('hidden');
    modal.style.display = 'none';

    document.getElementById('codingArea').classList.remove('hidden');
    document.getElementById('codeEditor').focus();
}

// ─── TRIGGER CODING INTERRUPTION ────────────────────────────
async function triggerInterruption() {
    if (interruptTriggered) return;
    interruptTriggered = true;

    try {
        const code = document.getElementById('codeEditor').value;
        const res = await fetch(`${API}/interview/coding-interrupt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, currentCode: code }),
        });
        const data = await res.json();
        if (data.question) {
            showCodingInterrupt(data);
        }
    } catch (err) {
        console.error('Interruption error:', err);
    }
}

// ─── COMPLETION ─────────────────────────────────────────────
function showCompletion(data) {
    clearInterval(timerInterval);
    clearInterval(answerTimerInterval);
    clearInterval(mcqTimerInterval);
    clearInterval(codingTimerInterval);
    if (synth) synth.cancel();

    hideAll();
    const area = document.getElementById('completionArea');
    area.classList.remove('hidden');

    if (data.summary) {
        const s = data.summary;
        document.getElementById('summaryStats').innerHTML = `
            <div class="stat-card"><div class="stat-number">${s.totalQuestions}</div><div class="stat-label">Questions</div></div>
            <div class="stat-card"><div class="stat-number">${s.spokenQuestions || '-'}</div><div class="stat-label">Spoken</div></div>
            <div class="stat-card"><div class="stat-number">${s.mcqQuestions || '-'}</div><div class="stat-label">MCQs</div></div>
            <div class="stat-card"><div class="stat-number">${s.codingQuestions || '-'}</div><div class="stat-label">Coding</div></div>
            <div class="stat-card"><div class="stat-number">${s.averageQuality}/10</div><div class="stat-label">Avg Quality</div></div>
            <div class="stat-card"><div class="stat-number">${s.durationFormatted}</div><div class="stat-label">Duration</div></div>
        `;
    }

    // Load full transcript
    loadTranscript();
}

async function loadTranscript() {
    try {
        const res = await fetch(`${API}/interview/${sessionId}/transcript`);
        const data = await res.json();
        renderTranscript(data);
    } catch (err) {
        console.error('Error loading transcript:', err);
    }
}

function renderTranscript(data) {
    const container = document.getElementById('transcriptList');
    if (!data.slots) return;

    container.innerHTML = data.slots.map((slot, i) => {
        const typeLabel = slot.type === 'mcq' ? '📋 MCQ' : slot.type === 'coding' ? '💻 Coding' : '🎤 Spoken';
        const typeClass = slot.type === 'mcq' ? 'mcq' : slot.type === 'coding' ? 'coding' : '';

        let content = '';

        if (slot.type === 'spoken') {
            const q = slot.evaluation?.answer_quality ?? '-';
            const clarity = slot.evaluation?.clarity ?? '-';
            const feedback = slot.evaluation?.brief_feedback ?? '';

            content = `
                <div class="transcript-item">
                    <div class="transcript-q">${typeLabel} Q${i + 1}: ${slot.question}</div>
                    <div class="transcript-a">${slot.answer || '<em>No answer</em>'}</div>
                    <div class="transcript-meta">Quality: ${q}/10 | Clarity: ${clarity}</div>
                    ${feedback ? `<div class="transcript-feedback">💬 ${feedback}</div>` : ''}
                    ${(slot.followUps || []).map(fu => `
                        <div class="transcript-followup">
                            <div class="transcript-q">↳ Follow-up (Depth ${fu.depth}): ${fu.question}</div>
                            <div class="transcript-a">${fu.answer || '<em>No answer</em>'}</div>
                            <div class="transcript-meta">Quality: ${fu.evaluation?.answer_quality ?? '-'}/10 | Clarity: ${fu.evaluation?.clarity ?? '-'}</div>
                        </div>
                    `).join('')}
                </div>
            `;
        } else if (slot.type === 'mcq') {
            const isCorrect = slot.selectedOption?.charAt(0) === slot.correct;
            content = `
                <div class="transcript-item ${typeClass}">
                    <div class="transcript-q">${typeLabel} Q${i + 1}: ${slot.question}</div>
                    <div class="transcript-a">Selected: ${slot.selectedOption || '-'} ${isCorrect ? '✅' : `❌ (Correct: ${slot.correct})`}</div>
                    ${slot.mcqJustification ? `<div class="transcript-a"><em>Justification:</em> ${slot.mcqJustification}</div>` : ''}
                </div>
            `;
        } else if (slot.type === 'coding') {
            const cq = slot.codingEval?.code_quality ?? '-';
            content = `
                <div class="transcript-item ${typeClass}">
                    <div class="transcript-q">${typeLabel} Q${i + 1}: ${slot.question}</div>
                    ${slot.code ? `<pre class="transcript-code">${escapeHtml(slot.code)}</pre>` : '<div class="transcript-a"><em>No code submitted</em></div>'}
                    ${slot.explanation ? `<div class="transcript-a"><em>Explanation:</em> ${slot.explanation}</div>` : ''}
                    <div class="transcript-meta">Code Quality: ${cq}/10 | Logic: ${slot.codingEval?.logic_understanding ?? '-'}</div>
                    ${slot.codingEval?.brief_feedback ? `<div class="transcript-feedback">💬 ${slot.codingEval.brief_feedback}</div>` : ''}
                    ${(slot.interruptionResponses || []).map(ir => `
                        <div class="transcript-followup">
                            <div class="transcript-q">🛑 Interruption: ${ir.question}</div>
                            <div class="transcript-a">${ir.answer}</div>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        return content;
    }).join('');
}

// ─── SETUP: SPOKEN HANDLERS ────────────────────────────────
function setupSpokenHandlers() {
    const input = document.getElementById('answerInput');
    const btn = document.getElementById('submitBtn');

    input.addEventListener('input', () => {
        btn.disabled = input.value.trim().length === 0;
    });

    btn.addEventListener('click', async () => {
        const answer = input.value.trim();
        if (!answer) return;

        btn.disabled = true;
        clearInterval(answerTimerInterval);
        showThinking('Evaluating your answer...');

        try {
            const res = await fetch(`${API}/interview/answer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, answer }),
            });
            const data = await res.json();
            hideThinking();
            handleResponse(data);
        } catch (err) {
            hideThinking();
            console.error('Error:', err);
            alert('Something went wrong. Please try again.');
            btn.disabled = false;
        }
    });

    // Enter key submit (Ctrl+Enter)
    input.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter' && !btn.disabled) {
            btn.click();
        }
    });
}

// ─── SETUP: MCQ HANDLERS ───────────────────────────────────
function setupMCQHandlers() {
    const submitBtn = document.getElementById('mcqSubmitBtn');
    submitBtn.addEventListener('click', async () => {
        if (!selectedMCQOption) return;

        submitBtn.disabled = true;
        clearInterval(mcqTimerInterval);
        showThinking('Processing your choice...');

        const selectionTime = Date.now() - mcqStartTime;

        try {
            const res = await fetch(`${API}/interview/mcq-answer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, selectedOption: selectedMCQOption, selectionTimeMs: selectionTime }),
            });
            const data = await res.json();
            hideThinking();
            handleResponse(data);
        } catch (err) {
            hideThinking();
            console.error('Error:', err);
            submitBtn.disabled = false;
        }
    });

    // MCQ Justify
    const justifyInput = document.getElementById('mcqJustifyInput');
    const justifyBtn = document.getElementById('mcqJustifySubmitBtn');

    justifyInput.addEventListener('input', () => {
        justifyBtn.disabled = justifyInput.value.trim().length === 0;
    });

    justifyBtn.addEventListener('click', async () => {
        const justification = justifyInput.value.trim();
        if (!justification) return;

        justifyBtn.disabled = true;
        showThinking('Evaluating your reasoning...');

        try {
            const res = await fetch(`${API}/interview/mcq-justify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, justification }),
            });
            const data = await res.json();
            hideThinking();
            handleResponse(data);
        } catch (err) {
            hideThinking();
            console.error('Error:', err);
            justifyBtn.disabled = false;
        }
    });

    justifyInput.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter' && !justifyBtn.disabled) {
            justifyBtn.click();
        }
    });
}

// ─── SETUP: CODING HANDLERS ────────────────────────────────
function setupCodingHandlers() {
    const editor = document.getElementById('codeEditor');
    const explanation = document.getElementById('codeExplanation');
    const submitBtn = document.getElementById('codeSubmitBtn');

    // Enable submit when code exists
    editor.addEventListener('input', () => {
        submitBtn.disabled = editor.value.trim().length === 0;
        if (!firstKeystrokeTime) firstKeystrokeTime = Date.now();
    });

    // Detect paste
    editor.addEventListener('paste', (e) => {
        pasteCount++;
        document.getElementById('pasteWarning').classList.remove('hidden');

        // Report to server
        fetch(`${API}/interview/signal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId,
                signalType: 'paste',
                signalData: { pasteNumber: pasteCount, timestamp: Date.now() },
            }),
        }).catch(() => { });
    });

    // Tab key for indentation
    editor.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = editor.selectionStart;
            const end = editor.selectionEnd;
            editor.value = editor.value.substring(0, start) + '  ' + editor.value.substring(end);
            editor.selectionStart = editor.selectionEnd = start + 2;
        }
    });

    submitBtn.addEventListener('click', async () => {
        const code = editor.value.trim();
        if (!code) return;

        submitBtn.disabled = true;
        clearInterval(codingTimerInterval);
        showThinking('Evaluating your code...');

        const behaviorData = {
            pasteEvents: pasteCount,
            timeToFirstKeystroke: firstKeystrokeTime ? firstKeystrokeTime - codingStartTimestamp : null,
            totalTimeMs: Date.now() - codingStartTimestamp,
        };

        try {
            const res = await fetch(`${API}/interview/code-submit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId,
                    code,
                    explanation: explanation.value.trim(),
                    behaviorData,
                }),
            });
            const data = await res.json();
            hideThinking();
            handleResponse(data);
        } catch (err) {
            hideThinking();
            console.error('Error:', err);
            submitBtn.disabled = false;
        }
    });
}

// ─── SETUP: INTERRUPT HANDLER ───────────────────────────────
function setupInterruptHandler() {
    const input = document.getElementById('interruptInput');
    const btn = document.getElementById('interruptSubmitBtn');

    input.addEventListener('input', () => {
        btn.disabled = input.value.trim().length === 0;
    });

    btn.addEventListener('click', async () => {
        const response = input.value.trim();
        if (!response) return;

        btn.disabled = true;

        try {
            const res = await fetch(`${API}/interview/interrupt-response`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, response }),
            });
            const data = await res.json();
            handleResponse(data);
        } catch (err) {
            console.error('Error:', err);
            btn.disabled = false;
        }
    });

    input.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter' && !btn.disabled) {
            btn.click();
        }
    });
}

// ─── SKIP BUTTON ────────────────────────────────────────────
function setupSkipButton() {
    const skipBtn = document.getElementById('skipBtn');
    if (!skipBtn) return;

    skipBtn.addEventListener('click', async () => {
        skipBtn.disabled = true;
        showThinking('Skipping to next question...');

        try {
            const res = await fetch(`${API}/interview/skip`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId }),
            });
            const data = await res.json();
            hideThinking();
            skipBtn.disabled = false;
            handleResponse(data);
        } catch (err) {
            hideThinking();
            console.error('Skip error:', err);
            skipBtn.disabled = false;
        }
    });
}

// ─── UI HELPERS ─────────────────────────────────────────────
function hideAll() {
    ['spokenArea', 'mcqArea', 'mcqJustifyArea', 'codingArea', 'completionArea', 'loadingState'].forEach(id => {
        document.getElementById(id).classList.add('hidden');
    });
    document.getElementById('interruptModal').classList.add('hidden');
    document.getElementById('interruptModal').style.display = 'none';
    document.getElementById('aiThinking').classList.add('hidden');
}

function showThinking(text) {
    document.getElementById('aiThinkingText').textContent = text || 'Interviewer is thinking...';
    document.getElementById('aiThinking').classList.remove('hidden');
}

function hideThinking() {
    document.getElementById('aiThinking').classList.add('hidden');
}

function updateProgress(current, total) {
    const pct = Math.round((current / total) * 100);
    document.getElementById('progressFill').style.width = `${pct}%`;
    document.getElementById('progressText').textContent = `${current}/${total}`;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str || ''));
    return div.innerHTML;
}
