/**
 * Raf Ömrü Takip — Cloudflare Worker (v2)
 *
 * Tek dosya, plain fetch handler. Framework yok, build step yok.
 * Zaman birimi her yerde epoch saniye (integer, UTC).
 *
 * Erişim: PIN yok, rol yok. Her şey tahmin edilemez gizli URL altında:
 *
 *   /k/<token>/            ana ekran (dolap + donuk stok)
 *   /k/<token>/api/...     API
 *   /k/<token>/log         client hata logu
 *
 * Token bulunamazsa 404 — 401 değil, uygulamanın varlığını belli etmemek için.
 */

const TOKEN_KALIBI = /^\/k\/([A-Za-z0-9_-]{16,128})(\/.*)?$/;

export default {
  async fetch(request, env) {
    let cevap;
    try {
      cevap = await yonlendirici(request, env);
    } catch (hata) {
      console.error(
        "Worker hatası:",
        new URL(request.url).pathname,
        hata && hata.stack ? hata.stack : hata
      );
      cevap = jsonCevap({ hata: "Sunucu hatası" }, 500);
    }
    return basliklariEkle(cevap);
  },
};


async function yonlendirici(request, env) {
  const url = new URL(request.url);
  const eslesme = url.pathname.match(TOKEN_KALIBI);

  if (!eslesme) return bulunamadi();

  const token = eslesme[1];
  const altYol = eslesme[2];

  if (altYol === undefined) {
    return Response.redirect(url.origin + url.pathname + "/" + url.search, 301);
  }

  const isletme = await isletmeBul(env, token);
  if (!isletme) return bulunamadi();

  if (altYol === "/log" && request.method === "POST") {
    return await hataLogla(request, isletme);
  }

  if (altYol === "/" && request.method === "GET") {
    return await sayfaVer(env, request, "/index.html");
  }

  if (altYol === "/api/durum" && request.method === "GET") {
    return jsonCevap(await durumGovdesi(env, isletme));
  }

  if (altYol === "/api/donuk-giris" && request.method === "POST") {
    return await donukGiris(request, env, isletme);
  }
  if (altYol === "/api/dolaba-cikar" && request.method === "POST") {
    return await dolabaCikar(request, env, isletme);
  }
  if (altYol === "/api/sayim" && request.method === "POST") {
    return await sayim(request, env, isletme);
  }
  if (altYol === "/api/geri-al" && request.method === "POST") {
    return await geriAl(request, env, isletme);
  }
  if (altYol === "/api/urun" && request.method === "GET") {
    return jsonCevap(await urunListesi(env, isletme));
  }
  if (altYol === "/api/urun" && request.method === "POST") {
    return await urunKaydet(request, env, isletme);
  }
  if (altYol === "/api/ayar" && request.method === "POST") {
    return await ayarKaydet(request, env, isletme);
  }
  if (altYol === "/api/rapor" && request.method === "GET") {
    return jsonCevap(await rapor(env, isletme, url));
  }
  const urunSilEslesme = altYol.match(/^\/api\/urun\/(\d+)\/sil$/);
  if (urunSilEslesme && request.method === "POST") {
    return await urunSil(request, env, isletme, Number(urunSilEslesme[1]));
  }

  const satisEslesme = altYol.match(/^\/api\/parti\/(\d+)\/satis$/);
  if (satisEslesme && request.method === "POST") {
    return await partiSatis(request, env, isletme, Number(satisEslesme[1]));
  }
  const imhaEslesme = altYol.match(/^\/api\/parti\/(\d+)\/imha$/);
  if (imhaEslesme && request.method === "POST") {
    return await partiImha(env, isletme, Number(imhaEslesme[1]));
  }

  if (altYol.startsWith("/api/")) {
    return jsonCevap({ hata: "Bilinmeyen endpoint" }, 404);
  }
  return bulunamadi();
}

async function sayfaVer(env, request, dosya) {
  const istek = new Request(new URL(dosya, request.url).toString(), {
    method: "GET",
  });
  const cevap = await env.ASSETS.fetch(istek);
  return new Response(cevap.body, cevap);
}


async function isletmeBul(env, token) {
  return await env.DB.prepare(
    `SELECT id, ad, varsayilan_omur_saat,
            uyari1_saat, uyari1_indirim,
            uyari2_saat, uyari2_indirim
       FROM isletme
      WHERE token = ? AND aktif = 1`
  )
    .bind(token)
    .first();
}

