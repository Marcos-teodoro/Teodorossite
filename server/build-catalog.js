const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../js/data.js'), 'utf8');
const re = /id:\s*(\d+),\s*title:\s*"([^"]+)",[\s\S]*?price:\s*([\d.]+)/g;
const out = [];
let m;
while ((m = re.exec(src))) {
  out.push({ id: Number(m[1]), title: m[2], price: Number(m[3]) });
}
const dir = __dirname;
fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify(out, null, 2));
console.log('products', out.length);
