/**
 * Evi's release notes (RELEASES in changelog.ts) in the languages Evi ships. English is the source:
 * each entry here lists the same lines as English, in the same order and count, per version and
 * section. A release or section a language lacks shows in English (see localizedRelease).
 * **Bold lead-ins**, `code`, plugin names and brand names stay as they are in English.
 */
import type { SectionKind } from "./changelog";

export type ReleaseNotes = Partial<Record<SectionKind, string[]>>;

/** Language -> version -> section -> lines */
export const CHANGELOG_LOCALES: Record<string, Record<string, ReleaseNotes>> = {
    de: {
        "2.2.0": {
            fixed: [
                "**Updates folgen deinen Einstellungen.** Wenn Evis Team ein Update verlangt, lädt Evi es nur dann selbst herunter und startet Discord neu, wenn automatische Updates an sind. Sonst sagt es dir Bescheid und wartet, bis du auf Jetzt aktualisieren drückst. Plugins werden nur mit aktualisiert, wenn automatische Plugin-Updates an sind.",
            ],
        },
        "2.1.0": {
            added: [
                "**Arbeitsspeicher im Leistungs-Tab.** Sieh, wie viel Discord nutzt, und lass Evi es auf Wunsch neu starten, wenn es zu viel braucht, während du weg bist. Nie während eines Anrufs und höchstens einmal am Tag.",
                "**Spielmodus.** Discords eigener versteckter Spielmodus als Schalter im Leistungs-Tab: Während du spielst, wird Discord im Hintergrund langsamer und stoppt GIFs. In Anrufen bleibt er aus.",
            ],
            improved: [
                "**Startet schneller.** Evi merkt sich, wo Plugins in Discord eingreifen. Ab dem zweiten Start einer Discord-Version ist es mit vielen Plugins etwa viermal so schnell bereit. Ausgeschaltete Plugins laden erst, wenn du sie einschaltest.",
                "**Leichter im Alltag.** Die Tipp-Punkte werden nicht mehr in jedem Frame per JavaScript neu gezeichnet, Anruf-Buttons zeichnen das Video dahinter nicht mehr ständig unscharf, und ist Discord 10 Minuten ausgeblendet, leert Evi seine Bild-Caches (nie während eines Anrufs).",
            ],
            fixed: [
                "**Chromium-Einstellungen von Plugins bleiben.** Discord hat sie beim Start still überschrieben.",
            ],
        },
        "2.0.0": {
            added: [
                "**Zwölf neue Plugins.** Desktop Voice Messages, Embed Builder mit Components V2, Audit Log Plus, Role Colours Everywhere, Rich Presence Builder, Search Highlight, Click Actions, Soundboard Stealer, Quick Markup, Fix Embeds, Code Block Tools und Hover Converter. Alle im Store, alle aus, bis du sie einschaltest.",
                "**Eine Tour durch das Neue.** Beim ersten Start zeigt dir 2.0 die neuen Plugins und schaltet die ein, die du auswählst.",
                "**Veröffentliche eigene Plugins.** Ein Button auf der Plugins-Seite öffnet dein Autoren-Dashboard: Installationen, aktive Nutzer, Bewertungen, Rezensionen und wie jeder Discord-Build mit deinen Plugins zurechtkommt.",
            ],
            improved: [
                "**Menüs sehen aus wie in Discord.** Jedes Dropdown in Evi und seinen Plugins öffnet sich wie bei Discord, ohne Scrollleiste und mit Filter für lange Listen.",
                "**Zurück, wo du warst.** Wenn du im Store von einem Plugin zurückgehst, landest du auf derselben Seite, mit denselben Filtern und an derselben Stelle.",
                "**Wichtige Updates kommen schneller an.** Wenn ein Update nötig ist, lädt Evi es sofort herunter und startet Discord neu, wenn du nicht in einem Anruf bist.",
            ],
            fixed: [
                "**Plugins gelten nicht mehr grundlos als kaputt.** Ein Plugin, das auf einen noch nicht geöffneten Teil von Discord wartete, wurde als kaputt gemeldet.",
                "**Dialoge öffnen sich oben.** Manche öffneten sich in Discords Einstellungen bis zur Hälfte heruntergescrollt.",
            ],
        },
        "1.5.0": {
            added: [
                "**Neuigkeiten von Evis Team, live.** Ankündigungen erscheinen Sekunden nach dem Senden oben auf deinem Bildschirm und bleiben, bis du sie schließt.",
            ],
            fixed: [
                "**Plugin-Benachrichtigungen erscheinen wieder.** Discord hat heute geändert, wie es seine Pop-ups zeigt, und die von Plugins erschienen nicht mehr.",
            ],
        },
        "1.4.3": {
            fixed: [
                "**Dein Discord-Farbdesign hält sich aus Evis raus.** Mit einem Evi-Design zeigten Teile, die es nicht einfärbt (etwa die Fußzeile eines Dialogs), die Tönung deines Discord-Farbdesigns.",
                "**Kein Streifen mehr unter Dialogen mit Hintergrundbild.** Die Fußzeilen von Dialogen zeigten das Hintergrundbild doppelt durch, in einer anderen Farbe.",
            ],
        },
        "1.4.2": {
            improved: [
                "**Den abgesicherten Modus schaltest du.** Unter Allgemein → Updates gibt es „Abgesicherten Modus von selbst einschalten“: Ausgeschaltet lösen Abstürze ihn nie aus.",
            ],
            fixed: [
                "**Nichts von Evi über deinen Spielen.** Der abgesicherte Modus und andere Hinweise erschienen im In-Game-Overlay von Discord, wo man sie nicht wegklicken konnte, und wenn ein Spiel das Overlay schloss, galt das als Absturz.",
            ],
        },
        "1.4.1": {
            added: [
                "**Evi Setup für macOS und Linux.** Installiere, aktualisiere und entferne Evi auf jedem System in einem Fenster, ohne Terminal. Unter Linux fragt es nach deinem Passwort, wenn Discords Ordner es braucht, und unter macOS und Linux bringt es Evi nach Discord-Updates von selbst zurück.",
            ],
        },
        "1.4.0": {
            added: [
                "**Spotify Player im Store.** Ein kleiner Player über deiner Benutzerleiste mit Song, Cover, Abspielen und Pause, Zurück und Weiter und wo du im Song bist.",
            ],
            improved: [
                "**Die Store-Suche findet, was du meinst.** Jedes Wort zählt, in beliebiger Reihenfolge, Tippfehler werden verziehen, der beste Treffer steht oben, und der englische Name eines Plugins findet es in jeder Sprache.",
            ],
            fixed: [
                "**Updates funktionieren weiter** mit Releases, die das Kommandozeilen-Installationsprogramm nicht mehr enthalten.",
            ],
        },
        "1.3.1": {
            fixed: [
                "**Die Benutzerleiste behält ihren Platz.** Sind Game Activity Toggle und Fake Deafen beide an, teilen sich ihre Schalter einen Evi-Button mit Menü, damit dein Name und Discords Einstellungen nicht verdrängt werden.",
            ],
        },
        "1.3.0": {
            added: [
                "**Live-Benachrichtigungen.** Bewertungen, Freigaben, Evi-Updates und Neues von Autoren, denen du folgst, erscheinen beim Eintreffen in der Ecke. Fahre darüber, um sie zu behalten, klicke, um hinzugehen, oder schalte sie im Posteingang aus.",
            ],
            improved: [
                "**Plugins bleiben getrennt.** Ein Plugin kann den Vollzugriff eines anderen nicht nutzen, und eine wiederhergestellte Sicherung fragt, bevor sie ein Plugin mit Vollzugriff einschaltet.",
                "**Nachfragen, wenn es zählt.** Ändert ein Update den Vollzugriffs-Teil eines deiner Plugins, fragt Evi vor der Installation.",
            ],
            fixed: [
                "**Dein Hintergrund bleibt aus deinen Spielen raus.** Das In-Game-Overlay von Discord zeigte ihn über dem ganzen Spiel.",
            ],
        },
        "1.2.0": {
            added: [
                "**Unterstützer-Plugins fallen auf.** Sie sind im Store golden, und ihre Seite bedankt sich bei dir oder zeigt, wie du Unterstützer wirst.",
            ],
            improved: [
                "**Ein Design auf einmal.** Schaltest du ein Design ein, gehen die anderen aus, damit sie sich nicht um Farben streiten.",
                "**Profile bleiben aktuell.** Änderst du deinen Discord-Namen oder dein Avatar, ziehen evi.rest, die Credits und Autorenseiten von selbst nach.",
                "**Buttons wie bei Discord.** Fake Deafen und Game Activity Toggle nutzen Discords eigene Buttons, und Fake Deafen hat einen Geist, damit man ihn nicht mit Ton aus verwechselt.",
                "**Eine ruhigere Store-Startseite.** Neu diese Woche ist weg, und installierte Plugins haben einen Haken neben dem Namen.",
            ],
            fixed: [
                "**Voice Chat Utilities funktioniert wirklich.** Es meldete, Leute verschoben, stummgeschaltet oder getrennt zu haben, aber seine Anfragen kamen nie bei Discord an.",
                "**Keine falschen „kaputt“-Hinweise mehr.** View Icons galt als kaputt, weil ein Teil davon auf den Bildbetrachter wartet.",
                "**Video Controls+ funktioniert im Chat.** Die Steuerung erscheint bei Videos im Chat, nicht nur im Vollbild.",
                "**Plugins stylen sich nicht mehr gegenseitig.** Die Stile von Link Safety wirkten sich auf die Einstellungen von Last Seen aus.",
            ],
        },
        "1.1.2": {
            added: [
                "**Plugins im Chat teilen.** Kopiere den Link eines Plugins auf seiner Store-Seite und füge ihn in einen Discord-Chat ein. Alle mit Evi bekommen eine Karte, um es direkt dort zu installieren.",
                "**Fake Deafen.** Wirke im Sprachkanal taub, während du alle weiter hörst. Ein Dankeschön an Unterstützer.",
                "**Voice Chat Utilities.** Rechtsklick auf einen Sprachkanal, um alle darin zu verschieben, zu trennen, stummzuschalten oder taub zu stellen, wenn du darfst.",
            ],
            fixed: [
                "Das Sortieren deiner Abzeichen wird zuverlässiger gespeichert.",
            ],
        },
        "1.1.1": {
            added: [
                "**Bild bearbeiten, wie bei Discord.** Verschiebe, zoome und drehe deinen Hintergrund in einer Vorschau in der Form deines Fensters.",
                "**Dein Hintergrund auf dem Anmeldebildschirm.** Er erscheint hinter der Anmeldeseite von Discord, das Anmeldefeld milchig darüber.",
                "**Eigene Designs löschen.** Designs, die du selbst erstellt oder hinzugefügt hast, haben jetzt einen Löschen-Button.",
            ],
            improved: [
                "**Einfachere Hintergrund-Einstellungen.** Anzeigen, abdunkeln und festlegen, wie durchsichtig Discord ist. Alles andere steht unter Weitere Optionen.",
                "**Eine neue Unterstützer-Seite.** Deine Stufe, wann die nächste kommt und was du bekommst, unter Konto. Die Credits unter Updates zeigen alle mit Gesicht.",
                "Unterstützer-Abzeichen behalten die Farbe ihrer Stufe: Eigene Abzeichenfarben gibt es nicht mehr.",
            ],
            fixed: [
                "**Der Hintergrund ist wieder zu sehen.** Der eigene Hintergrund von Discord und die Mitgliederliste haben ihn verdeckt.",
                "**Abzeichen neu anordnen speichert wieder.** Discord hat wegen der Evi-Abzeichen das ganze Speichern abgelehnt; jetzt sehen alle deine Reihenfolge.",
            ],
        },
        "1.1.0": {
            added: [
                "**Evi spricht deine Sprache.** Evi, alle Plugins und der Store folgen der Sprache von Discord: Deutsch, Spanisch, Französisch, Japanisch, Polnisch, Portugiesisch, Russisch und Türkisch, dazu Englisch.",
                "**Platziere deinen Hintergrund.** Füllen, Einpassen, Strecken, Zentriert oder Kacheln, dann in einer Live-Vorschau von Discord verschieben und zoomen.",
                "**Wähle, was durchsichtig ist.** Stell ein, wie deckend Serverliste, Kanäle, Chat und Nachrichtenfeld über dem Hintergrund bleiben, und färbe sie in den Farben deines Designs.",
            ],
            improved: [
                "**Discord läuft viel flüssiger.** Evi entfernt eine versteckte Stilregel von Discord, durch die die ganze App bei jeder Änderung neu gestylt wurde, etwa wenn jemand im Anruf spricht: In einem vollen Anruf sank die längste Hängephase von etwa 100 ms auf 15 ms, und die Einstellungen öffnen schneller. Die Schriften von Discord laden jetzt im Hintergrund, damit Text beim ersten Einsatz eines Stils nicht springt.",
                "**Kleinere Updates.** Ab der nächsten Version lädt ein Evi-Update nur noch seine Dateien herunter, ein paar MB statt des ganzen 100-MB-Installers.",
                "**Einstellungen und Pop-ups bleiben deckend.** Der Hintergrund zeigt sich nur hinter dem Hauptfenster von Discord, außer du schaltest ihn auch für Einstellungen oder Pop-ups ein.",
                "**„Quellcode ansehen“ zeigt den echten Code.** Auf der Seite eines Community-Plugins öffnet es genau den Code, den Evi installiert, mit dem Link des Autors daneben.",
            ],
            fixed: [
                "Der Design-Editor behält die Übersetzungen eines Designs, wenn du es speicherst.",
            ],
        },
        "1.0.0": {
            added: [
                "**Eine Startseite für den Store.** Was gerade angesagt ist, was diese Woche neu ist, Empfehlungen und Sammlungen von Evis Team, noch vor der vollständigen Liste.",
                "**Bewertungen und Rezensionen.** Bewerte Plugins, die du nutzt, und begründe es in ein paar Zeilen. Rezensionen, die jemand meldet, gehen an Evis Team.",
                "**Plugin-Seiten zeigen mehr.** Ein Video oder GIF im Einsatz, was Leute, die es nutzen, sonst noch installieren, bekannte Probleme und eine Notiz der Autorin oder des Autors zur Version.",
                "**Eine Wunschliste und ein Postfach.** Markiere alles im Store mit einem Herz, um zu erfahren, wenn es ein Update oder eine Beta bekommt oder wieder funktioniert. Rezensionen deiner Plugins, deine Uploads und Neuigkeiten von Autoren, denen du folgst, landen ebenfalls im neuen Postfach.",
                "**Autoren folgen.** Autorenseiten haben ein Banner, angepinnte Plugins, die Zahl der Nutzer ihrer Plugins und einen Folgen-Button.",
                "**Plugin-Betas.** Autoren können neben der stabilen Version eine Beta veröffentlichen, und du kannst dich auf der Seite jedes Plugins für dessen Betas anmelden.",
                "**Dynamischer Hintergrund.** Ein Bild oder Video hinter Discord, abgedunkelt, damit Text lesbar bleibt, und im Akkubetrieb pausiert.",
                "**Crash Detective.** Wenn Discord abstürzt oder hängt, sagt Evi, welches Plugin kurz davor am meisten zu tun hatte, und bietet an, es auszuschalten.",
                "**Updates im Hintergrund.** Aktiviere es unter Updates: Neue Versionen laden sich von selbst herunter und werden installiert, wenn du Discord schließt.",
                "**Tastenkürzel für Plugins.** Lege eines in den Einstellungen eines Plugins fest, indem du die Tasten drückst, wie bei Discords Tastenkombinationen. Streamer Mode+ und Game Activity Toggle haben eines, und das Feld sagt dir, wenn zwei Plugins dieselben Tasten wollen.",
                "**Vorteile für Unterstützer.** Dein Unterstützer-Badge in einer Farbe deiner Wahl, auf Wunsch dein Name im Abspann und Aurora, ein Theme für Unterstützer.",
                "**Who Reacted.** Kleine Avatare der Leute, die reagiert haben, direkt an jeder Reaktion neben der Anzahl.",
                "**Typing Tweaks.** Sieh auf einen Blick, wer tippt: Avatare und Rollenfarben in der Zeile „schreibt gerade“ und drei Punkte an Kanälen und DMs, während dort jemand tippt.",
                "**Für Plugin-Autoren:** Evi DevTools (Flux-Events live, Stores, Patch-Treffer und Zeiten), API-Doku beim Hovern im Patch Helper, ein öffentliches Changelog der Plugin-API, anonyme Installations- und Absturzzahlen im Dashboard sowie `bun run new-plugin` / `bun run preview-plugin`, um ein Plugin zu starten und zu prüfen.",
            ],
            improved: [
                "**Die Suche findet Einstellungen, nicht nur Plugins.** Die Suche im Plugins-Tab durchsucht jetzt auch die Einstellungen aller Plugins, und ein Treffer bringt dich direkt zur Einstellung.",
                "**Zeige nur, was du noch nicht hast,** mit dem neuen Filter „Nicht installiert“ im Store, und sortiere nach Bewertung oder Trend.",
                "Streamer Mode+ behält das Kürzel, das du eingegeben hast, jetzt als aufgezeichnetes Kürzel.",
                "Plugin-Autoren sehen, wie viele ihre Plugins nutzen: Einmal am Tag meldet Evi anonym an evi.rest, welche Store-Plugins installiert sind. Du kannst das in den Store-Einstellungen ausschalten.",
                "Quick Actions ist nicht mehr Teil von Evi und wird beim Update von Evi entfernt.",
                "**View Icons ist in die Profile gezogen.** Klicke auf jemandes Banner, um es wie den Avatar in voller Größe zu öffnen, und Herunterladen steht neben dem Zoom. Die Einträge im Rechtsklick-Menü sind weg.",
            ],
            fixed: [
                "**Message Logger behält gelöschte Bilder, Videos und Dateien.** Discord löscht sie mit der Nachricht von seinen Servern, deshalb wurden sie bisher kaputt angezeigt. Auch bei Bearbeitungen, die einen Anhang entfernen, bleibt er bei der alten Version erhalten.",
            ],
        },
        "0.7.0": {
            added: [
                "**Plugins sagen, was sie brauchen, und Evi hält sie daran.** Welche Seiten ein Plugin kontaktiert und ob es deine Nachrichten liest, Nachrichten sendet oder deine Einstellungen ändert. Alles andere, was es über Evi versucht, blockiert Evi, und Blockiertes erscheint in der Aktivität des Plugins.",
                "**Evi repariert Plugins, die Discord kaputt macht, ohne auf ein Update zu warten.** Wenn ein Discord-Update ein Plugin kaputt macht, repariert Evis Team es auf evi.rest, und jede Installation übernimmt die Korrektur innerhalb von Minuten. In den Details des Plugins steht, was behoben wurde.",
                "**Erstelle dein eigenes Theme.** Wähle Farben im neuen Editor-Tab, sieh zu, wie sich Discord währenddessen verändert, und speichere es dann als eigenes Theme.",
                "**Community-Themes.** Sende ein Theme aus dem Editor oder deinem Dashboard an den Theme Store. Evis Team prüft jedes einzelne, und Community-Themes können nichts aus dem Internet laden, sodass niemand erfährt, wer sie nutzt.",
                "**DM Categories.** Sortiere deine DMs in einklappbare Kategorien wie Freunde, Arbeit oder Gaming, oben in deiner DM-Liste. Rechtsklicke auf eine DM, um sie einer Kategorie hinzuzufügen.",
                "**View Icons.** Rechtsklicke auf jemanden für Avatar und Banner in voller Größe oder auf einen Server für Icon und Banner, in Discords Bildbetrachter. Lade das Original herunter oder kopiere den Link.",
                "**Calm Name Effects.** Das Öffnen eines Chats braucht nur halb so viel Aufwand: Nitro-Namensstile wie Prism und Neon werden animiert, solange du über einen Namen fährst, statt bei jeder Nachricht gleichzeitig.",
            ],
            improved: [
                "**Ein Update, das mehr verlangt, wartet auf dein OK,** wie beim Vollzugriff. Store-Seiten, Installationsfragen und Plugin-Details listen auf, was jedes Plugin verlangt, und ältere Plugins ohne Angaben sind gekennzeichnet.",
                "**Der Store weiß, wenn eine Korrektur wirkt.** Ein von Evi repariertes Plugin wird als repariert statt als defekt angezeigt und gilt nur dann wieder als defekt, wenn Installationen mit der Korrektur weiterhin Probleme haben.",
                "Themes im Store können wie Plugins gemeldet werden.",
            ],
            fixed: [
                "Das Symbol von Platform Indicators wächst nicht mehr auf eine ganze Nachricht an, wenn Evis Styles nicht greifen, etwa in ausgekoppelten Chats.",
            ],
        },
        "0.6.1": {
            fixed: [
                "**Smooth Typing bringt keine gerade gesendete Nachricht mehr zurück** ins Textfeld. Auch beim Kanalwechsel und bei Slash-Befehlen bleibt das Feld aktuell.",
                "Ein Plugin, das Evi ausgeschaltet hat oder bei dem ein Problem zu erklären ist, behält in der Plugin-Liste seine Kartengröße, statt sich über die ganze Breite zu strecken.",
            ],
        },
        "0.6.0": {
            improved: [
                "**Kein Ruckeln mehr durch Evi.** Das Finden von Discords Bauteilen durchsuchte früher den gesamten Discord-Code, jeweils 10 bis 20 ms lang, und ein fehlendes Teil wurde jede Sekunde erneut gesucht. Jetzt wird es einmal gefunden, und jeder spätere Zugriff ist sofort da.",
                "**Plugins erledigen ihre schwere Arbeit in kleinen Häppchen** zwischen allem anderen: Fast Lists, Read All, GIF Folders und das Speichern von Last Seen halten Discord nicht mehr auf.",
                "**Show Hidden Channels merkt sich, wer was sehen kann,** statt bei jedem Neuzeichnen für jeden Kanal erneut zu fragen.",
                "**Schneller: Message Logger, Inline Translate, Platform Indicators, Voice Activity Log, Relationship Notifier, Hide Blocked, Timezones, Friend Online Alerts, Streamer Mode+, Silent Typing und Snippets.**",
                "Die Plugin-Gesundheitsprüfung im Hintergrund ist deutlich leichter.",
            ],
            fixed: [
                "**Ein Plugin, das Evi überall ausschaltet, ist innerhalb von Sekunden aus,** mit Hinweis, statt erst bei der nächsten halbstündlichen Prüfung oder beim Neustart.",
            ],
        },
        "0.5.3": {
            fixed: [
                "Das Plugin-Autor-Badge öffnet beim Anklicken seine Details und lässt sich unter „Badges anpassen“ ausblenden und verschieben.",
            ],
        },
        "0.5.2": {
            improved: [
                "**Update-Prüfungen laufen über evi.rest,** sodass ein ausgelastetes Netzwerk nicht mehr an GitHubs Limit stößt und meldet, Evi könne nicht nach Updates suchen.",
                "**Die Installation eines Plugins mit Vollzugriff fragt in einem Dialog nach,** statt in einem Kasten, der in die Karte gequetscht ist.",
                "**Symbole an jedem Tab,** damit man Installiert und Store auf einen Blick unterscheidet.",
                "**Jede Version bekommt ihr gepunktetes Cover** in „Neuigkeiten“.",
            ],
            fixed: [
                "Das Öffnen des Stores scrollt Discords Einstellungen nicht mehr ein Stück nach unten.",
            ],
        },
        "0.5.1": {
            added: [
                "**Community-Plugins mit nativem Teil.** Autoren können ihrem Plugin eine native.js beilegen. Evis Team liest alles, bevor es aufgenommen wird, und Evi fragt dich weiterhin, bevor etwas mit Vollzugriff installiert wird.",
            ],
            fixed: [
                "Das Öffnen von Evis Seiten in Discords Einstellungen bringt Discord nicht mehr zum Absturz.",
            ],
        },
        "0.5.0": {
            added: [
                "**Evi Setup.** Ein kleines Installationsprogramm mit Fenster: Wähle dein Discord und klicke auf Evi installieren oder Evi deinstallieren. Es prüft zuerst auf ein neueres Evi und lädt es herunter, daher sind es nur wenige MB statt über 100.",
                "**Evi in deiner Sprache.** Evis Menüs folgen Discords Sprache: Spanisch, Portugiesisch, Französisch, Deutsch, Türkisch, Russisch, Polnisch und Japanisch. Auch Plugins können übersetzt werden.",
                "**Sieh, was ein Plugin getan hat.** Die Details eines Plugins listen die Seiten auf, die es kontaktiert hat, und wann, und weisen auf solche hin, die sein Code nie erwähnt.",
                "**Beta-Versionen.** Aktiviere unter Updates „Beta-Versionen erhalten“, um neue Evi-Versionen ein paar Tage früher zu bekommen.",
                "**Plugin-Autor-Badge.** Alle, deren Plugin es in den Store schafft, bekommen es auf ihrem Profil.",
            ],
            improved: [
                "Das Ein- oder Ausschalten eines Plugins lässt Discord nicht mehr kurz einfrieren.",
                "**Unterstützerstufen gibt es monatlich.** Ein neues Badge jeden Monat für deine ersten sechs Monate, von Silver nach einem Monat bis Ruby nach sechs, dann Prismatic nach einem Jahr.",
            ],
            fixed: [
                "Ein Klick auf den Schalter eines Plugins scrollt Discords Einstellungen nicht mehr davon weg.",
            ],
        },
        "0.4.0": {
            added: [
                "**Community-Plugins im Store.** Plugin-Autoren können ihre Plugins jetzt selbst auf evi.rest veröffentlichen. Evis Team liest jede Version, bevor sie aufgenommen wird, und Community-Plugins sind gekennzeichnet, damit du immer weißt, wer was gemacht hat.",
                "**Verifizierte Autoren.** Jedes Plugin zeigt, wer es gemacht hat, mit einem Häkchen für verifizierte Autoren. Klicke auf einen Namen, um weitere Plugins zu sehen.",
                "**Einen Absturzbericht an den Autor senden.** Neben „Absturzbericht kopieren“. Du siehst genau, was gesendet wird, bevor es rausgeht, und nichts Persönliches ist darin enthalten.",
                "**Erfahre, wenn ein Plugin defekt ist.** Wenn ein Plugin nach einem Discord-Update bei vielen Leuten nicht mehr funktioniert, sagen das der Store und deine Plugin-Liste, oft mit einer Notiz des Autors zur Korrektur.",
                "**Ein Plugin melden.** Etwas Schädliches, Gefälschtes oder Defektes? Melde es auf seiner Store-Seite. Meldungen gehen an Evis Team.",
                "**Evi kann ein schlechtes Plugin überall ausschalten.** Wenn sich ein Plugin als schädlich herausstellt, schaltet Evi es auf jeder Installation ab und sagt dir, warum.",
            ],
            improved: [
                "**Neuigkeiten, die nach Evi aussehen.** Das Cover der Version oben und jede Art von Änderung unter ihrem eigenen Label.",
                "**Pop-ups warten auf Discord.** Neuigkeiten, Plugin-Changelogs und der Update-Hinweis erscheinen, sobald Discord geladen ist, nicht über dem Ladebildschirm.",
                "**Unterstützer-Badges steigen schneller auf.** Prismatic gibt es jetzt nach einem Jahr Unterstützung statt nach fünf.",
                "**Plugin-Badges unter „Deine Badges“.** Badges, die Plugins zu Profilen hinzufügen, wie die Uhr von Last Seen und das Gerät von Platform Indicators, stehen auch in Discords Badge-Verzeichnis.",
                "**Sicherer von Grund auf.** Das Einschalten eines Plugins mit Vollzugriff auf deinen Computer fragt immer in einem Systemdialog nach, den kein Plugin für dich beantworten kann.",
            ],
            fixed: [
                "Die Installation eines Plugins aus dem Store schaltet es immer ein. Früher hieß es, es sei eingeschaltet, und manchmal stimmte das nicht.",
                "Dropdowns in den Einstellungen eines Plugins öffnen sich beim ersten Klick. In Discords Einstellungen schlossen sie sich oft sofort wieder.",
            ],
        },
        "0.3.2": {
            improved: [
                "**Dialoge und Menüs bewegen sich wie bei Discord.** Evis Dialoge, Hinweise und Plugin-Menüs öffnen sich jetzt federnd und blenden aus, statt aufzuploppen und zu verschwinden.",
                "**Ein aufgeräumteres Voice Activity Log** mit nach Kanal aufgelisteten Sitzungen und einem richtigen Suchfeld.",
            ],
        },
        "0.3.1": {
            added: [
                "**Evi auf macOS und Linux.** Lade das Installationsprogramm für dein System aus dem Release herunter und führe `evi install` aus. Unter Linux führst du es mit sudo aus.",
            ],
        },
        "0.3.0": {
            added: [
                "**Evi-Badges sind Teil von Evi.** Sie erscheinen auf den Profilen aller, die Evi nutzen, und lassen sich nicht versehentlich ausschalten.",
                "**Blende deine Evi-Badges aus und ordne sie neu an** in Discords eigenem „Badges anpassen“. Alle sehen die Änderung innerhalb von Sekunden.",
                "**Unterstützer-Badges, die aufsteigen.** Von Bronze bis Prismatic, je länger du Evi unterstützt, mit deinem Fortschritt unter „Deine Badges“.",
                "**Evi direkt in der App aktualisieren.** Evi sagt Bescheid, wenn eine neue Version da ist, und ein Klick installiert sie.",
            ],
            improved: [
                "Badges aktualisieren sich live statt alle halbe Stunde.",
                "Jedes Plugin lässt sich entfernen, auch die, die mit Evi kommen, und sie bleiben auch nach Evi-Updates entfernt.",
            ],
        },
        "0.2.0": {
            added: [
                "**Der Plugin Store ist jetzt im Plugins-Tab.** Jedes Plugin hat eine eigene Seite mit Screenshots, Changelog, Quellcode und den Zugriffen, die es hat.",
                "**Theme Store.** Installiere und aktualisiere Themes direkt im Themes-Tab.",
                "**Alles aktualisieren und auf Wunsch automatische Updates.** Plugins mit Vollzugriff auf deinen Computer fragen weiterhin vorher nach.",
                "**Absturzberichte.** Bei einem Plugin, das nicht startet, gibt es für den Autor eine Schaltfläche „Absturzbericht kopieren“.",
            ],
            improved: [
                "Durchstöbere den Store nach Kategorie und sortiere ihn nach Name oder zuletzt aktualisiert.",
                "Aktualisiere und deinstalliere Store-Plugins direkt in der Plugin-Liste.",
                "Schalte alle Plugins mit einem Klick aus oder setze sie auf ihre Standardwerte zurück, mit Rückgängig-Option.",
            ],
        },
        "0.1.0": {
            added: ["**Erste Version.** Plugins, Themes, Quick CSS, Backups, abgesicherter Modus und der Plugin Store."],
        },
    },
    es: {
        "2.2.0": {
            fixed: [
                "**Las actualizaciones siguen tus ajustes.** Cuando el equipo de Evi dice que hace falta una actualización, Evi solo la descarga y reinicia Discord por su cuenta si tienes las actualizaciones automáticas activadas. Si no, te avisa y espera a que pulses Actualizar ahora. Los plugins solo se actualizan con ella si tienes activada la actualización automática de plugins.",
            ],
        },
        "2.1.0": {
            added: [
                "**Memoria en la pestaña Rendimiento.** Mira cuánto usa Discord y, si quieres, deja que Evi lo reinicie cuando use demasiada mientras no estás. Nunca durante una llamada, y como mucho una vez al día.",
                "**Modo juego.** El modo juego oculto del propio Discord, como interruptor en la pestaña Rendimiento: mientras juegas, Discord va más lento en segundo plano y detiene los GIF. Se queda apagado durante las llamadas.",
            ],
            improved: [
                "**Arranca más rápido.** Evi recuerda dónde se enganchan los plugins en Discord, así que desde el segundo arranque de una versión de Discord está listo unas cuatro veces más rápido con muchos plugins. Los plugins que tienes apagados no se cargan hasta que los enciendes.",
                "**Más ligero mientras lo usas.** Los puntos de escritura ya no se redibujan con JavaScript en cada fotograma, los botones de llamada dejan de desenfocar una y otra vez el vídeo de detrás, y cuando Discord lleva 10 minutos oculto, Evi vacía sus cachés de imágenes (nunca durante una llamada).",
            ],
            fixed: [
                "**Los ajustes de Chromium de los plugins se mantienen.** Discord los sobrescribía sin avisar al arrancar.",
            ],
        },
        "2.0.0": {
            added: [
                "**Doce plugins nuevos.** Desktop Voice Messages, Embed Builder con Components V2, Audit Log Plus, Role Colours Everywhere, Rich Presence Builder, Search Highlight, Click Actions, Soundboard Stealer, Quick Markup, Fix Embeds, Code Block Tools y Hover Converter. Todos en la tienda, todos desactivados hasta que los actives.",
                "**Un recorrido por las novedades.** La primera vez que se inicia 2.0, te muestra los plugins nuevos y activa los que elijas.",
                "**Publica tus propios plugins.** Un botón en la página de Plugins abre tu panel de autor: instalaciones, usuarios activos, valoraciones, reseñas y cómo trata cada build de Discord a tus plugins.",
            ],
            improved: [
                "**Los menús se ven como los de Discord.** Cada desplegable de Evi y sus plugins se abre como en Discord, sin barra de desplazamiento y con filtro para listas largas.",
                "**De vuelta a donde estabas.** Al volver desde un plugin en la tienda, regresas a la misma página, filtros y posición.",
                "**Las actualizaciones importantes llegan antes.** Cuando hace falta una actualización, Evi la descarga al momento y reinicia Discord cuando no estás en una llamada.",
            ],
            fixed: [
                "**Los plugins ya no aparecen como rotos sin motivo.** Un plugin que esperaba una parte de Discord que aún no se había abierto se marcaba como roto.",
                "**Los diálogos se abren arriba.** Algunos se abrían desplazados hasta la mitad dentro de los ajustes de Discord.",
            ],
        },
        "1.5.0": {
            added: [
                "**Noticias del equipo de Evi, en directo.** Los anuncios aparecen arriba en tu pantalla segundos después de enviarse y se quedan hasta que los cierras.",
            ],
            fixed: [
                "**Las notificaciones de los plugins vuelven a verse.** Discord cambió hoy cómo muestra sus avisos emergentes y los de los plugins dejaron de aparecer.",
            ],
        },
        "1.4.3": {
            fixed: [
                "**Tu tema de color de Discord ya no se mezcla con el de Evi.** Con un tema de Evi, las partes que no colorea (como el pie de un diálogo) mostraban el tinte de tu tema de Discord.",
                "**Sin franja bajo los diálogos con fondo de pantalla.** El pie de los diálogos dejaba ver el fondo dos veces, de otro color.",
            ],
        },
        "1.4.2": {
            improved: [
                "**El modo seguro lo decides tú.** En General → Actualizaciones está «Activar el modo seguro solo»: desactivado, los fallos nunca lo activan.",
            ],
            fixed: [
                "**Nada de Evi sobre tus juegos.** El modo seguro y otros avisos aparecían en la superposición de Discord en el juego, donde no se podían cerrar, y que un juego cerrara la superposición contaba como un fallo de Discord.",
            ],
        },
        "1.4.1": {
            added: [
                "**Evi Setup para macOS y Linux.** Instala, actualiza y quita Evi desde una ventana en cualquier sistema, sin terminal. En Linux pide tu contraseña cuando la carpeta de Discord lo necesita, y en macOS y Linux vuelve a poner Evi por sí solo tras las actualizaciones de Discord.",
            ],
        },
        "1.4.0": {
            added: [
                "**Spotify Player en la tienda.** Un pequeño reproductor sobre tu panel de usuario con la canción, su portada, reproducir y pausar, anterior y siguiente, y en qué parte vas.",
            ],
            improved: [
                "**La búsqueda de la tienda entiende lo que buscas.** Cuenta cada palabra, en cualquier orden, perdona las erratas, muestra primero la mejor coincidencia, y el nombre en inglés de un plugin lo encuentra en cualquier idioma.",
            ],
            fixed: [
                "**Las actualizaciones siguen funcionando** con versiones que ya no incluyen el instalador de línea de comandos.",
            ],
        },
        "1.3.1": {
            fixed: [
                "**El panel de usuario conserva su espacio.** Con Game Activity Toggle y Fake Deafen activados, sus interruptores comparten un botón de Evi con menú, así tu nombre y el engranaje de ajustes de Discord no quedan fuera.",
            ],
        },
        "1.3.0": {
            added: [
                "**Notificaciones en vivo.** Reseñas, aprobaciones, actualizaciones de Evi y novedades de autores que sigues aparecen en la esquina al llegar. Pasa el cursor para mantenerlas, haz clic para ir o desactívalas en la bandeja.",
            ],
            improved: [
                "**Plugins separados.** Un plugin no puede usar el acceso total de otro, y restaurar una copia pregunta antes de activar un plugin con acceso total.",
                "**Pregunta cuando importa.** Si una actualización cambia la parte con acceso total de un plugin que tienes, Evi pregunta antes de instalarla.",
            ],
            fixed: [
                "**Tu fondo ya no aparece en tus juegos.** El overlay de juego de Discord lo mostraba sobre todo el juego.",
            ],
        },
        "1.2.0": {
            added: [
                "**Los plugins para quienes apoyan destacan.** Son dorados en la tienda, y su página te da las gracias o te muestra cómo apoyar.",
            ],
            improved: [
                "**Un tema a la vez.** Al activar un tema se desactivan los demás, así no se pelean por los colores.",
                "**Los perfiles se mantienen al día.** Cambia tu nombre o avatar de Discord y evi.rest, los créditos y las páginas de autor se actualizan solos.",
                "**Botones como los de Discord.** Fake Deafen y Game Activity Toggle usan los botones propios de Discord, y Fake Deafen tiene un fantasma para no confundirlo con ensordecer.",
                "**Una portada de la tienda más tranquila.** Ya no está Novedades de la semana, y los plugins instalados llevan una marca junto al nombre.",
            ],
            fixed: [
                "**Voice Chat Utilities funciona de verdad.** Decía que movía, silenciaba o desconectaba a la gente, pero sus peticiones nunca llegaban a Discord.",
                "**Se acabaron los avisos falsos de «roto».** View Icons aparecía roto porque una parte espera a que se abra el visor de imágenes.",
                "**Video Controls+ funciona en el chat.** Sus controles aparecen en los vídeos del chat, no solo en pantalla completa.",
                "**Los plugins ya no se cambian el estilo entre sí.** Los estilos de Link Safety se colaban en los ajustes de Last Seen.",
            ],
        },
        "1.1.2": {
            added: [
                "**Comparte plugins en el chat.** Copia el enlace de un plugin desde su página en la tienda y pégalo en cualquier chat de Discord. Quien tenga Evi verá una tarjeta para instalarlo ahí mismo.",
                "**Ensordecido falso.** Aparece ensordecido en voz mientras sigues oyendo a todos. Un agradecimiento para quienes apoyan.",
                "**Voice Chat Utilities.** Haz clic derecho en un canal de voz para mover, desconectar, silenciar o ensordecer a todos, si tienes permiso.",
            ],
            fixed: [
                "El orden de tus insignias se guarda de forma más fiable.",
            ],
        },
        "1.1.1": {
            added: [
                "**Editar imagen, como en Discord.** Arrastra, haz zoom y gira tu fondo en una vista previa con la forma de tu ventana.",
                "**Tu fondo en la pantalla de inicio de sesión.** Aparece detrás de la página de inicio de sesión de Discord, con el cuadro esmerilado encima.",
                "**Borra los temas que hiciste.** Los temas que creaste o añadiste tú tienen ahora un botón para borrarlos.",
            ],
            improved: [
                "**Ajustes de fondo más sencillos.** Muéstralo, oscurécelo y elige qué tan transparente es Discord. Todo lo demás está en Más opciones.",
                "**Una nueva página para colaboradores.** Tu nivel, cuándo llega el siguiente y lo que tienes, en Cuenta. Los créditos en Actualizaciones muestran la cara de todos.",
                "Las insignias de colaborador mantienen el color de su nivel: ya no hay colores personalizados.",
            ],
            fixed: [
                "**El fondo vuelve a verse.** El fondo propio de Discord y la lista de miembros lo tapaban.",
                "**Reordenar tus insignias vuelve a guardarse.** Discord rechazaba todo el guardado por las insignias de Evi; ahora tu orden le llega a todos.",
            ],
        },
        "1.1.0": {
            added: [
                "**Evi habla tu idioma.** Evi, todos los plugins y la tienda siguen el idioma de Discord: alemán, español, francés, japonés, polaco, portugués, ruso y turco, además de inglés.",
                "**Coloca tu fondo.** Rellenar, Ajustar, Estirar, Centrar o Mosaico, y luego arrástralo y haz zoom en una vista previa de Discord en vivo.",
                "**Elige qué es transparente.** Ajusta qué tan opacos quedan la lista de servidores, los canales, el chat y el cuadro de mensaje sobre el fondo, y tíñelos con los colores de tu tema.",
            ],
            improved: [
                "**Discord va mucho más fluido.** Evi quita una regla de estilo oculta de Discord que hacía que toda la app se volviera a dibujar con cualquier cambio, como alguien hablando en una llamada: en una llamada concurrida el bloqueo más largo pasó de unos 100 ms a 15 ms, y los ajustes se abren más rápido. Las fuentes de Discord también se cargan en segundo plano, así que el texto no salta la primera vez que se usa un estilo.",
                "**Actualizaciones más pequeñas.** A partir de la próxima versión, actualizar Evi descarga solo sus archivos, unos pocos MB, en vez del instalador completo de 100 MB.",
                "**Los ajustes y las ventanas emergentes siguen opacos.** El fondo solo se ve detrás de la ventana principal de Discord, salvo que lo actives también para ajustes o ventanas emergentes.",
                "**Ver código fuente muestra el código real.** En la página de un plugin de la comunidad abre exactamente el código que Evi instala, con el enlace del autor al lado.",
            ],
            fixed: [
                "El editor de temas conserva las traducciones de un tema al guardarlo.",
            ],
        },
        "1.0.0": {
            added: [
                "**Una portada para la tienda.** Lo que es tendencia, lo nuevo de esta semana, selecciones del equipo y colecciones preparadas por el equipo de Evi, antes de la lista completa.",
                "**Valoraciones y reseñas.** Valora los plugins que usas y cuenta por qué en unas pocas líneas. Las reseñas que alguien denuncie llegan al equipo de Evi.",
                "**Las páginas de los plugins muestran más.** Un vídeo o GIF de cómo se usa, qué otros plugins instalan quienes lo usan, problemas conocidos y una nota del autor sobre la versión.",
                "**Una lista de deseos y una bandeja de entrada.** Marca con un corazón lo que quieras de la tienda para enterarte cuando se actualice, tenga una beta o vuelva a funcionar. Las reseñas de tus plugins, tus subidas y las novedades de los autores a los que sigues llegan también a la nueva Bandeja de entrada.",
                "**Sigue a autores.** Las páginas de autor tienen un banner, plugins fijados, cuánta gente usa sus plugins y un botón de Seguir.",
                "**Betas de plugins.** Los autores pueden publicar una beta junto a la versión estable, y tú puedes apuntarte a las betas de cualquier plugin desde su página.",
                "**Fondo de pantalla dinámico.** Una imagen o un vídeo detrás de Discord, atenuado para que el texto se lea bien y en pausa cuando funciona con batería.",
                "**Crash Detective.** Cuando Discord se cierra o se congela, Evi te dice qué plugin estaba más ocupado justo antes y te ofrece desactivarlo.",
                "**Actualizaciones en segundo plano.** Actívalo en Actualizaciones y las versiones nuevas se descargan solas y se instalan al cerrar Discord.",
                "**Atajos de teclado para plugins.** Configura uno en los ajustes de un plugin pulsando las teclas, como los atajos de Discord. Streamer Mode+ y Game Activity Toggle tienen uno, y el campo avisa cuando dos plugins quieren las mismas teclas.",
                "**Ventajas para quienes apoyan.** Tu insignia de colaborador en el color que quieras, tu nombre en los créditos si te apetece y Aurora, un tema para colaboradores.",
                "**Who Reacted.** Pequeños avatares de quienes han reaccionado, justo en cada reacción junto al contador.",
                "**Typing Tweaks.** Mira de un vistazo quién está escribiendo: avatares y colores de rol en la línea de «está escribiendo» y tres puntos en los canales y MD mientras alguien escribe allí.",
                "**Para autores de plugins:** Evi DevTools (eventos de Flux en directo, stores, patches aplicados y tiempos), documentación de la API al pasar el ratón en el Patch Helper, un registro de cambios público de la API de plugins, cifras anónimas de instalaciones y fallos en tu panel, y `bun run new-plugin` / `bun run preview-plugin` para empezar y revisar un plugin.",
            ],
            improved: [
                "**La búsqueda encuentra ajustes, no solo plugins.** Al buscar en la pestaña Plugins se revisan también los ajustes de todos los plugins, y al abrir uno desde los resultados llegas directo al ajuste.",
                "**Muestra solo lo que aún no tienes** con el nuevo filtro No instalados de la tienda, y ordena por valoración o tendencia.",
                "Streamer Mode+ conserva el atajo que habías escrito, ahora como atajo grabado.",
                "Los autores de plugins ven cuánta gente usa sus plugins: una vez al día Evi le dice a evi.rest, de forma anónima, qué plugins de la tienda tiene. Puedes desactivarlo en los ajustes de la tienda.",
                "Quick Actions ya no forma parte de Evi y se elimina cuando Evi se actualiza.",
                "**View Icons pasa a los perfiles.** Haz clic en el banner de alguien para abrirlo a tamaño completo como su avatar, y Descargar está junto al zoom. Los elementos del menú contextual han desaparecido.",
            ],
            fixed: [
                "**Message Logger conserva las imágenes, vídeos y archivos eliminados.** Discord los borra de sus servidores junto con el mensaje, así que antes se veían rotos. Las ediciones que quitan un adjunto también lo conservan en la versión anterior.",
            ],
        },
        "0.7.0": {
            added: [
                "**Los plugins dicen qué necesitan y Evi se lo exige.** A qué sitios se conecta un plugin y si lee tus mensajes, envía mensajes o cambia tus ajustes. Evi bloquea el resto de lo que intente a través de Evi, y lo bloqueado aparece en la Actividad del plugin.",
                "**Evi arregla los plugins que Discord rompe, sin esperar a una actualización.** Cuando una actualización de Discord rompe un plugin, el equipo de Evi lo repara en evi.rest y todas las instalaciones reciben el arreglo en minutos. Los detalles del plugin dicen qué se corrigió.",
                "**Crea tu propio tema.** Elige colores en la nueva pestaña Editor, mira cómo cambia Discord mientras tanto y guárdalo como un tema tuyo.",
                "**Temas de la comunidad.** Envía un tema a la Tienda de temas desde el editor o tu panel. El equipo de Evi revisa cada uno, y los temas de la comunidad no pueden cargar nada de internet, así que nadie sabe quién los usa.",
                "**DM Categories.** Ordena tus MD en categorías plegables como Amigos, Trabajo o Juegos, en la parte superior de tu lista de MD. Haz clic derecho en un MD para añadirlo a una.",
                "**View Icons.** Haz clic derecho en alguien para ver su avatar y banner a tamaño completo, o en un servidor para ver su icono y banner, en el visor de imágenes de Discord. Descarga el original o copia su enlace.",
                "**Calm Name Effects.** Abrir un chat cuesta la mitad: los estilos de nombre de Nitro como Prism y Neon se animan mientras pasas el ratón por un nombre, en lugar de en todos los mensajes a la vez.",
            ],
            improved: [
                "**Una actualización que pide más espera tu OK,** como el acceso completo. Las páginas de la tienda, las preguntas de instalación y los detalles de los plugins enumeran lo que pide cada plugin, y los plugins antiguos que no lo indican están marcados.",
                "**La tienda sabe cuándo un arreglo funciona.** Un plugin que Evi arregló aparece como arreglado en lugar de roto, y solo vuelve a roto si las instalaciones con el arreglo siguen teniendo problemas.",
                "Los temas de la tienda se pueden denunciar, igual que los plugins.",
            ],
            fixed: [
                "El icono de Platform Indicators ya no crece hasta ocupar un mensaje entero en lugares a los que no llegan los estilos de Evi, como los chats en ventana emergente.",
            ],
        },
        "0.6.1": {
            fixed: [
                "**Smooth Typing ya no devuelve al cuadro de texto un mensaje que acabas de enviar.** Cambiar de canal y usar comandos de barra también mantienen el cuadro al día.",
                "Un plugin que Evi desactivó, o que tiene un problema que explicar, mantiene el tamaño de su tarjeta en la lista de Plugins en lugar de estirarse a todo el ancho.",
            ],
        },
        "0.6.0": {
            improved: [
                "**Se acabaron los tirones por culpa de Evi.** Buscar las piezas de Discord antes recorría todo el código de Discord, entre 10 y 20 ms cada vez, y una pieza que faltaba se volvía a buscar cada segundo. Ahora se encuentra una vez y cualquier búsqueda posterior es instantánea.",
                "**Los plugins hacen su trabajo pesado en trozos pequeños,** entre todo lo demás: Fast Lists, Read All, GIF Folders y el guardado de Last Seen ya no frenan a Discord.",
                "**Show Hidden Channels recuerda quién puede ver qué,** en lugar de volver a preguntarlo por cada canal en cada redibujado.",
                "**Más rápidos: Message Logger, Inline Translate, Platform Indicators, Voice Activity Log, Relationship Notifier, Hide Blocked, Timezones, Friend Online Alerts, Streamer Mode+, Silent Typing y Snippets.**",
                "La comprobación de estado de los plugins en segundo plano es mucho más ligera.",
            ],
            fixed: [
                "**Un plugin que Evi desactiva en todas partes se apaga en cuestión de segundos,** con un aviso, en lugar de en la siguiente comprobación de media hora o al reiniciar.",
            ],
        },
        "0.5.3": {
            fixed: [
                "La insignia de Plugin Author abre sus detalles al hacer clic y se puede ocultar y mover en Personaliza tus insignias.",
            ],
        },
        "0.5.2": {
            improved: [
                "**Las comprobaciones de actualizaciones pasan por evi.rest,** así que una red saturada ya no choca con el límite de GitHub ni dice que Evi no puede buscar actualizaciones.",
                "**Instalar un plugin con acceso completo pregunta en un cuadro de diálogo,** en lugar de en un recuadro apretado dentro de su tarjeta.",
                "**Iconos en cada pestaña,** para distinguir Instalados y Tienda de un vistazo.",
                "**Todas las versiones tienen su portada de puntos** en Novedades.",
            ],
            fixed: [
                "Abrir la Tienda ya no desplaza un poco hacia abajo los ajustes de Discord.",
            ],
        },
        "0.5.1": {
            added: [
                "**Plugins de la comunidad con una parte nativa.** Los autores pueden enviar un native.js con su plugin. El equipo de Evi lo lee todo antes de que entre, y Evi sigue preguntándote antes de instalar algo con acceso completo.",
            ],
            fixed: [
                "Abrir las páginas de Evi en los ajustes de Discord ya no cierra Discord de golpe.",
            ],
        },
        "0.5.0": {
            added: [
                "**Evi Setup.** Un pequeño instalador con ventana: elige tu Discord y haz clic en Instalar Evi o Desinstalar Evi. Primero busca una versión más reciente de Evi y la descarga, así que pesa unos pocos MB en lugar de más de 100.",
                "**Evi en tu idioma.** Los menús de Evi siguen el idioma de Discord: español, portugués, francés, alemán, turco, ruso, polaco y japonés. Los plugins también se pueden traducir.",
                "**Mira lo que hizo un plugin.** Los detalles de un plugin enumeran los sitios con los que contactó y cuándo, y señalan los que su código nunca menciona.",
                "**Versiones beta.** Activa Recibir versiones beta en Actualizaciones para obtener las nuevas versiones de Evi unos días antes.",
                "**Insignia de Plugin Author.** Cualquiera cuyo plugin llegue a la tienda la recibe en su perfil.",
            ],
            improved: [
                "Activar o desactivar un plugin ya no congela Discord por un momento.",
                "**Los niveles de colaborador llegan cada mes.** Una insignia nueva cada mes durante los primeros seis meses, de Silver al mes a Ruby a los seis, y luego Prismatic al año.",
            ],
            fixed: [
                "Hacer clic en el interruptor de un plugin ya no desplaza los ajustes de Discord lejos de él.",
            ],
        },
        "0.4.0": {
            added: [
                "**Plugins de la comunidad en la tienda.** Los autores de plugins ya pueden publicar sus propios plugins en evi.rest. El equipo de Evi lee cada versión antes de que entre, y los plugins de la comunidad están etiquetados para que siempre sepas quién hizo qué.",
                "**Autores verificados.** Cada plugin muestra quién lo hizo, con una marca de verificación para los autores verificados. Haz clic en un nombre para ver sus otros plugins.",
                "**Envía un informe de fallo al autor.** Junto a Copiar informe de fallo. Ves exactamente lo que se envía antes de mandarlo, y no incluye nada personal.",
                "**Entérate de cuándo un plugin está roto.** Si un plugin deja de funcionar para mucha gente tras una actualización de Discord, la tienda y tu lista de Plugins lo indican, a menudo con una nota del autor sobre el arreglo.",
                "**Denuncia un plugin.** ¿Algo dañino, falso o roto? Denúncialo desde su página de la tienda. Las denuncias llegan al equipo de Evi.",
                "**Evi puede desactivar un plugin malo en todas partes.** Si un plugin resulta ser dañino, Evi lo apaga en todas las instalaciones y te explica por qué.",
            ],
            improved: [
                "**Unas Novedades con el aspecto de Evi.** La portada de la versión arriba del todo y cada tipo de cambio bajo su propia etiqueta.",
                "**Los avisos esperan a Discord.** Novedades, registros de cambios de plugins y el aviso de actualización aparecen cuando Discord ya ha cargado, no sobre su pantalla de carga.",
                "**Las insignias de colaborador suben de nivel más rápido.** Prismatic ahora es un año de apoyo en lugar de cinco.",
                "**Insignias de plugins en Tus insignias.** Las insignias que los plugins añaden a los perfiles, como el reloj de Last Seen y el dispositivo de Platform Indicators, aparecen también en el directorio de insignias de Discord.",
                "**Más seguro por diseño.** Activar un plugin con acceso completo a tu ordenador siempre te lo pregunta en un cuadro de diálogo del sistema que ningún plugin puede responder por ti.",
            ],
            fixed: [
                "Instalar un plugin desde la tienda siempre lo activa. Antes decía que lo había hecho y a veces no era así.",
                "Los desplegables en los ajustes de un plugin se abren al primer clic. En los ajustes de Discord a menudo se cerraban de nuevo enseguida.",
            ],
        },
        "0.3.2": {
            improved: [
                "**Los diálogos y menús se mueven como los de Discord.** Los diálogos, avisos y menús de plugins de Evi ahora se abren con un rebote suave y se desvanecen, en lugar de aparecer y desaparecer de golpe.",
                "**Un Voice Activity Log más limpio,** con las sesiones listadas por canal y un campo de búsqueda como es debido.",
            ],
        },
        "0.3.1": {
            added: [
                "**Evi en macOS y Linux.** Descarga el instalador para tu sistema desde la versión y ejecuta `evi install`. En Linux, ejecútalo con sudo.",
            ],
        },
        "0.3.0": {
            added: [
                "**Las insignias de Evi forman parte de Evi.** Se muestran en los perfiles de todos los que usan Evi y no se pueden desactivar por accidente.",
                "**Oculta y reordena tus insignias de Evi** en el Personaliza tus insignias de Discord. Todos ven el cambio en cuestión de segundos.",
                "**Insignias de colaborador que suben de nivel.** De Bronze a Prismatic cuanto más tiempo apoyes a Evi, con tu progreso en Tus insignias.",
                "**Actualiza Evi desde la app.** Evi avisa cuando hay una versión nueva y un botón la instala.",
            ],
            improved: [
                "Las insignias se actualizan al instante en lugar de cada media hora.",
                "Todos los plugins se pueden eliminar, incluso los que vienen con Evi, y siguen eliminados cuando Evi se actualiza.",
            ],
        },
        "0.2.0": {
            added: [
                "**La Tienda de plugins ahora está en la pestaña Plugins.** Cada plugin tiene su propia página con capturas de pantalla, su registro de cambios, su código fuente y a qué puede acceder.",
                "**Tienda de temas.** Instala y actualiza temas directamente desde la pestaña Temas.",
                "**Actualizar todo, y actualizaciones automáticas si quieres.** Los plugins con acceso completo a tu ordenador siguen preguntando antes.",
                "**Informes de fallos.** Un plugin que no arranca tiene un botón Copiar informe de fallo para su autor.",
            ],
            improved: [
                "Explora la tienda por categoría y ordénala por nombre o por lo más recientemente actualizado.",
                "Actualiza y desinstala plugins de la tienda directamente desde la lista de Plugins.",
                "Desactiva todos los plugins, o restablécelos a sus valores predeterminados, con un clic y con opción de deshacer.",
            ],
        },
        "0.1.0": {
            added: ["**Primera versión.** Plugins, temas, Quick CSS, copias de seguridad, modo seguro y la tienda de plugins."],
        },
    },
    fr: {
        "2.2.0": {
            fixed: [
                "**Les mises à jour suivent tes réglages.** Quand l'équipe d'Evi dit qu'une mise à jour est nécessaire, Evi ne la télécharge et ne redémarre Discord tout seul que si les mises à jour automatiques sont activées. Sinon, il te prévient et attend que tu appuies sur Mettre à jour. Les plugins ne suivent que si la mise à jour automatique des plugins est activée.",
            ],
        },
        "2.1.0": {
            added: [
                "**La mémoire dans l'onglet Performances.** Vois ce que Discord utilise et, si tu veux, laisse Evi le redémarrer quand il en utilise trop pendant ton absence. Jamais pendant un appel, et au plus une fois par jour.",
                "**Mode jeu.** Le mode jeu caché de Discord, en interrupteur dans l'onglet Performances : pendant que tu joues, Discord ralentit en arrière-plan et arrête les GIF. Il reste coupé pendant les appels.",
            ],
            improved: [
                "**Démarre plus vite.** Evi retient où les plugins s'accrochent à Discord : dès le deuxième démarrage d'une version de Discord, il est prêt environ quatre fois plus vite avec beaucoup de plugins. Les plugins que tu as coupés ne se chargent plus tant que tu ne les actives pas.",
                "**Plus léger à l'usage.** Les points de saisie ne sont plus redessinés en JavaScript à chaque image, les boutons d'appel arrêtent de reflouter sans cesse la vidéo derrière eux, et quand Discord est caché depuis 10 minutes, Evi vide ses caches d'images (jamais pendant un appel).",
            ],
            fixed: [
                "**Les réglages Chromium des plugins tiennent.** Discord les écrasait discrètement au démarrage.",
            ],
        },
        "2.0.0": {
            added: [
                "**Douze nouveaux plugins.** Desktop Voice Messages, Embed Builder avec Components V2, Audit Log Plus, Role Colours Everywhere, Rich Presence Builder, Search Highlight, Click Actions, Soundboard Stealer, Quick Markup, Fix Embeds, Code Block Tools et Hover Converter. Tous dans la boutique, tous désactivés tant que tu ne les actives pas.",
                "**Une visite des nouveautés.** Au premier démarrage, 2.0 te présente les nouveaux plugins et active ceux que tu choisis.",
                "**Publie tes propres plugins.** Un bouton sur la page Plugins ouvre ton tableau de bord d'auteur : installations, utilisateurs actifs, notes, avis et comportement de chaque build de Discord avec tes plugins.",
            ],
            improved: [
                "**Les menus ressemblent à ceux de Discord.** Chaque menu déroulant d'Evi et de ses plugins s'ouvre comme dans Discord, sans barre de défilement et avec un filtre pour les longues listes.",
                "**Retour là où tu étais.** En revenant d'un plugin dans la boutique, tu retrouves la même page, les mêmes filtres et le même défilement.",
                "**Les mises à jour importantes arrivent plus vite.** Quand une mise à jour est nécessaire, Evi la télécharge tout de suite et redémarre Discord quand tu n'es pas en appel.",
            ],
            fixed: [
                "**Les plugins ne sont plus dits cassés sans raison.** Un plugin qui attendait une partie de Discord pas encore ouverte était signalé comme cassé.",
                "**Les fenêtres s'ouvrent en haut.** Certaines s'ouvraient défilées à mi-hauteur dans les paramètres de Discord.",
            ],
        },
        "1.5.0": {
            added: [
                "**Les nouvelles de l'équipe d'Evi, en direct.** Les annonces apparaissent en haut de ton écran quelques secondes après leur envoi et restent jusqu'à ce que tu les fermes.",
            ],
            fixed: [
                "**Les notifications des plugins s'affichent de nouveau.** Discord a changé aujourd'hui la façon dont il affiche ses pop-ups, et celles des plugins n'apparaissaient plus.",
            ],
        },
        "1.4.3": {
            fixed: [
                "**Ton thème de couleur Discord ne se mêle plus de celui d'Evi.** Avec un thème Evi, les parties qu'il ne colore pas (comme le pied d'une fenêtre) prenaient la teinte de ton thème Discord.",
                "**Plus de bande sous les fenêtres avec un fond d'écran.** Le pied des fenêtres laissait voir le fond d'écran deux fois, d'une autre couleur.",
            ],
        },
        "1.4.2": {
            improved: [
                "**Le mode sans échec, c'est vous qui décidez.** Général → Mises à jour propose « Activer le mode sans échec de lui-même » : désactivé, les plantages ne l'activent jamais.",
            ],
            fixed: [
                "**Plus rien d'Evi par-dessus vos jeux.** Le mode sans échec et d'autres avis s'affichaient dans l'overlay en jeu de Discord, impossibles à fermer, et un jeu qui fermait l'overlay comptait comme un plantage de Discord.",
            ],
        },
        "1.4.1": {
            added: [
                "**Evi Setup pour macOS et Linux.** Installez, mettez à jour et retirez Evi depuis une fenêtre sur tous les systèmes, sans terminal. Sous Linux, il demande votre mot de passe quand le dossier de Discord l'exige, et sous macOS et Linux il remet Evi en place tout seul après les mises à jour de Discord.",
            ],
        },
        "1.4.0": {
            added: [
                "**Spotify Player dans la boutique.** Un petit lecteur au-dessus de votre panneau utilisateur avec le morceau, sa pochette, lecture et pause, précédent et suivant, et où vous en êtes.",
            ],
            improved: [
                "**La recherche de la boutique trouve ce que vous cherchez.** Chaque mot compte, dans n'importe quel ordre, les fautes de frappe sont pardonnées, le meilleur résultat vient en premier, et le nom anglais d'un plugin le trouve dans toutes les langues.",
            ],
            fixed: [
                "**Les mises à jour continuent de fonctionner** avec les versions qui n'incluent plus l'installateur en ligne de commande.",
            ],
        },
        "1.3.1": {
            fixed: [
                "**Le panneau utilisateur garde sa place.** Avec Game Activity Toggle et Fake Deafen activés, leurs interrupteurs partagent un bouton Evi avec un menu : ton nom et la roue des paramètres de Discord ne sont plus poussés dehors.",
            ],
        },
        "1.3.0": {
            added: [
                "**Notifications en direct.** Avis, validations, mises à jour d’Evi et nouveautés des auteurs que tu suis apparaissent dans le coin dès leur arrivée. Survole-en une pour la garder, clique pour y aller, ou désactive-les dans la boîte de réception.",
            ],
            improved: [
                "**Les plugins restent séparés.** Un plugin ne peut pas utiliser l’accès complet d’un autre, et restaurer une sauvegarde demande avant d’activer un plugin à accès complet.",
                "**Une question quand ça compte.** Quand une mise à jour change la partie à accès complet d’un de tes plugins, Evi demande avant de l’installer.",
            ],
            fixed: [
                "**Ton fond d’écran reste hors de tes jeux.** L’overlay en jeu de Discord l’affichait par-dessus tout le jeu.",
            ],
        },
        "1.2.0": {
            added: [
                "**Les plugins pour les soutiens se démarquent.** Ils sont dorés dans la boutique, et leur page te remercie ou te montre comment devenir soutien.",
            ],
            improved: [
                "**Un thème à la fois.** Activer un thème désactive les autres, pour qu’ils ne se disputent plus les couleurs.",
                "**Les profils restent à jour.** Change ton nom ou ton avatar Discord et evi.rest, les crédits et les pages d’auteur suivent tout seuls.",
                "**Des boutons comme ceux de Discord.** Fake Deafen et Game Activity Toggle utilisent les boutons de Discord, et Fake Deafen a un fantôme pour ne pas le confondre avec sourdine.",
                "**Une page d’accueil de la boutique plus calme.** Nouveautés de la semaine a disparu, et les plugins installés ont une coche à côté de leur nom.",
            ],
            fixed: [
                "**Voice Chat Utilities marche vraiment.** Il disait avoir déplacé, rendu muets ou déconnecté les gens, mais ses requêtes n’arrivaient jamais à Discord.",
                "**Fini les fausses alertes « cassé ».** View Icons était marqué cassé car une partie attend l’ouverture de la visionneuse d’images.",
                "**Video Controls+ marche dans le chat.** Ses contrôles s’affichent sur les vidéos du chat, pas seulement en plein écran.",
                "**Les plugins ne se restylent plus entre eux.** Les styles de Link Safety débordaient sur les paramètres de Last Seen.",
            ],
        },
        "1.1.2": {
            added: [
                "**Partage des plugins dans le chat.** Copie le lien d’un plugin depuis sa page dans la boutique et colle-le dans n’importe quel chat Discord. Tous ceux qui ont Evi voient une carte pour l’installer sur place.",
                "**Fausse sourdine.** Apparais en sourdine en vocal tout en entendant tout le monde. Un merci aux soutiens.",
                "**Voice Chat Utilities.** Clic droit sur un salon vocal pour déplacer, déconnecter, rendre muet ou mettre en sourdine tout le monde, si tu en as le droit.",
            ],
            fixed: [
                "L’ordre de tes badges s’enregistre de façon plus fiable.",
            ],
        },
        "1.1.1": {
            added: [
                "**Modifier l'image, comme sur Discord.** Déplace, zoome et fais pivoter ton fond d'écran dans un aperçu à la forme de ta fenêtre.",
                "**Ton fond d'écran sur l'écran de connexion.** Il s'affiche derrière la page de connexion de Discord, avec la boîte de connexion dépolie par-dessus.",
                "**Supprime les thèmes que tu as faits.** Les thèmes que tu as créés ou ajoutés toi-même ont maintenant un bouton pour les supprimer.",
            ],
            improved: [
                "**Des réglages de fond d'écran plus simples.** Affiche-le, assombris-le et choisis à quel point Discord est transparent. Le reste est dans Plus d'options.",
                "**Une nouvelle page pour les soutiens.** Ton niveau, quand arrive le suivant et ce que tu as, dans Compte. Les crédits dans Mises à jour montrent le visage de chacun.",
                "Les badges de soutien gardent la couleur de leur niveau : les couleurs personnalisées ont disparu.",
            ],
            fixed: [
                "**Le fond d'écran s'affiche de nouveau.** Le fond propre à Discord et la liste des membres le cachaient.",
                "**Réorganiser tes badges s'enregistre de nouveau.** Discord refusait tout l'enregistrement à cause des badges d'Evi ; maintenant ton ordre arrive chez tout le monde.",
            ],
        },
        "1.1.0": {
            added: [
                "**Evi parle ta langue.** Evi, tous les plugins et la boutique suivent la langue de Discord : allemand, espagnol, français, japonais, polonais, portugais, russe et turc, en plus de l'anglais.",
                "**Place ton fond d'écran.** Remplir, Ajuster, Étirer, Centrer ou Mosaïque, puis fais-le glisser et zoome dans un aperçu de Discord en direct.",
                "**Choisis ce qui est transparent.** Règle l'opacité de la liste des serveurs, des salons, de la discussion et de la zone de message au-dessus du fond d'écran, et teinte-les aux couleurs de ton thème.",
            ],
            improved: [
                "**Discord est bien plus fluide.** Evi retire une règle de style cachée de Discord qui obligeait toute l'appli à recalculer ses styles au moindre changement, comme quelqu'un qui parle en appel : dans un appel chargé, le plus long blocage est passé d'environ 100 ms à 15 ms, et les paramètres s'ouvrent plus vite. Les polices de Discord se chargent aussi en arrière-plan, pour que le texte ne saute plus la première fois qu'un style est utilisé.",
                "**Des mises à jour plus légères.** Dès la prochaine version, mettre à jour Evi ne télécharge que ses fichiers, quelques Mo, au lieu de tout l'installateur de 100 Mo.",
                "**Les paramètres et les fenêtres contextuelles restent opaques.** Le fond d'écran n'apparaît que derrière la fenêtre principale de Discord, sauf si tu l'actives aussi pour les paramètres ou les fenêtres contextuelles.",
                "**Voir le code source montre le vrai code.** Sur la page d'un plugin de la communauté, il ouvre exactement le code qu'Evi installe, avec le lien de l'auteur à côté.",
            ],
            fixed: [
                "L'éditeur de thèmes garde les traductions d'un thème quand tu l'enregistres.",
            ],
        },
        "1.0.0": {
            added: [
                "**Une page d’accueil pour la boutique.** Les tendances, les nouveautés de la semaine, les sélections et les collections de l’équipe Evi, avant la liste complète.",
                "**Notes et avis.** Note les plugins que tu utilises et explique pourquoi en quelques lignes. Les avis signalés par quelqu’un sont transmis à l’équipe Evi.",
                "**Les pages de plugins en disent plus.** Une vidéo ou un GIF du plugin en action, ce que les gens qui l’utilisent installent aussi, les problèmes connus et un mot de son auteur sur la version.",
                "**Une liste de souhaits et une boîte de réception.** Mets un cœur à ce que tu veux dans la boutique pour être prévenu d’une mise à jour, d’une bêta ou d’un retour en état de marche. Les avis sur tes plugins, tes envois et les actualités des auteurs que tu suis arrivent aussi dans la nouvelle Boîte de réception.",
                "**Suis des auteurs.** Les pages d’auteur ont une bannière, des plugins épinglés, le nombre de personnes qui utilisent leurs plugins et un bouton Suivre.",
                "**Bêtas de plugins.** Les auteurs peuvent publier une bêta à côté de la version stable, et tu peux t’inscrire aux bêtas de n’importe quel plugin depuis sa page.",
                "**Fond d’écran dynamique.** Une image ou une vidéo derrière Discord, assombrie pour que le texte reste lisible, et mise en pause sur batterie.",
                "**Crash Detective.** Quand Discord plante ou se fige, Evi indique quel plugin était le plus sollicité juste avant et propose de le désactiver.",
                "**Mises à jour en arrière-plan.** Active-les dans Mises à jour : les nouvelles versions se téléchargent toutes seules et s’installent quand tu fermes Discord.",
                "**Raccourcis clavier pour les plugins.** Définis-en un dans les paramètres d’un plugin en appuyant sur les touches, comme les raccourcis de Discord. Streamer Mode+ et Game Activity Toggle en ont un, et le champ te prévient quand deux plugins veulent les mêmes touches.",
                "**Avantages pour les soutiens.** Ton badge de soutien dans la couleur de ton choix, ton nom dans les crédits si tu le souhaites, et Aurora, un thème pour les soutiens.",
                "**Who Reacted.** De petits avatars de ceux qui ont réagi, directement sur chaque réaction, à côté du compteur.",
                "**Typing Tweaks.** Vois d’un coup d’œil qui écrit : avatars et couleurs de rôle dans la ligne « est en train d’écrire », et trois points sur les salons et les MP pendant que quelqu’un y écrit.",
                "**Pour les auteurs de plugins :** Evi DevTools (événements Flux en direct, stores, patchs appliqués et temps), documentation de l’API au survol dans le Patch Helper, un journal des modifications public de l’API des plugins, des chiffres anonymes d’installations et de plantages sur ton tableau de bord, et `bun run new-plugin` / `bun run preview-plugin` pour démarrer et vérifier un plugin.",
            ],
            improved: [
                "**La recherche trouve les paramètres, pas seulement les plugins.** Chercher dans l’onglet Plugins parcourt aussi les paramètres de chaque plugin, et en ouvrir un depuis les résultats t’amène directement au paramètre.",
                "**N’affiche que ce que tu n’as pas encore** avec le nouveau filtre Non installés de la boutique, et trie par note ou par tendance.",
                "Streamer Mode+ garde le raccourci que tu avais saisi, désormais sous forme de raccourci enregistré.",
                "Les auteurs de plugins voient combien de personnes utilisent leurs plugins : une fois par jour, Evi indique anonymement à evi.rest quels plugins de la boutique sont installés. Tu peux le désactiver dans les paramètres de la boutique.",
                "Quick Actions ne fait plus partie d’Evi et est supprimé quand Evi se met à jour.",
                "**View Icons passe dans les profils.** Clique sur la bannière de quelqu’un pour l’ouvrir en grand comme son avatar, et Télécharger se trouve à côté du zoom. Les éléments du menu contextuel ont disparu.",
            ],
            fixed: [
                "**Message Logger conserve les images, vidéos et fichiers supprimés.** Discord les supprime de ses serveurs avec le message, si bien qu’ils s’affichaient cassés. Les modifications qui retirent une pièce jointe la conservent aussi avec l’ancienne version.",
            ],
        },
        "0.7.0": {
            added: [
                "**Les plugins disent ce dont ils ont besoin, et Evi les y tient.** Quels sites un plugin contacte, et s’il lit tes messages, en envoie ou modifie tes paramètres. Evi bloque tout le reste de ce qu’il tente via Evi, et ce qui est bloqué apparaît dans l’Activité du plugin.",
                "**Evi répare les plugins que Discord casse, sans attendre une mise à jour.** Quand une mise à jour de Discord casse un plugin, l’équipe Evi le répare sur evi.rest et chaque installation reçoit le correctif en quelques minutes. Les détails du plugin indiquent ce qui a été corrigé.",
                "**Crée ton propre thème.** Choisis des couleurs dans le nouvel onglet Éditeur, regarde Discord changer au fur et à mesure, puis enregistre-le comme thème à toi.",
                "**Thèmes de la communauté.** Envoie un thème à la boutique de thèmes depuis l’éditeur ou ton tableau de bord. L’équipe Evi examine chacun d’eux, et les thèmes de la communauté ne peuvent rien charger depuis Internet, donc personne ne sait qui les utilise.",
                "**DM Categories.** Range tes MP dans des catégories repliables comme Amis, Travail ou Jeux, en haut de ta liste de MP. Fais un clic droit sur un MP pour l’ajouter à une catégorie.",
                "**View Icons.** Fais un clic droit sur quelqu’un pour voir son avatar et sa bannière en grand, ou sur un serveur pour son icône et sa bannière, dans la visionneuse d’images de Discord. Télécharge l’original ou copie son lien.",
                "**Calm Name Effects.** Ouvrir une discussion demande deux fois moins de travail : les styles de nom Nitro comme Prism et Neon s’animent pendant que tu survoles un nom, au lieu de s’animer sur chaque message en même temps.",
            ],
            improved: [
                "**Une mise à jour qui demande plus attend ton accord,** comme l’accès complet. Les pages de la boutique, les questions d’installation et les détails des plugins listent ce que chaque plugin demande, et les anciens plugins qui ne le précisent pas sont signalés.",
                "**La boutique sait qu’un correctif fonctionne.** Un plugin réparé par Evi apparaît comme réparé plutôt que cassé, et ne repasse en cassé que si les installations avec le correctif ont encore des problèmes.",
                "Les thèmes de la boutique peuvent être signalés, comme les plugins.",
            ],
            fixed: [
                "L’icône de Platform Indicators ne s’agrandit plus jusqu’à remplir tout un message là où les styles d’Evi ne s’appliquent pas, comme dans les discussions détachées.",
            ],
        },
        "0.6.1": {
            fixed: [
                "**Smooth Typing ne remet plus dans la zone de texte un message que tu viens d’envoyer.** Le changement de salon et les commandes slash gardent aussi la zone à jour.",
                "Un plugin qu’Evi a désactivé, ou qui a un problème à expliquer, garde la taille de sa carte dans la liste des Plugins au lieu de s’étirer sur toute la largeur.",
            ],
        },
        "0.6.0": {
            improved: [
                "**Fini les saccades dues à Evi.** Retrouver les pièces de Discord parcourait tout le code de Discord, 10 à 20 ms à chaque fois, et une pièce manquante était recherchée à nouveau chaque seconde. Désormais, elle est trouvée une fois, et chaque recherche suivante est instantanée.",
                "**Les plugins font leur gros travail par petits morceaux,** entre tout le reste : Fast Lists, Read All, GIF Folders et l’enregistrement de Last Seen ne bloquent plus Discord.",
                "**Show Hidden Channels retient qui peut voir quoi,** au lieu de le redemander pour chaque salon à chaque redessin.",
                "**Plus rapides : Message Logger, Inline Translate, Platform Indicators, Voice Activity Log, Relationship Notifier, Hide Blocked, Timezones, Friend Online Alerts, Streamer Mode+, Silent Typing et Snippets.**",
                "La vérification de santé des plugins en arrière-plan est beaucoup plus légère.",
            ],
            fixed: [
                "**Un plugin qu’Evi désactive partout s’éteint en quelques secondes,** avec un avis, au lieu d’attendre la prochaine vérification semi-horaire ou le redémarrage.",
            ],
        },
        "0.5.3": {
            fixed: [
                "Le badge Plugin Author ouvre ses détails quand on clique dessus, et peut être masqué et déplacé dans Personnaliser tes badges.",
            ],
        },
        "0.5.2": {
            improved: [
                "**Les vérifications de mise à jour passent par evi.rest,** si bien qu’un réseau très sollicité ne se heurte plus à la limite de GitHub et n’affiche plus qu’Evi ne peut pas chercher de mises à jour.",
                "**Installer un plugin avec accès complet demande dans une boîte de dialogue,** au lieu d’un encadré coincé dans sa carte.",
                "**Des icônes sur chaque onglet,** pour distinguer Installés et Boutique d’un coup d’œil.",
                "**Chaque version a sa couverture en pointillés** dans Nouveautés.",
            ],
            fixed: [
                "Ouvrir la Boutique ne fait plus défiler un peu les paramètres de Discord vers le bas.",
            ],
        },
        "0.5.1": {
            added: [
                "**Des plugins de la communauté avec une partie native.** Les auteurs peuvent soumettre un native.js avec leur plugin. L’équipe Evi lit tout avant qu’il soit accepté, et Evi te demande toujours ton accord avant d’installer quoi que ce soit avec accès complet.",
            ],
            fixed: [
                "Ouvrir les pages d’Evi dans les paramètres de Discord ne fait plus planter Discord.",
            ],
        },
        "0.5.0": {
            added: [
                "**Evi Setup.** Un petit installateur avec une fenêtre : choisis ton Discord, puis clique sur Installer Evi ou Désinstaller Evi. Il vérifie d’abord s’il existe un Evi plus récent et le télécharge, ce qui ne pèse que quelques Mo au lieu de plus de 100.",
                "**Evi dans ta langue.** Les menus d’Evi suivent la langue de Discord : espagnol, portugais, français, allemand, turc, russe, polonais et japonais. Les plugins peuvent aussi être traduits.",
                "**Vois ce qu’un plugin a fait.** Les détails d’un plugin listent les sites qu’il a contactés et quand, et signalent ceux que son code ne mentionne jamais.",
                "**Versions bêta.** Active Recevoir les versions bêta dans Mises à jour pour obtenir les nouvelles versions d’Evi quelques jours plus tôt.",
                "**Badge Plugin Author.** Toute personne dont le plugin arrive dans la boutique l’obtient sur son profil.",
            ],
            improved: [
                "Activer ou désactiver un plugin ne fige plus Discord un instant.",
                "**Les niveaux de soutien arrivent chaque mois.** Un nouveau badge chaque mois pendant tes six premiers mois, de Silver à un mois jusqu’à Ruby à six, puis Prismatic à un an.",
            ],
            fixed: [
                "Cliquer sur l’interrupteur d’un plugin ne fait plus défiler les paramètres de Discord loin de lui.",
            ],
        },
        "0.4.0": {
            added: [
                "**Des plugins de la communauté dans la boutique.** Les auteurs de plugins peuvent désormais publier leurs propres plugins sur evi.rest. L’équipe Evi lit chaque version avant qu’elle soit acceptée, et les plugins de la communauté sont signalés pour que tu saches toujours qui a fait quoi.",
                "**Auteurs vérifiés.** Chaque plugin indique qui l’a fait, avec une coche pour les auteurs vérifiés. Clique sur un nom pour voir ses autres plugins.",
                "**Envoie un rapport de plantage à l’auteur.** À côté de Copier le rapport de plantage. Tu vois exactement ce qui est envoyé avant l’envoi, et rien de personnel n’y figure.",
                "**Sache quand un plugin est cassé.** Si un plugin cesse de fonctionner pour beaucoup de monde après une mise à jour de Discord, la boutique et ta liste de Plugins l’indiquent, souvent avec un mot de son auteur sur le correctif.",
                "**Signale un plugin.** Quelque chose de nuisible, de faux ou de cassé ? Signale-le depuis sa page de la boutique. Les signalements sont transmis à l’équipe Evi.",
                "**Evi peut désactiver un mauvais plugin partout.** Si un plugin s’avère nuisible, Evi le désactive sur chaque installation et t’explique pourquoi.",
            ],
            improved: [
                "**Des Nouveautés qui ressemblent à Evi.** La couverture de la version en haut, et chaque type de changement sous sa propre étiquette.",
                "**Les fenêtres attendent Discord.** Nouveautés, journaux des modifications des plugins et avis de mise à jour s’affichent une fois Discord chargé, pas par-dessus son écran de chargement.",
                "**Les badges de soutien montent de niveau plus vite.** Prismatic correspond désormais à un an de soutien au lieu de cinq.",
                "**Badges de plugins dans Tes badges.** Les badges que les plugins ajoutent aux profils, comme l’horloge de Last Seen et l’appareil de Platform Indicators, figurent aussi dans le répertoire de badges de Discord.",
                "**Plus sûr par conception.** Activer un plugin avec un accès complet à ton ordinateur te le demande toujours dans une boîte de dialogue système à laquelle aucun plugin ne peut répondre à ta place.",
            ],
            fixed: [
                "Installer un plugin depuis la boutique l’active toujours. Avant, il disait l’avoir fait et parfois ce n’était pas le cas.",
                "Les menus déroulants dans les paramètres d’un plugin s’ouvrent au premier clic. Dans les paramètres de Discord, ils se refermaient souvent aussitôt.",
            ],
        },
        "0.3.2": {
            improved: [
                "**Les boîtes de dialogue et les menus bougent comme ceux de Discord.** Les dialogues, avis et menus de plugins d’Evi s’ouvrent maintenant avec un ressort et disparaissent en fondu, au lieu d’apparaître et de disparaître d’un coup.",
                "**Un Voice Activity Log plus net,** avec les sessions listées par salon et un vrai champ de recherche.",
            ],
        },
        "0.3.1": {
            added: [
                "**Evi sur macOS et Linux.** Télécharge l’installateur pour ton système depuis la version et lance `evi install`. Sous Linux, lance-le avec sudo.",
            ],
        },
        "0.3.0": {
            added: [
                "**Les badges Evi font partie d’Evi.** Ils s’affichent sur les profils de tous ceux qui utilisent Evi et ne peuvent pas être désactivés par accident.",
                "**Masque et réorganise tes badges Evi** dans le Personnaliser tes badges de Discord. Tout le monde voit le changement en quelques secondes.",
                "**Des badges de soutien qui montent de niveau.** De Bronze à Prismatic plus tu soutiens Evi longtemps, avec ta progression dans Tes badges.",
                "**Mets Evi à jour depuis l’appli.** Evi te prévient quand une nouvelle version est disponible, et un bouton l’installe.",
            ],
            improved: [
                "Les badges se mettent à jour en direct au lieu de toutes les demi-heures.",
                "Chaque plugin peut être supprimé, y compris ceux fournis avec Evi, et ils restent supprimés quand Evi se met à jour.",
            ],
        },
        "0.2.0": {
            added: [
                "**La boutique de plugins est maintenant dans l’onglet Plugins.** Chaque plugin a sa propre page avec des captures d’écran, son journal des modifications, son code source et ce à quoi il peut accéder.",
                "**Boutique de thèmes.** Installe et mets à jour des thèmes directement depuis l’onglet Thèmes.",
                "**Tout mettre à jour, et mises à jour automatiques si tu veux.** Les plugins avec accès complet à ton ordinateur demandent toujours avant.",
                "**Rapports de plantage.** Un plugin qui ne démarre pas a un bouton Copier le rapport de plantage pour son auteur.",
            ],
            improved: [
                "Parcours la boutique par catégorie, et trie-la par nom ou par dernière mise à jour.",
                "Mets à jour et désinstalle les plugins de la boutique directement depuis la liste des Plugins.",
                "Désactive tous les plugins, ou réinitialise-les à leurs valeurs par défaut, d’un clic et avec possibilité d’annuler.",
            ],
        },
        "0.1.0": {
            added: ["**Première version.** Plugins, thèmes, Quick CSS, sauvegardes, mode sans échec et la boutique de plugins."],
        },
    },
    ja: {
        "2.2.0": {
            fixed: [
                "**アップデートは設定どおりに。** Evi チームがアップデートを必要としたとき、Evi が自分でダウンロードして Discord を再起動するのは、自動アップデートがオンの場合だけです。オフなら知らせるだけで、「今すぐアップデート」を押すまで待ちます。プラグインも、プラグインの自動アップデートがオンのときだけ一緒に更新されます。",
            ],
        },
        "2.1.0": {
            added: [
                "**パフォーマンスタブにメモリ表示。** Discord が使っているメモリを確認でき、離席中に使いすぎたときは Evi に再起動させることもできます。通話中は行わず、1 日 1 回までです。",
                "**ゲームモード。** Discord に隠れているゲームモードを、パフォーマンスタブのスイッチで使えます。プレイ中は Discord がバックグラウンドで動きを抑え、GIF を止めます。通話中はオフのままです。",
            ],
            improved: [
                "**起動が速くなりました。** Evi はプラグインが Discord のどこに組み込まれるかを覚えるので、同じ Discord バージョンの 2 回目以降の起動では、プラグインが多い場合に約 4 倍速く準備が整います。オフにしたプラグインは、オンにするまで読み込まれません。",
                "**使っている間も軽く。** 入力中のドットを毎フレーム JavaScript で描き直さなくなり、通話ボタンが背後の映像を何度もぼかし直すこともなくなりました。Discord が 10 分間隠れていると、Evi が画像キャッシュを空にします (通話中は行いません)。",
            ],
            fixed: [
                "**プラグインの Chromium 設定が保たれるように。** 起動時に Discord が気づかないうちに上書きしていました。",
            ],
        },
        "2.0.0": {
            added: [
                "**12個の新しいプラグイン。** Desktop Voice Messages、Components V2対応のEmbed Builder、Audit Log Plus、Role Colours Everywhere、Rich Presence Builder、Search Highlight、Click Actions、Soundboard Stealer、Quick Markup、Fix Embeds、Code Block Tools、Hover Converter。すべてストアにあり、オンにするまで無効のままです。",
                "**新機能のツアー。** 2.0を初めて起動すると新しいプラグインを紹介し、選んだものをオンにします。",
                "**自分のプラグインを公開。** プラグインページのボタンから作者ダッシュボードが開きます。インストール数、アクティブユーザー、評価、レビュー、そしてDiscordの各ビルドでのプラグインの動作がわかります。",
            ],
            improved: [
                "**メニューがDiscordと同じ見た目に。** Eviとプラグインのドロップダウンはすべて、スクロールバーなしでDiscordのように開き、長いリストには絞り込みが付きます。",
                "**元の場所に戻れます。** ストアでプラグインから戻ると、同じページ、同じ絞り込み、同じスクロール位置に戻ります。",
                "**必要なアップデートがすぐ届きます。** アップデートが必要なとき、Eviはすぐにダウンロードし、通話中でないときにDiscordを再起動します。",
            ],
            fixed: [
                "**プラグインが理由なく壊れていると表示されなくなりました。** Discordのまだ開かれていない部分を待っているプラグインが、壊れていると報告されていました。",
                "**ダイアログが上から開きます。** Discordの設定内で、途中までスクロールされた状態で開くものがありました。",
            ],
        },
        "1.5.0": {
            added: [
                "**Evi チームからのお知らせをリアルタイムで。** お知らせは送信から数秒で画面上部に表示され、閉じるまで残ります。",
            ],
            fixed: [
                "**プラグインの通知が再び表示されるように。** 本日 Discord がポップアップの表示方法を変更し、プラグインの通知が表示されなくなっていました。",
            ],
        },
        "1.4.3": {
            fixed: [
                "**Discordのカラーテーマが Evi のテーマに混ざらなくなりました。** Evi のテーマを使っていると、テーマが色を付けない部分(ダイアログの下部など)に Discord のカラーテーマの色味が出ていました。",
                "**壁紙使用時、ダイアログの下に帯が出なくなりました。** ダイアログの下部で壁紙が二重に透けて、別の色に見えていました。",
            ],
        },
        "1.4.2": {
            improved: [
                "**セーフモードをオフにできるように。** 一般 → アップデートの「自動でセーフモードにする」をオフにすると、クラッシュしてもセーフモードになりません。",
            ],
            fixed: [
                "**ゲームの上にEviが表示されなくなりました。** セーフモードなどのお知らせがDiscordのゲーム内オーバーレイに表示されて閉じられず、ゲームがオーバーレイを閉じるとクラッシュとして数えられていました。",
            ],
        },
        "1.4.1": {
            added: [
                "**macOSとLinux向けのEvi Setup。** どのシステムでも、ターミナルを使わずにウィンドウからEviをインストール、更新、削除できます。LinuxではDiscordのフォルダに必要なときだけパスワードを求め、macOSとLinuxではDiscordの更新後にEviを自動で元に戻します。",
            ],
        },
        "1.4.0": {
            added: [
                "**ストアにSpotify Playerが登場。** ユーザーパネルの上に小さなプレーヤーを表示します。曲名、ジャケット、再生と一時停止、前へと次へ、再生位置がわかります。",
            ],
            improved: [
                "**ストア検索が意図をくみ取るように。** 入力した単語はすべて順不同で使われ、打ち間違いも許容され、いちばん合う結果が先頭に来ます。プラグインの英語名でもどの言語からでも見つかります。",
            ],
            fixed: [
                "**コマンドラインのインストーラーを含まないリリースでも、アップデートが引き続き動作します。**",
            ],
        },
        "1.3.1": {
            fixed: [
                "**ユーザーパネルの場所が保たれます。** Game Activity Toggle と Fake Deafen を両方オンにすると、スイッチがメニュー付きの Evi ボタン 1 つにまとまり、名前と Discord の設定ボタンが押し出されません。",
            ],
        },
        "1.3.0": {
            added: [
                "**ライブ通知。** レビュー、承認、Evi の更新、フォロー中の作者のお知らせが届くと隅にポップアップします。ホバーで保持、クリックで移動、受信箱でオフにもできます。",
            ],
            improved: [
                "**プラグインを分離。** 他のプラグインのフルアクセスは使えず、バックアップの復元でもフルアクセスのプラグインをオンにする前に確認します。",
                "**大事なときは確認。** 更新でプラグインのフルアクセス部分が変わるとき、Evi はインストール前に確認します。",
            ],
            fixed: [
                "**壁紙がゲームに映らなくなりました。** Discord のゲーム内オーバーレイがゲーム全体に壁紙を表示していました。",
            ],
        },
        "1.2.0": {
            added: [
                "**サポーター向けプラグインが目立つように。** ストアでは金色で表示され、ページではお礼か、サポーターになる方法が表示されます。",
            ],
            improved: [
                "**テーマは一度にひとつ。** テーマをオンにすると他はオフになり、色がぶつかりません。",
                "**プロフィールが常に最新に。** Discord の名前やアバターを変えると、evi.rest、クレジット、作者ページも自動で更新されます。",
                "**Discord と同じボタン。** Fake Deafen と Game Activity Toggle は Discord 本来のボタンを使い、Fake Deafen はスピーカーミュートと間違えないようおばけのアイコンになりました。",
                "**すっきりしたストアのトップページ。** 「今週の新着」をなくし、インストール済みのプラグインは名前の横にチェックが付きます。",
            ],
            fixed: [
                "**Voice Chat Utilities が本当に動作するように。** 移動・ミュート・切断したと表示されていましたが、リクエストが Discord に届いていませんでした。",
                "**誤った「壊れています」表示がなくなりました。** View Icons は、一部が画像ビューアを開くまで待つため壊れていると判定されていました。",
                "**Video Controls+ がチャットで動作。** 全画面だけでなく、チャットの動画にもコントロールが表示されます。",
                "**プラグイン同士でスタイルが干渉しなくなりました。** Link Safety のスタイルが Last Seen の設定画面に影響していました。",
            ],
        },
        "1.1.2": {
            added: [
                "**チャットでプラグインを共有。** ストアのページでプラグインのリンクをコピーして、Discordのチャットに貼るだけ。Eviを使っている人にはその場でインストールできるカードが表示されます。",
                "**フェイクスピーカーミュート。** 全員の声を聞きながら、ボイスではスピーカーミュート中に見せます。サポーターへのお礼です。",
                "**Voice Chat Utilities。** ボイスチャンネルを右クリックして、権限があれば全員を移動、切断、ミュート、スピーカーミュートできます。",
            ],
            fixed: [
                "バッジの並び順がより確実に保存されるようになりました。",
            ],
        },
        "1.1.1": {
            added: [
                "**Discordと同じ「画像を編集」。** ウィンドウの形のプレビューで、壁紙をドラッグ、ズーム、回転できます。",
                "**ログイン画面にも壁紙を。** Discordのログインページの後ろに壁紙が表示され、ログインボックスはすりガラス風になります。",
                "**自作テーマを削除できるように。** 自分で作った、または追加したテーマに削除ボタンが付きました。",
            ],
            improved: [
                "**壁紙の設定をシンプルに。** 表示、暗さ、Discordの透け具合だけを設定できます。ほかの項目は「その他のオプション」にあります。",
                "**新しいサポーターページ。** アカウントで、今のレベル、次のレベルになる日、特典を確認できます。アップデートのクレジットには全員の顔が並びます。",
                "サポーターバッジはレベルの色のままになり、バッジの色の変更はなくなりました。",
            ],
            fixed: [
                "**壁紙がまた表示されるようになりました。** Discord自体の背景とメンバーリストが壁紙を覆っていました。",
                "**バッジの並べ替えがまた保存されるように。** Eviのバッジが原因でDiscordが保存全体を拒否していました。今は並び順がみんなに届きます。",
            ],
        },
        "1.1.0": {
            added: [
                "**Eviがあなたの言語に対応。** Evi、すべてのプラグイン、ストアがDiscordの言語設定に合わせて表示されます。英語のほか、ドイツ語、スペイン語、フランス語、日本語、ポーランド語、ポルトガル語、ロシア語、トルコ語に対応しています。",
                "**壁紙の配置を自由に。** 拡大・全体・引き伸ばし・中央・並べるから選び、Discordのライブプレビューでドラッグやズームができます。",
                "**透ける部分を選べます。** サーバーリスト、チャンネル、チャット、入力欄が壁紙の上でどれだけ不透明に残るかを設定し、テーマの色で染められます。",
            ],
            improved: [
                "**Discordがずっと滑らかに。** 通話中に誰かが話すなど、何かが変わるたびにアプリ全体のスタイルを再計算させていた、Discordの隠れたスタイルルールをEviが取り除きます。混雑した通話では最長の引っかかりが約100msから15msに減り、設定も速く開くようになりました。Discordのフォントもバックグラウンドで読み込むため、スタイルを初めて使うときに文字がずれなくなりました。",
                "**アップデートが軽くなりました。** 次のバージョンからは、100MBのインストーラー全体ではなく、数MBのEviのファイルだけをダウンロードして更新します。",
                "**設定やポップアウトは不透明のまま。** 壁紙はDiscordのメイン画面の後ろにだけ表示されます。設定やポップアウトでも表示したい場合はオンにできます。",
                "**「ソースを見る」で実際のコードを表示。** コミュニティプラグインのページでは、Eviがインストールするコードそのものが開き、作者のリンクはその隣に表示されます。",
            ],
            fixed: [
                "テーマエディターで保存しても、テーマの翻訳が消えなくなりました。",
            ],
        },
        "1.0.0": {
            added: [
                "**ストアのトップページ。** 全体のリストの前に、トレンド、今週の新着、Evi チームが選んだおすすめやコレクションが並びます。",
                "**評価とレビュー。** 使っているプラグインを評価して、理由を数行で伝えられます。誰かが報告したレビューは Evi チームに届きます。",
                "**プラグインのページがより詳しく。** 使っているところの動画や GIF、そのプラグインを使っている人がほかに入れているもの、既知の問題、バージョンについての作者からのメモを表示します。",
                "**ウィッシュリストと受信トレイ。** ストアのものにハートを付けると、更新やベータの公開、再び動くようになったときに通知されます。あなたのプラグインへのレビュー、アップロード、フォロー中の作者からのお知らせも、新しい受信トレイに届きます。",
                "**作者をフォロー。** 作者のページにはバナー、ピン留めしたプラグイン、プラグインの利用者数、フォローボタンが表示されます。",
                "**プラグインのベータ版。** 作者は安定版と並べてベータ版を公開でき、あなたは各プラグインのページからベータ版を選んで受け取れます。",
                "**ダイナミック壁紙。** Discord の背景に画像や動画を表示します。文字が読みやすいように暗くなり、バッテリー駆動中は一時停止します。",
                "**Crash Detective。** Discord がクラッシュしたりフリーズしたりしたとき、直前にいちばん負荷が高かったプラグインを Evi が教え、オフにすることを提案します。",
                "**バックグラウンドで更新。** 「アップデート」でオンにすると、新しいバージョンが自動でダウンロードされ、Discord を閉じたときにインストールされます。",
                "**プラグインのキーボードショートカット。** Discord のキーバインドと同じように、プラグインの設定でキーを押して割り当てられます。Streamer Mode+ と Game Activity Toggle にひとつずつあり、2つのプラグインが同じキーを使おうとすると入力欄でお知らせします。",
                "**サポーター特典。** 好きな色にできるサポーターバッジ、希望すればクレジットへの名前掲載、サポーター向けテーマの Aurora。",
                "**Who Reacted。** リアクションした人の小さなアイコンを、各リアクションの数の横に表示します。",
                "**Typing Tweaks。** 入力中の人がひと目でわかります。「入力中」の行にアイコンとロールの色を表示し、誰かが入力しているチャンネルや DM には 3 つのドットが出ます。",
                "**プラグイン作者向け:** Evi DevTools（リアルタイムの Flux イベント、ストア、パッチの一致とタイミング）、Patch Helper でカーソルを重ねると出る API ドキュメント、公開のプラグイン API 変更履歴、ダッシュボードの匿名のインストール数とクラッシュ数、プラグインの作成と確認に使う `bun run new-plugin` / `bun run preview-plugin`。",
            ],
            improved: [
                "**検索でプラグインだけでなく設定も見つかります。** プラグインタブの検索は全プラグインの設定も対象になり、結果から開くとその設定まで移動します。",
                "**まだ持っていないものだけを表示。** ストアの新しい「未インストール」フィルターで絞り込めます。評価順やトレンド順の並べ替えにも対応しました。",
                "Streamer Mode+ は入力したショートカットを、記録したショートカットとして引き続き使います。",
                "プラグイン作者は利用者数がわかります。1日に1回、Evi が入っているストアのプラグインを匿名で evi.rest に伝えます。ストアの設定でオフにできます。",
                "Quick Actions は Evi の一部ではなくなり、Evi の更新時に削除されます。",
                "**View Icons はプロフィールの中へ。** 相手のバナーをクリックすると、アイコンと同じようにフルサイズで開き、ダウンロードはズームの隣にあります。右クリックメニューの項目はなくなりました。",
            ],
            fixed: [
                "**Message Logger が削除された画像、動画、ファイルを残します。** Discord はメッセージと一緒にサーバーから削除するため、これまでは壊れた表示になっていました。添付ファイルを外す編集でも、古いバージョンには添付ファイルが残ります。",
            ],
        },
        "0.7.0": {
            added: [
                "**プラグインが必要なものを申告し、Evi がそれを守らせます。** プラグインが通信するサイト、メッセージの読み取り、メッセージの送信、設定の変更をするかどうか。それ以外の Evi 経由の操作は Evi がブロックし、ブロックされたものはプラグインのアクティビティに表示されます。",
                "**Discord が壊したプラグインを、アップデートを待たずに Evi が直します。** Discord の更新でプラグインが壊れたとき、Evi チームが evi.rest で修正し、すべての環境に数分以内に反映されます。何を直したかはプラグインの詳細に載ります。",
                "**オリジナルのテーマを作成。** 新しいエディタータブで色を選ぶと Discord がその場で変わり、自分だけのテーマとして保存できます。",
                "**コミュニティテーマ。** エディターやダッシュボードからテーマストアにテーマを送れます。Evi チームがひとつずつ確認し、コミュニティテーマはインターネットから何も読み込めないので、誰が使っているかは誰にもわかりません。",
                "**DM Categories。** DM 一覧の上部に、フレンド、仕事、ゲームのような折りたたみ式カテゴリを作って DM を整理できます。DM を右クリックしてカテゴリに追加します。",
                "**View Icons。** 相手を右クリックするとアイコンとバナーを、サーバーを右クリックするとアイコンとバナーを、Discord の画像ビューアーでフルサイズ表示します。元の画像のダウンロードやリンクのコピーもできます。",
                "**Calm Name Effects。** チャットを開くときの負荷が半分になります。Prism や Neon などの Nitro の名前スタイルは、すべてのメッセージで同時にではなく、名前にカーソルを重ねている間だけアニメーションします。",
            ],
            improved: [
                "**より多くを求めるアップデートは、あなたの OK を待ちます。** フルアクセスのときと同じです。ストアのページ、インストール時の確認、プラグインの詳細に各プラグインが求めるものが表示され、申告のない古いプラグインにはその旨のラベルが付きます。",
                "**ストアが修正の効果を把握します。** Evi が直したプラグインは「壊れている」ではなく「修正済み」と表示され、修正を適用した環境で問題が続く場合にのみ「壊れている」に戻ります。",
                "ストアのテーマも、プラグインと同じように報告できます。",
            ],
            fixed: [
                "ポップアウトしたチャットなど Evi のスタイルが届かない場所で、Platform Indicators のアイコンがメッセージいっぱいに大きくなる問題を修正しました。",
            ],
        },
        "0.6.1": {
            fixed: [
                "**Smooth Typing が、送信したばかりのメッセージを入力欄に戻さなくなりました。** チャンネルの切り替えやスラッシュコマンドでも入力欄が最新の状態に保たれます。",
                "Evi がオフにしたプラグインや、説明すべき問題があるプラグインが、プラグイン一覧で横いっぱいに伸びず、カードのサイズを保つようになりました。",
            ],
        },
        "0.6.0": {
            improved: [
                "**Evi によるカクつきがなくなりました。** これまで Discord の部品を探すたびに Discord の全コードを 10〜20 ms かけて検索し、見つからない部品は毎秒探し直していました。今は一度見つければ、以降は一瞬で見つかります。",
                "**プラグインは重い処理を小分けにして、ほかの処理の合間に実行します。** Fast Lists、Read All、GIF Folders、Last Seen の保存が Discord を待たせなくなりました。",
                "**Show Hidden Channels が、誰が何を見られるかを記憶します。** 再描画のたびにすべてのチャンネルで確認し直すことがなくなりました。",
                "**Message Logger、Inline Translate、Platform Indicators、Voice Activity Log、Relationship Notifier、Hide Blocked、Timezones、Friend Online Alerts、Streamer Mode+、Silent Typing、Snippets が高速化しました。**",
                "バックグラウンドのプラグイン健全性チェックがずっと軽くなりました。",
            ],
            fixed: [
                "**Evi がすべての環境でオフにしたプラグインは、数秒以内にオフになります。** 30 分ごとのチェックや再起動を待たず、お知らせも表示されます。",
            ],
        },
        "0.5.3": {
            fixed: [
                "Plugin Author バッジをクリックすると詳細が開き、「バッジをカスタマイズ」で非表示にしたり並べ替えたりできるようになりました。",
            ],
        },
        "0.5.2": {
            improved: [
                "**アップデートの確認は evi.rest 経由になりました。** 混雑したネットワークでも GitHub の制限に引っかからず、「Evi がアップデートを確認できません」と表示されなくなります。",
                "**フルアクセスのプラグインをインストールするときは、ダイアログで確認します。** カードの中に押し込められた枠ではなくなりました。",
                "**すべてのタブにアイコンを追加。** 「インストール済み」と「ストア」をひと目で見分けられます。",
                "**すべてのリリースにドットのカバーが付きます。** 「新着情報」に表示されます。",
            ],
            fixed: [
                "ストアを開いても、Discord の設定が少し下にスクロールしなくなりました。",
            ],
        },
        "0.5.1": {
            added: [
                "**ネイティブ部分を持つコミュニティプラグイン。** 作者はプラグインと一緒に native.js を提出できます。Evi チームが追加前にすべて読み、フルアクセスのものをインストールする前には、これまでどおり Evi があなたに確認します。",
            ],
            fixed: [
                "Discord の設定で Evi のページを開いても、Discord がクラッシュしなくなりました。",
            ],
        },
        "0.5.0": {
            added: [
                "**Evi Setup。** ウィンドウ付きの小さなインストーラーです。Discord を選んで「Evi をインストール」または「Evi をアンインストール」をクリックするだけ。先に新しい Evi があるか確認してダウンロードするので、100 MB 超ではなく数 MB で済みます。",
                "**Evi があなたの言語に。** Evi のメニューは Discord の言語に合わせて表示されます。スペイン語、ポルトガル語、フランス語、ドイツ語、トルコ語、ロシア語、ポーランド語、日本語に対応。プラグインも翻訳できます。",
                "**プラグインが何をしたかがわかります。** プラグインの詳細に、通信したサイトとその時刻が一覧で表示され、コードに書かれていないサイトは目立たせて知らせます。",
                "**ベータ版。** 「アップデート」で「ベータ版を入手」をオンにすると、新しい Evi を数日早く入手できます。",
                "**Plugin Author バッジ。** プラグインがストアに載った人は、プロフィールにこのバッジが付きます。",
            ],
            improved: [
                "プラグインのオン・オフを切り替えても、Discord が一瞬固まらなくなりました。",
                "**サポーターレベルが毎月上がります。** 最初の 6 か月は毎月新しいバッジが届き、1 か月の Silver から 6 か月の Ruby まで、そして 1 年で Prismatic になります。",
            ],
            fixed: [
                "プラグインのスイッチをクリックしても、Discord の設定がそこからスクロールして離れなくなりました。",
            ],
        },
        "0.4.0": {
            added: [
                "**ストアにコミュニティプラグイン。** プラグイン作者が自分のプラグインを evi.rest で公開できるようになりました。Evi チームが追加前にすべてのバージョンを確認し、コミュニティプラグインにはラベルが付くので、誰が作ったものか常にわかります。",
                "**認証済みの作者。** すべてのプラグインに作者が表示され、認証済みの作者にはチェックマークが付きます。名前をクリックすると、ほかのプラグインも見られます。",
                "**クラッシュレポートを作者に送信。** 「クラッシュレポートをコピー」の隣にあります。送信前に内容をそのまま確認でき、個人情報は含まれません。",
                "**プラグインが壊れているときにわかります。** Discord のアップデート後に多くの人でプラグインが動かなくなると、ストアとプラグイン一覧でお知らせします。作者からの修正についてのメモが付くことも多くあります。",
                "**プラグインを報告。** 有害なもの、偽物、壊れているものを見つけたら、ストアのページから報告できます。報告は Evi チームに届きます。",
                "**Evi は問題のあるプラグインをすべての環境でオフにできます。** プラグインが有害だとわかった場合、Evi はすべてのインストールでそれをオフにし、理由をお知らせします。",
            ],
            improved: [
                "**Evi らしい「新着情報」。** 上部にリリースのカバー、変更の種類ごとに専用のラベルを付けました。",
                "**ポップアップは Discord の読み込みを待ちます。** 新着情報、プラグインの変更履歴、アップデートのお知らせは、読み込み画面の上ではなく、Discord の読み込みが終わってから表示されます。",
                "**サポーターバッジのレベルアップが早くなりました。** Prismatic は 5 年ではなく 1 年のサポートで到達します。",
                "**プラグインのバッジが「あなたのバッジ」に。** Last Seen の時計や Platform Indicators のデバイスなど、プラグインがプロフィールに追加するバッジも、Discord のバッジ一覧に表示されます。",
                "**設計から安全に。** コンピューターへのフルアクセスを持つプラグインをオンにするときは、どのプラグインにも代わりに答えられないシステムのダイアログで、必ず確認します。",
            ],
            fixed: [
                "ストアからプラグインをインストールすると、必ずオンになります。以前はオンにしたと表示されても、そうなっていないことがありました。",
                "プラグインの設定のドロップダウンが、最初のクリックで開くようになりました。Discord の設定では、すぐにまた閉じてしまうことがよくありました。",
            ],
        },
        "0.3.2": {
            improved: [
                "**ダイアログとメニューが Discord のように動きます。** Evi のダイアログ、お知らせ、プラグインのメニューは、ぱっと現れて消えるのではなく、弾むように開いてフェードアウトします。",
                "**すっきりした Voice Activity Log。** セッションをチャンネルごとに表示し、きちんとした検索欄も付きました。",
            ],
        },
        "0.3.1": {
            added: [
                "**macOS と Linux で Evi が使えます。** リリースからお使いのシステム用のインストーラーをダウンロードし、`evi install` を実行してください。Linux では sudo を付けて実行します。",
            ],
        },
        "0.3.0": {
            added: [
                "**Evi バッジは Evi の一部です。** Evi を使っている全員のプロフィールに表示され、うっかりオフにすることはできません。",
                "**Evi バッジの非表示と並べ替え。** Discord 標準の「バッジをカスタマイズ」から設定できます。変更は数秒で全員に反映されます。",
                "**レベルアップするサポーターバッジ。** Evi を支援した期間が長いほど Bronze から Prismatic へ上がり、進捗は「あなたのバッジ」で確認できます。",
                "**アプリから Evi を更新。** 新しいバージョンが出るとお知らせし、ボタンひとつでインストールできます。",
            ],
            improved: [
                "バッジが 30 分ごとではなく、リアルタイムで更新されます。",
                "Evi に最初から入っているプラグインを含め、すべてのプラグインを削除でき、Evi を更新しても削除したままになります。",
            ],
        },
        "0.2.0": {
            added: [
                "**プラグインストアがプラグインタブに登場。** 各プラグインに、スクリーンショット、変更履歴、ソース、アクセスできる内容を載せた専用ページがあります。",
                "**テーマストア。** テーマタブから直接テーマをインストールして更新できます。",
                "**すべて更新、お好みで自動更新も。** コンピューターへのフルアクセスを持つプラグインは、これまでどおり先に確認します。",
                "**クラッシュレポート。** 起動に失敗したプラグインには、作者向けの「クラッシュレポートをコピー」ボタンが付きます。",
            ],
            improved: [
                "ストアをカテゴリで探せるようになり、名前順や最近更新した順で並べ替えられます。",
                "ストアのプラグインの更新とアンインストールを、プラグイン一覧から直接できます。",
                "すべてのプラグインのオフ、または初期設定へのリセットが、ワンクリックで行え、元に戻すこともできます。",
            ],
        },
        "0.1.0": {
            added: ["**最初のリリース。** プラグイン、テーマ、Quick CSS、バックアップ、セーフモード、プラグインストア。"],
        },
    },
    pl: {
        "2.2.0": {
            fixed: [
                "**Aktualizacje słuchają twoich ustawień.** Gdy zespół Evi uzna aktualizację za potrzebną, Evi sam ją pobiera i uruchamia ponownie Discorda tylko wtedy, gdy masz włączone automatyczne aktualizacje. W przeciwnym razie informuje cię i czeka, aż naciśniesz Aktualizuj teraz. Pluginy aktualizują się razem z nią tylko przy włączonej automatycznej aktualizacji pluginów.",
            ],
        },
        "2.1.0": {
            added: [
                "**Pamięć w karcie Wydajność.** Zobacz, ile używa Discord, i jeśli chcesz, pozwól Evi uruchomić go ponownie, gdy pod twoją nieobecność zużywa za dużo. Nigdy podczas rozmowy i najwyżej raz dziennie.",
                "**Tryb gry.** Ukryty tryb gry samego Discorda jako przełącznik w karcie Wydajność: gdy grasz, Discord zwalnia w tle i zatrzymuje GIF-y. Podczas rozmów pozostaje wyłączony.",
            ],
            improved: [
                "**Szybszy start.** Evi pamięta, gdzie pluginy wpinają się w Discorda, więc od drugiego uruchomienia danej wersji Discorda jest gotowy mniej więcej cztery razy szybciej przy wielu pluginach. Wyłączone pluginy nie ładują się, dopóki ich nie włączysz.",
                "**Lżejszy w użyciu.** Kropki pisania nie są już co klatkę rysowane od nowa przez JavaScript, przyciski rozmowy przestają w kółko rozmywać wideo za sobą, a gdy Discord jest ukryty od 10 minut, Evi opróżnia jego pamięć podręczną obrazów (nigdy podczas rozmowy).",
            ],
            fixed: [
                "**Ustawienia Chromium z pluginów zostają.** Discord po cichu nadpisywał je przy starcie.",
            ],
        },
        "2.0.0": {
            added: [
                "**Dwanaście nowych pluginów.** Desktop Voice Messages, Embed Builder z Components V2, Audit Log Plus, Role Colours Everywhere, Rich Presence Builder, Search Highlight, Click Actions, Soundboard Stealer, Quick Markup, Fix Embeds, Code Block Tools i Hover Converter. Wszystkie w sklepie, wszystkie wyłączone, dopóki ich nie włączysz.",
                "**Przewodnik po nowościach.** Przy pierwszym uruchomieniu 2.0 pokazuje nowe pluginy i włącza te, które wybierzesz.",
                "**Publikuj własne pluginy.** Przycisk na stronie Pluginów otwiera twój panel autora: instalacje, aktywni użytkownicy, oceny, recenzje i to, jak każdy build Discorda radzi sobie z twoimi pluginami.",
            ],
            improved: [
                "**Menu wyglądają jak w Discordzie.** Każda lista rozwijana w Evi i jego pluginach otwiera się jak w Discordzie, bez paska przewijania i z filtrem dla długich list.",
                "**Powrót tam, gdzie byłeś.** Wracając z pluginu w sklepie, trafiasz na tę samą stronę, z tymi samymi filtrami i w tym samym miejscu.",
                "**Ważne aktualizacje docierają szybciej.** Gdy aktualizacja jest potrzebna, Evi od razu ją pobiera i restartuje Discorda, gdy nie jesteś w rozmowie.",
            ],
            fixed: [
                "**Pluginy nie są już bez powodu oznaczane jako zepsute.** Plugin czekający na część Discorda, która jeszcze się nie otworzyła, był zgłaszany jako zepsuty.",
                "**Okna dialogowe otwierają się od góry.** Niektóre otwierały się przewinięte do połowy w ustawieniach Discorda.",
            ],
        },
        "1.5.0": {
            added: [
                "**Wiadomości od zespołu Evi, na żywo.** Ogłoszenia pojawiają się u góry ekranu kilka sekund po wysłaniu i zostają, dopóki ich nie zamkniesz.",
            ],
            fixed: [
                "**Powiadomienia pluginów znów się pokazują.** Discord zmienił dziś sposób wyświetlania wyskakujących okienek i te od pluginów przestały się pojawiać.",
            ],
        },
        "1.4.3": {
            fixed: [
                "**Twój motyw kolorów Discorda nie miesza się z motywem Evi.** Z motywem Evi części, których nie koloruje (jak stopka okna), miały odcień twojego motywu Discorda.",
                "**Bez pasa pod oknami z tapetą.** Stopki okien pokazywały tapetę dwa razy, w innym kolorze.",
            ],
        },
        "1.4.2": {
            improved: [
                "**Tryb awaryjny możesz wyłączyć.** W Ogólne → Aktualizacje jest „Włączaj tryb awaryjny sam”: po wyłączeniu awarie nigdy go nie włączają.",
            ],
            fixed: [
                "**Nic z Evi nad twoimi grami.** Tryb awaryjny i inne powiadomienia pojawiały się w nakładce Discorda w grze, gdzie nie dało się ich zamknąć, a zamknięcie nakładki przez grę liczyło się jako awaria Discorda.",
            ],
        },
        "1.4.1": {
            added: [
                "**Evi Setup dla macOS i Linuxa.** Instaluj, aktualizuj i usuwaj Evi z okna na każdym systemie, bez terminala. Na Linuxie pyta o hasło, gdy folder Discorda tego wymaga, a na macOS i Linuxie sam przywraca Evi po aktualizacjach Discorda.",
            ],
        },
        "1.4.0": {
            added: [
                "**Spotify Player w sklepie.** Mały odtwarzacz nad panelem użytkownika: utwór, okładka, odtwarzanie i pauza, poprzedni i następny oraz miejsce w utworze.",
            ],
            improved: [
                "**Wyszukiwanie w sklepie rozumie, o co ci chodzi.** Liczy się każde słowo, w dowolnej kolejności, literówki są wybaczane, najlepsze dopasowanie jest pierwsze, a angielska nazwa pluginu znajduje go w każdym języku.",
            ],
            fixed: [
                "**Aktualizacje nadal działają** z wydaniami, które nie zawierają już instalatora wiersza poleceń.",
            ],
        },
        "1.3.1": {
            fixed: [
                "**Panel użytkownika zachowuje miejsce.** Gdy Game Activity Toggle i Fake Deafen są włączone, ich przełączniki dzielą jeden przycisk Evi z menu, więc Twoja nazwa i zębatka ustawień Discorda nie są wypychane.",
            ],
        },
        "1.3.0": {
            added: [
                "**Powiadomienia na żywo.** Recenzje, akceptacje, aktualizacje Evi i nowości od obserwowanych autorów pojawiają się w rogu, gdy przychodzą. Najedź, by je zatrzymać, kliknij, by przejść, albo wyłącz je w skrzynce.",
            ],
            improved: [
                "**Pluginy są od siebie oddzielone.** Plugin nie może użyć pełnego dostępu innego, a przywrócenie kopii pyta przed włączeniem pluginu z pełnym dostępem.",
                "**Pytanie, gdy to ważne.** Gdy aktualizacja zmienia część pluginu z pełnym dostępem, Evi pyta przed instalacją.",
            ],
            fixed: [
                "**Tapeta nie wchodzi już do gier.** Nakładka Discorda w grze pokazywała ją na całej grze.",
            ],
        },
        "1.2.0": {
            added: [
                "**Pluginy dla wspierających się wyróżniają.** W sklepie są złote, a ich strona dziękuje ci albo pokazuje, jak zostać wspierającym.",
            ],
            improved: [
                "**Jeden motyw naraz.** Włączenie motywu wyłącza pozostałe, żeby nie walczyły o kolory.",
                "**Profile są aktualne.** Zmień nazwę lub awatar na Discordzie, a evi.rest, podziękowania i strony autorów zaktualizują się same.",
                "**Przyciski jak w Discordzie.** Fake Deafen i Game Activity Toggle używają przycisków Discorda, a Fake Deafen ma ducha, żeby nie mylić go z wyciszeniem.",
                "**Spokojniejsza strona główna sklepu.** Nie ma już sekcji Nowe w tym tygodniu, a zainstalowane pluginy mają znaczek obok nazwy.",
            ],
            fixed: [
                "**Voice Chat Utilities naprawdę działa.** Zgłaszał, że przeniósł, wyciszył lub rozłączył ludzi, ale jego żądania nigdy nie docierały do Discorda.",
                "**Koniec fałszywych oznaczeń „zepsuty”.** View Icons był oznaczony jako zepsuty, bo część czeka na otwarcie przeglądarki obrazów.",
                "**Video Controls+ działa na czacie.** Sterowanie pojawia się na filmach na czacie, nie tylko na pełnym ekranie.",
                "**Pluginy nie zmieniają już sobie nawzajem wyglądu.** Style Link Safety przenikały do ustawień Last Seen.",
            ],
        },
        "1.1.2": {
            added: [
                "**Udostępniaj pluginy na czacie.** Skopiuj link pluginu z jego strony w sklepie i wklej go na dowolnym czacie Discorda. Każdy z Evi zobaczy kartę, żeby od razu go zainstalować.",
                "**Udawane wyciszenie.** Wyglądaj na kanale głosowym na wyciszonego, nadal wszystkich słysząc. Podziękowanie dla wspierających.",
                "**Voice Chat Utilities.** Kliknij prawym przyciskiem kanał głosowy, żeby przenieść, rozłączyć, wyciszyć lub ogłuszyć wszystkich, jeśli masz uprawnienia.",
            ],
            fixed: [
                "Kolejność odznak zapisuje się pewniej.",
            ],
        },
        "1.1.1": {
            added: [
                "**Edytuj obraz, jak w Discordzie.** Przesuwaj, przybliżaj i obracaj tapetę w podglądzie w kształcie twojego okna.",
                "**Twoja tapeta na ekranie logowania.** Widać ją za stroną logowania Discorda, a okno logowania jest nad nią zmatowione.",
                "**Usuwaj własne motywy.** Motywy, które zrobiłeś lub dodałeś sam, mają teraz przycisk usuwania.",
            ],
            improved: [
                "**Prostsze ustawienia tapety.** Włącz ją, przyciemnij i wybierz, jak przezroczysty jest Discord. Reszta jest w Więcej opcji.",
                "**Nowa strona wspierających.** Twój poziom, kiedy przyjdzie następny i co dostajesz, w Koncie. Podziękowania w Aktualizacjach pokazują wszystkich z twarzami.",
                "Odznaki wspierających mają kolor swojego poziomu: własnych kolorów odznak już nie ma.",
            ],
            fixed: [
                "**Tapeta znowu jest widoczna.** Zasłaniało ją własne tło Discorda i lista członków.",
                "**Zmiana kolejności odznak znowu się zapisuje.** Discord odrzucał cały zapis przez odznaki Evi; teraz twoja kolejność dociera do wszystkich.",
            ],
        },
        "1.1.0": {
            added: [
                "**Evi mówi w twoim języku.** Evi, wszystkie pluginy i sklep używają języka Discorda: niemieckiego, hiszpańskiego, francuskiego, japońskiego, polskiego, portugalskiego, rosyjskiego i tureckiego, oprócz angielskiego.",
                "**Ustaw tapetę po swojemu.** Wypełnij, Dopasuj, Rozciągnij, Wyśrodkuj albo Sąsiadująco, a potem przeciągaj i przybliżaj ją w podglądzie Discorda na żywo.",
                "**Wybierz, co ma być przezroczyste.** Ustaw, jak bardzo lista serwerów, kanały, czat i pole wiadomości zakrywają tapetę, i zabarw je kolorami swojego motywu.",
            ],
            improved: [
                "**Discord działa dużo płynniej.** Evi usuwa ukrytą regułę stylów Discorda, przez którą cała aplikacja przeliczała style przy każdej zmianie, na przykład gdy ktoś mówi na rozmowie: w zatłoczonej rozmowie najdłuższe przycięcie spadło z około 100 ms do 15 ms, a ustawienia otwierają się szybciej. Czcionki Discorda ładują się też w tle, więc tekst nie przeskakuje, gdy styl zostanie użyty pierwszy raz.",
                "**Mniejsze aktualizacje.** Od następnej wersji aktualizacja Evi pobiera tylko jego pliki, kilka MB, zamiast całego 100-megabajtowego instalatora.",
                "**Ustawienia i wyskakujące okna zostają nieprzezroczyste.** Tapetę widać tylko za głównym oknem Discorda, chyba że włączysz ją też dla ustawień albo wyskakujących okien.",
                "**Kod źródłowy pokazuje prawdziwy kod.** Na stronie pluginu społeczności otwiera dokładnie ten kod, który instaluje Evi, a link autora jest obok.",
            ],
            fixed: [
                "Edytor motywów zachowuje tłumaczenia motywu przy zapisywaniu.",
            ],
        },
        "1.0.0": {
            added: [
                "**Strona główna sklepu.** To, co jest na topie, nowości tego tygodnia, wybory redakcji i kolekcje przygotowane przez zespół Evi, jeszcze przed pełną listą.",
                "**Oceny i recenzje.** Oceniaj pluginy, których używasz, i w kilku linijkach napisz dlaczego. Recenzje, które ktoś zgłosi, trafiają do zespołu Evi.",
                "**Strony pluginów pokazują więcej.** Wideo lub GIF z użycia, co jeszcze instalują osoby, które go używają, znane problemy i notatka autora o danej wersji.",
                "**Lista życzeń i skrzynka odbiorcza.** Daj serduszko czemukolwiek w sklepie, żeby dowiedzieć się, gdy dostanie aktualizację, betę albo znów zacznie działać. Recenzje twoich pluginów, twoje przesłane pliki i wiadomości od obserwowanych autorów trafiają też do nowej Skrzynki odbiorczej.",
                "**Obserwuj autorów.** Strony autorów mają baner, przypięte pluginy, liczbę osób używających ich pluginów i przycisk Obserwuj.",
                "**Bety pluginów.** Autorzy mogą opublikować betę obok wersji stabilnej, a ty możesz zapisać się na bety dowolnego pluginu na jego stronie.",
                "**Dynamiczna tapeta.** Obraz lub wideo za Discordem, przyciemnione, żeby tekst był czytelny, i wstrzymywane na baterii.",
                "**Crash Detective.** Gdy Discord się zawiesi lub zamknie awaryjnie, Evi mówi, który plugin był najbardziej obciążony tuż przedtem, i proponuje jego wyłączenie.",
                "**Aktualizacje w tle.** Włącz je w Aktualizacjach, a nowe wersje pobiorą się same i zainstalują po zamknięciu Discorda.",
                "**Skróty klawiszowe dla pluginów.** Ustaw skrót w ustawieniach pluginu, naciskając klawisze, tak jak w skrótach Discorda. Streamer Mode+ i Game Activity Toggle mają po jednym, a pole informuje, gdy dwa pluginy chcą tych samych klawiszy.",
                "**Bonusy dla wspierających.** Twoja odznaka wspierającego w wybranym przez ciebie kolorze, twoje imię w napisach, jeśli chcesz, i Aurora, motyw dla wspierających.",
                "**Who Reacted.** Małe awatary osób, które zareagowały, tuż przy każdej reakcji obok licznika.",
                "**Typing Tweaks.** Zobacz od razu, kto pisze: awatary i kolory ról w wierszu „pisze...” oraz trzy kropki przy kanałach i wiadomościach prywatnych, gdy ktoś tam pisze.",
                "**Dla autorów pluginów:** Evi DevTools (zdarzenia Flux na żywo, store'y, trafienia patchy i czasy), dokumentacja API po najechaniu w Patch Helper, publiczny dziennik zmian API pluginów, anonimowe liczby instalacji i awarii w panelu oraz `bun run new-plugin` / `bun run preview-plugin`, żeby zacząć plugin i go sprawdzić.",
            ],
            improved: [
                "**Wyszukiwanie znajduje ustawienia, nie tylko pluginy.** Szukanie w zakładce Pluginy przeszukuje też ustawienia każdego pluginu, a otwarcie wyniku prowadzi prosto do ustawienia.",
                "**Pokaż tylko to, czego jeszcze nie masz** dzięki nowemu filtrowi Niezainstalowane w sklepie i sortuj według oceny lub popularności.",
                "Streamer Mode+ zachowuje skrót, który wpisałeś, teraz jako nagrany skrót.",
                "Autorzy pluginów widzą, ilu osobom służą ich pluginy: raz dziennie Evi anonimowo informuje evi.rest, które pluginy ze sklepu ma zainstalowane. Możesz to wyłączyć w ustawieniach sklepu.",
                "Quick Actions nie jest już częścią Evi i zostaje usunięty przy aktualizacji Evi.",
                "**View Icons przeniósł się do profili.** Kliknij czyjś baner, by otworzyć go w pełnym rozmiarze jak awatar, a Pobierz znajduje się obok powiększenia. Pozycje w menu prawego przycisku zniknęły.",
            ],
            fixed: [
                "**Message Logger zachowuje usunięte zdjęcia, filmy i pliki.** Discord usuwa je ze swoich serwerów razem z wiadomością, więc wcześniej wyświetlały się jako uszkodzone. Edycje, które usuwają załącznik, też zachowują go przy starej wersji.",
            ],
        },
        "0.7.0": {
            added: [
                "**Pluginy mówią, czego potrzebują, a Evi tego pilnuje.** Z jakimi stronami plugin się łączy i czy czyta twoje wiadomości, wysyła wiadomości lub zmienia twoje ustawienia. Evi blokuje całą resztę, co plugin próbuje zrobić przez Evi, a zablokowane rzeczy widać w Aktywności pluginu.",
                "**Evi naprawia pluginy, które psuje Discord, nie czekając na aktualizację.** Gdy aktualizacja Discorda psuje plugin, zespół Evi naprawia go na evi.rest, a każda instalacja dostaje poprawkę w ciągu kilku minut. Szczegóły pluginu mówią, co naprawiono.",
                "**Stwórz własny motyw.** Wybieraj kolory w nowej zakładce Edytor, patrz, jak Discord zmienia się na bieżąco, a potem zapisz go jako własny motyw.",
                "**Motywy społeczności.** Wyślij motyw do Sklepu z motywami z edytora lub panelu. Zespół Evi sprawdza każdy z nich, a motywy społeczności nie mogą niczego ładować z internetu, więc nikt nie dowie się, kto ich używa.",
                "**DM Categories.** Posortuj wiadomości prywatne w zwijane kategorie, jak Znajomi, Praca czy Gry, na górze listy. Kliknij prawym przyciskiem wiadomość prywatną, by dodać ją do kategorii.",
                "**View Icons.** Kliknij kogoś prawym przyciskiem, by zobaczyć jego awatar i baner w pełnym rozmiarze, albo serwer, by zobaczyć jego ikonę i baner, w przeglądarce obrazów Discorda. Pobierz oryginał lub skopiuj jego link.",
                "**Calm Name Effects.** Otwieranie czatu kosztuje o połowę mniej pracy: style nazw Nitro, takie jak Prism i Neon, animują się, gdy najedziesz na nazwę, a nie przy każdej wiadomości naraz.",
            ],
            improved: [
                "**Aktualizacja, która prosi o więcej, czeka na twoją zgodę,** tak jak pełny dostęp. Strony sklepu, pytania przy instalacji i szczegóły pluginów wymieniają, o co prosi każdy plugin, a starsze pluginy, które tego nie podają, są oznaczone.",
                "**Sklep wie, że poprawka działa.** Plugin naprawiony przez Evi wyświetla się jako naprawiony zamiast zepsuty i wraca do zepsutego tylko wtedy, gdy instalacje z poprawką nadal mają problemy.",
                "Motywy w sklepie można zgłaszać, tak jak pluginy.",
            ],
            fixed: [
                "Ikona Platform Indicators nie rośnie już na całą wiadomość w miejscach, do których nie docierają style Evi, jak czaty w osobnych oknach.",
            ],
        },
        "0.6.1": {
            fixed: [
                "**Smooth Typing nie przywraca już do pola tekstowego wiadomości, którą właśnie wysłałeś.** Zmiana kanału i polecenia slash również utrzymują pole w aktualnym stanie.",
                "Plugin, który Evi wyłączył albo który ma problem do wyjaśnienia, zachowuje rozmiar karty na liście Pluginów zamiast rozciągać się na całą szerokość.",
            ],
        },
        "0.6.0": {
            improved: [
                "**Koniec z przycięciami przez Evi.** Szukanie elementów Discorda przeszukiwało cały kod Discorda, za każdym razem 10 do 20 ms, a brakujący element był szukany od nowa co sekundę. Teraz jest znajdowany raz, a każde kolejne wyszukanie jest natychmiastowe.",
                "**Pluginy wykonują ciężką pracę małymi porcjami,** pomiędzy wszystkim innym: Fast Lists, Read All, GIF Folders i zapisywanie w Last Seen nie wstrzymują już Discorda.",
                "**Show Hidden Channels zapamiętuje, kto co widzi,** zamiast pytać od nowa o każdy kanał przy każdym odświeżeniu.",
                "**Szybsze: Message Logger, Inline Translate, Platform Indicators, Voice Activity Log, Relationship Notifier, Hide Blocked, Timezones, Friend Online Alerts, Streamer Mode+, Silent Typing i Snippets.**",
                "Sprawdzanie kondycji pluginów w tle jest znacznie lżejsze.",
            ],
            fixed: [
                "**Plugin, który Evi wyłącza wszędzie, wyłącza się w ciągu kilku sekund,** z powiadomieniem, zamiast przy następnym sprawdzeniu co pół godziny lub po restarcie.",
            ],
        },
        "0.5.3": {
            fixed: [
                "Odznaka Plugin Author po kliknięciu otwiera swoje szczegóły i można ją ukrywać i przesuwać w Dostosuj swoje odznaki.",
            ],
        },
        "0.5.2": {
            improved: [
                "**Sprawdzanie aktualizacji idzie przez evi.rest,** więc zajęta sieć nie trafia już na limit GitHuba i nie pokazuje, że Evi nie może sprawdzić aktualizacji.",
                "**Instalacja pluginu z pełnym dostępem pyta w oknie dialogowym** zamiast w ramce wciśniętej w jego kartę.",
                "**Ikony na każdej zakładce,** żeby Zainstalowane i Sklep dało się odróżnić na pierwszy rzut oka.",
                "**Każde wydanie dostaje swoją kropkowaną okładkę** w Nowościach.",
            ],
            fixed: [
                "Otwarcie Sklepu nie przewija już ustawień Discorda odrobinę w dół.",
            ],
        },
        "0.5.1": {
            added: [
                "**Pluginy społeczności z częścią natywną.** Autorzy mogą przesłać native.js razem z pluginem. Zespół Evi czyta całość, zanim trafi do sklepu, a Evi nadal pyta cię przed zainstalowaniem czegokolwiek z pełnym dostępem.",
            ],
            fixed: [
                "Otwarcie stron Evi w ustawieniach Discorda nie powoduje już awarii Discorda.",
            ],
        },
        "0.5.0": {
            added: [
                "**Evi Setup.** Mały instalator z oknem: wybierz swojego Discorda i kliknij Zainstaluj Evi albo Odinstaluj Evi. Najpierw sprawdza, czy jest nowsze Evi, i je pobiera, więc to kilka MB zamiast ponad 100.",
                "**Evi w twoim języku.** Menu Evi podążają za językiem Discorda: hiszpański, portugalski, francuski, niemiecki, turecki, rosyjski, polski i japoński. Pluginy też można tłumaczyć.",
                "**Zobacz, co zrobił plugin.** Szczegóły pluginu wymieniają strony, z którymi się połączył, i kiedy, oraz wskazują te, o których jego kod nigdy nie wspomina.",
                "**Wersje beta.** Włącz Otrzymuj wersje beta w Aktualizacjach, by dostawać nowe wersje Evi kilka dni wcześniej.",
                "**Odznaka Plugin Author.** Każdy, czyj plugin trafi do sklepu, dostaje ją na swój profil.",
            ],
            improved: [
                "Włączanie i wyłączanie pluginu nie zawiesza już Discorda na chwilę.",
                "**Poziomy wspierającego przychodzą co miesiąc.** Nowa odznaka co miesiąc przez pierwsze sześć miesięcy, od Silver po miesiącu do Ruby po sześciu, a potem Prismatic po roku.",
            ],
            fixed: [
                "Kliknięcie przełącznika pluginu nie odsuwa już ustawień Discorda od niego przewinięciem.",
            ],
        },
        "0.4.0": {
            added: [
                "**Pluginy społeczności w sklepie.** Autorzy pluginów mogą teraz publikować własne pluginy na evi.rest. Zespół Evi czyta każdą wersję, zanim trafi do sklepu, a pluginy społeczności są oznaczone, żebyś zawsze wiedział, kto co stworzył.",
                "**Zweryfikowani autorzy.** Każdy plugin pokazuje, kto go stworzył, ze znaczkiem dla zweryfikowanych autorów. Kliknij nazwę, by zobaczyć inne pluginy autora.",
                "**Wyślij raport o awarii autorowi.** Obok Kopiuj raport o awarii. Widzisz dokładnie, co zostanie wysłane, zanim to wyślesz, i nie ma tam nic osobistego.",
                "**Dowiedz się, kiedy plugin jest zepsuty.** Jeśli plugin przestaje działać u wielu osób po aktualizacji Discorda, sklep i twoja lista Pluginów o tym informują, często z notatką autora o poprawce.",
                "**Zgłoś plugin.** Coś szkodliwego, fałszywego lub zepsutego? Zgłoś to na jego stronie w sklepie. Zgłoszenia trafiają do zespołu Evi.",
                "**Evi może wyłączyć zły plugin wszędzie.** Jeśli plugin okaże się szkodliwy, Evi wyłącza go na każdej instalacji i mówi ci dlaczego.",
            ],
            improved: [
                "**Nowości, które wyglądają jak Evi.** Okładka wydania u góry i każdy rodzaj zmian pod własną etykietą.",
                "**Okna czekają na Discorda.** Nowości, dzienniki zmian pluginów i powiadomienie o aktualizacji pokazują się, gdy Discord się załaduje, a nie nad jego ekranem ładowania.",
                "**Odznaki wspierających awansują szybciej.** Prismatic to teraz rok wsparcia zamiast pięciu.",
                "**Odznaki pluginów w Twoich odznakach.** Odznaki, które pluginy dodają do profili, jak zegar Last Seen i urządzenie Platform Indicators, są też na liście odznak Discorda.",
                "**Bezpieczniej z założenia.** Włączenie pluginu z pełnym dostępem do twojego komputera zawsze pyta w systemowym oknie, na które żaden plugin nie może odpowiedzieć za ciebie.",
            ],
            fixed: [
                "Instalacja pluginu ze sklepu zawsze go włącza. Wcześniej mówiła, że to zrobiła, a czasem tak nie było.",
                "Listy rozwijane w ustawieniach pluginu otwierają się po pierwszym kliknięciu. W ustawieniach Discorda często od razu się zamykały.",
            ],
        },
        "0.3.2": {
            improved: [
                "**Okna i menu poruszają się jak w Discordzie.** Okna dialogowe, powiadomienia i menu pluginów Evi otwierają się teraz sprężyście i znikają płynnie, zamiast wyskakiwać i nagle znikać.",
                "**Czytelniejszy Voice Activity Log** z sesjami pogrupowanymi według kanału i porządnym polem wyszukiwania.",
            ],
        },
        "0.3.1": {
            added: [
                "**Evi na macOS i Linuksie.** Pobierz instalator dla swojego systemu z wydania i uruchom `evi install`. Na Linuksie uruchom go przez sudo.",
            ],
        },
        "0.3.0": {
            added: [
                "**Odznaki Evi są częścią Evi.** Widać je na profilach wszystkich, którzy używają Evi, i nie można ich wyłączyć przypadkiem.",
                "**Ukrywaj i zmieniaj kolejność swoich odznak Evi** w Dostosuj swoje odznaki w samym Discordzie. Wszyscy zobaczą zmianę w ciągu kilku sekund.",
                "**Odznaki wspierających, które awansują.** Od Bronze do Prismatic, im dłużej wspierasz Evi, a twój postęp widać w Twoich odznakach.",
                "**Aktualizuj Evi z poziomu aplikacji.** Evi mówi, gdy jest nowa wersja, a jeden przycisk ją instaluje.",
            ],
            improved: [
                "Odznaki aktualizują się na żywo zamiast co pół godziny.",
                "Każdy plugin można usunąć, także te dołączone do Evi, i pozostają usunięte po aktualizacjach Evi.",
            ],
        },
        "0.2.0": {
            added: [
                "**Sklep z pluginami jest teraz w zakładce Pluginy.** Każdy plugin ma własną stronę ze zrzutami ekranu, dziennikiem zmian, kodem źródłowym i tym, do czego ma dostęp.",
                "**Sklep z motywami.** Instaluj i aktualizuj motywy bezpośrednio w zakładce Motywy.",
                "**Aktualizuj wszystko i automatyczne aktualizacje, jeśli chcesz.** Pluginy z pełnym dostępem do twojego komputera nadal pytają wcześniej.",
                "**Raporty o awariach.** Plugin, który się nie uruchamia, ma przycisk Kopiuj raport o awarii dla swojego autora.",
            ],
            improved: [
                "Przeglądaj sklep według kategorii i sortuj go według nazwy lub ostatniej aktualizacji.",
                "Aktualizuj i odinstalowuj pluginy ze sklepu bezpośrednio z listy Pluginów.",
                "Wyłącz wszystkie pluginy lub zresetuj je do ustawień domyślnych jednym kliknięciem, z możliwością cofnięcia.",
            ],
        },
        "0.1.0": {
            added: ["**Pierwsze wydanie.** Pluginy, motywy, Quick CSS, kopie zapasowe, tryb awaryjny i sklep z pluginami."],
        },
    },
    "pt-BR": {
        "2.2.0": {
            fixed: [
                "**As atualizações seguem suas configurações.** Quando a equipe do Evi diz que uma atualização é necessária, o Evi só a baixa e reinicia o Discord sozinho se as atualizações automáticas estiverem ativadas. Caso contrário, ele avisa e espera você tocar em Atualizar agora. Os plugins só vêm junto se a atualização automática de plugins estiver ativada.",
            ],
        },
        "2.1.0": {
            added: [
                "**Memória na aba Desempenho.** Veja quanto o Discord usa e, se quiser, deixe o Evi reiniciá-lo quando ele usar demais enquanto você está ausente. Nunca durante uma chamada e no máximo uma vez por dia.",
                "**Modo de jogo.** O modo de jogo escondido do próprio Discord, como uma chave na aba Desempenho: enquanto você joga, o Discord desacelera em segundo plano e para os GIFs. Ele fica desligado durante chamadas.",
            ],
            improved: [
                "**Inicia mais rápido.** O Evi lembra onde os plugins se conectam ao Discord, então a partir da segunda inicialização de uma versão do Discord ele fica pronto cerca de quatro vezes mais rápido com muitos plugins. Plugins desligados não carregam até você ligá-los.",
                "**Mais leve no dia a dia.** Os pontinhos de digitação não são mais redesenhados com JavaScript a cada quadro, os botões de chamada param de desfocar de novo e de novo o vídeo atrás deles, e quando o Discord fica oculto por 10 minutos o Evi esvazia os caches de imagens (nunca durante uma chamada).",
            ],
            fixed: [
                "**As configurações do Chromium dos plugins ficam.** O Discord as sobrescrevia sem avisar ao iniciar.",
            ],
        },
        "2.0.0": {
            added: [
                "**Doze plugins novos.** Desktop Voice Messages, Embed Builder com Components V2, Audit Log Plus, Role Colours Everywhere, Rich Presence Builder, Search Highlight, Click Actions, Soundboard Stealer, Quick Markup, Fix Embeds, Code Block Tools e Hover Converter. Todos na loja, todos desativados até você ativá-los.",
                "**Um tour pelas novidades.** Na primeira vez que o 2.0 inicia, ele mostra os plugins novos e ativa os que você escolher.",
                "**Publique seus próprios plugins.** Um botão na página de Plugins abre seu painel de autor: instalações, usuários ativos, avaliações, resenhas e como cada build do Discord lida com seus plugins.",
            ],
            improved: [
                "**Os menus parecem os do Discord.** Todo menu suspenso do Evi e dos plugins abre como no Discord, sem barra de rolagem e com filtro para listas longas.",
                "**De volta para onde você estava.** Ao voltar de um plugin na loja, você retorna à mesma página, filtros e rolagem.",
                "**Atualizações importantes chegam antes.** Quando uma atualização é necessária, o Evi baixa na hora e reinicia o Discord quando você não está em uma chamada.",
            ],
            fixed: [
                "**Plugins não são mais chamados de quebrados sem motivo.** Um plugin que esperava uma parte do Discord que ainda não tinha aberto era reportado como quebrado.",
                "**Diálogos abrem no topo.** Alguns abriam rolados até a metade dentro das configurações do Discord.",
            ],
        },
        "1.5.0": {
            added: [
                "**Novidades da equipe do Evi, ao vivo.** Os anúncios aparecem no topo da sua tela segundos depois de enviados e ficam até você fechá-los.",
            ],
            fixed: [
                "**As notificações dos plugins voltaram a aparecer.** O Discord mudou hoje a forma de mostrar seus pop-ups, e os dos plugins pararam de aparecer.",
            ],
        },
        "1.4.3": {
            fixed: [
                "**Seu tema de cores do Discord não se mistura mais ao do Evi.** Com um tema do Evi, partes que ele não colore (como o rodapé de uma janela) mostravam o tom do seu tema do Discord.",
                "**Sem faixa sob as janelas com papel de parede.** O rodapé das janelas mostrava o papel de parede duas vezes, em outra cor.",
            ],
        },
        "1.4.2": {
            improved: [
                "**O modo seguro é você quem decide.** Em Geral → Atualizações tem \"Ativar o modo seguro sozinho\": desativado, travamentos nunca o ativam.",
            ],
            fixed: [
                "**Nada do Evi por cima dos seus jogos.** O modo seguro e outros avisos apareciam na sobreposição do Discord no jogo, sem como fechar, e um jogo fechando a sobreposição contava como travamento do Discord.",
            ],
        },
        "1.4.1": {
            added: [
                "**Evi Setup para macOS e Linux.** Instale, atualize e remova o Evi por uma janela em qualquer sistema, sem terminal. No Linux ele pede sua senha quando a pasta do Discord exige, e no macOS e no Linux ele recoloca o Evi sozinho depois das atualizações do Discord.",
            ],
        },
        "1.4.0": {
            added: [
                "**Spotify Player na loja.** Um pequeno player acima do seu painel de usuário com a música, a capa, tocar e pausar, anterior e próxima, e em que ponto você está.",
            ],
            improved: [
                "**A busca da loja entende o que você procura.** Toda palavra conta, em qualquer ordem, erros de digitação são perdoados, o melhor resultado vem primeiro, e o nome em inglês de um plugin o encontra em qualquer idioma.",
            ],
            fixed: [
                "**As atualizações continuam funcionando** com versões que não trazem mais o instalador de linha de comando.",
            ],
        },
        "1.3.1": {
            fixed: [
                "**O painel de usuário mantém o espaço.** Com Game Activity Toggle e Fake Deafen ligados, os interruptores dividem um botão do Evi com menu, e seu nome e a engrenagem de configurações do Discord não são empurrados para fora.",
            ],
        },
        "1.3.0": {
            added: [
                "**Notificações ao vivo.** Avaliações, aprovações, atualizações do Evi e novidades de autores que você segue aparecem no canto quando chegam. Passe o mouse para mantê-las, clique para ir até lá ou desative na caixa de entrada.",
            ],
            improved: [
                "**Plugins separados.** Um plugin não pode usar o acesso total de outro, e restaurar um backup pergunta antes de ativar um plugin com acesso total.",
                "**Pergunta quando importa.** Quando uma atualização muda a parte com acesso total de um plugin seu, o Evi pergunta antes de instalar.",
            ],
            fixed: [
                "**Seu papel de parede fica fora dos seus jogos.** A sobreposição de jogo do Discord mostrava ele sobre o jogo inteiro.",
            ],
        },
        "1.2.0": {
            added: [
                "**Plugins para apoiadores se destacam.** Eles são dourados na loja, e a página agradece ou mostra como virar apoiador.",
            ],
            improved: [
                "**Um tema por vez.** Ligar um tema desliga os outros, para não brigarem pelas cores.",
                "**Perfis sempre atualizados.** Mude seu nome ou avatar no Discord e o evi.rest, os créditos e as páginas de autor acompanham sozinhos.",
                "**Botões como os do Discord.** Fake Deafen e Game Activity Toggle usam os botões do próprio Discord, e o Fake Deafen tem um fantasma para não confundir com ensurdecer.",
                "**Uma página inicial da loja mais tranquila.** Novidades da semana saiu, e plugins instalados ganham um visto ao lado do nome.",
            ],
            fixed: [
                "**Voice Chat Utilities funciona de verdade.** Dizia que tinha movido, silenciado ou desconectado as pessoas, mas as requisições nunca chegavam ao Discord.",
                "**Chega de avisos falsos de “quebrado”.** O View Icons aparecia quebrado porque uma parte espera o visualizador de imagens abrir.",
                "**Video Controls+ funciona no chat.** Os controles aparecem nos vídeos do chat, não só em tela cheia.",
                "**Plugins não mudam mais o estilo um do outro.** Os estilos do Link Safety vazavam para as configurações do Last Seen.",
            ],
        },
        "1.1.2": {
            added: [
                "**Compartilhe plugins no chat.** Copie o link de um plugin na página dele na loja e cole em qualquer chat do Discord. Quem tem Evi vê um cartão para instalar ali mesmo.",
                "**Ensurdecer falso.** Apareça ensurdecido na voz enquanto continua ouvindo todos. Um agradecimento para apoiadores.",
                "**Voice Chat Utilities.** Clique com o botão direito num canal de voz para mover, desconectar, silenciar ou ensurdecer todos, se tiver permissão.",
            ],
            fixed: [
                "A ordem das suas insígnias é salva de forma mais confiável.",
            ],
        },
        "1.1.1": {
            added: [
                "**Editar imagem, como no Discord.** Arraste, dê zoom e gire seu papel de parede numa prévia com o formato da sua janela.",
                "**Seu papel de parede na tela de login.** Ele aparece atrás da página de login do Discord, com a caixa de login fosca por cima.",
                "**Apague os temas que você fez.** Os temas que você criou ou adicionou agora têm um botão de apagar.",
            ],
            improved: [
                "**Configurações de papel de parede mais simples.** Mostre, escureça e escolha o quanto o Discord fica transparente. O resto está em Mais opções.",
                "**Uma nova página de apoiador.** Seu nível, quando chega o próximo e o que você ganha, em Conta. Os créditos em Atualizações mostram o rosto de todo mundo.",
                "Os emblemas de apoiador ficam com a cor do nível: as cores personalizadas saíram.",
            ],
            fixed: [
                "**O papel de parede aparece de novo.** O fundo do próprio Discord e a lista de membros estavam cobrindo ele.",
                "**Reordenar seus emblemas volta a salvar.** O Discord recusava o salvamento inteiro por causa dos emblemas do Evi; agora sua ordem chega a todo mundo.",
            ],
        },
        "1.1.0": {
            added: [
                "**O Evi fala o seu idioma.** O Evi, todos os plugins e a loja seguem o idioma do Discord: alemão, espanhol, francês, japonês, polonês, português, russo e turco, além do inglês.",
                "**Posicione seu papel de parede.** Preencher, Ajustar, Esticar, Centralizar ou Lado a lado, e depois arraste e dê zoom numa prévia do Discord ao vivo.",
                "**Escolha o que fica transparente.** Defina o quanto a lista de servidores, os canais, o chat e a caixa de mensagem ficam sólidos sobre o papel de parede, e tinja-os com as cores do seu tema.",
            ],
            improved: [
                "**O Discord ficou muito mais fluido.** O Evi remove uma regra de estilo escondida do Discord que fazia o app inteiro recalcular os estilos a cada mudança, como alguém falando numa chamada: numa chamada cheia, o maior travamento caiu de uns 100 ms para 15 ms, e as configurações abrem mais rápido. As fontes do Discord também carregam em segundo plano, então o texto não pula na primeira vez que um estilo é usado.",
                "**Atualizações menores.** A partir da próxima versão, atualizar o Evi baixa só os arquivos dele, alguns MB, em vez do instalador inteiro de 100 MB.",
                "**Configurações e pop-ups continuam sólidos.** O papel de parede só aparece atrás da janela principal do Discord, a menos que você o ative também nas configurações ou nos pop-ups.",
                "**Ver código-fonte mostra o código de verdade.** Na página de um plugin da comunidade, ele abre exatamente o código que o Evi instala, com o link do autor ao lado.",
            ],
            fixed: [
                "O editor de temas mantém as traduções de um tema quando você o salva.",
            ],
        },
        "1.0.0": {
            added: [
                "**Uma página inicial para a loja.** O que está em alta, as novidades da semana, seleções e coleções montadas pela equipe do Evi, antes da lista completa.",
                "**Avaliações e resenhas.** Avalie os plugins que você usa e diga por quê em poucas linhas. Resenhas que alguém denunciar vão para a equipe do Evi.",
                "**As páginas dos plugins mostram mais.** Um vídeo ou GIF dele em uso, o que quem o usa também instala, problemas conhecidos e uma nota do autor sobre a versão.",
                "**Uma lista de desejos e uma caixa de entrada.** Coloque um coração em qualquer item da loja para saber quando ele for atualizado, ganhar uma beta ou voltar a funcionar. Resenhas dos seus plugins, seus envios e novidades dos autores que você segue também chegam à nova Caixa de entrada.",
                "**Siga autores.** As páginas dos autores têm banner, plugins fixados, quantas pessoas usam os plugins deles e um botão Seguir.",
                "**Betas de plugins.** Os autores podem publicar uma beta ao lado da versão estável, e você pode optar pelas betas de qualquer plugin na página dele.",
                "**Papel de parede dinâmico.** Uma imagem ou vídeo atrás do Discord, escurecido para o texto continuar legível e pausado quando você está na bateria.",
                "**Crash Detective.** Quando o Discord trava ou fecha sozinho, o Evi diz qual plugin estava mais ocupado logo antes e se oferece para desativá-lo.",
                "**Atualizações em segundo plano.** Ative em Atualizações, e as novas versões são baixadas sozinhas e instaladas quando você fecha o Discord.",
                "**Atalhos de teclado para plugins.** Defina um nas configurações de um plugin pressionando as teclas, como nos atalhos do Discord. O Streamer Mode+ e o Game Activity Toggle têm um, e o campo avisa quando dois plugins querem as mesmas teclas.",
                "**Benefícios para apoiadores.** Sua insígnia de apoiador na cor que você quiser, seu nome nos créditos se você quiser e Aurora, um tema para apoiadores.",
                "**Who Reacted.** Pequenos avatares de quem reagiu, direto em cada reação, ao lado da contagem.",
                "**Typing Tweaks.** Veja num relance quem está digitando: avatares e cores de cargo na linha de «está digitando» e três pontinhos em canais e DMs enquanto alguém digita ali.",
                "**Para autores de plugins:** Evi DevTools (eventos do Flux ao vivo, stores, patches aplicados e tempos), documentação da API ao passar o mouse no Patch Helper, um registro de mudanças público da API de plugins, números anônimos de instalações e falhas no seu painel e `bun run new-plugin` / `bun run preview-plugin` para começar e conferir um plugin.",
            ],
            improved: [
                "**A busca encontra configurações, não só plugins.** Pesquisar na aba Plugins também vasculha as configurações de todos os plugins, e abrir um resultado leva você direto à configuração.",
                "**Mostre só o que você ainda não tem** com o novo filtro Não instalados da loja e ordene por avaliação ou por o que está em alta.",
                "O Streamer Mode+ mantém o atalho que você digitou, agora como um atalho gravado.",
                "Autores de plugins veem quantas pessoas usam seus plugins: uma vez por dia o Evi informa ao evi.rest, de forma anônima, quais plugins da loja ele tem. Você pode desativar isso nas configurações da loja.",
                "O Quick Actions deixou de fazer parte do Evi e é removido quando o Evi se atualiza.",
                "**O View Icons foi para os perfis.** Clique no banner de alguém para abri-lo em tamanho real como o avatar, e Baixar fica ao lado do zoom. Os itens do menu de clique com o botão direito sumiram.",
            ],
            fixed: [
                "**O Message Logger guarda imagens, vídeos e arquivos apagados.** O Discord os apaga dos servidores junto com a mensagem, então eles apareciam quebrados. Edições que removem um anexo também o mantêm na versão antiga.",
            ],
        },
        "0.7.0": {
            added: [
                "**Os plugins dizem o que precisam, e o Evi os faz cumprir.** Quais sites um plugin acessa e se ele lê suas mensagens, envia mensagens ou altera suas configurações. O Evi bloqueia o resto do que ele tentar por meio do Evi, e tudo que for bloqueado aparece na Atividade do plugin.",
                "**O Evi conserta plugins que o Discord quebra, sem esperar por uma atualização.** Quando uma atualização do Discord quebra um plugin, a equipe do Evi o conserta no evi.rest e cada instalação recebe a correção em minutos. Os detalhes do plugin dizem o que foi corrigido.",
                "**Crie seu próprio tema.** Escolha cores na nova aba Editor, veja o Discord mudar enquanto você mexe e depois salve como um tema seu.",
                "**Temas da comunidade.** Envie um tema para a Loja de temas pelo editor ou pelo seu painel. A equipe do Evi analisa cada um, e temas da comunidade não conseguem carregar nada da internet, então ninguém descobre quem os usa.",
                "**DM Categories.** Organize suas DMs em categorias recolhíveis como Amigos, Trabalho ou Jogos, no topo da sua lista de DMs. Clique com o botão direito em uma DM para adicioná-la a uma.",
                "**View Icons.** Clique com o botão direito em alguém para ver o avatar e o banner em tamanho real, ou em um servidor para ver o ícone e o banner, no visualizador de imagens do Discord. Baixe o original ou copie o link.",
                "**Calm Name Effects.** Abrir um chat dá metade do trabalho: estilos de nome do Nitro como Prism e Neon animam enquanto você passa o mouse sobre um nome, em vez de em todas as mensagens ao mesmo tempo.",
            ],
            improved: [
                "**Uma atualização que pede mais espera o seu OK,** como o acesso total. As páginas da loja, as perguntas de instalação e os detalhes dos plugins listam o que cada plugin pede, e plugins antigos que não informam ficam com uma etiqueta.",
                "**A loja sabe quando uma correção está funcionando.** Um plugin que o Evi consertou aparece como consertado em vez de quebrado, e só volta a quebrado se as instalações com a correção ainda tiverem problemas.",
                "Temas da loja podem ser denunciados, como os plugins.",
            ],
            fixed: [
                "O ícone do Platform Indicators não cresce mais para ocupar uma mensagem inteira em lugares que os estilos do Evi não alcançam, como chats em janelas separadas.",
            ],
        },
        "0.6.1": {
            fixed: [
                "**O Smooth Typing não traz mais de volta para a caixa de texto uma mensagem que você acabou de enviar.** Trocar de canal e usar comandos de barra também mantêm a caixa em dia.",
                "Um plugin que o Evi desativou, ou que tem um problema para explicar, mantém o tamanho do card na lista de Plugins em vez de se esticar por toda a largura.",
            ],
        },
        "0.6.0": {
            improved: [
                "**Chega de travadinhas causadas pelo Evi.** Encontrar as peças do Discord costumava varrer todo o código do Discord, de 10 a 20 ms por vez, e uma peça ausente era procurada de novo a cada segundo. Agora ela é encontrada uma vez, e toda busca depois é instantânea.",
                "**Os plugins fazem o trabalho pesado em pedacinhos,** entre todo o resto: Fast Lists, Read All, GIF Folders e o salvamento do Last Seen não seguram mais o Discord.",
                "**O Show Hidden Channels lembra quem pode ver o quê,** em vez de perguntar de novo para cada canal a cada redesenho.",
                "**Mais rápidos: Message Logger, Inline Translate, Platform Indicators, Voice Activity Log, Relationship Notifier, Hide Blocked, Timezones, Friend Online Alerts, Streamer Mode+, Silent Typing e Snippets.**",
                "A verificação de saúde dos plugins em segundo plano ficou muito mais leve.",
            ],
            fixed: [
                "**Um plugin que o Evi desativa em todo lugar é desligado em segundos,** com um aviso, em vez de na próxima verificação de meia em meia hora ou ao reiniciar.",
            ],
        },
        "0.5.3": {
            fixed: [
                "A insígnia Plugin Author abre os detalhes quando você clica nela e pode ser ocultada e movida em Personalize suas insígnias.",
            ],
        },
        "0.5.2": {
            improved: [
                "**As verificações de atualização passam pelo evi.rest,** então uma rede movimentada não esbarra mais no limite do GitHub nem diz que o Evi não consegue verificar atualizações.",
                "**Instalar um plugin com acesso total pergunta em uma caixa de diálogo,** em vez de numa caixa espremida no card dele.",
                "**Ícones em todas as abas,** para diferenciar Instalados e Loja num relance.",
                "**Toda versão ganha sua capa pontilhada** em Novidades.",
            ],
            fixed: [
                "Abrir a Loja não rola mais as configurações do Discord um pouco para baixo.",
            ],
        },
        "0.5.1": {
            added: [
                "**Plugins da comunidade com uma parte nativa.** Os autores podem enviar um native.js junto com o plugin. A equipe do Evi lê tudo antes de ele entrar, e o Evi continua perguntando antes de instalar qualquer coisa com acesso total.",
            ],
            fixed: [
                "Abrir as páginas do Evi nas configurações do Discord não faz mais o Discord travar.",
            ],
        },
        "0.5.0": {
            added: [
                "**Evi Setup.** Um instalador pequeno com janela: escolha seu Discord e clique em Instalar o Evi ou Desinstalar o Evi. Ele verifica se há um Evi mais novo e o baixa, então são poucos MB em vez de mais de 100.",
                "**O Evi no seu idioma.** Os menus do Evi seguem o idioma do Discord: espanhol, português, francês, alemão, turco, russo, polonês e japonês. Os plugins também podem ser traduzidos.",
                "**Veja o que um plugin fez.** Os detalhes de um plugin listam os sites que ele acessou e quando, e apontam os que o código dele nunca menciona.",
                "**Versões beta.** Ative Receber versões beta em Atualizações para ter as novas versões do Evi alguns dias antes.",
                "**Insígnia Plugin Author.** Quem tiver um plugin aceito na loja ganha a insígnia no perfil.",
            ],
            improved: [
                "Ativar ou desativar um plugin não congela mais o Discord por um instante.",
                "**Os níveis de apoiador vêm por mês.** Uma insígnia nova todo mês nos seus primeiros seis meses, de Silver com um mês a Ruby com seis, e depois Prismatic com um ano.",
            ],
            fixed: [
                "Clicar no interruptor de um plugin não rola mais as configurações do Discord para longe dele.",
            ],
        },
        "0.4.0": {
            added: [
                "**Plugins da comunidade na loja.** Autores de plugins agora podem publicar os próprios plugins no evi.rest. A equipe do Evi lê cada versão antes de ela entrar, e os plugins da comunidade têm uma etiqueta para você saber sempre quem fez o quê.",
                "**Autores verificados.** Todo plugin mostra quem o fez, com uma marca de verificação para autores verificados. Clique em um nome para ver os outros plugins da pessoa.",
                "**Envie um relatório de falha para o autor.** Ao lado de Copiar relatório de falha. Você vê exatamente o que será enviado antes de enviar, e não há nada pessoal nele.",
                "**Saiba quando um plugin está quebrado.** Se um plugin para de funcionar para muita gente depois de uma atualização do Discord, a loja e a sua lista de Plugins avisam, muitas vezes com uma nota do autor sobre a correção.",
                "**Denuncie um plugin.** Algo nocivo, falso ou quebrado? Denuncie na página dele na loja. As denúncias vão para a equipe do Evi.",
                "**O Evi pode desativar um plugin ruim em todo lugar.** Se um plugin se mostrar nocivo, o Evi o desliga em todas as instalações e conta por quê.",
            ],
            improved: [
                "**Uma tela de Novidades com a cara do Evi.** A capa da versão no topo e cada tipo de mudança sob a própria etiqueta.",
                "**Os pop-ups esperam o Discord.** Novidades, registros de mudanças de plugins e o aviso de atualização aparecem depois que o Discord carregou, não por cima da tela de carregamento.",
                "**As insígnias de apoiador sobem de nível mais rápido.** Prismatic agora é um ano de apoio em vez de cinco.",
                "**Insígnias de plugins em Suas insígnias.** As insígnias que os plugins adicionam aos perfis, como o relógio do Last Seen e o dispositivo do Platform Indicators, também aparecem no diretório de insígnias do Discord.",
                "**Mais seguro desde a concepção.** Ativar um plugin com acesso total ao seu computador sempre pergunta em uma caixa de diálogo do sistema que nenhum plugin consegue responder por você.",
            ],
            fixed: [
                "Instalar um plugin da loja sempre o ativa. Antes ele dizia que tinha ativado, e às vezes não tinha.",
                "Os menus suspensos nas configurações de um plugin abrem no primeiro clique. Nas configurações do Discord, eles muitas vezes fechavam de novo na hora.",
            ],
        },
        "0.3.2": {
            improved: [
                "**Caixas de diálogo e menus se movem como os do Discord.** As caixas de diálogo, avisos e menus de plugins do Evi agora abrem com um efeito elástico e desaparecem suavemente, em vez de surgirem e sumirem de repente.",
                "**Um Voice Activity Log mais limpo,** com as sessões listadas por canal e um campo de busca de verdade.",
            ],
        },
        "0.3.1": {
            added: [
                "**O Evi no macOS e no Linux.** Baixe o instalador para o seu sistema na versão e execute `evi install`. No Linux, execute com sudo.",
            ],
        },
        "0.3.0": {
            added: [
                "**As insígnias do Evi fazem parte do Evi.** Elas aparecem nos perfis de todo mundo que usa o Evi e não podem ser desativadas por acidente.",
                "**Oculte e reordene suas insígnias do Evi** no Personalize suas insígnias do próprio Discord. Todo mundo vê a mudança em segundos.",
                "**Insígnias de apoiador que sobem de nível.** De Bronze a Prismatic quanto mais tempo você apoia o Evi, com seu progresso em Suas insígnias.",
                "**Atualize o Evi pelo app.** O Evi avisa quando há uma versão nova, e um botão a instala.",
            ],
            improved: [
                "As insígnias são atualizadas ao vivo em vez de a cada meia hora.",
                "Todo plugin pode ser removido, inclusive os que vêm com o Evi, e continuam removidos quando o Evi se atualiza.",
            ],
        },
        "0.2.0": {
            added: [
                "**A Loja de plugins agora fica na aba Plugins.** Cada plugin tem a própria página com capturas de tela, registro de mudanças, código-fonte e o que ele pode acessar.",
                "**Loja de temas.** Instale e atualize temas direto na aba Temas.",
                "**Atualizar tudo, e atualizações automáticas se você quiser.** Plugins com acesso total ao seu computador continuam perguntando antes.",
                "**Relatórios de falha.** Um plugin que não inicia tem um botão Copiar relatório de falha para o autor.",
            ],
            improved: [
                "Navegue pela loja por categoria e ordene por nome ou por atualização mais recente.",
                "Atualize e desinstale plugins da loja direto na lista de Plugins.",
                "Desative todos os plugins, ou redefina todos para o padrão, com um clique e a opção de desfazer.",
            ],
        },
        "0.1.0": {
            added: ["**Primeira versão.** Plugins, temas, Quick CSS, backups, modo seguro e a loja de plugins."],
        },
    },
    ru: {
        "2.2.0": {
            fixed: [
                "**Обновления слушаются ваших настроек.** Когда команда Evi говорит, что нужно обновиться, Evi сам скачивает обновление и перезапускает Discord, только если автоматические обновления включены. Иначе он сообщает об этом и ждёт, пока вы нажмёте «Обновить сейчас». Плагины обновляются вместе с ним, только если включено автообновление плагинов.",
            ],
        },
        "2.1.0": {
            added: [
                "**Память во вкладке «Производительность».** Смотрите, сколько использует Discord, и при желании разрешите Evi перезапускать его, когда он занимает слишком много, пока вас нет. Никогда во время звонка и не чаще раза в день.",
                "**Игровой режим.** Скрытый игровой режим самого Discord в виде переключателя во вкладке «Производительность»: пока вы играете, Discord в фоне замедляется и останавливает GIF. Во время звонков он выключен.",
            ],
            improved: [
                "**Быстрее запускается.** Evi запоминает, где плагины подключаются к Discord, поэтому со второго запуска той же версии Discord он готов примерно в четыре раза быстрее при большом числе плагинов. Выключенные плагины не загружаются, пока вы их не включите.",
                "**Легче в работе.** Точки набора текста больше не перерисовываются JavaScript каждый кадр, кнопки звонка перестали постоянно заново размывать видео под собой, а когда Discord скрыт 10 минут, Evi очищает его кэш изображений (никогда во время звонка).",
            ],
            fixed: [
                "**Настройки Chromium из плагинов сохраняются.** Discord незаметно перезаписывал их при запуске.",
            ],
        },
        "2.0.0": {
            added: [
                "**Двенадцать новых плагинов.** Desktop Voice Messages, Embed Builder с Components V2, Audit Log Plus, Role Colours Everywhere, Rich Presence Builder, Search Highlight, Click Actions, Soundboard Stealer, Quick Markup, Fix Embeds, Code Block Tools и Hover Converter. Все в магазине и выключены, пока вы их не включите.",
                "**Знакомство с новинками.** При первом запуске 2.0 показывает новые плагины и включает те, что вы выберете.",
                "**Публикуйте свои плагины.** Кнопка на странице плагинов открывает панель автора: установки, активные пользователи, оценки, отзывы и то, как каждая сборка Discord работает с вашими плагинами.",
            ],
            improved: [
                "**Меню выглядят как в Discord.** Каждый выпадающий список в Evi и его плагинах открывается как в Discord, без полосы прокрутки и с фильтром для длинных списков.",
                "**Туда, где вы были.** При возврате из плагина в магазине вы попадаете на ту же страницу, с теми же фильтрами и прокруткой.",
                "**Важные обновления приходят быстрее.** Когда обновление необходимо, Evi сразу его скачивает и перезапускает Discord, когда вы не в звонке.",
            ],
            fixed: [
                "**Плагины больше не считаются сломанными без причины.** Плагин, ждавший ещё не открытую часть Discord, отмечался как сломанный.",
                "**Диалоги открываются сверху.** Некоторые открывались прокрученными до середины в настройках Discord.",
            ],
        },
        "1.5.0": {
            added: [
                "**Новости от команды Evi в реальном времени.** Объявления появляются вверху экрана через несколько секунд после отправки и остаются, пока вы их не закроете.",
            ],
            fixed: [
                "**Уведомления плагинов снова показываются.** Сегодня Discord изменил способ показа всплывающих окон, и уведомления плагинов перестали появляться.",
            ],
        },
        "1.4.3": {
            fixed: [
                "**Цветовая тема Discord больше не смешивается с темой Evi.** С темой Evi части, которые она не окрашивает (например, низ окна), принимали оттенок вашей темы Discord.",
                "**Без полосы под окнами с обоями.** Низ окон показывал обои дважды, другим цветом.",
            ],
        },
        "1.4.2": {
            improved: [
                "**Безопасный режим теперь можно отключить.** В Общие → Обновления есть «Включать безопасный режим самостоятельно»: если выключить, сбои его не включают.",
            ],
            fixed: [
                "**Ничего от Evi поверх игр.** Безопасный режим и другие уведомления появлялись во внутриигровом оверлее Discord, где их нельзя было закрыть, а закрытие оверлея игрой считалось сбоем Discord.",
            ],
        },
        "1.4.1": {
            added: [
                "**Evi Setup для macOS и Linux.** Устанавливайте, обновляйте и удаляйте Evi через окно на любой системе, без терминала. В Linux он спрашивает пароль, когда этого требует папка Discord, а в macOS и Linux сам возвращает Evi после обновлений Discord.",
            ],
        },
        "1.4.0": {
            added: [
                "**Spotify Player в магазине.** Небольшой плеер над панелью пользователя: трек, обложка, воспроизведение и пауза, предыдущий и следующий, и позиция в треке.",
            ],
            improved: [
                "**Поиск в магазине понимает, что вы ищете.** Учитывается каждое слово в любом порядке, опечатки прощаются, лучшее совпадение идёт первым, а английское название плагина находит его на любом языке.",
            ],
            fixed: [
                "**Обновления продолжают работать** с выпусками, в которых больше нет установщика для командной строки.",
            ],
        },
        "1.3.1": {
            fixed: [
                "**Панель пользователя сохраняет место.** Когда включены Game Activity Toggle и Fake Deafen, их переключатели делят одну кнопку Evi с меню, и ваше имя и шестерёнка настроек Discord не выталкиваются.",
            ],
        },
        "1.3.0": {
            added: [
                "**Живые уведомления.** Отзывы, одобрения, обновления Evi и новости авторов, на которых вы подписаны, всплывают в углу, как только приходят. Наведите, чтобы задержать, нажмите, чтобы перейти, или отключите их во входящих.",
            ],
            improved: [
                "**Плагины отделены друг от друга.** Плагин не может использовать полный доступ другого, а восстановление копии спрашивает, прежде чем включить плагин с полным доступом.",
                "**Вопрос, когда это важно.** Если обновление меняет часть плагина с полным доступом, Evi спросит перед установкой.",
            ],
            fixed: [
                "**Обои больше не лезут в игры.** Игровой оверлей Discord показывал их поверх всей игры.",
            ],
        },
        "1.2.0": {
            added: [
                "**Плагины для спонсоров выделяются.** В магазине они золотые, а их страница благодарит вас или показывает, как стать спонсором.",
            ],
            improved: [
                "**Одна тема за раз.** Включение темы выключает остальные, чтобы они не спорили за цвета.",
                "**Профили всегда актуальны.** Смените имя или аватар в Discord — evi.rest, титры и страницы авторов обновятся сами.",
                "**Кнопки как в Discord.** Fake Deafen и Game Activity Toggle используют кнопки самого Discord, а у Fake Deafen призрак, чтобы не путать с отключением звука.",
                "**Спокойная главная страница магазина.** Раздела «Новое за неделю» больше нет, а у установленных плагинов галочка рядом с названием.",
            ],
            fixed: [
                "**Voice Chat Utilities действительно работает.** Он сообщал, что переместил, заглушил или отключил людей, но его запросы не доходили до Discord.",
                "**Больше никаких ложных пометок «сломан».** View Icons считался сломанным, потому что часть его ждёт открытия просмотра изображений.",
                "**Video Controls+ работает в чате.** Управление появляется на видео в чате, а не только в полноэкранном режиме.",
                "**Плагины больше не меняют стили друг друга.** Стили Link Safety проникали в настройки Last Seen.",
            ],
        },
        "1.1.2": {
            added: [
                "**Делитесь плагинами в чате.** Скопируйте ссылку на плагин на его странице в магазине и вставьте в любой чат Discord. У всех, у кого есть Evi, появится карточка, чтобы установить его прямо там.",
                "**Фальшивое отключение звука.** Для всех в голосовом канале у вас выключен звук, а вы продолжаете всех слышать. Благодарность спонсорам.",
                "**Voice Chat Utilities.** Правый клик по голосовому каналу, чтобы переместить, отключить, заглушить или лишить звука всех в нём, если у вас есть права.",
            ],
            fixed: [
                "Порядок значков сохраняется надёжнее.",
            ],
        },
        "1.1.1": {
            added: [
                "**Редактор изображения, как в Discord.** Перетаскивайте, масштабируйте и поворачивайте обои в превью в форме вашего окна.",
                "**Обои на экране входа.** Они видны за страницей входа Discord, а окно входа поверх них — как матовое стекло.",
                "**Удаляйте свои темы.** У тем, которые вы создали или добавили сами, теперь есть кнопка удаления.",
            ],
            improved: [
                "**Настройки обоев стали проще.** Включите их, затемните и выберите, насколько прозрачен Discord. Всё остальное — в «Других настройках».",
                "**Новая страница поддерживающих.** Ваш уровень, когда будет следующий и что вы получаете — в разделе «Аккаунт». В благодарностях в «Обновлениях» теперь видны все лица.",
                "Значки поддерживающих сохраняют цвет своего уровня: свои цвета значков убраны.",
            ],
            fixed: [
                "**Обои снова видны.** Их закрывали собственный фон Discord и список участников.",
                "**Порядок значков снова сохраняется.** Discord отклонял всё сохранение из-за значков Evi; теперь ваш порядок видят все.",
            ],
        },
        "1.1.0": {
            added: [
                "**Evi говорит на вашем языке.** Evi, все плагины и магазин следуют языку Discord: немецкому, испанскому, французскому, японскому, польскому, португальскому, русскому и турецкому, а также английскому.",
                "**Разместите обои как хотите.** Заполнение, по размеру, растянуть, по центру или замостить, а потом перетаскивайте и масштабируйте в живом превью Discord.",
                "**Выберите, что будет прозрачным.** Задайте, насколько плотными остаются список серверов, каналы, чат и поле ввода поверх обоев, и окрасьте их в цвета своей темы.",
            ],
            improved: [
                "**Discord работает гораздо плавнее.** Evi убирает скрытое правило стилей Discord, из-за которого всё приложение пересчитывало стили при любом изменении, например когда кто-то говорит в звонке: в загруженном звонке самая долгая заминка сократилась примерно со 100 мс до 15 мс, а настройки открываются быстрее. Шрифты Discord теперь загружаются в фоне, так что текст не прыгает, когда стиль используется впервые.",
                "**Обновления стали меньше.** Со следующей версии обновление Evi скачивает только его файлы, несколько МБ, а не весь установщик на 100 МБ.",
                "**Настройки и всплывающие окна остаются непрозрачными.** Обои видны только за главным окном Discord, если не включить их и для настроек или всплывающих окон.",
                "**«Исходный код» показывает настоящий код.** На странице плагина от сообщества открывается именно тот код, который устанавливает Evi, а ссылка автора стоит рядом.",
            ],
            fixed: [
                "Редактор тем сохраняет переводы темы при сохранении.",
            ],
        },
        "1.0.0": {
            added: [
                "**Главная страница магазина.** Что сейчас в тренде, новинки недели, подборки и коллекции от команды Evi, ещё до полного списка.",
                "**Оценки и отзывы.** Оценивай плагины, которыми пользуешься, и в паре строк объясняй почему. Отзывы, на которые кто-то пожаловался, попадают к команде Evi.",
                "**Страницы плагинов рассказывают больше.** Видео или GIF с плагином в деле, что ещё устанавливают те, кто им пользуется, известные проблемы и заметка автора о версии.",
                "**Список желаемого и входящие.** Поставь сердечко чему угодно в магазине, чтобы узнать, когда оно обновится, получит бету или снова заработает. Отзывы на твои плагины, твои загрузки и новости от авторов, на которых ты подписан, тоже приходят в новые Входящие.",
                "**Подписка на авторов.** На страницах авторов есть баннер, закреплённые плагины, число тех, кто пользуется их плагинами, и кнопка «Подписаться».",
                "**Бета-версии плагинов.** Авторы могут выпустить бету рядом со стабильной версией, а ты можешь подписаться на беты любого плагина на его странице.",
                "**Динамические обои.** Картинка или видео за Discord, приглушённые, чтобы текст оставался читаемым, и на паузе при работе от батареи.",
                "**Crash Detective.** Когда Discord вылетает или зависает, Evi говорит, какой плагин был самым занятым прямо перед этим, и предлагает его отключить.",
                "**Обновления в фоне.** Включи их в разделе «Обновления», и новые версии будут скачиваться сами и устанавливаться, когда ты закроешь Discord.",
                "**Горячие клавиши для плагинов.** Задай сочетание в настройках плагина, просто нажав клавиши, как в горячих клавишах Discord. Они есть у Streamer Mode+ и Game Activity Toggle, а если двум плагинам нужны одни и те же клавиши, поле об этом скажет.",
                "**Бонусы для поддерживающих.** Твой значок поддержки в выбранном тобой цвете, твоё имя в титрах, если захочешь, и Aurora, тема для поддерживающих.",
                "**Who Reacted.** Маленькие аватарки тех, кто отреагировал, прямо на каждой реакции рядом со счётчиком.",
                "**Typing Tweaks.** Сразу видно, кто печатает: аватарки и цвета ролей в строке «печатает» и три точки у каналов и личных сообщений, пока там кто-то пишет.",
                "**Для авторов плагинов:** Evi DevTools (события Flux в реальном времени, сторы, срабатывания патчей и тайминги), документация по API при наведении в Patch Helper, публичный журнал изменений API плагинов, анонимная статистика установок и сбоев в твоей панели, а также `bun run new-plugin` / `bun run preview-plugin`, чтобы начать плагин и проверить его.",
            ],
            improved: [
                "**Поиск находит настройки, а не только плагины.** Поиск во вкладке «Плагины» теперь просматривает и настройки каждого плагина, а открытие результата приводит прямо к настройке.",
                "**Показывай только то, чего у тебя ещё нет** с новым фильтром «Не установлены» в магазине, а сортируй по оценке или по популярности.",
                "Streamer Mode+ сохраняет введённое тобой сочетание клавиш, теперь как записанное.",
                "Авторы плагинов видят, сколько людей ими пользуется: раз в сутки Evi анонимно сообщает evi.rest, какие плагины из магазина у тебя установлены. Это можно отключить в настройках магазина.",
                "Quick Actions больше не входит в Evi и удаляется при обновлении Evi.",
                "**View Icons переехал в профили.** Нажми на чей-то баннер, чтобы открыть его в полном размере, как аватар, а «Скачать» находится рядом с увеличением. Пунктов в контекстном меню больше нет.",
            ],
            fixed: [
                "**Message Logger сохраняет удалённые картинки, видео и файлы.** Discord удаляет их со своих серверов вместе с сообщением, поэтому раньше они отображались сломанными. Правки, которые убирают вложение, тоже сохраняют его у старой версии.",
            ],
        },
        "0.7.0": {
            added: [
                "**Плагины сообщают, что им нужно, а Evi следит за соблюдением.** К каким сайтам обращается плагин, читает ли он твои сообщения, отправляет ли сообщения или меняет твои настройки. Всё остальное, что он пытается сделать через Evi, Evi блокирует, а заблокированное отображается в «Активности» плагина.",
                "**Evi чинит плагины, которые ломает Discord, не дожидаясь обновления.** Когда обновление Discord ломает плагин, команда Evi исправляет его на evi.rest, и все установки получают исправление в течение нескольких минут. В сведениях о плагине сказано, что было исправлено.",
                "**Создай свою тему.** Выбирай цвета в новой вкладке «Редактор», смотри, как меняется Discord, и сохрани результат как собственную тему.",
                "**Темы сообщества.** Отправь тему в магазин тем из редактора или своей панели. Команда Evi проверяет каждую, а темы сообщества не могут ничего загружать из интернета, так что никто не узнает, кто ими пользуется.",
                "**DM Categories.** Раскладывай личные сообщения по сворачиваемым категориям вроде «Друзья», «Работа» или «Игры» в верхней части списка личных сообщений. Нажми правой кнопкой на личное сообщение, чтобы добавить его в категорию.",
                "**View Icons.** Нажми правой кнопкой на пользователя, чтобы увидеть его аватар и баннер в полном размере, или на сервер, чтобы увидеть его значок и баннер, в просмотрщике изображений Discord. Скачай оригинал или скопируй ссылку.",
                "**Calm Name Effects.** Открытие чата требует вдвое меньше работы: стили имён Nitro вроде Prism и Neon анимируются, пока ты наводишь на имя, а не на всех сообщениях сразу.",
            ],
            improved: [
                "**Обновление, которое просит больше прав, ждёт твоего согласия,** как и полный доступ. Страницы магазина, вопросы при установке и сведения о плагинах перечисляют, что запрашивает каждый плагин, а старые плагины, которые это не указывают, помечены.",
                "**Магазин знает, что исправление работает.** Плагин, который починил Evi, отображается как исправленный, а не сломанный, и снова становится сломанным, только если у установок с исправлением по-прежнему есть проблемы.",
                "На темы в магазине можно пожаловаться, как и на плагины.",
            ],
            fixed: [
                "Значок Platform Indicators больше не разрастается на всё сообщение там, куда не доходят стили Evi, например в чатах в отдельных окнах.",
            ],
        },
        "0.6.1": {
            fixed: [
                "**Smooth Typing больше не возвращает в поле ввода только что отправленное сообщение.** Переключение каналов и слэш-команды тоже держат поле в актуальном состоянии.",
                "Плагин, который Evi отключил или у которого есть проблема, требующая пояснения, сохраняет размер карточки в списке плагинов, а не растягивается на всю ширину.",
            ],
        },
        "0.6.0": {
            improved: [
                "**Больше никаких подтормаживаний из-за Evi.** Поиск частей Discord раньше просматривал весь код Discord, каждый раз по 10–20 мс, а отсутствующая часть искалась заново каждую секунду. Теперь она находится один раз, и любой последующий поиск мгновенный.",
                "**Плагины выполняют тяжёлую работу небольшими порциями** между всем остальным: Fast Lists, Read All, GIF Folders и сохранение в Last Seen больше не задерживают Discord.",
                "**Show Hidden Channels запоминает, кто что видит,** вместо того чтобы спрашивать заново по каждому каналу при каждой перерисовке.",
                "**Быстрее работают Message Logger, Inline Translate, Platform Indicators, Voice Activity Log, Relationship Notifier, Hide Blocked, Timezones, Friend Online Alerts, Streamer Mode+, Silent Typing и Snippets.**",
                "Фоновая проверка состояния плагинов стала намного легче.",
            ],
            fixed: [
                "**Плагин, который Evi отключает везде, отключается в течение нескольких секунд** с уведомлением, а не при следующей проверке раз в полчаса или после перезапуска.",
            ],
        },
        "0.5.3": {
            fixed: [
                "Значок Plugin Author открывает свои сведения по нажатию, и его можно скрыть и переместить в разделе «Настроить значки».",
            ],
        },
        "0.5.2": {
            improved: [
                "**Проверка обновлений идёт через evi.rest,** так что загруженная сеть больше не упирается в лимит GitHub и не сообщает, что Evi не может проверить обновления.",
                "**Установка плагина с полным доступом спрашивает в диалоговом окне,** а не в рамке, зажатой в его карточке.",
                "**Значки на каждой вкладке,** чтобы «Установленные» и «Магазин» различались с первого взгляда.",
                "**У каждого релиза есть своя точечная обложка** в «Что нового».",
            ],
            fixed: [
                "Открытие магазина больше не прокручивает настройки Discord немного вниз.",
            ],
        },
        "0.5.1": {
            added: [
                "**Плагины сообщества с нативной частью.** Авторы могут приложить к плагину native.js. Команда Evi прочитывает всё, прежде чем плагин попадёт в магазин, а Evi по-прежнему спрашивает тебя перед установкой всего, что имеет полный доступ.",
            ],
            fixed: [
                "Открытие страниц Evi в настройках Discord больше не приводит к сбою Discord.",
            ],
        },
        "0.5.0": {
            added: [
                "**Evi Setup.** Небольшой установщик с окном: выбери свой Discord и нажми «Установить Evi» или «Удалить Evi». Он сначала проверяет, есть ли более новая версия Evi, и скачивает её, так что это несколько МБ вместо более чем 100.",
                "**Evi на твоём языке.** Меню Evi следуют языку Discord: испанский, португальский, французский, немецкий, турецкий, русский, польский и японский. Плагины тоже можно переводить.",
                "**Смотри, что сделал плагин.** В сведениях о плагине перечислены сайты, к которым он обращался, и когда, и отмечены те, которые его код нигде не упоминает.",
                "**Бета-версии.** Включи «Получать бета-версии» в разделе «Обновления», чтобы получать новые версии Evi на несколько дней раньше.",
                "**Значок Plugin Author.** Каждый, чей плагин попал в магазин, получает его в профиль.",
            ],
            improved: [
                "Включение и отключение плагина больше не замораживает Discord на мгновение.",
                "**Уровни поддержки теперь выдаются каждый месяц.** Новый значок каждый месяц в течение первых шести месяцев, от Silver за один месяц до Ruby за шесть, а затем Prismatic за год.",
            ],
            fixed: [
                "Нажатие на переключатель плагина больше не прокручивает настройки Discord прочь от него.",
            ],
        },
        "0.4.0": {
            added: [
                "**Плагины сообщества в магазине.** Авторы плагинов теперь могут публиковать свои плагины на evi.rest. Команда Evi прочитывает каждую версию, прежде чем она попадёт в магазин, а плагины сообщества помечены, чтобы ты всегда знал, кто что сделал.",
                "**Проверенные авторы.** У каждого плагина указан автор, а у проверенных авторов есть галочка. Нажми на имя, чтобы увидеть другие плагины автора.",
                "**Отправка отчёта о сбое автору.** Рядом с «Скопировать отчёт о сбое». Ты видишь, что именно будет отправлено, прежде чем оно уйдёт, и ничего личного в нём нет.",
                "**Узнавай, когда плагин сломан.** Если плагин перестаёт работать у многих после обновления Discord, магазин и твой список плагинов сообщат об этом, часто с заметкой автора об исправлении.",
                "**Пожаловаться на плагин.** Что-то вредоносное, поддельное или сломанное? Пожалуйся на странице плагина в магазине. Жалобы попадают к команде Evi.",
                "**Evi может отключить плохой плагин везде.** Если плагин окажется вредоносным, Evi отключит его на всех установках и объяснит почему.",
            ],
            improved: [
                "**«Что нового» в стиле Evi.** Обложка релиза сверху и каждый тип изменений под своей меткой.",
                "**Окна ждут Discord.** «Что нового», журналы изменений плагинов и уведомление об обновлении появляются, когда Discord загрузился, а не поверх его экрана загрузки.",
                "**Значки поддержки растут быстрее.** Prismatic теперь даётся за год поддержки, а не за пять.",
                "**Значки плагинов в разделе «Ваши значки».** Значки, которые плагины добавляют в профили, например часы Last Seen и устройство Platform Indicators, теперь есть и в каталоге значков Discord.",
                "**Безопасность по умолчанию.** Включение плагина с полным доступом к твоему компьютеру всегда запрашивается в системном диалоге, на который никакой плагин не может ответить за тебя.",
            ],
            fixed: [
                "Установка плагина из магазина всегда включает его. Раньше она сообщала, что включила, а иногда это было не так.",
                "Выпадающие списки в настройках плагина открываются с первого нажатия. В настройках Discord они часто тут же закрывались снова.",
            ],
        },
        "0.3.2": {
            improved: [
                "**Диалоги и меню двигаются как в Discord.** Диалоги, уведомления и меню плагинов Evi теперь пружинисто раскрываются и плавно исчезают, а не выскакивают и пропадают.",
                "**Более аккуратный Voice Activity Log** с сеансами по каналам и нормальным полем поиска.",
            ],
        },
        "0.3.1": {
            added: [
                "**Evi на macOS и Linux.** Скачай установщик для своей системы из релиза и запусти `evi install`. В Linux запускай его через sudo.",
            ],
        },
        "0.3.0": {
            added: [
                "**Значки Evi стали частью Evi.** Они отображаются в профилях всех, кто пользуется Evi, и их нельзя случайно отключить.",
                "**Скрывай и переставляй свои значки Evi** в стандартном разделе Discord «Настроить значки». Все увидят изменение в течение нескольких секунд.",
                "**Значки поддержки, которые растут в уровне.** От Bronze до Prismatic, чем дольше ты поддерживаешь Evi, а твой прогресс виден в разделе «Ваши значки».",
                "**Обновляй Evi из приложения.** Evi сообщает, когда вышла новая версия, а одна кнопка её устанавливает.",
            ],
            improved: [
                "Значки обновляются сразу, а не раз в полчаса.",
                "Любой плагин можно удалить, в том числе те, что поставляются с Evi, и они остаются удалёнными после обновлений Evi.",
            ],
        },
        "0.2.0": {
            added: [
                "**Магазин плагинов теперь во вкладке «Плагины».** У каждого плагина своя страница со скриншотами, журналом изменений, исходным кодом и списком того, к чему у него есть доступ.",
                "**Магазин тем.** Устанавливай и обновляй темы прямо во вкладке «Темы».",
                "**Обновить всё и автоматические обновления, если хочешь.** Плагины с полным доступом к твоему компьютеру по-прежнему спрашивают заранее.",
                "**Отчёты о сбоях.** У плагина, который не запускается, есть кнопка «Скопировать отчёт о сбое» для его автора.",
            ],
            improved: [
                "Просматривай магазин по категориям и сортируй его по названию или по последнему обновлению.",
                "Обновляй и удаляй плагины из магазина прямо из списка плагинов.",
                "Отключай все плагины или сбрасывай их к настройкам по умолчанию одним нажатием, с возможностью отмены.",
            ],
        },
        "0.1.0": {
            added: ["**Первый релиз.** Плагины, темы, Quick CSS, резервные копии, безопасный режим и магазин плагинов."],
        },
    },
    tr: {
        "2.2.0": {
            fixed: [
                "**Güncellemeler ayarlarına uyar.** Evi ekibi bir güncellemenin gerekli olduğunu söylediğinde Evi, güncellemeyi kendisi indirip Discord'u yalnızca otomatik güncellemeler açıksa yeniden başlatır. Kapalıysa sana haber verir ve Şimdi güncelle'ye basmanı bekler. Eklentiler de yalnızca eklenti otomatik güncellemesi açıksa birlikte güncellenir.",
            ],
        },
        "2.1.0": {
            added: [
                "**Performans sekmesinde bellek.** Discord'un ne kadar kullandığını gör, istersen sen yokken çok fazla kullandığında Evi onu yeniden başlatsın. Asla bir arama sırasında değil ve günde en fazla bir kez.",
                "**Oyun Modu.** Discord'un kendi gizli Oyun Modu, Performans sekmesinde bir anahtar olarak: sen oynarken Discord arka planda yavaşlar ve GIF'leri durdurur. Aramalarda kapalı kalır.",
            ],
            improved: [
                "**Daha hızlı açılıyor.** Evi, eklentilerin Discord'a nereden bağlandığını hatırlıyor; bu sayede bir Discord sürümünün ikinci açılışından itibaren çok eklentiyle yaklaşık dört kat daha hızlı hazır oluyor. Kapattığın eklentiler sen açana kadar yüklenmiyor.",
                "**Kullanırken daha hafif.** Yazıyor noktaları artık her karede JavaScript ile yeniden çizilmiyor, arama düğmeleri arkalarındaki videoyu sürekli yeniden bulanıklaştırmıyor ve Discord 10 dakika gizli kaldığında Evi resim önbelleklerini boşaltıyor (asla bir arama sırasında değil).",
            ],
            fixed: [
                "**Eklentilerin Chromium ayarları kalıcı.** Discord açılışta bunları sessizce eziyordu.",
            ],
        },
        "2.0.0": {
            added: [
                "**On iki yeni eklenti.** Desktop Voice Messages, Components V2 destekli Embed Builder, Audit Log Plus, Role Colours Everywhere, Rich Presence Builder, Search Highlight, Click Actions, Soundboard Stealer, Quick Markup, Fix Embeds, Code Block Tools ve Hover Converter. Hepsi mağazada, sen açana kadar hepsi kapalı.",
                "**Yeniliklerde bir tur.** 2.0 ilk açıldığında yeni eklentileri gösterir ve seçtiklerini açar.",
                "**Kendi eklentilerini yayınla.** Eklentiler sayfasındaki bir düğme yazar panelini açar: kurulumlar, aktif kullanıcılar, puanlar, yorumlar ve her Discord sürümünün eklentilerinle nasıl çalıştığı.",
            ],
            improved: [
                "**Menüler Discord'unkiler gibi görünüyor.** Evi'deki ve eklentilerindeki her açılır menü Discord gibi açılır; kaydırma çubuğu yok, uzun listelerde filtre var.",
                "**Kaldığın yere dön.** Mağazada bir eklentiden geri döndüğünde aynı sayfaya, aynı filtrelere ve aynı kaydırma konumuna dönersin.",
                "**Önemli güncellemeler daha hızlı gelir.** Bir güncelleme gerektiğinde Evi onu hemen indirir ve sen bir aramada değilken Discord'u yeniden başlatır.",
            ],
            fixed: [
                "**Eklentiler artık sebepsiz yere bozuk sayılmıyor.** Discord'un henüz açılmamış bir bölümünü bekleyen bir eklenti bozuk olarak bildiriliyordu.",
                "**Pencereler en üstten açılıyor.** Bazıları Discord'un ayarlarında yarıya kadar kaydırılmış açılıyordu.",
            ],
        },
        "1.5.0": {
            added: [
                "**Evi ekibinden haberler, canlı.** Duyurular gönderildikten saniyeler sonra ekranının üstünde görünür ve sen kapatana kadar kalır.",
            ],
            fixed: [
                "**Eklenti bildirimleri yeniden görünüyor.** Discord bugün açılır pencerelerini gösterme şeklini değiştirdi ve eklentilerinkiler görünmez olmuştu.",
            ],
        },
        "1.4.3": {
            fixed: [
                "**Discord renk temanın Evi'nin temasına karışması bitti.** Bir Evi temasıyla, temanın renklendirmediği yerler (bir pencerenin alt kısmı gibi) Discord renk temanın tonunu alıyordu.",
                "**Duvar kâğıdıyla pencerelerin altında şerit yok.** Pencerelerin alt kısmı duvar kâğıdını iki kez, farklı bir renkte gösteriyordu.",
            ],
        },
        "1.4.2": {
            improved: [
                "**Güvenli modu kapatmak senin elinde.** Genel → Güncellemeler'de \"Güvenli modu kendiliğinden aç\" var: kapalıyken çökmeler onu hiç açmaz.",
            ],
            fixed: [
                "**Oyunlarının üstünde Evi'den bir şey yok.** Güvenli mod ve diğer bildirimler Discord'un oyun içi katmanında çıkıyor ve kapatılamıyordu; bir oyunun katmanı kapatması da Discord çökmesi sayılıyordu.",
            ],
        },
        "1.4.1": {
            added: [
                "**macOS ve Linux için Evi Setup.** Evi'yi her sistemde terminal olmadan bir pencereden kur, güncelle ve kaldır. Linux'ta Discord'un klasörü gerektirdiğinde şifreni sorar; macOS ve Linux'ta Discord güncellemelerinden sonra Evi'yi kendiliğinden geri getirir.",
            ],
        },
        "1.4.0": {
            added: [
                "**Spotify Player mağazada.** Kullanıcı panelinin üstünde küçük bir oynatıcı: şarkı, kapağı, oynat ve duraklat, önceki ve sonraki, ve şarkıda nerede olduğun.",
            ],
            improved: [
                "**Mağaza araması ne aradığını anlıyor.** Yazdığın her kelime sayılır, sıra fark etmez, yazım hataları affedilir, en iyi eşleşme önce gelir ve bir eklentinin İngilizce adı onu her dilde bulur.",
            ],
            fixed: [
                "**Güncellemeler çalışmaya devam ediyor**, artık komut satırı yükleyicisini içermeyen sürümlerle de.",
            ],
        },
        "1.3.1": {
            fixed: [
                "**Kullanıcı paneli yerini korur.** Game Activity Toggle ve Fake Deafen ikisi de açıkken anahtarları menülü tek bir Evi düğmesini paylaşır, böylece adın ve Discord'un ayarlar çarkı dışarı itilmez.",
            ],
        },
        "1.3.0": {
            added: [
                "**Canlı bildirimler.** Değerlendirmeler, onaylar, Evi güncellemeleri ve takip ettiğin yazarların haberleri geldikleri anda köşede belirir. Tutmak için üstüne gel, gitmek için tıkla ya da Gelen Kutusu'ndan kapat.",
            ],
            improved: [
                "**Eklentiler birbirinden ayrı.** Bir eklenti başkasının tam erişimini kullanamaz, yedeği geri yüklemek de tam erişimli bir eklentiyi açmadan önce sorar.",
                "**Önemli olduğunda sorar.** Bir güncelleme eklentinin tam erişimli kısmını değiştirirse Evi yüklemeden önce sorar.",
            ],
            fixed: [
                "**Duvar kağıdın oyunlarına karışmıyor.** Discord'un oyun içi katmanı onu bütün oyunun üstünde gösteriyordu.",
            ],
        },
        "1.2.0": {
            added: [
                "**Destekçi eklentileri öne çıkıyor.** Mağazada altın renginde görünüyorlar, sayfaları sana teşekkür ediyor ya da nasıl destekçi olacağını gösteriyor.",
            ],
            improved: [
                "**Aynı anda tek tema.** Bir temayı açmak diğerlerini kapatır, böylece renkler için çekişmezler.",
                "**Profiller hep güncel.** Discord adını veya avatarını değiştir, evi.rest, jenerik ve yazar sayfaları kendiliğinden takip eder.",
                "**Discord'unkiler gibi düğmeler.** Fake Deafen ve Game Activity Toggle Discord'un kendi düğmelerini kullanıyor; Fake Deafen ses kapatmayla karışmasın diye hayalet simgeli.",
                "**Daha sade bir mağaza ana sayfası.** Bu haftanın yenileri kaldırıldı, yüklü eklentilerin adının yanında bir onay işareti var.",
            ],
            fixed: [
                "**Voice Chat Utilities gerçekten çalışıyor.** İnsanları taşıdığını, susturduğunu veya bağlantılarını kestiğini söylüyordu ama istekleri Discord'a hiç ulaşmıyordu.",
                "**Artık sahte \"bozuk\" etiketleri yok.** View Icons, bir kısmı resim görüntüleyicinin açılmasını beklediği için bozuk görünüyordu.",
                "**Video Controls+ sohbette çalışıyor.** Kontroller yalnızca tam ekranda değil, sohbetteki videolarda da görünüyor.",
                "**Eklentiler artık birbirinin stilini bozmuyor.** Link Safety'nin stilleri Last Seen'in ayarlarına taşıyordu.",
            ],
        },
        "1.1.2": {
            added: [
                "**Eklentileri sohbette paylaş.** Bir eklentinin bağlantısını mağaza sayfasından kopyala ve herhangi bir Discord sohbetine yapıştır. Evi kullanan herkes onu orada yükleyebileceği bir kart görür.",
                "**Sahte Ses Kapatma.** Herkesi duymaya devam ederken seste sesin kapalı görünsün. Destekçilere bir teşekkür.",
                "**Voice Chat Utilities.** Bir ses kanalına sağ tıklayıp izin varsa içindeki herkesi taşı, bağlantısını kes, sustur veya sağırlaştır.",
            ],
            fixed: [
                "Rozet sıralaman daha güvenilir kaydediliyor.",
            ],
        },
        "1.1.1": {
            added: [
                "**Discord'daki gibi Görseli Düzenle.** Duvar kâğıdını pencerenin şeklindeki önizlemede sürükle, yakınlaştır ve döndür.",
                "**Giriş ekranında duvar kâğıdın.** Discord'un giriş sayfasının arkasında görünür, giriş kutusu üstünde buzlu cam gibi durur.",
                "**Yaptığın temaları sil.** Kendin yaptığın ya da eklediğin temaların artık bir silme düğmesi var.",
            ],
            improved: [
                "**Daha sade duvar kâğıdı ayarları.** Göster, karart ve Discord'un ne kadar saydam olacağını seç. Gerisi Diğer seçenekler'de.",
                "**Yeni bir destekçi sayfası.** Seviyen, bir sonrakinin ne zaman geleceği ve neler kazandığın Hesap'ta. Güncellemeler'deki teşekkür listesi herkesi yüzüyle gösteriyor.",
                "Destekçi rozetleri seviyelerinin rengini koruyor: özel rozet renkleri kaldırıldı.",
            ],
            fixed: [
                "**Duvar kâğıdı yeniden görünüyor.** Discord'un kendi arka planı ve üye listesi onu örtüyordu.",
                "**Rozetleri yeniden sıralamak tekrar kaydediliyor.** Discord, Evi rozetleri yüzünden kaydın tamamını reddediyordu; artık sıralaman herkese ulaşıyor.",
            ],
        },
        "1.1.0": {
            added: [
                "**Evi senin dilini konuşuyor.** Evi, tüm eklentiler ve mağaza Discord'un dilini kullanıyor: İngilizcenin yanı sıra Almanca, İspanyolca, Fransızca, Japonca, Lehçe, Portekizce, Rusça ve Türkçe.",
                "**Duvar kâğıdını istediğin gibi yerleştir.** Doldur, Sığdır, Uzat, Ortala ya da Döşe; sonra Discord'un canlı önizlemesinde sürükleyip yakınlaştır.",
                "**Neyin saydam olacağını sen seç.** Sunucu listesinin, kanalların, sohbetin ve mesaj kutusunun duvar kâğıdının üstünde ne kadar opak kalacağını ayarla, temanın renkleriyle boya.",
            ],
            improved: [
                "**Discord çok daha akıcı.** Evi, aramada biri konuştuğunda olduğu gibi her değişiklikte tüm uygulamanın stillerini yeniden hesaplatan gizli bir Discord stil kuralını kaldırıyor: kalabalık bir aramada en uzun takılma yaklaşık 100 ms'den 15 ms'ye indi, ayarlar da daha hızlı açılıyor. Discord'un yazı tipleri artık arka planda yükleniyor; bir stil ilk kez kullanıldığında metin kaymıyor.",
                "**Daha küçük güncellemeler.** Bir sonraki sürümden itibaren Evi'yi güncellemek 100 MB'lık yükleyicinin tamamı yerine yalnızca birkaç MB'lık dosyalarını indirir.",
                "**Ayarlar ve açılır pencereler opak kalıyor.** Duvar kâğıdı yalnızca Discord'un ana penceresinin arkasında görünür; istersen ayarlar ve açılır pencereler için de açabilirsin.",
                "**Kaynağı görüntüle artık gerçek kodu gösteriyor.** Topluluk eklentisinin sayfasında Evi'nin kurduğu kodun ta kendisini açar, yazarın bağlantısı hemen yanında durur.",
            ],
            fixed: [
                "Tema düzenleyici, kaydettiğinde temanın çevirilerini koruyor.",
            ],
        },
        "1.0.0": {
            added: [
                "**Mağaza için bir ana sayfa.** Tam listeden önce, gündemdeki şeyler, bu haftanın yenilikleri, Evi ekibinin seçtikleri ve derlediği koleksiyonlar.",
                "**Puanlar ve yorumlar.** Kullandığın eklentileri puanla ve nedenini birkaç satırda anlat. Birinin bildirdiği yorumlar Evi ekibine gider.",
                "**Eklenti sayfaları daha fazlasını gösteriyor.** Kullanımdan bir video veya GIF, onu kullananların başka neler yüklediği, bilinen sorunlar ve yazarından sürüm hakkında bir not.",
                "**Bir istek listesi ve bir gelen kutusu.** Mağazadaki her şeye kalp ver, güncellendiğinde, beta aldığında ya da yeniden çalıştığında haberin olsun. Eklentilerine gelen yorumlar, yüklemelerin ve takip ettiğin yazarlardan haberler de yeni Gelen Kutusu’na düşer.",
                "**Yazarları takip et.** Yazar sayfalarında bir afiş, sabitlenmiş eklentiler, eklentilerini kaç kişinin kullandığı ve bir Takip Et düğmesi var.",
                "**Eklenti betaları.** Yazarlar kararlı sürümün yanında bir beta yayımlayabilir, sen de herhangi bir eklentinin betalarına sayfasından katılabilirsin.",
                "**Dinamik Duvar Kağıdı.** Discord’un arkasında bir görsel veya video; yazılar okunaklı kalsın diye karartılır ve pilde duraklatılır.",
                "**Crash Detective.** Discord çöktüğünde veya donduğunda Evi, hemen öncesinde hangi eklentinin en meşgul olduğunu söyler ve onu kapatmayı önerir.",
                "**Arka planda güncellemeler.** Güncellemeler’den aç, yeni sürümler kendiliğinden iner ve Discord’u kapattığında kurulur.",
                "**Eklentiler için klavye kısayolları.** Discord’un tuş atamaları gibi, bir eklentinin ayarlarında tuşlara basarak bir kısayol belirle. Streamer Mode+ ve Game Activity Toggle’ın birer kısayolu var, iki eklenti aynı tuşları istediğinde alan bunu söyler.",
                "**Destekçi ayrıcalıkları.** Kendi seçtiğin bir renkte destekçi rozetin, istersen adın jenerikte ve destekçilere özel bir tema olan Aurora.",
                "**Who Reacted.** Tepki verenlerin küçük avatarları, her tepkinin üzerinde sayının yanında.",
                "**Typing Tweaks.** Kimin yazdığını bir bakışta gör: “yazıyor” satırında avatarlar ve rol renkleri, birileri yazarken kanallarda ve DM’lerde üç nokta.",
                "**Eklenti yazarları için:** Evi DevTools (canlı Flux olayları, store’lar, yama eşleşmeleri ve süreler), Patch Helper’da üzerine gelince API belgeleri, herkese açık bir eklenti API değişiklik günlüğü, panelinde anonim yükleme ve çökme sayıları ve bir eklentiyi başlatıp denetlemek için `bun run new-plugin` / `bun run preview-plugin`.",
            ],
            improved: [
                "**Arama yalnızca eklentileri değil, ayarları da buluyor.** Eklentiler sekmesinde arama yapmak artık her eklentinin ayarlarına da bakar, sonuçlardan birini açmak seni doğrudan ayara götürür.",
                "**Yalnızca henüz sahip olmadıklarını göster:** mağazanın yeni Yüklü değil filtresiyle, ayrıca puana veya gündeme göre sırala.",
                "Streamer Mode+ yazdığın kısayolu koruyor, artık kaydedilmiş bir kısayol olarak.",
                "Eklenti yazarları kaç kişinin eklentilerini kullandığını görür: Evi günde bir kez, hangi mağaza eklentilerinin yüklü olduğunu anonim olarak evi.rest’e bildirir. Mağaza ayarlarından kapatabilirsin.",
                "Quick Actions artık Evi’nin parçası değil ve Evi güncellendiğinde kaldırılır.",
                "**View Icons profillerin içine taşındı.** Birinin afişine tıkla, avatarı gibi tam boyutta açılsın; İndir, yakınlaştırmanın yanında. Sağ tık menüsündeki öğeler kalktı.",
            ],
            fixed: [
                "**Message Logger silinen resimleri, videoları ve dosyaları saklıyor.** Discord bunları mesajla birlikte sunucularından siler, bu yüzden bozuk görünüyorlardı. Bir eki kaldıran düzenlemeler de eki eski sürümde tutar.",
            ],
        },
        "0.7.0": {
            added: [
                "**Eklentiler neye ihtiyaç duyduklarını söyler, Evi de buna uymalarını sağlar.** Bir eklentinin hangi sitelere eriştiği ve mesajlarını okuyup okumadığı, mesaj gönderip göndermediği veya ayarlarını değiştirip değiştirmediği. Evi, Evi üzerinden denenen geri kalan her şeyi engeller ve engellenenler eklentinin Etkinlik bölümünde görünür.",
                "**Evi, Discord’un bozduğu eklentileri güncelleme beklemeden onarır.** Bir Discord güncellemesi bir eklentiyi bozduğunda Evi ekibi onu evi.rest üzerinde onarır ve her kurulum düzeltmeyi dakikalar içinde alır. Eklentinin ayrıntıları neyin düzeltildiğini söyler.",
                "**Kendi temanı yap.** Yeni Düzenleyici sekmesinde renkleri seç, Discord’un değiştiğini izle, sonra kendi temanı olarak kaydet.",
                "**Topluluk temaları.** Düzenleyiciden veya panelinden Tema Mağazası’na bir tema gönder. Evi ekibi her birini inceler ve topluluk temaları internetten hiçbir şey yükleyemez, dolayısıyla kimse onları kimin kullandığını öğrenemez.",
                "**DM Categories.** DM’lerini DM listenin en üstünde Arkadaşlar, İş veya Oyun gibi katlanabilir kategorilere ayır. Bir DM’ye sağ tıklayıp bir kategoriye ekle.",
                "**View Icons.** Birine sağ tıklayarak avatarını ve afişini, bir sunucuya sağ tıklayarak simgesini ve afişini Discord’un resim görüntüleyicisinde tam boyutta gör. Orijinali indir veya bağlantısını kopyala.",
                "**Calm Name Effects.** Bir sohbeti açmak yarı yarıya daha az iş: Prism ve Neon gibi Nitro isim stilleri, her mesajda aynı anda değil, bir ismin üzerine geldiğinde canlanır.",
            ],
            improved: [
                "**Daha fazlasını isteyen bir güncelleme onayını bekler,** tam erişim gibi. Mağaza sayfaları, kurulum soruları ve eklenti ayrıntıları her eklentinin ne istediğini listeler; bunu belirtmeyen eski eklentiler etiketlenir.",
                "**Mağaza bir düzeltmenin işe yaradığını biliyor.** Evi’nin düzelttiği bir eklenti bozuk yerine düzeltildi olarak görünür ve yalnızca düzeltmeyi çalıştıran kurulumlar hâlâ sorun yaşıyorsa tekrar bozuk olur.",
                "Mağazadaki temalar da eklentiler gibi bildirilebilir.",
            ],
            fixed: [
                "Platform Indicators’ın simgesi, açılır pencere sohbetleri gibi Evi’nin stillerinin ulaşmadığı yerlerde artık tüm mesajı kaplayacak kadar büyümüyor.",
            ],
        },
        "0.6.1": {
            fixed: [
                "**Smooth Typing artık az önce gönderdiğin bir mesajı metin kutusuna geri getirmiyor.** Kanal değiştirmek ve slash komutları da kutuyu güncel tutuyor.",
                "Evi’nin kapattığı veya açıklanacak bir sorunu olan bir eklenti, Eklentiler listesinde tüm genişliğe yayılmak yerine kart boyutunu koruyor.",
            ],
        },
        "0.6.0": {
            improved: [
                "**Evi kaynaklı takılmalar bitti.** Discord’un parçalarını bulmak eskiden Discord’un tüm kodunu her seferinde 10 ila 20 ms tarıyordu ve eksik bir parça her saniye yeniden aranıyordu. Şimdi bir kez bulunuyor ve sonraki her bakış anında.",
                "**Eklentiler ağır işlerini küçük parçalar hâlinde yapar,** diğer her şeyin arasında: Fast Lists, Read All, GIF Folders ve Last Seen’in kaydetmesi artık Discord’u bekletmiyor.",
                "**Show Hidden Channels kimin neyi görebildiğini hatırlıyor,** her yeniden çizimde her kanal için yeniden sormak yerine.",
                "**Daha hızlı: Message Logger, Inline Translate, Platform Indicators, Voice Activity Log, Relationship Notifier, Hide Blocked, Timezones, Friend Online Alerts, Streamer Mode+, Silent Typing ve Snippets.**",
                "Arka plandaki eklenti sağlık denetimi çok daha hafif.",
            ],
            fixed: [
                "**Evi’nin her yerde kapattığı bir eklenti birkaç saniye içinde kapanıyor,** bir bildirimle, yarım saatlik sonraki denetimi veya yeniden başlatmayı beklemeden.",
            ],
        },
        "0.5.3": {
            fixed: [
                "Plugin Author rozeti tıklandığında ayrıntılarını açıyor ve Rozetlerini özelleştir bölümünde gizlenip taşınabiliyor.",
            ],
        },
        "0.5.2": {
            improved: [
                "**Güncelleme denetimleri evi.rest üzerinden geçiyor,** böylece yoğun bir ağ artık GitHub’ın sınırına takılıp Evi’nin güncellemeleri denetleyemediğini söylemiyor.",
                "**Tam erişimli bir eklenti kurmak bir iletişim kutusunda soruyor,** kartına sıkıştırılmış bir kutuda değil.",
                "**Her sekmede simgeler,** Yüklü ve Mağaza bir bakışta ayırt edilsin diye.",
                "**Her sürüm Yenilikler’de noktalı kapağını alıyor.**",
            ],
            fixed: [
                "Mağazayı açmak artık Discord’un ayarlarını biraz aşağı kaydırmıyor.",
            ],
        },
        "0.5.1": {
            added: [
                "**Yerel parçası olan topluluk eklentileri.** Yazarlar eklentileriyle birlikte bir native.js gönderebilir. Evi ekibi, eklenmeden önce hepsini okur ve Evi, tam erişimli herhangi bir şeyi kurmadan önce hâlâ sana sorar.",
            ],
            fixed: [
                "Evi’nin sayfalarını Discord’un ayarlarında açmak artık Discord’u çökertmiyor.",
            ],
        },
        "0.5.0": {
            added: [
                "**Evi Setup.** Pencereli küçük bir yükleyici: Discord’unu seç, Evi’yi Yükle veya Evi’yi Kaldır’a tıkla. Önce daha yeni bir Evi olup olmadığına bakar ve onu indirir, yani 100 MB’ın üzerinde değil birkaç MB.",
                "**Evi senin dilinde.** Evi’nin menüleri Discord’un dilini izler: İspanyolca, Portekizce, Fransızca, Almanca, Türkçe, Rusça, Lehçe ve Japonca. Eklentiler de çevrilebilir.",
                "**Bir eklentinin ne yaptığını gör.** Eklentinin ayrıntıları eriştiği siteleri ve ne zaman eriştiğini listeler, kodunun hiç anmadığı siteleri ise işaret eder.",
                "**Beta sürümleri.** Yeni Evi sürümlerini birkaç gün erken almak için Güncellemeler’de Beta sürümlerini al’ı aç.",
                "**Plugin Author rozeti.** Eklentisi mağazaya giren herkes bunu profilinde alır.",
            ],
            improved: [
                "Bir eklentiyi açıp kapatmak artık Discord’u bir an için dondurmuyor.",
                "**Destekçi seviyeleri aylık geliyor.** İlk altı ay boyunca her ay yeni bir rozet: bir ayda Silver’dan altı ayda Ruby’ye, sonra bir yılda Prismatic.",
            ],
            fixed: [
                "Bir eklentinin anahtarına tıklamak artık Discord’un ayarlarını ondan uzağa kaydırmıyor.",
            ],
        },
        "0.4.0": {
            added: [
                "**Mağazada topluluk eklentileri.** Eklenti yazarları artık kendi eklentilerini evi.rest’te yayımlayabilir. Evi ekibi her sürümü eklenmeden önce okur ve topluluk eklentileri etiketlidir, böylece kimin neyi yaptığını her zaman bilirsin.",
                "**Doğrulanmış yazarlar.** Her eklenti kimin yaptığını gösterir, doğrulanmış yazarlar için bir onay işaretiyle. Diğer eklentilerini görmek için bir isme tıkla.",
                "**Yazara çökme raporu gönder.** Çökme raporunu kopyala’nın yanında. Gönderilmeden önce tam olarak ne gönderildiğini görürsün ve içinde kişisel hiçbir şey yoktur.",
                "**Bir eklentinin bozuk olduğunu öğren.** Bir Discord güncellemesinden sonra bir eklenti çok kişi için çalışmayı bırakırsa mağaza ve Eklentiler listen bunu söyler, çoğu zaman yazarından düzeltmeyle ilgili bir notla.",
                "**Bir eklentiyi bildir.** Zararlı, sahte veya bozuk bir şey mi var? Mağaza sayfasından bildir. Bildirimler Evi ekibine gider.",
                "**Evi kötü bir eklentiyi her yerde kapatabilir.** Bir eklenti zararlı çıkarsa Evi onu her kurulumda kapatır ve nedenini söyler.",
            ],
            improved: [
                "**Evi’ye benzeyen bir Yenilikler.** Üstte sürümün kapağı ve her değişiklik türü kendi etiketinin altında.",
                "**Açılır pencereler Discord’u bekliyor.** Yenilikler, eklenti değişiklik günlükleri ve güncelleme bildirimi, Discord’un yükleme ekranının üstünde değil, Discord yüklendikten sonra görünür.",
                "**Destekçi rozetleri daha hızlı seviye atlıyor.** Prismatic artık beş yıl yerine bir yıllık destek.",
                "**Eklenti rozetleri Rozetlerin’de.** Eklentilerin profillere eklediği rozetler, Last Seen’in saati ve Platform Indicators’ın cihazı gibi, Discord’un rozet dizininde de listelenir.",
                "**Tasarımdan güvenli.** Bilgisayarına tam erişimi olan bir eklentiyi açmak, hiçbir eklentinin senin yerine yanıtlayamayacağı bir sistem iletişim kutusunda her zaman sana sorar.",
            ],
            fixed: [
                "Mağazadan bir eklenti kurmak onu her zaman açıyor. Eskiden açtığını söylüyordu, ama bazen açmıyordu.",
                "Bir eklentinin ayarlarındaki açılır menüler ilk tıklamada açılıyor. Discord’un ayarlarında çoğu zaman hemen tekrar kapanıyorlardı.",
            ],
        },
        "0.3.2": {
            improved: [
                "**İletişim kutuları ve menüler Discord’unkiler gibi hareket ediyor.** Evi’nin iletişim kutuları, bildirimleri ve eklenti menüleri artık aniden belirip kaybolmak yerine yaylanarak açılıyor ve solarak kayboluyor.",
                "**Daha temiz bir Voice Activity Log,** kanala göre listelenen oturumlar ve düzgün bir arama alanıyla.",
            ],
        },
        "0.3.1": {
            added: [
                "**macOS ve Linux’ta Evi.** Sürümden sistemin için yükleyiciyi indir ve `evi install` komutunu çalıştır. Linux’ta sudo ile çalıştır.",
            ],
        },
        "0.3.0": {
            added: [
                "**Evi rozetleri Evi’nin bir parçası.** Evi kullanan herkesin profilinde görünür ve yanlışlıkla kapatılamaz.",
                "**Evi rozetlerini gizle ve yeniden sırala,** Discord’un kendi Rozetlerini özelleştir bölümünde. Herkes değişikliği birkaç saniye içinde görür.",
                "**Seviye atlayan destekçi rozetleri.** Evi’yi ne kadar uzun desteklersen Bronze’dan Prismatic’e, ilerlemen Rozetlerin’de.",
                "**Evi’yi uygulamadan güncelle.** Evi yeni bir sürüm çıktığında söyler ve tek bir düğme onu kurar.",
            ],
            improved: [
                "Rozetler her yarım saatte bir yerine canlı güncelleniyor.",
                "Her eklenti kaldırılabilir, Evi’yle birlikte gelenler de dahil, ve Evi güncellendiğinde kaldırılmış kalırlar.",
            ],
        },
        "0.2.0": {
            added: [
                "**Eklenti Mağazası artık Eklentiler sekmesinde.** Her eklentinin ekran görüntüleri, değişiklik günlüğü, kaynağı ve nelere erişebildiğiyle kendi sayfası var.",
                "**Tema Mağazası.** Temaları doğrudan Temalar sekmesinden kur ve güncelle.",
                "**Hepsini güncelle ve istersen otomatik güncellemeler.** Bilgisayarına tam erişimi olan eklentiler yine önce sorar.",
                "**Çökme raporları.** Başlamayan bir eklentinin yazarı için bir Çökme raporunu kopyala düğmesi var.",
            ],
            improved: [
                "Mağazaya kategoriye göre göz at, ada veya en son güncellenene göre sırala.",
                "Mağaza eklentilerini doğrudan Eklentiler listesinden güncelle ve kaldır.",
                "Tüm eklentileri kapat veya hepsini varsayılana sıfırla; tek tıkla ve geri alma seçeneğiyle.",
            ],
        },
        "0.1.0": {
            added: ["**İlk sürüm.** Eklentiler, temalar, Quick CSS, yedekler, güvenli mod ve eklenti mağazası."],
        },
    },
};