async function durumGovdesi(env, isletme) {
  const [urunSonuc, partiSonuc, hareketSonuc] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, ad, omur_saat, donuk_adet, sira,
              COALESCE(omur_saat, ?) AS etkin_omur_saat
         FROM urun
        WHERE isletme_id = ? AND aktif = 1
        ORDER BY sira ASC, ad ASC`
    ).bind(isletme.varsayilan_omur_saat, isletme.id),

    env.DB.prepare(
      `SELECT p.id, p.urun_id, p.adet, p.cikti_ts, p.son_ts,
              COALESCE(u.ad, 'Silinmiş ürün') AS urun_ad
         FROM parti p
         LEFT JOIN urun u ON u.id = p.urun_id AND u.isletme_id = p.isletme_id
        WHERE p.isletme_id = ? AND p.durum = 'aktif'
        ORDER BY p.son_ts ASC`
    ).bind(isletme.id),

    env.DB.prepare(
      `SELECT h.id, h.tip, h.urun_id, h.parti_id, h.adet,
              h.onceki_deger, h.ts, h.geri_alindi,
              COALESCE(u.ad, '') AS urun_ad
         FROM hareket h
         LEFT JOIN urun u ON u.id = h.urun_id AND u.isletme_id = h.isletme_id
        WHERE h.isletme_id = ?
        ORDER BY h.ts DESC, h.id DESC
        LIMIT 10`
    ).bind(isletme.id),
  ]);

  return {
    isletme: {
      ad: isletme.ad,
      varsayilan_omur_saat: isletme.varsayilan_omur_saat,
      uyari1_saat: isletme.uyari1_saat,
      uyari1_indirim: isletme.uyari1_indirim,
      uyari2_saat: isletme.uyari2_saat,
      uyari2_indirim: isletme.uyari2_indirim,
    },
    sunucu_ts: simdi(),
    urunler: urunSonuc.results,
    partiler: partiSonuc.results,
    hareketler: hareketSonuc.results,
  };
}


async function donukGiris(request, env, isletme) {
  const girdi = await urunAdetOku(request, 1);
  if (girdi.cevap) return girdi.cevap;

  const now = simdi();
  const [guncelleme] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE urun SET donuk_adet = donuk_adet + ?
        WHERE id = ? AND isletme_id = ? AND aktif = 1`
    ).bind(girdi.adet, girdi.urunId, isletme.id),

    env.DB.prepare(
      `INSERT INTO hareket (isletme_id, tip, urun_id, adet, onceki_deger, ts)
       SELECT isletme_id, 'donuk_giris', id, ?, donuk_adet - ?, ?
         FROM urun WHERE id = ? AND isletme_id = ? AND aktif = 1`
    ).bind(girdi.adet, girdi.adet, now, girdi.urunId, isletme.id),
  ]);

  if (guncelleme.meta.changes === 0) return urunYok();
  return jsonCevap(await durumGovdesi(env, isletme), 201);
}

async function dolabaCikar(request, env, isletme) {
  const girdi = await urunAdetOku(request, 1);
  if (girdi.cevap) return girdi.cevap;

  const now = simdi();
  const sonuc = await env.DB.batch([
    env.DB.prepare(
      `UPDATE urun SET donuk_adet = donuk_adet - ?
        WHERE id = ? AND isletme_id = ? AND aktif = 1`
    ).bind(girdi.adet, girdi.urunId, isletme.id),

    env.DB.prepare(
      `INSERT INTO parti (isletme_id, urun_id, adet, cikti_ts, son_ts, durum)
       SELECT isletme_id, id, ?, ?, ? + COALESCE(omur_saat, ?) * 3600, 'aktif'
         FROM urun WHERE id = ? AND isletme_id = ? AND aktif = 1`
    ).bind(
      girdi.adet, now, now, isletme.varsayilan_omur_saat,
      girdi.urunId, isletme.id
    ),

    env.DB.prepare(
      `INSERT INTO hareket
         (isletme_id, tip, urun_id, parti_id, adet, onceki_deger, ts)
       SELECT isletme_id, 'dolaba_cikar', id, last_insert_rowid(), ?, donuk_adet + ?, ?
         FROM urun WHERE id = ? AND isletme_id = ? AND aktif = 1`
    ).bind(girdi.adet, girdi.adet, now, girdi.urunId, isletme.id),
  ]);

  if (sonuc[0].meta.changes === 0) return urunYok();
  return jsonCevap(await durumGovdesi(env, isletme), 201);
}

