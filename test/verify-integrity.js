const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const ocr = fs.readFileSync(path.join(__dirname, '..', 'ocr-core.js'), 'utf8');

console.log('=======================================================');
console.log('🔍 AUDITORÍA DE INTEGRIDAD FRONTEND (HTML + JS)');
console.log('=======================================================');

// 1. Check getElementById calls
const idRegex = /document\.getElementById\(['"]([^'"]+)['"]\)/g;
let match;
const missingIds = [];
while ((match = idRegex.exec(js)) !== null) {
    const id = match[1];
    if (!html.includes(`id="${id}"`) && !html.includes(`id='${id}'`)) {
        if (!missingIds.includes(id)) missingIds.push(id);
    }
}

console.log(`\n📌 1. getElementById verificados: ${missingIds.length === 0 ? '✅ TODOS EXISTEN' : '⚠️ Faltantes: ' + missingIds.join(', ')}`);

// 2. Check inline handlers
const eventRegex = /on(?:click|submit|change|input)=["']([a-zA-Z0-9_]+)\(/g;
const missingFns = [];
while ((match = eventRegex.exec(html)) !== null) {
    const fn = match[1];
    const defined = js.includes(`function ${fn}`) || js.includes(`${fn} =`) || ocr.includes(`function ${fn}`) || ocr.includes(`${fn} =`);
    if (!defined && !missingFns.includes(fn)) {
        missingFns.push(fn);
    }
}

console.log(`\n📌 2. Funciones de eventos HTML verificadas: ${missingFns.length === 0 ? '✅ TODAS DEFINIDAS' : '⚠️ Faltantes: ' + missingFns.join(', ')}`);

// 3. Check OCR Engine tests
const OcrCore = require('../ocr-core.js');
console.log(`\n📌 3. Motor OCR Core exportado correctamente: ${typeof OcrCore.parseExtractedFields === 'function' ? '✅ SÍ' : '❌ NO'}`);

console.log('\n=======================================================');
console.log('🎉 AUDITORÍA COMPLETADA');
console.log('=======================================================');
