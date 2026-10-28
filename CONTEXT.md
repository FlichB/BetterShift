# Rotation & Diensttausch

Fork-Erweiterung von BetterShift: Ein Verantwortlicher lässt einen fairen Dienstplan reihum erzeugen; die Teilnehmer tauschen Dienste anschließend selbständig und ohne Freigabe.

## Rotation

**Rotation**:
Die Regel, nach der eine feste, geordnete Gruppe von Teilnehmern reihum auf Dienste in einem Teamkalender verteilt wird.
_Avoid_: Schichtplan, Turnus, Vorlage

**Teilnehmer**:
Ein Benutzer, der mit einer festen Position in einer Rotation steht.
_Avoid_: Mitglied, Mitarbeiter, Member

**Jahresausgleich**:
Schalter pro Rotation (SPEC 12.41). Jedes Kalenderjahr beginnt eine neue Runde; am Jahresanfang setzt aus, wer im Vorjahr mehr Plätze gehalten hat (Ausgleichsphase).

**Delta**:
Gehaltene Plätze eines Teilnehmers im Vorjahr minus die wenigsten gehaltenen Plätze eines Ganzjahres-Teilnehmers. Wird live gerechnet; die Rotations-Verwaltung kann es pro Jahr überschreiben.

**Ganzjahres-Teilnehmer**:
Wer am ersten Diensttag des Vorjahres schon Teilnehmer war. Alle anderen haben Delta 0 und zählen nicht zum Minimum.

**Periode**:
Der Zeitabschnitt, in dem dieselbe Besetzung Dienst hat (ein Tag, eine Arbeitswoche ab Montag oder eine feste Anzahl Tage).
_Avoid_: Turnus, Zyklus

**Diensttage**:
Die Wochentage innerhalb einer Periode, an denen tatsächlich ein Dienst stattfindet (z. B. nur Samstag).
_Avoid_: Arbeitstage

**Schließtag**:
Ein Tag, an dem der Betrieb geschlossen ist: ein Ausfalltag oder ein nicht geöffneter Feiertag. Statt eines Dienstes bzw. an einem Werktag entsteht ein Schließeintrag; an einem Diensttag rückt die Reihenfolge zum nächsten Dienst weiter.
_Avoid_: Ruhetag, Lücke

**Ausfalltag**:
Ein Schließtag aus eigenem Grund, vom Verantwortlichen mit Datum und Grund eingetragen.
_Avoid_: Ausnahme, Lücke

**Feiertagskalender**:
Ein Kalender, aus dem eine Rotation Feiertage liest; jede Schicht darin gilt an ihrem Datum als Feiertag, ihr Titel ist der Name.
_Avoid_: Ferienkalender

**Geöffneter Feiertag**:
Ein Feiertag, an dem trotzdem Dienst ist.

**Schließeintrag**:
Die ganztägige Schicht ohne Plätze, die eine Rotation an einem Schließtag anlegt, z. B. „HeimkinoWelt geschlossen (Mariä Empfängnis)“.
_Avoid_: Ausfallschicht

**Verstärkter Tag**:
Ein Diensttag, an dem ein Dienst mehr Plätze hat als „Personen pro Dienst“; die Zusatzplätze werden reihum besetzt und zählen wie jeder andere Platz.
_Avoid_: Zusatztag, Sondertag

**Zusatzplatz**:
Ein Platz eines verstärkten Tages über „Personen pro Dienst“ hinaus.
_Avoid_: Extraplatz

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

**Eintragsvorlage**:
Der Text je Rotation, aus dem für jeden Platz der angezeigte Titel entsteht, z. B. „{Vorname} Dienst" → „Günther Dienst".
_Avoid_: Titelformat, Muster

## Tausch

**Angebot**:
Die Erklärung, einen eigenen künftigen Platz zu tauschen – an alle oder gezielt an einen Kollegen.
_Avoid_: Anfrage, Tauschwunsch, Swap

**Abgabe** *(historisch)*:
Ein Angebot ohne Gegenleistung. Kann nicht mehr erstellt werden; offene Abgaben sind mit der Umstellung hinfällig geworden.
_Avoid_: Verschenken, Übergabe

**Tausch**:
Ein Angebot mit Gegenleistung: der Annehmende gibt einen eigenen künftigen Platz zurück – einen vorher festgelegten oder, bei „beliebig", einen selbst gewählten.
_Avoid_: Wechsel, Swap

**Direktanfrage**:
Ein Angebot, das nur ein bestimmter Teilnehmer annehmen oder ablehnen kann.
_Avoid_: Privatangebot

