const fs = require('fs');
const path = require('path');

const envDir = path.join(__dirname, '..', 'src', 'environments');

// Asegurar que el directorio existe
if (!fs.existsSync(envDir)) {
  fs.mkdirSync(envDir, { recursive: true });
}

// Leer variables de entorno (de Vercel o locales)
const supabaseUrl = process.env['NG_APP_SUPABASE_URL'] || '';
const supabaseKey = process.env['NG_APP_SUPABASE_KEY'] || '';
const apiUrl = process.env['NG_APP_API_URL'] || '';

// Contenido para environment.ts (desarrollo)
const envContent = `export const environment = {
  production: false,
  supabaseUrl: '${supabaseUrl}',
  supabaseKey: '${supabaseKey}',
  apiUrl: '${apiUrl}',
};
`;

// Contenido para environment.prod.ts (producción)
const envProdContent = `export const environment = {
  production: true,
  supabaseUrl: '${supabaseUrl}',
  supabaseKey: '${supabaseKey}',
  apiUrl: '${apiUrl}',
};
`;

// Escribir archivos
fs.writeFileSync(path.join(envDir, 'environment.ts'), envContent);
fs.writeFileSync(path.join(envDir, 'environment.prod.ts'), envProdContent);

console.log('✅ Environment files generated successfully');
console.log(`   SUPABASE_URL: ${supabaseUrl ? '✓ Set' : '✗ Missing'}`);
console.log(`   SUPABASE_KEY: ${supabaseKey ? '✓ Set' : '✗ Missing'}`);
console.log(`   API_URL: ${apiUrl ? '✓ Set' : '✗ Missing (will use localhost:5000)'}`);
