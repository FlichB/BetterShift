# Rotationen, Tauschbörse und persönlicher Kalender-Feed

Diese Anleitung beschreibt die Fork-Erweiterungen von BetterShift: Dienste reihum erzeugen lassen (Rotation), Dienste selbständig abgeben und tauschen (Tauschbörse), die eigenen Dienste als Kalender-Abo beziehen und den Betrieb der App. Die Outlook-Anbindung steht separat in [`OUTLOOK_SETUP.md`](OUTLOOK_SETUP.md).

## Inhalt

1. [Überblick und Begriffe](#1-überblick-und-begriffe)
2. [Rotation anlegen](#2-rotation-anlegen)
3. [Generieren](#3-generieren)
4. [Tauschbörse](#4-tauschbörse)
5. [Rechte](#5-rechte)
6. [Benachrichtigungen und Outlook](#6-benachrichtigungen-und-outlook)
7. [Persönlicher Kalender-Feed](#7-persönlicher-kalender-feed)
8. [Betrieb](#8-betrieb)
9. [Grenzen und bekannte Punkte](#9-grenzen-und-bekannte-punkte)

---

## 1. Überblick und Begriffe

Ein Verantwortlicher legt eine **Rotation** an: eine feste, geordnete Gruppe von **Teilnehmern**, die reihum auf **Dienste** in einem Teamkalender verteilt wird. Die App erzeugt die Dienste für einen gewählten Zeitraum. Danach tauschen die Teilnehmer ihre Dienste selbständig auf der **Tauschbörse**, ohne Freigabe durch den Verantwortlichen. Jeder Teilnehmer kann seine eigenen Dienste als Kalender-Abo beziehen, und optional landen die Dienste als Termine im Outlook-Kalender von office@.

Die wichtigsten Begriffe (das vollständige Glossar steht in [`CONTEXT.md`](../CONTEXT.md)):

| Begriff | Bedeutung |
| --- | --- |
| **Rotation** | Die Regel, nach der eine feste, geordnete Gruppe von Teilnehmern reihum auf Dienste verteilt wird. |
| **Teilnehmer** | Ein Benutzer mit fester Position in einer Rotation. |
| **Periode** | Der Zeitabschnitt, in dem dieselbe Besetzung Dienst hat: ein Tag, eine Woche ab Montag oder eine feste Anzahl Tage. |
| **Diensttage** | Die Wochentage innerhalb einer Periode, an denen tatsächlich ein Dienst stattfindet (z. B. nur Samstag). |
| **Ausfalltag** | Ein Diensttag, an dem ausnahmsweise kein Dienst stattfindet. Die Reihenfolge rückt zum nächsten Dienst weiter. |
| **Dienst** | Ein einzelner Kalendertag-Eintrag im Teamkalender, den eine Rotation erzeugt hat und der eine feste Zahl an Plätzen hat. |
| **Platz** | Die Zuordnung genau eines Teilnehmers zu einem Dienst. |
| **Gesperrter Platz** | Ein Platz, der durch einen Tausch entstanden ist. Neues Generieren überschreibt ihn nie. |
| **Doppelbelegung** | Ein Teilnehmer hätte zur selben Zeit Plätze in zwei Diensten. Das wird verhindert. |
| **Angebot** | Die Erklärung, einen eigenen künftigen Platz herzugeben, an alle oder gezielt an einen Kollegen. |
| **Abgabe** | Ein Angebot ohne Gegenleistung: Wer annimmt, übernimmt den Platz. |
| **Tausch** | Ein Angebot mit Gegenleistung: Der Annehmende gibt einen eigenen künftigen Platz zurück. |
| **Direktanfrage** | Ein Angebot, das nur eine bestimmte Person annehmen oder ablehnen kann. |

Die Rotationen verwaltest du unter `/rotations` (Menüpunkt „Rotationen"), die Tauschbörse liegt unter `/swaps` (Menüpunkt „Tauschbörse"). Beides ist nur mit eingeschalteter Anmeldung sinnvoll: Bei `AUTH_ENABLED=false` leitet die Tauschbörse auf die Startseite um; die Seite `/rotations` lässt sich zwar öffnen, aber Tausch, Benachrichtigungen, Outlook-Sync und Feed stehen dann nicht zur Verfügung.

## 2. Rotation anlegen

Voraussetzungen im Teamkalender:

- **Anmeldungen müssen eingeschaltet sein** (Kalendereinstellungen). Sonst haben Dienste keine Plätze, und die Seite weist darauf hin.
- Ein **aktives Preset** legt Titel, Zeit und Farbe der Dienste fest. Beispiel Samstagsdienst: Preset „Samstagsdienst" von 09:30 bis 15:00.
- Alle Teilnehmer brauchen **Zugriff auf den Kalender**. Fehlt jemand in der Auswahl, teile den Kalender zuerst mit ihm (siehe [Rechte](#5-rechte)).

Unter `/rotations` den Kalender wählen und „Neue Rotation" anklicken. Die Felder:

| Feld | Bedeutung |
| --- | --- |
| Name | Bezeichnung der Rotation (bis 100 Zeichen). |
| Preset (Titel, Zeit, Farbe) | Das Preset, aus dem jeder Dienst Titel, Zeit und Farbe erhält. |
| Personen pro Dienst | 1 bis 20. Es braucht mindestens so viele Teilnehmer. |
| Periode | „Tag", „Woche (ab Montag)" oder „Eigene Dauer" (dann „Länge in Tagen", 1 bis 365). |
| Beginn | Erster Tag der ersten Periode. |
| Beginnt mit | Welcher Teilnehmer in der ersten Periode Dienst hat. „Vorschlag übernehmen" setzt einen passenden Wert. |
| Diensttage | Wochentage Mo bis So, an denen in einer Periode tatsächlich Dienst ist („Alle Tage" setzt alle). |
| Ausfalltage | Einzelne Tage ohne Dienst. Mit „Ausfalltag hinzufügen" ergänzen. |
| Teilnehmer (Reihenfolge) | Die Reihenfolge entscheidet über die Verteilung. Mit „Nach oben" / „Nach unten" sortieren, mit „Teilnehmer hinzufügen" ergänzen, mit „Entfernen" streichen. |

Beispiel „Samstagsdienst": Periode „Woche (ab Montag)", Diensttag Sa, 2 Personen pro Dienst, 8 Teilnehmer. Jede Person hat dann exakt jede 4. Woche Dienst. Mit „Speichern" wird die Rotation gesichert; erzeugt sind die Dienste damit noch nicht.

Mit dem Feld „Neustart ab Datum" ersetzt du bei einem Teilnehmerwechsel die Reihenfolge ab einem Stichtag: Dienste davor bleiben unverändert (siehe [Generieren](#3-generieren)).

## 3. Generieren

Im Abschnitt „Dienste erzeugen" einer Rotation wählst du „Von" und „Bis" (höchstens 366 Tage; „{n} Wochen" sind Schnellwahlen).

1. **„Vorschau"** zeigt, was passieren würde, ohne etwas zu ändern. Die Tabelle nennt pro Datum die Besetzung und die Änderung: „Neu", „Geändert", „Unverändert" oder „Entfällt". „Zeit/Titel aus Preset" weist auf Dienste hin, deren Zeit oder Titel noch nicht zum Preset passt. Bei Plätzen, die neu besetzt werden, steht, wie viele es sind. Unter „Hinweise" stehen Warnungen.
2. **„Übernehmen"** führt die Vorschau aus. Das Ergebnis wird als „{created} neu, {updated} geändert, {deleted} entfernt" gemeldet; ist nichts zu tun, steht dort „Alles ist bereits auf dem Stand."

Gut zu wissen:

- **Idempotent.** Erneutes Generieren desselben Zeitraums erzeugt keine Duplikate und ändert nur, was von der Vorgabe abweicht.
- **Vergangenes bleibt.** Bereits begonnene und vergangene Dienste werden nie angefasst, auch wenn der Zeitraum in der Vergangenheit beginnt. Ihre Plätze und Sperren bleiben unverändert.
- **Getauschte Plätze sind gesperrt** und stehen in der Vorschau als „Getauscht (gesperrt)". Beim Neugenerieren bleiben sie erhalten. Ist der Inhaber eines gesperrten Platzes kein Teilnehmer mehr, erscheint unter „Hinweise" der Knopf „Sperre aufheben": Er gibt den Platz für die Rotation frei, und er wird beim nächsten Übernehmen nach der Rotationsregel besetzt.
- **Hinweise:** „{user} ist kein Teilnehmer mehr, hat aber einen getauschten Platz" bzw. „Kein Dienst mehr geplant, aber getauschte Plätze vorhanden – der Dienst bleibt bestehen". Beim ersten Hinweis kannst du die Sperre mit „Sperre aufheben" lösen; beim zweiten bleibt der Dienst samt getauschten Plätzen bestehen.
- **Ausfalltag aus der Vorschau.** In der Vorschau kannst du einen Dienst mit „Fällt aus" als Ausfalltag markieren; die folgenden Besetzungen rücken nach.
- **Teilnehmerwechsel:** Rotation bearbeiten, „Neustart ab Datum" setzen, speichern, ab diesem Datum neu generieren. Dienste vorher bleiben, wie sie waren.
- **Löschen:** „Rotation löschen" fragt, ob die zukünftigen Dienste ebenfalls entfernt werden sollen („Zukünftige Dienste dieser Rotation ebenfalls löschen"). Vergangene Dienste bleiben als normale Schichten im Kalender stehen.

## 4. Tauschbörse

Unter `/swaps` sieht jeder Teilnehmer zwei Reiter: „Für mich" (offene Angebote, die er annehmen kann) und „Meine Angebote" (die eigenen der letzten 30 Tage). Oben wählst du den Kalender.

**Dienst anbieten.** Mit „Dienst anbieten" (oder dem Knopf „Abgeben / Tauschen" im Dienst eines Kalenders) öffnet sich das Formular:

| Feld | Auswahl |
| --- | --- |
| Dein Dienst | Einer deiner künftigen Dienste in diesem Kalender. |
| Art | „Abgeben" oder „Tauschen". |
| An wen? | „An alle" oder „An eine Person" (Direktanfrage, dann „Kollege"). |
| Gewünschter Gegendienst | Nur beim Tauschen: ein konkreter Dienst des Kollegen oder „Beliebig – der andere wählt". |
| Notiz | Freitext, z. B. Grund oder Wunsch. |

Mit „Anbieten" wird das Angebot erstellt. Es gibt vier Fälle:

- **Abgabe:** Wer „Übernehmen" anklickt und bestätigt, übernimmt den Dienst. Das gilt sofort.
- **Tausch gegen einen konkreten Dienst** (im Angebot steht „Tausch gegen" mit dem Datum des Gegendienstes): „Tauschen" anklicken und bestätigen. Beide Plätze wechseln in einem Schritt.
- **Tausch gegen beliebigen Dienst:** Der Annehmende wählt unter „Welchen deiner Dienste gibst du dafür ab?" einen eigenen künftigen Dienst.
- **Direktanfrage** (im Angebot steht „an" mit dem Namen der Person): Nur diese Person kann annehmen oder „Ablehnen".

Weitere Aktionen:

- **„Zurückziehen"**: Der Anbieter nimmt sein offenes Angebot zurück.
- **„Ablehnen"**: Nur bei Direktanfragen, nur durch die angefragte Person.
- **„Ausblenden"** / „Wieder einblenden": Blendet ein Angebot an alle für dich aus der Liste aus. Das geht nur, solange das Angebot offen ist. „Ausgeblendete zeigen" blendet die ausgeblendeten Angebote wieder ein.

Die Status eines Angebots: „Offen", „Angenommen", „Abgelehnt", „Zurückgezogen", „Verfallen", „Hinfällig".

Regeln, die die App durchsetzt:

- **Sofort wirksam.** Annehmen braucht keine Freigabe; der Kalender zeigt die neue Besetzung ohne Neuladen.
- **Atomar.** Beim Tausch wechseln beide Plätze zusammen oder gar nicht. Nehmen zwei Personen gleichzeitig an, gelingt nur eine; die andere erhält „Das Angebot ist nicht mehr offen."
- **Verfallen.** Ein offenes Angebot endet von selbst, sobald der angebotene Dienst begonnen hat. Begonnene und vergangene Dienste lassen sich weder anbieten noch annehmen („Der Dienst hat bereits begonnen.").
- **Hinfällig.** Ein Tausch gegen einen konkreten Gegendienst wird automatisch auf „Hinfällig" gesetzt, wenn dieser Gegendienst nicht mehr abgegeben werden kann: Der Anbieter besitzt ihn selbst, oder bei einer Direktanfrage gehört er der angefragten Person nicht mehr. Ebenso wird ein Angebot hinfällig, wenn der Anbieter den angebotenen Platz nicht mehr innehat oder wenn der angebotene oder der gewünschte Dienst nicht mehr existiert. Verliert der Anbieter das Recht zum Tauschen, wird sein offener Tausch beim Annehmen ebenfalls hinfällig; eine Abgabe bleibt annehmbar.
- **Keine Doppelbelegung.** Würde der Annehmende zur selben Zeit schon Dienst haben, lehnt die App ab („Das ergäbe eine Doppelbelegung.").
- **Ein Angebot je Platz.** Für denselben Platz kann es nur ein offenes Angebot geben.
- **Getauschte Plätze sind gesperrt** und bleiben beim Neugenerieren der Rotation erhalten (siehe [Generieren](#3-generieren)).
- **Plätze von Diensten wechseln nur über die Tauschbörse.** Sich selbst im Dienst ein- oder auszutragen ist für Rotationsdienste gesperrt. Ausnahme: Wer das Recht „Andere eintragen" (`signUpOthers`) hat, kann Plätze weiterhin von Hand umbesetzen.
- Alle Tauschvorgänge stehen im Audit-Log (`swap.offered`, `swap.accepted`, `swap.declined`, `swap.withdrawn`).

## 5. Rechte

| Wer | Was | Voraussetzung |
| --- | --- | --- |
| Verwaltung von Rotationen | Rotationen anlegen, ändern, generieren, Outlook-Schalter | Besitzer des Kalenders, Recht „Kalendereinstellungen verwalten" im Kalender oder Administrator der Instanz |
| Tauschen | Dienste anbieten und annehmen | Angemeldet, im Kalender das Recht „Sich selbst eintragen" (`signUpSelf`) und Anmeldungen im Kalender eingeschaltet |
| Persönlicher Feed | Eigenen Feed einrichten | Angemeldet; im Feed erscheinen nur Dienste aus Kalendern, die der Benutzer sehen darf |

Empfehlung für die Teilnehmer: Den Teamkalender mit dem Bündel **„Read"** teilen. Es enthält „Sich selbst eintragen" und reicht für die Tauschbörse; Teilnehmer können damit nichts anlegen oder ändern. Ein Rotationsdienst lässt sich über das normale Eintragen ohnehin nicht umbesetzen, nur über die Tauschbörse. Die Verwaltung bekommt ein Bündel mit „Kalendereinstellungen verwalten" (z. B. „Manage") oder ist Besitzer des Kalenders.

Das Teilen und die Bündel sind in [`PERMISSIONS.md`](PERMISSIONS.md) beschrieben. Eine Tauschbörse ohne Teilnehmer mit dem Recht zum Eintragen bleibt leer: Wer kein Recht hat, sieht den Kalender dort nicht („Du hast in keinem Kalender Dienste, die du tauschen darfst.").

## 6. Benachrichtigungen und Outlook

Kurzfassung; die vollständige Einrichtung steht in [`OUTLOOK_SETUP.md`](OUTLOOK_SETUP.md).

- **Tausch-Mails.** Über Microsoft Graph verschickt office@ E-Mails bei einem neuen Angebot an alle (nicht an die aktuellen Inhaber des Dienstes), bei einer Direktanfrage an die angefragte Person sowie bei Annahme bzw. Ablehnung an den Anbieter. Jeder Benutzer schaltet unter „Benachrichtigungen" auf `/swaps` die Arten „Neue Angebote an alle", „Anfragen an mich" und „Meine Angebote" einzeln ab.
- **Outlook-Termine.** Pro Rotation gibt es den Schalter „In Outlook (office@) eintragen". Jeder künftige Dienst wird ein Termin im Kalender von office@, die Platzinhaber sind die Teilnehmer; Exchange verschickt Einladungen, Aktualisierungen und Absagen. Tausch, Umbesetzung und Ausfalltag werden binnen etwa einer Minute nachgezogen, ein nächtlicher Vollabgleich stellt gelöschte oder von Hand geänderte Termine wieder her.
- **Ohne Konfiguration** bleibt alles aus; die Rotationsseite zeigt den Schalter deaktiviert („nicht eingerichtet"), und die Tausch-Mails entfallen.
- Wer die Einladungen von office@ erhält, braucht den [Kalender-Feed](#7-persönlicher-kalender-feed) nicht zusätzlich in Outlook.

## 7. Persönlicher Kalender-Feed

Jeder Benutzer kann seine Dienste als Kalender-Abo (ICS) in Google Kalender, Apple Kalender oder Outlook beziehen. Tausche erscheinen von selbst, weil der Feed die aktuellen Plätze zeigt.

**Einrichten.** Auf `/swaps` den Knopf „Kalender-Abo" anklicken (direkter Aufruf: `/swaps?settings=feed`). Im Fenster „Mein Kalender-Abo" mit „Link erstellen" den Link anlegen, mit „Link kopieren" kopieren und im Kalenderprogramm abonnieren:

- Google Kalender (am Computer): Weitere Kalender → Per URL → Link einfügen.
- Apple Kalender: Ablage → Neues Kalenderabonnement → Link einfügen.
- Outlook: Kalender hinzufügen → Aus dem Internet abonnieren → Link einfügen.

Der Link hat die Form `<BETTER_AUTH_URL>/api/feed/me/<Token>.ics`. Er gilt für den Benutzer persönlich, er braucht keine Anmeldung: Wer den Link kennt, kann die Dienste lesen. Gib ihn deshalb nicht weiter.

**Inhalt.**

- **Ein Link pro Benutzer** über alle Kalender und Rotationen hinweg.
- Es erscheinen **nur Rotationsdienste, auf denen du aktuell einen eigenen Platz hast**, aus Kalendern, die du sehen darfst. Von Hand angelegte Schichten mit Anmeldungen sind nicht enthalten.
- Zeitraum: die **letzten 60 Tage** und **alle künftigen** Dienste.
- Der Kalender heißt „Meine Dienste". Titel und Zeit stammen vom Dienst; die Beschreibung enthält der Reihe nach Notizen und benutzerdefinierte Felder des Dienstes, dann „Mit: …" (die anderen Platzinhaber, entfällt, wenn du allein im Dienst bist) und „Tauschen: `<BETTER_AUTH_URL>`/swaps".
- Die festen Texte („Mit", „Tauschen", „Meine Dienste") stehen in `DEFAULT_LOCALE`.

**Neu erzeugen und widerrufen.**

- „Neu erzeugen" erstellt einen neuen Link. Der alte funktioniert **sofort nicht mehr**; bestehende Abos musst du mit dem neuen Link einrichten.
- „Widerrufen" löscht den Link. Abos damit erhalten keine Dienste mehr (die Anfrage wird mit 404 beantwortet).
- Beides ist im Audit-Log festgehalten (`personal_feed.created`, `personal_feed.rotated`, `personal_feed.revoked`).
- Das Fenster zeigt „Zuletzt abgerufen …" bzw. „Noch nicht abgerufen".
- Gesperrte Benutzer erhalten für ihren Feed ebenfalls 404.

**Verzögerung.** Kalender-Apps aktualisieren Abos verzögert, Google nach eigenem Takt oft erst nach mehreren Stunden. Ein Tausch ist im Feed zwar sofort enthalten, im Kalender aber erst nach dem nächsten Abruf durch die App. Die App antwortet mit `Cache-Control: private, max-age=300`. Zuverlässig und aktuell ist die Ansicht in BetterShift selbst.

**Verhältnis zu Outlook.** Bekommst du die Einladungen von office@ (siehe [Abschnitt 6](#6-benachrichtigungen-und-outlook)), abonniere den Feed nicht zusätzlich in Outlook, sonst stehen die Dienste doppelt im Kalender. Für Google oder Apple Kalender ist der Feed die richtige Wahl.

**Hinweis für Betreiber:** Der Team-Feed aus [`CALENDAR_FEED.md`](CALENDAR_FEED.md) enthält keine Platzinhaber und bleibt unverändert; der persönliche Feed ist davon unabhängig. Bei `AUTH_ENABLED=false` gibt es keinen persönlichen Feed.

## 8. Betrieb

BetterShift läuft als ein Container; das Image baut GitHub Actions und legt es in der GitHub Container Registry ab. **Images nur für linux/amd64.**

### Compose-Datei

Auf Basis der `docker-compose.yml` des Repositories. Das Image ist das des Forks; die Datei im Repository zeigt noch auf das Upstream-Image.

```yaml
services:
  bettershift:
    image: ghcr.io/flichb/bettershift:latest
    container_name: bettershift
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
      - ./uploads:/app/public/uploads
    environment:
      TZ: "Europe/Vienna"
      DEFAULT_LOCALE: "de"
      BETTER_AUTH_URL: "https://dienste.firma.at"
      BETTER_AUTH_SECRET: "${BETTER_AUTH_SECRET}"
      TRUSTED_PROXY_HEADER: "X-Real-IP"
```

Hinweise zu den Einträgen:

- **Port** 3000 (im Image gesetzt, mit Healthcheck auf `/api/health`). Davor gehört ein Reverse Proxy mit HTTPS.
- **`./data`** enthält die SQLite-Datenbank (`sqlite.db`). Das Verzeichnis muss erhalten bleiben, sonst gehen alle Daten verloren. Der Entrypoint korrigiert die Besitzrechte beim Start selbst.
- **`./uploads`** nimmt hochgeladene Dateien auf.
- **`TZ=Europe/Vienna`**: Ohne diese Angabe läuft der Container in UTC und alle Uhrzeiten wären verschoben. Der Standard in `.env.example` ist `Europe/Berlin`.
- **`DEFAULT_LOCALE=de`**: Sprache, wenn der Browser keine verlangt; zugleich die Sprache der Mails und der Feed-Texte. Standard in `.env.example` ist `en`.
- **`BETTER_AUTH_URL`**: Die öffentliche Adresse, mit Schema und ohne Schrägstrich am Ende. Sie erscheint auch in den Links des persönlichen Feeds und in Tausch-Mails.
- **`BETTER_AUTH_SECRET`**: Pflicht bei eingeschalteter Anmeldung. Erzeugen mit `npx @better-auth/cli secret`, außerhalb der Compose-Datei halten (z. B. in einer `.env` neben der Compose-Datei). Eine Änderung meldet alle Benutzer ab.
- **`TRUSTED_PROXY_HEADER`**: Muss zum Reverse Proxy passen, weil die Ratenbegrenzung die Client-Adresse daraus liest. Den Header des eigenen Proxys eintragen (Caddy, nginx, Traefik: `X-Real-IP`; Cloudflare: `CF-Connecting-IP`; der Wert im Beispiel ist anzupassen). Hinter genau einem Proxy mit unbekanntem Header darf die Variable leer bleiben (dann gilt der letzte Eintrag von `X-Forwarded-For`). **Ohne Proxy** (direkt erreichbar) muss sie `none` sagen, sonst kann der Client seine Adresse frei wählen. Die Erläuterung steht in `.env.example`.
- Weitere Variablen: `.env.example` erklärt alle mit ihren Standardwerten. Die Outlook-Variablen stehen in [`OUTLOOK_SETUP.md`](OUTLOOK_SETUP.md).

Alternativ lässt sich statt `environment:` wie in der Datei des Repositories eine `.env` per `env_file:` einbinden.

### Datensicherung

Gesichert werden muss das Verzeichnis `./data` (die SQLite-Datei). Nimm es ins Server-Backup auf. Damit die Datei konsistent ist, entweder

- den Container kurz anhalten (`docker compose stop`), `./data` kopieren, wieder starten (`docker compose start`), oder
- im laufenden Betrieb auf dem Host mit `sqlite3 data/sqlite.db ".backup 'sicherung.db'"` eine konsistente Kopie ziehen. Das `sqlite3`-Programm ist im Image nicht enthalten, es läuft auf dem Host.

`./uploads` gehört ebenfalls ins Backup, sofern Dateien hochgeladen werden.

### Update

```bash
docker compose pull && docker compose up -d
```

Vorher ein Backup ziehen. **Die Migrationen laufen beim Start des Containers**: Das Image startet mit `node scripts/migrate.mjs && node server.js`. Erst werden die offenen Migrationen der Upstream-Tabellen eingespielt, danach die der Fork-Tabellen (Ordner `drizzle/fork`, eigene Verwaltungstabelle); danach startet der Server. Schlägt eine Migration fehl, startet der Server nicht, und `docker compose logs bettershift` zeigt den Grund. Ein manueller Migrationsschritt ist nicht nötig. Mehr zu Upgrades steht in [`UPGRADING.md`](UPGRADING.md).

Der Container hat nur eine Instanz: Starte nie zwei Container auf dieselbe `./data`.

### Erstinbetriebnahme

1. Container starten und `BETTER_AUTH_URL` im Browser öffnen. Den **ersten Benutzer registrieren: Er wird automatisch Superadmin.**
2. **Teamkalender anlegen** und in den Kalendereinstellungen die **Anmeldungen einschalten**.
3. **Preset „Samstagsdienst"** anlegen: 09:30 bis 15:00 Uhr.
4. **Teilnehmer einladen** bzw. registrieren lassen und den Kalender mit ihnen teilen, mit dem Bündel **„Read"** (siehe [Rechte](#5-rechte)).
5. Unter `/rotations` die **Rotation anlegen** (siehe [Rotation anlegen](#2-rotation-anlegen)): Preset wählen, Teilnehmer in Reihenfolge, 2 pro Dienst, Periode Woche, Diensttag Sa.
6. Zeitraum wählen, „Vorschau" ansehen, dann „Übernehmen".
7. Optional: **Outlook** nach [`OUTLOOK_SETUP.md`](OUTLOOK_SETUP.md) einrichten und den Schalter der Rotation einschalten, zuerst im Trockenlauf.
8. Das Team auf den persönlichen [Kalender-Feed](#7-persönlicher-kalender-feed) und die Tauschbörse hinweisen.

## 9. Grenzen und bekannte Punkte

- **Echter Microsoft-365-Tenant noch nicht getestet.** Die Outlook-Anbindung wurde per Trockenlauf und gegen einen simulierten Graph-Server nachgewiesen. Den Test gegen den echten Tenant erledigst du bei der Einrichtung ([`OUTLOOK_SETUP.md`](OUTLOOK_SETUP.md), Abschnitt „Testen").
- **Nur eine Serverinstanz.** Sync-Worker, Ablauf-Timer und automatischer Abgleich laufen als Zeitgeber im Prozess. Mehrere Replikas würden doppelt arbeiten.
- **Feed-Aktualisierung bei den Clients.** Kalender-Apps holen Abos nach eigenem Takt (Google oft erst nach Stunden). Ein Tausch ist im Feed sofort, im Kalenderprogramm erst später sichtbar.
- **Mails und Feed-Texte nur in `DEFAULT_LOCALE`**, nicht pro Empfänger.
- **Mails mindestens einmal zugestellt.** Bei einem Absturz zwischen Versand und Statuswechsel kann eine Mail ein zweites Mal gehen.
- **Keine Übernahme bestehender Outlook-Termine** von Hand angelegter Dienste.
- **Der persönliche Feed zeigt nur eigene Plätze in Rotationsdiensten** der letzten 60 Tage und der Zukunft, keine älteren Dienste.
- Ohne Anmeldung (`AUTH_ENABLED=false`) gibt es weder Tausch-Mails noch Outlook-Sync noch einen persönlichen Feed.
