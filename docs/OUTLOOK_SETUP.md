# Outlook-Anbindung einrichten (Microsoft 365)

Diese Anleitung beschreibt, wie BetterShift an Microsoft 365 angebunden wird: Dienste von Rotationen erscheinen als Termine im Kalender von office@, und Tausch-Aktionen versenden Benachrichtigungs-Mails.

## Inhalt

1. [Überblick](#überblick)
2. [App-Registrierung (Entra Admin Center)](#app-registrierung-entra-admin-center)
3. [Berechtigungen](#berechtigungen)
4. [Auf office@ beschränken (wichtig)](#auf-office-beschränken-wichtig)
5. [Konfiguration](#konfiguration)
6. [Testen](#testen)
7. [Fehlerbilder](#fehlerbilder)
8. [Grenzen](#grenzen)

---

## Überblick

Die Bedienung von Rotationen, Tauschbörse und persönlichem Kalender-Feed sowie den Betrieb beschreibt [`ROTATION_AND_SWAPS.md`](ROTATION_AND_SWAPS.md).

- **office@ ist der Organisator.** Die App legt Termine im Kalender dieses Postfachs an, ändert sie und sagt sie ab. Pro Platz gibt es einen ganztägigen Termin (Status „Frei"); eingeladen ist nur der aktuelle Platzinhaber. Bei Tausch oder Umbesetzung wird der Termin des bisherigen Inhabers abgesagt und der neue Inhaber eingeladen. Nach dem Update auf diese Version sagt der erste Abgleich alle künftigen Termine im alten Format (ein Termin pro Dienst) ab und lädt pro Platz neu ein — jeder Teilnehmer bekommt einmalig eine Absage und eine neue Einladung.
- **Exchange verschickt den Rest**: Einladungen, Aktualisierungen und Absagen kommen von Exchange selbst, die App sendet sie nicht.
- **Tausch-Mails** (neues Angebot, Direktanfrage, angenommen, abgelehnt) werden über Graph `sendMail` von office@ verschickt. Jeder Benutzer kann die Arten auf `/swaps` einzeln abschalten.
- Benötigt wird **eine** Entra-App mit Anwendungsberechtigungen (kein Benutzer-Login, kein Redirect).
- Ohne Konfiguration bleibt alles aus; die App verhält sich wie ohne Phase 3. Pro Rotation gibt es zusätzlich den Schalter „In Outlook (office@) eintragen".
- Bei `AUTH_ENABLED=false` sind Sync und Mails immer aus.

## App-Registrierung (Entra Admin Center)

1. *Identität › Anwendungen › App-Registrierungen › Neue Registrierung*.
2. Name `BetterShift`, Kontotyp **Nur dieses Organisationsverzeichnis** (Single Tenant), **keine** Umleitungs-URI.
3. Auf der Übersichtsseite notieren:
   - *Verzeichnis-ID (Mandant)* → `OUTLOOK_TENANT_ID`
   - *Anwendungs-ID (Client)* → `OUTLOOK_CLIENT_ID`
4. *Zertifikate & Geheimnisse › Neuer geheimer Clientschlüssel* → den **Wert** (nicht die ID) sofort kopieren → `OUTLOOK_CLIENT_SECRET`.
5. **Ablaufdatum des Geheimnisses notieren und eine Kalendererinnerung davor setzen.** Ein abgelaufenes Geheimnis zeigt sich als `outlook.auth_failed` im Audit-Log (siehe [Fehlerbilder](#fehlerbilder)).

## Berechtigungen

*API-Berechtigungen › Berechtigung hinzufügen › Microsoft Graph › Anwendungsberechtigungen*:

| Berechtigung | Wofür |
| --- | --- |
| `Calendars.ReadWrite` | Termine in office@ anlegen, ändern, absagen, nächtlich vergleichen |
| `Mail.Send` | Benachrichtigungs-Mails von office@ |

Anschließend **Administratorzustimmung erteilen**.

## Auf office@ beschränken (wichtig)

Anwendungsberechtigungen gelten standardmäßig für **jedes** Postfach im Mandanten. Ohne Einschränkung könnte die App (und jeder, der das Client-Secret kennt) alle Kalender lesen und in fremdem Namen Mails senden. Deshalb auf office@ begrenzen, mit Exchange Online RBAC for Applications (PowerShell, nach `Connect-ExchangeOnline`):

```powershell
New-ServicePrincipal -AppId <OUTLOOK_CLIENT_ID> -ObjectId <Objekt-ID der Unternehmensanwendung> -DisplayName "BetterShift"
New-ManagementScope -Name "BetterShift office" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'office@firma.at'"
New-ManagementRoleAssignment -App <OUTLOOK_CLIENT_ID> -Role "Application Calendars.ReadWrite" -CustomResourceScope "BetterShift office"
New-ManagementRoleAssignment -App <OUTLOOK_CLIENT_ID> -Role "Application Mail.Send" -CustomResourceScope "BetterShift office"
Test-ServicePrincipalAuthorization -Identity <OUTLOOK_CLIENT_ID> -Resource office@firma.at
```

Die *Objekt-ID der Unternehmensanwendung* steht unter *Identität › Anwendungen › Unternehmensanwendungen › BetterShift* (nicht die Objekt-ID der App-Registrierung). `Test-ServicePrincipalAuthorization` sollte für office@ `InScope = True` melden und für ein anderes Postfach `False`.

**Danach die mandantenweiten Graph-Anwendungsberechtigungen aus dem vorigen Abschnitt wieder entfernen.** Die RBAC-Zuweisung erteilt die Rechte bereits eingeschränkt; solange die mandantenweite Zustimmung besteht, gilt sie weiterhin für alle Postfächer.

**Wartezeit:** RBAC-Zuweisungen in Exchange brauchen oft bis zu etwa 30 Minuten, bis sie wirken. Ein früher `outlook.auth_failed` direkt nach der Einrichtung ist daher normal; der Sync versucht es nach der Pause von selbst erneut.

Hintergrund: Microsoft-Artikel „Role Based Access Control for Applications in Exchange Online" (learn.microsoft.com).

## Konfiguration

Die Variablen stehen mit Erklärung in `.env.example` (Abschnitt „[fork] Outlook / Microsoft 365"):

| Variable | Bedeutung |
| --- | --- |
| `OUTLOOK_TENANT_ID` | Verzeichnis-ID (Mandant) |
| `OUTLOOK_CLIENT_ID` | Anwendungs-ID (Client) |
| `OUTLOOK_CLIENT_SECRET` | Wert des Clientschlüssels |
| `OUTLOOK_ORGANIZER` | Postfach des Organisators, z. B. `office@firma.at` |
| `OUTLOOK_SYNC_INTERVAL_SECONDS` | Scan-Intervall, Standard 60, Minimum 15 |
| `OUTLOOK_DRY_RUN` | `true` = Graph-Aufrufe nur loggen; braucht nur `OUTLOOK_ORGANIZER` |

Die ersten vier sind Pflicht; fehlt eine, bleibt der Sync aus. `docker-compose`:

```yaml
services:
  bettershift:
    environment:
      OUTLOOK_TENANT_ID: "00000000-0000-0000-0000-000000000000"
      OUTLOOK_CLIENT_ID: "00000000-0000-0000-0000-000000000000"
      OUTLOOK_CLIENT_SECRET: "${OUTLOOK_CLIENT_SECRET}"
      OUTLOOK_ORGANIZER: "office@firma.at"
```

Das Secret besser in einer `.env`-Datei neben der Compose-Datei oder als Docker-Secret halten, nicht im Klartext einchecken. Danach den Container neu starten (`docker compose up -d`).

Die Anmelde-E-Mail eines Benutzers muss seine Microsoft-365-Adresse sein; sie wird als Teilnehmer- und Empfängeradresse verwendet.

## Testen

1. **Trockenlauf**: `OUTLOOK_ORGANIZER=office@example.test`, `OUTLOOK_DRY_RUN=true`, `OUTLOOK_SYNC_INTERVAL_SECONDS=15` setzen. Beim Einschalten des Schalters einer Rotation erscheint im Server-Log je künftigem Dienst eine Zeile `[Outlook dry-run] create …` mit den Teilnehmern; Tausch-Aktionen erzeugen `update` bzw. `mail "…"`, Ausschalten `cancel`.
2. **Echt**: Dry-Run abschalten und die vier Pflichtvariablen setzen. Den Schalter für **eine** Rotation aktivieren und prüfen:
   - Im office@-Kalender steht pro künftigem Dienst ein Termin.
   - Ein Teilnehmer hat die Einladung im Posteingang.
   - Einen Dienst abgeben und übernehmen lassen: Das Update (neuer Teilnehmer, Absage an den alten) kommt innerhalb etwa einer Minute.
   - Ein Angebot erzeugt eine Mail von office@ an die richtigen Empfänger.
   - Eine Rotation ausschalten, deren Dienste noch **keinen Teilnehmer** haben (Absage eines Termins ohne Teilnehmer): Der Termin muss aus dem Kalender verschwinden. Graph lehnt die Absage dafür mit 400 ab; die App löscht ihn dann stattdessen.
3. Erst danach weitere Rotationen aktivieren.

## Fehlerbilder

| Symptom | Ursache und Abhilfe |
| --- | --- |
| Audit-Log `outlook.auth_failed`, Sync pausiert 15 Minuten | Graph antwortet mit 401/403: Clientschlüssel abgelaufen oder falsch, Administratorzustimmung fehlt oder der RBAC-Bereich passt nicht zu `OUTLOOK_ORGANIZER`. Ursache beheben; nach der Pause läuft der Sync von selbst weiter. Keine Änderung geht verloren. |
| Statuszeile der Rotation meldet Fehler bei einzelnen Diensten | Einzelfehler pro Termin; die App versucht es mit wachsendem Abstand (1, 5, 15, 60 Minuten, danach stündlich) erneut. Der Text der Statuszeile nennt die Graph-Meldung. |
| `ErrorInvalidRecipients` oder unbekannte Adresse | Die Anmelde-E-Mail des Teilnehmers ist keine Microsoft-365-Adresse. Adresse des Benutzers korrigieren. |
| Termin in office@ wurde von Hand geändert oder gelöscht | Der nächtliche Vollabgleich (täglich um 03:00 Serverzeit) stellt den Sollzustand wieder her (Änderungen an Zeit, Betreff, Teilnehmern; gelöschte Termine werden neu angelegt). |
| Nichts passiert | Prüfen, dass alle vier Pflichtvariablen gesetzt sind (oder `OUTLOOK_DRY_RUN` mit `OUTLOOK_ORGANIZER`), `AUTH_ENABLED` nicht `false` ist und der Schalter der Rotation an ist. Ohne Konfiguration zeigt die Rotationsseite den Schalter deaktiviert mit „nicht eingerichtet". |

## Grenzen

- **Eine Serverinstanz.** Der Sync-Worker läuft im Prozess; mehrere Replikas würden doppelt synchronisieren.
- **Mails werden mindestens einmal zugestellt.** Stürzt der Server zwischen dem Versand und dem Speichern des Status ab, kann eine Mail ein zweites Mal gesendet werden.
- Mails werden in der Sprache `DEFAULT_LOCALE` verschickt, nicht pro Empfänger.
- **Keine Übernahme bestehender Termine**: Termine, die schon von Hand in office@ stehen, werden weder erkannt noch verknüpft. Die Rotation sollte in einem Zeitraum ohne manuelle Dienst-Termine starten.
- Vergangene und bereits begonnene Dienste werden nie angefasst.
