// Lao names written in Latin letters, karaoke style — for the scanners, which
// can't display Lao (Employee.nameEn). Reads the script syllable by syllable:
// [leading vowel] initial [ວ cluster] vowel signs [final]. Close enough to read
// a name back, not an official romanization; HR corrects any spelling a person
// prefers on the employee form.

const INITIAL = {
  ກ: 'k', ຂ: 'kh', ຄ: 'kh', ຆ: 'kh', ງ: 'ng', ຈ: 'ch', ຉ: 'ch', ສ: 's', ຊ: 'x', ຌ: 'x', ຍ: 'y', ຎ: 'd',
  ດ: 'd', ຕ: 't', ຖ: 'th', ທ: 'th', ຘ: 'th', ນ: 'n', ບ: 'b', ປ: 'p', ຜ: 'ph', ຝ: 'f', ພ: 'ph', ຟ: 'f',
  ຠ: 'ph', ມ: 'm', ຢ: 'y', ຣ: 'r', ລ: 'l', ວ: 'v', ຫ: 'h', ອ: '', ຮ: 'h', ໜ: 'n', ໝ: 'm',
};
const FINAL = {
  ກ: 'k', ຂ: 'k', ຄ: 'k', ງ: 'ng', ຈ: 't', ຊ: 't', ສ: 't', ດ: 't', ຕ: 't', ຖ: 't', ທ: 't',
  ນ: 'n', ລ: 'n', ຣ: 'n', ບ: 'p', ປ: 'p', ຜ: 'p', ພ: 'p', ຝ: 'p', ຟ: 'p', ມ: 'm', ຍ: 'y', ວ: 'o',
};
const LEADING = new Set(['ເ', 'ແ', 'ໂ', 'ໃ', 'ໄ']);
const SIGNS = new Set(['ະ', 'ັ', 'າ', 'ຳ', 'ິ', 'ີ', 'ຶ', 'ື', 'ຸ', 'ູ', 'ົ', 'ໍ', 'ຽ']);
// ຫ silent before these: ຫງ ຫຍ ຫນ ຫມ ຫລ ຫວ.
const HO_LEADS = new Set(['ງ', 'ຍ', 'ນ', 'ມ', 'ລ', 'ວ']);
// Open syllables only — a consonant after them starts the next one.
const OPEN = new Set(['ai', 'am', 'ao']);

// Thai letters onto their Lao counterparts first, for the odd name typed in Thai.
const THAI = Object.fromEntries(
  [
    'กກ', 'ขຂ', 'ฃຂ', 'คຄ', 'ฅຄ', 'ฆຄ', 'งງ', 'จຈ', 'ฉຊ', 'ชຈ', 'ซສ', 'ฌຊ', 'ญຍ', 'ฎດ', 'ฏຕ', 'ฐຖ',
    'ฑທ', 'ฒທ', 'ณນ', 'ดດ', 'ตຕ', 'ถຖ', 'ทທ', 'ธທ', 'นນ', 'บບ', 'ปປ', 'ผຜ', 'ฝຝ', 'พພ', 'ฟຟ', 'ภພ',
    'มມ', 'ยຍ', 'รຣ', 'ลລ', 'วວ', 'ศສ', 'ษສ', 'สສ', 'หຫ', 'ฬລ', 'อອ', 'ฮຮ', '็ັ', '์໌',
  ]
    .map((pair) => [...pair])
    // Vowels sit 0x80 apart in the two blocks: ะ..ู -> ະ..ູ, เ..ไ -> ເ..ໄ.
    .concat([...range(0x0e30, 0x0e39), ...range(0x0e40, 0x0e44)].map((cp) => [String.fromCodePoint(cp), String.fromCodePoint(cp + 0x80)]))
);

function range(from, to) {
  return Array.from({ length: to - from + 1 }, (_, k) => from + k);
}

const isConsonant = (c) => c in INITIAL;
const isSign = (c) => SIGNS.has(c);

function prepare(text) {
  let s = [...String(text ?? '').normalize('NFC')].map((c) => THAI[c] ?? c).join('');
  s = s
    .replace(/ໍາ/g, 'ຳ')
    .replace(/[່-่໋-຺๋ໆๆ໏]/g, '') // tone marks, ໆ, ຺
    .replace(/[ກ-ຮໜໝ]໌/g, '') // a letter under ໌ is silent
    .replace(/ຫຼ/g, 'ລ')
    .replace(/ຼ/g, 'ລ'); // subscript ລ
  return [...s];
}

// A consonant ends the syllable unless a vowel belongs to it: a vowel sign
// right after it, or ອ/ວ standing as its vowel (ພອນ, ຄວນ).
function startsSyllable(chars, i) {
  const next = chars[i + 1];
  if (next === undefined) return false;
  if (isSign(next)) return true;
  if (chars[i] === 'ຫ' && HO_LEADS.has(next)) return true;
  if (next === 'ອ' || next === 'ວ') {
    const after = chars[i + 2];
    return after === undefined || isConsonant(after) || LEADING.has(after);
  }
  return false;
}

