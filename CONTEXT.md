# Rotation & Diensttausch

Fork-Erweiterung von BetterShift: Ein Verantwortlicher lässt einen fairen Dienstplan reihum erzeugen; die Teilnehmer tauschen Dienste anschließend selbständig und ohne Freigabe.

## Rotation

**Rotation**:
Die Regel, nach der eine feste, geordnete Gruppe von Teilnehmern reihum auf Dienste in einem Teamkalender verteilt wird.
_Avoid_: Schichtplan, Turnus, Vorlage

**Teilnehmer**:
Ein Benutzer, der mit einer festen Position in einer Rotation steht.
_Avoid_: Mitglied, Mitarbeiter, Member

**Periode**:
Der Zeitabschnitt, in dem dieselbe Besetzung Dienst hat (ein Tag, eine Arbeitswoche ab Montag oder eine feste Anzahl Tage).
_Avoid_: Turnus, Zyklus

**Diensttage**:
Die Wochentage innerhalb einer Periode, an denen tatsächlich ein Dienst stattfindet (z. B. nur Samstag).
_Avoid_: Arbeitstage

**Ausfalltag**:
Ein Diensttag, an dem ausnahmsweise kein Dienst stattfindet; die Reihenfolge rückt dadurch zum nächsten Dienst weiter.
_Avoid_: Feiertag, Ausnahme, Lücke

**Generieren**:
Das Erzeugen der Dienste einer Rotation für einen gewählten Zeitraum; Vergangenes und Gesperrtes bleibt dabei unverändert.
_Avoid_: Planen, Ausrollen

## Dienst

**Dienst**:
Ein einzelner Kalendertag-Eintrag im Teamkalender, den eine Rotation erzeugt hat und der eine feste Zahl an Plätzen hat.
_Avoid_: Schicht (für allgemeine BetterShift-Einträge reserviert), Termin, Bereitschaft

**Platz**:
Die Zuordnung genau eines Teilnehmers zu einem Dienst; ein Dienst hat so viele Plätze wie Personen pro Dienst.
_Avoid_: Slot, Signup, Eintrag

**Gesperrter Platz**:
Ein Platz, der durch einen Tausch entstanden ist und beim Generieren nie überschrieben wird.
_Avoid_: Fixiert, locked Shift

**Doppelbelegung**:
Ein Teilnehmer hätte zur selben Zeit Plätze in zwei Diensten (derselben oder einer anderen Rotation).
_Avoid_: Konflikt, Überschneidung

## Tausch

**Angebot**:
Die Erklärung eines Teilnehmers, einen eigenen künftigen Platz herzugeben – an alle oder gezielt an einen Kollegen.
_Avoid_: Anfrage, Tauschwunsch, Swap

**Abgabe**:
Ein Angebot ohne Gegenleistung: wer annimmt, übernimmt den Platz.
_Avoid_: Verschenken, Übergabe

**Tausch**:
Ein Angebot mit Gegenleistung: der Annehmende gibt einen eigenen künftigen Platz zurück – einen vorher festgelegten oder, bei „beliebig", einen selbst gewählten.
_Avoid_: Wechsel, Swap

**Direktanfrage**:
Ein Angebot, das nur ein bestimmter Teilnehmer annehmen oder ablehnen kann.
_Avoid_: Privatangebot

**Annehmen**:
Das sofort wirksame Ausführen eines offenen Angebots durch einen anderen Teilnehmer, ohne Freigabe.
_Avoid_: Bestätigen, Genehmigen

**Verfallen**:
Ein offenes Angebot endet von selbst, sobald der angebotene Dienst begonnen hat.
_Avoid_: Ablaufen, Timeout
