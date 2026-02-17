// ============================================================
// interview.js — Interview Session Logic (Interview AI v1)
// ============================================================

(function () {
    'use strict';

    // ─── SESSION DATA ───────────────────────────────────────
    const sessionData = JSON.parse(sessionStorage.getItem('interviewSession') || 'null');

    if (!sessionData) {
        window.location.href = '/';
        return;
    }

    const { sessionId, role, candidateName, firstQuestion } = sessionData;

    // ─── DOM ELEMENTS ───────────────────────────────────────
    const headerTitle = document.getElementById('headerTitle');
    const headerRole = document.getElementById('headerRole');
    const timerText = document.getElementById('timerText');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    const loadingState = document.getElementById('loadingState');
    const questionArea = document.getElementById('questionArea');
    const questionBadge = document.getElementById('questionBadge');
    const questionText = document.getElementById('questionText');
    const answerInput = document.getElementById('answerInput');
    const submitBtn = document.getElementById('submitBtn');
    const aiThinking = document.getElementById('aiThinking');
    const aiThinkingText = document.getElementById('aiThinkingText');
    const answerSection = document.getElementById('answerSection');
    const answerTimer = document.getElementById('answerTimer');
    const completionArea = document.getElementById('completionArea');
    const summaryStats = document.getElementById('summaryStats');
    const transcriptList = document.getElementById('transcriptList');

    // ─── STATE ──────────────────────────────────────────────
    let currentQuestion = firstQuestion;
    let interviewStartTime = Date.now();
    let questionStartTime = Date.now();
    let globalTimerInterval = null;
    let answerTimerInterval = null;
    let isSubmitting = false;

    // ─── INITIALIZE ─────────────────────────────────────────
    function init() {
        headerTitle.textContent = `${candidateName}'s Interview`;
        headerRole.textContent = role;

        // Start global timer
        globalTimerInterval = setInterval(updateGlobalTimer, 1000);

        // Show first question
        showQuestion(currentQuestion);
    }

    // ─── SHOW QUESTION ─────────────────────────────────────
    function showQuestion(data) {
        loadingState.classList.add('hidden');
        questionArea.classList.remove('hidden');
        aiThinking.classList.add('hidden');
        answerSection.classList.remove('hidden');

        // Update badge
        if (data.isFollowUp) {
            questionBadge.className = 'question-badge follow-up';
            questionBadge.innerHTML = `<span>↳ Follow-up (Depth ${data.followUpDepth})</span>`;
        } else {
            questionBadge.className = 'question-badge';
            questionBadge.innerHTML = `<span>Question ${data.questionNumber} of ${data.totalQuestions}</span>`;
        }

        // Update question text with animation
        const card = document.getElementById('questionCard');
        card.style.animation = 'none';
        card.offsetHeight; // Trigger reflow
        card.style.animation = 'slideIn 0.4s ease';
        questionText.textContent = data.question;

        // Update progress
        const progress = ((data.questionNumber - 1) / data.totalQuestions) * 100;
        progressFill.style.width = `${progress}%`;
        progressText.textContent = `${data.questionNumber}/${data.totalQuestions}`;

        // Reset answer input
        answerInput.value = '';
        answerInput.focus();
        submitBtn.disabled = true;

        // Start answer timer
        questionStartTime = Date.now();
        clearInterval(answerTimerInterval);
        answerTimerInterval = setInterval(updateAnswerTimer, 1000);
    }

    // ─── SUBMIT ANSWER ─────────────────────────────────────
    async function submitAnswer() {
        const answer = answerInput.value.trim();
        if (!answer || isSubmitting) return;

        isSubmitting = true;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;"></div> Submitting...';
        answerSection.classList.add('hidden');
        aiThinking.classList.remove('hidden');

        // Randomize thinking messages
        const thinkingMessages = [
            'Interviewer is reviewing your answer...',
            'Analyzing your response...',
            'Preparing next question...',
            'Evaluating depth of understanding...',
            'Thinking about a follow-up...',
        ];
        aiThinkingText.textContent = thinkingMessages[Math.floor(Math.random() * thinkingMessages.length)];

        try {
            const response = await fetch('/api/interview/answer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, answer }),
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Failed to submit answer');
            }

            const result = await response.json();

            if (result.state === 'COMPLETED') {
                showCompletion(result);
            } else {
                currentQuestion = result;
                showQuestion(result);
            }
        } catch (err) {
            alert(`Error: ${err.message}`);
            answerSection.classList.remove('hidden');
            aiThinking.classList.add('hidden');
        } finally {
            isSubmitting = false;
            submitBtn.innerHTML = 'Submit Answer →';
            submitBtn.disabled = false;
        }
    }

    // ─── COMPLETION ─────────────────────────────────────────
    async function showCompletion(result) {
        clearInterval(globalTimerInterval);
        clearInterval(answerTimerInterval);

        questionArea.classList.add('hidden');
        completionArea.classList.remove('hidden');

        // Show summary stats
        const summary = result.summary;
        summaryStats.innerHTML = `
            <div class="summary-stat slide-in">
                <div class="summary-stat-value">${summary.totalQuestions}</div>
                <div class="summary-stat-label">Questions</div>
            </div>
            <div class="summary-stat slide-in" style="animation-delay: 0.1s;">
                <div class="summary-stat-value">${summary.averageQuality}/10</div>
                <div class="summary-stat-label">Avg Quality</div>
            </div>
            <div class="summary-stat slide-in" style="animation-delay: 0.2s;">
                <div class="summary-stat-value">${summary.durationFormatted}</div>
                <div class="summary-stat-label">Duration</div>
            </div>
        `;

        // Load full transcript
        try {
            const response = await fetch(`/api/interview/${sessionId}/transcript`);
            const transcript = await response.json();
            renderTranscript(transcript);
        } catch (err) {
            transcriptList.innerHTML = '<p style="color: var(--text-muted);">Could not load transcript.</p>';
        }
    }

    // ─── RENDER TRANSCRIPT ─────────────────────────────────
    function renderTranscript(transcript) {
        let html = '';

        transcript.questions.forEach((q, i) => {
            html += `
                <div class="transcript-item slide-in" style="animation-delay: ${i * 0.1}s;">
                    <div class="transcript-question">Q${q.questionNumber}: ${escapeHtml(q.question)}</div>
                    <div class="transcript-answer">${escapeHtml(q.answer || 'No answer')}</div>
                    ${q.evaluation ? `
                        <div class="transcript-eval">
                            <span class="eval-badge quality">Quality: ${q.evaluation.answer_quality}/10</span>
                            <span class="eval-badge clarity">Clarity: ${q.evaluation.clarity || 'N/A'}</span>
                        </div>
                        ${q.evaluation.brief_feedback ? `<p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px; font-style: italic;">💬 ${escapeHtml(q.evaluation.brief_feedback)}</p>` : ''}
                    ` : ''}
                </div>
            `;

            // Follow-ups
            q.followUps.forEach((fu, j) => {
                html += `
                    <div class="transcript-item slide-in" style="margin-left: 24px; border-left-color: var(--success); animation-delay: ${(i * 0.1) + ((j + 1) * 0.05)}s;">
                        <div class="transcript-question" style="color: var(--success);">↳ Follow-up (Depth ${fu.depth}): ${escapeHtml(fu.question)}</div>
                        <div class="transcript-answer">${escapeHtml(fu.answer || 'No answer')}</div>
                        ${fu.evaluation ? `
                            <div class="transcript-eval">
                                <span class="eval-badge quality">Quality: ${fu.evaluation.answer_quality}/10</span>
                                <span class="eval-badge clarity">Clarity: ${fu.evaluation.clarity || 'N/A'}</span>
                            </div>
                        ` : ''}
                    </div>
                `;
            });
        });

        transcriptList.innerHTML = html;
    }

    // ─── TIMERS ─────────────────────────────────────────────
    function updateGlobalTimer() {
        const elapsed = Math.floor((Date.now() - interviewStartTime) / 1000);
        const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const secs = String(elapsed % 60).padStart(2, '0');
        timerText.textContent = `${mins}:${secs}`;
    }

    function updateAnswerTimer() {
        const elapsed = Math.floor((Date.now() - questionStartTime) / 1000);
        answerTimer.textContent = `Thinking time: ${elapsed}s`;
    }

    // ─── EVENT LISTENERS ────────────────────────────────────
    answerInput.addEventListener('input', () => {
        submitBtn.disabled = answerInput.value.trim().length === 0;
    });

    submitBtn.addEventListener('click', submitAnswer);

    answerInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.ctrlKey && !submitBtn.disabled) {
            submitAnswer();
        }
    });

    // ─── UTILITIES ──────────────────────────────────────────
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ─── START ──────────────────────────────────────────────
    init();

})();
