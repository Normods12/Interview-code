// Native fetch is available in Node 18+

/*
 * Test Script: Simulate Full Interview to Verify Scoring
 * 
 * Flow:
 * 1. Create Session
 * 2. Submit Answers for 3 Spoken Questions
 * 3. Submit Answer for 1 MCQ
 * 4. Submit Answer for 1 Coding Question
 * 5. Complete Interview
 * 6. Print Score
 */

const API = 'http://localhost:3000/api';

async function runTest() {
    console.log('🚀 Starting Scoring Verification Test (Smart Mode)...');

    try {
        // 1. Create Session
        const startRes = await fetch(`${API}/interview/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ candidateName: 'TestUser', role: 'Tester' })
        });
        const sessionData = await startRes.json();
        const sessionId = sessionData.sessionId;
        console.log(`✅ Session Created: ${sessionId}`);

        let currentData = sessionData;
        let qCount = 0;
        const LIMIT = 50;

        while (currentData.state !== 'COMPLETED' && qCount < LIMIT) {
            qCount++;
            const qNum = currentData.questionNumber || qCount;
            const type = currentData.type || currentData.slotType || 'spoken';

            console.log(`\n🔹 [Q${qNum}] Processing Type: ${type}`);

            let res;

            if (type === 'mcq') { // Handle MCQ Selection
                // Pick first option
                const options = currentData.options || ["Option A", "Option B"];
                const selected = options[0];
                console.log(`   -> Submitting MCQ Option: "${selected}"`);

                res = await fetch(`${API}/interview/mcq-answer`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId, selectedOption: selected, selectionTimeMs: 1500 })
                });

            } else if (type === 'mcq_justify') { // Handle MCQ Justification
                console.log(`   -> Submitting MCQ Justification...`);
                res = await fetch(`${API}/interview/mcq-justify`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId, justification: "Because option A covers critical functionality validation." })
                });

            } else if (type === 'coding') { // Handle Coding
                console.log(`   -> Submitting Coding Answer...`);

                // A generic "Perfect" solution template
                const perfectCode = `
/**
 * Optimized Solution
 * Time Complexity: O(n)
 * Space Complexity: O(1)
 */
function solution(input) {
    if (!input) return null;
    // robust validation
    
    // Efficient processing
    // const result = input.filter(x => x !== null);
    // return result;
    return true; 
}
`;

                res = await fetch(`${API}/interview/code-submit`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sessionId,
                        code: perfectCode,
                        explanation: "I implemented an O(n) solution using functional programming patterns for readability and efficiency. Edge cases are handled explicitly.",
                        behaviorData: {
                            pasteEvents: 0,
                            timeToFirstKeystroke: 2000,
                            totalTimeMs: 45000,
                            editPattern: ['type', 'type', 'delete', 'type']
                        }
                    })
                });

            } else { // Spoken or others
                const questionText = currentData.question || "";
                let answer = "In my professional experience, I approach this by ensuring scalability and maintainability. I utilize design patterns like Singleton or Factory where appropriate, and I always prioritize writing clean, testable code. For distributed systems, I focus on eventual consistency and partition tolerance.";

                if (questionText.toLowerCase().includes('intro')) {
                    answer = "Hi, I'm a Senior Software Engineer with 8 years of experience. I have architected scalable microservices and led teams of 5 developers. I am passionate about code quality and performance optimization.";
                }

                console.log(`   -> Submitting Spoken Answer: "${answer.substring(0, 50)}..."`);
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

            console.log(`   -> New State: ${currentData.state}`);
        }

        // Fetch Transcript/Analysis independently
        console.log('\n==========================================');
        console.log('Phase 3: Fetching Final Transcript & Score...');
        const transRes = await fetch(`${API}/interview/${sessionId}/transcript`);
        const transData = await transRes.json();

        console.log('🏁 TEST RESULTS');
        console.log('==========================================');

        if (transData.analysis || transData.score) {
            const score = transData.analysis || transData.score;
            console.log('✅ Scoring Object Found!');
            console.log('Overall Score:', score.overall);
            console.log('Grade:', score.grade);
            // console.log('Breakdown:', JSON.stringify(score.breakdown, null, 2));
        } else {
            console.log('❌ No Analysis/Score found.');
            console.log('Final Data:', JSON.stringify(transData, null, 2));
        }

    } catch (err) {
        console.error('❌ Test Failed:', err);
    }
}

runTest();
