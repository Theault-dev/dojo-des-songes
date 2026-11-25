// Assemble les modules en une seule page autonome : dist/index.html
// Chaque module devient une IIFE qui renvoie ses exports ; les imports deviennent des déstructurations.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const ORDER = ['official', 'data', 'effects', 'engine', 'bot', 'expert', 'fx', 'deckio', 'store', 'art', 'netplay', 'ui'];
const modVar = name => `MOD_${name}`;

function wrap(name) {
  let src = readFileSync(new URL(`./src/${name}.js`, import.meta.url), 'utf8');
  src = src.replace(/^import \* as (\w+) from '\.\/(\w+)\.js';$/gm, (_, alias, m) => `const ${alias} = ${modVar(m)};`);
  src = src.replace(/^import \{([^}]+)\} from '\.\/(\w+)\.js';$/gm, (_, names, m) => `const {${names}} = ${modVar(m)};`);
  const exported = [...src.matchAll(/^export (?:async )?(?:const|let|function|class) (\w+)/gm)].map(m => m[1]);
  src = src.replace(/^export (?=(?:async )?(?:const|let|function|class) )/gm, '');
  if (/^(import|export) /m.test(src)) throw new Error(`Import/export non géré dans ${name}.js`);
  return `const ${modVar(name)} = (() => {\n${src}\nreturn { ${exported.join(', ')} };\n})();`;
}

// Worker du bot Expert : moteur + bots, sans l'interface. Il rejoue la partie et cherche.
const WORKER = ['official', 'data', 'effects', 'engine', 'bot', 'expert'].map(wrap).join('\n\n') + `
onmessage = async e => {
  const { id, job } = e.data;
  try { const r = await MOD_expert.search(job); postMessage({ id, stats: r.stats, sims: r.sims }); }
  catch (err) { postMessage({ id, stats: [], error: String(err) }); }
};`;
const bundle = `const WORKER_SRC = ${JSON.stringify(WORKER).replace(/</g, '\\u003c')};\n\n` + ORDER.map(wrap).join('\n\n');
// Tapis : assets/mat.webp s'il existe, sinon un aplat (MAT_COLOR=#rrggbb pour changer la couleur)
const matFile = new URL('./assets/mat.webp', import.meta.url);
const mat = existsSync(matFile)
  ? 'data:image/webp;base64,' + readFileSync(matFile).toString('base64')
  : 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="${process.env.MAT_COLOR ?? '#1b2147'}"/></svg>`);
const html = readFileSync(new URL('./index.src.html', import.meta.url), 'utf8').replace('/*BUNDLE*/', () => bundle).replace('MAT_DATA_URI', () => mat);
mkdirSync(new URL('./dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('./dist/index.html', import.meta.url), html);
console.log(`dist/index.html : ${(html.length / 1024).toFixed(1)} Ko${existsSync(matFile) ? '' : ' (tapis : aplat, assets/mat.webp absent)'}`);

// Pages légales statiques, servies telles quelles par nginx (/conditions, /confidentialite).
// Textes « à venir » tant que le jeu en ligne (server/pages.mjs) n'est pas sur cette branche.
const { staticPages } = await import('./server/legal.mjs');
const online = existsSync(new URL('./server/pages.mjs', import.meta.url));
for (const [path, page] of Object.entries(staticPages({ online, operator: process.env.OPERATOR_NAME || null }))) {
  const out = new URL(`./dist/${path}`, import.meta.url);
  mkdirSync(new URL('./', out), { recursive: true });
  writeFileSync(out, page);
  console.log(`dist/${path} : ${(page.length / 1024).toFixed(1)} Ko${online ? '' : ' (jeu en ligne « à venir »)'}`);
}
