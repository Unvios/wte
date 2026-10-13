#!/usr/bin/env bash
# release_mod.sh — полный релизный флоу мода (см. docs/mod-standard.md).
#
# Использование (из корня репо):
#   tools/release_mod.sh <ModDirName> [--no-push] [--no-github] [--pre]
#
# Что делает:
#   1. Проверяет mod.json (валидный JSON, версия) и совпадение версии с
#      MOD_VERSION в плагине, баланс скобок всех js/plugins/*.js.
#   2. Проверяет, что в CHANGELOG.md есть секция "## <версия>".
#   3. Коммитит папку мода ("release: v<версия>"), ставит аннотированный тег
#      v<версия>-<shortname> (shortname = имя папки без WTE_QOL_, lowercase).
#   4. Собирает dist/<ModName>-v<версия>.zip (структура mods/<ModName>/,
#      без logs/).
#   5. Пушит коммит и тег (пропуск: --no-push).
#   6. Создаёт GitHub release по тегу с телом из секции ченджлога и
#      прикрепляет zip (пропуск: --no-github; --pre = prerelease).
#      Токен берётся из git credential (тот же, что для push), ничего
#      хранить в скрипте не нужно.
#
# Повторный запуск безопасен: существующий коммит/тег/release/ассет
# обнаруживаются и не дублируются (ассет с тем же именем перезаливается).

set -euo pipefail

MOD_NAME="${1:-}"
shift || true
DO_PUSH=1
DO_GITHUB=1
PRERELEASE=0
for arg in "$@"; do
    case "$arg" in
        --no-push)   DO_PUSH=0 ;;
        --no-github) DO_GITHUB=0 ;;
        --pre)       PRERELEASE=1 ;;
        *) echo "unknown flag: $arg" >&2; exit 2 ;;
    esac
done

[ -n "$MOD_NAME" ] || { echo "usage: tools/release_mod.sh <ModDirName> [--no-push] [--no-github] [--pre]" >&2; exit 2; }

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
MOD_DIR="mods/$MOD_NAME"

die() { echo "ERROR: $*" >&2; exit 1; }

# --- 1. Валидация -----------------------------------------------------------

[ -f "$MOD_DIR/mod.json" ] || die "$MOD_DIR/mod.json not found"

