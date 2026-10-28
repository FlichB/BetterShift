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

- Dienste laufen in **Runden**, in denen jede Person gleich oft dran ist (bei 8 Personen und 2 pro Dienst: 4 Dienste, jede Person einmal)
- Die erste Runde ist das Reihum-Verfahren ab `startOffset` (Positionen `(startOffset + i·perShift + k) mod n`)
- Jede weitere Runde wird neu zusammengestellt (siehe §12, Entscheidung 30): nie zwei Dienste in Folge, nie derselbe Partner wie beim eigenen letzten Dienst, die Paare wechseln durch, und jede Person bleibt nahe an ihrem gleichmäßigen Takt (`n / perShift`), damit die Anzahl pro Quartal höchstens um 1 abweicht
- Ist `n` nicht durch `perShift` teilbar, ist eine Runde `n / ggT(n, perShift)` Dienste lang
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
- **Outlook-Integration:** Dienste als iCalendar-Einladungen (REQUEST/CANCEL) per SMTP in die persönlichen Kalender oder per Microsoft Graph (siehe 12.21; Umgebung: Microsoft 365)
- **Entschieden (2026-10-22, siehe 12.24–12.27):** Microsoft Graph; office@ bleibt Organisator, ein Termin pro Dienst *(ersetzt durch 12.32: ein Termin pro Platz)*; Angebots-Mails per Graph von office@; keine Mail „Dienst morgen" (Outlook erinnert), kein Web-Push

## 8. Umsetzungsphasen

| Phase | Inhalt | Ergebnis |
|---|---|---|
| **0** | Codebasis erkunden, Plan vorlegen | Freigegebener Plan |
| **1** | Rotations-Generator (Schema, Algorithmus + Tests, Admin-UI mit Vorschau) | Plan für 8 Personen generierbar |
| **2** | Tauschbörse (Schema, Server-Logik + Tests, UI, Audit-Log) | Mitarbeiter tauschen selbständig |
| **3** | Benachrichtigungen + Outlook-Einladungen | E-Mail bei Angeboten, Dienste im Outlook |
| **4** | Feinschliff: Übersetzungen, Mobile-Check, persönlicher ICS-Feed, Doku `docs/ROTATION_AND_SWAPS.md` | Release-fertig *(umgesetzt 2026-10-23, Design: docs/superpowers/specs/2026-10-23-phase-4-feinschliff-feed-design.md)* |

Nach jeder Phase: `npm test`, `npm run build`, kurzer Bericht. Docker-Image baut GitHub Actions (GHCR).

## 9. Abnahmekriterien

