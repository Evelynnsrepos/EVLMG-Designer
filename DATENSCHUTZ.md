# Datenschutzerklärung – Evelopment Games Designer

*Stand: 4. Oktober 2026* · [English version: PRIVACY.md](PRIVACY.md)

## Kurz gesagt

Evelopment Games Designer ist eine Desktop-App, die **offline** funktioniert. Es gibt **kein Konto, keine Telemetrie, keine Analyse, keine Werbung und keine Absturzberichte**. Deine Projekte werden nur auf deinem eigenen Computer gespeichert, in dem Ordner, den du auswählst. Wir, die Macher der App, **erhalten und sehen deine Daten nie**.

Die App verbindet sich nur dann mit dem Internet, wenn **du** eine der unten genannten Funktionen nutzt.

## Verantwortlich

Herausgeberin der App: **Evelynn Müller, Evelynn.mu@proton.me** (Evelopment Games).

Da die App uns nichts sendet, verarbeiten wir bei der Nutzung keine personenbezogenen Daten über dich. Dieser Text erklärt, was die App auf deinem Computer tut und welche anderen Dienste sie auf deinen Wunsch hin kontaktieren kann.

## Was auf deinem Computer bleibt

- **Projekte** (Texte, Bilder, Audio, Zeichnungen, Einstellungen des Projekts) werden als Dateien im gewählten Projektordner gespeichert.
- **App-Einstellungen** (Design, Fenster- und Listeneinstellungen, gesehene Tipps, deine Pinsel, installierte Plugins) werden im Datenordner der App auf deinem Computer gespeichert.
- **Rechtschreibprüfung** nutzt Wörterbücher, die mit der App geliefert werden. Es wird nichts gesendet.
- **„Frag dein Projekt“ und die KI-Grammatikhilfe** sind freiwillig und **vollständig lokal**. Sie laufen auf deinem Computer, funktionieren nach der Installation offline, senden deinen Text nirgendwohin, und nichts wird zum Training einer KI verwendet. Sie schlagen nur in dem nach, was du geschrieben hast; sie schreiben nie Geschichten für dich.

Du kannst all das jederzeit löschen, indem du den Projektordner löschst und die App deinstallierst.

## Wann die App sich mit dem Internet verbindet

Nur wenn du eine dieser Aktionen startest:

| Was du tust | Wen die App kontaktiert | Was diese sehen können |
|---|---|---|
| Lokale KI-Hilfe einschalten (einmaliger Download) | Hugging Face (KI-Modelldatei) und GitHub (Programm llama.cpp) | Deine IP-Adresse und dass die Datei geladen wurde. Dein Text wird nie gesendet. |
| Ein Plugin über einen GitHub-Link installieren | GitHub (github.com, api.github.com, codeload.github.com) | Deine IP-Adresse und welches Plugin du geladen hast. |
| Direkt zusammenarbeiten (Peer-to-Peer) | Die Personen, mit denen du teilst; bei Bedarf öffentliche Relay- und Such-Server von n0 (US-Firma, Entwickler von iroh) | Mitwirkende sehen bei direkten Verbindungen deine IP-Adresse. n0 sieht deine IP-Adresse und eine zufällige Geräte-ID. Projektinhalte sind Ende-zu-Ende-verschlüsselt, n0 kann sie nicht lesen. |
| Über einen Evelopment Games Designer Server arbeiten | Den Server aus deinem Verbindungscode | Der Server speichert das Projekt und den Namen, den du eingibst. Verantwortlich ist, wer den Server betreibt; diese Person oder Firma muss dir eigene Datenschutzhinweise geben. Nutze nur Server, denen du vertraust. |
| Git-Sync (nur wenn du ihn einschaltest) | Das Git-Repository, das du einträgst, über das auf deinem Computer installierte Git | Das ganze Projekt geht mit deinem eigenen Git-Login an dieses Repository. Wer es hostet (zum Beispiel GitHub), verarbeitet es nach den eigenen Datenschutzhinweisen. Ein privates Repository wird empfohlen. |
| Einen Link anklicken (GitHub, Discord, YouTube, Instagram, Problem melden oder eigene Links) | Die Webseite, geöffnet in deinem normalen Browser | Die üblichen Daten, die eine Webseite erhält. Es gelten deren Datenschutzerklärungen. |

Die App sucht nicht im Hintergrund nach Updates und baut keine weiteren Verbindungen auf.

## Daten, die du mit anderen teilst

Wenn ihr zusammenarbeitet, erhalten deine Mitwirkenden eine vollständige Kopie des geteilten Projekts und den Namen, den du für dich eingibst. Sie können diese Kopie behalten. Teile nur mit Personen, denen du vertraust.

## Download der App

Die App wird über GitHub Releases (oder eine Paketquelle wie das AUR) geladen. Dabei verarbeitet GitHub, Inc. die üblichen Verbindungsdaten nach der eigenen Datenschutzerklärung: https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement

## Kontakt mit uns

Wenn du uns schreibst (per E-Mail, auf Discord oder in einem GitHub-Issue), nutzen wir deine Nachricht nur, um dir zu antworten (Art. 6 Abs. 1 lit. f DSGVO). Nachrichten auf Discord und GitHub werden außerdem von diesen Plattformen nach deren Regeln verarbeitet. GitHub-Issues sind öffentlich, bitte poste dort keine persönlichen Daten.

## Deine Rechte (DSGVO)

Falls wir personenbezogene Daten über dich haben (zum Beispiel weil du uns gemailt hast), hast du das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch (Art. 15–21 DSGVO). Schreib uns an Evelynn.mu@proton.me. Außerdem kannst du dich bei einer Datenschutzaufsichtsbehörde beschweren, zum Beispiel bei der deines Bundeslandes.

## Kinder

Die App erhebt von niemandem Daten, auch nicht von Kindern.

## Änderungen

Wenn sich das Verhalten der App ändert (zum Beispiel durch eine neue Online-Funktion), wird diese Erklärung angepasst und die Änderung in den Release-Notes genannt.
