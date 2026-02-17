// ============================================================
// ai.js — OpenRouter API Wrapper (Interview AI Platform v2)
// ============================================================
// All AI interactions go through this module.
// V2: Added MCQ generation, coding questions, interruptions
// ============================================================

require('dotenv').config();

const API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.OPENROUTER_MODEL || 'mistralai/mistral-7b-instruct';
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Send a chat completion request to OpenRouter
 */
async function chatCompletion(messages, options = {}) {
    const body = {
        model: MODEL,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.max_tokens ?? 1024,
    };

    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`,
            'HTTP-Referer': 'http://localhost:3000',
            'X-Title': 'Interview AI Platform',
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenRouter API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
}

// ─── SYSTEM PROMPT ──────────────────────────────────────────

const SYSTEM_PROMPT = `You are a real human technical interviewer sitting across the table from a candidate.

CRITICAL OUTPUT RULES:
- NEVER start with filler words like "Got it", "Sure", "Okay", "Great", "Alright", "So"
- NEVER use markdown formatting (no bold, italic, bullets, quotes)
- NEVER combine two questions into one — ask ONE thing at a time
- Keep every question to ONE short sentence
- Just output the question directly, nothing else

SPEAKING STYLE:
- Talk like a REAL person, not a chatbot
- Casual-professional tone: "Tell me about...", "Walk me through...", "What happens when..."

GOOD examples:
- "How does HashMap work internally?"
- "What happens when two keys have the same hash code?"
- "Why would you pick an interface over an abstract class?"

BAD examples (NEVER do this):
- "Got it. So what kind of projects have you worked on?" (starts with filler)
- "How does garbage collection work in Java, and can you explain the difference between young and old generation?" (two questions in one)
- Any question longer than 15 words

BEHAVIOR:
- Test understanding, not memorization
- Follow-ups based on candidate's own words
- Interrupt naturally: "Why?", "What if...?", "But how?"`;

// ─── SPOKEN QUESTION GENERATION ─────────────────────────────

async function generateQuestion(role, questionNumber, difficulty = 'easy', previousTopics = []) {
    const avoidTopics = previousTopics.length > 0
        ? `\nDo NOT ask about these topics (already covered): ${previousTopics.join(', ')}`
        : '';

    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
            role: 'user',
            content: `Ask interview question #${questionNumber} for a ${role} fresher.
Difficulty: ${difficulty}.
${questionNumber === 1 ? 'Warm-up — something like "Tell me about yourself" or "What tech are you most comfortable with?"' : 'Ask about ONE core technical concept for this role.'}${avoidTopics}

RULES:
- ONE sentence only, max 12-15 words
- Ask only ONE thing, never combine two topics
- Do NOT start with filler words (Got it, Sure, Okay, So, Great)
- Return ONLY the raw question text, nothing else`
        }
    ];

    return (await chatCompletion(messages, { temperature: 0.8, max_tokens: 100 })).trim();
}

// ─── FOLLOW-UP GENERATION ───────────────────────────────────

async function generateFollowUp(originalQuestion, candidateAnswer, followUpDepth = 1) {
    const probeStyle = followUpDepth === 1
        ? 'Pick ONE specific thing they said and ask about it. Keep it short — like "Why?" or "What do you mean by X?" or "What happens if Y?"'
        : 'Go one level deeper. Challenge something or change a constraint. Examples: "But why not Z instead?", "What if the input is null?", "Can you explain that more simply?"';

    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `You asked: "${originalQuestion}"` },
        { role: 'user', content: `Candidate said: "${candidateAnswer}"` },
        {
            role: 'user',
            content: `Generate a SHORT follow-up. ${probeStyle}
MAX 1-2 sentences. Talk like a real interviewer interrupting naturally.
Return ONLY the follow-up question, nothing else, no formatting.`
        }
    ];

    return (await chatCompletion(messages, { temperature: 0.75, max_tokens: 80 })).trim();
}

// ─── MCQ GENERATION ─────────────────────────────────────────

async function generateMCQ(role, difficulty = 'medium', previousTopics = []) {
    const avoidTopics = previousTopics.length > 0
        ? `\nDo NOT use these topics (already covered): ${previousTopics.join(', ')}`
        : '';

    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
            role: 'user',
            content: `Generate a multiple choice question for a ${role} fresher interview.
Difficulty: ${difficulty}.${avoidTopics}

Return ONLY a valid JSON object (no markdown, no code fences):
{
  "question": "short question text, max 15 words",
  "options": ["A) option1", "B) option2", "C) option3", "D) option4"],
  "correct": "A",
  "topic": "topic name"
}`
        }
    ];

    const raw = await chatCompletion(messages, { temperature: 0.7, max_tokens: 300 });
    try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.question && Array.isArray(parsed.options) && parsed.options.length >= 2) {
                return parsed;
            }
            console.warn('[AI] MCQ parsed but missing options, using fallback');
        }
    } catch (e) {
        console.warn('[AI] MCQ JSON parse failed, using fallback:', e.message);
    }

    return {
        question: 'Which keyword is used to prevent method overriding in Java?',
        options: ['A) static', 'B) final', 'C) abstract', 'D) volatile'],
        correct: 'B',
        topic: 'Java basics',
    };
}

async function generateMCQFollowUp(mcqQuestion, selectedOption, correctOption) {
    const isCorrect = selectedOption === correctOption;
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
            role: 'user',
            content: `Candidate was asked: "${mcqQuestion}"
They chose: ${selectedOption}${isCorrect ? ' (correct)' : ` (wrong, correct was ${correctOption})`}

Ask a SHORT follow-up: "Why did you pick that?" or "Why not the other options?"
ONE sentence only. Return ONLY the question.`
        }
    ];

    return (await chatCompletion(messages, { temperature: 0.7, max_tokens: 60 })).trim();
}

// ─── CODING QUESTION GENERATION ─────────────────────────────

async function generateCodingQuestion(role, difficulty = 'easy') {
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
            role: 'user',
            content: `Generate a simple coding question for a ${role} fresher.
Difficulty: ${difficulty}.

Rules:
- Simple logic-based problem (NOT trick questions)
- Solvable in 10-15 lines of code
- JavaScript language

Return ONLY a valid JSON object (no markdown, no code fences):
{
  "problem": "short problem description, 1-2 sentences max",
  "example_input": "sample input",
  "example_output": "expected output",
  "topic": "topic name"
}`
        }
    ];

    const raw = await chatCompletion(messages, { temperature: 0.7, max_tokens: 300 });
    try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch (e) { }

    return {
        problem: 'Write a function that checks if a number is prime.',
        example_input: '7',
        example_output: 'true',
        topic: 'logic',
    };
}

async function generateCodingInterruption(code, problem) {
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
            role: 'user',
            content: `Candidate is solving: "${problem}"
Their code so far:
${code}

Ask ONE short interruption question about their approach. Examples:
- "Why this approach?"
- "What's the time complexity?"
- "What if the input is negative?"

ONE sentence only. Return ONLY the question.`
        }
    ];

    return (await chatCompletion(messages, { temperature: 0.7, max_tokens: 60 })).trim();
}

// ─── ANSWER EVALUATION ─────────────────────────────────────

async function evaluateAnswer(question, answer) {
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
            role: 'user',
            content: `Evaluate this interview answer.

Question: "${question}"
Answer: "${answer}"

Return ONLY a valid JSON object (no markdown, no code fences):
{
  "answer_quality": <number 1-10>,
  "concept_coverage": [<concepts mentioned>],
  "confidence": <0.0-1.0>,
  "clarity": <"low" | "medium" | "high">,
  "brief_feedback": "<one sentence>"
}`
        }
    ];

    const raw = await chatCompletion(messages, { temperature: 0.3 });
    try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch (e) { }

    return {
        answer_quality: 5,
        concept_coverage: [],
        confidence: 0.5,
        clarity: 'medium',
        brief_feedback: 'Could not parse AI evaluation.',
    };
}

async function evaluateCodingAnswer(problem, code, explanation) {
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
            role: 'user',
            content: `Evaluate this coding submission.

Problem: "${problem}"
Code: ${code}
Explanation: "${explanation || 'none provided'}"

Return ONLY a valid JSON object (no markdown, no code fences):
{
  "logic_understanding": <"low" | "medium" | "high">,
  "explanation_alignment": <0.0-1.0>,
  "code_quality": <number 1-10>,
  "brief_feedback": "<one sentence>"
}`
        }
    ];

    const raw = await chatCompletion(messages, { temperature: 0.3 });
    try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch (e) { }

    return {
        logic_understanding: 'medium',
        explanation_alignment: 0.5,
        code_quality: 5,
        brief_feedback: 'Could not parse AI evaluation.',
    };
}

module.exports = {
    chatCompletion,
    generateQuestion,
    generateFollowUp,
    generateMCQ,
    generateMCQFollowUp,
    generateCodingQuestion,
    generateCodingInterruption,
    evaluateAnswer,
    evaluateCodingAnswer,
};
