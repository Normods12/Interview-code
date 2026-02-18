
const tts = require('./tts'); // My module

async function test() {
    console.log('Testing TTS module...');
    const res = await tts.generateSpeech('This is a test of the Edge TTS system.');
    console.log('Result:', res);
}

test();
