// ============================================================
// test-v3.js — Automated V3 Test (Scoring + TTS + Anti-AI)
// ============================================================
// Tests:
// 1. TTS Generation
// 2. Full Interview Flow with fast answers (to trigger risk flags)
// 3. Score calculation & breakdown verification
// ============================================================

const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000/api';

async function api(endpoint, body) {
    const res = await fetch(`${BASE}${endpoint}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    // For TTS, return the response object itself if it's not JSON
    if (endpoint.includes('/tts')) return res;
    return res.json();
}

async function test() {
    console.log('\n🧪 V3 End-to-End Test (Scoring + TTS + Anti-AI)\n');

    // ─── PART 1: TTS TEST ───────────────────────────────────────
    console.log('─── STEP 1: Testing TTS Endpoint ───');
    try {
        const text = "Welcome to the V3 interview system.";
        const ttsRes = await api(`/tts?text=${encodeURIComponent(text)}`);

        if (ttsRes.status === 200) {
            const type = ttsRes.headers.get('content-type');
            if (type.includes('audio')) {
                console.log(`  ✅ TTS Success: Received audio/mpeg (${type})`);
            } else if (type.includes('json')) {
                const json = await ttsRes.json();
                if (json.fallback) {
                    console.log('  ⚠️ TTS Fallback: Server returned fallback flag (Edge TTS might be down/slow)');
                } else {
                    console.log('  ❌ TTS Error: Unexpected JSON response', json);
                }
            }
        } else {
            console.log(`  ❌ TTS Failed: Status ${ttsRes.status}`);
        }
    } catch (e) {
        console.log(`  ❌ TTS Exception: ${e.message}`);
    }

    // ─── PART 2: INTERVIEW FLOW ─────────────────────────────────
    console.log('\n─── STEP 2: Running Assessment ───');
    const start = await api('/interview/start', {
        role: 'Python Developer',
        candidateName: 'V3Tester',
    });
    const sid = start.sessionId;
    console.log(`  Session: ${sid}`);

    let current = start;
    let step = 1;

    // We'll intentionally trigger some risk flags:
    // 1. Fast spoken answers (< 5s) -> Behavioral Trust hit
    // 2. Short poor answers -> Lower Quality score

    while (current.state !== 'COMPLETED' && step < 20) {
        const type = current.type || current.slotType;
        console.log(`  [Step ${step}] Processing ${type}...`);

        try {
            if (type === 'mcq') {
                // Pick correct answer if possible (simulating luck/knowledge)
                const options = current.options || [];
                const pick = options[0] || 'A';
                current = await api('/interview/mcq-answer', {
                    sessionId: sid,
                    selectedOption: pick,
                    selectionTimeMs: 4000,
                });

                if (current.type === 'mcq_justify') {
                    current = await api('/interview/mcq-justify', {
                        sessionId: sid,
                        justification: 'I guessed A.', // Weak justification -> Mismatch risk?
                    });
                }
            } else if (type === 'coding') {
                // Instant coding submission -> Instant Coding risk
                current = await api('/interview/code-submit', {
                    sessionId: sid,
                    code: 'print("Hello World")',
                    explanation: 'Simple print.',
                    behaviorData: {
                        pasteEvents: 1,           // Risk: Paste
                        timeToFirstKeystroke: 500, // Risk: Instant (< 3s)
                        totalTimeMs: 5000         // Risk: Fast total
                    },
                });
            } else if (type === 'coding_interrupt') {
                current = await api('/interview/interrupt-response', {
                    sessionId: sid,
                    response: 'Ok.',
                });
            } else if (type === 'coding_resume') {
                current = await api('/interview/code-submit', {
                    sessionId: sid,
                    code: 'print("Hello World Again")',
                    explanation: 'Fixed it.',
                    behaviorData: { pasteEvents: 0, timeToFirstKeystroke: 1000, totalTimeMs: 10000 },
                });
            } else {
                // Spoken: Fast answer to trigger 'Fast Answers' penalty in trust
                current = await api('/interview/answer', {
                    sessionId: sid,
                    answer: 'This is a short generic answer to make the interview go faster.',
                });
            }
        } catch (err) {
            console.log(`  ⚠️ Error at step ${step}: ${err.message}`);
            // Try to skip if stuck
            try {
                current = await api('/interview/skip', { sessionId: sid });
            } catch (e) {
                break;
            }
        }
        step++;
    }

    // ─── PART 3: VERIFY SCORE ───────────────────────────────────
    console.log('\n─── STEP 3: Verifying Score & flags ───');
    if (current.state === 'COMPLETED' && current.score) {
        const s = current.score;
        console.log(`  ✅ Score Generated: ${s.overall}/100`);
        console.log(`  Grade: ${s.grade.letter} (${s.grade.label})`);

        console.log('\n  Breakdown:');
        console.log(`    Answer Quality: ${s.breakdown.answerQuality}%`);
        console.log(`    Behavioral Trust: ${s.breakdown.behavioralTrust}% (Expect < 100)`);

        console.log('\n  Risk Flags Triggered:');
        if (s.riskFlags && s.riskFlags.length > 0) {
            s.riskFlags.forEach(f => console.log(`    ⚠️ [${f.type}] ${f.label}: ${f.detail}`));
        } else {
            console.log('    No risk flags (Unexpected given our inputs)');
        }

        // Verify we got the expected penalties
        const trustLost = s.breakdown.behavioralTrust < 90;
        const risksFound = s.riskFlags.length > 0;

        if (trustLost && risksFound) {
            console.log('\n✅ TEST PASSED: Scoring engine correctly identified suspicious behavior.');
        } else {
            console.log('\n⚠️ TEST WARNING: Did not trigger expected penalties.');
        }

    } else {
        console.log('  ❌ Error: No score returned in completion state.');
        console.log(JSON.stringify(current, null, 2));
    }
}

test();
