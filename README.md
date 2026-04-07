# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## VPS Deployment

This repository also includes a VPS-friendly monorepo layout for DigitalOcean:

- `web` container: builds the Vite frontend and serves it through Nginx.
- `chat-proxy` container: runs the chat orchestration flow outside Supabase Edge and talks to the Delphi proxy locally.
- `delphi-proxy` container: runs the Delphi upstream proxy in Node.js with TLS 1.2 control.
- `admin-proxy` container: serves the external metadata/query admin API outside Supabase Edge.
- `chart-processor` container: keeps the Python chart service available.

To run it locally or on a VPS:

```sh
docker compose --env-file deploy/vps.env up --build
```

The repository already includes `deploy/vps.env` as a placeholder. Replace the values with your real environment before starting the stack.

The chat route is exposed at `/api/chat` through Nginx, with a dedicated `/api/chat-health` endpoint for smoke testing.
The proxy endpoint is exposed at `/api/external-db-proxy` through Nginx and can also be called directly on the internal container network.

## Hard Smoke Test

After bringing the stack up, run:

```sh
SMOKE_BASE_URL=http://127.0.0.1:8080 SMOKE_INTERNAL_PROXY_KEY=... npm run smoke:hard
```

Optional:

- `SMOKE_SUPABASE_ACCESS_TOKEN` for the authenticated chat and admin proxy checks.
- `SMOKE_SUPABASE_PUBLISHABLE_KEY` if you want the script to test `external-db-admin` with your Supabase anon key.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
