'use strict';
// Gera uploadguard-nfe-tags.js: os nomes de elementos e atributos que um XML de NF-e/NFC-e pode ter, tirados dos esquemas oficiais (zima/xsd-nfe).
// A guarda de arquivos (uploadguard-core.js) só aceita XML de nota que use SOMENTE estes nomes. Rode de novo quando atualizar os esquemas:
//   node zima/gerar-lista-xml-nfe.js
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, 'xsd-nfe');
const el = new Set(), at = new Set();
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.xsd')) {
      const x = fs.readFileSync(p, 'utf8');
      for (const m of x.matchAll(/<(?:\w+:)?element\b[^>]*?\bname="([A-Za-z_][\w.-]*)"/g)) el.add(m[1]);
      for (const m of x.matchAll(/<(?:\w+:)?attribute\b[^>]*?\bname="([A-Za-z_][\w.-]*)"/g)) at.add(m[1]);
    }
  }
})(DIR);
const out = `'use strict';\n// GERADO por zima/gerar-lista-xml-nfe.js a partir de zima/xsd-nfe — não edite à mão.\nmodule.exports = {\n  elements: ${JSON.stringify([...el].sort())},\n  attributes: ${JSON.stringify([...at].sort())},\n};\n`;
fs.writeFileSync(path.join(__dirname, '..', 'uploadguard-nfe-tags.js'), out);
console.log(`${el.size} elementos, ${at.size} atributos`);