- [x] Rotation mit 8 Personen / 2 pro Dienst / wöchentlich (Samstag) erzeugt einen Plan, in dem jede Person einmal pro 4 Wochen Dienst hat *(Phase 1: Unit-Test + API-Abnahme 2026-10-21; seit 2026-10-27 mit wechselnden Paaren, siehe §12.30)*
- [x] Erneutes Generieren erzeugt keine Duplikate und überschreibt keine getauschten Plätze *(Phase 1: Duplikate per API geprüft; Sperren per Integrationstest, echte Tausche ab Phase 2)*
- [x] Mitarbeiter A kann einen Dienst abgeben; B übernimmt; der Kalender zeigt B (spätestens nach 15 s) *(Phase 2: Abgeben/Übernehmen im Dev-Server abgenommen, Kalender-Symbol verschwindet ohne Neuladen, 2026-10-22)*
- [x] Tausch zweier Dienste funktioniert in einem Schritt und ist atomar *(Phase 2: gezielter Tausch und „Tausch beliebig" per Dev-Server-Abnahme, 2026-10-22)*
- [x] Doppelbelegung wird verhindert; zwei gleichzeitige Annahmen → nur eine erfolgreich *(Phase 2: zwei parallele Annahmen → 200 und 409 `notOpen`, 2026-10-22)*
- [x] Begonnene/vergangene Dienste können weder getauscht noch neu generiert werden *(Phase 4: Tests `alreadyStarted` + Neugenerieren ab früherem Datum, 2026-10-23)*
- [x] Alle Tauschvorgänge stehen im Audit-Log *(Phase 2: `swap.offered/accepted/declined/withdrawn` mit lesbaren Texten, 2026-10-22)*
- [x] ICS-Feed spiegelt Tausche ohne weiteres Zutun wider *(Phase 4: persönlicher Feed, Test „follows a swap", 2026-10-23; Hinweis: Der Team-Feed enthält keine Platzinhaber; Tausche werden erst mit dem persönlichen Feed sichtbar, Phase 4, 12.20)*
- [x] UI auf Deutsch, auf dem Smartphone bedienbar *(Phase 2: Teil Tauschbörse in 375 px Breite ohne horizontales Scrollen, 2026-10-22)*
- [x] Nicht-Berechtigte können keine Rotationen anlegen oder generieren *(Phase 1: Teilnehmer mit „Read" → 403, API-Abnahme 2026-10-21)*
- [x] *(Phase 3, seit 12.32)* Rotation mit Outlook-Schalter: pro künftigem Platz genau ein ganztägiger Termin im office@-Kalender mit dem Inhaber als einzigem Teilnehmer *(Dry-Run abgenommen 2026-10-22, echter Tenant offen: 19 von 19 `create` mit je zwei Teilnehmern)* *(FakeGraph-Test „one all-day free event per Platz", 2026-10-27; echter Tenant offen)*
- [x] *(Phase 3)* Tausch, Abgabe und Umbesetzung durch den Chef ändern die Teilnehmer innerhalb von 60 s *(Dry-Run abgenommen 2026-10-22, echter Tenant offen: `update` binnen eines 15-s-Intervalls nach Tausch und nach Umbesetzung per Signup-Route)*
- [x] *(Phase 3)* Ausfalltag oder Ausschalten sagt künftige Termine ab; vergangene bleiben unberührt *(Ausschalten sagt 19 von 19 Terminen ab, Dry-Run 2026-10-22; Ausfalltag und „vergangene bleiben unberührt" per FakeGraph-Test 2026-10-23, echter Tenant offen)*
- [x] *(Phase 3)* In office@ gelöschte oder geänderte Termine werden spätestens im Nachtlauf wiederhergestellt *(per FakeGraph-Test 2026-10-23, echter Tenant offen)*
- [x] *(Phase 3)* Angebots-Mails an die richtigen Empfänger; abgeschaltete Arten werden nicht versendet *(Dry-Run abgenommen 2026-10-22, echter Tenant offen: BCC ohne Anbietenden, abgeschalteter Benutzer fehlt, Annahme-Mail an den Anbietenden)*
- [x] *(Phase 3)* Ohne Microsoft-365-Konfiguration verhält sich die App wie nach Phase 2 *(API-Abnahme 2026-10-22: `configured:false`, Schalter wird mit 400 abgelehnt)*
- [x] *(Phase 3)* Graph-Ausfall verliert keine Änderung *(per FakeGraph-Test 2026-10-23, echter Tenant offen)*

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
18. **Teilnehmer** erhalten im Teamkalender das Bündel „Read". Hinweis (2026-10-21): Das mitgelieferte Bündel „Read" enthält `signUpSelf` („Sich selbst eintragen"); bis Phase 2 einen Guard ergänzt, sollten Teilnehmer ein Bündel ohne diese Berechtigung erhalten. **Entscheidung (2026-10-22):** Phase 2 sperrt im Code das Selbst-Ein- und Austragen bei Plätzen generierter Dienste; Plätze wechseln nur über die Tauschbörse. „Read" bleibt danach für Teilnehmer nutzbar. Umgesetzt in Phase 2: Selbst-Ein-/Austragen auf Diensten ist für Benutzer ohne `signUpOthers` gesperrt (`lib/swap/guard.ts`); Abnahme 2026-10-22 (403 `dutySlotSwapOnly`).
19. **Verfallen:** Lesend sofort, plus stündlicher In-Prozess-Timer, der den Status setzt und protokolliert.
20. **Persönlicher ICS-Feed** („nur meine Dienste") in Phase 4; `TZ=Europe/Vienna`.
21. **Outlook:** Dienste sollen später automatisch in den Outlook-Kalendern der Betroffenen erscheinen. Umgebung: **Microsoft 365** (Entscheidung 2026-10-22). Optionen für Phase 3: iCalendar-Einladungen per SMTP über M365 oder direkt per Microsoft Graph (App-Registrierung in Entra ID nötig) — Auswahl im Grilling vor Phase 3. Jeder Platz erhält eine stabile ID als Termin-UID.
22. **Migrationen** der Fork-Tabellen in eigenem Ordner/Tracking, siehe `docs/adr/0002-eigene-migrationsspur-fuer-fork.md`.
23. **Angebote ohne Tauschrecht (2026-10-22):** Verliert der Anbieter das Tauschrecht im Kalender (`signUpSelf`), wird sein offenes Tauschangebot (`exchange`) beim Annehmen auf `cancelled` gesetzt und mit `notOpen` abgewiesen; eine Abgabe (`give`) bleibt annehmbar. *(ersetzt durch 12.33: es gibt keine Abgabe mehr, nur Tausch und erzwungener Tausch)* Der Anbieter darf sein eigenes Angebot immer zurückziehen.
24. **Outlook-Weg (2026-10-22):** Microsoft Graph statt iCal per SMTP. Wie bisher ist das Postfach office@ Organisator; die App pflegt nur den office@-Kalender (Entra-App mit `Calendars.ReadWrite` + `Mail.Send`, per Exchange-RBAC auf office@ beschränkt), Exchange verschickt Einladungen, Aktualisierungen und Absagen. **Ein Termin pro Dienst**, Teilnehmer = aktuelle Platzinhaber – ersetzt die Platz-UID aus 12.21. *(ersetzt durch 12.32: ein Termin pro Platz)* Aktivierung per ENV plus Schalter pro Rotation.
25. **Abgleich (2026-10-22):** In-Prozess-Worker vergleicht jede Minute lokale Fingerprints der Sollzustände (erfasst auch Umbesetzungen über Upstream-Routen) und gleicht nur Abweichungen mit Graph ab; nachts zusätzlich Vollabgleich gegen den office@-Kalender. Kein Altbestand im office@-Kalender zu übernehmen.
26. **Adresse (2026-10-22):** Outlook-Adresse eines Teilnehmers = seine Login-E-Mail.
27. **Benachrichtigungen (2026-10-22):** E-Mail per Graph von office@ bei neuem Angebot an alle, Direktanfrage an mich, Annahme bzw. Ablehnung meines Angebots; pro Benutzer und Art abschaltbar auf `/swaps`. Einreihen in derselben Transaktion wie die Tauschaktion (Outbox). Angebote an alle gehen nicht an die aktuellen Inhaber des angebotenen Dienstes, da sie ihn nicht übernehmen können. Design: `docs/superpowers/specs/2026-10-22-phase-3-outlook-benachrichtigungen-design.md`.
28. **Persönlicher Feed (2026-10-23):** ein Link pro Benutzer über alle Kalender, nur Dienste mit eigenem Platz, 60 Tage Rückblick, Partner („Mit: …") und Tausch-Link in der Beschreibung; Verwaltung auf `/swaps` (Knopf „Kalender-Abo"). Design: `docs/superpowers/specs/2026-10-23-phase-4-feinschliff-feed-design.md`.
29. **Mobile (2026-10-23):** Bedienelemente der Fork-Seiten nutzen die Upstream-Größe `sm` (32 px); geprüft bei 375 px ohne horizontales Scrollen. Die Vorgabe „≥ 40 px" (§6) wurde bewusst nicht erzwungen, um nah am Upstream-Design zu bleiben.
30. **Wechselnde Paare (2026-10-27):** Feste Paare sind unerwünscht. Pro Runde hat jede Person gleich oft Dienst; ab der zweiten Runde wird neu gemischt, sodass nie zwei Samstage in Folge und nie zweimal hintereinander mit demselben Partner Dienst ist. Mindestens ein dienstfreier Samstag zwischen zwei Diensten; bei 6 Personen ist der Abstand dadurch zeitweise knapp (2 Wochen), das ist akzeptiert. Pro Kalenderquartal weicht die Anzahl der Dienste höchstens um 1 ab. Deterministisch ab `startDate` gerechnet; Neugenerieren verteilt nicht gesperrte künftige Plätze entsprechend neu.
31. **Verstärkte Tage (2026-10-27):** Der Verantwortliche trägt an der Rotation einzelne Daten mit einer höheren Personenzahl ein. Der Generator besetzt die Zusatzplätze reihum; ein Zusatzplatz zählt voll (Runden zählen Plätze, nicht Dienste). „Nie zwei Diensttage in Folge“ und „nie derselbe Partner hintereinander“ bleiben weiche Regeln und dürfen rund um verstärkte Tage brechen; niemand sitzt zweimal im selben Dienst. Ohne verstärkte Tage ist der Plan unverändert (Regressions-Snapshot). Vergangene Einträge bleiben gespeichert. Design: `docs/superpowers/specs/2026-10-27-verstaerkte-tage-design.md`.
32. **Ein Eintrag pro Person (2026-10-27):** Jeder besetzte Platz erscheint als eigener Eintrag mit einem Titel aus der Eintragsvorlage der Rotation (Platzhalter `{Vorname}`, `{Name}`, `{Dienst}`, Standard „{Vorname} Dienst"). BetterShift zeigt im Monats- und Wochenraster eine Zeile pro Platz mit echten Uhrzeiten, freie Plätze als „Offener Platz"; das Datenmodell bleibt (ADR 0001). Outlook: ein ganztägiger Termin pro Platz im office@-Kalender, Status „Frei", einziger Teilnehmer ist der Platzinhaber; Tausch und Umbesetzung sagen den Termin des bisherigen Inhabers ab und laden den neuen ein. Ersetzt „ein Termin pro Dienst" aus 12.24. Schließeinträge bleiben ein Termin. Persönlicher Feed übernimmt den Titel; Team-Feed bleibt ohne Inhaber (12.20). Design: `docs/superpowers/specs/2026-10-27-eintrag-pro-person-design.md`.
33. **Nur Tauschen, erzwungener Tausch (2026-10-27):** Abgeben entfällt, jedes Angebot ist ein Tausch; offene Abgaben werden hinfällig. Die Rotations-Verwaltung kann einen Tausch erzwingen (Krankenstand): an eine bestimmte Person oder offen an alle, der Platz wechselt sofort. Der Einspringer wählt danach frei einen eigenen Dienst bis 3 Monate nach dem übernommenen Dienst als Ausgleich, ohne Frist; die Verwaltung kann stellvertretend wählen oder mit Begründung erlassen. Erzwingen geht bis zum Ende des Diensttages. Die 3-Monats-Grenze gilt nur hier. *(erweitert durch 12.37: gilt auch für Vorschläge zu einem gesperrten Dienstfrei)* Design: `docs/superpowers/specs/2026-10-27-erzwungener-tausch-design.md`.
34. **Dienstfrei (2026-10-27):** Schalter pro Rotation „Dienstfrei nach Dienst"; keine eigene Rotation. Jeder besetzte Platz bringt genau ein Dienstfrei mit, auch Zusatzplätze, geöffnete Feiertage, Einspringer- und Ausgleichsplätze; ein Schließtag bringt keines. Das Dienstfrei entsteht beim Generieren und hängt am Platz, folgt also dessen Inhaber. Einschalten versorgt beim nächsten Generieren alle künftigen Dienste, auch bereits erzeugte; Ausschalten entfernt alle künftigen Dienstfreie mit Benachrichtigung. Vergangene bleiben als Historie, rückwirkend entsteht nichts. Zustände: **Standard**, **Verschoben**, **Gesperrt**, **Vereinbart**, **Entfallen**.
35. **Datum des Dienstfreis (2026-10-27):** Standardtag ist der nächste Arbeitstag Mo–Fr nach dem Dienst. Kein Arbeitstag sind Feiertage des Feiertagskalenders, Ausfalltage der Rotation und Tage, an denen dieselbe Person schon ein anderes Dienstfrei hat. Hat die ganze Folgewoche keinen Arbeitstag, gilt der nächste Arbeitstag danach, auch in einer späteren Woche. Arbeitstage pro Person (Teilzeit) werden nicht abgebildet; wer an einem Tag ohnehin nicht arbeitet, verschiebt selbst (12.36). Ausfalltage dürfen auch auf Werktage fallen und erscheinen dort ebenfalls als Schließeintrag in Teamkalender und Outlook (erweitert 12.15; die Rundennummerierung zählt weiter nur Diensttage). Krankheit und Urlaub am Dienstfrei bleiben außerhalb der App (12.5); bei Bedarf sperrt die Verwaltung und es wird neu vereinbart.
36. **Dienstfrei verschieben (2026-10-27):** Neues Recht im Rechte-Paket („Dienstfrei selbst verschieben"), in allen Paketen standardmäßig angehakt, auch im Bündel „Read" (12.18); für Gäste und Freigabe-Links nie: Die Prüfung zählt nur Owner und Freigaben (`calendarShares`) und ignoriert Freigabe-Link und Gast-Bündel. Eine Aufnahme in `GUEST_INELIGIBLE` scheidet aus, weil dann kein Paket mehr für Freigabe-Links zuweisbar wäre. Wirksam nur für Teilnehmer mit Platz. Verschoben wird innerhalb derselben Arbeitswoche Mo–Fr auf einen Arbeitstag. Hat ein Tag schon andere Dienstfreie, warnt die App, sperrt aber nicht. Verschieben, Sperren und Vereinbaren gehen nur, solange weder der alte noch der neue Tag begonnen hat. Wird das Recht entzogen, bleiben bereits verschobene Tage bestehen.
37. **Dienstfrei sperren und vereinbaren (2026-10-27):** Die Rotations-Verwaltung (12.12) kann ein Dienstfrei sperren; es hat dann kein Datum und keinen Kalendereintrag. Der Mitarbeiter schlägt einen oder mehrere Termine vor, jeweils ein Arbeitstag ab jetzt bis 3 Monate nach dem Diensttag. Die Verwaltung nimmt einen an (die übrigen verfallen), lehnt mit Pflicht-Begründung ab oder macht einen Gegenvorschlag, den der Mitarbeiter annimmt oder ablehnt; das wiederholt sich, bis ein Termin feststeht. Bleiben Vorschläge 3 Tage unbeantwortet, erhält die Verwaltung eine Erinnerung. Keine automatische Annahme; ein offenes Dienstfrei verfällt nie stillschweigend, auch nach Ablauf des Fensters nicht. Ein **vereinbartes** Dienstfrei kann der Mitarbeiter nicht selbst verschieben; er kann eine Änderung beantragen (neue Vorschläge), der vereinbarte Termin gilt bis zur Annahme eines neuen. Eine erneute Sperre setzt es auf „Gesperrt" zurück.
38. **Dienstfrei bei Tausch und Änderungen (2026-10-27):** Bei jedem Platzwechsel (Tausch, erzwungener Tausch, Ausgleich, Neugenerieren) gilt für den neuen Inhaber: aus Standard oder Verschoben wird Standard; Gesperrt bleibt gesperrt, offene Vorschläge des alten Inhabers verfallen; aus Vereinbart wird Gesperrt. Wird das Datum nachträglich ungültig (neuer Feiertag oder Ausfalltag, anderes eigenes Dienstfrei), wandert ein Standard-Dienstfrei weiter, ein verschobenes fällt auf den Standardtag zurück, ein vereinbartes wird gesperrt – die beiden letzten mit Benachrichtigung. Wird der Diensttag selbst zum Schließtag, ist das Dienstfrei entfallen (mit Benachrichtigung).
39. **Dienstfrei anzeigen und benachrichtigen (2026-10-27):** Ganztägiger Eintrag im Teamkalender mit eigener Vorlage pro Rotation (Standard „{Vorname} dienstfrei"), im persönlichen Feed und in Outlook als ganztägiger Termin im office@-Kalender mit der Person als einzigem Teilnehmer, Status „Abwesend". Bedienung auf `/swaps` im neuen Bereich „Dienstfrei" (eigene Dienstfreie; für die Verwaltung offene Sperren und Vorschläge); ein Klick auf den Kalendereintrag führt dorthin. E-Mails per Graph wie 12.27, pro Benutzer und Art abschaltbar: Sperre → Mitarbeiter; neue Vorschläge oder Änderungsantrag → Rotations-Verwaltung; Annahme, Ablehnung, Gegenvorschlag → jeweils die andere Seite; entfallen oder ungültig geworden → Mitarbeiter; Erinnerung → Rotations-Verwaltung.
40. **Dienstfrei pro Teilnehmer (2026-10-28):** Im Rotationsformular lässt sich das Dienstfrei je Teilnehmer ausschalten (z. B. All-in-Vertrag, Überstunden abgegolten); Standard ist an. Maßgeblich ist der aktuelle Inhaber eines Platzes, nicht der ursprünglich eingeteilte: Ein Teilnehmer ohne Dienstfrei bekommt für keinen Platz eines (auch nicht nach einem Tausch), übernimmt er per Tausch einen Platz, entfällt dessen Dienstfrei (Grund `excluded`, Mail an den bisherigen Inhaber); gibt er einen Platz ab, bekommt der neue Inhaber sofort ein Standard-Dienstfrei. Wer nicht Teilnehmer der Rotation ist (z. B. Einspringer von außerhalb), bekommt eines. Beim Ausschalten entfallen die noch nicht begonnenen Dienstfreie dieses Teilnehmers, begonnene bleiben Historie.
