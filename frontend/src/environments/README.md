# Environment Configuration

## Setup

1. Copy the template files:
   ```bash
   cp environment.ts.template environment.ts
   cp environment.prod.ts.template environment.prod.ts
   ```

2. Replace the placeholders with your actual Supabase credentials:
   - `YOUR_SUPABASE_URL`: Your Supabase project URL (e.g., `https://xxxx.supabase.co`)
   - `YOUR_SUPABASE_ANON_KEY`: Your Supabase anonymous/public key

## ⚠️ IMPORTANT: NEVER commit these files to Git!

The actual `environment.ts` and `environment.prod.ts` files are ignored in `.gitignore` to prevent exposing your secrets.

## Rotating Compromised Keys

If you've accidentally exposed your Supabase key (like it was committed to GitHub):

1. Go to your Supabase Dashboard → Project Settings → API
2. Click "Regenerate" next to the `anon` key
3. Update your local `environment.ts` and `environment.prod.ts` files with the new key
4. The old key will stop working immediately
