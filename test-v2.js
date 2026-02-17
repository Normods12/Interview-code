// ============================================================
// test-v2.js — Automated E2E test for Interview AI V2
// ============================================================
// Tests: start → spoken answers → MCQ → coding → completion
// Run: node test-v2.js
// ============================================================

const BASE = 'http://localhost:3000/api';

async function api(endpoint, body) {
    const res = await fetch(`${BASE}${endpoint}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
}

function log(label, data) {
    const type = data.type || data.slotType || '?';
    const state = data.state || '?';
    const qn = data.questionNumber || '?';
    const q = (data.question || data.problem || '').substring(0, 80);
    console.log(`  [${label}] Q${qn} | type=${type} | state=${state}`);
    console.log(`    "${q}${q.length >= 80 ? '...' : ''}"`);
    if (data.options) console.log(`    Options: ${data.options.length} choices`);
    if (data.isFollowUp) console.log(`    ↳ Follow-up depth ${data.followUpDepth}`);
}

async function test() {
    console.log('\n🧪 V2 End-to-End Test\n');

    // 1. Start interview
    console.log('─── STEP 1: Start Interview ───');
    const start = await api('/interview/start', {
        role: 'Java Backend Developer',
        candidateName: 'AutoTest',
    });
    const sid = start.sessionId;
    console.log(`  Session: ${sid}`);
    log('START', start);

    let current = start;
    let step = 2;
    let errors = [];

    while (current.state !== 'COMPLETED') {
        const type = current.type || current.slotType;

        console.log(`\n─── STEP ${step}: Handle ${type} ───`);

        try {
            if (type === 'mcq') {
                // MCQ: select first option
                if (!current.options || current.options.length === 0) {
                    errors.push(`Q${current.questionNumber}: MCQ has NO OPTIONS`);
                    console.log('  ❌ MCQ has no options! Skipping...');
                    current = await api('/interview/skip', { sessionId: sid });
                    log('SKIP', current);
                } else {
                    const pick = current.options[0];
                    console.log(`  Selecting: "${pick}"`);
                    current = await api('/interview/mcq-answer', {
                        sessionId: sid,
                        selectedOption: pick,
                        selectionTimeMs: 5000,
                    });
                    log('MCQ-ANSWER', current);

                    // Should get mcq_justify
                    if (current.type === 'mcq_justify') {
                        console.log('  ✅ Got MCQ justify prompt');
                        current = await api('/interview/mcq-justify', {
                            sessionId: sid,
                            justification: 'I chose A because it is the most commonly used approach in Spring framework for this purpose.',
                        });
                        log('MCQ-JUSTIFY', current);
                    } else {
                        errors.push(`Q${current.questionNumber}: Expected mcq_justify but got ${current.type}`);
                        console.log(`  ⚠️ Expected mcq_justify, got ${current.type}`);
                    }
                }

            } else if (type === 'coding') {
                // Coding: submit code
                console.log('  Submitting code...');
                current = await api('/interview/code-submit', {
                    sessionId: sid,
                    code: 'function solution(arr) {\n  return arr.filter(n => n >= 0 && n % 2 === 0).reduce((a, b) => a + b, 0);\n}',
                    explanation: 'I filter out negative and odd numbers, then sum the remaining even values using reduce.',
                    behaviorData: { pasteEvents: 0, timeToFirstKeystroke: 2000, totalTimeMs: 45000 },
                });
                log('CODE-SUBMIT', current);

            } else if (type === 'mcq_justify') {
                // Shouldn't happen as first type, but handle it
                current = await api('/interview/mcq-justify', {
                    sessionId: sid,
                    justification: 'I believe this is correct based on my understanding of the concept.',
                });
                log('MCQ-JUSTIFY', current);

            } else if (type === 'coding_interrupt') {
                current = await api('/interview/interrupt-response', {
                    sessionId: sid,
                    response: 'I chose this approach because it is efficient and readable.',
                });
                log('INTERRUPT-RESP', current);

            } else if (type === 'coding_resume') {
                console.log('  Resuming coding... submitting again');
                current = await api('/interview/code-submit', {
                    sessionId: sid,
                    code: 'function solution(arr) {\n  return arr.filter(n => n >= 0 && n % 2 === 0).reduce((a, b) => a + b, 0);\n}',
                    explanation: 'Same approach - filter and reduce.',
                    behaviorData: { pasteEvents: 0, timeToFirstKeystroke: 1000, totalTimeMs: 60000 },
                });
                log('CODE-RESUBMIT', current);

            } else {
                // Spoken: answer the question
                const answer = generateAnswer(current.questionNumber, current.question);
                console.log(`  Answer: "${answer.substring(0, 60)}..."`);
                current = await api('/interview/answer', {
                    sessionId: sid,
                    answer: answer,
                });
                log('ANSWER', current);
            }
        } catch (err) {
            console.error(`  ❌ ERROR: ${err.message}`);
            errors.push(`Step ${step}: ${err.message}`);
            // Try to skip and continue
            try {
                current = await api('/interview/skip', { sessionId: sid });
                log('SKIP-RECOVERY', current);
            } catch (e2) {
                console.error('  ❌ FATAL: Could not recover');
                break;
            }
        }

        step++;
        if (step > 50) {
            errors.push('Exceeded 50 steps — infinite loop?');
            break;
        }
    }

    // Final summary
    console.log('\n═══════════════════════════════════════');
    if (current.state === 'COMPLETED') {
        console.log('✅ INTERVIEW COMPLETED SUCCESSFULLY');
        if (current.summary) {
            const s = current.summary;
            console.log(`  Total: ${s.totalQuestions} questions`);
            console.log(`  Spoken: ${s.spokenQuestions}, MCQs: ${s.mcqQuestions}, Coding: ${s.codingQuestions}`);
            console.log(`  Avg Quality: ${s.averageQuality}/10`);
            console.log(`  Duration: ${s.durationFormatted}`);
        }
    } else {
        console.log('❌ INTERVIEW DID NOT COMPLETE');
    }

    if (errors.length > 0) {
        console.log(`\n⚠️ ${errors.length} ISSUES FOUND:`);
        errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
    } else {
        console.log('\n🎉 No issues found!');
    }

    // Get transcript
    console.log('\n─── TRANSCRIPT CHECK ───');
    const transcript = await api(`/interview/${sid}/transcript`);
    if (transcript.slots) {
        transcript.slots.forEach((slot, i) => {
            const t = slot.type === 'mcq' ? '📋' : slot.type === 'coding' ? '💻' : '🎤';
            const a = slot.answer || slot.selectedOption || slot.code || '[empty]';
            console.log(`  ${t} Q${i + 1}: ${(slot.question || '').substring(0, 50)}...`);
            console.log(`     Answer: ${a.substring(0, 50)}${a.length > 50 ? '...' : ''}`);
        });
    }

    console.log('\n═══════════════════════════════════════\n');
    process.exit(errors.length > 0 ? 1 : 0);
}

function generateAnswer(qNum, question) {
    const answers = {
        1: 'I started learning Java in college, focused on OOP concepts, then moved to Spring Boot for building REST APIs. I have worked on projects like employee management and library systems.',
        2: 'In Java, I use HashMap for key-value lookups. Internally it uses an array of buckets with linked lists for collision handling. The hashCode determines the bucket index.',
        3: 'I would use connection pooling with HikariCP to manage database connections efficiently. Each request gets a connection from the pool and returns it after use.',
        5: 'I would use Spring Data JPA with Hibernate for ORM mapping. For complex queries I use native SQL or JPQL. The repository pattern abstracts the data access layer.',
        6: 'HTTP is unsecured and data is sent in plain text. HTTPS uses TLS encryption to secure data in transit. As a backend developer, I configure SSL certificates and redirect HTTP to HTTPS.',
        8: 'I use prepared statements to prevent SQL injection and enable query plan caching. I also add database indexes on frequently queried columns and use pagination for large result sets.',
        10: 'JVM garbage collection pauses can affect latency in microservices. I would tune the GC settings, use G1 collector for balanced throughput and latency, and monitor with JMX metrics.',
    };
    return answers[qNum] || `For the question about "${(question || '').substring(0, 30)}", I would approach this by analyzing the requirements, implementing a clean solution using standard Java practices, and testing thoroughly.`;
}

test().catch(err => {
    console.error('FATAL:', err);
    process.exit(1);
});
