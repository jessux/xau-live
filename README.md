# XAUUSD Live

Prix de l'or en direct (Swissquote, 1 s, secours gold-api.com), uniquement des données live.

- **`/`** : graphique + zones d'achat / de vente calculées sur le prix (plus hauts / plus bas locaux regroupés).
- **`/scalp.html`** : carnet d'ordres live (or tokenisé PAXG/XAUT agrégé, recalé sur le spot) + paper trading live de 7 stratégies de scalping, ticks et trades enregistrés dans une base SQLite
  (sql.js, dans le navigateur, sauvegardée dans IndexedDB), rejeu de l'historique avec d'autres paramètres, console SQL, export `.sqlite`.
- **`/binance.html`** : règle candidate « acheteur défensif mangé » ([trading-carnet/strategie/SYNTHESE_SIGNAL.md](https://github.com/jessux/trading-carnet/blob/main/strategie/SYNTHESE_SIGNAL.md)) en papier sur Binance USDⓈ-M Futures :
  carnet local complet (diff `depth@100ms` + instantané REST) et `aggTrade`, ventes limites simulées comparées à des ordres témoins posés au hasard, export CSV.
  Tourne tant que l'onglet est ouvert. Le journal et les ordres terminés sont sauvegardés par symbole dans le navigateur et affichés dès l'ouverture, sans connexion à Binance ;
  les ordres en cours ne sont pas repris après fermeture.

- **`/pullback.html`** : variante « trend pullback H4/H1 » (EMA 50, objectif 3R, 24 h/24) en papier sur bougies 1 h PAXG/USDT (Binance).
  Journal recalculé depuis l'historique à chaque ouverture (départ du papier : 26/11/2026), position ouverte et signal en attente affichés.

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

Sur `/scalp.html`, « Prix indisponible » signifie qu'aucune cotation valide n'a été reçue ; aucun tick n'est enregistré dans ce cas.

## Déployer sur Vercel

vercel.com → New Project → importer `jessux/xau-live` → Deploy.

## Structure

```
index.html         zones d'achat / de vente
scalp.html         paper trading + SQLite
binance.html       règle « acheteur mangé » en papier sur Binance Futures
pullback.html      pullback H4/H1 objectif 3R en papier (PAXG 1 h)
xau.js             zones, stratégies, moteur, graphique (partagé)
binance.js         carnet local Binance + règle « acheteur mangé » (sans I/O)
api/price.js       prix Swissquote (+ secours gold-api.com)
api/book.js        carnet d'ordres live or tokenisé (Binance, Kraken, Coinbase, Bitfinex)
pullback.js        backtest « trend pullback H4/H1 » sur bougies H1 + validation réglage / contrôle :
                   node pullback.js paxg (télécharge data/paxg-h1.csv) puis node pullback.js data/paxg-h1.csv
                   (ou CSV Dukascopy : node pullback.js bid.csv ask.csv)
dev.js             serveur local
test.js            node test.js : vérifie zones, moteur, carnet Binance et règle
```
