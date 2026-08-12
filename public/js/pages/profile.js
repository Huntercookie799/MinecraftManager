import { API } from '../utils/api.js';
import { DOM } from '../utils/dom.js';
import { UserModel } from '../models/User.js';
import '../components/index.js';
import { UIProgress } from '../components/UIProgress.js';

document.addEventListener('DOMContentLoaded', async () => {
  if (!API.token) {
    API.logout();
    return;
  }

  DOM.on('btn-logout', 'click', (e) => {
    e.preventDefault();
    API.logout();
  });

  if (window.lucide) {
    window.lucide.createIcons();
  }

  const usernameInput = DOM.get('username');
  const passwordInput = DOM.get('password');
  const msg = DOM.get('profile-msg');

  const profile = await UserModel.getProfile();
  if (profile) {
    usernameInput.value = profile.username;
  }

  DOM.on('btn-save-profile', 'click', async (e) => {
    e.preventDefault();
    UIProgress.show('Actualizando perfil...');

    const data = { username: usernameInput.value };
    if (passwordInput.value) {
      data.password = passwordInput.value;
    }

    const res = await UserModel.updateProfile(data);
    UIProgress.hide();

    if (res && res.success) {
      msg.textContent = 'Perfil actualizado exitosamente.';
      msg.style.display = 'block';
      setTimeout(() => msg.style.display = 'none', 3000);
      passwordInput.value = '';
    }
  });
});
