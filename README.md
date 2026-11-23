# XAUUSD Live

Prix de l'or en direct + positions des traders (long / short).

| Donnée | Source | Fréquence |
|---|---|---|
| Prix bid / ask | Swissquote | 1 s |
| Positions + niveaux | FastBull | 30 min |
| Positions + prix moyens | Myfxbook (optionnel) | quelques min |

## Tester en local

Prérequis : **Node.js 18+** (aucun `npm install` nécessaire).

```bash
git clone https://github.com/jessux/xau-live
cd xau-live
node dev.js
```

Ouvrir http://localhost:3000

### Activer Myfxbook (optionnel)

Compte gratuit sur myfxbook.com, puis :

```bash
MYFXBOOK_EMAIL="ton@email" MYFXBOOK_PASSWORD="motdepasse" node dev.js
```

Windows (PowerShell) :

```powershell
$env:MYFXBOOK_EMAIL="ton@email"; $env:MYFXBOOK_PASSWORD="motdepasse"; node dev.js
```

### Vérifier les API

- http://localhost:3000/api/price
- http://localhost:3000/api/positions

## Déployer sur Vercel

vercel.com → New Project → importer `jessux/xau-live` → Deploy.
Pour Myfxbook : Settings → Environment Variables → `MYFXBOOK_EMAIL`, `MYFXBOOK_PASSWORD`, puis redéployer.

## Structure

```
index.html         page
api/price.js       prix Swissquote
api/positions.js   FastBull + Myfxbook
dev.js             serveur local
```
