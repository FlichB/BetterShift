# 0001 – Ein Dienst ist eine BetterShift-Schicht, Plätze sind Signups

- Status: angenommen
- Datum: 2026-10-21

## Kontext

BetterShift ordnet Schichten nur einem Kalender zu, nicht einer Person. Für mehrere Personen pro Schicht existiert bereits `shift_signups` (N Benutzer pro Schicht, Kapazität, Rechteprüfung). Die Rotation braucht zwei Personen pro Dienst, und der Tausch muss einzelne Personen bewegen können.

## Entscheidung

- Ein Dienst ist **eine** normale Schicht im Teamkalender pro Diensttag (keine mehrtägigen Schichten, auch bei Periode = Woche).
- Jeder Platz ist **ein** Eintrag in `shift_signups`; Kapazität = Personen pro Dienst.
- Ein Tausch verschiebt Signups zwischen Benutzern; die Sperre („Gesperrter Platz") hängt am Platz, nicht an der Schicht.
- Rotations- und Tausch-Metadaten liegen in eigenen Tabellen und referenzieren Schicht bzw. Signup; Upstream-Tabellen werden höchstens minimal erweitert.

## Verworfene Alternativen

- **Eine Schicht pro Person und Tag** – verdoppelt Einträge, Kalender zeigt das Paar nicht als Einheit, Tausch müsste Schichten zwischen Personen „umhängen", obwohl Schichten keinen Besitzer haben.
- **Mehrtägige Wochen-Schicht** – BetterShift kennt keine mehrtägigen Schichten; Einzeltage wären nicht tauschbar.
- **Sperre an der Schicht** – würde beim Neugenerieren auch den nicht getauschten Platz der Kollegin einfrieren.

## Folgen

- Kalenderansicht, ICS-Feed und Statistik funktionieren ohne Änderung.
- Teilnehmer erhalten nur das Bündel „Read", damit Plätze ausschließlich über die Tauschlogik (mit Audit-Log) wechseln.
- Hinweis (2026-10-21): Das mitgelieferte Bündel „Read" enthält `signUpSelf` („Sich selbst eintragen"). Teilnehmer sollten daher, bis Phase 2 einen Guard ergänzt, ein Bündel ohne diese Berechtigung erhalten. Entschieden (2026-10-22): Phase 2 sperrt Selbst-Ein-/Austragen bei Plätzen generierter Dienste im Code.
- Der vorhandene ICS-Feed enthält alle Dienste des Teamkalenders; ein persönlicher Feed ist eine separate Erweiterung.
