const fs = require('fs');

const html = fs.readFileSync('public/index.html', 'utf8');

// Find all occurrences of $('something').addEventListener
const lines = html.split('\n');
const missing = [];

lines.forEach((line, index) => {
  const match = line.match(/\$\(['"]([a-zA-Z0-9_-]+)['"]\)\.addEventListener/);
  if (match) {
    const id = match[1];
    // Check if this line is preceded by if ($('id'))
    const prevLine = index > 0 ? lines[index - 1] : '';
    const hasGuard = line.includes(`if ($('${id}')`) || line.includes(`if ($("${id}")`) ||
                     prevLine.includes(`if ($('${id}')`) || prevLine.includes(`if ($("${id}")`);
    
    // Check if ID exists in HTML
    const idExists = html.includes(`id="${id}"`) || html.includes(`id='${id}'`);
    if (!idExists) {
      missing.push({ line: index + 1, id, hasGuard });
    }
  }
});

console.log('Result of missing IDs in DOM:', JSON.stringify(missing, null, 2));

