// ============================================================
// interview.js — Frontend Interview Logic (v3)
// ============================================================
// V3: Edge TTS + Score Display + Anti-AI flags
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
let currentAudio = null; // V3: Track audio instance to stop it on skip
let ttsGenId = 0; // V3: Generation ID to prevent async race conditions

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
    // Setup submit handlers
    setupSpokenHandlers();
    setupMCQHandlers();
    setupCodingHandlers();
    setupInterruptHandler();
    setupSkipButton();
    setupVideoControls(); // V3.5

    // Init Webcam (V3.5) - Gatekeeper
    initWebcam();

    // Wire up Start Button
    document.getElementById('startInterviewBtn').addEventListener('click', startInterview);
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
    const SILENCE_DURATION = 3000; // 3 seconds
    let silenceTimer = null;
    let isIntro = false;

    // STT setup
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        const feedbackBubble = document.getElementById('speechFeedback');
        const feedbackText = document.getElementById('feedbackText');

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

            // Find the active textarea and append final result
            const activeInput = getActiveTextarea();
            if (activeInput && finalTranscript) {
                activeInput.value += (activeInput.value ? ' ' : '') + finalTranscript;
                activeInput.dispatchEvent(new Event('input'));
            }

            // V3.5 Speech UI: Show interim or final text
            if (interimTranscript) {
                feedbackBubble.classList.remove('hidden');
                feedbackText.textContent = `Listening: "${interimTranscript}"`;
                statusEl.textContent = '🎙️ Listening...';

                // Reset silence timer while talking
                clearTimeout(silenceTimer);
                feedbackBubble.classList.remove('preparing-submit');
            } else if (finalTranscript) {
                feedbackText.textContent = `Captured: "${finalTranscript}"`;
                statusEl.textContent = '✅ Captured';

                // Start silence timer after final result
                resetSilenceTimer();
            }
        };

        function resetSilenceTimer() {
            clearTimeout(silenceTimer);

            // Only auto-submit if we have input and mic is on
            const activeInput = getActiveTextarea();
            if (!micEnabled || !activeInput || activeInput.value.trim().length < 2) return;

            // Visual cue after 1.5s
            silenceTimer = setTimeout(() => {
                feedbackBubble.classList.add('preparing-submit');
                statusEl.textContent = '⏳ Finishing...';

                // Submit after another 1.5s (Total 3s)
                silenceTimer = setTimeout(() => {
                    triggerSilenceSubmit();
                }, 1500);
            }, 1500);
        }

        function triggerSilenceSubmit() {
            if (!micEnabled) return;

            // Visual feedback
            const feedbackBubble = document.getElementById('speechFeedback');
            const statusEl = document.getElementById('speechStatus');
            feedbackBubble.classList.remove('preparing-submit');
            feedbackBubble.classList.add('hidden');
            statusEl.textContent = '🚀 Auto-submitting...';

            if (isIntro) {
                // Handle Intro completion
                isIntro = false;
                console.log('[Intro] User finished speaking. Moving to Q1.');
                speak("Thanks. Let's get started.");
                setTimeout(() => {
                    loadFirstQuestion();
                }, 2000);
            } else {
                // Click the appropriate submit button
                const activeInput = getActiveTextarea();
                // Determine which button to click based on active input
                if (activeInput && activeInput.id === 'answerInput') {
                    document.getElementById('submitBtn').click();
                } else if (activeInput && activeInput.id === 'mcqJustifyInput') {
                    document.getElementById('mcqJustifySubmitBtn').click();
                } else if (activeInput && activeInput.id === 'interruptInput') {
                    document.getElementById('interruptSubmitBtn').click();
                }
            }
        }

        recognition.onerror = (e) => {
            if (e.error !== 'no-speech') {
                statusEl.textContent = `⚠️ Error: ${e.error}`;
                feedbackText.textContent = `⚠️ Error: ${e.error}`;
            }
        };

        recognition.onend = () => {
            // If mic is enabled but stopped (silence), just restart
            if (micEnabled) recognition.start();
            else feedbackBubble.classList.add('hidden');
        };

        micBtn.addEventListener('click', () => {
            micEnabled = !micEnabled;
            if (micEnabled) {
                recognition.start();
                micBtn.textContent = '🎤 Mic On';
                micBtn.classList.add('active');
                statusEl.textContent = '🎙️ Listening...';
                feedbackBubble.classList.remove('hidden');
                feedbackText.textContent = 'Listening...';
            } else {
                recognition.stop();
                clearTimeout(silenceTimer);
                micBtn.textContent = '🎤 Mic Off';
                micBtn.classList.remove('active');
                statusEl.textContent = 'Mic off';
                feedbackBubble.classList.add('hidden');
            }
        });
    } else {
        micBtn.disabled = true;
        micBtn.textContent = '🎤 Not supported';
        statusEl.textContent = 'Speech input not supported in this browser';
    }
}

