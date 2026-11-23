# Stratégie de scalping fictive – XAUUSD « Contre la foule »

> Exercice pédagogique, non testé (aucun backtest). À utiliser uniquement en compte démo. Pas un conseil en investissement.

## Idée

Les traders particuliers ont souvent tort. On prend le **sens opposé de la majorité**, et on utilise les **zones où beaucoup de positions sont ouvertes** comme supports, résistances ou cibles.

## Données utilisées (page XAUUSD Live)

| Rôle | Donnée | Fréquence |
|---|---|---|
| Biais | % long / short (FastBull, Myfxbook) | 30 min / qq min |
| Carburant | % longs / shorts en gain ou en perte | 30 min |
| Niveaux | Niveaux principaux (concentrations) | 30 min |
| Déclencheur | Prix bid / ask | 1 s |

## Règles

### 1. Biais (toutes les 30 min)
- Shorts ≥ 55 % → on cherche **uniquement des achats**.
- Longs ≥ 55 % → on cherche **uniquement des ventes**.
- Entre 45 et 55 % → **pas de trade**.
- Bonus : si la majorité est **en perte**, ses stops vont alimenter le mouvement inverse (squeeze), donc signal plus fort.

### 2. Niveaux
- Garder les 3 niveaux avec la plus forte concentration à **± 40 $** du prix.
- Niveau sous le prix = zone d'entrée achat. Niveau au-dessus = cible ou zone d'entrée vente.
- Ajouter les chiffres ronds (3650, 3700…).

### 3. Entrée (prix seconde par seconde)
- Le prix revient à **≤ 1 $** d'un niveau dans le sens du biais.
- Confirmation : **3 ticks consécutifs** dans le sens du biais.
- Spread ≤ **0,80 $**, sinon on attend.

### 4. Sortie
- Stop : **2 $** au-delà du niveau.
- Objectif : **4 $** (ratio 1:2) ou le niveau suivant, le plus proche des deux.
- Stop à prix d'entrée dès + 2 $.
- Sortie forcée après **10 min**.

### 5. Gestion du risque
- Risque max **0,5 % du capital** par trade.
- Max **5 trades/jour**, arrêt après **2 pertes d'affilée**.
- Pas de trade **15 min avant/après** une annonce majeure (NFP, CPI, Fed).

## Exemple (snapshot 23/11/2026 15h)

| Donnée | Valeur | Lecture |
|---|---|---|
| Prix | ~3672 | |
| Short / Long | 57 % / 43 % | biais **achat** |
| Shorts en gain | 71 % | pas de squeeze pour l'instant |
| Niveaux proches | 3660 (longs), 3700 (shorts 0,42 %) | entrée 3660, cible 3700 |

**Plan :** attendre un retour vers **3660–3661**, 3 ticks haussiers → **achat**.
Stop **3658**, objectif **3664** (+4 $), puis 3680 ou 3700 si on laisse courir une partie.

## Limites
- Positions décalées de jusqu'à 30 min : c'est un **biais**, pas un signal d'entrée.
- FastBull = échantillon de brokers, pas tout le marché.
- Les spreads et le slippage mangent une grosse part d'un objectif de 4 $.
- À valider par un backtest avant toute utilisation réelle.