async function sayim(request, env, isletme) {
  const girdi = await urunAdetOku(request, 0);
  if (girdi.cevap) return girdi.cevap;

  const now = simdi();
  const sonuc = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO hareket (isletme_id, tip, urun_id, adet, onceki_deger, ts)
       SELECT isletme_id, 'sayim', id, ?, donuk_adet, ?
         FROM urun WHERE id = ? AND isletme_id = ? AND aktif = 1`
    ).bind(girdi.adet, now, girdi.urunId, isletme.id),

    env.DB.prepare(
      `UPDATE urun SET donuk_adet = ?
        WHERE id = ? AND isletme_id = ? AND aktif = 1`
    ).bind(girdi.adet, girdi.urunId, isletme.id),
  ]);

  if (sonuc[1].meta.changes === 0) return urunYok();
  return jsonCevap(await durumGovdesi(env, isletme));
}


async function urunListesi(env, isletme) {
  const sonuc = await env.DB.prepare(
    `SELECT id, ad, omur_saat, donuk_adet, sira, aktif
       FROM urun
      WHERE isletme_id = ?
      ORDER BY aktif DESC, sira ASC, ad ASC`
  )
    .bind(isletme.id)
    .all();
  return { urunler: sonuc.results };
}

async function urunKaydet(request, env, isletme) {
  const govde = await govdeOku(request);
  if (!govde) return jsonCevap({ hata: "Geçersiz istek gövdesi" }, 400);

  const ad = typeof govde.ad === "string" ? govde.ad.trim() : "";
  if (!ad || ad.length > 80) {
    return jsonCevap({ hata: "Ürün adı boş olamaz, en fazla 80 karakter" }, 400);
  }

  const sira = tamsayi(govde.sira, 0, 9999);
  if (sira === null) return jsonCevap({ hata: "Sıra 0 ile 9999 arasında olmalı" }, 400);

  let omurSaat = null;
  if (govde.omur_saat !== null && govde.omur_saat !== undefined && govde.omur_saat !== "") {
    omurSaat = tamsayi(govde.omur_saat, 1, 2000);
    if (omurSaat === null) {
      return jsonCevap({ hata: "Özel raf ömrü 1 ile 2000 saat arasında olmalı" }, 400);
    }
    if (omurSaat <= isletme.uyari1_saat) {
      return jsonCevap(
        {
          hata:
            "Özel raf ömrü 1. uyarı eşiğinden (" + isletme.uyari1_saat +
            " saat) uzun olmalı, yoksa ürün dolaba çıkar çıkmaz uyarıya düşer",
        },
        400
      );
    }
  }

  const aktif = govde.aktif ? 1 : 0;
  const urunId =
    govde.id === undefined || govde.id === null ? null : tamsayi(govde.id, 1, 1000000000);
  if (govde.id !== undefined && govde.id !== null && urunId === null) {
    return jsonCevap({ hata: "id geçersiz" }, 400);
  }

  if (urunId === null) {
    await env.DB.prepare(
      `INSERT INTO urun (isletme_id, ad, omur_saat, donuk_adet, sira, aktif)
       VALUES (?, ?, ?, 0, ?, ?)`
    )
      .bind(isletme.id, ad, omurSaat, sira, aktif)
      .run();
    return jsonCevap(await durumGovdesi(env, isletme), 201);
  }

  const sonuc = await env.DB.prepare(
    `UPDATE urun SET ad = ?, omur_saat = ?, sira = ?, aktif = ?
      WHERE id = ? AND isletme_id = ?`
  )
    .bind(ad, omurSaat, sira, aktif, urunId, isletme.id)
    .run();

  if (sonuc.meta.changes === 0) return jsonCevap({ hata: "Ürün bulunamadı" }, 404);
  return jsonCevap(await durumGovdesi(env, isletme));
}

async function urunSil(request, env, isletme, urunId) {
  const govde = (await govdeOku(request)) || {};

  const sayim = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM parti
         WHERE urun_id = ? AND isletme_id = ? AND durum = 'aktif')   AS aktif_parti,
       (SELECT COALESCE(SUM(adet), 0) FROM parti
         WHERE urun_id = ? AND isletme_id = ? AND durum = 'aktif')   AS aktif_adet,
       (SELECT COUNT(*) FROM parti   WHERE urun_id = ? AND isletme_id = ?) AS parti,
       (SELECT COUNT(*) FROM hareket WHERE urun_id = ? AND isletme_id = ?) AS hareket,
       (SELECT id FROM urun          WHERE id = ? AND isletme_id = ?)      AS urun`
  )
    .bind(
      urunId, isletme.id, urunId, isletme.id,
      urunId, isletme.id, urunId, isletme.id, urunId, isletme.id
    )
    .first();

  if (sayim.urun === null) return jsonCevap({ hata: "Ürün bulunamadı" }, 404);

  if (sayim.aktif_parti > 0) {
    return jsonCevap(
      {
        hata:
          "Dolapta hâlâ " + sayim.aktif_adet + " adet var. Önce dolaptaki " +
          "partileri Satıldı ya da İmha ile kapatın, sonra silin.",
      },
      409
    );
  }

  const gecmisVar = sayim.parti > 0 || sayim.hareket > 0;

  if (gecmisVar && !govde.gecmisiSil) {
    return jsonCevap(
      {
        hata:
          "Bu ürünün " + sayim.parti + " dolap kaydı ve " + sayim.hareket +
          " hareketi var. Silerseniz bu geçmiş de gider.",
        gecmis_onayi_gerek: true,
        parti_sayisi: sayim.parti,
        hareket_sayisi: sayim.hareket,
      },
      409
    );
  }

  await env.DB.batch([
    env.DB.prepare("DELETE FROM hareket WHERE urun_id = ? AND isletme_id = ?")
      .bind(urunId, isletme.id),
    env.DB.prepare("DELETE FROM parti WHERE urun_id = ? AND isletme_id = ?")
      .bind(urunId, isletme.id),
    env.DB.prepare("DELETE FROM urun WHERE id = ? AND isletme_id = ?")
      .bind(urunId, isletme.id),
  ]);

  return jsonCevap(await durumGovdesi(env, isletme));
}

