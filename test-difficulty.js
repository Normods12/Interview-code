// Native fetch is available in Node 18+
require('dotenv').config();

const API = 'http://localhost:3000/api';

async function runLevelTest(level) {
    console.log(`\n🚀 Starting Test for Level: ${level.toUpperCase()}...`);

    // 1. Create Session
    const startRes = await fetch(`${API}/interview/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateName: `Tester_${level}`, role: 'Java Core Developer', difficulty: level })
    });
    const session = await startRes.json();
    console.log(`✅ Session Created: ${session.sessionId}`);
    console.log(`   -> First Question: "${session.question}"`);

    // 2. Submit a generic "Okay" answer to see how it's graded
    const answer = "Java is an object-oriented programming language. It is platform independent because of the JVM.";
    console.log(`   -> Submitting Answer: "${answer}"`);

    // We need to wait a bit to avoid "instant answer" penalty if any
    await new Promise(r => setTimeout(r, 2000));

    // 3. Get Q2 (Technical Question)
    // Submit answer to Q1
    const res1 = await fetch(`${API}/interview/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, answer })
    });
    const state1 = await res1.json();

    // If follow-ups, skip them? No, let's just assume we get to Q2 eventualy.
    // Actually, force skip to Q2 via /api/interview/skip helper if available or just answer continuously.

    let current = state1;
    let qCount = 1;
    while (current.questionNumber === 1 && qCount < 5) {
        console.log(`   -> Answering Follow-up (${current.question.substring(0, 30)}...)`);
        const fRes = await fetch(`${API}/interview/answer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: session.sessionId, answer: "I'm not sure about the details." })
        });
        current = await fRes.json();
        qCount++;
    }

    console.log(`   -> Q2 Question: "${current.question}"`);
    return current.question;
}

async function runComparison() {
    try {
        const qEasy = await runLevelTest('very_easy');
        const qExpert = await runLevelTest('expert');

        console.log('\n📊 QUESTION COMPARISON');
        console.log('==========================================');
        console.log(`Very Easy Q2: "${qEasy}"`);
        console.log(`Expert Q2:    "${qExpert}"`);

    } catch (err) {
        console.error('Test Failed:', err);
    }
}

runComparison();
