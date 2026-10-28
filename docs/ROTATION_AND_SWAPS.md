# Rotationen, Tauschbörse und persönlicher Kalender-Feed

Diese Anleitung beschreibt die Fork-Erweiterungen von BetterShift: Dienste reihum erzeugen lassen (Rotation), Dienste selbständig tauschen (Tauschbörse), die eigenen Dienste als Kalender-Abo beziehen und den Betrieb der App. Die Outlook-Anbindung steht separat in [`OUTLOOK_SETUP.md`](OUTLOOK_SETUP.md).

## Inhalt

1. [Überblick und Begriffe](#1-überblick-und-begriffe)
2. [Rotation anlegen](#2-rotation-anlegen)
3. [Generieren](#3-generieren)
4. [Tauschbörse](#4-tauschbörse)
   - [Dienstfrei](#4a-dienstfrei)
   - [Urlaub](#4b-urlaub)
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
| **Schließtag** | Ein Diensttag, an dem der Betrieb geschlossen ist: ein Ausfalltag oder ein nicht geöffneter Feiertag. Die Reihenfolge rückt zum nächsten Dienst weiter. |
| **Ausfalltag** | Ein Schließtag aus eigenem Grund, mit Datum und Grund eingetragen. |
| **Feiertagskalender** | Ein Kalender, aus dem eine Rotation Feiertage liest; jeder Eintrag darin gilt an seinem Datum als Feiertag. |
| **Schließeintrag** | Die ganztägige Schicht ohne Plätze, die eine Rotation an einem Schließtag anlegt. |
| **Dienstfrei** | Der freie Arbeitstag, den ein Platz seinem Inhaber mitbringt; er wechselt mit dem Platz den Inhaber (siehe [Dienstfrei](#4a-dienstfrei)). |
| **Dienst** | Ein einzelner Kalendertag-Eintrag im Teamkalender, den eine Rotation erzeugt hat und der eine feste Zahl an Plätzen hat. |
| **Platz** | Die Zuordnung genau eines Teilnehmers zu einem Dienst. |
| **Gesperrter Platz** | Ein Platz, der durch einen Tausch entstanden ist. Neues Generieren überschreibt ihn nie. |
| **Doppelbelegung** | Ein Teilnehmer hätte zur selben Zeit Plätze in zwei Diensten. Das wird verhindert. |
| **Angebot** | Die Erklärung, einen eigenen künftigen Platz zu tauschen, an alle oder gezielt an einen Kollegen. |
| **Abgabe** | (nicht mehr möglich) Ein Angebot ohne Gegenleistung. Offene Abgaben wurden mit der Umstellung hinfällig. |
| **Tausch** | Ein Angebot mit Gegenleistung: Der Annehmende gibt einen eigenen künftigen Platz zurück. |
| **Direktanfrage** | Ein Angebot, das nur eine bestimmte Person annehmen oder ablehnen kann. |
| **Erzwungener Tausch** | Ein Tausch, den die Rotations-Verwaltung für einen Ausfallenden anlegt. Der Platz wechselt ohne Zustimmung des Ausfallenden. |
| **Einspringer** | Wer bei einem erzwungenen Tausch den Platz des Ausfallenden übernimmt. |
| **Ausgleich** | Der Gegendienst, den der Einspringer nach einem erzwungenen Tausch an den Ausfallenden abgibt. Er ist offen, gewählt oder erlassen. |
| **Ausgleichsfenster** | Der Zeitraum, aus dem der Gegendienst stammen muss: ab jetzt bis 3 Monate nach dem Datum des übernommenen Dienstes. |

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
| Eintragsvorlage | Der Titel, den jeder Platz im Kalender trägt. Platzhalter: `{Vorname}`, `{Name}` (ganzer Name) und `{Dienst}` (Titel des Presets). Standard ist `{Vorname} Dienst`, also z. B. „Günther Dienst". `{Vorname}` oder `{Name}` muss vorkommen. Das ⓘ neben dem Feld erklärt die Platzhalter mit einem Beispiel; unter dem Feld zeigt eine Vorschau den Titel für den ersten Teilnehmer. Die Platzhalter unterscheiden Groß- und Kleinschreibung, jedes andere `{…}` wird abgelehnt. Freie Plätze heißen „Offener Platz". |
| Periode | „Tag", „Woche (ab Montag)" oder „Eigene Dauer" (dann „Länge in Tagen", 1 bis 365). |
| Beginn | Erster Tag der ersten Periode. |
| Beginnt mit | Welcher Teilnehmer in der ersten Periode Dienst hat. „Vorschlag übernehmen" setzt einen passenden Wert. |
| Diensttage | Wochentage Mo bis So, an denen in einer Periode tatsächlich Dienst ist („Alle Tage" setzt alle). |
| Ausfalltage | Einzelne Tage ohne Dienst, jeweils mit Grund. Mit „Ausfalltag hinzufügen“ ergänzen. Ein Ausfalltag darf auch auf einen Werktag ohne Dienst fallen und erscheint dort ebenfalls als Schließeintrag (Teamkalender, Outlook); die Rundennummerierung zählt weiter nur Diensttage. |
| Verstärkte Tage | Einzelne Daten, an denen mehr Personen Dienst haben als „Personen pro Dienst“ (höchstens so viele wie Teilnehmer). Mit „Verstärkten Tag hinzufügen“ ergänzen. |
| Text bei Schließung | Erscheint an Schließtagen als „Text (Grund)“, z. B. „HeimkinoWelt geschlossen (Inventur)“. |
| Feiertagskalender | Optional. Jeder Eintrag dieses Kalenders an einem Diensttag schließt den Tag. |
| Dienstfrei zum Dienst / Text für Dienstfrei / Dienstfrei je Teilnehmer | Schaltet das Dienstfrei ein, legt die Vorlage des Kalendereintrags fest und nimmt einzelne Teilnehmer aus (siehe [Dienstfrei](#4a-dienstfrei)). |
| Teilnehmer (Reihenfolge) | Die Reihenfolge bestimmt die erste Runde; danach mischt der Generator die Paare selbst. Mit „Nach oben" / „Nach unten" sortieren, mit „Teilnehmer hinzufügen" ergänzen, mit „Entfernen" streichen. |

Beispiel „Samstagsdienst": Periode „Woche (ab Montag)", Diensttag Sa, 2 Personen pro Dienst, 8 Teilnehmer. Jede Person hat dann einmal pro 4 Wochen Dienst. Die erste Runde folgt der Reihenfolge, danach werden die Paare neu gemischt: Niemand hat zwei Samstage hintereinander Dienst, niemand hat zweimal hintereinander denselben Partner, und pro Quartal weicht die Anzahl der Dienste höchstens um 1 ab. Bei wenigen Teilnehmern (z. B. 6) liegt dafür manchmal nur ein freier Samstag zwischen zwei Diensten. Mit „Speichern" wird die Rotation gesichert; erzeugt sind die Dienste damit noch nicht.

Mit dem Feld „Neustart ab Datum" ersetzt du bei einem Teilnehmerwechsel die Reihenfolge ab einem Stichtag: Dienste davor bleiben unverändert (siehe [Generieren](#3-generieren)).

### Verstärkte Tage

An einem **verstärkten Tag** hat ein Dienst mehr Personen als sonst, z. B. 3 statt 2 vor Weihnachten. Trage das Datum und die Personenzahl bei „Verstärkte Tage“ ein und generiere neu. Die Zusatzplätze werden reihum besetzt und zählen wie jeder andere Platz; niemand sitzt zweimal im selben Dienst. Dafür dürfen „nie zwei Diensttage in Folge“ und „nie derselbe Partner hintereinander“ rund um einen verstärkten Tag brechen. Die Vorschau zeigt am Datum „{count} Personen“. Jede zusätzliche Person bekommt wie jeder Platz ihren eigenen Eintrag (und bei eingeschaltetem Outlook-Schalter ihren eigenen Termin).

Ein verstärkter Tag verschiebt die späteren, noch nicht getauschten Plätze, genauso wie ein Ausfalltag. Getauschte Plätze bleiben bestehen; sind es mehr als die neue Personenzahl, warnt die Vorschau. Vergangene Einträge bleiben gespeichert und ändern nichts. Fällt das Datum auf einen Schließtag, gilt der Schließtag. Zum Rückgängigmachen entfernst du den Eintrag und generierst den Zeitraum erneut.

### Feiertage und Schließtage

An einem **Schließtag** legt die Rotation statt des Dienstes einen ganztägigen Eintrag ohne Plätze an: „<Text bei Schließung> (<Grund>)“. Er erscheint im Teamkalender und – bei eingeschaltetem Outlook-Schalter – als ganztägiger Termin bei office@, ohne Einladungen. Auf der Tauschbörse und im persönlichen Feed taucht er nicht auf. Die Reihenfolge rückt zum nächsten Diensttag weiter.

**Feiertage einrichten (Österreich):**

1. Neuen Kalender „Feiertage AT“ anlegen. Anmeldungen braucht er nicht, und teilen musst du ihn mit niemandem: Die Rotation liest ihn auf dem Server, das Team sieht die Schließtage im Teamkalender.
2. Die Einstellungen dieses Kalenders öffnen, dort „Import & Export“, Reiter „Importieren“, dann „Adresse abonnieren“. Bei „Adresse der ICS-Datei“ `webcal://www.wien.gv.at/spezial/daten/ics/feiertage.ics` eintragen, „Automatisch abrufen“ einschalten und mit „Abo hinzufügen“ speichern. Der Feed enthält alle 13 gesetzlichen Feiertage mit Namen, derzeit bis 2035.
3. Einmal „Jetzt abrufen“ klicken. Danach stehen die Feiertage als ganztägige Einträge im Kalender.
4. In der Rotation diesen Kalender als „Feiertagskalender“ wählen, den „Text bei Schließung“ eintragen (z. B. „HeimkinoWelt geschlossen“) und speichern. In der „Vorschau“ erscheinen Feiertage an Diensttagen dann als Schließtag.

Fällt ein Feiertag auf einen Diensttag, steht in der Vorschau „<Text bei Schließung> (Name des Feiertags)“, z. B. „HeimkinoWelt geschlossen (Mariä Empfängnis)“. Mit „Trotzdem Dienst“ wird an diesem einen Datum normal geplant (z. B. am 8. Dezember); „Doch schließen“ macht das rückgängig. Feiertage an anderen Wochentagen haben keine Wirkung.

Der 24. und 31. Dezember sind keine gesetzlichen Feiertage und fehlen im Feed. Wenn du dort schließt, trage sie als Ausfalltag mit Grund ein. Ein Ausfalltag hat Vorrang vor einem Feiertag am selben Tag.

Der Feiertagskalender enthält nur, was die Synchronisierung gerade vorhält: etwa 3 Monate zurück bis 1 Jahr nach dem letzten Sync. Generierst du weit in die Zukunft, synchronisiere den Kalender vorher, bevor du auf „Übernehmen“ klickst; sonst fehlen späte Feiertage, und diese Tage werden als normale Dienste geplant.

Vergangene Schließtage zählen weiter, auch wenn ihr Feiertag später aus dem Feiertagskalender verschwindet (weil die Synchronisierung alte Termine entfernt, du ihn von Hand löschst oder den Feiertagskalender abwählst). Die künftige Besetzung verschiebt sich dadurch nicht. Für künftige Tage entscheidet weiter der Kalender. Löschst du dagegen einen vergangenen Schließeintrag von Hand im Teamkalender, zählt dieser Tag nur noch als Schließtag, solange er als Ausfalltag eingetragen ist oder im Feiertagskalender steht; sonst kann sich die künftige Besetzung beim nächsten „Übernehmen“ verschieben.

### Gerecht pro Kalenderjahr (Jahresausgleich)

Mit dem Schalter „Gerecht pro Kalenderjahr“ beginnt mit dem ersten Diensttag jedes Kalenderjahres eine neue Runde. Wer im Vorjahr mehr Plätze gehalten hat, setzt am Jahresanfang entsprechend früh aus: Der Ausgleich verteilt sich auf die ersten Runden des Jahres, es gibt keinen geschlossenen Block. „Nie zwei Diensttage in Folge“ und „nie derselbe Partner hintereinander“ gelten auch über den Jahreswechsel. Ziel ist, dass die Dienste der Ganzjahres-Teilnehmer pro Kalenderjahr, mit dem Delta verrechnet, höchstens um 1 abweichen.

**Bestehende Rotationen** haben den Schalter aus und verhalten sich wie bisher; bei neuen Rotationen ist er vorgeschlagen. Schaltest du ihn bei einer laufenden Rotation ein, verteilt das nächste Generieren alle nicht gesperrten künftigen Plätze neu. Gesperrte Plätze (z. B. nach einem Tausch) bleiben bestehen.

**So wird das Delta gezählt:** Das Delta eines Teilnehmers sind die Plätze, die er im Vorjahr gehalten hat, minus die wenigsten Plätze eines Ganzjahres-Teilnehmers.

- Es zählt der aktuelle Inhaber eines Platzes, also nach Tausch, erzwungenem Tausch und Ausgleich.
- Zusatzplätze an verstärkten Tagen zählen mit, ebenso Feiertage, an denen trotzdem Dienst geöffnet wurde („Trotzdem Dienst“). Schließtage zählen nicht.
- **Ganzjahres-Teilnehmer** ist, wer am ersten Diensttag des Vorjahres (bei einer jüngeren Rotation: am ersten Diensttag der Rotation) schon Teilnehmer war. Alle anderen haben Delta 0 und zählen nicht zum Minimum; in der Tabelle steht bei ihnen „neu seit <Datum>“.

**Bedienung im Formular:** Unter dem Schalter zeigt die Delta-Tabelle den Übertrag vom Vorjahr ins laufende und vom laufenden ins nächste Jahr. Die Werte sind so gerechnet, als wäre der Schalter eingeschaltet. Um die Tabelle zu sehen, schaltest du den Schalter im Formular ein; gespeichert wird der Schalter erst mit „Speichern“. Die Zeile „laufendes → nächstes Jahr“ ist vorläufig: Noch nicht begonnene, nicht gesperrte Tage des laufenden Jahres zählen so, wie sie gerade geplant sind. Bei jedem Teilnehmer kannst du das Delta mit „Eigener Wert“ (ganze Zahl 0–52) überschreiben; „Automatischen Wert verwenden“ nimmt den Override zurück. Ein Override bleibt fix und gilt ab dem nächsten Generieren. Während des Jahres wird nichts nachgezogen: Ein Tausch oder ein erzwungener Tausch (z. B. bei Krankenstand) im laufenden Jahr verschiebt die Plätze nicht neu, sie wirken erst über das Delta im Folgejahr. Mitarbeiter sehen das Delta nicht.

## 3. Generieren

Im Abschnitt „Dienste erzeugen" einer Rotation wählst du „Von" und „Bis" (höchstens 366 Tage; „{n} Wochen" sind Schnellwahlen).

1. **„Vorschau"** zeigt, was passieren würde, ohne etwas zu ändern. Die Tabelle nennt pro Datum die Besetzung und die Änderung: „Neu", „Geändert", „Unverändert" oder „Entfällt". „Zeit/Titel aus Preset" weist auf Dienste hin, deren Zeit oder Titel noch nicht zum Preset passt. Bei Plätzen, die neu besetzt werden, steht, wie viele es sind. Unter „Hinweise" stehen Warnungen.
2. **„Übernehmen"** führt die Vorschau aus. Das Ergebnis wird als „{created} neu, {updated} geändert, {deleted} entfernt" gemeldet; ist nichts zu tun, steht dort „Alles ist bereits auf dem Stand."

Gut zu wissen:

- **Idempotent.** Erneutes Generieren desselben Zeitraums erzeugt keine Duplikate und ändert nur, was von der Vorgabe abweicht.
- **Vergangenes bleibt.** Bereits begonnene und vergangene Dienste werden nie angefasst, auch wenn der Zeitraum in der Vergangenheit beginnt. Ihre Plätze und Sperren bleiben unverändert.
- **Getauschte Plätze sind gesperrt** und stehen in der Vorschau als „Getauscht (gesperrt)". Beim Neugenerieren bleiben sie erhalten. Ist der Inhaber eines gesperrten Platzes kein Teilnehmer mehr, erscheint unter „Hinweise" der Knopf „Sperre aufheben": Er gibt den Platz für die Rotation frei, und er wird beim nächsten Übernehmen nach der Rotationsregel besetzt.
- **Hinweise:** „{user} ist kein Teilnehmer mehr, hat aber einen getauschten Platz" bzw. „Kein Dienst mehr geplant, aber getauschte Plätze vorhanden – der Dienst bleibt bestehen". Beim ersten Hinweis kannst du die Sperre mit „Sperre aufheben" lösen; beim zweiten bleibt der Dienst samt getauschten Plätzen bestehen.
- **Ausfalltag aus der Vorschau.** „Fällt aus“ fragt nach dem Grund und trägt den Tag als Ausfalltag ein; die folgenden Besetzungen rücken nach.
- **Teilnehmerwechsel:** Rotation bearbeiten, „Neustart ab Datum" setzen, speichern, ab diesem Datum neu generieren. Dienste vorher bleiben, wie sie waren.
- **Löschen:** „Rotation löschen" fragt, ob die zukünftigen Dienste ebenfalls entfernt werden sollen („Zukünftige Dienste dieser Rotation ebenfalls löschen"). Vergangene Dienste bleiben als normale Schichten im Kalender stehen.

## 4. Tauschbörse

Unter `/swaps` sieht jeder Teilnehmer zwei Reiter: „Für mich" (offene Angebote, die er annehmen kann) und „Meine Angebote" (die eigenen der letzten 30 Tage). Oben wählst du den Kalender.

**Dienst anbieten.** Mit „Dienst anbieten" (oder dem Knopf „Tauschen" im Dienst eines Kalenders) öffnet sich das Formular:

| Feld | Auswahl |
| --- | --- |
| Dein Dienst | Einer deiner künftigen Dienste in diesem Kalender. |
| An wen? | „An alle" oder „An eine Person" (Direktanfrage, dann „Kollege"). |
| Gewünschter Gegendienst | Ein konkreter Dienst des Kollegen oder „Beliebig – der andere wählt". |
| Notiz | Freitext, z. B. Grund oder Wunsch. |

Mit „Anbieten" wird das Angebot erstellt. Jedes Angebot ist ein Tausch; ein Abgeben ohne Gegenleistung gibt es nicht mehr. Es gibt drei Fälle:

- **Tausch gegen einen konkreten Dienst** (im Angebot steht „Tausch gegen" mit dem Datum des Gegendienstes): „Tauschen" anklicken und bestätigen. Beide Plätze wechseln in einem Schritt.
- **Tausch gegen beliebigen Dienst:** Der Annehmende wählt unter „Welchen deiner Dienste gibst du dafür ab?" einen eigenen künftigen Dienst.
- **Direktanfrage** (im Angebot steht „an" mit dem Namen der Person): Nur diese Person kann annehmen oder „Ablehnen".

Weitere Aktionen:

- **„Zurückziehen"**: Der Anbieter nimmt sein offenes Angebot zurück.
- **„Ablehnen"**: Nur bei Direktanfragen, nur durch die angefragte Person.
- **„Ausblenden"** / „Wieder einblenden": Blendet ein Angebot an alle für dich aus der Liste aus. Das geht nur, solange das Angebot offen ist. „Ausgeblendete zeigen" blendet die ausgeblendeten Angebote wieder ein.

Die Status eines Angebots: „Offen", „Angenommen", „Abgelehnt", „Zurückgezogen", „Verfallen", „Hinfällig".

### Erzwungener Tausch (Krankenstand)

Fällt jemand kurzfristig aus, z. B. durch Krankenstand, kann die Rotations-Verwaltung (Besitzer, „Kalendereinstellungen verwalten" oder Administrator, siehe [Rechte](#5-rechte)) einen **erzwungenen Tausch** anlegen. Der Ausfallende braucht dafür kein Tauschrecht und muss nicht zustimmen.

1. Im Dienst steht neben jedem Platzinhaber der Knopf „Tausch erzwingen: {Name}". Er öffnet das Fenster „Tausch erzwingen".
2. Dort stehen „Ausfallend" (mit dem Platzinhaber vorbelegt), „Einspringer" und „Notiz" (z. B. „Krankenstand"). Beim Einspringer wählst du „Bestimmte Person" oder „Offen an alle".
3. Mit „Erzwingen" und der Bestätigung wird der Tausch angelegt.

Was dann passiert:

- **Bestimmte Person:** Der Platz wechselt sofort an den Einspringer.
- **Offen an alle:** Der Dienst erscheint bei allen unter „Für mich" als Karte „Einspringen für {Name}". Wer „Einspringen" anklickt und bestätigt, bekommt den Platz sofort. Ablehnen oder Ausblenden geht bei einem erzwungenen Tausch nicht.
- **Ausgleich:** Der Platz wechselt unabhängig vom Gegendienst. Danach ist der Ausgleich offen („Ausgleich offen"). Der Einspringer sieht unter „Für mich" eine Karte mit dem Knopf „Gegendienst wählen" und wählt frei einen eigenen Dienst im selben Kalender. Dieser Dienst geht sofort an den Ausfallenden, der ihn nicht ablehnen kann. Der Dienst muss im **Ausgleichsfenster** liegen: bis 3 Monate nach dem Datum des übernommenen Dienstes. Der Ausgleich hat keine Frist.
- **Reiter „Verwaltung":** Er ist nur sichtbar, wenn du in mindestens einem Kalender Rotationen verwaltest, und zeigt die offenen erzwungenen Tausche und die offenen Ausgleiche des gewählten Kalenders. Die Verwaltung kann ein noch nicht übernommenes Angebot „Zurückziehen" (der Ausfallende selbst kann das nicht), den Gegendienst „Stellvertretend wählen" oder den Ausgleich „Erlassen", etwa wenn der Einspringer im Fenster keinen Dienst hat. Beim Erlassen ist eine „Begründung" Pflicht.
- **Anzeige:** Als Art steht „Erzwungener Tausch" im Angebot. Der Ausfallende und der Einspringer sehen unter „Meine Angebote" den Stand „Ausgleich offen", „Ausgleich: Dienst vom …" oder „Ausgleich erlassen".
- **Bis zum Ende des Diensttages:** Erzwingen ist möglich, solange der Dienst heute oder später stattfindet, auch wenn er heute schon begonnen hat. Ein offenes erzwungenes Angebot verfällt erst, wenn der Tag des Dienstes vorbei ist.
- **Vorhandenes Angebot:** Hat der Ausfallende für den Platz schon ein offenes Angebot, wird es hinfällig; der erzwungene Tausch hat Vorrang.
- Beide Plätze (der übertragene und später der Gegendienst) sind wie bei jedem Tausch gesperrt.

Die 3-Monats-Grenze gilt nur hier; normale Tausche gegen einen beliebigen Dienst haben weiter keine Zeitgrenze.

Regeln, die die App durchsetzt:

- **Sofort wirksam.** Annehmen braucht keine Freigabe; der Kalender zeigt die neue Besetzung ohne Neuladen.
- **Atomar.** Beim Tausch wechseln beide Plätze zusammen oder gar nicht. Nehmen zwei Personen gleichzeitig an, gelingt nur eine; die andere erhält „Das Angebot ist nicht mehr offen."
- **Verfallen.** Ein offenes Angebot endet von selbst, sobald der angebotene Dienst begonnen hat (ein offener erzwungener Tausch erst nach dem Diensttag). Begonnene und vergangene Dienste lassen sich weder anbieten noch annehmen („Der Dienst hat bereits begonnen.").
- **Hinfällig.** Ein Tausch gegen einen konkreten Gegendienst wird automatisch auf „Hinfällig" gesetzt, wenn dieser Gegendienst nicht mehr abgegeben werden kann: Der Anbieter besitzt ihn selbst, oder bei einer Direktanfrage gehört er der angefragten Person nicht mehr. Ebenso wird ein Angebot hinfällig, wenn der Anbieter den angebotenen Platz nicht mehr innehat oder wenn der angebotene oder der gewünschte Dienst nicht mehr existiert. Verliert der Anbieter das Recht zum Tauschen, wird sein offener Tausch beim Annehmen ebenfalls hinfällig. Offene Abgaben aus der Zeit vor der Umstellung wurden hinfällig.
- **Keine Doppelbelegung.** Würde der Annehmende zur selben Zeit schon Dienst haben, lehnt die App ab („Das ergäbe eine Doppelbelegung.").
- **Ein Angebot je Platz.** Für denselben Platz kann es nur ein offenes Angebot geben.
- **Getauschte Plätze sind gesperrt** und bleiben beim Neugenerieren der Rotation erhalten (siehe [Generieren](#3-generieren)).
- **Plätze von Diensten wechseln nur über die Tauschbörse.** Sich selbst im Dienst ein- oder auszutragen ist für Rotationsdienste gesperrt. Ausnahme: Wer das Recht „Andere eintragen" (`signUpOthers`) hat, kann Plätze weiterhin von Hand umbesetzen.
- Alle Tauschvorgänge stehen im Audit-Log (`swap.offered`, `swap.accepted`, `swap.declined`, `swap.withdrawn`, `swap.forced`, `swap.counter_chosen`, `swap.counter_waived`).

## 4a. Dienstfrei

Wer einen Platz in einem Dienst hat, bekommt danach einen Arbeitstag frei: das **Dienstfrei**. Es hängt am Platz (nicht an der Person) und wechselt bei einem Tausch mit dem Platz den Inhaber (bei „nach dem Dienst“; „vor dem Dienst“ siehe unten).

**Einschalten.** Im Rotationsformular den Schalter „Dienstfrei zum Dienst" aktivieren und bei „Text für Dienstfrei" die Vorlage anpassen (Standard `{Vorname} dienstfrei`, Platzhalter wie bei der Eintragsvorlage). Beim nächsten Generieren bekommen alle künftigen Dienste ihr Dienstfrei, auch bereits erzeugte. Rückwirkend entsteht nichts. Beim Ausschalten entfernt die App alle künftigen Dienstfreie und benachrichtigt die Inhaber; vergangene bleiben als Historie.

**Dienstfrei liegt.** Unter dem Schalter wählt ein Auswahlfeld, wo das Dienstfrei liegt: „nach dem Dienst (nächster Arbeitstag)“ (Standard, auch für alle bestehenden Rotationen) oder „vor dem Dienst (Montag der Dienstwoche)“. Die Einstellung gilt pro Rotation. Die folgenden Absätze beschreiben „nach dem Dienst“; die Abweichungen für „vor dem Dienst“ stehen im Absatz „Dienstfrei vor dem Dienst“ weiter unten.

**Wer bekommt eins.** Jeder besetzte Platz eines Dienstes, auch Zusatzplätze, geöffnete Feiertage sowie Einspringer- und Ausgleichsplätze. Ein Schließtag bringt keines. Wird der Diensttag nachträglich zum Schließtag, entfällt das Dienstfrei (mit Mail an den Inhaber).

**Ohne Dienstfrei (All-in).** Sobald das Dienstfrei eingeschaltet ist, zeigt das Rotationsformular unter „Dienstfrei je Teilnehmer" einen Schalter pro Teilnehmer. Ausgeschaltet bekommt diese Person für keinen Platz ein Dienstfrei, etwa bei einem All-in-Vertrag. Es zählt immer der aktuelle Inhaber: Übernimmt eine Person ohne Dienstfrei per Tausch einen Platz, entfällt dessen Dienstfrei (der bisherige Inhaber bekommt die Mail „Dienstfrei entfällt"); gibt sie einen Platz ab, bekommt der neue Inhaber sofort sein Dienstfrei. Einspringer, die nicht Teilnehmer der Rotation sind, bekommen eines. Beim Ausschalten entfallen die künftigen Dienstfreie dieser Person, beim Wiedereinschalten entstehen sie beim nächsten Speichern bzw. spätestens beim stündlichen Abgleich neu.

**Standardtag.** Der erste Arbeitstag nach dem Dienst. Ein Arbeitstag ist ein Werktag Mo bis Fr, der kein Feiertag aus dem Feiertagskalender, kein Ausfalltag der Rotation und kein anderes eigenes Dienstfrei derselben Person ist. Hat die ganze Folgewoche keinen Arbeitstag, gilt der nächste danach. Arbeitstage pro Person (Teilzeit) kennt die App nicht: Wer an dem Tag ohnehin nicht arbeitet, verschiebt selbst.

**Ausfalltage auf Werktagen.** Ausfalltage dürfen jetzt auch auf Mo bis Fr fallen, obwohl dort kein Dienst ist. Sie erscheinen dann ebenfalls als Schließeintrag im Teamkalender und in Outlook (Feiertage an Nicht-Diensttagen nicht, sie stehen im Feiertagskalender). Die Rundennummerierung zählt weiter nur Diensttage.

**Zustände.**

| Zustand | Bedeutung |
| --- | --- |
| Standard | Das Dienstfrei liegt auf dem Standardtag. |
| Verschoben | Der Inhaber hat es innerhalb der Woche verlegt. |
| Gesperrt | Die Verwaltung hat es gesperrt. Es hat kein Datum und keinen Kalendereintrag. |
| Vereinbart | Die Verwaltung hat einen vorgeschlagenen Termin angenommen. |
| Entfallen | Der Dienst ist weggefallen oder die Funktion wurde ausgeschaltet. |

**Verschieben.** Wer das Recht „Dienstfrei selbst verschieben" hat, verlegt sein Dienstfrei auf `/swaps` im Reiter „Dienstfrei" mit „Verschieben" auf einen anderen Arbeitstag derselben Woche Mo bis Fr. Hat ein Tag schon andere Dienstfreie, steht „{n} haben frei" dabei; das ist nur ein Hinweis, keine Sperre. Zurück auf den Standardtag ergibt wieder „Standard". Verschieben, Sperren und Vereinbaren gehen nur, solange weder der alte noch der neue Tag begonnen hat. Wird das Recht später entzogen, bleiben bereits verschobene Tage bestehen.

**Sperren und vereinbaren.** Die Rotations-Verwaltung kann ein Dienstfrei im Abschnitt „Verwaltung" des Reiters „Dienstfrei" mit „Sperren" (optional mit Notiz) sperren, auch ein vereinbartes. Der Inhaber erhält eine Mail und schlägt mit „Termine vorschlagen" bis zu 5 Termine vor (höchstens 10 offene); jeder muss ein Arbeitstag ab jetzt bis 3 Monate nach dem Diensttag sein. Die Verwaltung

- **nimmt** einen Termin **an** (die übrigen Vorschläge verfallen, das Dienstfrei ist „Vereinbart"),
- **lehnt ab**, mit Pflicht-Begründung, oder
- macht einen **Gegenvorschlag** (ohne 3-Monats-Grenze). Den nimmt der Inhaber an oder lehnt ihn ohne Begründung ab. Das wiederholt sich, bis ein Termin feststeht.

Ein vereinbartes Dienstfrei kann der Inhaber nicht selbst verschieben; er beantragt mit „Änderung beantragen" neue Termine. Der vereinbarte Termin gilt bis zur Annahme eines neuen. Bleiben Vorschläge 3 Tage unbeantwortet, erhält die Verwaltung eine Erinnerung. Ein offenes Dienstfrei verfällt nie stillschweigend, auch nicht nach Ablauf der 3 Monate. Ist ein Verwalter selbst Teilnehmer, kann er seine eigenen Vorschläge annehmen.

**Bei Tausch und Neugenerieren.** Bei jedem Platzwechsel (Tausch, erzwungener Tausch, Ausgleich, Neugenerieren) gilt für den neuen Inhaber: Aus „Standard" oder „Verschoben" wird „Standard", „Gesperrt" bleibt gesperrt (offene Vorschläge des alten Inhabers verfallen), aus „Vereinbart" wird „Gesperrt" (mit Mail an den neuen Inhaber). Wird das Datum nachträglich ungültig (neuer Feiertag oder Ausfalltag, anderes eigenes Dienstfrei), wandert ein Standard-Dienstfrei still weiter, ein verschobenes fällt mit Mail auf den Standardtag zurück, ein vereinbartes wird mit Mail gesperrt. Dienstfreie, deren Datum begonnen hat, ändern sich nie mehr.

**Dienstfrei vor dem Dienst.** Bei „Dienstfrei liegt: vor dem Dienst“ gilt:

- **Standardtag:** der erste Arbeitstag Mo bis Fr der Dienstwoche vor dem Diensttag (meist der Montag). Hat die Dienstwoche vor dem Diensttag keinen Arbeitstag, gilt der nächste Arbeitstag nach dem Dienst. Liegt der Standardtag schon in der Vergangenheit, gilt der nächste Arbeitstag ab morgen.
- **Verschieben:** nur innerhalb der Dienstwoche vor dem Diensttag.
- **Tausch, erzwungener Tausch und Ausgleich:** Das Dienstfrei bleibt mit Datum und Status beim bisherigen Inhaber (gehaltenes Dienstfrei); auf `/swaps` steht dort „Aus getauschtem Dienst – das Dienstfrei bleibt bei dir.“. Der neue Inhaber bekommt für diesen Platz keines, auch nicht, wenn der Abgebende keines hatte oder der Ausgleich erlassen wird. Beim Zurücktauschen wird das Dienstfrei wieder normal. Die Tauschdialoge zeigen einen Hinweis.
- **Neugenerieren und Umbesetzen durch die Verwaltung:** Nicht gehaltene, nicht begonnene Dienstfreie folgen dem Platz. Pro Dienst gibt es höchstens so viele Dienstfreie wie Plätze. Entfallen Plätze, fallen zuerst verwaiste Dienstfreie weg, dann gehaltene (mit Mail an den Inhaber).
- **Umschalten:** Beim Wechsel auf „vor dem Dienst“ werden Standard-Dienstfreie neu datiert, verschobene außerhalb des neuen Bereichs fallen mit Mail auf den Standardtag zurück; vereinbarte und gesperrte bleiben. Beim Wechsel auf „nach dem Dienst“ enden alle gehaltenen Dienstfreie, und die Dienstfreie folgen wieder ihrem Platz. Ein verschobenes Dienstfrei wird dort nur zurückgesetzt, wenn es ungültig ist oder am oder vor dem Diensttag liegt (unverändertes Verhalten).

**Mails.** Über Microsoft Graph, wie bei der Tauschbörse:

| Anlass | An wen | Schalter |
| --- | --- | --- |
| Sperre, Annahme oder Ablehnung seiner Vorschläge, Gegenvorschlag, zurückgesetzt, entfallen | der Inhaber | „Mein Dienstfrei (Sperre, Antworten, Änderungen)" |
| neue Vorschläge, Änderungsantrag, Erinnerung, Annahme oder Ablehnung eines Gegenvorschlags durch den Inhaber | die Verwaltung | „Dienstfrei-Vorschläge der Teilnehmer (Verwaltung)" |

Annahme, Ablehnung und Gegenvorschlag gehen jeweils an die andere Seite. Die beiden Schalter stellst du unter „Benachrichtigungen" auf `/swaps` ein.

**Anzeige.** Das Dienstfrei erscheint als ganztägiger Eintrag „{Vorname} dienstfrei" (Vorlage der Rotation) im Teamkalender; ein Klick in der Tagesansicht führt zum Reiter „Dienstfrei". Im persönlichen Feed ist es ein ganztägiger Termin. In Outlook wird es bei eingeschaltetem Schalter ein ganztägiger Termin im Kalender von office@ mit dem Inhaber als einzigem Teilnehmer und Status „Abwesend". Gesperrte Dienstfreie haben kein Datum und erscheinen nirgends. Der Eintrag ist keine Schicht und lässt sich nicht bearbeiten.

**Grenzen.**

- Arbeitstage pro Person und Krankheit kennt die App nicht; genehmigter Urlaub zählt nicht als Arbeitstag. Bei Bedarf sperrt die Verwaltung, und der Termin wird neu vereinbart.
- Beim Neugenerieren werden verwaiste Dienstfreie in fester Reihenfolge den neuen Inhabern zugeordnet; ein gesperrtes kann so an eine andere Person gehen (es bleibt gesperrt).
- Kollisionen mit eigenen Diensten anderer Rotationen an Werktagen werden nicht geprüft.
- Manuelles Umbesetzen über „Andere eintragen" (`signUpOthers`) gilt nicht als Platzwechsel: Das alte Dienstfrei entfällt (mit Mail), der neue Inhaber bekommt ein neues auf dem Standardtag; eine Sperre oder Vereinbarung geht verloren. Für Umbesetzungen ist der erzwungene Tausch gedacht, der das Dienstfrei übergibt.
- Wird ein Samstag nachträglich zum Ausfalltag, entfällt sein Dienstfrei erst beim nächsten Generieren (wie der Schließeintrag selbst).
- Wird eine Rotation gelöscht, verschwinden alle ihre Dienstfreie (auch vergangene und gesperrte) ohne Mail an die Inhaber.
- Die Verwaltung erhält Mails nur, wenn sie Besitzer ist oder eine Freigabe mit „Kalendereinstellungen verwalten" hat; globale Administratoren ohne Freigabe nicht.
- Mails nur mit konfiguriertem Outlook.

## 4b. Urlaub

**Urlaub** gehört der Person, nicht einer Rotation: ein Zeitraum ganzer Kalendertage (1 bis 366 Tage), in dem sie keinen Platz bekommt. Er gilt in allen Rotationen, in denen sie Teilnehmer ist. Urlaube derselben Person überschneiden sich nicht. Bedient wird alles auf `/swaps` im Reiter „Urlaub“.

**Antrag und Entscheidung.** Ein Teilnehmer beantragt mit „Urlaub beantragen“ Zeitraum und optional eine Notiz (bis 500 Zeichen); der Start muss nach heute liegen. Die Rotations-Verwaltung der Person (wer in einer ihrer Rotationen Rotationen verwalten darf) sieht den Antrag unter „Offene Anträge“ und genehmigt oder lehnt ab; eine Ablehnung braucht eine Begründung. Den eigenen offenen Antrag zieht der Antragsteller zurück. Anträge sehen nur Antragsteller und Verwaltung.

**Direkte Einträge.** Die Verwaltung kann Urlaub mit „Urlaub eintragen“ direkt für einen Teilnehmer eintragen, ändern und stornieren, ohne Antrag. Die Person bekommt eine Mail.

**Änderung und Storno.** Ein genehmigter Urlaub lässt sich für den Mitarbeiter nur über einen Änderungs- oder Storno-Antrag ändern, den die Verwaltung genehmigt oder ablehnt (höchstens ein offener Antrag je Urlaub). Ein genehmigter Storno-Antrag verschickt die Mail „Urlaub storniert“. Begonnene Urlaubstage sind unveränderlich: Neue und geänderte Startdaten müssen nach heute liegen.

**Neuplanung.** Jede wirksame Aktion (Genehmigen, direkter Eintrag, Änderung, Storno) zeigt zuerst eine Vorschau mit allen betroffenen Plätzen (vorher → nachher). Nach dem Bestätigen generiert die App in einem Schritt jede Rotation der Person neu, vom ersten nicht begonnenen Diensttag im (früheren) Zeitraum bis zum bisherigen Planende. Das kann viele Plätze verschieben und damit viele Outlook-Einladungen und -Absagen auslösen; die Vorschau weist darauf hin.

- Urlaub ist im Generator eine harte Regel. „Nie zwei Diensttage in Folge“, Partnerwechsel und Abstände dürfen dafür gebrochen werden.
- Der Platz wird zuerst innerhalb der Runde verschoben; sonst springt ein Ersatz ein.
- **Nachholen.** Wer wegen Urlaubs einen Platz verpasst, holt ihn im selben Kalenderjahr des jeweiligen Dienstes nach (das Nachhol-Konto wird pro Kalenderjahr des Dienstes geführt). Was am Jahresende übrig bleibt, verfällt; bei „Gerecht pro Kalenderjahr“ geht es über das Delta ins Folgejahr.
- **Abstand im Kalenderjahr.** Dass die Plätze pro Kalenderjahr höchstens um 1 abweichen, ist nur mit eingeschaltetem Jahresausgleich garantiert. Ohne ihn laufen die Runden wie bisher über den Jahreswechsel.
- **Offene Plätze.** Sind in einem Dienst zu wenige Personen verfügbar, bleibt der Platz offen.
- **Dienstfrei weicht Urlaub aus.** Urlaubstage sind keine Arbeitstage; ein Dienstfrei liegt nie auf einem Urlaubstag (siehe [Dienstfrei](#4a-dienstfrei)).
- **Gesperrte Plätze.** Gesperrte Plätze der Person an Urlaubstagen werden freigegeben, Tauschangebote darauf verfallen.

**Tausch an Urlaubstagen gesperrt.** An einem Tag, an dem eine Person Urlaub hat, kann sie keinen Platz per Tausch übernehmen. Der Versuch endet mit „An diesem Tag ist die Person auf Urlaub.“

**Anzeige.**

- Teamkalender: genehmigter Urlaub erscheint als ganztägiger Eintrag „{Vorname} Urlaub“; ein Klick in der Tagesansicht führt zum Reiter „Urlaub“. Der Eintrag ist keine Schicht und lässt sich nicht bearbeiten.
- Persönlicher Feed: ganztägiger Termin.
- Outlook: ganztägiger Termin im Kalender von office@ mit der Person als einzigem Teilnehmer und Status „Abwesend“. Er gehört zur ersten Outlook-fähigen Rotation der Person (nach Namen sortiert). Der Termin eines bereits begonnenen Urlaubs wird nie mehr aktualisiert: Wird ein laufender Urlaub verkürzt, bleibt er in Outlook in voller Länge stehen.
- Urlaubskalender (Verwaltung): eine Übersicht aller Urlaube pro Jahr; auf dem Handy als Liste, am Desktop als Balken.

**Mails.** Wie bei Tausch und Dienstfrei über Microsoft Graph. Die Verwaltung erhält Anträge und Änderungsanträge, die Person Entscheidungen (genehmigt, abgelehnt, geändert, storniert) und direkte Einträge der Verwaltung. Zwei Schalter unter „Benachrichtigungen“ auf `/swaps`:

| Anlass | An wen | Schalter |
| --- | --- | --- |
| Entscheidungen, Einträge, Änderungen und Stornos der Verwaltung | die Person | „Meine Urlaube“ |
| neue Anträge und Änderungsanträge | die Verwaltung | „Urlaubsanträge“ |

Mails nur mit konfiguriertem Outlook. Mitglieder, die aus der Rotation ausscheiden, behalten ihre Urlaube.

## 5. Rechte

| Wer | Was | Voraussetzung |
| --- | --- | --- |
| Verwaltung von Rotationen | Rotationen anlegen, ändern, generieren, Outlook-Schalter | Besitzer des Kalenders, Recht „Kalendereinstellungen verwalten" im Kalender oder Administrator der Instanz |
| Tausch erzwingen | Tausch erzwingen, Gegendienst stellvertretend wählen, Ausgleich erlassen | wie Verwaltung von Rotationen |
| Dienstfrei selbst verschieben | Das eigene Dienstfrei innerhalb der Arbeitswoche verlegen | Recht „Dienstfrei selbst verschieben" (`moveOwnDayOff`), in allen Bündeln standardmäßig angehakt. Zählt nur für Besitzer und Freigaben an Benutzer, nie für Freigabe-Links oder Gäste |
| Dienstfrei sperren und vereinbaren | Sperren, Vorschläge annehmen oder ablehnen, Gegenvorschlag | wie Verwaltung von Rotationen |
| Tauschen | Dienste anbieten und annehmen | Angemeldet, im Kalender das Recht „Sich selbst eintragen" (`signUpSelf`) und Anmeldungen im Kalender eingeschaltet |
| Persönlicher Feed | Eigenen Feed einrichten | Angemeldet; im Feed erscheinen nur Dienste aus Kalendern, die der Benutzer sehen darf |

Empfehlung für die Teilnehmer: Den Teamkalender mit dem Bündel **„Read"** teilen. Es enthält „Sich selbst eintragen" und reicht für die Tauschbörse; Teilnehmer können damit nichts anlegen oder ändern. Ein Rotationsdienst lässt sich über das normale Eintragen ohnehin nicht umbesetzen, nur über die Tauschbörse. Die Verwaltung bekommt ein Bündel mit „Kalendereinstellungen verwalten" (z. B. „Manage") oder ist Besitzer des Kalenders.

Das Teilen und die Bündel sind in [`PERMISSIONS.md`](PERMISSIONS.md) beschrieben. Eine Tauschbörse ohne Teilnehmer mit dem Recht zum Eintragen bleibt leer: Wer kein Recht hat, sieht den Kalender dort nicht („Du hast in keinem Kalender Dienste, die du tauschen darfst.").

## 6. Benachrichtigungen und Outlook

Kurzfassung; die vollständige Einrichtung steht in [`OUTLOOK_SETUP.md`](OUTLOOK_SETUP.md).

- **Tausch-Mails.** Über Microsoft Graph verschickt office@ E-Mails bei einem neuen Angebot an alle (nicht an die aktuellen Inhaber des Dienstes), bei einer Direktanfrage an die angefragte Person sowie bei Annahme bzw. Ablehnung an den Anbieter. Beim erzwungenen Tausch kommen vier Mails dazu:

  | Mail | An wen | Schalter |
  | --- | --- | --- |
  | „Einspringer gesucht: …" | alle außer den Platzinhabern des Dienstes (Tausch „Offen an alle") | „Neue Angebote an alle" |
  | „Du springst ein: …" | der bestimmte Einspringer | „Anfragen an mich" |
  | „Dein Dienst wurde übertragen: …" | der Ausfallende | „Meine Angebote" |
  | „Ausgleich für deinen Dienst: …" | der Ausfallende, sobald der Gegendienst gewählt ist | „Meine Angebote" |

  Das Erlassen eines Ausgleichs löst keine Mail aus. Jeder Benutzer schaltet unter „Benachrichtigungen" auf `/swaps` die Arten „Neue Angebote an alle", „Anfragen an mich" und „Meine Angebote" einzeln ab.
- **Outlook-Termine.** Pro Rotation gibt es den Schalter „In Outlook (office@) eintragen". Jeder künftige Platz (und bei eingeschaltetem Dienstfrei jedes Dienstfrei, siehe [Dienstfrei](#4a-dienstfrei)) wird ein ganztägiger Termin im Kalender von office@ (Status „Frei", Titel aus der Eintragsvorlage); eingeladen ist nur der Inhaber des Platzes. Dienstfrei-Termine haben dagegen den Status „Abwesend" und den Titel aus der Vorlage „Text für Dienstfrei". Bei Tausch oder Umbesetzung sagt die App den Termin des bisherigen Inhabers ab und lädt den neuen Inhaber ein; Exchange verschickt die Absage sowie Einladungen, Aktualisierungen und Absagen. Tausch, Umbesetzung und Ausfalltag werden binnen etwa einer Minute nachgezogen, ein nächtlicher Vollabgleich stellt gelöschte oder von Hand geänderte Termine wieder her.
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
- Der Kalender heißt „Meine Dienste". Der Titel stammt aus der Eintragsvorlage der Rotation (z. B. „Günther Dienst"), die Zeit ist die echte Dienstzeit; die Beschreibung enthält der Reihe nach Notizen und benutzerdefinierte Felder des Dienstes, dann „Mit: …" (die anderen Platzinhaber, entfällt, wenn du allein im Dienst bist) und „Tauschen: `<BETTER_AUTH_URL>`/swaps".
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

### Bestehende Instanz aktualisieren

So bringst du eine bereits laufende Instanz auf einen neuen Stand. Die Daten in `./data` bleiben dabei erhalten.

**Woher neue Versionen kommen.** GitHub Actions baut die Images des Forks und legt sie unter `ghcr.io/flichb/bettershift` ab:

| Tag | Entsteht durch | Gedacht für |
| --- | --- | --- |
| `latest` | ein Release (Git-Tag `vX.Y.Z`, angelegt mit `npm run release:patch`, `release:minor` oder `release:major`) | den produktiven Betrieb |
| `vX.Y.Z`, `vX.Y`, `vX` | dasselbe Release | eine fest eingestellte Version |
| `dev` | jeden Push auf `main`, also jeden zusammengeführten Pull Request | Testinstanzen |
| `pr-<Nummer>` | einen Pull Request aus diesem Repository | das Ausprobieren vor dem Zusammenführen |

Eine Änderung auf einem Feature-Branch, z. B. `feat/rotation-generator`, erreicht den Server also erst, wenn der Pull Request nach `main` zusammengeführt ist (dann `dev`) und danach ein Release erstellt wurde (dann `latest` und `vX.Y.Z`).

**Empfehlung: Version fest einstellen.** Trag in der Compose-Datei statt `latest` die Version ein, z. B. `image: ghcr.io/flichb/bettershift:v3.3.1`. Dann aktualisiert sich nichts unbemerkt, ein Update ist eine bewusste Änderung dieser Zeile, und für ein Zurück kennst du die alte Version.

**Vorher prüfen.**

1. Welche Version läuft gerade: `https://<deine-adresse>/api/version` im Browser aufrufen oder auf dem Server `docker compose images` ausführen.
2. Die Release-Notizen der neuen Version auf GitHub (Reiter „Releases" des Repositories) und [`UPGRADING.md`](UPGRADING.md) lesen. Dort steht, ob eine Version Handgriffe verlangt, z. B. neue Umgebungsvariablen oder ein zusätzliches Volume.
3. Einen ruhigen Zeitpunkt wählen. Während des Neustarts ist die App etwa eine Minute nicht erreichbar.

**Schritte.** Auf dem Server im Verzeichnis der Compose-Datei:

1. **Backup ziehen** (siehe [Datensicherung](#datensicherung)), z. B.:

   ```bash
   docker compose stop
   cp -a data "data-backup-$(date +%Y%m%d)"
   ```

2. Bei fest eingestellter Version die Zeile `image:` in der Compose-Datei auf die neue Version ändern. Bei `latest` entfällt dieser Schritt.
3. **Neues Image holen und starten:**

   ```bash
   docker compose pull
   docker compose up -d
   ```

4. **Start beobachten:**

   ```bash
   docker compose logs -f bettershift
   ```

   Die Migrationen laufen beim Start von selbst (siehe unten). Wenn „Ready" erscheint, ist der Server bereit; mit Strg+C beendest du die Anzeige, der Container läuft weiter.
5. **Kontrollieren:** `/api/version` zeigt die neue Nummer, `/api/health` meldet `"status": "healthy"`, und Anmeldung, Kalender und `/swaps` funktionieren.
6. Alte Images aufräumen (optional): `docker image prune`.

**Migrationen.** Das Image startet mit `node scripts/migrate.mjs && node server.js`. Erst werden die offenen Migrationen der Upstream-Tabellen eingespielt, danach die der Fork-Tabellen (Ordner `drizzle/fork`, eigene Verwaltungstabelle); danach startet der Server. Ein manueller Migrationsschritt ist nicht nötig. Schlägt eine Migration fehl, startet der Server nicht, und `docker compose logs bettershift` zeigt den Grund.

**Zurück auf die alte Version.** Migrationen lassen sich nicht rückgängig machen. Ein Zurück geht deshalb nur zusammen mit dem Backup:

```bash
docker compose down
rm -rf data
cp -a "data-backup-JJJJMMTT" data
# in der Compose-Datei die alte Version bei image: eintragen
docker compose up -d
```

Alles, was seit dem Backup eingetragen oder getauscht wurde, ist danach verloren.

**Image nicht abrufbar?** Meldet `docker compose pull` „denied" oder „unauthorized", ist das Paket in der GitHub Container Registry privat. Entweder stellt man es auf GitHub unter „Packages" → „bettershift" → „Package settings" auf öffentlich, oder man meldet den Server einmalig mit einem Token an, das das Recht `read:packages` hat: `docker login ghcr.io -u <github-benutzer>`, als Passwort das Token.

**Besonderheit beim Update auf die wechselnden Paare (Oktober 2026).** Ab dieser Version mischt der Generator die Paare ab der zweiten Runde neu (siehe [Rotation anlegen](#2-rotation-anlegen)). Bereits erzeugte Dienste bleiben, bis du die Rotation das nächste Mal generierst. Beim nächsten „Generieren" werden alle künftigen, nicht getauschten Plätze neu verteilt; getauschte Plätze bleiben gesperrt. Deshalb:

1. Nach dem Update unter `/rotations` zuerst die „Vorschau" ansehen und erst dann „Übernehmen".
2. Ist Outlook eingeschaltet, aktualisieren sich die Termine danach von selbst; die Betroffenen bekommen geänderte Einladungen bzw. Absagen.
3. Das Team vorher kurz informieren, dass sich künftige Dienste verschieben.

**Besonderheit beim Update auf „Ein Eintrag pro Person" (Oktober 2026).** Jeder Platz hat jetzt einen eigenen Titel (Eintragsvorlage) und bei Outlook einen eigenen Termin. Nach dem Update auf diese Version sagt der erste Abgleich alle künftigen Termine im alten Format (ein Termin pro Dienst) ab und lädt pro Platz neu ein — jeder Teilnehmer bekommt einmalig eine Absage plus eine Einladung je künftigem Platz (bei einem Jahr voller Samstage mehrere Dutzend Mails pro Person), die Exchange teils verzögert zustellt. Informiere das Team vorher.

Der Container hat nur eine Instanz: Starte nie zwei Container auf dieselbe `./data`.

### Erstinbetriebnahme

1. Container starten und `BETTER_AUTH_URL` im Browser öffnen. Den **ersten Benutzer registrieren: Er wird automatisch Superadmin.**
2. **Teamkalender anlegen** und in den Kalendereinstellungen die **Anmeldungen einschalten**.
3. **Preset „Samstagsdienst"** anlegen: 09:30 bis 15:00 Uhr.
4. **Teilnehmer einladen** bzw. registrieren lassen und den Kalender mit ihnen teilen, mit dem Bündel **„Read"** (siehe [Rechte](#5-rechte)).
5. **Feiertagskalender anlegen**: Kalender „Feiertage AT“ mit dem Abo `webcal://www.wien.gv.at/spezial/daten/ics/feiertage.ics` (siehe [Feiertage und Schließtage](#feiertage-und-schließtage)).
6. Unter `/rotations` die **Rotation anlegen** (siehe [Rotation anlegen](#2-rotation-anlegen)): Preset wählen, Teilnehmer in Reihenfolge, 2 pro Dienst, Periode Woche, Diensttag Sa, „Feiertagskalender“ „Feiertage AT“ und „Text bei Schließung“ „HeimkinoWelt geschlossen“.
7. Zeitraum wählen, „Vorschau" ansehen, dann „Übernehmen".
8. Optional: **Outlook** nach [`OUTLOOK_SETUP.md`](OUTLOOK_SETUP.md) einrichten und den Schalter der Rotation einschalten, zuerst im Trockenlauf.
9. Das Team auf den persönlichen [Kalender-Feed](#7-persönlicher-kalender-feed) und die Tauschbörse hinweisen.

## 9. Grenzen und bekannte Punkte

- **Echter Microsoft-365-Tenant noch nicht getestet.** Die Outlook-Anbindung wurde per Trockenlauf und gegen einen simulierten Graph-Server nachgewiesen. Den Test gegen den echten Tenant erledigst du bei der Einrichtung ([`OUTLOOK_SETUP.md`](OUTLOOK_SETUP.md), Abschnitt „Testen").
- **Nur eine Serverinstanz.** Sync-Worker, Ablauf-Timer und automatischer Abgleich laufen als Zeitgeber im Prozess. Mehrere Replikas würden doppelt arbeiten.
- **Feed-Aktualisierung bei den Clients.** Kalender-Apps holen Abos nach eigenem Takt (Google oft erst nach Stunden). Ein Tausch ist im Feed sofort, im Kalenderprogramm erst später sichtbar.
- **Mails und Feed-Texte nur in `DEFAULT_LOCALE`**, nicht pro Empfänger.
- **Mails mindestens einmal zugestellt.** Bei einem Absturz zwischen Versand und Statuswechsel kann eine Mail ein zweites Mal gehen.
- **Keine Übernahme bestehender Outlook-Termine** von Hand angelegter Dienste.
- **Der persönliche Feed zeigt nur eigene Plätze in Rotationsdiensten** der letzten 60 Tage und der Zukunft, keine älteren Dienste.
- Wird ein Feiertagskalender an eine bereits laufende Rotation gehängt, verschieben die Feiertage seit dem Beginn der Rotation die künftige Besetzung. Die Vorschau zeigt das; wer es nicht will, setzt „Neustart ab Datum“ auf heute.
- Schließtage erscheinen erst beim nächsten „Übernehmen“, nicht automatisch nach einer Synchronisierung des Feiertagskalenders.
- **Erzwungener Tausch und Ausgleich:**
  - Die Umstellung offener Abgaben verschickt keine Mails; sie werden beim nächsten Lauf hinfällig.
  - Wählt die Verwaltung den Gegendienst stellvertretend, bekommt nur der Ausfallende eine Mail. Der Einspringer erfährt es über die Outlook-Absage und die Tauschbörse.
  - Der Einspringer sieht einen gewählten oder erlassenen Ausgleich danach unter „Meine Angebote" (30 Tage).
  - Ein offener Ausgleich hat keine Frist und keine Erinnerungsmail. Die Verwaltung sieht ihn im Reiter „Verwaltung".
  - Die 3 Monate des Ausgleichsfensters sind fest im Code, keine Einstellung pro Rotation.
  - Der Ausfallende kann einen erzwungenen Tausch weder verhindern noch rückgängig machen. Ein Fehler der Verwaltung lässt sich nur durch einen weiteren Tausch oder durch Umbesetzen mit „Andere eintragen" (`signUpOthers`) korrigieren.
- **Jahresausgleich:**
  - Ein begonnener Dienst, der an einem Tag liegt, der später zum Schließtag wurde, wird nicht gezählt.
  - Bei Perioden über mehrere Tage zählt jedes Datum als Bruchteil eines Platzes.
  - Ein Neustart innerhalb eines Jahres gleicht das Vorjahr nicht erneut aus. Das gilt auch für einen Neustart in den ersten Tagen des Jahres, wenn in diesem Jahr schon ein Dienst der alten Konfiguration stattgefunden hat: Der Ausgleich des Vorjahres entfällt dann.
  - Schaltest du den Schalter mitten im Jahr ein, wird dieses Jahr nicht rückwirkend ausgeglichen. Sein Delta wird erst im Folgejahr verrechnet.
  - Hat ein Jahr weniger Diensttage, als der Ausgleich braucht, entfällt der Rest des Ausgleichs. Er wird nicht ins nächste Jahr übertragen.
  - Bei 3 Personen pro Dienst kann der Jahresmodus in Konfigurationen, in denen schon der normale Plan Partner wiederholt, ein paar Wiederholungen mehr erzeugen als der normale Plan.
- **Dienstfrei:** Grenzen siehe [Dienstfrei](#4a-dienstfrei).
- **Urlaub:**
  - Es gibt keinen Urlaubsanspruch und keine Resttage-Verwaltung.
  - Es gibt keine halben Tage; Urlaub zählt immer ganze Kalendertage.
  - Krankenstand läuft weiter über den [erzwungenen Tausch](#erzwungener-tausch-krankenstand).
  - Ein laufender Urlaub, der verkürzt wird, bleibt in Outlook in voller Länge stehen (begonnene Termine werden nicht angefasst).
  - Die Neuplanung kann viele Outlook-Mails auslösen.
- Ohne Anmeldung (`AUTH_ENABLED=false`) gibt es weder Tausch-Mails noch Outlook-Sync noch einen persönlichen Feed.
