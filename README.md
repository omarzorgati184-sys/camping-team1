# Mou5ayam chtee

Application PWA de gestion de camps d’hiver en français.

## Mise en place Supabase

1. Créez un projet sur Supabase.
2. Dans SQL Editor, exécutez `supabase.sql`.
3. Dans Authentication > URL Configuration, ajoutez l’URL locale puis l’URL Netlify.
4. Dans Authentication > Providers, activez Email/Password.
5. Dans app.js, renseignez `SUPABASE_URL` et `SUPABASE_ANON_KEY` avec les valeurs disponibles dans Project Settings > API.
6. Créez un compte via la page de connexion.
7. Promouvez le premier administrateur depuis SQL :

```sql
update public.profiles
set role = 'admin'
where id = 'UUID-DU-COMPTE';
```

## Démarrage local

```bash
python3 -m http.server 8080
```

Ouvrez `http://localhost:8080`.

## Déploiement Netlify

1. Importez ce dépôt GitHub.
2. Laissez vide le champ de commande de build.
3. Publiez le dossier racine.
4. Ajoutez l’URL Netlify aux URL autorisées Supabase.

## Installation

Sur téléphone ou ordinateur, utilisez « Ajouter à l’écran d’accueil » ou « Installer l’application » après ouverture en HTTPS.