function vowelOf(lead, signs) {
  const has = (c) => signs.includes(c);
  if (lead === 'ເ') {
    if (has('ິ') || has('ີ')) return 'oe';
    if (has('າ') && has('ະ')) return 'o';
    if (has('າ') || has('ົ')) return 'ao';
    if (has('ຽ')) return 'ia';
    return 'e';
  }
  if (lead === 'ແ') return 'ae';
  if (lead === 'ໂ') return 'o';
  if (lead === 'ໄ' || lead === 'ໃ') return 'ai';
  if (has('ຳ')) return 'am';
  if (has('ຽ')) return 'ia';
  if (has('ິ') || has('ີ')) return 'i';
  if (has('ຶ') || has('ື')) return 'ue';
  if (has('ຸ') || has('ູ')) return 'u';
  if (has('ົ') || has('ໍ')) return 'o';
  if (has('ະ') || has('ັ') || has('າ')) return 'a';
  return '';
}

function romanizeLao(text) {
  const chars = prepare(text);
  let out = '';
  let i = 0;
  while (i < chars.length) {
    const c = chars[i];
    if (/[A-Za-z0-9 .'-]/.test(c)) {
      out += c;
      i += 1;
      continue;
    }
    if (c >= '໐' && c <= '໙') {
      out += String(c.charCodeAt(0) - 0x0ed0);
      i += 1;
      continue;
    }
    const lead = LEADING.has(c) ? c : null;
    if (lead) i += 1;
    if (!isConsonant(chars[i])) {
      // A stray sign or anything outside Lao — skipped.
      if (!lead) i += 1;
      continue;
    }

    // Initial: ຫ before ງ ຍ ນ ມ ລ ວ only changes the tone.
    let initial = INITIAL[chars[i]];
    if (chars[i] === 'ຫ' && HO_LEADS.has(chars[i + 1])) {
      i += 1;
      initial = INITIAL[chars[i]];
    }
    i += 1;
    // ກວາ, ຂວັນ: ວ followed by a vowel sign is a cluster.
    if (!lead && chars[i] === 'ວ' && isSign(chars[i + 1])) {
      initial += 'w';
      i += 1;
    }

    const signs = [];
    while (isSign(chars[i])) signs.push(chars[i++]);

    let vowel = '';
    if ((signs.includes('ົ') || signs.includes('ັ')) && chars[i] === 'ວ' && !isSign(chars[i + 1])) {
      vowel = 'ua'; // ບົວ
      i += 1;
    } else if (lead === 'ເ' && (signs.includes('ື') || signs.includes('ຶ')) && chars[i] === 'ອ') {
      vowel = 'ua'; // ເມືອງ
      i += 1;
    } else if (lead === 'ເ' && !signs.length && chars[i] === 'ຍ' && !isSign(chars[i + 1])) {
      vowel = 'ia'; // ເສຍ
      i += 1;
    } else if (!lead && !signs.length && chars[i] === 'ອ' && !isSign(chars[i + 1])) {
      vowel = 'o'; // ພອນ
      i += 1;
    } else if (!lead && !signs.length && chars[i] === 'ວ' && !isSign(chars[i + 1])) {
      vowel = 'ua'; // ຄວນ
      i += 1;
    } else {
      vowel = vowelOf(lead, signs);
    }

    let final = '';
    if (!OPEN.has(vowel) && chars[i] in FINAL && !startsSyllable(chars, i)) {
      final = FINAL[chars[i]];
      i += 1;
    }
    if (!vowel) vowel = final ? 'o' : 'a'; // no written vowel: ຄນ, ສະ-less spellings
    out += initial + vowel + final;
  }
  return out;
}

const capitalize = (word) => word.charAt(0).toUpperCase() + word.slice(1);
const NAME_MAX = 24; // the scanners' name field (utils/zkProtocol.js DEVICE_NAME_MAX_BYTES)

// ທ້າວ / ນາງ (and their Thai counterparts) in front of a name — most staff are
// stored as ຊື່ "ທ້າວ" + ນາມສະກຸນ the actual name. Not part of the name itself.
const TITLE = /^(?:(?:ທ່ານນາງ|ທ່ານ|ທ້າວ|ນາງສາວ|ນາງ|นางสาว|นาง|นาย)(?:\s+|$)|(?:ທ|ນ|น\.ส|น)\.\s*)/;

function withoutTitle(firstName, lastName) {
  let first = String(firstName ?? '').trim();
  let last = String(lastName ?? '').trim();
  if (TITLE.test(first)) {
    first = first.replace(TITLE, '').trim();
    // The title was the whole first name: the name itself is the "last name".
    if (!first) [first, last] = [last, ''];
  }
  return [first, last];
}

// "Firstname Lastname" in Latin letters, cut to fit the scanners: the last name
// shortens to its initial first, then the whole thing is clipped.
function englishNameFor(rawFirst, rawLast) {
  const [firstName, lastName] = withoutTitle(rawFirst, rawLast);
  const clean = (s) =>
    romanizeLao(s)
      .replace(/[^A-Za-z0-9 .'-]/g, '')
      .split(/\s+/)
      .filter(Boolean)
      .map(capitalize)
      .join(' ');
  const first = clean(firstName);
  const last = clean(lastName);
  const full = [first, last].filter(Boolean).join(' ');
  if (full.length <= NAME_MAX) return full;
  const short = [first, last.charAt(0)].filter(Boolean).join(' ');
  if (short.length <= NAME_MAX) return short;
  return first.slice(0, NAME_MAX).trim();
}

module.exports = { romanizeLao, englishNameFor };
