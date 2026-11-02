# Pursuk — Madset asistanı

Claude Messages API kullanan, ek paket kurulumu gerektirmeyen bir Node.js uygulaması. Node.js 22 veya üzeri gerekir.

## Başlatma

1. Claude Console üzerinden API anahtarı oluşturun: https://platform.claude.com/settings/keys
2. `anahtar-ekle.cmd` dosyasına çift tıklayın. Anahtar yalnızca bu bilgisayardaki `.env.local` dosyasına yazılır. Bu dosya şifrelenmiş değildir; paylaşmayın. Anahtarı sohbete yazmayın.
3. `baslat.cmd` dosyasını çalıştırın veya `npm start` kullanın.
4. Tarayıcıdan http://127.0.0.1:4317 adresini açın. Sunucuyu kapatmak için çalıştığı pencerede Ctrl+C kullanın.

Model `.env.local` içindeki `ANTHROPIC_MODEL` ile değiştirilebilir. Varsayılan `claude-sonnet-4-6`; hesabınızın bu modele erişimi gerekir. Claude API kullanımı sağlayıcının ücretlendirmesine tabidir.

## Birlikte geliştireceğimiz dosyalar

- `bot-talimatlari.txt`: Botun görevi, tonu ve sınırları.
- `madset-bilgi.md`: Tanıtım belgesinden sadeleştirilmiş bilgi; fiyatlar ve belirsiz konular için cevap uydurulmaması gerekir.
- `eval-sorulari.json`: Davranış değerlendirme soruları. İnsan değerlendirmesi içindir, otomatik geçmiş sayılmaz.
- `server.mjs`: Claude bağlantısı. Anahtar tarayıcıya gönderilmez.

Talimat ve bilgi dosyaları her istekte yeniden okunur. Değişiklikleri denemek için yeni sohbet başlatın. Anahtar veya model değişikliklerinde sunucuyu yeniden başlatın.

## Sınırlar

Bu sürüm yalnızca yerel bilgisayarda çalışır; internete açılmaya hazır değildir. Kullanıcı hesabı, reklam hesabı erişimi, işlem araçları, canlı politika araması veya destek kaydı bağlantısı içermez. Ürün kaynağı 2 Kasım 2026 tarihli kullanıcı belgesidir; bağımsız doğrulanmamıştır.

Mesajlar sunucuda dosyaya kaydedilmez; sohbet geçmişi sessionStorage ile aynı sekmede korunur; sayfa yenilemede geri yüklenir, Yeni sohbet ile temizlenir. Sekme kapatılınca tarayıcının oturum saklama davranışına tabidir. Her istekte geçmiş ve Madset bilgi kaynağı Anthropic'e gönderilir. Bu, sağlayıcının kendi veri işleme/saklama politikalarından bağımsız bir yerel davranış açıklamasıdır. Müşteri verileriyle kullanımdan önce kurumunuzun veri paylaşımı gerekliliklerini değerlendirin.

En fazla 30 soru-cevap turu (istekte en fazla 60 mesaj), mesaj başına 6.000 ve toplam 120.000 karakter kabul edilir. Hangisine önce ulaşılırsa o sınır uygulanır. Sınırda yeni sohbet gerekir; geçmiş sessizce kırpılmaz. Yanıt limiti 650 tokendir. Yanıtlar akış halinde gösterilir. Varsayılan üslup kısa yanıtlar ve uygun yerde en fazla bir emojidir. RAG yerine küçük bilgi kaynağının tamamı gönderilir. Dakikada 20 deneme ve aynı anda bir Claude isteği kabul edilir; 120 saniye sunucu, 130 saniye tarayıcı zaman aşımı vardır; sohbetin boşta bekleme süresi sınırı yoktur. Otomatik tekrar denenmez.

## Doğrulama

`npm test`: Girdi doğrulama, kaynak ve talimatların Claude isteğine eklenmesi, anahtarın tarayıcıya sızmaması, eksik anahtar, hata ve kaynak kontrolü testleri. Sahte Claude yanıtları kullanılır; canlı model kalitesini kanıtlamaz.

API referansı: https://platform.claude.com/docs/en/api/messages/create

## Token ölçümü

Claude API usage alanları kullanılır; karakterden token tahmini yapılmaz. Akış başındaki kullanım, message_delta içindeki kümülatif değerlerle güncellenir; üst üste toplanmaz. Giriş; normal giriş, önbellek okuma ve yazmanın toplamıdır. Çıkış ayrıca sayılır. Her isteğin benzersiz kimliğiyle ara ve son ölçümler tek kayıtta güncellenir.

Sohbet toplamı yalnızca bu sürümde tarayıcıya ulaşan ölçümleri kapsar. Önceki mesajlar ve ağ kesilmesi nedeniyle alınamayan kullanım dahil olmayabilir. Kısmi ölçümler işaretlenir. Yeni sohbet toplamı temizler; sayfa yenilemesi aynı sekmedeki ölçümleri geri getirir. Sunucu dosyaya kullanım kaydı tutmaz.

USD tutarı standart Sonnet 4.6 tarifesinden hesaplanan tahmindir: milyon token başına normal giriş $3, çıkış $15, önbellek okuma $0.30, 5 dakika yazma $3.75 ve 1 saat yazma $6. Başka modelde fiyat bilinmiyorsa ücret hesaplanmaz. Doğrulama tarihi 2 Kasım 2026; fiyat değişikliği, özel hesap koşulları ve vergileri yansıtmaz. Resmî kaynak: https://platform.claude.com/docs/en/about-claude/pricing

## Hazır cevaplar

`hazir-yanitlar.json` dosyası, onaylı soru biçimleri ve sabit cevapları içerir. `faq.mjs` sorunun tamamını eşleştirir; büyük/küçük harf, Türkçe harflerin düz yazımı ve noktalama farklılıklarını tolere eder. LLM ile sınıflandırma, embedding veya bulanık eşleştirme yapılmaz. Eşleşme yoksa Claude akışı kullanılır. Belirsiz, çok sorulu veya kişiye özel sorular için yeni varyant eklerken dikkatli olun.

Hazır cevaplar Claude API çağrısı yapmaz ve API anahtarı olmadan da çalışır. Ölçümde 0 API tokenı ve 0 USD olarak, Claude isteklerinden ayrı sayılır. Aynı 30 tur sınırına dahildir. Önceki hazır cevaplar sohbet geçmişinde korunur; sonraki bir soru Claude'a yönlendirilirse bu geçmiş de giriş tokenlarına dahil olur. Tasarruf oranı gerçek soru dağılımına bağlıdır; hazır cevapların yararlı olduğu varsayılarak sabit bir yüzde verilmez.

Katalog her soruda dosyadan okunur. Dosya bozuksa veya okunamıyorsa Claude'a düşülür. Sabit yanıtları ürün bilgisi değiştikçe güncelleyin. Hazır cevaplar, LLM yanıtları gibi bu yerel prototipin müşteri verilerine erişimi olduğu anlamına gelmez.
