import * as fs from 'fs';
import * as path from 'path';

function fixImports(dir: string) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      fixImports(fullPath);
    } else if (fullPath.endsWith('.ts')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      
      const importRegex = /(from\s+['"])(\.[^'"]+)(['"])/g;
      let changed = false;
      
      content = content.replace(importRegex, (match, p1, p2, p3) => {
        if (!p2.endsWith('.js')) {
          changed = true;
          return `${p1}${p2}.js${p3}`;
        }
        return match;
      });
      
      if (changed) {
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`Fixed imports in ${fullPath}`);
      }
    }
  }
}

fixImports(path.join(process.cwd(), 'src'));
