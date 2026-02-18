// ============================================================
// app.js — Landing Page Logic (v2)
// ============================================================

const API = 'http://localhost:3000/api';

document.addEventListener('DOMContentLoaded', () => {
    const nameInput = document.getElementById('candidateName');
    const startBtn = document.getElementById('startBtn');
    const roleCards = document.querySelectorAll('.role-card');

    let selectedRole = null;

    // ─── ROLE SELECTION ─────────────────────────────
    roleCards.forEach(card => {
        card.addEventListener('click', () => {
            roleCards.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            selectedRole = card.dataset.role;
            checkReady();
        });
    });

    // ─── ENABLE / DISABLE START ─────────────────────
    nameInput.addEventListener('input', checkReady);

    function checkReady() {
        startBtn.disabled = !(nameInput.value.trim() && selectedRole);
    }

    // ─── START INTERVIEW ────────────────────────────
    startBtn.addEventListener('click', async () => {
        const candidateName = nameInput.value.trim();
        if (!candidateName || !selectedRole) return;

        startBtn.disabled = true;
        startBtn.textContent = '⏳ Starting...';

        try {
            const difficulty = document.getElementById('difficultySelect').value;

            const res = await fetch(`${API}/interview/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: selectedRole, candidateName, difficulty }),
            });

            if (!res.ok) throw new Error('Failed to start');

            const data = await res.json();

            // Store first question for interview page
            sessionStorage.setItem('firstQuestion', JSON.stringify(data));

            // Navigate to interview
            window.location.href = `/interview.html?session=${data.sessionId}&name=${encodeURIComponent(candidateName)}&role=${encodeURIComponent(selectedRole)}&level=${difficulty}`;
        } catch (err) {
            console.error('Error starting interview:', err);
            alert('Could not start interview. Is the server running?');
            startBtn.disabled = false;
            startBtn.textContent = 'Start Interview →';
        }
    });
});