**Erzwungener Tausch**:
Ein Tausch, den die Rotations-Verwaltung für einen Ausfallenden anlegt (z. B. bei Krankenstand). Der Platz wechselt ohne Zustimmung des Ausfallenden.
_Avoid_: Zwangstausch, Notabgabe

**Ausfallender**:
Der Teilnehmer, dessen Platz bei einem erzwungenen Tausch übertragen wird.
_Avoid_: Kranker

**Einspringer**:
Wer bei einem erzwungenen Tausch den Platz des Ausfallenden übernimmt.
_Avoid_: Vertretung, Ersatz

**Ausgleich**:
Der Gegendienst, den der Einspringer nach einem erzwungenen Tausch an den Ausfallenden abgibt. Er ist **offen**, **gewählt** oder **erlassen**.
_Avoid_: Gegenleistung, Rückgabe

**Ausgleichsfenster**:
Der Zeitraum, aus dem der Gegendienst stammen muss: ab jetzt bis 3 Monate nach dem Datum des übernommenen Dienstes.
_Avoid_: Frist

**Annehmen**:
Das sofort wirksame Ausführen eines offenen Angebots durch einen anderen Teilnehmer, ohne Freigabe.
_Avoid_: Bestätigen, Genehmigen

**Verfallen**:
Ein offenes Angebot endet von selbst, sobald der angebotene Dienst begonnen hat.
_Avoid_: Ablaufen, Timeout

## Dienstfrei

**Dienstfrei**:
Der freie Arbeitstag, den ein Platz seinem Inhaber mitbringt; er hängt am Platz und wechselt mit ihm den Inhaber.
_Avoid_: Freizeitausgleich, Ruhetag, Zeitausgleich

**Arbeitstag**:
Ein Werktag Mo–Fr, der kein Feiertag, kein Ausfalltag und kein anderes eigenes Dienstfrei ist.
_Avoid_: Diensttag (der ist der Tag des Dienstes)

**Standardtag**:
Der erste Arbeitstag nach dem Dienst, auf dem das Dienstfrei ohne weiteres Zutun liegt.

**Dienstfrei vor dem Dienst**:
Einstellung der Rotation („Dienstfrei liegt: vor dem Dienst“): Der Standardtag liegt in der Dienstwoche vor dem Diensttag, meist am Montag, statt nach dem Dienst.

**Gehaltenes Dienstfrei**:
Bei „vor dem Dienst“ ein Dienstfrei, das nach Tausch, erzwungenem Tausch oder Ausgleich mit Datum und Status beim bisherigen Inhaber bleibt; der neue Inhaber des Platzes bekommt keines.

**Verschieben**:
Das selbständige Verlegen des eigenen Dienstfreis auf einen anderen Arbeitstag derselben Arbeitswoche.
_Avoid_: Umbuchen

**Gesperrtes Dienstfrei**:
Ein Dienstfrei ohne Datum, weil die Rotations-Verwaltung den Tag nicht freigibt; der Inhaber schlägt Termine vor.
_Avoid_: Gesperrter Platz (das ist etwas anderes)

**Vorschlag**:
Ein Termin, den der Inhaber eines gesperrten oder vereinbarten Dienstfreis der Verwaltung anbietet; die Verwaltung nimmt an, lehnt ab oder macht einen Gegenvorschlag.
_Avoid_: Angebot (reserviert für den Tausch), Antrag

**Vereinbartes Dienstfrei**:
Ein Dienstfrei, dessen Termin die Verwaltung angenommen hat; der Inhaber kann es nicht mehr selbst verschieben, nur eine Änderung beantragen.

**Entfallenes Dienstfrei**:
Ein Dienstfrei, dessen Dienst weggefallen ist, z. B. weil der Diensttag zum Schließtag wurde.

## Mindestbesetzung

**Mindestbesetzung**:
Wie viele Teilnehmer einer Rotation an einem Werktag (Mo–Fr, kein Schließtag) mindestens anwesend sein müssen.
_Avoid_: Mindestanzahl, Kapazität (die gehört zum Dienst)

**Abwesend**:
Ein Teilnehmer an einem Tag mit genehmigtem Urlaub oder einem Dienstfrei mit Datum, aus welcher Rotation auch immer.
_Avoid_: Frei (zu ungenau)

**Voller Tag**:
Ein Werktag, an dem in einer Rotation der Person die Mindestbesetzung fehlen würde, wenn sie selbst auch noch fehlte; Mitarbeiter können dort kein Dienstfrei hinlegen.
_Avoid_: Ausgebucht
