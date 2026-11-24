# XAUUSD Live

Prix de l'or en direct (Swissquote, 1 s, secours gold-api.com), uniquement des données live.

- **`/`** : graphique + zones d'achat / de vente calculées sur le prix (plus hauts / plus bas locaux regroupés).
- **`/scalp.html`** : carnet d'ordres live (or tokenisé PAXG/XAUT agrégé, recalé sur le spot) + paper trading live de 7 stratégies de scalping, ticks et trades enregistrés dans une base SQLite
  (sql.js, dans le navigateur, sauvegardée dans IndexedDB), rejeu de l'historique avec d'autres paramètres, console SQL, export `.sqlite`.
- **`/binance.html`** : règle candidate « acheteur défensif mangé » ([trading-carnet/strategie/SYNTHESE_SIGNAL.md](https://github.com/jessux/trading-carnet/blob/main/strategie/SYNTHESE_SIGNAL.md)) en papier sur Binance USDⓈ-M Futures :
  carnet local complet (diff `depth@100ms` + instantané REST) et `aggTrade`, ventes limites simulées comparées à des ordres témoins posés au hasard, export CSV.
  Tourne tant que l'onglet est ouvert.

## Tester en local

Prérequis : **Node.js 18+** (aucun `npm install` nécessaire).

```bash
git clone https://github.com/jessux/xau-live
cd xau-live
node dev.js
```

Ouvrir http://localhost:3000

### Derrière un proxy d'entreprise (PowerShell)

`dev.js` fait passer les requêtes par `HTTPS_PROXY` (sans dépendance) :

```powershell
$env:HTTPS_PROXY="http://proxy.entreprise:8080"; node dev.js
```

Adresse du proxy : `netsh winhttp show proxy`, ou demander au service informatique.
Si le proxy demande un identifiant : `http://user:motdepasse@proxy:8080`.

### Vérifier les API

- http://localhost:3000/api/price

## Déployer sur Vercel

vercel.com → New Project → importer `jessux/xau-live` → Deploy.

## Structure

```
index.html         zones d'achat / de vente
scalp.html         paper trading + SQLite
binance.html       règle « acheteur mangé » en papier sur Binance Futures
xau.js             zones, stratégies, moteur, graphique (partagé)
binance.js         carnet local Binance + règle « acheteur mangé » (sans I/O)
api/price.js       prix Swissquote (+ secours gold-api.com)
api/book.js        carnet d'ordres live or tokenisé (Binance, Kraken, Coinbase, Bitfinex)
dev.js             serveur local
test.js            node test.js : vérifie zones, moteur, carnet Binance et règle
```
