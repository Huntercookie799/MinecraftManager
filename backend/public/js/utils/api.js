export class API {
  static get token() {
    return localStorage.getItem('mm_token');
  }

  static set token(value) {
    if (value) {
      localStorage.setItem('mm_token', value);
    } else {
      localStorage.removeItem('mm_token');
    }
  }

  static logout() {
    this.token = null;
    window.location.href = '/index.html';
  }

  static async call(endpoint, method = 'GET', body = null, prefix = '/api/server', silent = false) {
    if (!this.token) {
      this.logout();
      return null;
    }
    
    try {
      const options = { 
        method, 
        headers: { 'Authorization': `Bearer ${this.token}` } 
      };
      
      if (body) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
      }
      
      const response = await fetch(`${prefix}${endpoint}`, options);
      if (response.status === 401) {
        this.logout();
        throw new Error('Unauthorized');
      }
      
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Network error');
      return data;
    } catch (error) {
      console.error(`Error calling ${endpoint}:`, error);
      if (!silent) alert(error.message);
      return null;
    }
  }
}
