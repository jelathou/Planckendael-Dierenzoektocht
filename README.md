# Planckendael Dierenzoektocht 🦊🐘🐒

Een installeerbare web-app (PWA) om tijdens een bezoek aan dierenpark **Planckendael** dieren te zoeken en te fotograferen. Werkt **volledig offline** op je gsm.

## Wat doet het?

- Op het **home-scherm** volg je een **voortgangspad**: de 61 Planckendael-dieren zijn verdeeld over opeenvolgende zoektochten van **9 dieren** (elk dier komt maar **één keer** in het hele traject voor; de laatste zoektocht heeft er 7). Aan het einde van het pad ligt een **jungle vol dieren**.
- Start een zoektocht → de 9 dieren staan in een **fotogrid**. Klik op een dier om het **fullscreen** te bekijken met naam, Latijnse naam en een leuk weetje.
- Vind je het dier in het park? Druk op de groene knop **Dier gevonden** en **maak een foto** met de camera. De foto wordt in de app bewaard. (Vergissing? Zet het dier terug op *niet-gevonden*.)
- Voltooi je een zoektocht? Dan doet een **dansend dier** een dansje en juicht: *"Goed gedaan, je bent een echte speurneus!"* 🎉 Voltooi je het hele traject, dan bereik je de **jungle vol dieren**. 🌴

## Volledig offline op je gsm (aanbevolen) 📱

De app is een PWA met een service worker: na één keer laden wordt **alles** (code én alle dierenfoto's) op je toestel bewaard, zodat je in het park **geen internet** nodig hebt.

**Eenmalig installeren via GitHub Pages:**

1. Zet deze map als een GitHub-repository online.
2. Repo → **Settings → Pages** → *Deploy from a branch* → branch `main`, map `/ (root)` → Save.
3. Na ~1 minuut krijg je een URL zoals `https://<gebruiker>.github.io/<repo>/`.
4. Open die URL op je gsm (Chrome/Safari) → menu → **Toevoegen aan beginscherm**.
5. Open de app één keer met internet zodat de service worker alles cachet. Daarna werkt ze **offline**, met app-icoon en fullscreen.

> De **live camera** werkt enkel in een beveiligde context (`https://`), wat via GitHub Pages automatisch het geval is.

## Lokaal testen (op de pc)

De camera vereist `https://` of `localhost`. Start een lokale server in deze map:

```powershell
python -m http.server 8080
# open daarna http://localhost:8080
```

> Open je `index.html` rechtstreeks als `file://`, dan werkt de live camera niet (val je terug op de native camera-picker) en is er geen offline service worker.

## Structuur

| Pad | Inhoud |
|---|---|
| `index.html` | Alle schermen + modals |
| `css/style.css` | Mobile-first thema |
| `js/app.js` | Alle logica |
| `data/animals.json` | Dierenlijst (`id`, `naam`, `latijn`, `weetje`, `wiki`, `afbeelding`) |
| `img/` | Lokaal gebundelde dierenfoto's (offline) |
| `sw.js` | Service worker (offline-cache) |
| `manifest.json` + `icon.svg` | PWA-installatie |

## Opslag

Voortgang, gevonden dieren en je gemaakte foto's worden lokaal op je toestel bewaard (`localStorage` + `IndexedDB`). Er is geen server; je data blijft op je gsm.

## Foto's van de dieren

De dierenfoto's in `img/` zijn afkomstig van Wikimedia Commons. Een enkel dier kan terugvallen op een online Wikipedia-foto als er lokaal geen afbeelding is; is er ook geen internet, dan toont de app een neutrale placeholder (🐾).
