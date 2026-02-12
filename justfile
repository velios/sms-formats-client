set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

[private]
default:
  @just --list

# Проверить наличие локального ansible inventory с реальными данными
check-inventory:
  @if [ ! -f "ansible/inventory/production.local.yml" ]; then \
    echo ""; \
    echo "ERROR: ansible/inventory/production.local.yml not found"; \
    echo ""; \
    echo "Create it from template:"; \
    echo "  cp ansible/inventory/production.yml ansible/inventory/production.local.yml"; \
    echo ""; \
    echo "Then set your real VPS IP in ansible_host."; \
    echo ""; \
    exit 1; \
  fi

# Собрать production frontend (dist/)
build:
  @bun run build

# Собрать и задеплоить frontend на VPS
deploy-frontend: check-inventory
  @echo "Building production bundle..."
  @bun run build
  @echo "Deploying dist/ to VPS..."
  @cd ansible && ANSIBLE_STDOUT_CALLBACK=default ansible-playbook playbooks/deploy-frontend.yml -i inventory/production.local.yml

# Задеплоить уже собранный dist/ без ребилда
deploy-frontend-no-build: check-inventory
  @echo "Deploying existing dist/ to VPS..."
  @cd ansible && ANSIBLE_STDOUT_CALLBACK=default ansible-playbook playbooks/deploy-frontend.yml -i inventory/production.local.yml
