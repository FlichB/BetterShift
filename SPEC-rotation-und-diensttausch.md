# Spezifikation: Rotations-Generator & Diensttausch für BetterShift

> Arbeitsbriefing für Claude Code. Abschnitt 12 hält die im Grilling (2026-10-21) getroffenen
> Entscheidungen fest und hat Vorrang vor den Abschnitten 1–11. Begriffe: siehe `CONTEXT.md`.

---

## 1. Kontext

- **Basis:** Fork von [panteLx/BetterShift](https://github.com/panteLx/BetterShift) (MIT-Lizenz), Fork: [FlichB/BetterShift](https://github.com/FlichB/BetterShift)
- **Stack:** Next.js 16, React 19, TypeScript, SQLite + Drizzle ORM, Better Auth, Tailwind/shadcn/ui, next-intl
- **Team:** 8 Mitarbeiter, immer **2 gleichzeitig im Dienst**, rollierend mit möglichst großem Abstand
- **Grundprinzip:** Der Chef erzeugt den Plan automatisch, die Mitarbeiter tauschen Dienste **komplett untereinander, ohne Freigabe**
- **Zugriff:** Web-Oberfläche (inkl. Smartphone-Browser/PWA) ist Pflicht; ICS-Feed existiert bereits
- **Keine** rechtlichen Einschränkungen (Ruhezeiten, Qualifikationen o. Ä.) nötig

## 2. Ziele

1. **Rotations-Generator:** Admin erzeugt per Knopfdruck einen fairen Dienstplan für einen Zeitraum.
2. **Tauschbörse:** Mitarbeiter bieten Dienste an, Kollegen übernehmen oder tauschen – sofort wirksam.
3. **Nachvollziehbarkeit:** Jeder Tausch landet im vorhandenen Audit-Log.
4. **Updatefähigkeit:** Der Fork bleibt möglichst nah am Original, damit Upstream-Updates einspielbar bleiben.

## 3. Vorgehen für Claude Code (zuerst lesen!)

1. **Codebasis erkunden, bevor irgendetwas geändert wird:**
   - `CLAUDE.md` und `AGENTS.md` des Projekts lesen und deren Konventionen befolgen
   - Drizzle-Schema – wie sind Kalender, Schichten (Shifts), Presets, User und Freigaben modelliert?
   - `docs/PERMISSIONS.md` – wer darf welche Kalender sehen/bearbeiten?
   - Wie funktioniert das Audit-Logging? Wie sind API-Routen aufgebaut?
   - Wie sind Übersetzungen in `messages/` organisiert?
2. **Kurzen Umsetzungsplan vorlegen** (welche Dateien neu, welche geändert), bevor Code geschrieben wird.
3. **Bestehende Modelle wiederverwenden** – Dienste sind normale BetterShift-Schichten, keine Parallelwelt.

## 4. Leitplanken für den Fork

- Neue Logik in **eigene Ordner** legen, z. B. `lib/rotation/`, `lib/swap/`, `app/rotations/`, `app/swaps/`, `components/rotation/`, `components/swap/`
- **Neue Tabellen** statt bestehende Tabellen umzubauen; bestehende Tabellen nur dort erweitern, wo unvermeidbar
- Änderungen an Originaldateien **minimal** halten (Navigation, Menüeintrag, Konfiguration) und mit `// [fork]`-Kommentar markieren
- Migrationen ausschließlich über `npm run db:generate` / `npm run db:migrate`
- Alle UI-Texte über next-intl, **mindestens `de` und `en`**
- `npm test` muss vor jedem Commit grün sein; neue Logik bekommt eigene Tests

## 5. Feature A – Rotations-Generator

### 5.1 Konfiguration (eine „Rotation")

| Feld | Beschreibung | Beispiel |
|---|---|---|
| `name` | Bezeichnung | „Samstagsdienst" |
| `calendarId` | Zielkalender (gemeinsamer Teamkalender) | – |
| `members` | geordnete Liste der teilnehmenden User | 8 Personen |
| `perShift` | Personen pro Dienst | 2 |
| `period` | Dienstlänge: `day` \| `week` \| eigene Dauer in Tagen | `week` |
| `startDate` | Beginn der Rotation | 2026-11-02 |
| `preset` | Preset liefert Titel, Zeit, Farbe | Preset „Samstagsdienst" 09:30–15:00 |
| `weekdays` | Diensttage innerhalb der Periode | Samstag |

### 5.2 Algorithmus

- Reihum-Verfahren (Round Robin) über die Teilnehmerliste: Dienst Nr. *i* bekommt die Personen an den Positionen `(startOffset + i·perShift + k) mod n` für `k = 0 … perShift−1`
- Bei 8 Personen und 2 pro Dienst ⇒ jede Person ist **jede 4. Periode** dran
- Ist `n` nicht durch `perShift` teilbar, läuft die Rotation trotzdem gleichmäßig weiter
- Algorithmus als **reine Funktion** ohne DB-Zugriff in `lib/rotation/generate.ts`

### 5.3 Generieren

- Admin wählt Zeitraum (z. B. „nächste 12 Wochen") → **Vorschau** → „Übernehmen"
- **Idempotent:** Erneutes Generieren für denselben Zeitraum erzeugt keine Duplikate
- **Getauschte Plätze bleiben erhalten** (gesperrt) und werden beim Neugenerieren nicht überschrieben
- „Ab Datum X neu generieren" (Teilnehmerwechsel); Vergangenheit wird nie verändert

### 5.4 Rechte

- Nur Admin bzw. Kalender-Owner darf Rotationen anlegen, ändern und generieren

## 6. Feature B – Diensttausch (ohne Freigabe)

### 6.1 Abläufe

1. **Abgeben:** A bietet einen eigenen Platz an. Jeder andere Teilnehmer kann ihn übernehmen.
2. **Tauschen:** A bietet Platz X an und wünscht im Gegenzug einen Platz von B (konkret oder „beliebig"). B nimmt an → beide Plätze werden getauscht.
3. **Direktanfrage:** A fragt gezielt B an (abgeben oder tauschen). B nimmt an oder lehnt ab.

### 6.2 Regeln

- Wirkt **sofort** nach Annahme – keine Genehmigung
- Prüfungen beim Ausführen (serverseitig, in einer Transaktion):
  - Der angebotene Platz gehört noch A und der Dienst hat noch nicht begonnen
  - Der Übernehmende hat zu dieser Zeit **keine Doppelbelegung**
  - Bei Tausch: Der Gegenplatz gehört noch B und der Dienst hat noch nicht begonnen
  - Angebot ist noch offen (zwei gleichzeitige Annahmen → nur eine gewinnt)
- Getauschte Plätze werden gesperrt (siehe 5.3)
- Angebote können vom Anbieter **zurückgezogen** werden, solange niemand angenommen hat
- Offene Angebote **verfallen** bei Dienstbeginn
- Jeder Schritt (angeboten, angenommen, abgelehnt, zurückgezogen, ausgeführt, verfallen) → **Audit-Log**

### 6.3 Datenmodell (Vorschlag)

```
shift_swaps (id, type: 'give' | 'exchange', status: 'open' | 'accepted' | 'declined' | 'withdrawn' | 'expired',
             offeredShiftId, offeredByUserId, targetUserId (nullable = an alle),
             requestedShiftId (nullable = beliebig), acceptedByUserId, acceptedShiftId, createdAt, resolvedAt)
```

### 6.4 Oberfläche

- Bei jedem eigenen zukünftigen Dienst Button „Abgeben / Tauschen"
- Seite „Tauschbörse" (`/swaps`): offene Angebote (an alle + an mich), „Übernehmen", „Gegendienst anbieten", „Ablehnen" (nur Direktanfrage)
- „Meine Angebote": Status sehen, zurückziehen
- Kalenderansicht: Dienste mit offenem Angebot dezent markieren
- **Mobile first**

## 7. Feature C – Benachrichtigungen (Phase 3)

- E-Mail (SMTP per ENV) und/oder Web-Push
- Auslöser: neues Angebot an alle bzw. an mich, mein Angebot wurde angenommen, Dienst morgen
- Pro User abschaltbar
- **Outlook-Integration:** Dienste als iCalendar-Einladungen (REQUEST/CANCEL) per SMTP in die persönlichen Kalender (siehe 12, offen: M365 vs. Exchange)

## 8. Umsetzungsphasen

| Phase | Inhalt | Ergebnis |
|---|---|---|
| **0** | Codebasis erkunden, Plan vorlegen | Freigegebener Plan |
| **1** | Rotations-Generator (Schema, Algorithmus + Tests, Admin-UI mit Vorschau) | Plan für 8 Personen generierbar |
| **2** | Tauschbörse (Schema, Server-Logik + Tests, UI, Audit-Log) | Mitarbeiter tauschen selbständig |
| **3** | Benachrichtigungen + Outlook-Einladungen | E-Mail bei Angeboten, Dienste im Outlook |
| **4** | Feinschliff: Übersetzungen, Mobile-Check, persönlicher ICS-Feed, Doku `docs/ROTATION_AND_SWAPS.md` | Release-fertig |

Nach jeder Phase: `npm test`, `npm run build`, kurzer Bericht. Docker-Image baut GitHub Actions (GHCR).

## 9. Abnahmekriterien

- [ ] Rotation mit 8 Personen / 2 pro Dienst / wöchentlich (Samstag) erzeugt einen Plan, in dem jede Person exakt jede 4. Woche Dienst hat
- [ ] Erneutes Generieren erzeugt keine Duplikate und überschreibt keine getauschten Plätze
- [ ] Mitarbeiter A kann einen Dienst abgeben; B übernimmt; der Kalender zeigt B (spätestens nach 15 s)
- [ ] Tausch zweier Dienste funktioniert in einem Schritt und ist atomar
- [ ] Doppelbelegung wird verhindert; zwei gleichzeitige Annahmen → nur eine erfolgreich
- [ ] Begonnene/vergangene Dienste können weder getauscht noch neu generiert werden
- [ ] Alle Tauschvorgänge stehen im Audit-Log
- [ ] ICS-Feed spiegelt Tausche ohne weiteres Zutun wider
- [ ] UI auf Deutsch, auf dem Smartphone bedienbar
- [ ] Nicht-Berechtigte können keine Rotationen anlegen oder generieren

## 10. Testfälle (Auswahl)

- Generator: n = 8 / perShift = 2; n = 7 / perShift = 2; perShift = 1; Start mitten in der Woche; nur Werktage; nur Samstag; Ausfalltag
- Generator: Neugenerierung ab Datum X nach Teilnehmerwechsel
- Tausch: Abgeben an alle, Direktanfrage, Gegendienst; Ablehnen; Zurückziehen; Verfallen bei Dienstbeginn
- Tausch: Übernehmender hat zur selben Zeit schon Dienst → Fehler
- Tausch: Angebot zwischenzeitlich zurückgezogen → Annahme schlägt sauber fehl
- Rechte: Teilnehmer ohne Kalenderzugriff sieht keine Angebote

## 11. Betrieb

- Später: interner Server, `docker compose up -d` mit eigenem Image aus GHCR (`ghcr.io/flichb/bettershift`)
- BetterShift-Images ab v3 nur für **linux/amd64**
- `TZ=Europe/Vienna`, `DEFAULT_LOCALE=de`
- SQLite-Datei (`./data`) ins Server-Backup
- Reverse Proxy: `TRUSTED_PROXY_HEADER` korrekt setzen

## 12. Entscheidungen (Grilling 2026-10-21)

1. **Entwicklung** ausschließlich in der WSL (Node 24 via nvm) im Ordner `/mnt/c/bettershifter`; Docker-Images baut GitHub Actions.
2. **Dienst = Tagesschicht**, auch bei Periode „Woche". Die Periode bestimmt nur, wie lange dieselbe Besetzung gilt. Anwendungsfall: Periode Woche + Diensttag Samstag.
3. **Wochen beginnen am Montag.** Startet die Rotation mitten in der Woche, ist die Rumpfwoche die erste Periode. Dienste über Mitternacht sind erlaubt (Ende < Beginn).
4. **Doppelbelegung** = zeitliche Überschneidung mit einem anderen Dienst (beliebiger Rotation), nicht mit beliebigen Schichten.
5. **Keine Abwesenheitsverwaltung**; Urlaub wird über die Tauschbörse gelöst.
6. **Tausch „beliebig":** Der Annehmende wählt einen eigenen künftigen Platz, der Tausch wird sofort ausgeführt.
7. **Ablehnen** gibt es nur bei Direktanfragen (beendet das Angebot); Angebote an alle kann man nur ausblenden.
8. **Gesperrte Plätze** bleiben beim Neugenerieren unangetastet. Enthält ein gesperrter Platz eine ausgeschiedene Person, zeigt die Vorschau eine Warnung mit der Aktion „Sperre aufheben".
9. **Vorgehen:** Stopp nach jeder Phase mit Bericht und Abnahme.
10. **Datenmodell:** siehe `docs/adr/0001-dienst-als-schicht-mit-plaetzen.md` (Dienst = Schicht, Platz = Signup, Sperre am Platz).
11. **Tests:** Vitest wird ergänzt (`npm run test:unit`, Teil von `npm test`).
12. **Rechte:** Rotationen verwalten darf, wer Owner ist, im Kalender `manageCalendarSettings` hat oder globaler Admin ist.
13. **UI:** eigene Seiten `/rotations` und `/swaps`; Tausch-Button zusätzlich im Schicht-Detail.
14. **Samstagsdienst** 09:30–15:00 (Beispiel-Preset und Testdaten).
15. **Ausfalltage** werden an der Rotation gepflegt; die Reihenfolge rückt nach.
16. **Neustart ab X:** Standardmäßig beginnt die Reihe mit dem Teilnehmer nach dem letzten Dienst vor X; der Admin kann das ändern.
17. **Manuelle Änderungen** an generierten Plätzen werden beim Neugenerieren überschrieben (mit Hinweis in der Vorschau).
18. **Teilnehmer** erhalten im Teamkalender das Bündel „Read".
19. **Verfallen:** Lesend sofort, plus stündlicher In-Prozess-Timer, der den Status setzt und protokolliert.
20. **Persönlicher ICS-Feed** („nur meine Dienste") in Phase 4; `TZ=Europe/Vienna`.
21. **Outlook:** Dienste sollen später automatisch in den Outlook-Kalendern der Betroffenen erscheinen. Empfehlung: iCalendar-Einladungen per SMTP (Phase 3); offen: Microsoft 365 oder Exchange on-prem. Jeder Platz erhält eine stabile ID als Termin-UID.
22. **Migrationen** der Fork-Tabellen in eigenem Ordner/Tracking, siehe `docs/adr/0002-eigene-migrationsspur-fuer-fork.md`.
