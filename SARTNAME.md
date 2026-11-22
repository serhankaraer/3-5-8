# 3-5-8 Oyunu: şartname ve mimari

## Çalıştırma

```
npm install                          # tek bağımlılık: ws
node packages/server/index.js        # http://localhost:3358  (PORT ile değiştirilir)
npm test                             # simülasyon + uçtan uca test
```

Aynı ağdaki başka cihazlar `http://<bilgisayar-ip>:3358` adresinden bağlanır. Node 22+ gerekir.

## Kurallar

- 3 oyuncu, 52 kart (A en yüksek), saat yönü. Her oyuncuya 16 kart, 4 kart kitty. Her el 16 el (hamle turu).
- Hedefler: dağıtıcı **8**, solundaki **5**, sağındaki **3**. Her elden sonra dağıtıcı ve hedefler sola kayar (3→5→8→3). İlk dağıtıcı rastgele.
- Her el şu sırayla işler:
  1. Kart değişimi (1., 4. ve 7. elde af: kimse kart alıp vermez): 8'li elin hakkı varsa önce o ister; işlem en yüksek hedeflide başlar, en düşük hedeflide biter.
  2. 8'li el (dağıtıcı) kozu belirler (herkese açık).
  3. Gömülecek 4 kartını seçer.
  4. Masadan 4 kapalı kartı (kitty) alır.
  5. Oyun başlar, 5'li el ilk kartı açar.
  Tüm kart alma-verme işlemleri koz belirlenmeden önce biter.
- El oynama: açılan renkte kartın varsa o renkten atmak zorundasın ve masadaki en yüksek kartı geçebiliyorsan geçmek (büyütmek) zorundasın; geçemiyorsan o renkten istediğini atarsın. Rengin yoksa koz atmak zorundasın (masada koz varsa ve ondan büyük kozun varsa büyütmek zorundasın; büyüğün yoksa herhangi bir koz). Hem rengin hem kozun yoksa her kart serbest. Rengin varken masada koz olsa bile renk atarsın (kozu geçemezsin, büyütme zorunluluğu yok). En yüksek koz, kozsuzsa açılan renkteki en yüksek kart eli alır; eli alan sonraki eli açar.
- Puan: el puanı = alınan el − hedef (toplamı her zaman 0). 9 el oynanır, her oyuncu her hedefi 3'er kez oynar. En yüksek toplam kazanır. Eşitlikte son elin puanı yüksek olan, yine eşitse ortak galibiyet.

### Kart değişimi

- **Af:** hedef döngüsünün ilk eli olan 1., 4. ve 7. elde kart değişimi yoktur (3 elde bir af).
- Önceki elde hedefini aşan oyuncu, altında kalandan aştığı kadar kart ister. Örnek: +3 ile bitiren, eksi olanlardan toplam 3 kart ister.
- Sıra yeni elin hedeflerine göre en yüksekten en düşüğe: önce 8 olan, sonra 5 olan, sonra 3 olan ister. Bir isteyenin iki vereni varsa onlar da yüksek hedeften düşüğe sıralanır.
- **Tek seferde, körlemesine:** isteyen, istediği kartların hepsini tek hamlede iletir (iki vereni varsa ilk gruptaki kartlar ilk vereene, kalanlar ikinciye gider). Bir vereni dinleyip sonra diğerine göre kart seçmek yoktur; önce hepsi iletilir, sonra tüm verenler karşılığını verir.
- Veren, iletilen her kart için o renkteki en yüksek kartını geri verir (iletilen kart da elinde sayılır). Aynı renkten birden çok kart iletildiyse sıradaki en yüksek kartlar gelir. O renkte kartı yoksa ya da daha yükseği yoksa iletilen kart iade edilir.
- **Yerden gelen kart (kanıt, devir değil):** 8'li el yerdeki 4 kapalı kartı alınca, içinde kendisinden istenen bir seride diğer oyunculara verdiği kartlardan büyük kart varsa onu masada herkese açık gösterir ("Yerden geldi · ad"; hile yapmadığının kanıtı) ve günlüğe yazılır. Kart kimseye verilmez, 8'linin elinde kalır; kart değişimi yer kartlarına dokunmaz. Gösterim ilk el boyunca masada durur. İstenen renk dışındaki ya da verdiğinden küçük yer kartları gösterilmez.
- Kartlar üçüncü oyuncuya gösterilmez.

- Kart değişimi animasyonu: her isteyen adımında kartlar masada oyuncular arasında uçar (önce isteyenin kartları verene, sonra verenlerin iadeleri isteyene) ve üstte kim kimden kaç kart istedi / ne verdi yazar. İlgili iki oyuncu kartların yüzünü görür, üçüncü oyuncu yalnızca kapalı kart ve adet görür. Değişimden sonra masanın ortasında özet satırları durur (kim kime ne verdi, ne aldı). Elinde yeni gelen kartlar (değişimde alınanlar, 8'linin yerden aldıkları) ilk kart oynanana kadar yeşil noktayla işaretlenir.

## Altyapı kararları

- Düz JavaScript, TypeScript/React yok. İstemcide build adımı yok.
- Node.js sunucu, WebSocket için hazır `ws` paketi (`WebSocketServer`). Ölü bağlantıları yakalamak için 25 sn'de bir ping atılır.
- Koltuk: 3 koltuk, en fazla 3 insan, en fazla 2 bot. Giriş: oda kodu + takma ad (hesap yok). Arayüz Türkçe.
- Bağlantısı kopan insan için 30 sn beklenir, sonra bot devralır. İnsan geri dönünce koltuğunu bir sonraki elin başında geri alır.
- Hiç bağlı insan kalmazsa bekleme süresinden sonra botlar oyunu bekletmeden bitirir. Bağlı insan kalmayan oda 5 dk sonra silinir.
- Bot hesapları ana süreçte çalışır (worker havuzu yok).

## Botlar

- Özellikler 1-100 arası, ortalama 50 olan normal dağılımla üretilir; lobide sadece gösterilir (ayar yok).
  - `risk`: koz seçiminde kısa-güçlü renk sevme, kart gömerken yan rengi boşaltma, kazancı dalgalı hamleleri tercih etme
  - `memory`: oynanan kartların kaçını hatırladığı (kart sayma)
  - `foresight`: olası kart dağılımlarını simüle etme sayısı (ileriye dönük hesap)
  - `blocking`: puan tablosunda öndeki rakibin el almasını engelleme eğilimi
  - `tempo`: düşünme süresi, 1 sn (hızlı) ile 3 sn (yavaş) arası
- İsimler: 100 kadın/erkek ismi, rastgele, lakapsız.
- Botlar yalnızca insan oyuncunun görebildiği bilgiyi (`Game.view`) kullanır.

## Dizin yapısı

```
packages/engine   kurallar ve durum makinesi (saf JS, test edilebilir)
packages/ai       bot kişilikleri, isimler, bot kararları, el simülatörü
packages/server   HTTP + WebSocket, odalar, bot/insan yönetimi
packages/client   index.html, style.css, app.js
test/             simulate.js (bot oyunları, kural bütünlüğü), e2e.js (sunucu)
```

## Protokol (WebSocket, JSON)

İstemci → sunucu: `create{name}`, `join{room,name,token?}`, `addBot`, `removeBot{seat}`, `start`, `newGame`, `leave`,
`act{action}` (action: `discard{cards[4]}` | `trump{suit}` | `pass{card}` | `play{card}`).

Sunucu → istemci: `joined{room,seat,token}`, `update{you,room,game,log}` (her değişiklikte, oyuncuya özel süzülmüş), `error{msg,fatal?}`, `left`.
