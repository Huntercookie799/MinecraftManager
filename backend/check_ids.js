const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');
const js = fs.readFileSync('public/app.js', 'utf8');
const regex = /document\.getElementById\('([^']+)'\)/g;
let match;
const missing = [];
while ((match = regex.exec(js)) !== null) {
  const id = match[1];
  if (!html.includes(`id="${id}"`) && !html.includes(`id='${id}'`)) {
    missing.push(id);
  }
}
console.log('Missing IDs:', missing);
