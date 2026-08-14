# Faza 1 — katalog treści, i ile z niego da się dosypać bez kodu

Źródło: artifact „DUCKS — Faza 1: katalog pomysłów"
(`ca79c577-2664-4733-b8ee-184b2e7c7a7d`), 207 pozycji w pięciu listach:
**M — maszyny 39, U — upgrade'y 40, B — budowle 40, T — narzędzia 40,
P — pomysły ogólne 48.** Jurek wybrał z tego 154.

**Zapisane tutaj, bo do 2026-08-14 katalog nie istniał w repo w żadnej postaci.**
Plan podawał tylko liczbę 154, notatka w vaultcie też. Gdyby artifact przepadł,
przepadłyby wszystkie decyzje z fazy 1. To jest ten plik, który miał powstać
w dniu, w którym zapadły.

## Co jest w grze dzisiaj

**31 wierszy: maszyny 8, budowle 8, przedmioty 7, upgrade'y 8.**

Dobrane wg kryterium „pierwsza instancja swojej klasy mechanicznej", nie
„najtańsze". Efekt: przy 31 wierszach działa **11 z 11 rodzajów zachowań**
(`producer_manual`, `producer_auto`, `collector_auto`, `conveyor`, `blower`,
`wall`, `ramp`, `storage`, `carry`, `tool`, `upgrade`). Silnik jest kompletny;
brakuje wyłącznie treści.

## Maszyny — 39 w katalogu, 8 w grze. Klasyfikacja pozostałych 31

### A. Czysta danina — zero nowego kodu (7)

Mieszczą się w `producer_auto` / `producer_manual` dokładnie tak, jak są.
Wiersz to cena + `secondsPerDuck` + zestaw wag rzadkości.

| Pozycja | Wiersz |
|---|---|
| Wolny automat | 60 s, `w_basic` |
| Zbiornik kondensacyjny | 90 s, `w_basic` |
| Kaczkomat | 30 s, `w_basic` |
| Kaczkowa wylęgarnia | 20 s, `w_basic` |
| Kaczkowa drukarka 3D | 180 s, zestaw bez tieru 0 |
| Złota prasa | 40 s, zestaw bez tieru 0 |
| Reaktor rzadkościowy | 60 s, tylko najwyższe tiery |

Trzy ostatnie działają, bo „zawsze rzadka" to **zestaw wag z zerem na tierze 0** —
mechanizm, który już istnieje (`config.rarity.sets`, walidowany przy starcie).

### B. Jedno pole odblokowuje osiem (8)

Wszystkie mówią „N kaczek na raz" zamiast jednej. To **jedno pole
`produce.count`** i pętla w `producers.js` — kilkanaście linii, raz.

| Pozycja | Wiersz |
|---|---|
| Kaczkowy ul | 3 kaczki / 30 s |
| Podwójna wylęgarnia | 2 / 15 s |
| Prasa taśmowa | 5 / 50 s |
| Wibracyjny podajnik | 5 / 40 s |
| Automat losowy | 1–10 / 30 s (`count` jako zakres) |
| Kaczkowa fabryka | 10 / 20 s |
| Kaczkowy gejzer | 30 / 90 s |
| Nieskończona rura | ciągły strumień = bardzo niskie `secondsPerDuck` |

**To jest najlepszy stosunek zysku do pracy w całym projekcie:** jedno pole
danych, osiem maszyn, w tym trzy pozycje końcówki gry.

### C. Warianty ręczne — jedno pole (3)

`producer_manual` ma już `clicksPerDuck`. Brakuje tylko sposobu, żeby wiersz
powiedział, **czym** się kręci.

| Pozycja | Czego brakuje |
|---|---|
| Prasa nożna | wejście = skok zamiast kliknięcia |
| Korba dwuosobowa | wymaga dwóch graczy naraz |
| Kaczkowy młynek | wartość zależna od tempa klikania |

### D. Wymagają nowego rodzaju zachowania (13)

Tu nie ma drogi na skróty — każda to nowa implementacja w `sim/`.

- **Balistyka i obszar** (6): Armata kaczkowa, Rura z nieba, Deszczownica,
  Orbitalny zrzut, Kaczkowa fontanna, Wieża kaskadowa
- **Nowe systemy** (5): Sortownica (rozdziela strumień wg rzadkości),
  Klonownica, Kaczkowa czarna dziura, Posąg Boga Kaczek, Reaktor gumowy
  (kaczki wadliwe = nowy tier o wartości zero)
- **Zależne od czasu** (2): Piec wulkanizacyjny (podwójna wartość, jeśli
  wrzucona w 10 s), Dozownik ciśnieniowy (wypluwa z impetem — *być może* czysta
  danina, bo korba ma już `ejectSpeed`; do sprawdzenia pomiarem)

## Wynik liczbowy

| | maszyn |
|---|---|
| w grze dziś | 8 |
| **czysta danina — 0 linii kodu** | **+7** |
| **po dodaniu `produce.count`** | **+8** |
| razem po jednej małej zmianie w kodzie | **23 z 39** |
| warianty ręczne (3 osobne drobne mechaniki) | +3 → 26 |
| reszta, każda to osobny system | 13 |