function getActiveTextarea() {
    if (!document.getElementById('spokenArea').classList.contains('hidden') || isIntro) {
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

// ─── AUDIO CONTROL ──────────────────────────────────────────
function speak(text) {
    if (!speechEnabled) return;
    stopAudio();

    // Animate avatar
    const avatar = document.getElementById('interviewerImage');
    if (avatar) avatar.classList.add('speaking-pulse');

    const myId = ++ttsGenId;

    const encoded = encodeURIComponent(text);
    fetch(`${API}/tts?text=${encoded}`)
        .then(res => {
            if (myId !== ttsGenId) return;
            const contentType = res.headers.get('content-type') || '';
            if (contentType.includes('audio') || contentType.includes('octet-stream')) {
                return res.blob().then(blob => {
                    if (myId !== ttsGenId) return;
                    const url = URL.createObjectURL(blob);
                    const audio = new Audio(url);
                    currentAudio = audio;

                    audio.play().catch(() => {
                        if (myId === ttsGenId) speakWebSpeech(text);
                    });

                    audio.onended = () => {
                        URL.revokeObjectURL(url);
                        if (currentAudio === audio) {
                            currentAudio = null;
                            if (avatar) avatar.classList.remove('speaking-pulse');
                        }
                    };
                });
            } else {
                if (myId === ttsGenId) speakWebSpeech(text);
            }
        })
        .catch(() => {
            if (myId === ttsGenId) speakWebSpeech(text);
        });
}

function stopAudio() {
    ttsGenId++;
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
    if (synth) synth.cancel();

    const avatar = document.getElementById('interviewerImage');
    if (avatar) avatar.classList.remove('speaking-pulse');
}

function speakWebSpeech(text) {
    if (!synth) return;
    stopAudio(); // Ensure clean slate
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
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
function hideAll() {
    const ids = [
        'spokenArea', 'mcqArea', 'codingArea', 'completionArea', 'mcqJustifyArea',
        'spokenOverlay', 'interruptModal'
    ];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
}

function handleResponse(data) {
    hideAll();
    stopAudio();
    document.getElementById('loadingState').classList.add('hidden');

    // Reset completion mode
    document.body.classList.remove('mode-completed');

    // NOTE: contentStage.active is now managed by individual show functions
    // based on Spoken vs Task mode requirements.

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



// ─── MODE HELPERS ───────────────────────────────────────────
function startSpokenMode(questionText) {
    // Zoom Style: Full video, Overlay Caption, No Content Stage
    document.body.classList.remove('layout-task');
    document.getElementById('contentStage').classList.remove('active');

    const overlay = document.getElementById('spokenOverlay');
    overlay.classList.remove('hidden');
    document.getElementById('spokenCaptionText').textContent = questionText;

    // Reset overlay timer
    const timerEl = document.getElementById('spokenTimer');
    timerEl.textContent = "00:00";
}

function startTaskMode() {
    // Task Style: Hide Interviewer, Show Content Stage
    document.body.classList.add('layout-task');
    document.getElementById('contentStage').classList.add('active');
    document.getElementById('spokenOverlay').classList.add('hidden');

    // Force candidate camera visible
    const myCam = document.getElementById('userVideoContainer');
    if (myCam) myCam.style.display = 'block';
}

// ─── SHOW SPOKEN QUESTION ───────────────────────────────────
function showSpokenQuestion(data) {
    startSpokenMode(data.question);

    // We still populate the hidden spokenArea for logic, but it's invisible
    const area = document.getElementById('spokenArea');
    area.classList.remove('hidden'); // It's inside contentStage which is hidden

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

    // Enable the overlay button
    const finishBtn = document.getElementById('finishSpeakingBtn');
    if (finishBtn) finishBtn.disabled = true; // Wait for some input? Or just enable?
    // Actually, in Zoom mode, we might want to enable it immediately or after a few seconds
    if (finishBtn) finishBtn.disabled = false;

    // Speak the question
    speak(data.question);

    // Start answer timer
    answerStartTime = Date.now();
    clearInterval(answerTimerInterval);
    answerTimerInterval = setInterval(() => {
        const s = Math.floor((Date.now() - answerStartTime) / 1000);
        document.getElementById('answerTimer').textContent = `Thinking time: ${s}s`;

        // Update overlay timer
        const timerEl = document.getElementById('spokenTimer');
        if (timerEl) {
            const m = Math.floor(s / 60).toString().padStart(2, '0');
            const sec = (s % 60).toString().padStart(2, '0');
            timerEl.textContent = `${m}:${sec}`;
        }
    }, 1000);

    // Focus input (even if hidden, to capture keyboard)
    setTimeout(() => document.getElementById('answerInput').focus(), 300);
}

// ─── SHOW MCQ ───────────────────────────────────────────────
function showMCQ(data) {
    startTaskMode();

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

    // Speak the question - DISABLED for Task Mode per user request
    // speak(data.question);

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
    startTaskMode();

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

    // Speak the problem - DISABLED for Task Mode per user request
    // speak(data.problem);

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
    stopAudio(); // V3: Stop audio on completion
    if (synth) synth.cancel();

    hideAll();
    const area = document.getElementById('completionArea');
    area.classList.remove('hidden');

    // V3.5: Completion mode — hide all video elements, full screen scoring
    document.body.classList.add('mode-completed');

    // V3: Score display
    const score = data.score;
    const summary = data.summary;

    let scoreHtml = '';
    if (score) {
        const g = score.grade || {};
        const b = score.breakdown || {};

        scoreHtml = `
            <div class="score-hero">
                <div class="score-circle" style="border-color: ${g.color || '#888'}">
                    <span class="score-number" style="color: ${g.color || '#fff'}">${score.overall}</span>
                    <span class="score-label">out of 100</span>
                </div>
                <div class="score-grade" style="color: ${g.color || '#fff'}">${g.letter || '?'}</div>
                <div class="score-grade-label">${g.label || ''}</div>
            </div>

            <div class="score-breakdown">
                <div class="score-metric"><span class="metric-label">🎯 Answer Quality</span><div class="metric-bar"><div class="metric-fill" style="width:${b.answerQuality || 0}%; background:${getMetricColor(b.answerQuality)}"></div></div><span class="metric-value">${b.answerQuality || 0}%</span></div>
                <div class="score-metric"><span class="metric-label">📊 Depth Stability</span><div class="metric-bar"><div class="metric-fill" style="width:${b.depthStability || 0}%; background:${getMetricColor(b.depthStability)}"></div></div><span class="metric-value">${b.depthStability || 0}%</span></div>
                <div class="score-metric"><span class="metric-label">📋 MCQ Accuracy</span><div class="metric-bar"><div class="metric-fill" style="width:${b.mcqAccuracy || 0}%; background:${getMetricColor(b.mcqAccuracy)}"></div></div><span class="metric-value">${b.mcqAccuracy || 0}%</span></div>
                <div class="score-metric"><span class="metric-label">💻 Coding Score</span><div class="metric-bar"><div class="metric-fill" style="width:${b.codingScore || 0}%; background:${getMetricColor(b.codingScore)}"></div></div><span class="metric-value">${b.codingScore || 0}%</span></div>
                <div class="score-metric"><span class="metric-label">🛡️ Behavioral Trust</span><div class="metric-bar"><div class="metric-fill" style="width:${b.behavioralTrust || 0}%; background:${getMetricColor(b.behavioralTrust)}"></div></div><span class="metric-value">${b.behavioralTrust || 0}%</span></div>
                <div class="score-metric"><span class="metric-label">🔗 Consistency</span><div class="metric-bar"><div class="metric-fill" style="width:${b.consistency || 0}%; background:${getMetricColor(b.consistency)}"></div></div><span class="metric-value">${b.consistency || 0}%</span></div>
            </div>
        `;

        // Risk flags
        if (score.riskFlags && score.riskFlags.length > 0) {
            scoreHtml += `<div class="risk-flags"><h4>⚠️ Risk Flags</h4>`;
            score.riskFlags.forEach(flag => {
                const cls = flag.severity === 'danger' ? 'risk-danger' : 'risk-warning';
                scoreHtml += `<div class="risk-flag ${cls}"><span class="risk-icon">${flag.icon}</span><strong>${flag.label}</strong><span class="risk-detail">${flag.detail}</span></div>`;
            });
            scoreHtml += `</div>`;
        }
    }

    // Stats cards
    let statsHtml = '';
    if (summary) {
        statsHtml = `
            <div class="summary-grid">
                <div class="stat-card"><div class="stat-number">${summary.totalQuestions}</div><div class="stat-label">Questions</div></div>
                <div class="stat-card"><div class="stat-number">${summary.spokenQuestions || '-'}</div><div class="stat-label">Spoken</div></div>
                <div class="stat-card"><div class="stat-number">${summary.mcqQuestions || '-'}</div><div class="stat-label">MCQs</div></div>
                <div class="stat-card"><div class="stat-number">${summary.codingQuestions || '-'}</div><div class="stat-label">Coding</div></div>
                <div class="stat-card"><div class="stat-number">${summary.averageQuality}/10</div><div class="stat-label">Avg Quality</div></div>
                <div class="stat-card"><div class="stat-number">${summary.durationFormatted}</div><div class="stat-label">Duration</div></div>
            </div>
        `;
    }

    document.getElementById('completionContent').innerHTML = `
        ${scoreHtml}
        <div class="mt-xl">${statsHtml}</div>
    `;

    // Load full transcript
    loadTranscript();
}

function getMetricColor(value) {
    if (value >= 80) return '#00ff88';
    if (value >= 60) return '#c8ff00';
    if (value >= 40) return '#ffcc00';
    if (value >= 20) return '#ff9900';
    return '#ff3333';
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
    async function doSkip(btn) {
        if (btn) btn.disabled = true;
        stopAudio();
        showThinking('⏭️ Skipping to next question...');

        try {
            const res = await fetch(`${API}/interview/skip`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId }),
            });
            const data = await res.json();
            hideThinking();
            if (btn) btn.disabled = false;
            handleResponse(data);
        } catch (err) {
            hideThinking();
            console.error('Skip error:', err);
            if (btn) btn.disabled = false;
            alert('Skip failed — see console for details.');
        }
    }

    // Bind BOTH skip buttons
    const skipBtn = document.getElementById('skipBtn');
    if (skipBtn) skipBtn.addEventListener('click', () => doSkip(skipBtn));

    const floatingSkipBtn = document.getElementById('floatingSkipBtn');
    if (floatingSkipBtn) floatingSkipBtn.addEventListener('click', () => doSkip(floatingSkipBtn));
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
    // Debug Q# badge
    const debugQ = document.getElementById('debugQNum');
    if (debugQ) debugQ.textContent = `Q ${current}/${total}`;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str || ''));
    return div.innerHTML;
}

