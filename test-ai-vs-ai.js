// Native fetch is available in Node 18+
require('dotenv').config();
const ai = require('./ai'); // Use the server's AI module to generate answers

const API = 'http://localhost:3000/api';

// Helper for delay to simulate natural speaking/coding
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getAIAnswer(question) {
    console.log(`\n🧠 Generating AI Answer for: "${question.substring(0, 50)}..."`);

    // Create a persona for the candidate
    const messages = [
        {
            role: 'system',
            content: `You are an expert Senior Software Engineer interviewing for a backend role.
            - Answer the question with high technical accuracy.
            - Use specific terminology (e.g., "idempotency", "ACID compliance", "Index scans").
            - Use the STAR method (Situation, Task, Action, Result) if asked about experience.
            - Keep answers concise but dense (approx 3-5 sentences).
            - Do NOT be vague. Be specific.`
        },
        { role: 'user', content: question }
    ];

    try {
        // Use a slightly higher temperature for creativity to avoid robotic repetition
        const answer = await ai.chatCompletion(messages, { temperature: 0.8, max_tokens: 150 });
        return answer.trim();
    } catch (err) {
        console.error('AI Generation Failed:', err);
        return "In my professional experience, I prioritize scalability and clean architecture. I ensure reliable systems through comprehensive testing and monitoring.";
    }
}

async function runTest() {
    console.log('🚀 Starting AI-vs-AI High Score Simulation...');

    try {
        // 1. Create Session
        const startRes = await fetch(`${API}/interview/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ candidateName: 'AI_Master', role: 'Senior Backend Engineer' })
        });
        const sessionData = await startRes.json();
        const sessionId = sessionData.sessionId;
        console.log(`✅ Session Created: ${sessionId}`);

        let currentData = sessionData;
        let qCount = 0;
        const LIMIT = 50;

        while (currentData.state !== 'COMPLETED' && qCount < LIMIT) {
            qCount++;
            const type = currentData.type || currentData.slotType || 'spoken';
            const qNum = currentData.questionNumber || qCount;

            console.log(`\n🔹 [Q${qNum}] Processing Type: ${type}`);

            let res;

            if (type === 'mcq') {
                await sleep(6000); // Simulate reading time

                // We still have to guess unless we parse the question heavily.
                // But let's assume 'A' is a reasonable default given we can't solve it strictly.
                // OR we can ask the AI "Which option is correct?"

                const options = currentData.options || [];
                const questionText = currentData.question;

                // Ask AI to solve MCQ
                let selected = options[0];
                if (options.length > 0) {
                    const mcqPrompt = `Question: "${questionText}"\nOptions:\n${options.join('\n')}\n\nWhich option is correct? Return ONLY the exact text of the correct option.`;
                    const aiChoice = await getAIAnswer(mcqPrompt);
                    // Try to match partial
                    const match = options.find(o => aiChoice.includes(o) || o.includes(aiChoice));
                    if (match) selected = match;
                }

                console.log(`   -> AI Selected MCQ Option: "${selected}"`);

                res = await fetch(`${API}/interview/mcq-answer`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId, selectedOption: selected, selectionTimeMs: 6000 })
                });

            } else if (type === 'mcq_justify') {
                await sleep(4000);
                const justification = await getAIAnswer(`I selected an option for the question. Explain why proper engineering practices are important in this context. Keep it short.`);
                console.log(`   -> Submitting MCQ Justification...`);
                res = await fetch(`${API}/interview/mcq-justify`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId, justification })
                });

            } else if (type === 'coding') {
                console.log(`   -> Submitting Coding Answer...`);
                await sleep(2000);

                const problem = currentData.problem || "Solve the problem";

                // Ask AI to write code
                const codePrompt = `Write a JavaScript solution for: "${problem}". Provide ONLY the code inside a function solution() block. High quality, optimized O(n).`;
                let perfectCode = await getAIAnswer(codePrompt);
                // Strip markdown if present
                perfectCode = perfectCode.replace(/```javascript/g, '').replace(/```/g, '');

                const explanation = await getAIAnswer(`Explain the time and space complexity of an O(n) solution for: "${problem}".`);

                res = await fetch(`${API}/interview/code-submit`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sessionId,
                        code: perfectCode,
                        explanation: explanation,
                        behaviorData: {
                            pasteEvents: 0,
                            timeToFirstKeystroke: 4500,
                            totalTimeMs: 45000,
                            editPattern: ['type', 'type', 'delete', 'type'] // minimal fake data
                        }
                    })
                });

            } else { // Spoken
                const questionText = currentData.question || "";
                console.log(`   -> Question: "${questionText}"`);

                const answer = await getAIAnswer(questionText);

                console.log(`   -> Generated Answer (${answer.length} chars)`);
                await sleep(5000 + (answer.length * 5)); // Natural reading speed simulation

                res = await fetch(`${API}/interview/answer`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId, answer })
                });
            }

            currentData = await res.json();

            if (currentData.error) {
                console.error('❌ Error response:', currentData.error);
                break;
            }
            console.log(`   -> Next: ${currentData.state}`);
        }

        console.log('\n==========================================');
        console.log('Phase 3: Fetching Final Transcript & Score...');
        const transRes = await fetch(`${API}/interview/${sessionId}/transcript`);
        const transData = await transRes.json();

        console.log('🏁 AI CANDIDATE RESULTS');
        console.log('==========================================');

        if (transData.analysis || transData.score) {
            const score = transData.analysis || transData.score;
            console.log('✅ Scoring Object Found!');
            console.log('Overall Score:', score.overall);
            console.log('Grade:', score.grade);
            console.log('Risk Flags:', score.riskFlags.length);
            // console.log('Breakdown:', JSON.stringify(score.breakdown, null, 2));
        } else {
            console.log('❌ No Analysis/Score found.');
        }

    } catch (err) {
        console.error('❌ Test Failed:', err);
    }
}

runTest();
