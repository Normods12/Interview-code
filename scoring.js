// ============================================================
// scoring.js — Scoring Engine (Interview AI Platform v3)
// ============================================================
// Computes Interview Readiness Score (0-100) from session data.
// Includes anti-AI detection signals.
// ============================================================

// ─── WEIGHTS ────────────────────────────────────────────────
const WEIGHTS = {
    answerQuality: 0.30,     // Average spoken answer quality
    depthStability: 0.20,    // Score stability across follow-ups
    mcqAccuracy: 0.15,       // MCQ correct + justification
    codingScore: 0.15,       // Code quality + explanation
    behavioralTrust: 0.10,   // Paste, timing, vocab consistency
    consistency: 0.10,       // Cross-topic answer agreement
};

// ─── MAIN SCORING FUNCTION ─────────────────────────────────
function computeScore(session) {
    const slots = session.slots || [];
    const spokenSlots = slots.filter(s => s.type === 'spoken' && !s.skipped);
    const mcqSlots = slots.filter(s => s.type === 'mcq' && !s.skipped);
    const codingSlots = slots.filter(s => s.type === 'coding' && !s.skipped);

    // ─── 1. ANSWER QUALITY (0-100) ──────────────────────────
    const answerQuality = computeAnswerQuality(spokenSlots);

    // ─── 2. DEPTH STABILITY (0-100) ─────────────────────────
    const depthStability = computeDepthStability(spokenSlots);

    // ─── 3. MCQ ACCURACY (0-100) ─────────────────────────────
    const mcqAccuracy = computeMCQAccuracy(mcqSlots);

    // ─── 4. CODING SCORE (0-100) ────────────────────────────
    const codingScore = computeCodingScore(codingSlots);

    // ─── 5. BEHAVIORAL TRUST (0-100) ────────────────────────
    const behavioralTrust = computeBehavioralTrust(session);

    // ─── 6. CONSISTENCY (0-100) ──────────────────────────────
    const consistency = computeConsistency(spokenSlots, mcqSlots);

    // ─── COMPOSITE SCORE ────────────────────────────────────
    const composite = Math.round(
        answerQuality * WEIGHTS.answerQuality +
        depthStability * WEIGHTS.depthStability +
        mcqAccuracy * WEIGHTS.mcqAccuracy +
        codingScore * WEIGHTS.codingScore +
        behavioralTrust * WEIGHTS.behavioralTrust +
        consistency * WEIGHTS.consistency
    );

    // ─── RISK FLAGS ─────────────────────────────────────────
    const riskFlags = detectRiskFlags(session, spokenSlots, mcqSlots, codingSlots);

    // ─── GRADE ──────────────────────────────────────────────
    const grade = getGrade(composite);

    return {
        overall: composite,
        grade,
        breakdown: {
            answerQuality: Math.round(answerQuality),
            depthStability: Math.round(depthStability),
            mcqAccuracy: Math.round(mcqAccuracy),
            codingScore: Math.round(codingScore),
            behavioralTrust: Math.round(behavioralTrust),
            consistency: Math.round(consistency),
        },
        riskFlags,
        totalAnswered: slots.filter(s => !s.skipped).length,
        totalSkipped: slots.filter(s => s.skipped).length,
    };
}

// ═══════════════════════════════════════════════════════════
// METRIC FUNCTIONS
// ═══════════════════════════════════════════════════════════

function computeAnswerQuality(spokenSlots) {
    if (spokenSlots.length === 0) return 0;

    const scores = [];
    spokenSlots.forEach(slot => {
        // Main answer quality
        if (slot.evaluation && slot.evaluation.quality) {
            scores.push(slot.evaluation.quality);
        }
        // Follow-up evaluations
        if (slot.followUps) {
            slot.followUps.forEach(fu => {
                if (fu.evaluation && fu.evaluation.quality) {
                    scores.push(fu.evaluation.quality);
                }
            });
        }
    });

    if (scores.length === 0) return 0;
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    return avg * 10; // Convert 0-10 to 0-100
}

