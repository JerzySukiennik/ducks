# Faza E — krzywa ekonomii

Liczby są **zmierzone**, nie zgadnięte. Model gry siedzi w `tools/economy-sim.py`,
liczby wejściowe w `work/balance.json`, a zatwierdzone wartości zostały wpisane do
`src/data/*.js`. Ten dokument opisuje, co z tego wyszło i dlaczego.

Odpalenie: `python3 tools/economy-sim.py`

## Jak wygląda sesja

| Czas | Co się dzieje | Dochód |
|---|---|---|
| 0:00 | Same ręce. Jedna kaczka na kurs, 70 m w tę i z powrotem | 0,18 $/s |
| 2:24 | **Wiadro** — pierwszy zakup, 8 kaczek na kurs | 0,57 $/s |
| 3:42 | Skrzynia (16) | 0,68 $/s |
| 8:36 | **Pierwsza prasa** — coś wreszcie robi kaczki bez ciebie | 1,06 $/s |
| 17:36 | Duża skrzynia (30) | 1,94 $/s |
| **24:18** | **Sześć wiatraków = tor do pitu. Gra zaczyna grać sama** | 2,65 $/s |
| 33:30 | Pierwszy asembler | 4,56 $/s |
| 39:54 | Stacja próżniowa — tor przestaje gubić kaczki | 6,06 $/s |
| 60:00 | Taśmy zastępują wiatraki | 17,7 $/s |
| ~64:00 | **Pierwszy prestiż** ×2,5 | |
| 120:00 | | 87 $/s |
| ~150:00 | Drugi prestiż, mnożnik ×6,25 | |
| 180:00 | Katalog wyczerpany dokładnie na koniec sesji | 796 $/s |

Kształt jest właściwy: pierwsze dwie minuty bolą (i mają boleć — 35 m to cała
dramaturgia gry), pierwszy zakup daje skok ×3,3, a moment „to działa beze mnie"
wypada w 24. minucie, czyli tam, gdzie powinien.

## Dwa odkrycia, które zmieniły projekt

**1. Skrzynia na 60 kaczek zabijała całą automatyzację.**
Taszczenie 60 kaczek co 14 sekund to 0,91 kaczki/s. Żaden wczesny tor tego nie bije,
więc racjonalny gracz **nigdy** by nie zbudował taśmociągu — a drugi akt gry to
właśnie budowa toru. Pojemności zjechały do 8/16/30/24, a duża skrzynia dostała
karę do czasu kursu (jest ciężka). Teraz taszczenie jest tym, co automatyzacja
zastępuje, a nie tym, co wygrywa.

**2. Tor nie opłaca się dlatego, że wozi kaczki — tylko dlatego, że uwalnia ręce.**
Gracz ma **jeden** budżet czasu i dwie robótki: kręcenie korbą robi kaczki,
taszczenie je przewozi. Do pitu trafia `min(zrobione, przewiezione)`, więc gracz
dzieli czas tak, żeby te dwie liczby się zrównały. Tor jest wart kupienia dokładnie
wtedy, gdy produkcja przerosła twoje nogi — ani minuty wcześniej. Każdy prostszy
model pokazywał tor jako **pogorszenie** i dlatego wcześniejsze krzywe w ogóle nie
pokazywały, żeby ktokolwiek automatyzował.

Stąd bierze się też właściwe napięcie w sklepie: **przepustowość i produkcja to dwa
niezależne wąskie gardła**. Wiatraki są tanie i wolne (2,2 kaczki/s), taśmy drogie
i szybkie (5,0). Dokładanie wiatraków ponad te potrzebne do przebycia 35 m nie
przyspiesza toru — poszerza korytarz. Bez tego wiatrak był nieskończoną drukarką
pieniędzy, a taśmy bezwartościowe.

## Zatwierdzone liczby

Rzadkość zostaje bez zmian: mnożniki `[1, 3, 10, 35, 100, 350, 1000]`, wagi
`[6800, 900, 220, 60, 15, 4, 1]`. Średnia wartość kaczki **2,21×**, a najwyższy tier
(1 na 8000) to **5,6 % dochodu** — czyli anegdota z wieczoru, nie źródło utrzymania,
dokładnie jak zakładało ryzyko nr 9 w planie.

