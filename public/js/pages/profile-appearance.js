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

  const avatarPreview = DOM.get('avatar-preview');
  const msg = DOM.get('profile-msg');
  let skinViewer = null;

  // Cargar Perfil
  const profile = await UserModel.getProfile();
  if (profile) {
    if (profile.profilePic) {
      avatarPreview.src = profile.profilePic;
    }
    
    // Inicializar SkinView3D
    const isMobile = window.innerWidth <= 768;
    const viewerW = isMobile ? 160 : 250;
    const viewerH = isMobile ? 224 : 350;
    const skinUrl = profile.mcSkin || 'https://minotar.net/skin/MHF_Steve';
    
    if (window.skinview3d) {
      skinViewer = new window.skinview3d.SkinViewer({
        canvas: document.createElement("canvas"),
        width: viewerW,
        height: viewerH,
        skin: skinUrl
      });
      
      DOM.get('skin-viewer').appendChild(skinViewer.canvas);
      
      skinViewer.animation = new window.skinview3d.WalkingAnimation();
      skinViewer.animation.speed = 1.0;
      
      try {
        if (window.skinview3d.createOrbitControls) {
          const control = window.skinview3d.createOrbitControls(skinViewer);
          control.enableZoom = true;
          control.enablePan = false;
        } else if (window.skinview3d.OrbitControls) {
          const control = new window.skinview3d.OrbitControls(skinViewer);
          control.enableZoom = true;
          control.enablePan = false;
        } else {
          skinViewer.autoRotate = true;
        }
      } catch(e) {
        console.warn("No se pudieron cargar los controles 3D:", e);
      }
    }
  }

  let pendingAvatarFile = null;
  let pendingSkinFile = null;

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

  // Guardar Datos
  DOM.on('btn-save-appearance', 'click', async (e) => {
    e.preventDefault();
    UIProgress.show('Guardando apariencia...');

    if (pendingAvatarFile) {
      await UserModel.uploadImage(pendingAvatarFile, 'profilePic');
      pendingAvatarFile = null;
    }

    if (pendingSkinFile) {
      await UserModel.uploadImage(pendingSkinFile, 'mcSkin');
      pendingSkinFile = null;
    }

    UIProgress.hide();
    msg.textContent = 'Apariencia actualizada exitosamente.';
    msg.style.display = 'block';
    setTimeout(() => msg.style.display = 'none', 3000);
  });
});
