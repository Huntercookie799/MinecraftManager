import { API } from '../utils/api.js';
import { DOM } from '../utils/dom.js';
import { ServerModel } from '../models/Server.js';
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

  const modal = DOM.get('new-server-modal');
  let versionsLoaded = false;

  DOM.on('btn-show-new-server', 'click', async () => {
    if (!versionsLoaded) {
      const versionSelect = DOM.get('new-server-version');
      const data = await API.call('/versions');
      if (data && Array.isArray(data.versions) && data.versions.length > 0) {
        versionSelect.innerHTML = data.versions.map(v => `<option value="${v}">${v}</option>`).join('');
        // Seleccionar la más reciente por defecto
        versionSelect.value = data.versions[0];
        versionsLoaded = true;
      } else {
        versionSelect.innerHTML = '<option value="1.21.8">1.21.8</option>';
      }
    }
    DOM.show(modal);
  });
  DOM.on('btn-cancel-new-server', 'click', () => DOM.hide(modal));

  // Estrategia de acceso: al elegir "Personalizado" se muestra el input de puerto
  const portStrategy = DOM.get('new-server-port-strategy');
  const customPort = DOM.get('new-server-port');
  if (portStrategy && customPort) {
    portStrategy.addEventListener('change', () => {
      customPort.style.display = portStrategy.value === 'custom' ? 'block' : 'none';
    });
  }

  DOM.on('btn-create-server', 'click', async () => {
    UIProgress.show('Creando servidor...');

    const name = DOM.get('new-server-name').value;
    const memory = DOM.get('new-server-memory').value;
    const softwareType = DOM.get('new-server-software').value;
    const strategy = DOM.get('new-server-port-strategy').value;
    const port = strategy === 'custom' ? DOM.get('new-server-port').value : strategy;
    const version = DOM.get('new-server-version').value;
    const hostname = DOM.get('new-server-hostname')?.value.trim() || undefined;

    const res = await ServerModel.create(name, port, memory, version, hostname, softwareType);
    
    UIProgress.hide();

    if (res && res.success) {
      DOM.hide(modal);
      loadServers();
    }
  });

  await loadServers();
  await loadHostnames();



  async function loadHostnames() {
    const list = DOM.get('hostnames-list');
    const badge = DOM.get('router-badge');
    const badgeText = DOM.get('router-badge-text');
    const lanChip = DOM.get('lan-ip-chip');
    const hint = DOM.get('hostnames-hint');
    const hostsContent = DOM.get('hosts-file-content');
    if (!list) return;

    const data = await API.call('/hostnames');
    if (!data) return;

    // IP LAN (dinámica: la asigna el DHCP del router y puede cambiar)
    if (lanChip && data.lanIp) {
      lanChip.textContent = `🌐 LAN: ${data.lanIp}`;
    }

    // Detectar cambio de IP: si el router asignó otra, avisar para re-copiar el hosts
    const ipBanner = DOM.get('ip-change-banner');
    if (data.lanIp && ipBanner) {
      const KEY = 'mm_last_lan_ip';
      const prev = localStorage.getItem(KEY);
      if (prev && prev !== data.lanIp) {
        ipBanner.style.display = 'block';
        ipBanner.textContent = `⚠️ La IP LAN cambió (${prev} → ${data.lanIp}). Actualizá el archivo hosts en cada PC de jugadores con el bloque de abajo.`;
      } else {
        ipBanner.style.display = 'none';
      }
      localStorage.setItem(KEY, data.lanIp);
    }

    // Estado del router
    const listeners = Array.isArray(data.listeners) ? data.listeners : [];
    const activePorts = listeners.filter(l => l.listening).map(l => l.port);
    const blockedPorts = listeners.filter(l => !l.listening);
    if (badge && badgeText) {
      if (activePorts.length > 0) {
        badge.className = 'status-badge online';
        badgeText.textContent = `Router activo: ${activePorts.join(', ')}`;
      } else if (blockedPorts.length > 0) {
        badge.className = 'status-badge offline';
        badgeText.textContent = `Router sin puertos (${blockedPorts.map(l => l.port).join(', ')} ocupados)`;
      } else {
        badge.className = 'status-badge offline';
        badgeText.textContent = 'Router no iniciado';
      }
    }

    // (El hostnames-list se removió, ahora el hostname aparece en la tabla principal)

    // Bloque de hosts file para la LAN
    const items = Array.isArray(data.hostnames) ? data.hostnames : [];
    if (hint && hostsContent && data.lanIp && items.length > 0) {
      hint.style.display = 'block';
      if (lanChip) lanChip.style.display = 'inline-flex';
      hostsContent.textContent = items.map(i => `${data.lanIp.padEnd(16)} ${i.hostname}`).join('\n');

      // Botones: descargar scripts .bat para las PCs de los jugadores
      const dlBtn = DOM.get('btn-download-hosts-script');
      if (dlBtn) {
        dlBtn.onclick = () => downloadPlayerHostsScript(data.lanIp, items.map(i => i.hostname));
      }
      const dlAutoBtn = DOM.get('btn-download-hosts-auto');
      if (dlAutoBtn) {
        dlAutoBtn.onclick = () => downloadPlayerHostsAutoScript(data.lanIp, items.map(i => i.hostname));
      }
    } else {
      if (hint) hint.style.display = 'none';
      if (lanChip) lanChip.style.display = 'none';
    }

    if (window.lucide) {
      window.lucide.createIcons();
    }

    /** Construye el script PowerShell de sync (compartido por las dos
     *  descargas). Consulta el panel para la IP vigente y usa los valores
     *  embebidos como respaldo si el panel no responde. */
    function buildSyncPs(panelUrl, ip, hostnames) {
      return `$ErrorActionPreference = 'SilentlyContinue'
$panelUrl = '${panelUrl}'
$fallbackIp = '${ip}'
$fallbackHosts = @('${hostnames.join("','")}')

$ip = $fallbackIp
$hosts = $fallbackHosts

# 1) Descubrir el panel por broadcast UDP en la LAN. Funciona aunque la IP del
#    servidor haya cambiado de red: el panel responde con su IP actual.
$discovered = $false
try {
  $udp = New-Object System.Net.Sockets.UdpClient
  $udp.Client.ReceiveTimeout = 2000
  $udp.EnableBroadcast = $true
  $magic = [Text.Encoding]::UTF8.GetBytes('MCSYNC_DISCOVER')
  $udp.Send($magic, $magic.Length, '255.255.255.255', 45678) | Out-Null
  $ep = New-Object System.Net.IPEndPoint([Net.IPAddress]::Any, 0)
  $respBytes = $udp.Receive([ref]$ep)
  $disc = [Text.Encoding]::UTF8.GetString($respBytes) | ConvertFrom-Json
  if ($disc.lanIp) {
    $ip = $disc.lanIp
    if ($disc.hostnames -and $disc.hostnames.Count -gt 0) { $hosts = @($disc.hostnames) }
    Write-Host "[INFO] IP descubierta por broadcast UDP: $ip"
    $discovered = $true
  }
  $udp.Close()
} catch {
  Write-Host "[WARN] Sin respuesta por broadcast UDP; probando por HTTP..."
}

# 2) Respaldo: consultar el panel por HTTP (IP embebida al descargar el script)
if (-not $discovered) {
  try {
    $r = Invoke-RestMethod -Uri "$panelUrl/api/server/hostnames/public" -TimeoutSec 3
    if ($r.lanIp) { $ip = $r.lanIp }
    if ($r.hostnames -and $r.hostnames.Count -gt 0) { $hosts = @($r.hostnames) }
    Write-Host "[INFO] IP desde el panel: $ip"
  } catch {
    Write-Host "[WARN] Panel no accesible; usando IP embebida: $ip"
  }
}

$hostsFile = "$env:SystemRoot\\System32\\drivers\\etc\\hosts"
$markStart = '# --- Minecraft Manager LAN (auto) ---'
$markEnd = '# --- fin Minecraft Manager LAN ---'

$content = if (Test-Path $hostsFile) { Get-Content $hostsFile -Raw } else { '' }
$lines = $content -split "\`r?\`n"
$out = New-Object System.Collections.Generic.List[string]
$inManaged = $false
foreach ($line in $lines) {
  if ($line.Trim() -eq $markStart) { $inManaged = $true; continue }
  if ($line.Trim() -eq $markEnd) { $inManaged = $false; continue }
  if (-not $inManaged) { $out.Add($line) }
}
$hostSet = @{}
foreach ($h in $hosts) { $hostSet[$h] = $true }
$cleaned = New-Object System.Collections.Generic.List[string]
foreach ($line in $out) {
  $t = $line.Trim()
  if ($t -eq '' -or $t.StartsWith('#')) { $cleaned.Add($line); continue }
  $managed = $false
  foreach ($p in ($t -split '\\s+')) { if ($hostSet.ContainsKey($p)) { $managed = $true; break } }
  if (-not $managed) { $cleaned.Add($line) }
}
$block = @($markStart)
foreach ($h in $hosts) { $block += ("$ip".PadRight(16) + ' ' + $h) }
$block += $markEnd
$result = @($cleaned) + $block + ''
$result -join "\`r\`n" | Set-Content $hostsFile -Encoding ASCII -NoNewline
Write-Host "[OK] Hosts actualizado: $ip -> $($hosts -join ', ')"
`;
    }

    /** Codifica un script PowerShell a Base64 UTF-16LE (para -EncodedCommand
     *  y para escribir el .ps1 a disco desde el .bat). */
    function encodePs(ps) {
      let utf16 = '';
      for (const ch of ps) {
        const c = ch.charCodeAt(0);
        utf16 += String.fromCharCode(c & 0xff, c >> 8);
      }
      return btoa(utf16);
    }

    function triggerDownload(bat, filename) {
      const blob = new Blob([bat], { type: 'application/bat' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    /** Script de UNA ejecución: actualiza el hosts y listo. */
    function downloadPlayerHostsScript(ip, hostnames) {
      const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
      const panelUrl = `${window.location.protocol}//${ip}:${port}`;
      const ps = buildSyncPs(panelUrl, ip, hostnames);
      const encoded = encodePs(ps);

      const bat = `@echo off
setlocal
rem ============================================================
rem  minecraft-hosts-setup.bat
rem  Configura el acceso a los servidores de Minecraft en esta PC.
rem  Detecta la IP actual del servidor y actualiza el archivo hosts.
rem  Se ejecuta UNA sola vez (pide permisos de administrador).
rem ============================================================

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [INFO] Solicitando permisos de administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}
set EXIT=%errorlevel%
echo.
if %EXIT% equ 0 (
  echo [OK] Configurado. Ya podes entrar a ${hostnames[0]}:443 en Minecraft.
) else (
  echo [ERROR] Ocurrio un problema (codigo %EXIT%).
)
echo.
pause
exit /b %EXIT%
`;
      triggerDownload(bat, 'minecraft-hosts-setup.bat');
    }

    /** Script AUTO-ACTUALIZABLE: escribe el .ps1 a disco, registra una tarea
     *  programada ONLOGON y actualiza el hosts ahora. En cada inicio de sesión
     *  Windows ejecuta la tarea y el hosts se sincroniza solo con la IP nueva. */
    function downloadPlayerHostsAutoScript(ip, hostnames) {
      const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
      const panelUrl = `${window.location.protocol}//${ip}:${port}`;
      const ps = buildSyncPs(panelUrl, ip, hostnames);
      const encoded = encodePs(ps);
      const taskName = 'MinecraftManager_SyncHosts';

      const bat = `@echo off
setlocal EnableDelayedExpansion
rem ============================================================
rem  minecraft-hosts-auto.bat
rem  Configura el acceso a los servidores de Minecraft en esta PC y lo
rem  mantiene actualizado SOLO: registra una tarea programada que se ejecuta
rem  en cada inicio de sesion y detecta la IP que asigne el DHCP.
rem  Se ejecuta UNA sola vez (pide permisos de administrador).
rem ============================================================

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [INFO] Solicitando permisos de administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b 0
)

set "DIR=%USERPROFILE%\.minecraft-manager"
set "PS1=%DIR%\sync-hosts.ps1"
set "TASK=${taskName}"

rem ---- Escribir el script de sincronizacion a disco ----
if not exist "%DIR%" mkdir "%DIR%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$b='${encoded}'; $p='%PS1%'; [IO.File]::WriteAllText($p, [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($b)))"
if errorlevel 1 (
  echo [ERROR] No se pudo escribir el script en %PS1%
  pause
  exit /b 1
)

echo [OK] Script de sincronizacion instalado en %PS1%

rem ---- Registrar la tarea programada ONLOGON ----
schtasks /Create /F /TN "%TASK%" /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"%PS1%\"" /SC ONLOGON /RL HIGHEST /IT
if errorlevel 1 (
  echo [ERROR] No se pudo registrar la tarea programada.
  pause
  exit /b 1
)
echo [OK] Tarea programada "%TASK%" registrada (se ejecuta en cada inicio de sesion)

rem ---- Sincronizar ahora mismo ----
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
set EXIT=%errorlevel%
echo.
if %EXIT% equ 0 (
  echo [OK] Todo listo: el hosts se actualiza solo en cada inicio de sesion.
  echo      Ya podes entrar a ${hostnames[0]}:443 en Minecraft.
) else (
  echo [ERROR] La sincronizacion inicial fallo (codigo %EXIT%).
)
echo.
pause
exit /b %EXIT%
`;
      triggerDownload(bat, 'minecraft-hosts-auto.bat');
    }
  }

  async function loadServers() {
    const list = DOM.get('servers-list');
    list.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 40px; color: var(--text-dim); font-family: var(--font-mono);">Cargando servidores...</td></tr>';
    
    const servers = await ServerModel.getAll();
    if (!servers) return;

    list.innerHTML = '';
    if (servers.length === 0) {
      list.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 40px; color: var(--text-dim); font-family: var(--font-mono);">No hay servidores creados.</td></tr>';
      return;
    }

    servers.forEach(server => {
      const st = server.status?.status || 'OFFLINE';
      const isOnline = st === 'ONLINE';
      const isStarting = st === 'STARTING';
      
      let badgeClass = 'offline';
      if (isOnline) badgeClass = 'online';
      if (isStarting) badgeClass = 'starting';

      let hostnameCol = '<span style="color:var(--text-dim);">—</span>';
      if (server.hostname) {
        hostnameCol = `<code>${server.hostname}</code>
          <button class="btn-copy-ip" data-copy-addr="${server.hostname}" style="background:none; border:none; cursor:pointer; color:var(--text-dim);"><i data-lucide="copy" style="width:12px;height:12px;"></i></button>`;
      }

      const card = DOM.create('tr');
      card.innerHTML = `
        <td><strong>${server.name}</strong></td>
        <td>
          <div class="status-badge ${badgeClass}" style="display: inline-flex; width: max-content;">
            <div class="dot"></div>
            <span class="text">${st}</span>
          </div>
        </td>
        <td style="font-family: var(--font-mono); color: var(--text-dim);">${server.id}</td>
        <td style="font-family: var(--font-mono); color: var(--text-dim);">${server.version || '—'}</td>
        <td style="font-family: var(--font-mono);">${server.port}</td>
        <td style="font-family: var(--font-mono);">${hostnameCol}</td>
        <td style="font-family: var(--font-mono);">${server.memory}</td>
        <td style="font-family: var(--font-mono);">${server.status?.players || 0}/${server.status?.maxPlayers || 0}</td>
        <td style="text-align: right;">
          <ui-button variant="blue" id="manage-btn-${server.id}" style="width: auto; display: inline-flex; padding: 6px 12px; font-size: 0.8rem;"><i data-lucide="settings"></i> Administrar</ui-button>
        </td>
      `;
      list.appendChild(card);
      
      DOM.on(`manage-btn-${server.id}`, 'click', () => {
        window.location.href = `/server.html?id=${server.id}`;
      });
    });

    // Copiar dirección
    list.querySelectorAll('.btn-copy-ip').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const addr = btn.getAttribute('data-copy-addr');
        try {
          await navigator.clipboard.writeText(addr);
          btn.innerHTML = '✓';
          setTimeout(() => { btn.innerHTML = '<i data-lucide="copy" style="width:12px;height:12px;"></i>'; if (window.lucide) lucide.createIcons(); }, 1500);
        } catch {}
      });
    });

    if (window.lucide) {
      window.lucide.createIcons();
    }
  }
});