// ─── V3.5 VIDEO LOGIC ───────────────────────────────────────
async function initWebcam() {
    const camStatus = document.getElementById('checkCam').querySelector('.status');
    const micStatus = document.getElementById('checkMic').querySelector('.status');
    const startBtn = document.getElementById('startInterviewBtn');

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        const video = document.getElementById('userVideo');

        // V3.5 Fix: Ensure attributes are set for autoplay
        video.setAttribute('autoplay', '');
        video.setAttribute('muted', '');
        video.setAttribute('playsinline', '');

        video.srcObject = stream;
        video.muted = true; // Avoid echo

        // Don't play yet! Wait for user interaction (Start Button)
        // Just verify track status
        if (stream.getVideoTracks().length > 0 && stream.getVideoTracks()[0].readyState === 'live') {
            console.log('[Webcam] Connected (Waiting for start)');
            document.getElementById('checkCam').classList.add('success');
            camStatus.textContent = 'Connected';
            document.getElementById('checkMic').classList.add('success');
            micStatus.textContent = 'Connected';
            startBtn.disabled = false;
        } else {
            throw new Error('Stream not live');
        }

    } catch (err) {
        console.error('[Webcam] Access denied or error:', err);

        document.getElementById('checkCam').classList.add('error');
        camStatus.textContent = 'Denied/Error';

        document.getElementById('checkMic').classList.add('error');
        micStatus.textContent = 'Denied/Error';

        // Fallback UI in PIP
        const container = document.getElementById('userVideoContainer');
        container.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#666;text-align:center;font-size:0.8rem;background:#111;">
                <div style="font-size:2rem;margin-bottom:5px;">📷🚫</div>
                <span>Camera Blocked</span>
                <button onclick="initWebcam()" style="margin-top:5px;padding:2px 6px;font-size:0.7rem;cursor:pointer;">Retry</button>
            </div>
        `;
    }
}

function startInterview() {
    const lobby = document.getElementById('lobbyScreen');
    const video = document.getElementById('userVideo');

    // Explicitly play video on user click (Bypass Autoplay Policy)
    if (video && video.srcObject) {
        video.play().catch(e => console.error('[Webcam] Play error:', e));
    }

    lobby.style.opacity = '0';
    setTimeout(() => {
        lobby.classList.add('hidden');
        playIntro();
    }, 500);
}

function playIntro() {
    // V3.5: AI Introduction Sequence
    const name = new URLSearchParams(window.location.search).get('name') || 'Candidate';
    const introText = `Hi ${name}, I'm Christopher, a Senior Engineer at TechCorp. I'll be conducting your interview today. Could you start by briefly introducing yourself?`;

    // Show speaking state
    speak(introText);

    // Set Intro State
    isIntro = true;

    // Auto-enable mic for "Natural Conversation" experience
    // We wait a bit for TTS to start so we don't pick up the start of TTS if echo cancellation fails
    setTimeout(() => {
        const micBtn = document.getElementById('micToggle');
        if (micBtn && !micEnabled) {
            micBtn.click();
        }
        console.log('[Intro] Mic enabled. Waiting for user input + silence...');

        // Visual hint
        const feedbackBubble = document.getElementById('speechFeedback');
        const feedbackText = document.getElementById('feedbackText');
        feedbackBubble.classList.remove('hidden');
        feedbackText.textContent = "Listening for your intro...";
    }, 1000);

    // DO NOT use hardcoded timeouts here anymore.
    // triggerSilenceSubmit() will handle the transition.
}

function setupVideoControls() {
    const micBtn = document.getElementById('micBtn');
    const camBtn = document.getElementById('camBtn');

    // Mic Toggle (Visual + functional)
    micBtn.addEventListener('click', () => {
        const originalMicBtn = document.getElementById('micToggle');
        if (originalMicBtn) originalMicBtn.click();

        micBtn.classList.toggle('danger');
        // V3.5 Polish: Don't replace SVG with text! Just toggle class.
        // micBtn.textContent = micBtn.classList.contains('danger') ? '🔇' : '🎤';
    });

    // Cam Toggle
    camBtn.addEventListener('click', () => {
        const video = document.getElementById('userVideo');
        const stream = video.srcObject;
        if (stream) {
            stream.getVideoTracks().forEach(track => track.enabled = !track.enabled);
            const isOff = !stream.getVideoTracks().some(t => t.enabled);
            camBtn.classList.toggle('danger', isOff);
            // V3.5 Polish: Don't replace SVG with text!
        }
    }); // End of speech toggle handler

    // SETUP SPOKEN OVERLAY HANDLERS
    const finishBtn = document.getElementById('finishSpeakingBtn');
    if (finishBtn) {
        finishBtn.addEventListener('click', () => {
            // Trigger the hidden submit button
            const submitBtn = document.getElementById('submitBtn');
            if (submitBtn) {
                // If input empty, maybe put a placeholder?
                if (document.getElementById('answerInput').value.trim().length === 0) {
                    document.getElementById('answerInput').value = '[Voice Answer Submitted]';
                }
                submitBtn.disabled = false;
                submitBtn.click();
            }
        });
    }

} // End of DOMContentLoaded

// (Duplicate setupSkipButton removed — original is above at ~line 895)

