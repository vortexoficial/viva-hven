import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());

const IGNORE_PREFIXES = [
  'http://',
  'https://',
  'mailto:',
  'tel:',
  'javascript:',
  'data:',
];

function isExternal(url) {
  const u = String(url || '').trim();
  if (!u) return true;
  if (u.startsWith('#')) return true;
  return IGNORE_PREFIXES.some((p) => u.toLowerCase().startsWith(p));
}

function stripQueryHash(u) {
  const s = String(u || '');
  return s.split('#')[0].split('?')[0];
}

function toWorkspacePath(fromFileAbs, url) {
  const raw = stripQueryHash(url);
  if (!raw) return null;

  // Absolute-from-host
  if (raw.startsWith('/')) {
    return path.join(ROOT, raw.replace(/^\/+/, ''));
  }

  // Relative
  return path.resolve(path.dirname(fromFileAbs), raw);
}

async function exists(p) {
  try {
    const st = await fs.stat(p);
    return st.isFile();
  } catch {
    return false;
  }
}

async function listFilesRecursive(dirAbs) {
  const out = [];
  const entries = await fs.readdir(dirAbs, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dirAbs, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      out.push(...(await listFilesRecursive(full)));
    } else if (ent.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function extractAttrUrls(html, attrName) {
  const out = [];
  const re = new RegExp(`${attrName}\\s*=\\s*("([^"]+)"|'([^']+)')`, 'gi');
  let m;
  while ((m = re.exec(html))) {
    const url = m[2] || m[3] || '';
    if (!url) continue;
    out.push(url);
  }
  return out;
}

function isLikelyStaticAsset(u) {
  const s = stripQueryHash(u);
  if (!s) return false;
  if (s.endsWith('/')) return false;
  // We validate these extensions as files on disk
  return /\.(html?|css|js|mjs|json|webmanifest|svg|png|jpe?g|gif|ico|txt|md|map)$/i.test(s);
}

function isPostLoginPage(relPath) {
  const p = relPath.replace(/\\/g, '/');
  if (p.startsWith('admin/')) return true;
  if (p.startsWith('app/')) return true;
  if (p === 'perfil.html') return true;
  return false;
}

function hasGuard(html, relPath) {
  const p = relPath.replace(/\\/g, '/');
  if (p.startsWith('admin/')) {
    return /setupAdminPage\s*\(/.test(html);
  }
  if (p.startsWith('app/') || p === 'perfil.html') {
    // app usa protect() (via route-guard compat)
    return /\bprotect\s*\(/.test(html);
  }
  return true;
}

function rel(pAbs) {
  return path.relative(ROOT, pAbs).replace(/\\/g, '/');
}

function printSection(title, lines) {
  if (!lines.length) return;
  console.log(`\n=== ${title} (${lines.length}) ===`);
  for (const l of lines) console.log(l);
}

async function main() {
  const allFiles = await listFilesRecursive(ROOT);
  const htmlFiles = allFiles.filter((f) => f.toLowerCase().endsWith('.html'));

  const brokenLinks = [];
  const missingGuards = [];

  for (const fileAbs of htmlFiles) {
    const htmlRaw = await fs.readFile(fileAbs, 'utf8');
    const html = htmlRaw.replace(/<!--[\s\S]*?-->/g, '');
    const fileRel = rel(fileAbs);

    if (isPostLoginPage(fileRel) && !hasGuard(html, fileRel)) {
      missingGuards.push(`${fileRel} -> sem guard detectado`);
    }

    const urls = [
      ...extractAttrUrls(html, 'href'),
      ...extractAttrUrls(html, 'src'),
    ];

    for (const u of urls) {
      if (isExternal(u)) continue;
      if (!isLikelyStaticAsset(u)) continue;

      const targetAbs = toWorkspacePath(fileAbs, u);
      if (!targetAbs) continue;

      // Ignore SPA-ish routes that aren't files
      // (aqui o app é multi-page, então validamos .html etc.)
      const ok = await exists(targetAbs);
      if (!ok) {
        const targetRel = rel(targetAbs);
        brokenLinks.push(`${fileRel} -> ${u} (não encontrado: ${targetRel})`);
      }
    }
  }

  console.log(`Checkup: ${htmlFiles.length} páginas HTML analisadas.`);

  printSection('Links/Assets quebrados', brokenLinks);
  printSection('Páginas pós-login sem guard', missingGuards);

  const exitCode = brokenLinks.length || missingGuards.length ? 2 : 0;
  if (exitCode === 0) console.log('\nOK: nenhum problema detectado.');
  process.exit(exitCode);
}

main().catch((e) => {
  console.error('Falha no checkup:', e);
  process.exit(1);
});
