const fs = require('fs');
const file = process.argv[2] || 'src/fighter.js';
try {
  const code = fs.readFileSync(file, 'utf8');
  let open = 0;
  for (let c of code) {
    if (c === '{') open++;
    if (c === '}') open--;
  }
  if (open !== 0) {
    console.error(`❌ Braces mismatch in ${file}:`, open);
    process.exit(1);
  }
  console.log(`✅ Braces Balanced in ${file}`);
} catch (e) {
  console.error('❌ Error:', e.message);
  process.exit(1);
}
