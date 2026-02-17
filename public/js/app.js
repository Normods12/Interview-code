// ============================================================
// app.js — Landing Page Logic (Interview AI Platform v1)
// ============================================================

(function () {
    'use strict';

    // ─── DOM ELEMENTS ───────────────────────────────────────
    const nameInput = document.getElementById('candidateName');
    const roleGrid = document.getElementById('roleGrid');
    const roleCards = document.querySelectorAll('.role-card');
    const startBtn = document.getElementById('startBtn');
    const errorMsg = document.getElementById('errorMsg');

    let selectedRole = null;

    // ─── ROLE SELECTION ─────────────────────────────────────
    roleCards.forEach(card => {
        card.addEventListener('click', () => {
            roleCards.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            selectedRole = card.dataset.role;
            validateForm();
        });
    });

    // ─── FORM VALIDATION ────────────────────────────────────
    nameInput.addEventListener('input', validateForm);

    function validateForm() {
        const name = nameInput.value.trim();
        const isValid = name.length >= 2 && selectedRole;
        startBtn.disabled = !isValid;
    }

    // ─── START INTERVIEW ────────────────────────────────────
    startBtn.addEventListener('click', async () => {
        const candidateName = nameInput.value.trim();
        if (!candidateName || !selectedRole) return;

        startBtn.disabled = true;
        startBtn.innerHTML = '<div class="spinner" style="width:16px;height:16px;border-width:2px;"></div> Starting...';
        errorMsg.classList.add('hidden');

        try {
            const response = await fetch('/api/interview/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: selectedRole, candidateName }),
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Failed to start interview');
            }

            const data = await response.json();

            // Store session data and navigate to interview page
            sessionStorage.setItem('interviewSession', JSON.stringify({
                sessionId: data.sessionId,
                role: selectedRole,
                candidateName,
                firstQuestion: data,
            }));

            window.location.href = '/interview.html';
        } catch (err) {
            errorMsg.textContent = `Error: ${err.message}`;
            errorMsg.classList.remove('hidden');
            startBtn.disabled = false;
            startBtn.innerHTML = '🚀 Start Interview';
        }
    });

    // ─── KEYBOARD SHORTCUT ──────────────────────────────────
    nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !startBtn.disabled) {
            startBtn.click();
        }
    });

})();
