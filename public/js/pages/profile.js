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

  // ─── Tabs móviles del perfil ────────────────────────────────────────────
  const profileTabs = document.querySelectorAll('.profile-tab');
  const profilePanels = document.querySelectorAll('.profile-tab-panel');

  profileTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      profileTabs.forEach(t => t.classList.remove('active'));
      profilePanels.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = DOM.get('tab-panel-' + tab.dataset.tab);
      if (panel) panel.classList.add('active');
    });
  });

  // Elementos
  const usernameInput = DOM.get('username');
  const passwordInput = DOM.get('password');
  const profileForm = DOM.get('profile-form');
  const msg = DOM.get('profile-msg');
  const avatarPreview = DOM.get('avatar-preview');
  
  let skinViewer = null;

  // Cargar Perfil
  const profile = await UserModel.getProfile();
  if (profile) {
    usernameInput.value = profile.username;
    if (profile.profilePic) {
      avatarPreview.src = profile.profilePic;
    }
    
    // Inicializar SkinView3D (tamaño compacto en móvil para que no se corte)
    const isMobile = window.innerWidth <= 768;
    const viewerW = isMobile ? 160 : 250;
    const viewerH = isMobile ? 224 : 350;
    const skinUrl = profile.mcSkin || 'https://minotar.net/skin/MHF_Steve';
    
    skinViewer = new skinview3d.SkinViewer({
      canvas: document.createElement("canvas"),
      width: viewerW,
      height: viewerH,
      skin: skinUrl
    });
    
    DOM.get('skin-viewer').appendChild(skinViewer.canvas);
    
    // Configurar animación de caminar
    skinViewer.animation = new skinview3d.WalkingAnimation();
    skinViewer.animation.speed = 1.0;
    
    // Controles de cámara
    try {
      if (skinview3d.createOrbitControls) {
        const control = skinview3d.createOrbitControls(skinViewer);
        control.enableZoom = true;
        control.enablePan = false;
      } else if (skinview3d.OrbitControls) {
        const control = new skinview3d.OrbitControls(skinViewer);
        control.enableZoom = true;
        control.enablePan = false;
      } else {
        skinViewer.autoRotate = true; // Fallback
      }
    } catch(e) {
      console.warn("No se pudieron cargar los controles 3D:", e);
    }
  }

  let pendingAvatarFile = null;
  let pendingSkinFile = null;

  // Guardar Datos (Texto e Imágenes)
  DOM.on('btn-save-profile', 'click', async (e) => {
    e.preventDefault();
    
    UIProgress.show('Actualizando perfil, por favor espera...');

    // Subir Avatar si hay uno pendiente
    if (pendingAvatarFile) {
      await UserModel.uploadImage(pendingAvatarFile, 'profilePic');
      pendingAvatarFile = null;
    }

    // Subir Skin si hay una pendiente
    if (pendingSkinFile) {
      await UserModel.uploadImage(pendingSkinFile, 'mcSkin');
      pendingSkinFile = null;
    }

    // Actualizar Texto
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
      passwordInput.value = ''; // limpiar contraseña
    }
  });

  // Previsualizar Avatar Localmente
  DOM.on('upload-avatar', 'change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    pendingAvatarFile = file;
    const url = URL.createObjectURL(file);
    avatarPreview.src = url;
  });

  // Previsualizar Skin Localmente
  DOM.on('upload-skin', 'change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    pendingSkinFile = file;
    const url = URL.createObjectURL(file);
    if (skinViewer) {
      skinViewer.loadSkin(url);
    }
  });
// ---------- Cuentas de Minecraft ----------
  const accountsList = DOM.get('accounts-list');
  const addAccountBtn = DOM.get('btn-show-add-account');
  const addAccountModal = DOM.get('add-account-modal');
  const newAccountNametag = DOM.get('new-account-nametag');
  const cancelAddAccount = DOM.get('btn-cancel-add-account');
  const confirmAddAccount = DOM.get('btn-confirm-add-account');

  // Mostrar modal para agregar cuenta
  DOM.on('btn-show-add-account', 'click', () => {
    addAccountModal.style.display = 'flex';
    newAccountNametag.value = '';
  });

  // Cancelar agregar cuenta
  DOM.on('btn-cancel-add-account', 'click', () => {
    addAccountModal.style.display = 'none';
  });

  // Confirmar creación de cuenta
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

  // Función para cargar y renderizar cuentas
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

      // Configurar SkinViewer para esta cuenta (compacto en móvil)
      const isMobile = window.innerWidth <= 768;
      const accW = isMobile ? 140 : 200;
      const accH = isMobile ? 196 : 250;
      const skinUrl = account.skin || 'https://minotar.net/skin/MHF_Steve';
      const skinViewer = new skinview3d.SkinViewer({
        canvas: document.createElement('canvas'),
        width: accW,
        height: accH,
        skin: skinUrl
      });
      const skinContainer = DOM.get(`skin-viewer-${account.id}`);
      skinContainer.appendChild(skinViewer.canvas);
      skinViewer.animation = new skinview3d.WalkingAnimation();
      skinViewer.animation.speed = 1.0;
      try {
        if (skinview3d.createOrbitControls) {
          const ctrl = skinview3d.createOrbitControls(skinViewer);
          ctrl.enableZoom = true;
          ctrl.enablePan = false;
        } else if (skinview3d.OrbitControls) {
          const ctrl = new skinview3d.OrbitControls(skinViewer);
          ctrl.enableZoom = true;
          ctrl.enablePan = false;
        } else {
          skinViewer.autoRotate = true;
        }
      } catch (e) { console.warn('Controls error', e); }

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

  // Cargar cuentas al iniciar
  await loadAccounts();

  // ---------- Fin de Cuentas ----------
});
