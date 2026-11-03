# Pursuk — Madset asistanı

Claude Messages API ve PostgreSQL kullanan Node.js uygulaması. Node.js 22.16 veya üzeri ve PostgreSQL gerekir. Bağlantı için `pg` paketi kullanılır; ilk kurulumda `npm ci` çalıştırın.

## Başlatma

1. Claude Console üzerinden API anahtarı oluşturun: https://platform.claude.com/settings/keys
2. `anahtar-ekle.cmd` dosyasına çift tıklayın. Anahtar yalnızca bu bilgisayardaki `.env.local` dosyasına yazılır. Bu dosya şifrelenmiş değildir; paylaşmayın. Anahtarı sohbete yazmayın.
3. `.env.local` içine `DATABASE_URL` ekleyin. Bu Windows bilgisayarında PostgreSQL 17 ile ayrı yerel kurulum için `npm run db:setup-local` kullanılabilir. Sonra `baslat.cmd` veya `npm start` ile başlatın.
4. Tarayıcıdan http://127.0.0.1:4317 adresini açın. Sunucuyu kapatmak için çalıştığı pencerede Ctrl+C kullanın.

Model `.env.local` içindeki `ANTHROPIC_MODEL` ile değiştirilebilir. Varsayılan `claude-sonnet-4-6`; hesabınızın bu modele erişimi gerekir. Claude API kullanımı sağlayıcının ücretlendirmesine tabidir.

## Birlikte geliştireceğimiz dosyalar

- `bot-talimatlari.txt`: Botun görevi, tonu ve sınırları.
- `madset-bilgi.md`: Tanıtım belgesinden sadeleştirilmiş bilgi; fiyatlar ve belirsiz konular için cevap uydurulmaması gerekir.
- `eval-sorulari.json`: Davranış değerlendirme soruları. İnsan değerlendirmesi içindir, otomatik geçmiş sayılmaz.
- `server.mjs`: Claude bağlantısı. Anahtar tarayıcıya gönderilmez.

Talimat ve bilgi dosyaları her istekte yeniden okunur. Değişiklikleri denemek için yeni sohbet başlatın. Anahtar veya model değişikliklerinde sunucuyu yeniden başlatın.

## Sınırlar

Bu sürüm yalnızca yerel bilgisayarda çalışır; internete açılmaya hazır değildir. Örnek kullanıcı hesapları içerir; gerçek Madset oturumu, reklam hesabı erişimi, işlem araçları, canlı politika araması veya destek kaydı bağlantısı henüz yoktur. Ürün kaynağı 2 Kasım 2026 tarihli kullanıcı belgesidir; bağımsız doğrulanmamıştır.

Tamamlanan sohbetler, hazır seçenekler ve konuşma özetleri kullanıcı ve sohbet kimliği ile PostgreSQL’de kalıcı saklanır. Sunucu geçmişin yetkili kaynağıdır; tarayıcıdan gönderilen eski asistan mesajları kullanılmaz. Tarayıcı yalnızca aktif sohbet kimliğini sessionStorage içinde tutar. Yeni cihaz veya sekmede son dolu sohbet yüklenir. Yeni sohbet önceki kaydı silmez, yeni kimlik açar. Geçişten önce yalnızca tarayıcıda duran sohbet metinleri otomatik aktarılmaz. Claude’a yönlendirilen istekte gerekli geçmiş ve Madset kaynağı Anthropic’e gönderilir.

Sohbet başına teknik güvenlik sınırı 100 soru-cevap turu (istekte en fazla 200 mesaj), mesaj başına 6.000 ve toplam 120.000 karakter kabul edilir. Hangisine önce ulaşılırsa o sınır uygulanır. Sınırda yeni sohbet gerekir; geçmiş sessizce kırpılmaz. Yanıt limiti 650 tokendir. Yanıtlar akış halinde gösterilir. Varsayılan üslup kısa yanıtlar ve uygun yerde en fazla bir emojidir. RAG yerine küçük bilgi kaynağının tamamı gönderilir. Dakikada 20 deneme ve aynı anda bir Claude isteği kabul edilir; 120 saniye sunucu, 130 saniye tarayıcı zaman aşımı vardır; sohbetin boşta bekleme süresi sınırı yoktur. Otomatik tekrar denenmez.

