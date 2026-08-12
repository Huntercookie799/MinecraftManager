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

  const accountsList = DOM.get('accounts-list');
  const addAccountModal = DOM.get('add-account-modal');
  const newAccountNametag = DOM.get('new-account-nametag');

  DOM.on('btn-show-add-account', 'click', () => {
    addAccountModal.style.display = 'flex';
    newAccountNametag.value = '';
  });

  DOM.on('btn-cancel-add-account', 'click', () => {
    addAccountModal.style.display = 'none';
  });

  DOM.on('btn-confirm-add-account', 'click', async () => {
    const nametag = newAccountNametag.value.trim();
    if (!nametag) return alert('El nametag es obligatorio');
    UIProgress.show('Creando cuenta...');
    const account = await UserModel.createAccount(nametag);
    UIProgress.hide();
    if (account) {
      addAccountModal.style.display = 'none';
      await loadAccounts();
    }
  });

  async function loadAccounts() {
    accountsList.innerHTML = '';
    const accounts = await UserModel.getAccounts();
    accounts.forEach(account => {
      const card = document.createElement('div');
      card.className = 'card';
      card.style = 'display:flex; flex-direction:column; gap:15px; padding:15px;';
      card.innerHTML = `
        <h4>${account.nametag}</h4>
        <div class="account-avatar-row" style="display:flex; gap:15px; align-items:center;">
          <img id="avatar-${account.id}" src="${account.avatar || '/default-avatar.png'}" alt="Avatar" style="width:60px;height:60px;border-radius:50%;object-fit:cover;flex-shrink:0;">
          <ui-button variant="secondary" id="upload-avatar-${account.id}" style="width:auto;">Subir Avatar</ui-button>
          <ui-button variant="danger" id="delete-account-${account.id}" style="width:auto;">Eliminar</ui-button>
        </div>
        <div id="skin-viewer-${account.id}" class="account-skin-viewer" style="width:200px;height:250px;background:rgba(15,23,42,0.4);border-radius:8px;border:1px solid var(--border-color);"></div>
        <ui-button variant="secondary" id="upload-skin-${account.id}">Subir Skin</ui-button>
      `;
      accountsList.appendChild(card);

      const isMobile = window.innerWidth <= 768;
      const accW = isMobile ? 140 : 200;
      const accH = isMobile ? 196 : 250;
      const skinUrl = account.skin || 'https://minotar.net/skin/MHF_Steve';
      
      if (window.skinview3d) {
        const skinViewer = new window.skinview3d.SkinViewer({
          canvas: document.createElement('canvas'),
          width: accW,
          height: accH,
          skin: skinUrl
        });
        const skinContainer = DOM.get(`skin-viewer-${account.id}`);
        skinContainer.appendChild(skinViewer.canvas);
        skinViewer.animation = new window.skinview3d.WalkingAnimation();
        skinViewer.animation.speed = 1.0;
        try {
          if (window.skinview3d.createOrbitControls) {
            const ctrl = window.skinview3d.createOrbitControls(skinViewer);
            ctrl.enableZoom = true;
            ctrl.enablePan = false;
          } else if (window.skinview3d.OrbitControls) {
            const ctrl = new window.skinview3d.OrbitControls(skinViewer);
            ctrl.enableZoom = true;
            ctrl.enablePan = false;
          } else {
            skinViewer.autoRotate = true;
          }
        } catch (e) { console.warn('Controls error', e); }

        // Subir Skin local + upload
        const skinInput = document.createElement('ui-input');
        skinInput.setAttribute('type', 'file');
        skinInput.setAttribute('accept', '.png');
        skinInput.setAttribute('hidden', '');
        document.body.appendChild(skinInput);
        DOM.on(`upload-skin-${account.id}`, 'click', () => skinInput.click());
        skinInput.addEventListener('change', async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const previewUrl = URL.createObjectURL(file);
          skinViewer.loadSkin(previewUrl);
          UIProgress.show('Subiendo skin...');
          await UserModel.uploadAccountImage(account.id, file, 'skin');
          UIProgress.hide();
        });
      }

      // Subir Avatar local + upload
      const avatarInput = document.createElement('ui-input');
      avatarInput.setAttribute('type', 'file');
      avatarInput.setAttribute('accept', 'image/*');
      avatarInput.setAttribute('hidden', '');
      document.body.appendChild(avatarInput);
      DOM.on(`upload-avatar-${account.id}`, 'click', () => avatarInput.click());
      avatarInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const previewUrl = URL.createObjectURL(file);
        DOM.get(`avatar-${account.id}`).src = previewUrl;
        UIProgress.show('Subiendo avatar...');
        await UserModel.uploadAccountImage(account.id, file, 'avatar');
        UIProgress.hide();
      });

      // Eliminar cuenta
      DOM.on(`delete-account-${account.id}`, 'click', async () => {
        if (!confirm('¿Eliminar esta cuenta?')) return;
        UIProgress.show('Eliminando cuenta...');
        await UserModel.deleteAccount(account.id);
        UIProgress.hide();
        await loadAccounts();
      });
    });
  }

  await loadAccounts();
});
