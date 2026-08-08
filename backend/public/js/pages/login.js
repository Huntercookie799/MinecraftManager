import { DOM } from '../utils/dom.js';
import { UserModel } from '../models/User.js';
import { API } from '../utils/api.js';
import '../components/UIButton.js';
import { UIProgress } from '../components/UIProgress.js';

document.addEventListener('DOMContentLoaded', () => {
  if (API.token) {
    window.location.href = '/dashboard.html';
    return;
  }
  
  const loginForm = DOM.get('login-form');
  const loginError = DOM.get('login-error');
  const btnLogin = DOM.get('btn-login');
  const toggleLink = DOM.get('toggle-register');
  const formTitle = document.querySelector('.login-box h2');

  let isRegistering = false;

  DOM.on(toggleLink, 'click', (e) => {
    e.preventDefault();
    isRegistering = !isRegistering;
    if (isRegistering) {
      formTitle.textContent = 'Registrarse';
      btnLogin.innerHTML = 'Crear Cuenta';
      toggleLink.textContent = '¿Ya tienes cuenta? Inicia sesión';
    } else {
      formTitle.textContent = 'Iniciar Sesión';
      btnLogin.innerHTML = 'Entrar';
      toggleLink.textContent = '¿No tienes cuenta? Regístrate';
    }
    loginError.style.display = 'none';
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.style.display = 'none';
    
    UIProgress.show(isRegistering ? 'Creando cuenta...' : 'Iniciando sesión...');
    
    const username = DOM.get('username').value;
    const password = DOM.get('password').value;

    try {
      if (isRegistering) {
        const success = await UserModel.register(username, password);
        if (success) {
          window.location.href = '/dashboard.html';
        } else {
          loginError.textContent = 'Error al registrarse';
          loginError.style.display = 'block';
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
          loginError.textContent = data.error || 'Credenciales inválidas';
          loginError.style.display = 'block';
        }
      }
    } catch (err) {
      loginError.textContent = 'Error de conexión';
      loginError.style.display = 'block';
    } finally {
      UIProgress.hide();
    }
  });
});