async function ayarKaydet(request, env, isletme) {
  const govde = await govdeOku(request);
  if (!govde) return jsonCevap({ hata: "Geçersiz istek gövdesi" }, 400);

  const alan = {
    omur: tamsayi(govde.varsayilan_omur_saat, 1, 2000),
    uyari1Saat: tamsayi(govde.uyari1_saat, 0, 2000),
    uyari1Indirim: tamsayi(govde.uyari1_indirim, 0, 100),
    uyari2Saat: tamsayi(govde.uyari2_saat, 0, 2000),
    uyari2Indirim: tamsayi(govde.uyari2_indirim, 0, 100),
  };
  const adlar = {
    omur: "Varsayılan raf ömrü",
    uyari1Saat: "1. uyarı eşiği",
    uyari1Indirim: "1. uyarı indirimi",
    uyari2Saat: "2. uyarı eşiği",
    uyari2Indirim: "2. uyarı indirimi",
  };
  for (const anahtar in alan) {
    if (alan[anahtar] === null) {
      return jsonCevap({ hata: adlar[anahtar] + " değeri geçersiz" }, 400);
    }
  }

  if (alan.uyari2Saat > alan.uyari1Saat) {
    return jsonCevap(
      { hata: "2. uyarı eşiği 1. uyarı eşiğinden büyük olamaz" },
      400
    );
  }
  if (alan.uyari1Saat >= alan.omur) {
    return jsonCevap(
      {
        hata:
          "1. uyarı eşiği raf ömründen kısa olmalı, yoksa ürün dolaba çıkar " +
          "çıkmaz uyarıya düşer",
      },
      400
    );
  }

  const cakisan = await env.DB.prepare(
    `SELECT ad FROM urun
      WHERE isletme_id = ? AND aktif = 1
        AND omur_saat IS NOT NULL AND omur_saat <= ?
      ORDER BY ad LIMIT 3`
  )
    .bind(isletme.id, alan.uyari1Saat)
    .all();

  if (cakisan.results.length > 0) {
    const adlarMetni = cakisan.results.map((r) => r.ad).join(", ");
    return jsonCevap(
      {
        hata:
          "Bu eşik şu ürünlerin özel raf ömründen uzun: " + adlarMetni +
          ". Önce onların ömrünü uzatın ya da eşiği düşürün.",
      },
      400
    );
  }

  await env.DB.prepare(
    `UPDATE isletme
        SET varsayilan_omur_saat = ?, uyari1_saat = ?, uyari1_indirim = ?,
            uyari2_saat = ?, uyari2_indirim = ?
      WHERE id = ?`
  )
    .bind(
      alan.omur, alan.uyari1Saat, alan.uyari1Indirim,
      alan.uyari2Saat, alan.uyari2Indirim, isletme.id
    )
    .run();

  const yeni = await env.DB.prepare(
    `SELECT id, ad, varsayilan_omur_saat, uyari1_saat, uyari1_indirim,
            uyari2_saat, uyari2_indirim
       FROM isletme WHERE id = ?`
  )
    .bind(isletme.id)
    .first();

  return jsonCevap(await durumGovdesi(env, yeni));
}