function computeDepthStability(spokenSlots) {
    if (spokenSlots.length === 0) return 50; // Neutral if no data

    let stabilityScores = [];

    spokenSlots.forEach(slot => {
        if (!slot.followUps || slot.followUps.length === 0) return;
        if (!slot.evaluation || !slot.evaluation.quality) return;

        const mainScore = slot.evaluation.quality;
        const followUpScores = slot.followUps
            .filter(fu => fu.evaluation && fu.evaluation.quality)
            .map(fu => fu.evaluation.quality);

        if (followUpScores.length === 0) return;

        // Stability = how well scores hold up
        // Perfect: follow-up scores >= main score = 100
        // Bad: follow-up drops significantly = 0
        followUpScores.forEach(fuScore => {
            const drop = mainScore - fuScore;
            if (drop <= 0) {
                stabilityScores.push(100); // Improved or held steady
            } else if (drop <= 2) {
                stabilityScores.push(70);  // Small dip, acceptable
            } else if (drop <= 4) {
                stabilityScores.push(40);  // Significant drop
            } else {
                stabilityScores.push(10);  // Collapsed under probing
            }
        });
    });

    if (stabilityScores.length === 0) return 60; // Neutral
    return stabilityScores.reduce((a, b) => a + b, 0) / stabilityScores.length;
}

function computeMCQAccuracy(mcqSlots) {
    if (mcqSlots.length === 0) return 50; // Neutral if no MCQs

    let total = 0;
    mcqSlots.forEach(slot => {
        let slotScore = 0;

        // Was the answer correct? (50% of MCQ score)
        if (slot.isCorrect) {
            slotScore += 50;
        }

        // Justification quality (50% of MCQ score)
        if (slot.justificationEval && slot.justificationEval.quality) {
            slotScore += slot.justificationEval.quality * 5; // 0-10 → 0-50
        } else if (slot.isCorrect) {
            slotScore += 25; // Partial credit if correct but no justification data
        }

        total += slotScore;
    });

    return total / mcqSlots.length;
}

function computeCodingScore(codingSlots) {
    if (codingSlots.length === 0) return 50; // Neutral if no coding

    let total = 0;
    codingSlots.forEach(slot => {
        if (slot.codeEvaluation) {
            const codeQuality = slot.codeEvaluation.codeQuality || 0;
            const logic = slot.codeEvaluation.logic || 0;
            total += ((codeQuality + logic) / 2) * 10; // Average, convert to 0-100
        }
    });

    return total / codingSlots.length;
}

function computeBehavioralTrust(session) {
    let trust = 100; // Start at full trust

    // Check behavior signals
    const signals = session.behaviorSignals || [];

    // Paste events in coding
    const pasteCount = signals.filter(s => s.type === 'paste').length;
    if (pasteCount > 0) {
        trust -= Math.min(30, pasteCount * 15); // -15 per paste, max -30
    }

    // Check coding slots for suspicious timing
    const codingSlots = (session.slots || []).filter(s => s.type === 'coding' && !s.skipped);
    codingSlots.forEach(slot => {
        const behavior = slot.behaviorData || {};
        // Instant coding (< 3 seconds to first keystroke)
        if (behavior.timeToFirstKeystroke && behavior.timeToFirstKeystroke < 3000) {
            trust -= 20;
        }
        // Very fast total time (< 30 seconds for coding)
        if (behavior.totalTimeMs && behavior.totalTimeMs < 30000) {
            trust -= 15;
        }
    });

    // Check for very fast spoken answers (< 5 seconds response time)
    const spokenSlots = (session.slots || []).filter(s => s.type === 'spoken' && !s.skipped);
    const fastAnswers = spokenSlots.filter(s => s.responseTimeMs && s.responseTimeMs < 5000).length;
    if (fastAnswers > 3) {
        trust -= 15; // Too many suspiciously fast answers
    }

    return Math.max(0, trust);
}

function computeConsistency(spokenSlots, mcqSlots) {
    // Basic consistency check: if candidate performs well on MCQs
    // but poorly on spoken (or vice versa), flag inconsistency
    if (spokenSlots.length === 0 || mcqSlots.length === 0) return 70; // Neutral

    const spokenAvg = computeAnswerQuality(spokenSlots) / 10; // Back to 0-10
    const mcqAvg = computeMCQAccuracy(mcqSlots) / 10;         // Back to 0-10

    const gap = Math.abs(spokenAvg - mcqAvg);

    if (gap <= 2) return 100;  // Consistent
    if (gap <= 4) return 70;   // Slight mismatch
    if (gap <= 6) return 40;   // Significant mismatch
    return 15;                 // Major inconsistency
}

// ═══════════════════════════════════════════════════════════
// RISK FLAGS (Anti-AI Detection)
// ═══════════════════════════════════════════════════════════

