// test-api.js — Quick API smoke test for V1
const http = require('http');

function post(path, data) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const req = http.request({
            hostname: 'localhost',
            port: 3000,
            path,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        }, (res) => {
            let chunks = '';
            res.on('data', d => chunks += d);
            res.on('end', () => {
                try { resolve(JSON.parse(chunks)); } catch { resolve(chunks); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function main() {
    console.log('=== Interview AI v1 — API Smoke Test ===\n');

    // 1. Start interview
    console.log('1. Starting interview...');
    const start = await post('/api/interview/start', {
        role: 'Java Backend Developer',
        candidateName: 'Test Student',
    });
    console.log('   Session ID:', start.sessionId);
    console.log('   First question:', start.question);
    console.log('   State:', start.state);
    console.log('');

    // 2. Submit first answer
    console.log('2. Submitting answer to Q1...');
    const r1 = await post('/api/interview/answer', {
        sessionId: start.sessionId,
        answer: 'HashMap is a data structure that stores key-value pairs. It uses hashing internally to determine where to store each entry.',
    });
    console.log('   Next question:', r1.question);
    console.log('   Is follow-up:', r1.isFollowUp);
    console.log('   State:', r1.state);
    console.log('');

    // 3. Submit follow-up answer
    console.log('3. Submitting answer to follow-up...');
    const r2 = await post('/api/interview/answer', {
        sessionId: start.sessionId,
        answer: 'The hashCode method is called on the key object, and the result is used to determine the bucket index.',
    });
    console.log('   Next question:', r2.question);
    console.log('   Is follow-up:', r2.isFollowUp);
    console.log('   State:', r2.state);
    console.log('');

    console.log('=== Smoke test passed! ===');
}

main().catch(err => {
    console.error('Test failed:', err.message);
    process.exit(1);
});
