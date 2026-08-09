import { DOM } from '../utils/dom.js';
import { UserModel } from '../models/User.js';
import { API } from '../utils/api.js';
import '../components/index.js';
import { UIProgress } from '../components/UIProgress.js';

document.addEventListener('DOMContentLoaded', () => {
  if (API.token) {
    window.location.href = '/dashboard.html';
    return;
  }

  const loginForm = DOM.get('login-form');
  const loginError = DOM.get('login-error');
  const errorText = DOM.get('error-text');
  const btnLogin = DOM.get('btn-login');

  let isRegistering = false;

  // Escuchar cambios de modo desde los tabs del HTML
  document.addEventListener('auth-mode-change', (e) => {
    isRegistering = e.detail.isRegistering;
    loginError.style.display = 'none';
  });

  function showError(msg) {
    errorText.textContent = msg;
    loginError.style.display = 'flex';
  }

  function hideError() {
    loginError.style.display = 'none';
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const btn = btnLogin;
    btn.disabled = true;

    UIProgress.show(isRegistering ? 'Creando cuenta...' : 'Iniciando sesión...');

    const username = DOM.get('username').value.trim();
    const password = DOM.get('password').value;

    try {
      if (isRegistering) {
        const success = await UserModel.register(username, password);
        if (success) {
          window.location.href = '/dashboard.html';
        } else {
          showError('Error al registrarse. Verifica los datos.');
        }
      } else {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await response.json();

        if (response.ok) {
          API.token = data.token;
          window.location.href = '/dashboard.html';
        } else {
          showError(data.error || 'Credenciales inválidas');
        }
      }
    } catch (err) {
      showError('Error de conexión con el servidor');
    } finally {
      UIProgress.hide();
      btn.disabled = false;
    }
  });
});
