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

// Helper for delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Smart Answer Bank
function getSmartAnswer(question) {
    const q = question.toLowerCase();

    if (q.includes('intro') || q.includes('yourself')) {
        return "Hi, I'm a Senior Full Stack Engineer with 8 years of experience building scalable distributed systems. I specialize in Node.js and React, and I've led the migration of monolithic architectures to microservices for high-traffic platforms.";
    }
    if (q.includes('test') || q.includes('quality') || q.includes('bug')) {
        return "I advocate for the Testing Pyramid code. I write comprehensive unit tests using Jest for individual components, integration tests for API endpoints, and end-to-end tests with Cypress for critical user flows. I also implement CI/CD pipelines to run these tests automatically on every commit.";
    }
    if (q.includes('scale') || q.includes('scali') || q.includes('traffic')) {
        return "To handle high scalability, I focus on horizontal scaling and stateless architecture. I use load balancers to distribute traffic, implementing caching strategies with Redis to reduce database load, and asynchronous processing with message queues like RabbitMQ for non-blocking operations.";
    }
    if (q.includes('database') || q.includes('sql') || q.includes('data')) {
        return "I choose databases based on the CAP theorem constraints of the project. For relational data with strict ACID requirements, I use PostgreSQL. For unstructured high-volume data, I prefer NoSQL solutions like MongoDB or Cassandra, ensuring proper indexing to optimize query performance.";
    }
    if (q.includes('security') || q.includes('secure') || q.includes('attack')) {
        return "Security is a priority in my development lifecycle. I follow OWASP top 10 guidelines, sanitizing all inputs to prevent SQL injection and XSS. I implement proper authentication using OAuth2/JWT and ensure all data in transit and at rest is encrypted.";
    }
    if (q.includes('edge') || q.includes('fail') || q.includes('error')) {
        return "Handling edge cases is critical. I use rigorous input validation and defensive programming techniques. For system failures, I implement circuit breakers and exponential backoff retries to prevent cascading failures, ensuring the system degrades gracefully.";
    }

    return "That's an excellent question. In my experience, the key is to prioritize maintainability and clean code principles. I break down complex problems into smaller, modular components, ensuring separation of concerns. This approach not only makes the codebase easier to debug but also facilitates smoother collaboration within the team.";
}

const API = 'http://localhost:3000/api';

async function runTest() {
    console.log('🚀 Starting Scoring Verification Test (Max Score Mode)...');

    try {
        // 1. Create Session
        const startRes = await fetch(`${API}/interview/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ candidateName: 'ProCandidate', role: 'Senior Backend Engineer' })
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
                // Assume Option A for now, but in a real "max score" attempt we'd need the answer key.
                // We simulate a thoughtful delay of 8 seconds.
                await sleep(8000);

                const options = currentData.options || ["Option A", "Option B"];
                const selected = options[0]; // Still guessing A
                console.log(`   -> Submitting MCQ Option: "${selected}"`);

                res = await fetch(`${API}/interview/mcq-answer`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId, selectedOption: selected, selectionTimeMs: 8000 })
                });

            } else if (type === 'mcq_justify') { // Handle MCQ Justification
                await sleep(5000);
                const justification = "I selected this option because it directly addresses the core requirements of stability and performance mentioned in the scenario, unlike the other options which introduce unnecessary complexity.";
                console.log(`   -> Submitting MCQ Justification...`);
                res = await fetch(`${API}/interview/mcq-justify`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId, justification })
                });

            } else if (type === 'coding') { // Handle Coding
                console.log(`   -> Submitting Coding Answer...`);
                // Simulate coding time
                await sleep(2000);

                const perfectCode = `
/**
 * Optimized Solution
 * Time Complexity: O(n)
 * Space Complexity: O(1)
 */
function solution(input) {
    if (!input || !Array.isArray(input)) return [];
    
    // Efficient processing using a Set for O(1) lookups if needed
    // or typically a single pass map/reduce
    
    return input.filter(x => x !== null && x !== undefined);
}
`;
                res = await fetch(`${API}/interview/code-submit`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sessionId,
                        code: perfectCode,
                        explanation: "I implemented a linear time complexity O(n) solution. I added robust input validation to handle null or invalid types immediately. The core logic uses built-in array methods for readability and performance.",
                        behaviorData: {
                            pasteEvents: 0,
                            timeToFirstKeystroke: 5000, // > 3s to avoid 'Instant Coding' penalty
                            totalTimeMs: 65000,       // > 30s to avoid speed penalty
                            editPattern: ['type', 'type', 'delete', 'type', 'nav']
                        }
                    })
                });

            } else { // Spoken or others
                const questionText = currentData.question || "";
                console.log(`   -> Question: "${questionText.substring(0, 60)}..."`);

                const answer = getSmartAnswer(questionText);

                // SIMULATE THINKING/SPEAKING TIME
                // Spoken answers < 5s are flagged. We wait 6s.
                console.log(`   -> Speaking (${answer.length} chars)...`);
                await sleep(6500);

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
            console.log('Risk Flags:', score.riskFlags);
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