## Doğrulama

`npm test`: Girdi doğrulama, kaynak ve talimatların Claude isteğine eklenmesi, anahtarın tarayıcıya sızmaması, eksik anahtar, hata ve kaynak kontrolü testleri. Sahte Claude yanıtları kullanılır; canlı model kalitesini kanıtlamaz.

API referansı: https://platform.claude.com/docs/en/api/messages/create

## Token ölçümü

Claude API usage alanları kullanılır; karakterden token tahmini yapılmaz. Akış başındaki kullanım, message_delta içindeki kümülatif değerlerle güncellenir; üst üste toplanmaz. Giriş; normal giriş, önbellek okuma ve yazmanın toplamıdır. Çıkış ayrıca sayılır. Her isteğin benzersiz kimliğiyle ara ve son ölçümler tek kayıtta güncellenir.

Ölçümler ziyaretçiye gönderilmez. Yalnızca şifreli yönetim ekranında görülür. Sunucu belleğinde en fazla 500 istek tutulur; yeniden başlatmada sıfırlanır. Kısmi ve alınamayan ölçümler ayrıca belirtilir. Toplam, saklanan kayıtları kapsar; fatura yerine geçmez. Sunucu dosyaya kullanım kaydı tutmaz.

USD tutarı standart Sonnet 4.6 tarifesinden hesaplanan tahmindir: milyon token başına normal giriş $3, çıkış $15, önbellek okuma $0.30, 5 dakika yazma $3.75 ve 1 saat yazma $6. Başka modelde fiyat bilinmiyorsa ücret hesaplanmaz. Doğrulama tarihi 2 Kasım 2026; fiyat değişikliği, özel hesap koşulları ve vergileri yansıtmaz. Resmî kaynak: https://platform.claude.com/docs/en/about-claude/pricing

## Hazır cevaplar

`hazir-yanitlar.json` dosyası, onaylı soru biçimleri ve sabit cevapları içerir. `faq.mjs` sorunun tamamını eşleştirir; büyük/küçük harf, Türkçe harflerin düz yazımı ve noktalama farklılıklarını tolere eder. LLM ile sınıflandırma veya embedding kullanılmaz. Selamlama ve nezaket farkları, eşdeğer e-posta yazımları ve yalnızca bilinen konu adlarında tek harflik yazım hataları yerel kurallarla ele alınır. Soru fiilleri ve olumsuzluklar yaklaşık eşleştirilmez. Birden fazla konu eşleşirse Claude kullanılır. Eşleşme yoksa Claude akışı kullanılır. Belirsiz, çok sorulu veya kişiye özel sorular için yeni varyant eklerken dikkatli olun.

Hazır cevaplar Claude API çağrısı yapmaz ve API anahtarı olmadan da çalışır. Ölçümde 0 API tokenı ve 0 USD olarak, Claude isteklerinden ayrı sayılır. Günlük 20 ve aylık 400 yapay zekâ mesajı kotasına dahil değildir; hak kalmasa da hazır sorular ve menüler kullanılabilir. Önceki hazır cevaplar sohbet geçmişinde korunur; sonraki bir soru Claude'a yönlendirilirse bu geçmiş de giriş tokenlarına dahil olur. Tasarruf oranı gerçek soru dağılımına bağlıdır; hazır cevapların yararlı olduğu varsayılarak sabit bir yüzde verilmez.

Katalog her soruda dosyadan okunur. Dosya bozuksa veya okunamıyorsa Claude'a düşülür. Sabit yanıtları ürün bilgisi değiştikçe güncelleyin. Hazır cevaplar, LLM yanıtları gibi bu yerel prototipin müşteri verilerine erişimi olduğu anlamına gelmez.


## Ziyaretçi sohbeti ve yönetim

- `/`: Sağ altta Pursuk simgesi bulunan yerel web sitesi demosu.
- `/chat`: Teknik bilgi içermeyen ziyaretçi sohbeti. Kapatıp açma, aynı sekmedeki geçmişi korur.
- `/admin`: Şifre ile giriş yapılan yönetim ekranı. Model, token, yaklaşık maliyet ve yönlendirme kayıtları burada görülür.

