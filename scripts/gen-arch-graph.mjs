#!/usr/bin/env node
/**
 * gen-arch-graph.mjs
 * ------------------
 * Escanea los imports reales del proyecto (backend + frontend) y regenera
 * el grafo de dependencias dentro de ARCHITECTURE.md (bloque GRAPH:START/END).
 *
 * Uso:  node scripts/gen-arch-graph.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const docPath = path.join(root, 'ARCHITECTURE.md');

/* ── 1. Recopilar archivos del proyecto ─────────────────────────── */
const files = [];
function walk(dir, filter, base) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
      walk(p, filter, base);
    } else if (filter(e.name)) {
      files.push({ abs: p, rel: path.relative(base, p).replace(/\\/g, '/') });
    }
  }
}
walk(path.join(root, 'app'), (n) => /\.ts$/.test(n) && !/\.test\.ts$/.test(n), root);
walk(path.join(root, 'routes'), (n) => /\.ts$/.test(n), root);
walk(path.join(root, 'public/js'), (n) => /\.js$/.test(n), root);
walk(path.join(root, 'public'), (n) => /\.html$/.test(n), root);
walk(path.join(root, 'prisma/schema'), (n) => /\.prisma$/.test(n), root);
files.push({ abs: path.join(root, 'server.ts'), rel: 'server.ts' });

/* ── 2. Extraer imports relativos de cada archivo ───────────────── */
const layers = [
  { re: /^server\.ts$|^bootstrap\//, name: '🚀 Bootstrap', color: '#ffb86c' },
  { re: /^routes\//, name: '🧭 Rutas API', color: '#8be9fd' },
  { re: /^app\/Http\/Controllers\//, name: '🎮 Controladores', color: '#50fa7b' },
  { re: /^app\/Websockets\//, name: '🔌 WebSockets', color: '#bd93f9' },
  { re: /^app\/Services\//, name: '⚙️ Servicios', color: '#ff79c6' },
  { re: /^app\/Models\/|^app\/Utils\/|^app\/Types\/|^config\//, name: '🧩 Infra (prisma/env/utils)', color: '#f1fa8c' },
  { re: /^prisma\/schema\//, name: '🗄️ Esquema Prisma', color: '#6272a4' },
  { re: /^public\/js\/pages\//, name: '🖥️ Frontend — Páginas', color: '#69ff94' },
  { re: /^public\/js\/components\//, name: '🧱 Frontend — Componentes', color: '#ffd93b' },
  { re: /^public\/js\/models\//, name: '📦 Frontend — Modelos', color: '#6c9bff' },
  { re: /^public\/js\/utils\//, name: '🛠️ Frontend — Utilidades', color: '#ff9e6c' },
  { re: /^public\/.*\.html$/, name: '📄 HTML', color: '#e0e0e0' },
];

function layerOf(rel) {
  for (const l of layers) if (l.re.test(rel)) return l;
  return null;
}

const importRe = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const scriptRe = /<script[^>]*\bsrc\s*=\s*['"]([^'"]+)['"]/g;
const edges = [];
const nodeIds = new Map(); // rel -> id

for (const f of files) {
  const src = fs.readFileSync(f.abs, 'utf8');
  let m;
  while ((m = importRe.exec(src)) !== null) {
    const spec = m[1];
    if (!spec.startsWith('.') && !spec.startsWith('/')) continue; // paquete npm
    let target = path.resolve(path.dirname(f.abs), spec);
    // resolver extensiones
    for (const ext of ['.ts', '.js', '.prisma', '.html', '']) {
      if (fs.existsSync(target + ext)) { target += ext; break; }
      if (fs.existsSync(path.join(target, 'index' + ext))) { target = path.join(target, 'index' + ext); break; }
    }
    const rel = path.relative(root, target).replace(/\\/g, '/');
    if (!rel.startsWith('..') && !rel.startsWith('node_modules') && rel !== f.rel) {
      edges.push([f.rel, rel]);
    }
  }
  // HTML: <script src="..."> (module scripts en public/)
  if (/^\.html$/.test(path.extname(f.abs))) {
    while ((m = scriptRe.exec(src)) !== null) {
      let spec = m[1];
      if (/^https?:\/\//.test(spec)) continue; // CDN externo
      if (spec.startsWith('/')) spec = spec.slice(1);
      let target = path.resolve(path.dirname(f.abs), spec);
      const rel = path.relative(root, target).replace(/\\/g, '/');
      if (!rel.startsWith('..') && !rel.startsWith('node_modules') && rel !== f.rel) {
        edges.push([f.rel, rel]);
      }
    }
  }
}

// nodos: solo los que tienen capa (visibles)
const visible = new Set();
for (const [a, b] of edges) { visible.add(a); visible.add(b); }
for (const rel of visible) {
  if (!layerOf(rel)) { console.warn('  (sin capa, omitido):', rel); }
}
const nodes = [...visible].filter((r) => layerOf(r)).sort();
nodes.forEach((rel, i) => nodeIds.set(rel, `n${i + 1}`));

/* ── 3. Generar Mermaid ─────────────────────────────────────────── */
const lines = [];
lines.push('```mermaid');
lines.push('flowchart LR');
lines.push('  %% Generado por scripts/gen-arch-graph.mjs — no editar a mano');
for (const l of layers) {
  const members = nodes.filter((r) => l.re.test(r));
  if (members.length === 0) continue;
  lines.push(`  subgraph ${l.name.replace(/[^a-zA-Z0-9 ]/g, '').replace(/ /g, '_')}["${l.name}"]`);
  for (const rel of members) {
    lines.push(`    ${nodeIds.get(rel)}["${rel}"]`);
  }
  lines.push('  end');
}
for (const [a, b] of edges) {
  if (nodeIds.has(a) && nodeIds.has(b)) {
    lines.push(`  ${nodeIds.get(a)} --> ${nodeIds.get(b)}`);
  }
}
lines.push('```');

const graph = lines.join('\n');

/* ── 4. Insertar en ARCHITECTURE.md ─────────────────────────────── */
if (!fs.existsSync(docPath)) {
  console.error('No existe ARCHITECTURE.md — ejecutalo después de crearlo.');
  process.exit(1);
}
let doc = fs.readFileSync(docPath, 'utf8');
const start = doc.indexOf('<!-- GRAPH:START -->');
const end = doc.indexOf('<!-- GRAPH:END -->');
if (start === -1 || end === -1) {
  console.error('ARCHITECTURE.md no tiene los marcadores GRAPH:START/END.');
  process.exit(1);
}
const header = doc.slice(0, start + '<!-- GRAPH:START -->'.length);
const footer = doc.slice(end);
doc = header + '\n\n' + graph + '\n\n' + footer;
fs.writeFileSync(docPath, doc);

console.log(`✅ Grafo regenerado: ${nodes.length} nodos, ${edges.length} aristas → ARCHITECTURE.md`);