VERSION=$(perl -MJSON::PP -e '
    local $/; my $j = decode_json(<STDIN>);
    die "no version in mod.json\n" unless $j->{version};
    print $j->{version};
' < "$MOD_DIR/mod.json") || die "mod.json is not valid JSON"

ls "$MOD_DIR"/js/plugins/*.js >/dev/null 2>&1 || die "no plugins in $MOD_DIR/js/plugins/"

PLUGIN_VER=$(sed -n "s/.*MOD_VERSION *= *'\([^']*\)'.*/\1/p" "$MOD_DIR"/js/plugins/*.js | sort -u)
[ "$PLUGIN_VER" = "$VERSION" ] || die "version mismatch: mod.json=$VERSION, MOD_VERSION=$PLUGIN_VER"

for f in "$MOD_DIR"/js/plugins/*.js; do
    perl -0777 -ne '
        s{/\*.*?\*/}{}gs;
        s{//[^\n]*}{}g;
        s{"(?:[^"\\]|\\.)*"}{}gs;
        s{\x27(?:[^\x27\\]|\\.)*\x27}{}gs;
        s{`(?:[^`\\]|\\.)*`}{}gs;
        my $o = () = /[{(\[]/g; my $c = () = /[})\]]/g;
        exit($o == $c ? 0 : 1);
    ' "$f" || die "bracket mismatch in $f"
done

[ -f "$MOD_DIR/CHANGELOG.md" ] || die "$MOD_DIR/CHANGELOG.md not found"
NOTES=$(perl -0777 -ne '
    if (/^## \Q'"$VERSION"'\E\s*\n(.*?)(?=^## |\z)/ms) { my $s=$1; $s =~ s/^\s+|\s+$//g; print $s; }
' "$MOD_DIR/CHANGELOG.md")
[ -n "$NOTES" ] || die "no \"## $VERSION\" section in $MOD_DIR/CHANGELOG.md"

SHORT=$(echo "$MOD_NAME" | sed -e 's/^WTE_QOL_//' | tr 'A-Z' 'a-z')
TAG="v$VERSION-$SHORT"
TITLE="$MOD_NAME v$VERSION"

echo "==> $TITLE  (tag $TAG)"

# --- 2. Коммит и тег --------------------------------------------------------

git add "$MOD_DIR"
if git diff --cached --quiet; then
    echo "==> nothing to commit in $MOD_DIR"
else
    git commit -m "release: v$VERSION"
fi

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
    echo "==> tag $TAG already exists"
else
    git tag -a "$TAG" -m "$TITLE"
fi

# --- 3. Архив ---------------------------------------------------------------

mkdir -p dist
ZIP="dist/${MOD_NAME}-v${VERSION}.zip"
STAGE=$(mktemp -d)
mkdir -p "$STAGE/mods"
cp -r "$MOD_DIR" "$STAGE/mods/$MOD_NAME"
rm -rf "$STAGE/mods/$MOD_NAME/logs"
rm -f "$ZIP"
powershell -NoProfile -Command \
    "Compress-Archive -Path '$(cygpath -w "$STAGE/mods")' -DestinationPath '$(cygpath -w "$ZIP")' -Force" \
    >/dev/null
rm -rf "$STAGE"
echo "==> zip: $ZIP"

# --- 4. Push -----------------------------------------------------------------

if [ "$DO_PUSH" -eq 1 ]; then
    git push origin HEAD
    git push origin "$TAG"
else
    echo "==> push skipped (--no-push)"
    DO_GITHUB=0
fi

# --- 5. GitHub release --------------------------------------------------------

[ "$DO_GITHUB" -eq 1 ] || { echo "==> github release skipped"; exit 0; }

REMOTE=$(git remote get-url origin)
REPO=$(echo "$REMOTE" | sed -e 's#.*github.com[:/]##' -e 's/\.git$//')
TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p')
[ -n "$TOKEN" ] || die "no github credential (git credential fill returned nothing)"
AUTH="Authorization: Bearer $TOKEN"
API="https://api.github.com/repos/$REPO"

PAYLOAD=$(TITLE="$TITLE" TAG="$TAG" NOTES="$NOTES" PRE="$PRERELEASE" perl -MJSON::PP -e '
    print encode_json({
        tag_name   => $ENV{TAG},
        name       => $ENV{TITLE},
        body       => $ENV{NOTES},
        draft      => JSON::PP::false,
        prerelease => ($ENV{PRE} ? JSON::PP::true : JSON::PP::false),
    });
')

REL_ID=$(curl -s -H "$AUTH" "$API/releases/tags/$TAG" | perl -ne 'if (/"id":\s*(\d+)/) { print "$1\n"; exit; }')
if [ -n "$REL_ID" ]; then
    echo "==> release for $TAG already exists (id $REL_ID), updating body"
    curl -s -X PATCH -H "$AUTH" -H "Content-Type: application/json" \
        -d "$PAYLOAD" "$API/releases/$REL_ID" >/dev/null
else
    RESP=$(curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
        -d "$PAYLOAD" "$API/releases")
    REL_ID=$(printf '%s' "$RESP" | perl -ne 'if (/"id":\s*(\d+)/) { print "$1\n"; exit; }')
    [ -n "$REL_ID" ] || die "release creation failed: $(printf '%s' "$RESP" | head -c 300)"
    echo "==> release created (id $REL_ID)"
fi

# Ассет с тем же именем — удалить, потом залить заново.
ASSET_NAME=$(basename "$ZIP")
OLD_ASSET=$(curl -s -H "$AUTH" "$API/releases/$REL_ID/assets" \
    | perl -0777 -ne 'while (/\{"url"[^{]*?"id":\s*(\d+)[^{]*?"name":\s*"'"$ASSET_NAME"'"/gs) { print "$1\n"; }' | head -1)
if [ -n "$OLD_ASSET" ]; then
    curl -s -X DELETE -H "$AUTH" "$API/releases/assets/$OLD_ASSET" >/dev/null
    echo "==> old asset $ASSET_NAME replaced"
fi

UP=$(curl -s -X POST -H "$AUTH" -H "Content-Type: application/zip" \
    --data-binary "@$ZIP" \
    "https://uploads.github.com/repos/$REPO/releases/$REL_ID/assets?name=$ASSET_NAME")
printf '%s' "$UP" | grep -q '"browser_download_url"' || die "asset upload failed: $(printf '%s' "$UP" | head -c 300)"

echo "==> done: https://github.com/$REPO/releases/tag/$TAG"
