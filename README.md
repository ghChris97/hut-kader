# HUT Kader

Private Kader-App für Hockey Ultimate Team: Kartensuche, eigener Kader und Reihen-Optimierer.

- `app/` – die Web-App (statisch, läuft auf GitHub Pages)
- `scraper/scrape.py` – holt einmal täglich die Kartendaten von nhlhutbuilder.com
- `version.txt` – eingestellte NHL-Version. Wechselt nie von selbst; zum Umstellen die Zahl ändern.
- `.github/workflows/pages.yml` – täglicher Lauf: Daten holen, testen, Seite veröffentlichen

Die Kartendaten liegen nicht im Repo, sie werden bei jedem Lauf frisch geholt.
Nicht mit Electronic Arts oder NHL HUT Builder verbunden.
