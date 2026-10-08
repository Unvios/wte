#!/usr/bin/env bash
# Включает WTE Mod Loader (VirtualModLoader) в js/plugins.js.
# Запускать после каждого обновления игры — Steam откатывает файл к оригиналу.
# js/plugins.js НЕ хранится в репозитории (файл игры), поэтому правка
# восстанавливается только этим скриптом.
set -e
cd "$(dirname "$0")/.."

sed -i 's/"name":"VirtualModLoader","status":false/"name":"VirtualModLoader","status":true/' js/plugins.js

if grep -q '"name":"VirtualModLoader","status":true' js/plugins.js; then
    echo "OK: VirtualModLoader включён, моды будут загружаться."
else
    echo "ERROR: паттерн не найден — формат js/plugins.js мог измениться." >&2
    exit 1
fi
