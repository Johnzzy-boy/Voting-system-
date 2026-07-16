/**
 * register.js — Voter Registration Logic
 * ============================================================
 * Handles form validation, password strength, and submission
 * for new voter registration.
 * ============================================================
 */

document.addEventListener('DOMContentLoaded', () => {

  const form       = document.getElementById('register-form');
  const submitBtn  = document.getElementById('submit-btn');
  const successBox = document.getElementById('success-box');
  const errorBox   = document.getElementById('error-box');
  const newIdEl    = document.getElementById('new-voter-id');
  const mailStatus = document.getElementById('mail-status');

  // ── Password strength indicator ──────────────────────────
  const pwInput    = document.getElementById('password');
  const pwStrength = document.getElementById('pw-strength');
  const pwConfirm  = document.getElementById('confirm-password');

  pwInput?.addEventListener('input', () => {
    const val  = pwInput.value;
    const str  = getPasswordStrength(val);
    const bars = pwStrength.querySelectorAll('.strength-bar');
    bars.forEach((b, i) => {
      b.style.background = i < str.score
        ? str.color : 'rgba(255,255,255,0.08)';
    });
    pwStrength.querySelector('.strength-label').textContent = str.label;
    pwStrength.querySelector('.strength-label').style.color = str.color;

    const passwordError = document.getElementById('password-error');
    if (passwordError) {
      if (!val) {
        passwordError.textContent = '';
        passwordError.classList.remove('show');
      } else if (!validatePassword(val)) {
        passwordError.textContent = 'Password must be strong: 8+ chars, uppercase, number, and special character.';
        passwordError.classList.add('show');
      } else {
        passwordError.textContent = '';
        passwordError.classList.remove('show');
      }
    }
  });

  function getPasswordStrength(pw) {
    let score = 0;
    if (pw.length >= 8)  score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    const levels = [
      { label: 'Very Weak', color: '#e05858' },
      { label: 'Weak', color: '#e05858' },
      { label: 'Fair', color: '#f0c060' },
      { label: 'Good', color: '#7ab3f5' },
      { label: 'Strong', color: '#5dd49a' },
    ];
    return { score, ...levels[Math.min(score, 4)] };
  }

  // ── Form submission ───────────────────────────────────────
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();

    const fullName = document.getElementById('full-name').value.trim();
    const email    = document.getElementById('email').value.trim();
    const phone    = document.getElementById('phone').value.trim();
    const password = pwInput.value;
    const confirm  = pwConfirm.value;

    // Validate
    let valid = true;
    if (!validateName(fullName)) {
      setError('full-name-error', 'Please enter a valid full name with letters only.'); valid = false;
    }
    if (!validateEmail(email)) {
      setError('email-error', 'Please enter a valid email address.'); valid = false;
    }
    if (!validatePhone(phone)) {
      setError('phone-error', 'Please enter a valid phone number.'); valid = false;
    }
    if (!validatePassword(password)) {
      setError('password-error', 'Password must be at least 8 characters and include an uppercase letter, a number, and a special character.'); valid = false;
    }
    if (password !== confirm) {
      setError('confirm-error', 'Passwords do not match.'); valid = false;
    }
    if (!document.getElementById('terms').checked) {
      setError('terms-error', 'You must agree to the terms.'); valid = false;
    }
    if (!valid) return;

    // Submit
    setLoading(true);
    try {
      const voterId = await registerVoter({ fullName, email, phone, password });
      newIdEl.textContent = voterId;
      form.classList.add('hidden');
      successBox.classList.remove('hidden');

      try {
        await sendVerificationEmail({ fullName, email, voterId, password });
        if (mailStatus) {
          mailStatus.textContent = 'Your verification email has been sent successfully.';
        }
      } catch (sendErr) {
        if (mailStatus) {
          mailStatus.textContent = 'Registration succeeded, but the verification email could not be sent automatically.';
        }
      }
    } catch (err) {
      errorBox.textContent = err.message || 'Registration failed. Please try again.';
      errorBox.classList.remove('hidden');
    } finally {
      setLoading(false);
    }
  });

  function sendVerificationEmail({ fullName, email, voterId, password }) {
    return new Promise((resolve) => {
      const subject = 'VoteSecure verification details';
      const message = [
        `Hello ${fullName || 'there'},`,
        '',
        'Your VoteSecure verification details are below:',
        '',
        `Voter ID: ${voterId}`,
        `Password: ${password}`,
        '',
        'Please keep these credentials safe and use them to sign in for verification.',
        '',
        'Thank you,',
        'VoteSecure'
      ].join('\n');

      const form = document.createElement('form');
      form.method = 'POST';
      form.action = `https://formsubmit.co/${encodeURIComponent(email)}`;
      form.target = 'vs-mail-sender';
      form.style.display = 'none';

      const fields = {
        name: fullName || 'VoteSecure Voter',
        email,
        message,
        _subject: subject,
        _captcha: 'false'
      };

      Object.entries(fields).forEach(([key, value]) => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = key;
        input.value = value;
        form.appendChild(input);
      });

      const iframe = document.createElement('iframe');
      iframe.name = 'vs-mail-sender';
      iframe.style.display = 'none';

      document.body.appendChild(iframe);
      document.body.appendChild(form);
      form.submit();

      setTimeout(() => {
        form.remove();
        iframe.remove();
        resolve();
      }, 1500);
    });
  }

  function setError(id, msg) {
    const el = document.getElementById(id);
    if (el) { el.textContent = msg; el.classList.add('show'); }
  }

  function clearErrors() {
    document.querySelectorAll('.form-error').forEach(el => {
      el.textContent = ''; el.classList.remove('show');
    });
    errorBox.textContent = '';
    errorBox.classList.add('hidden');
  }

  function setLoading(on) {
    submitBtn.disabled = on;
    submitBtn.innerHTML = on
      ? '<span class="spinner"></span> Registering…'
      : '🗳 Register to Vote';
  }
});
