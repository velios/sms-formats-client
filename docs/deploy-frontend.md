# Frontend Deploy (Build local -> upload to VPS)

This repo deploys only static frontend files via Ansible.
It does **not** modify your Caddy config automatically.

## 1. Prepare local inventory (IP/SSH)

```bash
cp ansible/inventory/production.yml ansible/inventory/production.local.yml
```

Set real host values in `ansible/inventory/production.local.yml`:
- `ansible_host`
- `ansible_user`
- optional target path: `frontend_deploy_base_path`

`production.local.yml` is gitignored, so this repo stays independent from other projects.

## 2. Build + deploy

```bash
just deploy-frontend
```

What happens:
1. `bun run build` creates `dist/`.
2. `dist/` is archived locally.
3. Files are uploaded to VPS.
4. Previous version is backed up to `.../previous`.
5. New version is extracted to `.../current`.

Default target path on VPS:

```text
/var/www/sms-formats-client/current
```

## 3. Manual Caddy update

Use snippet from:

`docs/caddy/sms-formats-client.caddy`

Recommended multi-project setup on one VPS:
- keep `/etc/caddy/Caddyfile` as a small root config;
- add `import /etc/caddy/conf.d/*.caddy`;
- store each app in its own file under `/etc/caddy/conf.d/`.

This avoids cross-project config overwrite.

Add it to your existing Caddy setup manually, then reload Caddy:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
```

## 4. If app is served from a subpath

If your URL is not domain root (example: `https://example.com/sms-formats/`),
set build base path before deploy:

```bash
VITE_APP_BASE_PATH=/sms-formats/ just deploy-frontend
```

For root-domain deploy keep default:

```bash
VITE_APP_BASE_PATH=/ just deploy-frontend
```

MIME error like "server responded with text/html for module script" usually means
asset URL does not match current `base` or Caddy route.