function detectRiskFlags(session, spokenSlots, mcqSlots, codingSlots) {
    const flags = [];

    // 1. CONFIDENCE DECAY — strong first answer, weak follow-ups
    spokenSlots.forEach(slot => {
        if (!slot.evaluation || !slot.followUps) return;
        const mainQ = slot.evaluation.quality || 0;
        const fuScores = slot.followUps
            .filter(fu => fu.evaluation && fu.evaluation.quality)
            .map(fu => fu.evaluation.quality);

        if (mainQ >= 7 && fuScores.length > 0) {
            const avgFu = fuScores.reduce((a, b) => a + b, 0) / fuScores.length;
            if (avgFu <= 3) {
                flags.push({
                    type: 'confidence_decay',
                    severity: 'warning',
                    icon: '🟡',
                    label: 'Shallow Understanding',
                    detail: `Q${slot.index + 1}: Strong initial answer (${mainQ}/10) but collapsed on follow-up (${avgFu.toFixed(1)}/10)`,
                });
            }
        }
    });

    // 2. PASTE DETECTED in coding
    const signals = session.behaviorSignals || [];
    const pasteEvents = signals.filter(s => s.type === 'paste');
    if (pasteEvents.length > 0) {
        flags.push({
            type: 'paste_detected',
            severity: 'danger',
            icon: '🔴',
            label: 'Code Pasted',
            detail: `${pasteEvents.length} paste event(s) detected in coding editor`,
        });
    }

    // 3. INSTANT CODING — pre-written code
    codingSlots.forEach(slot => {
        const behavior = slot.behaviorData || {};
        if (behavior.timeToFirstKeystroke && behavior.timeToFirstKeystroke < 3000) {
            flags.push({
                type: 'instant_coding',
                severity: 'danger',
                icon: '🔴',
                label: 'Suspiciously Fast Coding',
                detail: `Started typing in ${(behavior.timeToFirstKeystroke / 1000).toFixed(1)}s — possible pre-written code`,
            });
        }
    });

    // 4. VOCABULARY JUMP — simple spoken, complex written
    const spokenWordLengths = [];
    const justificationWordLengths = [];

    spokenSlots.forEach(slot => {
        if (slot.answer && slot.answer !== '[SKIPPED]') {
            const words = slot.answer.split(/\s+/);
            words.forEach(w => spokenWordLengths.push(w.length));
        }
    });

    mcqSlots.forEach(slot => {
        if (slot.justification) {
            const words = slot.justification.split(/\s+/);
            words.forEach(w => justificationWordLengths.push(w.length));
        }
    });

    if (spokenWordLengths.length > 10 && justificationWordLengths.length > 5) {
        const avgSpoken = spokenWordLengths.reduce((a, b) => a + b, 0) / spokenWordLengths.length;
        const avgJustify = justificationWordLengths.reduce((a, b) => a + b, 0) / justificationWordLengths.length;

        if (avgJustify > avgSpoken + 2.5) {
            flags.push({
                type: 'vocabulary_jump',
                severity: 'warning',
                icon: '🟡',
                label: 'Vocabulary Inconsistency',
                detail: `Spoken avg word length: ${avgSpoken.toFixed(1)} → Justification: ${avgJustify.toFixed(1)} (possible AI-generated text)`,
            });
        }
    }

    // 5. MCQ-SPOKEN MISMATCH — MCQ correct but can't explain
    mcqSlots.forEach(slot => {
        if (slot.isCorrect && slot.justificationEval && slot.justificationEval.quality) {
            if (slot.justificationEval.quality <= 3) {
                flags.push({
                    type: 'mcq_spoken_mismatch',
                    severity: 'warning',
                    icon: '🟡',
                    label: 'Surface Knowledge',
                    detail: `Got MCQ correct but couldn't explain why (justification: ${slot.justificationEval.quality}/10)`,
                });
            }
        }
    });

    return flags;
}

// ─── GRADE BANDS ────────────────────────────────────────────
function getGrade(score) {
    if (score >= 90) return { letter: 'A+', label: 'Exceptional', color: '#00d2ff' };
    if (score >= 80) return { letter: 'A', label: 'Excellent', color: '#00ff88' };
    if (score >= 70) return { letter: 'B+', label: 'Very Good', color: '#88ff00' };
    if (score >= 60) return { letter: 'B', label: 'Good', color: '#c8ff00' };
    if (score >= 50) return { letter: 'C+', label: 'Average', color: '#ffcc00' };
    if (score >= 40) return { letter: 'C', label: 'Below Average', color: '#ff9900' };
    if (score >= 30) return { letter: 'D', label: 'Needs Improvement', color: '#ff6600' };
    return { letter: 'F', label: 'Not Ready', color: '#ff3333' };
}

module.exports = { computeScore, WEIGHTS };