İlk yönetici girişi için `yonetici-sifre.cmd` dosyasına çift tıklayıp en az 12 karakterlik şifre belirleyin. API anahtarınızdan farklı bir şifre kullanın. Şifrenin kendisi yerine rastgele tuzla scrypt özeti `.admin-auth.json` dosyasına yazılır; dosya Git dışında tutulur ve web üzerinden sunulmaz. Şifre değişince eski yönetim oturumları geçersiz olur. Oturum HttpOnly ve SameSite=Strict çerezle en fazla 8 saat sürer; beş yanlış denemeden sonra bir dakika beklenir. Yönetim şifresi kurulana kadar erişim kapalıdır.

`/api/chat` yanıtları yalnızca metin, bitiş ve hata bilgisi içerir. Model, fiyat, token, hazır cevap kaynağı veya yönlendirme kaydı göndermez. İsteklere `admin=true` eklemek bu ayrımı değiştirmez. Yönetim verileri yalnızca doğrulanmış oturumla `/api/admin/metrics` üzerinden alınır.

Sunucuda 500 isteklik sınırlı bellek kaydı tutulur, yönetimde son 100 istek listelenir. Soru metnindeki yaygın e-posta, telefon/uzun numara, URL ve API anahtarı biçimleri gizlenir. Bu tam anonimleştirme değildir; isimler ve standart dışı veriler kalabilir. Tam sohbet veya yanıt metni yönetim kaydına kopyalanmaz. Önceki prototipin tarayıcı içi kayıtları aktarılmaz; ziyaretçi uygulaması eski ölçüm/yönlendirme kayıtlarını sekmeden temizler.

## Web sitesine ekleme

Yerel denemede sayfaya `<script src="http://127.0.0.1:4317/widget.js" defer></script>` eklenebilir. Açılan pencere `/chat` sayfasını iframe içinde kullanır; kapatma konuşmayı sıfırlamaz. Escape tuşu ve kapatma düğmesi desteklenir.

Bu adres yalnızca bu bilgisayarda çalışır. Canlı site için sunucunun HTTPS ile yayımlanması ve gerçek site adresine göre origin/iframe izinlerinin düzenlenmesi gerekir. Mevcut sürüm yalnızca aynı yerel kaynaktan gömülmeye izin verir; farklı alan adına doğrudan yayın yapılmış sayılmaz. Hesap bazında kota ve kalıcı PostgreSQL deposu vardır. Gerçek Madset oturumu, HTTPS/alan adı ayarları, yedekleme ve dağıtım henüz tamamlanmamıştır.
## Madset tanıtım akışı

Yeni sohbette "Madset’i tanımak istiyorum" seçeneği görünür. Tanıtım cevabından sonra "Özellikler" ve "Nasıl başlarım?" düğmeleri çıkar. Üç adım da sunucunun izin verdiği sabit eylem kimlikleriyle katalogdan cevaplanır; Claude çağrısı yapılmaz. Geçersiz eylem veya eksik hazır cevap ücretli modele düşmez, hata gösterir. Kullanıcı istediği zaman serbest mesaj yazabilir. Serbest sorular için mevcut hazır cevap kontrolü ve ardından Claude akışı korunur.

Seçenekler, konuşma kaydıyla birlikte PostgreSQL’de tutulur. Yeni sohbet ilk seçeneğe döner. Yönetimde bu adımlar "Seçenekli akış" olarak, sıfır API tokenıyla kaydedilir. Ziyaretçiye teknik kullanım bilgileri gönderilmez; yalnızca gösterilecek düğmelerin kimlik ve etiketleri eklenir.

## Kullanım yardımı akışı

