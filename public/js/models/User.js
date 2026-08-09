import { API } from '../utils/api.js';

export class UserModel {
  static async register(username, password) {
    const data = await API.call('/register', 'POST', { username, password }, '/api/auth');
    if (data && data.token) {
      API.token = data.token;
      return true;
    }
    return false;
  }

  static async getProfile() {
    return await API.call('/me', 'GET', null, '/api/auth');
  }

  static async updateProfile(data) {
    return await API.call('/me', 'PUT', data, '/api/auth');
  }

  static async uploadImage(file, fieldName) {
    if (!API.token) return null;
    
    const formData = new FormData();
    formData.append(fieldName, file);

    try {
      const response = await fetch('/api/auth/me/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${API.token}` },
        body: formData
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Upload error');
      return data;
    } catch (err) {
      alert(err.message);
      return null;
    }
  }

  static async getAccounts() {
    if (!API.token) return [];
    try {
      const response = await fetch('/api/auth/me/accounts', {
        headers: { 'Authorization': `Bearer ${API.token}` }
      });
      return response.ok ? await response.json() : [];
    } catch (err) {
      console.error(err);
      return [];
    }
  }

  static async createAccount(nametag) {
    if (!API.token) return null;
    try {
      const response = await fetch('/api/auth/me/accounts', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API.token}` 
        },
        body: JSON.stringify({ nametag })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Creation error');
      return data;
    } catch (err) {
      alert(err.message);
      return null;
    }
  }

  static async deleteAccount(accountId) {
    if (!API.token) return false;
    try {
      const response = await fetch(`/api/auth/me/accounts/${accountId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${API.token}` }
      });
      return response.ok;
    } catch (err) {
      console.error(err);
      return false;
    }
  }

  static async uploadAccountImage(accountId, file, fieldName) {
    if (!API.token) return null;
    const formData = new FormData();
    formData.append(fieldName, file);

    try {
      const response = await fetch(`/api/auth/me/accounts/${accountId}/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${API.token}` },
        body: formData
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Upload error');
      return data;
    } catch (err) {
      alert(err.message);
      return null;
    }
  }
}
