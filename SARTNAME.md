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
  1. Kart değişimi (ilk el hariç): 8'li elin hakkı varsa önce o ister; işlem en yüksek hedeflide başlar, en düşük hedeflide biter.
  2. 8'li el (dağıtıcı) kozu belirler (herkese açık).
  3. Gömülecek 4 kartını seçer.
  4. Masadan 4 kapalı kartı (kitty) alır.
  5. Oyun başlar, 5'li el ilk kartı açar.
  Tüm kart alma-verme işlemleri koz belirlenmeden önce biter.
- El oynama: açılan renge uymak zorunlu, rengin yoksa istediğin kart. En yüksek koz, kozsuzsa açılan renkteki en yüksek kart eli alır; eli alan sonraki eli açar.
- Puan: el puanı = alınan el − hedef (toplamı her zaman 0). 9 el oynanır, her oyuncu her hedefi 3'er kez oynar. En yüksek toplam kazanır. Eşitlikte son elin puanı yüksek olan, yine eşitse ortak galibiyet.

### Kart değişimi

- Önceki elde hedefini aşan oyuncu, altında kalandan aştığı kadar kart ister.
- Sıra yeni elin hedeflerine göre en yüksekten en düşüğe: önce 8 olan, sonra 5 olan, sonra 3 olan ister. Bir isteyenin iki vereni varsa onlar da yüksek hedeften düşüğe sıralanır.
- İsteyen istemediği bir kartı iletir. Veren, o renkteki en yüksek kartını geri verir. O renkte kartı yoksa ya da en yüksek kartı iletilen karttan küçükse iletilen kart iade edilir.
- Kartlar üçüncü oyuncuya gösterilmez.

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