async function rapor(env, isletme, url) {
  const gun = tamsayi(url.searchParams.get("gun"), 1, 365) || 30;
  const baslangic = simdi() - gun * 86400;

  const [satirSonuc, ozetSonuc] = await env.DB.batch([
    env.DB.prepare(
      `SELECT COALESCE(u.ad, 'Silinmiş ürün') AS ad,
              SUM(CASE WHEN h.tip = 'satis' THEN h.adet ELSE 0 END) AS satilan,
              SUM(CASE WHEN h.tip = 'imha'  THEN h.adet ELSE 0 END) AS imha
         FROM hareket h
         LEFT JOIN urun u ON u.id = h.urun_id AND u.isletme_id = h.isletme_id
        WHERE h.isletme_id = ?
          AND h.tip IN ('satis', 'imha')
          AND h.geri_alindi = 0
          AND h.ts >= ?
        GROUP BY u.id, u.ad
        ORDER BY imha DESC, satilan DESC, ad ASC`
    ).bind(isletme.id, baslangic),

    env.DB.prepare(
      `SELECT MIN(ts) AS ilk_ts, COUNT(*) AS hareket_sayisi
         FROM hareket WHERE isletme_id = ?`
    ).bind(isletme.id),
  ]);

  const ozet = ozetSonuc.results[0] || {};
  return {
    gun: gun,
    baslangic_ts: baslangic,
    ilk_kayit_ts: ozet.ilk_ts === undefined ? null : ozet.ilk_ts,
    sunucu_ts: simdi(),
    satirlar: satirSonuc.results,
  };
}


async function partiSatis(request, env, isletme, partiId) {
  const govde = await govdeOku(request);
  if (!govde) return jsonCevap({ hata: "Geçersiz istek gövdesi" }, 400);

  const adet = tamsayi(govde.adet, 1, 9999);
  if (adet === null) return jsonCevap({ hata: "adet 1 ile 9999 arasında olmalı" }, 400);

  const now = simdi();
  const sonuc = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO hareket
         (isletme_id, tip, urun_id, parti_id, adet, onceki_deger, ts)
       SELECT isletme_id, 'satis', urun_id, id, ?, adet, ?
         FROM parti
        WHERE id = ? AND isletme_id = ? AND durum = 'aktif' AND adet >= ?`
    ).bind(adet, now, partiId, isletme.id, adet),

    env.DB.prepare(
      `UPDATE parti
          SET adet = adet - ?,
              durum      = CASE WHEN adet - ? <= 0 THEN 'bitti' ELSE 'aktif' END,
              kapanis_ts = CASE WHEN adet - ? <= 0 THEN ?       ELSE NULL    END
        WHERE id = ? AND isletme_id = ? AND durum = 'aktif' AND adet >= ?`
    ).bind(adet, adet, adet, now, partiId, isletme.id, adet),
  ]);

  if (sonuc[1].meta.changes === 0) {
    return jsonCevap(
      { hata: "Parti bulunamadı, kapanmış ya da dolapta o kadar adet yok" },
      409
    );
  }
  return jsonCevap(await durumGovdesi(env, isletme));
}

async function partiImha(env, isletme, partiId) {
  const now = simdi();
  const sonuc = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO hareket
         (isletme_id, tip, urun_id, parti_id, adet, onceki_deger, ts)
       SELECT isletme_id, 'imha', urun_id, id, adet, adet, ?
         FROM parti
        WHERE id = ? AND isletme_id = ? AND durum = 'aktif'`
    ).bind(now, partiId, isletme.id),

    env.DB.prepare(
      `UPDATE parti SET durum = 'imha', kapanis_ts = ?
        WHERE id = ? AND isletme_id = ? AND durum = 'aktif'`
    ).bind(now, partiId, isletme.id),
  ]);

  if (sonuc[1].meta.changes === 0) {
    return jsonCevap({ hata: "Parti bulunamadı veya zaten kapatılmış" }, 409);
  }
  return jsonCevap(await durumGovdesi(env, isletme));
}