| Pozycja | Cena | Krzywa | Maks | Zmiana |
|---|---|---|---|---|
| Prasa | 200 | ×1,28 | 16 | z 300, 6 s → **4,5 s** |
| Asembler | 650 | ×1,32 | 16 | z 750, 2,5 s → **2,0 s** |
| Stacja próżniowa | 450 | ×1,55 | 4 | z 900 |
| Taśmociąg | 110 | ×1,035 | 60 | z 120 |
| Narożnik | 130 | ×1,05 | 12 | z 140 |
| Rampa taśmy | 150 | ×1,05 | 8 | z 160 |
| **Wiatrak** | **60** | ×1,08 | 24 | **z 200** — tor ma kosztować ~440, nie ~1400 |
| Wiadro / skrzynia / duża / taczka | 25 / 45 / 120 / 180 | płasko | — | pojemności **8 / 16 / 30 / 24** |
| Budowle (ściany, rampy, mosty) | bez zmian | płasko | ∞ | ściana kosztuje tyle, ile kosztuje |
| Wycena rynkowa | 500 | ×1,55 | 8 | głębiej (było 5) |
| Szczęśliwa guma | 800 | ×1,7 | 5 | |
| Zwinne dłonie | 250 | ×1,7 | 4 | |
| Solidne buty | 300 | ×1,55 | 4 | |
| Wzmocnione skrzynie | 650 | ×1,8 | 3 | |

Ceny są **płaskie dla budowli i przedmiotów**, **rosnące dla producentów i
upgrade'ów**. Walidator danych do tej pory zabraniał `repeat` na czymkolwiek poza
upgrade'em; teraz `repeat` na obiekcie stawianym znaczy „ile kopii wolno mieć i jak
rośnie cena kopii". Zabronione zostało to, co naprawdę jest sprzeczne: obiekt
stawiany, który jednocześnie ma `effects`.

## Prestiż

Mnożnik jest funkcją **łącznego zarobku całej sesji** i jest **przypisywany**, nie
domnażany: `mnożnik = 1 + (zarobek / 10 000) ^ 0,5`. Wersja domnażana per przebieg
była runawayem — przy dużym dochodzie próg pada co tick i mnożnik idzie w
nieskończoność w minutę (symulacja pokazała 1592 prestiże i `inf`). Gracz bierze
prestiż, gdy nowy mnożnik jest co najmniej ×2,5 lepszy od obecnego i do końca sesji
zostało ponad 25 minut.

W sesji wychodzą **2 prestiże**, końcowy mnożnik **×6,25**, a każdy kolejny przebieg
jest wyraźnie krótszy od poprzedniego (63 → 40 → 6 min do wyczerpania katalogu).

**Decyzja projektowa do ewentualnego weta:** zamrożona reguła mówi, że prestiż
kasuje maszyny, upgrade'y i kasę, a zostawia budowle. Przedmioty (wiadro, skrzynie,
taczka) nie są ani jednym, ani drugim — **przyjąłem, że zostają**, bo to twoje
narzędzia, nie fabryka. Bez tego prestiż cofa cię do noszenia kaczek w rękach i
pierwsze dwie minuty grasz od nowa za każdym razem.

### Jak to zostało zaimplementowane (G7)

- **Reguła jest w configu, nie w kodzie.** `config.prestige.keep` to cztery flagi
  0/1, po jednej na zakładkę katalogu (`machines: 0, buildings: 1, items: 1,
  upgrades: 0`). Weto na przedmiotach to zmiana `items: 1` na `0` i nic więcej —
  żaden plik logiki nie zna nazwy „wiadro". Brak wpisu dla którejkolwiek
  zakładki to błąd startu, żeby nikt nie wybrał strony przez przypadek.
- **Próg i wykładnik też są configiem** (`prestige.threshold`, `prestige.exponent`),
  a dochodzi trzecia liczba, której symulator nie modeluje: `prestige.minGain`
  = 1,25. To **próg dostępności przycisku**, nie heurystyka gracza — symulowany
  gracz bierze prestiż przy 2,5×, więc każde jego wzięcie gra i tak dopuszcza.
