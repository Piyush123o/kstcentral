CUSTOMER BOOK - CONFIGURATION FIX

Files included:
- index.html: updated HTML with explicit relative paths and correct script order
- config.js: project URL included; contains the publishable key you supplied; confirm it matches your Supabase project
- app.js: your supplied application code with improved configuration diagnostics and safer login error handling
- sql/secure-rls-migration.sql: optional ownership/RLS migration for private per-user records

IMPORTANT CONFIGURATION:
1. Open config.js.
2. Replace REPLACE_WITH_YOUR_SUPABASE_PUBLISHABLE_KEY with the publishable key from Supabase -> Project Settings -> API Keys.
   Use the publishable key (sb_publishable_...). Never use a secret/service_role key in browser code.
3. Set LOGIN_EMAIL_DOMAIN to the domain of the actual email in Supabase Authentication -> Users.
   The supplied config currently uses gmail.com. If your actual Supabase Auth account is poko@customerbook.app, change this to customerbook.app.
4. Keep config.js, index.html, app.js and style.css in the same root folder. The supplied app.js expects style.css to exist.
5. Upload all files to the same GitHub Pages directory. If your project is deployed under /repository-name/, these relative paths continue to work.
6. Hard refresh the page with Ctrl+Shift+R.
7. In browser DevTools Console, run CUSTOMER_BOOK_DIAGNOSTICS() to see whether config.js, the SDK and client initialization succeeded.

SQL MIGRATION WARNING:
The migration adds owner_id and changes RLS to isolate each user's records. If existing rows exist, replace YOUR_SUPABASE_AUTH_USER_UUID with your actual Auth user UUID before running it. Find it in Supabase Dashboard -> Authentication -> Users. If the tables are empty, comment out the three backfill UPDATE statements or use your own UUID. Do not run the migration with the placeholder unchanged.

This app.js remains the original online Supabase app; it does NOT implement offline-first IndexedDB synchronization. That is a separate feature and should be implemented/tested separately.