async function geriAl(request, env, isletme) {
  const govde = await govdeOku(request);
  if (!govde) return jsonCevap({ hata: "Geçersiz istek gövdesi" }, 400);

  const hareketId = tamsayi(govde.hareket_id, 1, 1000000000);
  if (hareketId === null) return jsonCevap({ hata: "hareket_id geçersiz" }, 400);

  const hareket = await env.DB.prepare(
    `SELECT id, tip, urun_id, parti_id, adet, onceki_deger
       FROM hareket
      WHERE id = ? AND isletme_id = ? AND geri_alindi = 0
        AND id IN (
          SELECT id FROM hareket WHERE isletme_id = ?
           ORDER BY ts DESC, id DESC LIMIT 10
        )`
  )
    .bind(hareketId, isletme.id, isletme.id)
    .first();

  if (!hareket) {
    return jsonCevap(
      { hata: "Bu hareket geri alınamaz: zaten geri alınmış ya da çok eski" },
      409
    );
  }
  if (hareket.tip === "geri_al") {
    return jsonCevap({ hata: "Geri alma işlemi geri alınamaz" }, 409);
  }

  const ters = tersIfadeler(env, isletme, hareket);
  if (ters.cevap) return ters.cevap;

  const engel = await geriAlmaEngeli(env, isletme, hareket);
  if (engel) return engel;

  const now = simdi();
  await env.DB.batch([
    ...ters.ifadeler,
    env.DB.prepare("UPDATE hareket SET geri_alindi = 1 WHERE id = ? AND isletme_id = ?")
      .bind(hareket.id, isletme.id),
    env.DB.prepare(
      `INSERT INTO hareket
         (isletme_id, tip, urun_id, parti_id, adet, onceki_deger, ts, geri_alindi)
       VALUES (?, 'geri_al', ?, ?, ?, ?, ?, 1)`
    ).bind(
      isletme.id, hareket.urun_id, hareket.parti_id,
      hareket.adet, hareket.id, now
    ),
  ]);

  return jsonCevap(await durumGovdesi(env, isletme));
}

async function geriAlmaEngeli(env, isletme, hareket) {
  if (hareket.tip === "dolaba_cikar") {
    const parti = await env.DB.prepare(
      `SELECT adet, durum FROM parti WHERE id = ? AND isletme_id = ?`
    )
      .bind(hareket.parti_id, isletme.id)
      .first();

    if (!parti || parti.durum !== "aktif" || parti.adet !== hareket.adet) {
      return jsonCevap(
        { hata: "Geri alınamaz: bu partinin üzerinde başka işlem yapılmış" },
        409
      );
    }
    return null;
  }

  if (hareket.tip === "satis" || hareket.tip === "imha") {
    const parti = await env.DB.prepare(
      `SELECT id FROM parti WHERE id = ? AND isletme_id = ?`
    )
      .bind(hareket.parti_id, isletme.id)
      .first();
    if (!parti) return jsonCevap({ hata: "Geri alınamaz: parti bulunamadı" }, 409);
    return null;
  }

  const urun = await env.DB.prepare(
    `SELECT id FROM urun WHERE id = ? AND isletme_id = ?`
  )
    .bind(hareket.urun_id, isletme.id)
    .first();
  if (!urun) return jsonCevap({ hata: "Geri alınamaz: ürün bulunamadı" }, 409);
  return null;
}

