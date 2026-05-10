# Takumi Pulses — iOS Shortcut Setup

Twee zachte pulsen per dag, gebouwd via iOS Shortcuts + Automation.
Geen server-side cron, geen push-subscriptions — jouw iPhone doet het werk.

## Wat het doet

- **07:30** — iPhone toont een notificatie: dag-leider + één ochtendvraag
- **21:30** — iPhone toont een notificatie: dag-leider + één avondvraag
- Klik op notificatie → opent Takumi direct in de juiste view

Beide pulsen werken zonder dat de Takumi-app open hoeft te staan.

---

## Eenmalige Setup (15 minuten totaal)

### Stap 1: Maak de Ochtend-Shortcut

1. Open **Shortcuts** app op iPhone
2. Tik op **+** rechtsboven om een nieuwe Shortcut te maken
3. Geef hem de naam **"Takumi Ochtend"**
4. Voeg deze acties toe in deze volgorde:

   **A. Get Contents of URL**
   - URL: `https://app.takumi-master.com/api/pulse?type=morning&format=text`
   - Method: GET
   - (geen headers nodig)

   **B. Show Notification**
   - Title: `匠 Takumi`
   - Body: `[Contents of URL]` (de output van vorige stap)
   - Sound: aan (kies een rustige toon — bv. "Calypso" of "Note")

5. Tik op **Done** om op te slaan

### Stap 2: Maak de Avond-Shortcut

Herhaal Stap 1 met deze aanpassingen:
- Naam: **"Takumi Avond"**
- URL: `https://app.takumi-master.com/api/pulse?type=evening&format=text`
- Body in notificatie: zelfde patroon

### Stap 3: Test beide Shortcuts handmatig

- Open Shortcuts → tap op **Takumi Ochtend** → notificatie verschijnt
- Idem voor **Takumi Avond**
- Als beide werken → ga door naar Stap 4

### Stap 4: Maak de Automations

1. Open Shortcuts → tab **Automation** (onderaan)
2. Tik op **+** rechtsboven
3. Kies **Create Personal Automation**
4. Kies **Time of Day**
5. Tijd: **7:30 AM**, herhaal **Daily**
6. Tap **Next**
7. Voeg actie toe: **Run Shortcut** → kies **Takumi Ochtend**
8. **BELANGRIJK:** zet **"Ask Before Running"** uit (anders moet je elke dag bevestigen)
9. Tap **Done**

Herhaal voor de Avond:
- Tijd: 9:30 PM
- Run Shortcut: **Takumi Avond**

---

## Aanpassen

- **Andere tijden?** Open de Automation, tap erop, wijzig de tijd
- **Andere notificatie-stijl?** Pas de Shortcut aan: in plaats van *Show Notification* kun je ook *Add Reminder* gebruiken (komt dan in Reminders-app)
- **Stop met pulsen?** Schakel de Automation uit (toggle in Automation-tab)
- **Ad-hoc dag-leider opvragen?** Zeg *"Hé Siri, Takumi Ochtend"* — Siri activeert de Shortcut

---

## Wat de notificatie laat zien

```
匠 Takumi
─────────────────────────
Goedemorgen — 地 Chi leidt vandaag.

Welk fundament onder vandaag draagt nog steeds?
```

Klik op de notificatie → Takumi opent in de Cockpit (ochtend) of Rituelen-hub (avond).

---

## Werkt het niet?

- **Notificaties komen niet?** Check Settings → Notifications → Shortcuts → notificaties aan
- **Automation gaat niet automatisch?** "Ask Before Running" moet UIT staan
- **API antwoordt niet?** Test in browser: `https://app.takumi-master.com/api/pulse?type=morning&format=text` — moet plain text geven
- **Verkeerde tijd of dag-leider?** De API kijkt naar UTC+2 (Amsterdam). Bij grote drift: meld in nieuwe chat
