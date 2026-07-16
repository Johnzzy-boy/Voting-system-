/**
 * login.js — Authentication Logic
 * ============================================================
 * Validates voter ID + password, creates session,
 * and redirects to the appropriate page.
 * ============================================================
 */

document.addEventListener('DOMContentLoaded', () => {

  // Redirect if already logged in
  const sess = getSession();
  if (sess) {
    window.location.href = sess.isAdmin ? 'admin.html' : 'vote.html';
    return;
  }

  const form      = document.getElementById('login-form');
  const errorBox  = document.getElementById('login-error');
  const submitBtn = document.getElementById('login-btn');

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.classList.add('hidden');

    const voterId  = document.getElementById('voter-id').value.trim().toUpperCase();
    const password = document.getElementById('password').value;

    if (!voterId || !password) {
      showError('Please enter your Voter ID and password.');
      return;
    }

    setLoading(true);

    try {
      const voter = await getVoter(voterId);

      if (!voter) {
        showError('Invalid Voter ID. Please check and try again.');
        return;
      }

      if (voter.status === 'suspended') {
        showError('Your account has been suspended. Please contact the administrator.');
        return;
      }

      const ok = await verifyPassword(password, voter.password);
      if (!ok) {
        showError('Incorrect password. Please try again.');
        return;
      }

      // Create session (stored in sessionStorage — cleared on tab close)
      saveSession({
        voterId:  voter.voterId,
        fullName: voter.fullName,
        isAdmin:  voter.isAdmin,
        loginAt:  Date.now()
      });

      showToast(`Welcome back, ${voter.fullName.split(' ')[0]}!`, 'success');

      // Small delay for UX
      setTimeout(() => {
        window.location.href = voter.isAdmin ? 'admin.html' : 'vote.html';
      }, 600);

    } catch (err) {
      showError('An error occurred. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  });

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.remove('hidden');
  }

  function setLoading(on) {
    submitBtn.disabled = on;
    submitBtn.innerHTML = on
      ? '<span class="spinner"></span> Signing in…'
      : '🔐 Sign In';
  }
});
