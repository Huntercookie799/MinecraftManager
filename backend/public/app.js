document.addEventListener('DOMContentLoaded', () => {
  const btnStart = document.getElementById('btn-start');
  const btnRestart = document.getElementById('btn-restart');
  const btnStop = document.getElementById('btn-stop');
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');
  
  const terminalOutput = document.getElementById('terminal-output');
  const commandInput = document.getElementById('command-input');
  const btnSendCommand = document.getElementById('btn-send-command');

  const loginScreen = document.getElementById('login-screen');
  const appContainer = document.getElementById('app-container');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');

  let currentStatus = 'offline';
  let jwtToken = localStorage.getItem('mm_token');

  // --- Auth & API Functions ---
  function checkAuth() {
    if (jwtToken) {
      loginScreen.style.display = 'none';
      appContainer.style.display = 'flex';
      pollStatus();
      setupWebSocket();
    } else {
      loginScreen.style.display = 'flex';
      appContainer.style.display = 'none';
    }
  }

  function handleLogout() {
    localStorage.removeItem('mm_token');
    jwtToken = null;
    window.location.reload();
  }

  async function apiCall(endpoint, method = 'GET', body = null) {
    if (!jwtToken) return null;
    
    try {
      const options = { 
        method, 
        headers: {
          'Authorization': `Bearer ${jwtToken}`
        } 
      };
      if (body) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
      }
      const response = await fetch(`/api/server${endpoint}`, options);
      if (response.status === 401) {
        handleLogout();
        throw new Error('Unauthorized');
      }
      if (!response.ok) throw new Error('Network response was not ok');
      return await response.json();
    } catch (error) {
      console.error(`Error calling ${endpoint}:`, error);
      return null;
    }
  }

  // --- Login Form ---
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const btn = document.getElementById('btn-login');
    
    btn.disabled = true;
    loginError.textContent = '';
    
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }
      
      jwtToken = data.token;
      localStorage.setItem('mm_token', jwtToken);
      checkAuth();
    } catch (err) {
      loginError.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  // --- Status Management ---
  function updateUI(status) {
    if (status === currentStatus) return;
    currentStatus = status;

    statusBadge.className = `status-badge ${status}`;
    statusText.textContent = status.toUpperCase();

    if (status === 'offline') {
      btnStart.disabled = false;
      btnStop.disabled = true;
      btnRestart.disabled = true;
      commandInput.disabled = true;
      btnSendCommand.disabled = true;
    } else if (status === 'online') {
      btnStart.disabled = true;
      btnStop.disabled = false;
      btnRestart.disabled = false;
      commandInput.disabled = false;
      btnSendCommand.disabled = false;
    } else {
      btnStart.disabled = true;
      btnStop.disabled = true;
      btnRestart.disabled = true;
      commandInput.disabled = true;
      btnSendCommand.disabled = true;
    }
  }

  async function pollStatus() {
    if (!jwtToken) return;
    const data = await apiCall('/status');
    if (data && data.status) {
      updateUI(data.status);
    }
    setTimeout(pollStatus, 3000);
  }

  // --- Button Event Listeners ---
  btnStart.addEventListener('click', async () => {
    btnStart.disabled = true;
    await apiCall('/start', 'POST');
    updateUI('starting');
  });

  btnStop.addEventListener('click', async () => {
    btnStop.disabled = true;
    await apiCall('/stop', 'POST');
    updateUI('stopping');
  });

  btnRestart.addEventListener('click', async () => {
    btnRestart.disabled = true;
    await apiCall('/restart', 'POST');
    updateUI('starting');
  });

  async function sendCommand() {
    const command = commandInput.value.trim();
    if (!command) return;
    
    commandInput.value = '';
    commandInput.disabled = true;
    btnSendCommand.disabled = true;

    await apiCall('/command', 'POST', { command });
    
    if (currentStatus === 'online') {
      commandInput.disabled = false;
      btnSendCommand.disabled = false;
      commandInput.focus();
    }
  }

  btnSendCommand.addEventListener('click', sendCommand);
  commandInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendCommand();
  });

  // --- WebSocket ---
  function setupWebSocket() {
    if (!jwtToken) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Pasar token por query parameter para fastify-jwt
    const wsUrl = `${protocol}//${window.location.host}/ws/logs?token=${jwtToken}`;
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      let message = event.data;
      let type = 'info';

      if (message.includes('WARN')) type = 'warn';
      else if (message.includes('ERROR')) type = 'error';
      else if (message.startsWith('>')) type = 'cmd';

      const line = document.createElement('div');
      line.className = `terminal-line ${type}`;
      line.textContent = message;
      
      terminalOutput.appendChild(line);
      
      if (terminalOutput.children.length > 500) {
        terminalOutput.removeChild(terminalOutput.firstChild);
      }
      terminalOutput.scrollTop = terminalOutput.scrollHeight;
    };

    ws.onclose = () => {
      if (jwtToken) {
        console.log('WebSocket closed, reconnecting in 5s...');
        setTimeout(setupWebSocket, 5000);
      }
    };
  }

  // Start app
  checkAuth();
});
