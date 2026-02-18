# Project: Interview AI Platform (v3.1)
**Last Updated**: 2026-02-18

## 1. Project Overview
This is an **AI-powered mock interview platform** designed to realistically simulate technical interviews. It features:
- **Speech-to-Text & Text-to-Speech**: Full voice interaction.
- **Dynamic Questioning**: Questions adapt based on the role and previous answers.
- **Multi-Modal Testing**: Spoken theory, MCQs, and live Coding challenges.
- **Anti-Cheating / Risk Detection**: Tracks paste events, typing speed, and answer confidence decay.
- **Scoring Engine**: Generates a 0-100 readiness score with detailed breakdown.

## 2. Technical Architecture
### Backend (`Node.js` + `Express`)
- **`server.js`**: API endpoints for interview state management.
- **`interview-engine.js`**: Core state machine. Manages the 10-slot interview structure (Warmup -> Spoken -> MCQ -> Spoken -> Coding -> Spoken).
- **`ai.js`**: Wrapper for OpenRouter API. Handles prompt engineering for questions, follow-ups, and evaluation.
- **`scoring.js`**: Calculates the final score. **CRITICAL LOGIC**: See Section 5.
- **`database.js`**: SQLite wrapper (`better-sqlite3`) for storing sessions and transcripts.
- **`tts.js`**: Edge-TTS integration for voice synthesis.

### Frontend (Vanilla JS + CSS)
- **`public/index.html`**: Landing page with Role & Difficulty selection.
- **`public/interview.html`**: The main interview SPA.
- **`public/js/app.js`**: Logic for landing page.
- **`public/js/interview.js`**: The heavy lifter. Handles MediaRecorder, Speech Recognition, Polls, and UI updates.
- **`public/css/style.css`**: Design system (Glassmorphism, Dark Mode).

## 3. Workflows & Scripts
### Running the App
```bash
node server.js
```
- Runs on `http://localhost:3000`.

### Simulation / Testing
We use custom scripts to simulate full interviews without a browser:
- **`test-v3.js`**: Comprehensive simulation of a full interview (Spoken + MCQ + Coding). Good for testing logic flows.
- **`test-ai-vs-ai.js`**: Uses AI to *answer* its own questions to verify "Perfect Score" scenarios.
- **`test-difficulty.js`**: Verifies that "Expert" questions are actually harder than "Easy" ones.
- **`test-scoring.js`**: Specific test for the scoring math.

## 4. Critical Logic & "Do Not Touch" Areas

### A. Scoring Logic (`scoring.js`)
**⚠️ SENSITIVE**: We recently fixed a major bug here.
- **The Issue**: Only `answer_quality` (0-10) is valid. Do NOT use `quality`.
- **The Weights**:
    - Answer Quality: 30%
    - Depth Stability: 20%
    - MCQ: 15%
    - Coding: 15%
    - Behavioral Trust: 10%
    - Consistency: 10%
- **Why**: Changing these weights significantly alters the "fairness" perception.

### B. Difficulty Levels
Implemented in `ai.js` via `getDifficultyPrompt(level)`.
- **Levels**: Very Easy, Easy, Medium, Hard, Expert.
- **Mechanism**: The difficulty string is passed to *every* AI prompt.
- **Constraint**: Do not remove the `difficulty` parameter from `createSession` or `generateQuestion`.

### C. Interview State Machine (`interview-engine.js`)
The slot structure is hardcoded in `V2_CONFIG`.
- **10 Slots**: Defined order (Spoken, MCQ, Coding).
- **Modification**: If you change the number of slots, you MUST update `V2_CONFIG.totalSlots` and the `slotTypes` array, or the interview will hang at the end.

## 5. Known Bugs & Fixes (History)
1.  **Camera Visibility**: Fixed a bug where the camera would disappear during Coding/MCQ rounds. We now ensure the video element persist in `video-layout.css` and `interview.js`.
2.  **Scoring Data Mismatch**: Fixed a bug where `ai.js` returned `answer_quality` but `scoring.js` looked for `quality`. **ALWAYS use `answer_quality`**.
3.  **Difficulty Selector UI**: The dropdown in `index.html` must have the class `.form-select` (not `.form-input`) to render text correctly in dark mode.
4.  **Speech Recognition**: We use the native Web Speech API. It requires HTTPS in production, but works on `localhost`.

## 6. Future Roadmap (For Next Agents)
- **Resume Parsing**: Add a file upload to `index.html` to tailor questions to the user's actual resume.
- **User Accounts**: Persist history across sessions.
- **React Migration**: The vanilla JS frontend (`interview.js`) is getting large (~1000 lines). Consider migrating to React/Next.js for better state management.
