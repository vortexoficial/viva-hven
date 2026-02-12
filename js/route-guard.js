// Viva Haven — Route Guard (compat)
// Mantido para não quebrar páginas existentes.

import { protect } from './auth-guard.js';

export { protect };

// Compatibilidade com chamadas antigas (window.RouteGuard.protect)
try {
	window.RouteGuard = { protect };
} catch (e) {}
