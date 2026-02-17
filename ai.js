// ============================================================
// ai.js — OpenRouter API Wrapper (Interview AI Platform v1)
// ============================================================
// All AI interactions go through this module.
// Model can be swapped by changing OPENROUTER_MODEL in .env
// ============================================================

require('dotenv').config();

const API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.OPENROUTER_MODEL || 'mistralai/mistral-7b-instruct';
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Send a chat completion request to OpenRouter
 * @param {Array} messages - Array of {role, content} objects
 * @param {Object} options - Optional overrides (temperature, max_tokens)
 * @returns {string} The assistant's response text
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

// ─── INTERVIEW-SPECIFIC AI FUNCTIONS ────────────────────────

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

/**
 * Generate an interview question based on role
 */
async function generateQuestion(role, questionNumber, difficulty = 'easy') {
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
            role: 'user',
            content: `Ask interview question #${questionNumber} for a ${role} fresher.
Difficulty: ${difficulty}.
${questionNumber === 1 ? 'Warm-up — something like "Tell me about yourself" or "What tech are you most comfortable with?"' : 'Ask about ONE core technical concept for this role.'}

RULES:
- ONE sentence only, max 12-15 words
- Ask only ONE thing, never combine two topics
- Do NOT start with filler words (Got it, Sure, Okay, So, Great)
- Return ONLY the raw question text, nothing else`
        }
    ];

    return (await chatCompletion(messages, { temperature: 0.8, max_tokens: 100 })).trim();
}

/**
 * Generate a follow-up based on candidate's answer
 */
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

/**
 * Evaluate a candidate's answer and return structured assessment
 * @param {string} question - The question that was asked
 * @param {string} answer - The candidate's answer
 * @returns {Object} Structured evaluation
 */
async function evaluateAnswer(question, answer) {
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
            role: 'user',
            content: `Evaluate this interview answer.

Question: "${question}"
Answer: "${answer}"

Return ONLY a valid JSON object (no markdown, no code fences) with these fields:
{
  "answer_quality": <number 1-10>,
  "concept_coverage": [<list of concepts mentioned>],
  "confidence": <number 0.0-1.0>,
  "clarity": <"low" | "medium" | "high">,
  "brief_feedback": "<one sentence feedback>"
}`
        }
    ];

    const raw = await chatCompletion(messages, { temperature: 0.3 });

    try {
        // Try to extract JSON from the response
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
    } catch (e) {
        // Fallback if parsing fails
    }

    return {
        answer_quality: 5,
        concept_coverage: [],
        confidence: 0.5,
        clarity: 'medium',
        brief_feedback: 'Could not parse AI evaluation.',
    };
}

module.exports = {
    chatCompletion,
    generateQuestion,
    generateFollowUp,
    evaluateAnswer,
};
