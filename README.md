# Raf Ömrü Takip

Kafeler için pasta/tatlı raf ömrü ve stok takip uygulaması. Bir kafede tabletlerde
çalışacak şekilde geliştirildi: son kullanma süresi yaklaşan ürünleri renkle işaretler,
böylece çöpe gitmeden indirimle satılabilirler.

**Teknoloji:** Cloudflare Workers + D1 (SQLite), vanilla JS. Framework ve build adımı yok,
tek bağımlılık `wrangler`.

## Özellikler

- **İki ayrı stok:** derin dondurucudaki donuk stok ve vitrin dolabındaki partiler ayrı tutulur.
- **Geri sayım:** ürün dondurucudan çıkarıldığı anda başlar (varsayılan 72 saat, ürün bazında değiştirilebilir).
- **İki kademeli uyarı:** sarı ve kırmızı eşikler, her eşik için önerilen indirim oranı.
- **Satış, imha ve sayım:** kısmi satış/imha, stok sayımı ve son işlemi geri alma.
- **Rapor:** ürün bazında satılan, imha edilen adet ve zayi oranı.
- **Çok işletmeli şema:** her işletme kendi gizli URL'i altında, veriler `isletme_id` ile ayrılır.

## Yapı

```
schema.sql           Tablolar: isletme, urun, parti, hareket + index'ler
seed.sql             Lokal test verisi
src/index.js         Worker: yönlendirme, API, erişim kontrolü
public/index.html    Tablet ekranı (dolap, donuk stok, ürünler, rapor)
wrangler.toml        Worker ve D1 ayarları
```

## Tasarım kararları

- **Erişim gizli URL ile:** `/k/<token>/` altında çalışır; geçersiz token'a 404 döner,
  uygulamanın varlığı belli olmaz. Tabletlerde PIN girme derdi yok.
- **`hareket` tablosu bir defter:** her giriş, çıkış, satış ve imha kaydedilir; rapor ve
  geri alma bu tablodan çalışır.
- **Son kullanma anı yazılırken sabitlenir:** bir ürünün ömrünü sonradan değiştirmek
  rafta duran partileri etkilemez.
- **Push, cron ve service worker yok:** tablet 60 saniyede bir veri çeker, kalan süreyi
  istemci hesaplar. Ücretsiz Cloudflare planının çok altında kalır.

## Lokal çalıştırma

```bash
npm install
npm run db:local
npm run seed:local
npm run dev
```

Ardından `http://localhost:8787/k/yerel-test-token-0001/` adresini aç.

## Deploy

`wrangler.toml` içindeki `database_id` değerini kendi D1 veritabanınla değiştir:

```bash
npx wrangler d1 create raf-omru
npm run db:remote
npm run deploy
```
