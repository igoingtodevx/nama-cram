# NAMA Cram

NAMA Klausur – Anki on Crack: Flashcards, Lernfortschritt und AI-Tutor.

## Lernen

- Karte antippen: Antwort aufdecken.
- Danach bewerten: **😰 Schwer**, **🤔 Okay** oder **✅ Sicher**. Jede Bewertung speichert den Stand lokal und zeigt sofort die nächste Karte.
- Auf dem Smartphone: nach dem Aufdecken nach **links** wischen = Schwer, nach **rechts** = Sicher, nach **oben** = Okay. Ein horizontaler Swipe auf der Vorderseite deckt die Karte auf.
- Der Fortschritt bleibt im Browser gespeichert. Im Fortschrittsfenster kann er außerdem exportiert und auf einem anderen Gerät wieder importiert werden.

## Lokal prüfen

Keine Installation nötig (statische Seite). Mit Node 22+:

```bash
node --test tests/*.test.js
python3 -m http.server 8765 --bind 127.0.0.1
```

Dann `http://127.0.0.1:8765` öffnen.