İlk ekranda "Kullanırken yardıma ihtiyacım var" seçeneği de bulunur. Bu seçenek hesap bağlantısı, içerik hazırlama ve destek ekibi düğmelerini açar. Her düğme izinli sabit eylemle katalogdan yanıt alır; Claude çağrısı yapılmaz. Alt konulardan yardıma dönülebilir. Hesap bağlantısı cevabı mevcut ürün notuna dayanır; doğrulanmamış ekran ve düğme adları, mevcut reklam hesabını devralma desteği veya destek geri dönüş süresi vaat edilmez. Destek düğmesi iletişim adresini gösterir; e-posta göndermez veya destek kaydı açmaz.

## Geçmiş özetleme denemesi

Kullanıcı kotası günlük 20, aylık 400 sorudur; yeni sohbet bu kotayı sıfırlamaz. Ekrandaki tam geçmiş PostgreSQL’de korunur; yalnızca Claude'a gönderilen bağlam kısaltılır. Hazır cevap ve menü adımlarında özetleme isteği yapılmaz.

En az 19 mesajlık bir model isteğinde, özetlenecek eski bölüm en az 4.000 karakter olduğunda devreye girer. Eski mesajlar 12 mesajlık gruplar halinde özetlenir; en az son 6 mesaj ve yeni soru korunur. Aynı eski bölüm için özet her mesajda yeniden üretilmez. Kullanıcının düzeltmeleri son mesajlarda aynen kalır. Özetler talimat veya resmî Madset bilgi kaynağı sayılmaz; kullanıcı rolündeki bağlam verisine eklenir.

Özet en fazla 1.800 karakter kabul edilir; özetleme isteğinin çıkış sınırı 450 tokendir. Kesilmiş, çok uzun veya başarısız özet kullanıldığında bağlam sessizce silinmez; tam geçmişe veya önceki geçerli özete dönülür. Aynı başarısız gruba her mesajda tekrar ücretli özet isteği yapılmaz. Yeni bir sohbet kimliği farklı bir özet alanı kullanır; eski bölüm değişirse onun özeti yeniden kullanılamaz.

Özetler sohbetin `summary_cache` alanında PostgreSQL’e kaydedilir ve yeniden başlatmada korunur. Başarısız özet denemeleri de aynı eski bölümde tekrar maliyet yaratmamak için kaydedilir. Özet metni ziyaretçi API’sine gönderilmez; yönetimde yalnızca özetleme isteği ve kaç eski mesajın özetlendiği görünür. Özetleme tokenları ve maliyeti toplam hesaba dahildir. İlk özet gereken yanıtta ek bekleme olabilir.

`.env.local` içinde `SUMMARIZE_HISTORY=false` ayarıyla kapatılabilir; değişiklikten sonra sunucu yeniden başlatılmalıdır. Varsayılan açıktır. Özetleme, sabit talimat ve Madset bilgi metnini ortadan kaldırmaz; bu içerikler yine her model isteğine eklenir. Tasarruf oranı konuşmaya bağlıdır ve garanti edilmez.

## Örnek hesaplar ve kullanıcı kotası

MOCK_AUTH=true yalnızca yerel test hesaplarını açar; gerçek Madset girişi değildir. /chat ekranında örnek hesabı seçin. demo-ayse ve demo-deniz boş hesaplar; demo-gunluk ilk kurulum gününde 19/20, demo-aylik kurulum ayında 399/400 kullanım ile başlar. Başlangıç verileri yalnızca ilk kurulumda yazılır, sunucu yeniden başlayınca yenilenmez.

Kota PostgreSQL’deki pursuk.usage tablosunda kalıcıdır. Gün Europe/Istanbul gece yarısında, ay takvim ayı başında değişir. Hazır cevap ve menü seçimleri hak tüketmez; yalnızca Claude yanıtı bir kullanıcı hakkı tüketir; sistemin özetleme isteği tüketmez. Geçersiz veya normal hata ile biten istekler sayılmaz. Yanıt sürerken PostgreSQL işlemi ve hesap satırı kilidi ile hak atomik ayrılır. Başarılı yanıt ve hak tamamlama aynı işlemde kaydedilir. Normal hata hakkı iade eder; süreç zorla kapanırsa bekleyen hak tüketilmiş kalabilir. Aynı hesaba ait farklı sohbet ve cihazlar sunucudaki ortak sayacı kullanır. Her sohbet sorgusunda doğrulanmış kullanıcı kimliği aranır; başka hesabın sohbet kimliği ile veri alınamaz.