**Z ośmiu maszyn można zrobić dwadzieścia trzy, dopisując wiersze danych i jedno
pole.** To jest dokładnie ta dźwignia, dla której v1 dobierano wg klas
mechanicznych, a nie wg ceny — i pierwszy moment, w którym się zwraca.

## To samo dla pozostałych list — do policzenia

Budowle (40 w katalogu, 8 w grze) i narzędzia (40 / 7) nie były jeszcze
klasyfikowane. Na oko duża część budowli to `wall` i `ramp` z innymi wymiarami,
czyli czysta danina — ale **na oko to nie jest pomiar** i nie wpisuję tu liczby,
której nie sprawdziłem.

---

# Budowle i narzędzia — policzone

## Budowle — 40 w katalogu

**13 jest już w grze.** Osiem w zakładce budowli (ściana, ściana wysoka, bandka,
narożnik, rynna, most, rampa, filar) plus pięć, które w katalogu leżą pod
budowlami, a w grze siedzą w zakładce maszyn: taśmociąg prosty, zakręcony,
wznoszący, wiatrak podstawowy, odkurzacz stacjonarny.

### Czysta danina — 12

Ściana szklana · Zjeżdżalnia prosta · Wiatrak mocny · Wibrator podłogowy ·
Podest · Schody · Płot siatkowy · Dach · Krawężnik pitu · Lampa ·
Znak kierunkowy · Neon DUCKS

Wibrator podłogowy jest ciekawy: to **taśmociąg o zerowej wysokości**, czyli
`conveyor` z płaskim colliderem. Nic nowego. Płot siatkowy „przepuszcza wiatr"
za darmo, bo nadmuch to test stożka, a nie kolizja — ściana i tak go nie blokuje.

### Za jedno pole — 5

| Pozycja | Czego brakuje |
|---|---|
| Odbijacz | `collider.restitution` na wierszu |
| Miękka ściana | to samo pole, niska wartość |
| Ślizg lodowy | `collider.friction` na wierszu (`addStaticBox` już je przyjmuje, tylko nie czyta z danych) |
| Wiatrak pionowy | `blow.pitchDegrees` |
| Trampolina | to samo pole, w górę + duża siła |

### Wymagają nowego kodu — 10

Lej zbierający · Lej pitu · Brama jednokierunkowa · Klapa ·
Zjeżdżalnia zakręcona · Wiatrak obrotowy · Katapulta · Tłok · Karuzela ·
Rura transportowa

Oba leje z jednego powodu: **collidery są wyłącznie prostopadłościanami**
(`COLLIDER_SHAPES = ['cuboid']`), a lej jest wklęsły. To znaczy kilka colliderów
na obiekt albo nowy kształt.

## Narzędzia — 40 w katalogu, 7 w grze

### Czysta danina — 12

Worek · Wywrotka · Wózek paletowy · Miotła szeroka · Odkurzacz przemysłowy ·
Dmuchawa do liści · Spychacz · Lasso · Wąż strażacki · Wentylator ręczny ·
Deska · Trąbka

Cztery z nich to `tool` w trybie `sweep` albo `beam` z innymi liczbami —
dmuchawa, spychacz, wąż i wentylator różnią się wyłącznie zasięgiem, kątem
i siłą.

### Za jedno pole — 5

| Pozycja | Czego brakuje |
|---|---|
| Kubeł dziurawy | `storage.leakPerSecond` |
| Skrzynia drewniana | to samo pole |
| Grabie | `tool.pull` — odwrócenie znaku siły |
| Ręczny magnes | to samo pole |
| Szufelka | nowy tryb w zamkniętej liście `KINDS.tool.modes` |

### Wymagają nowego kodu — 15

Plecak · Kosz na kółkach · Widły · Siatka na motyle · Rękawica telekinetyczna ·
Klucz · Latarka · Farba w sprayu · Miarka laserowa · Stoper produkcji ·
Skaner rzadkości · Pilot · Kanister · Rakieta tenisowa · Gwizdek

### Odpada — 1

**Młotek budowlany.** Zamrożona decyzja z fazy pytań: budowanie jest wbudowane,
bez narzędzia. Ten wiersz jest martwy i nie powinien wrócić.

---

# Wynik łączny — M + B + T = 119 pozycji

| | ile |
|---|---|
| w grze dziś | **28** |
| **czysta danina — 0 linii kodu** | **+31** |
| **za pięć małych pól** | **+18** |
| warianty ręczne korby | +3 |
| wymagają nowych systemów | 38 |
| odpada (młotek) | 1 |

**Z 28 pozycji można zrobić 59 nie pisząc ani linii logiki, i 77 dopisując pięć
pól.**

Pięć pól, w kolejności zysku:

1. **`produce.count`** — ile kaczek na emisję → **8 maszyn**
2. **`collider.restitution` / `collider.friction`** z wiersza → **3 budowle**
3. **`blow.pitchDegrees`** — nadmuch pod kątem → **2 budowle**
4. **`storage.leakPerSecond`** → **2 narzędzia**
5. **`tool.pull` + jeden nowy tryb** → **3 narzędzia**

To jest moment, w którym zwraca się kryterium doboru v1 („pierwsza instancja
swojej klasy mechanicznej", nie „najtańsze"). Gdyby v1 wybrano po cenie, żadna
z tych 49 pozycji nie byłaby daninowa — każda potrzebowałaby własnej
implementacji.
