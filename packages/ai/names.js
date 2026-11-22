'use strict';
// 100 kadın/erkek ismi (lakapsız). Botlar bu listeden rastgele isim alır.
const FEMALE = [
  'Ayşe', 'Fatma', 'Zeynep', 'Elif', 'Merve', 'Büşra', 'Esra', 'Selin', 'Deniz', 'Ceren',
  'Gamze', 'Pınar', 'Burcu', 'Seda', 'Tuğba', 'Derya', 'Ebru', 'Aslı', 'Özge', 'Gizem',
  'Hande', 'Ece', 'İpek', 'Melis', 'Naz', 'Sibel', 'Yasemin', 'Nur', 'Gül', 'Sevgi',
  'Hülya', 'Leyla', 'Aylin', 'Dilara', 'Eylül', 'Irmak', 'Kübra', 'Nehir', 'Sena', 'Defne',
  'Bahar', 'Cansu', 'Damla', 'Ezgi', 'Figen', 'Gonca', 'Handan', 'Işıl', 'Jale', 'Meltem',
];
const MALE = [
  'Ahmet', 'Mehmet', 'Mustafa', 'Ali', 'Hasan', 'Hüseyin', 'İbrahim', 'Emre', 'Burak', 'Can',
  'Cem', 'Kemal', 'Murat', 'Onur', 'Serkan', 'Tolga', 'Uğur', 'Volkan', 'Yusuf', 'Zafer',
  'Barış', 'Caner', 'Doğan', 'Erdem', 'Fatih', 'Gökhan', 'Hakan', 'İlker', 'Kaan', 'Levent',
  'Mert', 'Necati', 'Oğuz', 'Polat', 'Rıza', 'Selim', 'Taner', 'Umut', 'Vedat', 'Yiğit',
  'Alper', 'Berk', 'Cihan', 'Efe', 'Furkan', 'Görkem', 'Halil', 'Kerem', 'Orhan', 'Sinan',
];
const NAMES = FEMALE.concat(MALE);

function pickName(rng = Math.random, taken = []) {
  const free = NAMES.filter((n) => !taken.includes(n));
  const pool = free.length ? free : NAMES;
  return pool[Math.floor(rng() * pool.length)];
}

module.exports = { NAMES, FEMALE, MALE, pickName };
