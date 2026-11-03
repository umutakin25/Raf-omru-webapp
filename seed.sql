DELETE FROM hareket WHERE isletme_id = 'test';
DELETE FROM parti   WHERE isletme_id = 'test';
DELETE FROM urun    WHERE isletme_id = 'test';
DELETE FROM isletme WHERE id = 'test';

INSERT INTO isletme
  (id, ad, token, varsayilan_omur_saat,
   uyari1_saat, uyari1_indirim, uyari2_saat, uyari2_indirim, aktif)
VALUES
  ('test', 'Test Kafe', 'yerel-test-token-0001', 72, 24, 20, 8, 40, 1);

INSERT INTO urun (isletme_id, ad, omur_saat, donuk_adet, sira, aktif) VALUES
  ('test', 'San Sebastian Cheesecake', NULL,  20, 10, 1),
  ('test', 'Cheesecake',               NULL,  12, 20, 1),
  ('test', 'Tiramisu',                 NULL,   4, 30, 1),
  ('test', 'Profiterol',                 36,   0, 40, 1),
  ('test', 'Brownie',                  NULL,  -3, 50, 1),
  ('test', 'Magnolia',                 NULL,   8, 60, 1),
  ('test', 'Mevsimlik Kabak Tatlısı',  NULL,   0, 70, 0);

INSERT INTO parti (isletme_id, urun_id, adet, cikti_ts, son_ts, durum)
VALUES
  ('test', (SELECT id FROM urun WHERE isletme_id='test' AND ad='Profiterol'),
    2, unixepoch() - 38*3600, unixepoch() - 2*3600, 'aktif'),

  ('test', (SELECT id FROM urun WHERE isletme_id='test' AND ad='Magnolia'),
    1, unixepoch() - (71*3600 + 20*60), unixepoch() + (40*60), 'aktif'),

  ('test', (SELECT id FROM urun WHERE isletme_id='test' AND ad='Tiramisu'),
    3, unixepoch() - 67*3600, unixepoch() + (5*3600 + 8*60), 'aktif'),

  ('test', (SELECT id FROM urun WHERE isletme_id='test' AND ad='Cheesecake'),
    4, unixepoch() - 53*3600, unixepoch() + (19*3600 + 25*60), 'aktif'),

  ('test', (SELECT id FROM urun WHERE isletme_id='test' AND ad='San Sebastian Cheesecake'),
    6, unixepoch() - 19*3600, unixepoch() + (53*3600 + 17*60), 'aktif'),

  ('test', (SELECT id FROM urun WHERE isletme_id='test' AND ad='Brownie'),
    2, unixepoch() - 4*3600, unixepoch() + (68*3600 + 3*60), 'aktif'),

  ('test', (SELECT id FROM urun WHERE isletme_id='test' AND ad='Cheesecake'),
    0, unixepoch() - 100*3600, unixepoch() - 28*3600, 'bitti'),
  ('test', (SELECT id FROM urun WHERE isletme_id='test' AND ad='Tiramisu'),
    2, unixepoch() - 96*3600, unixepoch() - 24*3600, 'imha');

UPDATE parti SET kapanis_ts = unixepoch() - 30*3600
 WHERE isletme_id = 'test' AND durum <> 'aktif';
