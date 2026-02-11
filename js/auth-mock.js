/* Viva Haven — Auth Mock
   Simula autenticação/roles antes do Firebase.
   API:
     - login(identifier, password, role)
     - logout()
     - getSession()
*/

(function () {
  'use strict';

  var STORAGE_KEY = 'vh_auth_session';

  function nowIso() {
    try {
      return new Date().toISOString();
    } catch (e) {
      return '';
    }
  }

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }

  function normalizeRole(role) {
    var value = String(role || '').trim().toUpperCase();
    return value;
  }

  function buildSession(identifier, role) {
    var cleanIdentifier = String(identifier || '').trim();
    var cleanRole = normalizeRole(role);

    return {
      id: 'mock_' + Math.random().toString(16).slice(2) + Date.now().toString(16),
      identifier: cleanIdentifier,
      role: cleanRole,
      createdAt: nowIso(),
    };
  }

  function saveSession(session) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      return true;
    } catch (e) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
        return true;
      } catch (e2) {
        return false;
      }
    }
  }

  function loadSession() {
    var raw = null;

    try {
      raw = sessionStorage.getItem(STORAGE_KEY);
    } catch (e) {}

    if (!raw) {
      try {
        raw = localStorage.getItem(STORAGE_KEY);
      } catch (e2) {}
    }

    if (!raw) return null;

    var parsed = safeJsonParse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    if (!parsed.identifier || !parsed.role) return null;

    parsed.role = normalizeRole(parsed.role);
    return parsed;
  }

  function clearSession() {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (e) {}

    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e2) {}
  }

  function login(identifier, password, role) {
    var cleanIdentifier = String(identifier || '').trim();
    var cleanPassword = String(password || '').trim();
    var cleanRole = normalizeRole(role);

    if (!cleanIdentifier) throw new Error('Identifier obrigatório.');
    if (!cleanPassword) throw new Error('Senha obrigatória.');
    if (!cleanRole) throw new Error('Role obrigatória.');

    var session = buildSession(cleanIdentifier, cleanRole);
    var ok = saveSession(session);
    if (!ok) throw new Error('Falha ao salvar sessão.');

    return session;
  }

  function logout() {
    clearSession();
  }

  function getSession() {
    return loadSession();
  }

  window.AuthMock = {
    login: login,
    logout: logout,
    getSession: getSession,
  };
})();
