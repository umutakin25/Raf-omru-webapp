CREATE TABLE isletme (
  id TEXT PRIMARY KEY,
  ad TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,          -- gizli URL parçası
  varsayilan_omur_saat INTEGER DEFAULT 72,
  uyari1_saat INTEGER DEFAULT 24,      -- sarı eşiği
  uyari1_indirim INTEGER DEFAULT 20,
  uyari2_saat INTEGER DEFAULT 8,       -- kırmızı eşiği
  uyari2_indirim INTEGER DEFAULT 40,
  aktif INTEGER DEFAULT 1
);

CREATE TABLE urun (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  isletme_id TEXT NOT NULL,
  ad TEXT NOT NULL,
  omur_saat INTEGER,                   -- NULL ise isletme.varsayilan_omur_saat kullanılır
  donuk_adet INTEGER DEFAULT 0,        -- derin dondurucudaki stok
  sira INTEGER DEFAULT 0,
  aktif INTEGER DEFAULT 1
);

CREATE TABLE parti (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  isletme_id TEXT NOT NULL,
  urun_id INTEGER NOT NULL,
  adet INTEGER NOT NULL,               -- dolapta kalan adet
  cikti_ts INTEGER NOT NULL,           -- dondurucudan çıkarılma anı
  son_ts INTEGER NOT NULL,             -- cikti_ts + omur_saat*3600 (yazarken sabitlenir)
  durum TEXT DEFAULT 'aktif',          -- aktif | bitti | imha
  kapanis_ts INTEGER
);

CREATE TABLE hareket (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  isletme_id TEXT NOT NULL,
  tip TEXT NOT NULL,                   -- donuk_giris | dolaba_cikar | satis | imha | sayim | geri_al
  urun_id INTEGER,
  parti_id INTEGER,
  adet INTEGER,
  onceki_deger INTEGER,                -- sayım/geri alma için eski değer
  ts INTEGER NOT NULL,
  geri_alindi INTEGER DEFAULT 0
);

CREATE INDEX idx_parti_aktif ON parti(isletme_id, durum, son_ts);
CREATE INDEX idx_urun_isletme ON urun(isletme_id, aktif, sira);
CREATE INDEX idx_hareket_ts ON hareket(isletme_id, ts DESC);
