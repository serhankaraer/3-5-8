# 3-5-8

Web arayüzünden oynanan, çok oyunculu (en fazla 3 insan, kalan koltuklar bot) 3-5-8 kart oyunu.
Node.js, düz JavaScript istemci, WebSocket için `ws` paketi.

## Çalıştırma

```
npm install
npm start            # http://localhost:3358  (PORT ile değiştirilir)
npm test             # bot simülasyonu + sunucu uçtan uca testi
```

Node 22 veya üstü gerekir. Aynı ağdaki cihazlar `http://<bilgisayar-ip>:3358` adresinden bağlanır.

Kurallar, mimari ve protokol: [SARTNAME.md](SARTNAME.md)
