#!/bin/sh
# Installation unique du serveur de jeu sur le Raspberry Pi. À lancer en root depuis ce dossier :
#     sh setup-pi.sh
# Ne touche pas à la configuration nginx du site : affiche à la fin les deux lignes à y ajouter.
set -eu
cd "$(dirname "$0")"
say() { printf '\n== %s\n' "$1"; }
die() { printf 'ERREUR : %s\n' "$1" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "lancer en root (sudo sh setup-pi.sh)"
CR=$(printf '\r')
for f in dojo-deploy dojo-server.service nginx-dojo-pvp.conf sudoers-dojo-deploy; do
    [ -f "$f" ] || die "fichier manquant : $f"
    if grep -q "$CR" "$f"; then die "$f a des fins de ligne Windows (CRLF) : recopier le dossier deploy/ tel quel"; fi
done

say "Vérifications"
command -v node >/dev/null || die "node introuvable"
command -v npm >/dev/null || die "npm introuvable"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || die "Node 20 ou plus requis (trouvé $(node -v))"
id dojo-deploy >/dev/null 2>&1 || die "le compte dojo-deploy n'existe pas"
[ -f /etc/dojo/env ] || die "/etc/dojo/env manquant (DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, PUBLIC_URL, TRUST_PROXY…)"
for v in DISCORD_CLIENT_ID DISCORD_CLIENT_SECRET PUBLIC_URL; do grep -q "^$v=." /etc/dojo/env || die "$v absent de /etc/dojo/env"; done
grep -q '^TRUST_PROXY=1' /etc/dojo/env || die "TRUST_PROXY=1 absent de /etc/dojo/env (nécessaire derrière nginx)"
if grep -q '^DEV=1' /etc/dojo/env; then die "DEV=1 ne doit pas être dans /etc/dojo/env en production"; fi
echo "node $(node -v), npm $(npm -v), /etc/dojo/env présent"

say "Fichier de réglages : root seulement (systemd le lit avant de passer au compte dojo)"
chown root:root /etc/dojo /etc/dojo/env
chmod 700 /etc/dojo
chmod 600 /etc/dojo/env

say "Compte système dojo (fait tourner le serveur, sans shell ni mot de passe)"
id dojo >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin dojo
id dojo

say "Dossier du code : /opt/dojo-pvp (écrit par dojo-deploy, lisible par dojo)"
install -d -o dojo-deploy -g dojo-deploy -m 755 /opt/dojo-pvp /opt/dojo-pvp/releases

say "Script de déploiement"
install -o root -g root -m 755 dojo-deploy /usr/local/bin/dojo-deploy

say "Droit de redémarrer le serveur (et rien d'autre) pour dojo-deploy"
install -o root -g root -m 440 sudoers-dojo-deploy /etc/sudoers.d/dojo-deploy
visudo -cf /etc/sudoers.d/dojo-deploy || { rm -f /etc/sudoers.d/dojo-deploy; die "règle sudo invalide"; }

say "Service systemd"
install -o root -g root -m 644 dojo-server.service /etc/systemd/system/dojo-server.service
systemctl daemon-reload
systemctl enable dojo-server
echo "Activé ; il démarrera au premier déploiement du serveur."

say "Configuration nginx (fichier inclus, pas encore utilisé)"
install -d /etc/nginx/snippets
install -o root -g root -m 644 nginx-dojo-pvp.conf /etc/nginx/snippets/dojo-pvp.conf

cat <<'TXT'

== Reste à faire à la main dans /etc/nginx/sites-enabled/<site dreamland> (bloc « listen 443 ssl ») :
  1. Ajouter, avant « location / { » :
         include snippets/dojo-pvp.conf;
  2. Dans la ligne Content-Security-Policy, remplacer « connect-src 'self' » par :
         connect-src 'self' wss://dreamland.harruis.fr
  3. Vérifier puis recharger :
         nginx -t && systemctl reload nginx

Puis lancer le workflow GitHub (Actions → Build and Deploy → Run workflow, branche voulue).
Suivi : journalctl -u dojo-server -f
TXT