function tersIfadeler(env, isletme, hareket) {
  if (hareket.tip === "donuk_giris") {
    return {
      ifadeler: [
        env.DB.prepare(
          `UPDATE urun SET donuk_adet = donuk_adet - ?
            WHERE id = ? AND isletme_id = ?`
        ).bind(hareket.adet, hareket.urun_id, isletme.id),
      ],
    };
  }

  if (hareket.tip === "sayim") {
    return {
      ifadeler: [
        env.DB.prepare(
          `UPDATE urun SET donuk_adet = ? WHERE id = ? AND isletme_id = ?`
        ).bind(hareket.onceki_deger, hareket.urun_id, isletme.id),
      ],
    };
  }

  if (hareket.tip === "dolaba_cikar") {
    return {
      ifadeler: [
        env.DB.prepare(
          `DELETE FROM parti
            WHERE id = ? AND isletme_id = ? AND durum = 'aktif' AND adet = ?`
        ).bind(hareket.parti_id, isletme.id, hareket.adet),

        env.DB.prepare(
          `UPDATE urun SET donuk_adet = donuk_adet + ?
            WHERE id = ? AND isletme_id = ?`
        ).bind(hareket.adet, hareket.urun_id, isletme.id),
      ],
    };
  }

  if (hareket.tip === "satis" || hareket.tip === "imha") {
    return {
      ifadeler: [
        env.DB.prepare(
          `UPDATE parti SET adet = ?, durum = 'aktif', kapanis_ts = NULL
            WHERE id = ? AND isletme_id = ?`
        ).bind(hareket.onceki_deger, hareket.parti_id, isletme.id),
      ],
    };
  }

  return { cevap: jsonCevap({ hata: "Bu hareket tipi geri alınamıyor" }, 400) };
}

async function urunAdetOku(request, enAzAdet) {
  const govde = await govdeOku(request);
  if (!govde) {
    return { cevap: jsonCevap({ hata: "Geçersiz istek gövdesi" }, 400) };
  }
  const urunId = tamsayi(govde.urun_id, 1, 1000000000);
  const adet = tamsayi(govde.adet, enAzAdet, 9999);
  if (urunId === null) {
    return { cevap: jsonCevap({ hata: "urun_id geçersiz" }, 400) };
  }
  if (adet === null) {
    return {
      cevap: jsonCevap(
        { hata: "adet " + enAzAdet + " ile 9999 arasında olmalı" },
        400
      ),
    };
  }
  return { urunId: urunId, adet: adet };
}

function urunYok() {
  return jsonCevap({ hata: "Ürün bulunamadı veya pasif" }, 400);
}


async function hataLogla(request, isletme) {
  const govde = await govdeOku(request);
  if (!govde) return jsonCevap({ hata: "Geçersiz istek gövdesi" }, 400);

  console.error(
    "Client hatası: " +
      JSON.stringify({
        isletme: isletme.id,
        mesaj: kirp(govde.mesaj, 300),
        kaynak: kirp(govde.kaynak, 200),
        satir: kirp(govde.satir, 10),
        sutun: kirp(govde.sutun, 10),
        yigin: kirp(govde.yigin, 800),
        tarayici: kirp(request.headers.get("User-Agent"), 200),
      })
  );

  return new Response(null, { status: 204 });
}

function kirp(deger, enCok) {
  if (deger === null || deger === undefined) return "";
  return String(deger).slice(0, enCok);
}


async function govdeOku(request) {
  try {
    return await request.json();
  } catch (hata) {
    return null;
  }
}

function tamsayi(deger, enAz, enCok) {
  const sayi = Number(deger);
  if (!Number.isInteger(sayi) || sayi < enAz || sayi > enCok) return null;
  return sayi;
}

function simdi() {
  return Math.floor(Date.now() / 1000);
}

function bulunamadi() {
  return jsonCevap({ hata: "Bulunamadı" }, 404);
}

function jsonCevap(govde, kod = 200) {
  return new Response(JSON.stringify(govde), {
    status: kod,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function basliklariEkle(cevap) {
  const yeni = new Response(cevap.body, cevap);
  yeni.headers.set("Cache-Control", "no-store");
  yeni.headers.set("Referrer-Policy", "no-referrer");
  yeni.headers.set("X-Robots-Tag", "noindex, nofollow");
  return yeni;
}
