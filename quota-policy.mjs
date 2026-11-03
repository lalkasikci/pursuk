export const quotaLimits = Object.freeze({ daily: 20, monthly: 400 });
export const quotaMessages = Object.freeze({
  daily: 'Bugünlük yapay zekâ mesaj hakkın doldu. Hazır sorular ve menü seçenekleriyle devam edebilirsin. Yarın yeniden konuşabiliriz! Sorunun devam ediyorsa info@pursula.com adresine e-posta gönderebilirsin.',
  monthly: 'Bu ayki yapay zekâ mesaj hakkın doldu. Hazır sorular ve menü seçenekleriyle devam edebilirsin. Gelecek ay yeniden konuşabiliriz! Sorunun devam ediyorsa info@pursula.com adresine e-posta gönderebilirsin.'
});
export const mockAccounts = [
  { id: 'demo-ayse', name: 'Ayşe · boş hesap', daily: 0, monthly: 0 },
  { id: 'demo-deniz', name: 'Deniz · boş hesap', daily: 0, monthly: 0 },
  { id: 'demo-gunluk', name: 'Ece · günlük sınır testi', daily: 19, monthly: 19 },
  { id: 'demo-aylik', name: 'Can · aylık sınır testi', daily: 0, monthly: 399 }
];
export function periods(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = type => parts.find(part => part.type === type).value;
  const month = `${value('year')}-${value('month')}`;
  return { day: `${month}-${value('day')}`, month };
}
export function quotaStatus(day, month, dailyUsed, monthlyUsed) {
  return { dailyUsed, monthlyUsed, dailyLimit: quotaLimits.daily, monthlyLimit: quotaLimits.monthly,
    dailyRemaining: Math.max(0, quotaLimits.daily-dailyUsed), monthlyRemaining: Math.max(0, quotaLimits.monthly-monthlyUsed), day, month, timeZone: 'Europe/Istanbul' };
}