- **Mnożnik wchodzi przez tabelę statystyk**, jako efekt `duckValueMul` w tym
  samym kształcie, co efekt upgrade'u (`computeStats(levels, extra)`). Nie ma
  drugiego mnożnika w ekonomii. Przy okazji wyszło, że **`duckValueMul` nie miał
  dotąd ŻADNEGO czytelnika** — Wycena rynkowa (8 poziomów po 500 $) nie robiła
  nic. Teraz `applyStats()` w `main.js` wpycha go do ekonomii raz na klatkę.
- **Multiplayer: prestiż wywołuje host.** Ekonomia jest wspólna, więc jedno
  kliknięcie kosztuje fabrykę wszystkich; host to jedyny autorytet, który
  wszyscy zaakceptowali wchodząc do pokoju. Klient widzi tę samą wycenę i powód,
  dla którego jego przycisk jest wyłączony. Reszta drużyny dowiaduje się przez
  `EV.PRESTIGE` (mnożnik + poziomy sklepu; kasa i maszyny lecą własnymi diffami
  rekoncyliatora).
- **`totalEarned` NIE jest zerowany.** To wejście do wzoru, nie wynik przebiegu.

## Czego ten model nie obejmuje

- **Geometrii toru.** Symulator zna tylko „ile metrów pokrywa tor" i „ile wozi";
  nie wie, czy kaczka wpadnie w zakręt. To rozstrzyga G3 na żywej fizyce.
- **Kontenera (200 kaczek).** Jest statyczny — bez toru, który go napełni, nie ma
  czym go wycenić. Do wyceny po G3.
- **Zatoru przy 300 kaczkach.** Sufit istnieje w grze, ale symulator nigdy go nie
  dotyka, bo tor wywozi wszystko, co powstaje. To ryzyko nr 2 z planu i sprawdza je
  playtest, nie arkusz.
- **Ostatniej godziny przy szybkim graczu.** Przy tych cenach katalog wyczerpuje się
  koło 180. minuty. Gracz sprawniejszy od symulowanego (który nigdy nie planuje
  układu) skończy wcześniej i ostatnie pół godziny będzie puste. To jest miejsce na
  falę W1, nie na kolejną korektę cen.

## Uzupełnienia po G3

**`w_good` — zestaw rzadkości asemblera.** Wiersze maszyn odwoływały się do nazw
zestawów wag (`w_basic`, `w_good`), których **nigdzie nie było** — ani w kodzie, ani
w danych. `w_basic` jest bajt w bajt krzywą z fazy E. `w_good` trzeba było wymyślić:
każdy tier powyżej pierwszego waży ×1,5, co daje średnią **2,692** (+21,7 % wobec
2,212) i najwyższy tier **1 na 5733** zamiast 1 na 8000.

Przyjęte. Udział najwyższego tieru w dochodzie rośnie z 5,6 % do 6,5 %, czyli dalej
zostaje anegdotą, a nie źródłem utrzymania — warunek z ryzyka nr 9 w planie jest
spełniony. Efekt uboczny: asembler jest o ~22 % lepszy, niż zakładała symulacja
(która liczyła jedną średnią dla wszystkich producentów), więc krzywa przesuwa się
odrobinę wcześniej. To akurat dobrze — asembler przestaje być „szybszą prasą",
a zaczyna być realnym awansem.

**Siła stacji próżniowej: 12 → 18.** Autorska wartość była **poniżej progu tarcia**:
na betonie μ·g = 0,6 × 22 = **13,2 m/s²**. Zmierzone przed poprawką: 2745 impulsów
przez 10 sekund przesunęły jedną kaczkę na dwanaście. Liczba wyglądała jak strojenie,
a była zerem. To jest ogólniejsza pułapka niż ta jedna maszyna: **każda siła
przyłożona poziomo do leżącego obiektu musi najpierw pobić μ·g, zanim w ogóle zacznie
cokolwiek znaczyć** — a wysoka grawitacja gry (−22, nie −9,81) podnosi ten próg
ponad dwukrotnie względem intuicji.