Üretimde MOCK_AUTH=false ayarlanmalıdır; bu durumda örnek hesap uçları kapalıdır ve doğrulanmış kullanıcı sağlayıcısı bağlanana kadar sohbet erişimi reddedilir. createApp resolveUser(req) uyarlayıcısı sunucuda doğrulanmış {id,name} döndürmelidir; kullanıcı kimliği mesaj gövdesinden alınmaz. Gerçek Madset oturumu henüz bağlanmamıştır. PostgreSQL farklı sunucu süreçlerinin ortak kota ve sohbet deposu olabilir. Mevcut Claude eşzamanlılık/hız koruması ve yönetici oturumu hâlâ uygulama süreci bazındadır; tam bir üretim dağıtımı olarak değerlendirilmemelidir.


## PostgreSQL kurulumu ve veri modeli

- `DATABASE_URL`: Uygulama veritabanı bağlantısı; yalnızca .env.local içine yazılır.
- `TEST_DATABASE_URL`: Sadece adı _test ile biten ayrı test veritabanı. `npm run test:postgres` gerçek PostgreSQL üzerinde kalıcılık ve yarış testlerini çalıştırır. `npm test` de .env.local içindeki TEST_DATABASE_URL bağlantısını kullanır; veritabanı gerektiren kontroller ayar yoksa açık hata verir.
- `migrations/001_initial.sql`: Uygulamaya ait pursuk şeması ve sürüm kaydı; başlangıçta işlem/advisory lock ile uygulanır. Sürümler yalnızca bir kez uygulanır. 002 geçişi artık kullanılmayan aktarım takip tablosunu kaldırır.
- `pursuk.users`, `usage`, `reservations`: Kimlikler, dönem sayaçları ve mesaj hakkı rezervasyonları.
- `pursuk.conversations`: Tam mesajlar, seçenekler ve özet önbelleği. Aynı sohbette iki sunucunun geçmişi ezmesi süreli veritabanı kilidiyle engellenir.
- `pursuk.mock_sessions`: Parola içermeyen test oturumlarının token özetleri.

Yerel kurulum .postgres-data dizininde kalıcı veriler, .postgres-local.json dosyasında yerel kurulum bilgilerini saklar. Bu dizin, bağlantı ayarları ve node_modules Git dışında tutulur. .postgres-local.json ve .env.local gizlidir, paylaşılmamalıdır. PostgreSQL yalnızca 127.0.0.1:54329 üzerinden dinler. Uygulama hesabı süper kullanıcı değildir. Başlatıcı yerel kurulum varsa PostgreSQL’i de başlatır; uygulamayı kapatmak veritabanını durdurmaz. Gerekirse `npm run db:stop-local` kullanın.

PostgreSQL erişilemezse sunucu açılmaz; başka bir depoya veya geçici belleğe sessizce dönülmez. Yeni mesajın tamamlanması veritabanına kaydedilmeden başarı sinyali gönderilmez. Tam geçmiş kalıcı olsa da her istekte tüm veriler Claude’a gönderilmez; mevcut özetleme kuralı korunur. Yeni sohbet eski konuşmayı otomatik model bağlamına eklemez.

Canlı ortamda yerel .postgres-local.json dosyası taşınmaz; yönetilen veya sunucudaki PostgreSQL’in DATABASE_URL bağlantısı kullanılır. TLS sertifika doğrulaması kapatılmaz; sağlayıcının bağlantı ayarı esas alınır. Otomatik yedekleme, saklama/silme süresi ve gerçek Madset oturumu bu aşamada kurulmamıştır. Yönetim ekranının geçici token/maliyet istatistikleri bu geçişte kalıcıya taşınmadı; müşteri kotası, sohbet ve özet belleğinden ayrıdır.

Tüm veritabanı testleri ayrı PostgreSQL test veritabanında çalışır. HTTP testleri rastgele test şemaları oluşturup yalnızca kendi şemalarını temizler. Uygulama veritabanı test için kullanılmaz.
